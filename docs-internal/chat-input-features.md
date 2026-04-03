# Chat Input Features

## Status: In Progress

## Tasks

### 1. ✅ Fix Copilot PR review comments (auth env vars)
- Added `#[serde(skip_serializing, skip_deserializing)]` to auth fields in `TerminalEnvSnapshotDto`
- Fixed misleading GUI launch comment in `apply_terminal_env`
- Added 2 test cases for auth env var passthrough

### 2. ✅ Codex-style queued messages (Phase 1)
Queue one message during Claude streaming; auto-sent on turn completion.
See implementation details below.

### 3. ✅ Enter-to-send setting for chat mode
- `chatInputShortcuts.ts`: Added `enterToSend` parameter — plain Enter submits, Shift+Enter for newline
- `uiStore.ts`: Added `enterToSend` setting with localStorage persistence (`panes:enterToSend`)
- `ChatPanel.tsx`: Passes `enterToSend` to `shouldSubmitChatInput`, toggled via ⏎ button in toolbar
- i18n: Added English + Portuguese translations for tooltip

### 4. ✅ Slash skills fix for Claude engine
**Root cause:** All slash commands had `codexOnly: true` and `disabled: !isCodexEngine`. When the slash menu opened, all matching commands were disabled → Enter selected a disabled command → nothing happened → message never sent to Claude.

**Fix:** `filteredSlashCommands` now filters out disabled commands. When using Claude engine, the slash menu won't show (empty list), so `/init`, `/cost`, etc. pass through as normal messages directly to the Claude sidecar.

---

## Codex-style Message Queue + Steer — Implementation

### What's implemented:
- **Multi-message queue**: Submit multiple messages while the agent is streaming. Each is added to a FIFO queue.
- **Auto-send**: On successful turn completion, the first message in the queue is dequeued and sent automatically. The rest stay queued for subsequent turns.
- **Steer (interrupt + send)**: Each queued message has a "Send now" button (Zap icon) that cancels the current turn and immediately sends that message. Works for any engine.
- **Queue management**: Each message has a remove (X) button. "Clear all" link appears when 2+ messages are queued.
- **Error safety**: Entire queue is cleared on error or interruption (not sent into a broken state).

### How it works:
- `chatStore.ts`: `messageQueue: QueuedMessage[]` + `enqueueMessage` / `removeQueuedMessage` / `clearMessageQueue`
- `ChatPanel.tsx onSubmit`: Non-Codex streaming → `enqueueMessage`; Codex streaming → `steer()` (native mid-turn inject)
- `ChatPanel.tsx useEffect`: On `streaming` true→false + `status === "completed"`: dequeues first message and sends it
- Steer button: `cancel()` then `send()` — interrupts the agent and sends the selected message immediately
- Submit button: Shows Clock icon (amber) during queue mode, Send icon when idle/steer mode
- Queue UI: Numbered list of amber banners above input, each with steer + remove buttons

### Files changed:
- `src/stores/chatStore.ts` — QueuedMessage type with id, messageQueue array, actions
- `src/components/chat/ChatPanel.tsx` — queue on submit, auto-send effect, queue list UI, steer handler
- `src/i18n/resources/en/chat.json` — queueMessage, cancelQueued, steerNow, steerLabel, clearQueue
- `src/i18n/resources/pt-BR/chat.json` — same keys in Portuguese
