# Panes: Copilot Sidecar Implementation + Terminal Auto-Start for `gh copilot`

**Status**: Completed  
**Date**: 2026-04-04

---

## What was done

### Task 1: Fixed sidecar event protocol ✅

**`protocol.ts`** — Complete rewrite. Now exports proper typed interfaces for every `SidecarEvent` variant the Rust host expects:
- `ReadyEvent`, `SessionInitEvent`, `TurnStartedEvent`, `TextDeltaEvent`, `ThinkingDeltaEvent`
- `ActionStartedEvent`, `ActionOutputDeltaEvent`, `ActionProgressUpdatedEvent`, `ActionCompletedEvent`
- `ApprovalRequestedEvent`, `TurnCompletedEvent`, `NoticeEvent`, `ErrorEvent`, `VersionEvent`
- Plus typed `QueryRequest`, `CancelRequest`, `ApprovalResponseRequest` for incoming commands.

**`main.ts`** — Rewritten to:
- Emit flat NDJSON events directly (not wrapped in `{type: "response", ...}`)
- Route `cancel` and `approval_response` commands to dedicated handlers
- Handle `query` requests via async generator pattern from runner

### Task 2: Implemented Copilot auth + streaming chat + agentic tool use ✅

**`runner.ts`** — Full implementation (500+ lines):

**Authentication:**
- `getGitHubToken()` — uses `gh auth token` CLI
- `getCopilotToken()` — exchanges GitHub token for Copilot session token via `api.github.com/copilot_internal/v2/token`
- Token caching with 60s expiry buffer, auto-refresh
- Auth errors flagged with `isAuthError: true` so Rust host can invalidate transport

**Streaming chat:**
- `streamCopilotChat()` — async generator that POSTs to `api.githubcopilot.com/chat/completions` with `stream: true`
- Parses SSE stream, yields `content`, `tool_calls`, and `done` chunks
- Handles tool call delta accumulation (streamed piece-by-piece)
- Rate limit and auth error handling with token invalidation

**Agentic tool use:**
- 5 tools defined: `file_read`, `file_write`, `file_edit`, `command`, `search`
- Full agentic loop (up to 25 iterations) — model calls tools, sees results, continues
- Approval flow for write/command operations — emits `ApprovalRequested`, waits for host response
- Tool results fed back into conversation as `tool` role messages

**Other:**
- Conversation history tracked per session
- Cancellation via `AbortController`
- Model ID mapping (Panes model IDs → Copilot-supported models)
- System prompt with project context

### Task 3: Terminal auto-start — No code changes needed ✅

The `github-copilot` harness is `native: true` — it powers the Panes **chat engine**, not the terminal. The existing workspace startup preset infrastructure already supports terminal auto-start for non-native harnesses (like `claude-code`, `gemini-cli`, etc.).

The `gh copilot` CLI only has `suggest` and `explain` commands — it doesn't provide an interactive REPL, so auto-starting it in a terminal isn't useful. Users who want Copilot in their terminal can configure a startup preset manually via the UI.

---

## Decision Log

- **Full agentic mode** — implemented with 5 tools, approval flows, and a 25-iteration loop cap.
- **Auth strategy** — `gh auth token` → Copilot token exchange. No device flow fallback (requires `gh` CLI auth).
- **Model mapping** — Panes model IDs mapped to Copilot-supported models (e.g. `claude-sonnet-4.6` → `claude-3.5-sonnet`).
- **Terminal auto-start** — decided against. `gh copilot` CLI is too limited; the native chat engine is the correct integration point.
