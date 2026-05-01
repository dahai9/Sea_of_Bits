---
title: 'Building a Local Bridge for Web AI with Rust: Technical Analysis of openlink-rs'
description: 'openlink-rs is a local proxy service based on Rust (Axum + Tokio) that, together with a browser extension, allows Web AIs like ChatGPT and Gemini to directly operate on the local filesystem. This post dissects the project implementation, from architecture design and safety models to streaming interception in the browser extension.'
pubDate: 'Apr 30 2026'
---

> **Summary**: Web-based AIs (ChatGPT, Gemini, AI Studio) are powerful but cannot reach the user's local filesystem. openlink-rs bridges this gap through a combination of a local Rust service and a browser extension. This post analyzes its overall architecture, core modules, security model, and the streaming response interception technology used in the browser extension.

---

## 1. Motivation: The Boundaries of Web AI

Current mainstream AI Agent frameworks (Claude Code, Cursor, Codex, etc.) can directly operate on local filesystems. However, these tools either rely on API calls or require dedicated clients. Most users interact daily with web-based AIs like ChatGPT and Gemini, which run in browser sandboxes and cannot access local resources.

The philosophy of openlink-rs is: **No API needed, no dedicated client required. Let the web AI operate on the local filesystem through a loop of "Output tool call → Browser interception → Local execution → Result injection."**

