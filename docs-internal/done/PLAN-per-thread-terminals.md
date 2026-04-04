# Per-Thread Terminals with Harness Integration

## Context
Currently in Panes, threads and terminals are completely independent — terminals are workspace-scoped, and switching threads has no effect on which terminal is visible. Mario wants each thread to have its own terminal session that auto-switches when switching threads, with the harness (Claude, Codex, etc.) remembered per thread and the terminal cwd derived from the project/repo context.

## Approach

### 1. Store harness choice per thread via `engineMetadata` (no migration needed)

The `engine_metadata_json` column already exists on the `threads` table, and `db::threads::update_engine_metadata()` is already implemented. We store `{ "harnessId": "claude-code" }` in it.

**Files:**
- `src/stores/threadStore.ts` — add `setThreadHarnessLocal(threadId, harnessId)` action + `readThreadHarnessId(thread)` helper
- `src-tauri/src/commands/threads.rs` — add `set_thread_harness` command that patches `engine_metadata_json`
- `src/lib/ipc.ts` — add `setThreadHarness(threadId, harnessId)` IPC wrapper
- `src-tauri/src/lib.rs` — register the new command

### 2. Add `threadGroupMap` to terminal store (in-memory)

Add `threadGroupMap: Record<string, string>` (threadId → groupId) to `WorkspaceTerminalState`. Terminal sessions are ephemeral (no DB table), so in-memory is correct — if app restarts, sessions are gone anyway. Only the harness choice (step 1) survives restart.

**New actions on `TerminalState`:**
- `bindThreadGroup(workspaceId, threadId, groupId)` — saves mapping
- `restoreThreadGroup(workspaceId, threadId)` → `boolean` — calls existing `setActiveGroup` if mapping exists
- `unbindThreadGroup(workspaceId, threadId)` — cleanup

Also update `handleSessionExit` to prune dead mappings when a group is removed.

**File:** `src/stores/terminalStore.ts`

### 3. Pass `cwd` through `createSession`

`ipc.terminalCreateSession(workspaceId, cols, rows, cwd?)` already accepts `cwd`. The store's `createSession` action currently doesn't forward it. Add an optional `cwd` param and pass it through.

Add a `resolveThreadCwd(workspaceId, repoId)` helper: returns repo path if `repoId` is set and found, otherwise workspace `rootPath`.

**File:** `src/stores/terminalStore.ts`

### 4. Wire thread switching to restore terminal group

In `Sidebar.tsx`'s `onSelectThread`, after `setActiveThread` + `bindChatThread`, call `restoreThreadGroup(workspaceId, threadId)`. This is a no-op if the thread has no bound group. Same in `CommandPalette.tsx`.

**Files:** `src/components/sidebar/Sidebar.tsx`, `src/components/shared/CommandPalette.tsx`

### 5. Wire harness panel to persist selection on active thread

In `HarnessPanel.tsx`, when the user clicks "Launch" on a harness:
1. Persist `harnessId` to the active thread's `engineMetadata` via `setThreadHarnessLocal` + `ipc.setThreadHarness`
2. Then spawn the terminal session (existing behavior)
3. After session creation, call `bindThreadGroup` to link the new group to the active thread

Show a visual indicator (e.g. checkmark or highlight) on the tile matching the thread's saved `harnessId`.

**File:** `src/components/onboarding/HarnessPanel.tsx`

### 6. Lazy spawn: auto-launch saved harness when terminal opens

In `TerminalPanel.tsx`, when the terminal panel opens with zero sessions and no startup preset, check if the active thread has a saved `harnessId`. If so, auto-spawn a session with that harness. This is the lazy creation behavior — the harness choice is stored on thread creation/selection, but the terminal only spawns when the user actually opens the terminal view.

**File:** `src/components/terminal/TerminalPanel.tsx`

### 7. Cleanup on thread archive

In `Sidebar.tsx`'s `executeArchiveThread`, call `unbindThreadGroup`. The terminal session itself keeps running (user can still see it as an unbound group) — only the mapping is cleared.

**File:** `src/components/sidebar/Sidebar.tsx`

## File Change Summary

| File | Change |
|---|---|
| `src/stores/terminalStore.ts` | Add `threadGroupMap`, `bindThreadGroup`, `restoreThreadGroup`, `unbindThreadGroup`, cwd param on `createSession`, `resolveThreadCwd` |
| `src/stores/threadStore.ts` | Add `setThreadHarnessLocal`, `readThreadHarnessId` |
| `src/lib/ipc.ts` | Add `setThreadHarness` |
| `src-tauri/src/commands/threads.rs` | Add `set_thread_harness` command |
| `src-tauri/src/lib.rs` | Register `set_thread_harness` |
| `src/components/sidebar/Sidebar.tsx` | Call `restoreThreadGroup` in `onSelectThread`, `unbindThreadGroup` in archive |
| `src/components/shared/CommandPalette.tsx` | Call `restoreThreadGroup` after thread switch |
| `src/components/onboarding/HarnessPanel.tsx` | Persist harness to thread, bind group after spawn, show selected indicator |
| `src/components/terminal/TerminalPanel.tsx` | Auto-spawn saved harness on lazy open, bind group after any spawn |

## Verification
1. `cargo build` — Rust compiles with new command
2. `npm run build` — TS compiles
3. Manual test: create thread → pick harness in panel → verify harness saved on thread
4. Manual test: open terminal/split view → verify harness auto-launches with correct cwd
5. Manual test: switch between threads → verify terminal group switches
6. Manual test: switch back → verify previous terminal reattaches with scrollback intact
7. Manual test: archive thread → verify mapping cleared, terminal group still accessible
