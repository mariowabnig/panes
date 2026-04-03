# Sidebar: Spinning Icon + Instant Thread Title

## Issues
1. No spinning/loading indicator in sidebar when a thread is actively streaming
2. Thread title stays generic ("Workspace Chat") until backend sends `thread-updated` event

## Changes Made
- [x] Merged `feat/thread-status-indicator` branch (spinning icon + completed dot in sidebar)
- [x] Added `setThreadStatusLocal` method to threadStore to update thread status in-memory
- [x] Chat store now syncs thread status to thread store: on `send()` start, on error, and after every stream event flush
- [x] Background stream listeners now sync thread status on TurnCompleted
- [x] Added race-condition guard (bindSeq check) on flush sync
- [x] `setThreadStatusLocal` bails out early when status unchanged (avoids 60fps re-renders during streaming)
- [x] Thread title now uses first line of user's message (truncated to 50 chars) instead of "Workspace Chat"
- [x] Backend still overwrites with AI-generated title via `thread-updated` event
- [x] Removed duplicate Loader2 import and duplicate CSS after merge

## Key Files Changed
- `src/components/sidebar/Sidebar.tsx` — Loader2 spinner + completed dot before thread title
- `src/globals.css` — `.sb-thread-status-spinner`, `@keyframes sb-spin`, `.sb-thread-status-done`
- `src/components/chat/ChatPanel.tsx` — instant title from user's first message
- `src/stores/threadStore.ts` — added `setThreadStatusLocal` method + ThreadStatus import
- `src/stores/chatStore.ts` — sync thread status to thread store during streaming lifecycle
