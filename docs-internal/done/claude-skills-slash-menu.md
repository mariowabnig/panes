# Claude Skills in Slash Menu

**Status:** Done

## Problem
The slash menu (`/`) in chat mode shows nothing when using the Claude engine because all commands are `codexOnly: true`.

## Root Cause
- `slashCommands` array in ChatPanel.tsx has every entry marked `codexOnly: true` and `disabled: !isCodexEngine`
- No backend command exists to list Claude skills (only `list_codex_skills`)
- Claude Agent SDK **does** handle `/skillname` in prompt text — we just need the UI

## Plan
- [x] Add Rust backend: `list_claude_skills` command that reads `~/.claude/skills/*/SKILL.md` frontmatter
- [x] Add IPC wrapper: `ipc.listClaudeSkills()`
- [x] Load Claude skills in ChatPanel when engine is `claude`
- [x] Add skill entries to slash menu for Claude threads
- [x] Handle selection: set input to `/skillname` and auto-submit

## Key Files
- `src-tauri/src/commands/engines.rs` — add `list_claude_skills`
- `src-tauri/src/engines/mod.rs` — add `list_claude_skills` on EngineManager
- `src-tauri/src/lib.rs` — register command
- `src/lib/ipc.ts` — add IPC wrapper
- `src/components/chat/ChatPanel.tsx` — load skills, add to slash menu
- `src/components/chat/ChatSlashMenu.tsx` — remove Codex-only badge logic (show engine badge conditionally)
