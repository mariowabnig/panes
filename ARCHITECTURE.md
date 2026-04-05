# Panes — Architecture

## Purpose
Desktop app (and optional web UI) for managing multi-pane Claude Code workspaces: chat threads, integrated terminals, file editor, and git panel, all in one window.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript, Vite 6, Tailwind CSS 4 |
| State | Zustand 5 |
| Desktop shell | Tauri 2 (Rust backend) |
| Terminal | xterm.js + WebGL renderer |
| Editor | CodeMirror 6 (multi-language) |
| AI engines | Claude Agent SDK sidecar, Codex CLI, GitHub Copilot CLI |
| Diff/Markdown | diff2html, micromark, react-markdown, web workers |
| DB | SQLite via rusqlite (Tauri side) |
| i18n | i18next — `en` and `pt-BR` |
| Release | release-it + conventional changelog |

---

## Folder Structure

```
panes/
├── src/                        # React/TypeScript frontend
│   ├── main.tsx                # Entry point — i18n init, React root
│   ├── App.tsx                 # Root component — IPC listeners, keyboard shortcuts
│   ├── types.ts                # Shared TypeScript types (Workspace, Thread, Message…)
│   ├── globals.css
│   ├── components/
│   │   ├── layout/             # ThreeColumnLayout (sidebar + content + git panel)
│   │   ├── chat/               # ChatPanel, MessageBlocks, ChatSlashMenu, engine pickers
│   │   ├── editor/             # CodeMirrorEditor, FileEditorPanel
│   │   ├── git/                # GitPanel + sub-views (branches, changes, commits, stash…)
│   │   ├── sidebar/            # Sidebar, ThreadContextMenu
│   │   ├── terminal/           # TerminalPanel
│   │   ├── onboarding/         # OnboardingWizard, HarnessPanel
│   │   ├── workspace/          # WorkspaceSettingsPage
│   │   └── shared/             # CommandPalette, ToastContainer, AppErrorBoundary…
│   ├── stores/                 # Zustand stores (one per domain)
│   ├── lib/                    # Pure utilities (ipc.ts, commandPalette, parseDiff…)
│   ├── workers/                # Web workers (diffParser, markdownParser)
│   └── i18n/                   # i18next config + locale JSON files
│
├── src-tauri/
│   └── src/
│       ├── lib.rs              # App bootstrap, Tauri setup, menu, global state
│       ├── main.rs
│       ├── state.rs            # AppState, TurnManager
│       ├── commands/           # Tauri command handlers (chat, git, files, terminal…)
│       ├── engines/            # AI engine adapters
│       │   ├── claude_sidecar.rs
│       │   ├── codex.rs + codex_transport/protocol
│       │   └── copilot_sidecar.rs
│       ├── db/                 # SQLite schema + queries (workspaces, threads, messages)
│       │   └── migrations/001_initial.sql
│       ├── terminal/           # PTY management (TerminalManager), OSC notifications
│       ├── git/                # Git operations, file-tree cache, watcher
│       ├── sidecars/           # Bundled Claude and Copilot agent binaries
│       │   ├── claude_agent/
│       │   └── copilot_agent/
│       ├── power/              # Keep-awake / power management
│       └── config/             # App config helpers
│
├── scripts/                    # Build helpers (sidecar, desktop, homebrew cask…)
├── docs/                       # User-facing docs
├── docs-internal/              # Internal plans and task files
└── dist/                       # Vite build output (frontend)
```

---

## Key Modules and Responsibilities

### Frontend stores (`src/stores/`)

| Store | Responsibility |
|---|---|
| `workspaceStore` | Workspace list, active workspace/repo, persistence via `localStorage` |
| `threadStore` | Thread list per workspace, active thread, refresh on IPC events |
| `chatStore` | Active thread messages, send/cancel/steer, streaming state |
| `chatComposerStore` | Composer input state (draft, attachments, model/engine selection) |
| `terminalStore` | PTY sessions per workspace, split-pane tree, layout mode |
| `engineStore` | Available AI engines, health checks, runtime update events |
| `gitStore` | Git status, staged files, branch, commit drafts (flushed on unload) |
| `fileStore` | Open editor tabs, active tab, file content |
| `uiStore` | Sidebar/git panel visibility, focus mode, command palette state, active view |
| `onboardingStore` | Onboarding wizard state |
| `harnessStore` | Claude Code harness install status |
| `updateStore` | App auto-update check |
| `toastStore` | Global toast notifications |

### Frontend lib (`src/lib/`)

