# Chat Input Features

## Status: In Progress

## Tasks

### 1. ✅ Fix Copilot PR review comments (auth env vars)
- Added `#[serde(skip_serializing, skip_deserializing)]` to auth fields in `TerminalEnvSnapshotDto`
- Fixed misleading GUI launch comment in `apply_terminal_env`
- Added 2 test cases for auth env var passthrough

### 2. ⏳ Codex-style queued messages + steer — Evaluation
See detailed evaluation below.

### 3. ✅ Enter-to-send setting for chat mode
- `chatInputShortcuts.ts`: Added `enterToSend` parameter — plain Enter submits, Shift+Enter for newline
- `uiStore.ts`: Added `enterToSend` setting with localStorage persistence (`panes:enterToSend`)
- `ChatPanel.tsx`: Passes `enterToSend` to `shouldSubmitChatInput`, toggled via ⏎ button in toolbar
- i18n: Added English + Portuguese translations for tooltip

### 4. ✅ Slash skills fix for Claude engine
**Root cause:** All slash commands had `codexOnly: true` and `disabled: !isCodexEngine`. When the slash menu opened, all matching commands were disabled → Enter selected a disabled command → nothing happened → message never sent to Claude.

**Fix:** `filteredSlashCommands` now filters out disabled commands. When using Claude engine, the slash menu won't show (empty list), so `/init`, `/cost`, etc. pass through as normal messages directly to the Claude sidecar.

---

## Codex-style Queued Messages — Evaluation

### What Codex has:
1. **Queue message** — message is queued and only delivered after the agent finishes the current turn
2. **Steer button** — message is injected immediately into the active turn (interrupts)

### What Panes already has:
- **Steer** already works for **Codex engine only** — if you submit during streaming with Codex, it calls `steer()` which injects a follow-up into the active turn via the Codex API's `steer` method
- **Claude engine** does NOT support steering — `canSteerActiveTurn` is false when `selectedEngineId !== "codex"`
- During streaming with Claude, the submit button is hidden entirely

### Recommendation:

**Phase 1 (quick win):** Allow queuing ONE message during Claude streaming. When the agent finishes (status → completed), auto-send the queued message. This gives the "Codex queue" behavior without needing any API changes.

Implementation:
- Add `queuedMessage: string | null` state to chatStore or ChatPanel
- When streaming + Claude engine: show "Queue" button instead of hiding send
- On submit during streaming: store message in queue, show "queued" indicator
- On turn completion: auto-send queued message
- Allow cancel/edit of queued message

**Phase 2 (Codex steer for Claude):** Would require the Claude sidecar to support a mid-turn injection API, which it may not support today.

### Files changed:
- `src-tauri/src/models.rs`
- `src-tauri/src/terminal/mod.rs`
- `src/components/chat/chatInputShortcuts.ts`
- `src/stores/uiStore.ts`
- `src/components/chat/ChatPanel.tsx`
- `src/i18n/resources/en/chat.json`
- `src/i18n/resources/pt-BR/chat.json`
