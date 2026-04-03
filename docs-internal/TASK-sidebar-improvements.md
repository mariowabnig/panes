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
