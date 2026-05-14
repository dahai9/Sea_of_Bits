---
title: 'Responses API 到 Chat Completions 的 Custom Tool 桥接方案'
description: '在协议代理层实现 Responses API freeform/custom 工具到 Chat Completions function 的完整双向转换，解决 apply_patch 等语法约束工具的跨协议调用难题'
pubDate: 'May 14 2026'

---

> **摘要**：当 Codex 这样的 Responses API 客户端需要通过 Chat Completions 后端调用 `apply_patch` 等自定义工具时，两套协议之间的语义鸿沟会导致工具调用链断裂。本文记录了在 `responses-adapter` 中实现 custom tool 桥接的完整工程方案——从 `ToolKind` 注册表到系统提示注入、从失败输出检测到流中断恢复——以及踩过的每一个坑。

## 痛点与背景

[responses-adapter](https://github.com/dahai9/response-adapter) 是一个 Rust 编写的协议转换代理，负责将 OpenAI Responses API 请求翻译成 Chat Completions 格式，让 Codex 等只支持 Responses API 的客户端能对接任意兼容 Chat Completions 的上游服务（DeepSeek、Ollama、本地 vLLM 等）。

前期版本已经处理了标准的 `function` 类型工具和 `function_call` 历史的双向转换。但 Codex 在实际使用中暴露了一个更深层的问题：**`apply_patch` 工具不属于 Responses API 的标准 `function` 类型，而是 `custom` 类型的 freeform 工具**。

这意味着：

1. **工具定义不同**：`custom` 工具没有 `parameters` schema，而是带有一个 `format` 字段（通常包含 Lark 语法定义），输入是一个原始字符串而非 JSON 对象。
2. **调用格式不同**：`custom_tool_call` 使用 `input` 字段传递原始输入，而非 `function_call` 的 `arguments` JSON。
3. **输出格式不同**：`custom_tool_call_output` 的字段结构与 `function_call_output` 存在微妙差异。
4. **Chat Completions 根本不认识这些类型**：它只知道 `function` 工具和 `tool_calls`。

如果桥接不完整，Codex 在调用 `apply_patch` 编辑文件时会直接失败——模型会收到错误的工具定义，调用时参数格式错乱，或者上游返回的结果无法被正确解析回 Responses 格式。这是一个**必须在协议层解决**的问题。

## 技术选型与方案思考

### 放弃的方案

**方案 A：简单的类型重映射**——把 `custom` 直接标记为 `function`，不做额外处理。问题：模型不知道 `input` 字段是原始文本而非 JSON，会产生混淆；`apply_patch` 的 grammar 约束信息丢失后，模型倾向于使用 shell heredoc 替代，但这在 Codex 的沙箱中不可靠。

**方案 B：在系统提示中完整描述 apply_patch 语法**——让模型"记住"怎么写 patch。问题：语法描述太长，占用上下文窗口；且不同版本的 `apply_patch` 格式可能变化，硬编码维护成本高。

### 最终方案：ToolKind 注册表 + 定向系统提示 + 失败恢复链

核心设计分三层：

```
┌─────────────────────────────────────────────────┐
│  层 1: ToolKind 注册表 (adapter.rs)              │
│  - 区分 Function / Custom / ToolSearch           │
│  - 双向名称映射，保留类型语义                      │
├─────────────────────────────────────────────────┤
│  层 2: 系统提示注入                               │
│  - 仅在存在 custom 工具时注入 bridge instructions │
│  - apply_patch 专用 description 含原始 format    │
├─────────────────────────────────────────────────┤
│  层 3: 输出检测与恢复引导                         │
│  - 检测 apply_patch 失败输出                      │
│  - 注入 recovery guidance 防止模型放弃工具        │
└─────────────────────────────────────────────────┘
```

## 核心难点突破与实现

### 难点一：ToolKind 注册表——从扁平映射到类型感知

原有的 `ToolNameMapper` 只做名称的正反向映射。要区分 `custom` 工具，需要引入 `ToolKind` 枚举：

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

这使得 `function_call_item()` 在把上游 Chat Completions 的 `tool_calls` 转换回 Responses 格式时，能根据 `ToolKind` 决定输出 `custom_tool_call` 还是 `function_call`：

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

关键细节：`custom_input_from_arguments` 从 `{"input": "*** Begin Patch\n..."}` 的 JSON 包装中提取原始字符串，确保 `apply_patch` 的 patch 文本不会被双重序列化。

### 难点二：自定义工具定义的 Chat Completions 化

`custom` 工具没有 `parameters` schema，但 Chat Completions 要求每个 function 都有。方案是为所有 custom 工具生成统一的 `input` 参数，并将原始 `format`（含 Lark 语法）保留在 description 中：

```rust
fn custom_tool_description(tool: &Value) -> String {
    // ...保留原始 description...
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

同时为 `apply_patch` 注入专用的 usage guidance，包含 patch 格式规则和示例：

```
Apply patch usage rules:
- Always send one complete patch payload.
- It must start with `*** Begin Patch` and end with `*** End Patch`.
- Use `*** Update File: path` for existing files,
  `*** Add File: path` only for new files.
- Prefer small focused patches.
- Do not use shell heredocs as a fallback.
```

这段 guidance 的效果非常显著——在注入之前，模型在 patch 失败后几乎必然切换到 `cat << 'EOF' > file` 的 shell heredoc 方式；注入之后，模型会正确地重新读取文件并重试 `apply_patch`。

### 难点三：call_id 回溯与缺失名称恢复

一个隐蔽的 bug：在多轮对话中，`custom_tool_call_output` 不一定携带 `name` 字段。如果只检查 `item.name == "apply_patch"`，在第二轮及以后的对话中会漏掉失败检测。

解决方案是构建 `call_id -> name` 的历史映射表：

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

这个设计使得无论 `custom_tool_call_output` 是否携带 `name`，都能通过 `call_id` 回溯到正确的工具名。

### 难点四：流中断恢复与 preamble 检测

上游 SSE 流可能因为网络中断、超时或上游错误而截断。如果已经积累了部分内容（文本或工具调用），直接报 `response.failed` 会让 Codex 丢失已完成的工作。

关键改进是引入 `has_stream_progress()` 替代原有的 `has_output_items()`：

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

中断时如果没有 `finish_reason`，强制设置 `end_turn=false` 请求 Codex 继续采样——因为中断可能恰好发生在模型准备发起工具调用的"序言"阶段。

还有一个精妙的细节：**preamble 检测**。当模型输出类似"开始重写文件。"这样的工作序言但没有跟工具调用时，普通逻辑会认为对话已结束（`end_turn=true`），但实际上模型只是"说了一句开场白"还没开始干活：

```rust
fn assistant_text_is_work_preamble(text: &str) -> bool {
    let lower = text.trim().to_ascii_lowercase();
    let starts_like_preamble = [
        "now i'll", "i will", "let me", "i'm going to",
        // 中文序言
        "开始", "现在", "接下来", "继续", "我会", "我将", "先",
    ].iter().any(|p| lower.starts_with(p) || text.starts_with(p));

    if !starts_like_preamble { return false; }

    ["rewrite", "write", "create", "edit", "implement", "fix",
     "重写", "写", "创建", "生成", "更新", "修改", "实现", "修复",
    ].iter().any(|needle| lower.contains(needle) || text.contains(needle))
}
```

如果检测到 preamble，标记 `phase="commentary"` 并设置 `end_turn=false`，让 Codex 知道这不是最终回答而是过渡文本。

### 难点五：Tracing 体系——调试跨协议转换的利器

跨协议代理最痛苦的是调试：请求在 adapter 中被彻底重写，日志里的上游请求和 Responses 事件很难对应。为此构建了分层的 trace 系统：

```
ADAPTER_DEBUG_BODY=1    → 输出转换后的完整请求体
ADAPTER_DEBUG_TRACE=1   → 输出分节的请求/工具/消息摘要
ADAPTER_DEBUG_STREAM=1  → 输出每个上游 SSE chunk
ADAPTER_DEBUG_THINK=1   → 输出推理内容（默认隐藏）
```

核心是 `TraceState` 的去重机制——在多轮对话中，系统提示、工具定义和历史消息会反复出现在请求中，`TraceState` 用 fingerprint 记录已输出的 section，避免重复刷屏：

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

对于 `agent_toolcall` 类型的 section，fingerprint 用 `call_id` 做去重——同一个 `apply_patch` 调用在 response event 和 request history 中各出现一次，但 trace 只输出首次出现的那个。

## 工程总结与反思

这次 custom tool 桥接的开发过程本身就是一次"协议翻译"的完整案例。几个关键 takeaway：

**1. 注册表模式是跨协议转换的核心**。`ToolKind` 看似简单，但它把"类型信息"从散落在各处的 if-else 判断集中到了一个可查询的注册表中，让正向转换（Responses→Chat）和反向转换（Chat→Responses）都能做出正确的类型决策。

**2. 系统提示注入比 schema 改写更可靠**。对于 `apply_patch` 这种有复杂使用规则的工具，与其试图在 `parameters` schema 中编码所有约束，不如在 system prompt 中给出清晰的使用指引。模型对自然语言指令的遵循度远高于对复杂 schema 的理解。

**3. 失败恢复链比失败预防更重要**。与其试图让每一次 patch 都成功（这不可能），不如在失败后给模型一条清晰的恢复路径：检测错误模式 → 注入恢复指引 → 确保 `end_turn=false` 让对话继续。这条链的每一环都有对应的测试用例覆盖。

**4. 流式中断的处理边界比想象的模糊**。"reasoning only" 的响应算不算有进度？"I'll rewrite the file" 但没有工具调用算不算结束？这些边界情况需要逐一枚举并通过测试固化。目前的方案用 `has_stream_progress()` + `content_needs_follow_up()` + `assistant_text_is_work_preamble()` 三个函数分层处理，但这个领域仍有可能遇到新的 corner case。

**5. 不要小看 tracing 的工程价值**。在跨协议代理中，没有 tracing 基本等于盲调。`TraceState` 的 section 去重和 `call_id` 指纹机制让日志在多轮对话中仍然可读，是这次迭代中投入产出比最高的基础设施。
