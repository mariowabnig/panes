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

## Codex-style Queued Messages — Implementation

### Phase 1 (implemented):
Queue ONE message during any engine's streaming turn. Auto-sent on successful turn completion (`status === "completed"`). Cleared on error or interruption.

### How it works:
- `chatStore.ts`: `queuedMessage: QueuedMessage | null` state + `setQueuedMessage` / `clearQueuedMessage` actions
- `ChatPanel.tsx onSubmit`: When streaming and can't steer (non-Codex), stores message in queue instead of dropping it
- `ChatPanel.tsx useEffect`: Watches `streaming` transition from true→false; if `status === "completed"` and there's a queued message, auto-sends it
- Submit button: Always visible during streaming — shows Clock icon with amber color when in queue mode, Send icon when idle/steer mode
- Queued indicator: Amber banner above input showing truncated queued message with cancel (X) button
- Keyboard: Enter/Cmd+Enter during streaming now queues instead of being silently blocked

### UX:
- User types while agent is streaming → presses Enter → message is queued
- Amber "Queued: ..." banner appears above input with cancel button
- Agent finishes → queued message auto-sends immediately
- If agent errors or is interrupted → queued message is cleared (not sent)
- Only one message can be queued at a time (new queue overwrites previous)

### Phase 2 (future):
Claude mid-turn steer — requires Claude sidecar API support for mid-turn injection.

### Files changed:
- `src/stores/chatStore.ts` — QueuedMessage type, state, actions
- `src/components/chat/ChatPanel.tsx` — queue on submit, auto-send effect, queue indicator, submit button
- `src/i18n/resources/en/chat.json` — queueMessage, queuedPrefix, cancelQueued
- `src/i18n/resources/pt-BR/chat.json` — same keys in Portuguese