This project is a Rust rewrite of the original [openlink](https://github.com/afumu/openlink) (implemented in Go), featuring an architectural refactor and new support for Firefox and ChatGPT.

---

## 2. Overall Architecture

openlink-rs consists of two components:

```
┌─────────────────────────────────────────────────┐
│  Browser (Chrome / Firefox)                      │
│                                                  │
│  AI Web Pages (ChatGPT / Gemini / AI Studio)     │
│    │  Output YAML tool_call code blocks          │
│    ▼                                             │
│  Content Script ──→ MutationObserver Detection   │
│    │  Render tool card UI                        │
│    │  User clicks to execute                     │
│    ▼                                             │
│  Background Worker ──→ HTTP POST localhost:39527 │
│                                                  │
└──────────────────────┬──────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────┐
│  Rust Server (Axum + Tokio)                      │
│                                                  │
│  Auth Middleware ──→ Bearer Token Verification  │
│    │                                             │
│    ▼                                             │
│  Executor ──→ Tool match → validate() → execute()│
│    │                                             │
│    ▼                                             │
│  Tool (exec_cmd / read_file / edit / ...)        │
│    │                                             │
│    ▼                                             │
│  Security Sandbox ──→ Path validation + Filter   │
│    │                                             │
│    ▼                                             │
│  Local Filesystem                                │
└──────────────────────────────────────────────────┘
```

The core protocol is the **YAML `tool_call` code block**. The AI model generates a YAML block containing `tool_call` in its response. The browser extension detects this, executes the corresponding tool locally, and then injects the result back into the conversation as a `tool_result`. This entire process requires no API keys or platform-specific integrations.

---

## 3. Rust Backend: Axum + Tokio

### 3.1 Entry Point and CLI

It uses `clap` to parse three parameters:

- `--dir`: Working directory (sandbox root, defaults to current directory)
- `--port`: Listening port (defaults to `39527`, bound to `127.0.0.1`)
- `--timeout`: Command timeout in seconds (defaults to 60)

Upon startup, it loads or generates an authentication Token (a 32-byte random hex string persisted in `~/.openlink/settings.json`), builds the `Executor`, and assembles the Axum Router.

### 3.2 HTTP Routes

| Method | Path | Description |
|------|------|------|
| GET | `/health` | Health check (No auth) |
| POST | `/auth` | Token verification (No auth) |
| GET | `/config` | Returns rootDir and timeout |
| GET | `/tools` | Lists all registered tools and parameter definitions |
| POST | `/exec` | **Core endpoint** — Executes a tool call |
| GET | `/prompt` | Returns initialization prompt with injected system info |
| GET | `/skills` | Lists available Skills |
| GET | `/files?q=` | Directory file search (max 50 results) |

All endpoints (except `/health` and `/auth`) require `Authorization: Bearer <token>` authentication.

### 3.3 Tool Dispatch Engine

The `Executor` holds a `Registry` (`HashMap<String, Arc<dyn Tool>>`) and an `AtomicU64` call counter. The execution flow:

```
ToolRequest
  → Find tool by name (Exact match → Lowercase fallback)
  → tool.validate(args)
  → tool.execute(ctx)
  → Inject identity reinforcement reminder (Full init_prompt every 20 calls)
  → ToolResponse
```

**Identity Reinforcement** is an interesting design choice: AI models tend to "forget" their role and tool call conventions in long conversations. Every 20 tool calls, the system appends the full initialization prompt to the response; every single call appends a short reminder. This effectively prevents "role drift" in long sessions.

### 3.4 Tool System

The project implements 11 tools, organized through a unified `Tool` trait:

```rust
pub trait Tool: Send + Sync {
    fn name(&self) -> &str;
    fn description(&self) -> &str;
    fn parameters(&self) -> Value;
    fn validate(&self, args: &HashMap<String, Value>) -> Result<(), String>;
    fn execute(&self, ctx: &ToolContext) -> ToolResult;
}
```

| Tool | Purpose | Technical Highlights |
|------|------|----------|
| `exec_cmd` | Shell command execution | `sh -c` on Unix, executed in `block_in_place`, 50ms polling `try_wait` for timeout |
| `read_file` | Read file | Line-based offset/limit pagination, max 2000 lines or 50KB per call |
| `write_file` | Write file | Supports overwrite/append, auto-creates parent dirs, sets 0o644 on Unix |
| `edit` | Precise string replacement | **The most complex tool** — 10 cascading strategies + Levenshtein fuzzy matching |
| `list_dir` | List directory | Appends `/` suffix to directory names |
| `glob` | Filename pattern search | `globset` matching, sorted by mtime descending, 100 results limit |
| `grep` | Regex content search | Prefers ripgrep, falls back to native Rust implementation |
| `web_fetch` | Fetch HTTP content | SSRF protection, 30s timeout, 1MB body limit |
| `question` | User interaction | Question popup with optional choices |
| `skill` | Load Skills | Loads Markdown files from the `.skills/` directory |
| `todo_write` | Persistence for TODOs | Writes to `.todos.json` |

---

## 4. Edit Tool: 10 Cascading Replacement Strategies

The `edit` tool is the most technically sophisticated part of the project. AI-generated "old text" often differs from the actual file content in subtle ways: trailing spaces, indentation changes, escape sequences, or Tab/newline confusion. Exact matching results in a low success rate.

The `edit` tool implements 10 cascading replacement strategies, trying from precise to loose:

1. **Simple** — Exact string matching
2. **Line-trimmed** — Ignores leading/trailing spaces on each line
3. **Block-anchor** — Anchored matching based on first and last lines
4. **Whitespace-normalized** — Compresses consecutive whitespace into a single space
5. **Indentation-flexible** — Ignores overall indentation differences
6. **Escape-normalized** — Unifies escape sequences (`\t`, `\n`, etc.)
7. **Trimmed-boundary** — Trims boundary whitespace
8. **Tab-newline** — Swaps between Tabs and spaces
9. **Context-aware** — Locates based on surrounding context lines
10. **Multi-occurrence** — Checks for multiple matches to prevent ambiguous edits

Finally, there is a **Levenshtein distance** fuzzy matching layer as a fallback. This design significantly improves the success rate of AI-driven code editing.

---

## 5. Security Model

### 5.1 Sandboxing

All file operations are restricted within the `root_dir`. Path validation uses `canonicalize()` to resolve symlinks and performs prefix checking:

```rust
// Pseudocode
fn safe_path(user_path, root_dir) -> Result<PathBuf> {
    let resolved = root_dir.join(user_path).canonicalize()?;
    if !resolved.starts_with(root_dir) {
        return Err("path traversal blocked");
    }
    Ok(resolved)
}
```

Absolute paths and `~` paths are validated against a whitelist of root directories (`root_dir`, `~/.claude`, `~/.openlink`, `~/.agent`).

### 5.2 Dangerous Command Interception

`is_dangerous_command()` performs checks before command execution:

- **Multi-word pattern matching**: `rm -rf`, `chmod 777`, `kill -9`, `> /dev/`
- **Word boundary matching**: `mkfs`, `format`, `sudo`, `reboot`, `shutdown`
- **Explicit allowlist**: `curl` and `wget` are permitted

### 5.3 SSRF Protection

The `web_fetch` tool resolves DNS via `getent` before initiating HTTP requests, then checks if the destination IP belongs to private/internal address segments (`10.x`, `172.16-31.x`, `192.168.x`, `127.x`, `169.254.x`, IPv6 link-local/ULA) to prevent the AI from accessing local network services via the web.

### 5.4 Token Authentication

A 64-character hex Token is generated on the first run and persisted in `~/.openlink/settings.json` (with `0o600` permissions). The authentication middleware uses **constant-time comparison** (XOR + fold) to prevent timing attacks.

---

## 6. Skills System

Skills are plugin extensions in the form of Markdown files that the AI can load on demand. The system scans 7 directories in order of priority:

```
<rootDir>/.skills/
<rootDir>/.openlink/skills/
<rootDir>/.agent/skills/
<rootDir>/.claude/skills/
~/.openlink/skills/
~/.agent/skills/
~/.claude/skills/
```

Each Skill is a subdirectory containing a `SKILL.md` with YAML frontmatter:

```markdown
---
name: deploy
description: Project deployment workflow
---

## Deployment Steps
...
```

The first Skill found with a matching name takes precedence. Path separators (`/`, `\`, `..`) in Skill names are rejected to prevent directory traversal. This design allows Skills to share directory structures with tools like Claude Code.

---

## 7. Browser Extension

### 7.1 Tool Call Extractor

`toolcall.ts` is a multi-format parser implemented from scratch, supporting three AI output formats:

- **YAML** (Primary): A full recursive YAML parser supporting block scalars (`|`, `>`), nested maps, and lists.
- **XML**: Parses `<tool name="..." call_id="...">` + `<parameter>` child elements.
- **JSON**: Standard JSON with fallback logic to fix unescaped quotes.

The parser also strips Markdown code fences, normalizes HTML entities, and deduplicates based on `name:callId` keys.

### 7.2 Streaming Response Interception

The extension monkey-patches `window.fetch` to intercept streaming responses from AI platforms. A script injected into the page context decodes response text block by block. When a complete code fence or XML element is detected, it emits a tool call event via `window.postMessage`.

Deduplication for each session is based on a conversation ID extracted from the URL path (`/chat/<id>`, `/c/<id>`, or `?id=<id>`), using an in-memory Set + localStorage (7-day TTL).

### 7.3 Content Script

The main logic resides in `content/index.ts` (~1000 lines), with core functions:

**Site Adaptation**: `getSiteConfig()` returns CSS selectors and text insertion methods for each platform:

| Platform | Editor Selector | Insertion Method |
|------|-------------|----------|
| Gemini | `div.ql-editor[contenteditable]` | `execCommand` |
| ChatGPT | `#prompt-textarea.ProseMirror` | ProseMirror-compatible insertion |
| AI Studio | `textarea[placeholder*="Start typing"]` | Native value setter |

**DOM Observer**: `MutationObserver` listens for newly generated AI reply elements, with 800ms debouncing and a 3s max wait time to handle streaming text. UI noise tags (`MAT-ICON`, `SCRIPT`, `STYLE`, `BUTTON`, etc.) are skipped during text extraction.

**Tool Card UI**: Renders a dark-themed card upon detecting a tool call, containing the tool name, parameters, execute/skip buttons, result display, and an "Insert into chat" button.

**Auto-send Countdown**: After injecting tool results, it displays a random 1-4 second countdown toast before automatically clicking the send button. Users can cancel this at any time.

**Quick Completion**:
- Typing `/` triggers Skills completion (`GET /skills`)
- Typing `@` triggers file path completion (`GET /files?q=`)
- Supports ↑/↓ keyboard navigation, Enter to confirm, and Escape to close.

### 7.4 Background Service Worker

Under Manifest V3, Content Scripts cannot make cross-origin requests directly. The Background Worker acts as a proxy, forwarding `FETCH` messages from Content Scripts to actual `fetch()` calls and returning `{ ok, status, body }`.

### 7.5 Build System

Uses Vite + esbuild. Content and Injected scripts are bundled as IIFE (no module system), and the Background Worker is bundled via Rollup. Build modes for Chrome/Firefox are toggled via `--mode`, selecting the corresponding manifest file.

---

## 8. Summary of Key Design Decisions

| Decision | Reasoning |
|------|------|
| YAML as Communication Protocol | Human-readable, supports multi-line text (block scalars), high tolerance for formatting errors. |
| Streaming Interception vs. API Integration | No API keys needed, cross-platform compatible; one codebase for ChatGPT/Gemini/AI Studio. |
| 10 Cascading Edit Strategies | AI-generated text often differs from file content in whitespace/indentation/escapes; exact matching has low success. |
| Identity Reinforcement Mechanism | Prevents the AI from "forgetting" its role and tool call conventions in long conversations. |
| Constant-time Token Comparison | Prevents timing attacks from leaking the Token. |
| SSRF Protection | Prevents the AI from accessing internal services via `web_fetch`. |
| Manual Confirmation | Users have full control over each tool call, avoiding accidental AI actions. |

---

## 9. Lessons and Reflections

### Advantages of Rust in this Scenario

- **Single Binary Deployment**: `cargo build --release` produces a single executable with no runtime dependencies.
- **Asynchronous Performance**: Tokio handles concurrent requests, with tool execution using `block_in_place` to avoid blocking the event loop.
- **Type Safety**: The combination of the `Tool` trait and `HashMap<String, Value>` ensures compile-time checks while maintaining flexibility.
- **Cross-platform Compilation**: Cross-compiling `x86_64-apple-darwin` on `macos-latest` (ARM) in CI without needing multiple build machines.

### Limitations

- **Unstable Web AI Tool Calls**: Formatting compliance for YAML tool calls varies across platforms and models.
- **Risk of DOM Changes**: UI updates on AI platforms can break CSS selectors, requiring constant maintenance.
- **Not an API Replacement**: Driving AI through browser simulation involves latency and reliability that cannot match native API tool calling.

---

## 10. Links

- **Project Address**: [github.com/dahai9/openlink-rs](https://github.com/dahai9/openlink-rs)
- **Original Project**: [github.com/afumu/openlink](https://github.com/afumu/openlink) (Go implementation)
- **Tech Stack**: Rust 2024 / Axum 0.8 / Tokio / TypeScript / Vite / Manifest V3
