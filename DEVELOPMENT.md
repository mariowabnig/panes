# Development Guide

## Prerequisites

- Rust stable (via `rustup`)
- Node.js 20+
- pnpm 9+
- Tauri v2 host prerequisites (see [Tauri docs](https://tauri.app/start/prerequisites/))
- `codex` on `PATH` — required to exercise the Codex engine locally
- GitHub Copilot CLI — optional, for the Copilot engine

## Install and run

```bash
pnpm install
pnpm tauri:dev
```

## Useful checks

```bash
pnpm typecheck          # TypeScript — fast, no build output
pnpm test               # Vitest unit tests
pnpm build              # Full Tauri production build

cd src-tauri
cargo fmt -- --check
cargo check
```

## Known issue: `cargo check` fails without a built frontend

Tauri's build script reads `tauri.conf.json` and requires `frontendDist` (`../dist`) to exist at build time. Running `cargo check` or `cargo build` directly from `src-tauri/` without first building the frontend will fail with an error like:

```
error: `dist` directory not found
```

**Workaround for Rust-only checks** (no full Vite build needed):

```bash
mkdir -p dist && touch dist/index.html
cd src-tauri && cargo check
cd .. && rm -rf dist
```

This creates a minimal stub that satisfies Tauri's build script. Remove it afterward so it doesn't interfere with `pnpm tauri:dev`.

**Normal development flow** — use `pnpm tauri:dev` which runs the Vite dev server and Rust together, or run `pnpm build` which builds the frontend into `dist/` first.

## Project structure

| Path | Purpose |
|------|---------|
| `src/` | React/TypeScript frontend (Vite) |
| `src-tauri/src/` | Rust backend (Tauri commands, terminal, DB) |
| `src-tauri/sidecar/` | Claude sidecar source |
| `src-tauri/sidecar-dist/` | Built sidecar binaries (committed) |
| `src/stores/` | Zustand stores (thread, terminal, workspace) |
| `src/components/` | React components |
| `docs/` | User-facing docs |
| `docs-internal/` | Internal plans, tasks, and done archive |

## IPC and store conventions

- All Tauri commands are registered in `src-tauri/src/lib.rs` and wrapped in `src/lib/ipc.ts`.
- State that survives app restart lives in SQLite (via Tauri commands). In-memory state (e.g., terminal sessions, group maps) is ephemeral and reset on relaunch.
- Prefer the existing store patterns (`threadStore`, `terminalStore`, `workspaceStore`) over ad hoc state.

## i18n

User-facing strings must be added to both locale files:

- `src/i18n/resources/en/`
- `src/i18n/resources/pt-BR/`
