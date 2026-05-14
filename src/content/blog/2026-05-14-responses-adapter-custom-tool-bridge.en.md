---
title: 'Bridging Custom Tools from Responses API to Chat Completions'
description: 'A complete bidirectional conversion of Responses API freeform/custom tools to Chat Completions functions at the protocol proxy layer, solving the cross-protocol invocation challenge for grammar-constrained tools like apply_patch'
pubDate: 'May 14 2026'
heroImage: '../../assets/blog-placeholder-2.jpg'
---

> **Summary**: When Responses API clients like Codex need to call `apply_patch` and other custom tools through a Chat Completions backend, the semantic gap between the two protocols breaks the tool call chain. This post documents the complete engineering solution for custom tool bridging in `responses-adapter` — from the `ToolKind` registry to system prompt injection, from failure output detection to stream interruption recovery — along with every pitfall encountered along the way.

## The Problem

[responses-adapter](https://github.com/dahai9/response-adapter) is a Rust-based protocol translation proxy that converts OpenAI Responses API requests into Chat Completions format, allowing Responses API-only clients like Codex to work with any Chat Completions-compatible upstream service (DeepSeek, Ollama, local vLLM, etc.).

Earlier versions already handled bidirectional conversion of standard `function` type tools and `function_call` history. But real-world Codex usage exposed a deeper issue: **the `apply_patch` tool is not a standard Responses API `function` type — it's a `custom` type freeform tool**.

This means:

1. **Different tool definition**: `custom` tools have no `parameters` schema; instead they carry a `format` field (typically containing a Lark grammar definition), and the input is a raw string rather than a JSON object.
2. **Different call format**: `custom_tool_call` uses an `input` field for raw input, rather than `function_call`'s JSON `arguments`.
3. **Different output format**: `custom_tool_call_output` has subtle structural differences from `function_call_output`.
4. **Chat Completions doesn't know these types at all**: It only understands `function` tools and `tool_calls`.

If the bridging is incomplete, Codex will fail outright when calling `apply_patch` to edit files — the model receives a malformed tool definition, call parameters get garbled, or upstream results can't be parsed back into Responses format. This is a problem that **must be solved at the protocol layer**.

## Design Approach

### Approaches We Rejected

**Approach A: Simple type remapping** — tag `custom` as `function` directly with no extra handling. Problem: the model doesn't know the `input` field is raw text rather than JSON, causing confusion; once the grammar constraint information for `apply_patch` is lost, the model tends to fall back to shell heredocs, which are unreliable in Codex's sandbox.

**Approach B: Full apply_patch syntax in the system prompt** — have the model "memorize" how to write patches. Problem: the grammar description is too long, consuming context window; and different versions of `apply_patch` format may change, making hardcoded maintenance costly.

### Final Design: ToolKind Registry + Targeted System Prompt + Failure Recovery Chain

The core design has three layers:

```
┌─────────────────────────────────────────────────┐
│  Layer 1: ToolKind Registry (adapter.rs)         │
│  - Distinguish Function / Custom / ToolSearch    │
│  - Bidirectional name mapping, preserve semantics│
├─────────────────────────────────────────────────┤
│  Layer 2: System Prompt Injection                │
│  - Inject bridge instructions only when custom   │
│    tools exist                                   │
│  - apply_patch description includes raw format   │
├─────────────────────────────────────────────────┤
│  Layer 3: Output Detection & Recovery Guidance   │
│  - Detect apply_patch failure output             │
│  - Inject recovery guidance to prevent model     │
│    from abandoning the tool                      │
└─────────────────────────────────────────────────┘
```

## Key Challenges and Solutions

### Challenge 1: ToolKind Registry — From Flat Mapping to Type-Aware Routing

The original `ToolNameMapper` only performed forward and reverse name mapping. To distinguish `custom` tools, we introduced a `ToolKind` enum:

```rust
#[derive(Debug, Clone, Copy, Eq, PartialEq)]
enum ToolKind {
    Function,
    Custom,
}

impl ToolNameMapper {
    fn add_custom(&mut self, name: &str) -> String {
        self.add_with_kind(name, None, ToolKind::Custom)
    }

    fn kind(&self, encoded: &str) -> ToolKind {
        self.kinds.get(encoded).copied().unwrap_or(ToolKind::Function)
    }
}
```

This allows `function_call_item()` to emit either `custom_tool_call` or `function_call` when converting upstream Chat Completions `tool_calls` back to Responses format, based on `ToolKind`:

```rust
if namespace.is_none() && mapper.kind(encoded_name) == ToolKind::Custom {
    let input = custom_input_from_arguments(&arguments);
    return Some(json!({
        "type": "response.output_item.done",
        "item": {
            "type": "custom_tool_call",
            "call_id": call_id,
            "status": "completed",
            "name": name,
            "input": input
        }
    }));
}
```

Key detail: `custom_input_from_arguments` extracts the raw string from the `{"input": "*** Begin Patch\n..."}` JSON wrapper, ensuring the `apply_patch` patch text is not double-serialized.

### Challenge 2: Chat Completions-ifying Custom Tool Definitions

`custom` tools have no `parameters` schema, but Chat Completions requires one for every function. The solution generates a uniform `input` parameter for all custom tools and preserves the original `format` (including Lark grammar) in the description:

```rust
fn custom_tool_description(tool: &Value) -> String {
    // ...preserve original description...
    description.push_str(
        "\nThis Responses freeform/custom tool is exposed through \
         Chat Completions as a function. The function has exactly \
         one argument named `input`; put the complete raw apply_patch \
         patch text in `input`.",
    );
    if let Some(format) = tool.get("format").filter(|f| !f.null) {
        description.push_str("\nOriginal Responses freeform tool format:\n");
        description.push_str(&pretty_json(format));
    }
    description
}
```

We also inject dedicated usage guidance for `apply_patch`, including patch format rules and examples:

```
Apply patch usage rules:
- Always send one complete patch payload.
- It must start with `*** Begin Patch` and end with `*** End Patch`.
- Use `*** Update File: path` for existing files,
  `*** Add File: path` only for new files.
- Prefer small focused patches.
- Do not use shell heredocs as a fallback.
```

The effect of this guidance is dramatic — before injection, the model almost inevitably switches to `cat << 'EOF' > file` shell heredoc syntax after a patch failure; after injection, the model correctly re-reads the file and retries `apply_patch`.

### Challenge 3: call_id Backtracking and Missing Name Recovery

A subtle bug: in multi-turn conversations, `custom_tool_call_output` doesn't always carry a `name` field. If you only check `item.name == "apply_patch"`, you'll miss failure detection in the second turn and beyond.

The solution builds a `call_id -> name` historical mapping:

```rust
fn input_call_names(items: &[Value]) -> HashMap<String, String> {
    let mut names = HashMap::new();
    for item in items {
        let kind = item.get("type").and_then(Value::as_str);
        if !matches!(kind, Some("custom_tool_call" | "function_call" | "tool_search_call")) {
            continue;
        }
        let call_id = item.get("call_id").and_then(Value::as_str);
        let name = if kind == Some("tool_search_call") {
            Some("tool_search")
        } else {
            item.get("name").and_then(Value::as_str)
        };
        if let (Some(id), Some(name)) = (call_id, name) {
            names.insert(id.to_string(), name.to_string());
        }
    }
    names
}

fn is_apply_patch_output(item: &Value, call_id: &str, call_names: &HashMap<...>) -> bool {
    item.type == "custom_tool_call_output"
        && (item.name == "apply_patch"
            || call_names.get(call_id) == Some("apply_patch"))
}
```

This design ensures correct tool name resolution via `call_id` backtracking regardless of whether `custom_tool_call_output` carries a `name`.

### Challenge 4: Stream Interruption Recovery and Preamble Detection

Upstream SSE streams can be cut off due to network interruptions, timeouts, or upstream errors. If partial content (text or tool calls) has already been accumulated, emitting `response.failed` directly would cause Codex to lose all completed work.

The key improvement was introducing `has_stream_progress()` to replace the original `has_output_items()`:

```rust
pub fn has_stream_progress(&self) -> bool {
    self.resp_id.is_some()
        || self.model.is_some()
        || !self.reasoning_content.is_empty()
        || self.has_output_items()
        || self.finish_reason.is_some()
        || self.usage.is_some()
}

pub fn final_events_after_interruption(&mut self, store: &mut ReasoningStore) -> Vec<Value> {
    let end_turn_override = (!self.has_finish_reason()).then_some(false);
    self.final_events_with_end_turn_override(store, end_turn_override)
}
```

On interruption without a `finish_reason`, we force `end_turn=false` to request Codex to continue sampling — because the interruption may have occurred exactly during the model's "preamble" phase before it issues a tool call.

There's also an elegant detail: **preamble detection**. When the model outputs something like "I'll rewrite the file now." as a work preamble without a following tool call, normal logic would consider the conversation finished (`end_turn=true`), but the model has merely "said an opening line" without starting work:

```rust
fn assistant_text_is_work_preamble(text: &str) -> bool {
    let lower = text.trim().to_ascii_lowercase();
    let starts_like_preamble = [
        "now i'll", "i will", "let me", "i'm going to",
        // Chinese preambles
        "开始", "现在", "接下来", "继续", "我会", "我将", "先",
    ].iter().any(|p| lower.starts_with(p) || text.starts_with(p));

    if !starts_like_preamble { return false; }

    ["rewrite", "write", "create", "edit", "implement", "fix",
     "重写", "写", "创建", "生成", "更新", "修改", "实现", "修复",
    ].iter().any(|needle| lower.contains(needle) || text.contains(needle))
}
```

If a preamble is detected, we mark `phase="commentary"` and set `end_turn=false`, letting Codex know this is transitional text rather than a final answer.

### Challenge 5: Tracing Infrastructure — The Debugging Lifeline for Cross-Protocol Translation

The most painful part of cross-protocol proxying is debugging: requests are thoroughly rewritten inside the adapter, and correlating upstream requests with Responses events in logs is extremely difficult. We built a layered trace system for this:

```
ADAPTER_DEBUG_BODY=1    → Output the fully transformed request body
ADAPTER_DEBUG_TRACE=1   → Output sectioned request/tool/message summaries
ADAPTER_DEBUG_STREAM=1  → Output every upstream SSE chunk
ADAPTER_DEBUG_THINK=1   → Output reasoning content (hidden by default)
```

The core is `TraceState`'s deduplication mechanism — in multi-turn conversations, system prompts, tool definitions, and message history appear repeatedly in requests. `TraceState` uses fingerprints to track already-emitted sections, preventing duplicate log spam:

```rust
struct TraceState {
    emitted_sections: HashSet<String>,
}

impl TraceState {
    fn unseen_sections(&mut self, current: Vec<(String, String)>) -> Vec<(String, String)> {
        current.into_iter()
            .filter(|(label, body)| self.emitted_sections.insert(trace_fingerprint(label, body)))
            .collect()
    }
}
```

For `agent_toolcall` type sections, the fingerprint uses `call_id` for deduplication — the same `apply_patch` call appears once in the response event and once in the request history, but the trace only outputs the first occurrence.

## Reflections

This custom tool bridging development was itself a complete case study in "protocol translation." A few key takeaways:

**1. The registry pattern is the backbone of cross-protocol conversion.** `ToolKind` looks simple, but it centralizes "type information" from scattered if-else chains into a queryable registry, enabling both forward conversion (Responses→Chat) and reverse conversion (Chat→Responses) to make correct type decisions.

**2. System prompt injection is more reliable than schema rewriting.** For tools like `apply_patch` with complex usage rules, encoding all constraints in a `parameters` schema is less effective than providing clear usage guidance in the system prompt. Models follow natural language instructions far better than they understand complex schemas.

**3. Failure recovery chains matter more than failure prevention.** Rather than trying to make every patch succeed (impossible), give the model a clear recovery path after failure: detect error pattern → inject recovery guidance → ensure `end_turn=false` to continue the conversation. Each link in this chain has corresponding test coverage.

**4. Stream interruption handling has fuzzier boundaries than you'd expect.** Does a "reasoning only" response count as progress? Does "I'll rewrite the file" without a tool call count as finished? These edge cases need to be enumerated and codified through tests. The current approach uses three functions — `has_stream_progress()`, `content_needs_follow_up()`, and `assistant_text_is_work_preamble()` — for layered handling, but new corner cases may still emerge.

**5. Never underestimate the engineering value of tracing.** In a cross-protocol proxy, no tracing is essentially blind debugging. `TraceState`'s section deduplication and `call_id` fingerprinting keep logs readable even in multi-turn conversations — the highest ROI infrastructure investment in this iteration.
