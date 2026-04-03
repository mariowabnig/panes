# New thread button

## What it does

Adds per-agent "thread" buttons to the new-tab dropdown (`+` button in the terminal tab bar). One click launches a new agent session. Click it multiple times to run parallel sessions.

## Behavior

- **In a git repo**: each thread gets its own worktree branch (`panes/thread/<runId>/<agent>-1`), stored under `.panes/worktrees/`. The icon shows a git branch symbol.
- **Outside a git repo**: launches a plain agent session with no worktree isolation. The icon shows a `+` symbol.

The thread buttons appear for every installed agent (Claude Code, Codex, Gemini CLI, etc.), between the regular harness entries and "Multi-launch..." in the dropdown.

## Parallel sessions

Each click creates an independent session. Two clicks = two parallel agents. In git repos, each gets its own worktree so they don't conflict. Outside git repos, they share the same working directory — coordination is up to the user or the agents.

## Cleanup

Worktree-backed threads follow the same cleanup flow as multi-launch groups: right-click the tab → Close → "Remove worktrees" or "Keep worktrees".

## Files changed

- **`src/components/terminal/TerminalPanel.tsx`** — `spawnThreadSession` function, `onNewThread` prop on `NewTabDropdown`, thread buttons in default dropdown mode.
- **`src/i18n/resources/en/app.json`** — `terminal.newThread`, `terminal.newThreadTooltip`
- **`src/i18n/resources/pt-BR/app.json`** — same keys, Portuguese translations