| Module | Responsibility |
|---|---|
| `ipc.ts` | Typed wrappers for all Tauri `invoke()` calls and `listen()` event subscriptions |
| `commandPalette.ts` | Command palette item resolution (threads `@`, files `%`, search `?`) |
| `parseDiff.ts` | Diff parsing for git change views |
| `newThreadRuntime.ts` | Logic for creating new threads with correct engine/repo context |
| `terminalBootstrap.ts` | Workspace startup preset execution (auto-launch terminal sessions) |
| `windowActions.ts` | Cross-platform window helpers (fullscreen, close, frame detection) |
| `fileLinkNavigation.ts` | Click-to-open file links in chat messages |
| `dependencies.ts` | Dependency health check normalization |

### Rust backend (`src-tauri/src/`)

| Module | Responsibility |
|---|---|
| `commands/` | All Tauri command entry points — thin handlers that delegate to domain modules |
| `engines/` | Engine trait + three adapters: Claude sidecar (SDK process), Codex CLI, Copilot sidecar |
| `db/` | SQLite persistence — workspaces, repos, threads, messages, actions |
| `terminal/` | PTY spawn/resize/kill via `TerminalManager`, session multiplexing |
| `git/` | Git status, diff, branch, commit, worktree operations; file-tree cache + FS watcher |
| `state.rs` | Shared `AppState` (engine manager, terminal manager, keep-awake, turn manager) |
| `sidecars/` | Pre-built Claude and Copilot agent binaries shipped with the app |

---

## Data Flow

```
User input (chat composer / terminal / git UI)
        │
        ▼
  React component
        │ calls store action
        ▼
  Zustand store
        │ calls ipc.*()
        ▼
  src/lib/ipc.ts  ─── invoke() ──────────────────► Tauri Rust command
                                                          │
                                                    delegates to engine /
                                                    DB / terminal / git
                                                          │
                                                    streams events back
        ◄── listenThreadEvents() / listen() ─────────────┘
        │  (StreamEvent, ThreadUpdated, ChatTurnFinished…)
        ▼
  Zustand store updates state
        │
        ▼
  React re-renders UI
```

### Persistence split
- **SQLite** (Rust/Tauri): threads, messages, workspaces, repos, git actions — survives restart
- **localStorage** (frontend): sidebar width, git panel size, last active workspace/repo, layout mode per workspace
- **In-memory only**: terminal session objects, split-pane tree, broadcast state — reset on relaunch

---

## Important Patterns and Conventions

- **IPC layer is the only frontend↔backend boundary.** All Tauri commands are registered in `lib.rs` and mirrored in `src/lib/ipc.ts`. No direct Tauri imports in components — always go through `ipc.*`.
- **Zustand stores call each other via `.getState()`.** Cross-store access at call-time (not hook subscriptions) to avoid circular imports.
- **Layout modes:** each workspace has a `LayoutMode` — `"chat" | "terminal" | "split" | "editor"`. The terminal panel and editor panel share this slot.
- **Three AI engines:** Claude (sidecar binary using Agent SDK), Codex (CLI subprocess with JSON protocol), Copilot (sidecar binary). Engine capabilities differ — `engineCapabilities.ts` gates UI features per engine.
- **Web workers** for CPU-heavy parsing: `diffParser.worker.ts` and `markdownParser.worker.ts` run off the main thread.
- **Keyboard shortcut debounce:** `App.tsx` deduplicates JS keydown events and native Tauri menu-action events within 100ms to prevent double-firing on macOS/WKWebView.
- **Git panel** can be pinned (docked via `react-resizable-panels`) or unpinned (flyout on hover).
- **Sidebar** can be pinned (fixed width, draggable) or unpinned (hover rail flyout).
- **i18n:** all user-facing strings go in `src/i18n/resources/en/` and `src/i18n/resources/pt-BR/`.

---

## Known Quirks and Gotchas

- **Two lockfiles:** `pnpm-lock.yaml` and `package-lock.json` both exist — use `npm` (not pnpm) to install.
- **`cargo check` needs a built frontend:** Tauri's build script requires `dist/` to exist. Use `mkdir -p dist && touch dist/index.html` as a stub for Rust-only checks, then `rm -rf dist` afterward.
- **`build:claude-sidecar` and `build:desktop` are separate targets** from the normal `build` script — they bundle the Claude agent binary and produce the distributable app respectively.
- **Linux AppImage:** transient mount paths (`/var/tmp/.mount_*`) are detected and skipped when restoring the last active workspace on startup.
- **macOS WKWebView shortcut interception:** `Cmd+key` events in contenteditable/CodeMirror go to JS before native menu accelerators, so shortcuts are handled in both JS and menu-action listeners with a debounce guard.
- **Terminal session state is ephemeral:** PTY sessions do not survive app restart; `terminalBootstrap.ts` handles re-launching sessions from startup presets.
- **SQLite runtime recovery:** on startup, `db::threads::reconcile_runtime_state` marks any in-progress messages as interrupted (handles unclean shutdowns).
