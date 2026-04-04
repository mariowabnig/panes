# Sidebar Improvements

## Tasks

- [x] **1. Multi-project expand** — Allow multiple project folders to be open simultaneously while still showing thread status indicators
- [x] **2. Thread rename** — Allow renaming threads via double-click or pencil icon in the sidebar
- [x] **3. Git push SOCKS error** — Root cause found; see below

## Changes Made

### Multi-project expand
- `sidebarCollapseState.ts` — When active workspace changes, only the new active is force-expanded; others keep their state
- `Sidebar.tsx` — `onSelectProject()` no longer collapses all others
- `sidebarCollapseState.test.ts` — Updated test expectations

### Thread rename
- `Sidebar.tsx` — Double-click thread to rename inline; pencil icon on hover. Enter confirms, Escape cancels. Uses existing `renameThread` from threadStore.
- `globals.css` — `.sb-thread-rename`, `.sb-thread-rename-input` styles
- `en/app.json`, `pt-BR/app.json` — Added `renameThread` i18n key

### Thread user status

- [x] `ThreadUserStatus` type added to `src/types.ts` — enum: `backlog | in_progress | in_review | done | canceled`
- [x] `set_thread_user_status` Rust command validates and persists status into `engine_metadata.userStatus`
- [x] `ipc.setThreadUserStatus` wires the IPC call from frontend
- [x] `threadStore` — `setThreadUserStatus` (optimistic update + rollback), `setThreadUserStatusLocal`, `getThreadUserStatus` helper, `applyThreadUserStatus`
- [x] `ThreadContextMenu.tsx` — right-click context menu on sidebar threads: Rename, Set status (flyout submenu), Archive
- [x] `Sidebar.tsx` — renders `StatusIcon` next to thread title for non-backlog statuses; wires `onContextMenu`
- [x] `globals.css` — `.sb-thread-user-status`, `.git-action-menu-item-check`

**Status:** DONE
**Date Completed:** 2026-04-04

### Thread pinning

- [x] `src/types.ts` — added `sortOrder: number` and `pinnedAt: string | null` to `Thread` interface
- [x] `src-tauri/src/models.rs` — added `sort_order` and `pinned_at` fields to `ThreadDto`
- [x] `src-tauri/src/db/threads.rs` — `toggle_thread_pin` (sets/clears `pinned_at`); all SELECT queries extended; ORDER BY floats pinned threads first; `restore_thread` resets `sort_order` to 0
- [x] `src-tauri/src/commands/threads.rs` — `toggle_thread_pin` Tauri command
- [x] `src-tauri/src/db/mod.rs` and `src-tauri/src/lib.rs` — migration + command registered
- [x] `src/lib/ipc.ts` — `ipc.toggleThreadPin`
- [x] `src/stores/threadStore.ts` — `toggleThreadPin` (optimistic + rollback); `flattenThreadsByWorkspace` sort respects pin and sort_order
- [x] `src/components/sidebar/Sidebar.tsx` — pin indicator icon on pinned threads
- [x] `src/components/sidebar/ThreadContextMenu.tsx` — "Pin to top" / "Unpin" menu item

**Pinning Status:** DONE
**Date Completed:** 2026-04-04

### Thread drag-and-drop reordering — REMOVED

Backend infrastructure exists (`reorder_threads` DB function, `sort_order` column, IPC call, store action) but the **UI was removed** because HTML5 native drag-and-drop does not work reliably inside Tauri's WKWebView on macOS. Nested `draggable` elements (`<button>` inside `<div draggable>`) fail — the outer draggable (project) captures the drag before the inner one (thread) can claim it. WebKit also ignores `draggable="true"` on `<button>` elements in some builds.

**To re-enable later:** Use a library like `@dnd-kit/core` or `react-beautiful-dnd` instead of native HTML5 DnD. The backend + store layer (`reorderThreads`, `ipc.reorderThreads`, `sort_order` column) is ready and tested — only the UI drag handlers need reimplementation.

## Git Push SOCKS Error — Root Cause

**The Claude Agent SDK sandbox is the cause.** Not a network issue, not Panes code.

### What happens

1. The SDK's `cli.js` contains a sandbox that wraps every Bash command on macOS with `sandbox-exec`
2. When `allowNetwork` is `false` (the default for `Standard` trust level), the sandbox sets up a SOCKS proxy bridge (`socat`) on `localhost:1080`
3. It then sets `GIT_SSH_COMMAND=ssh -o ProxyCommand='nc -X 5 -x localhost:1080 %h %p'` — forcing ALL SSH connections (including `git push`) through the SOCKS proxy
4. When the `socat` bridge process dies, becomes unresponsive, or isn't ready, the `nc` command fails with: `nc: connection failed, SOCKS error 2`

### Why it works in terminal but not in chat
- Terminal (PTY) sessions run commands directly with the user's shell — no SDK sandbox involved
- Chat sessions run through the Claude Agent SDK, which applies the sandbox to every tool execution

### Fix options

**Option A (recommended)**: Set `allowNetwork: true` for trusted local repos. This disables the network sandbox entirely, meaning `git push` uses SSH directly. The trust level check is at `allow_network_for_trust_level()` in `threads.rs` — currently only `Trusted` gets network. Could change `Standard` to also get network.

**Option B**: Pass `--no-sandbox` flag when launching the sidecar CLI. The SDK supports this flag.

**Option C**: Override per-thread via the `sandboxAllowNetwork` metadata field (already supported in the UI via thread execution policy settings).

### Fix applied
Changed `allow_network_for_trust_level()` in both `threads.rs` and `chat.rs` to return `true` for `Standard` trust level (in addition to `Trusted`). Only `Restricted` repos remain sandboxed. This bypasses the SOCKS proxy for all normal repos.
