# SSH/Auth environment passthrough fix

## Problem

When Panes is launched from the macOS Dock (or a Linux desktop launcher), the process does not inherit the user's shell session environment. This means `SSH_AUTH_SOCK`, `SSH_AGENT_PID`, and `GIT_SSH_COMMAND` are missing from PTY sessions spawned by Panes.

The result: `git push` and `git pull` over SSH fail with "Permission denied (publickey)" — even though the same commands work fine in a regular terminal.

## Fix (branch `fix/pass-through-auth-env-vars`)

The fix snapshots auth-critical environment variables at Panes startup and injects them into every PTY session it spawns.

### Changes

**`src-tauri/src/models.rs`** — Added `ssh_auth_sock`, `ssh_agent_pid`, and `git_ssh_command` fields to `TerminalEnvSnapshotDto`.

**`src-tauri/src/terminal/mod.rs`** — When building the PTY command, reads the snapshot fields and sets them as environment variables on the child process:
- `SSH_AUTH_SOCK`
- `SSH_AGENT_PID`
- `GIT_SSH_COMMAND`
- `GPG_TTY`

**`src/types.ts`** — TypeScript interface `TerminalEnvSnapshot` updated with matching camelCase fields (`sshAuthSock`, `sshAgentPid`, `gitSshCommand`).

### Workaround (without the fix)

Launch Panes from a terminal that already has the SSH agent loaded:

```bash
open /Applications/Panes.app
```

This works because `open` passes the current environment to the launched app.

## Chat agent (Claude sidecar / Codex)

The SSH env passthrough fix only applies to **terminal sessions** (PTY). The chat agents (Claude sidecar, Codex) run as separate subprocesses and do not go through the PTY — so `SSH_AUTH_SOCK` injection does not help them.

However, chat agents can still `git push` over SSH if:
1. The repo remote uses SSH (`git@github.com:...`) instead of HTTPS
2. The SSH key is configured in `~/.ssh/config` with `AddKeysToAgent yes` and `UseKeychain yes`

With this setup, git reads the key directly from `~/.ssh/config` without needing the SSH agent socket. All repos in `~/Downloads/Coding/` were switched to SSH remotes on 2026-04-03.

## Building from the fork

Prerequisites: Rust stable, Node.js 20+, pnpm 9+.

```bash
git clone git@github.com:mariowabnig/panes.git
cd panes
git checkout fix/pass-through-auth-env-vars
pnpm install
pnpm tauri build
```

The built app is at `src-tauri/target/release/bundle/macos/Panes.app`.

First build compiles all Rust dependencies (~10 min). The updater signing error at the end is expected when `TAURI_SIGNING_PRIVATE_KEY` is not set — the `.app` bundle is still produced correctly.

## Testing

1. Install the built app: `cp -R src-tauri/target/release/bundle/macos/Panes.app /Applications/Panes.app`
2. Ensure an SSH key is loaded: `ssh-add -l`
3. Launch from Dock (not terminal) to test the fix in isolation
4. Open a Panes terminal and run: `ssh -T git@github.com`
5. Expected: `Hi <username>! You've successfully authenticated...`
6. Also verify: `echo $SSH_AUTH_SOCK` shows a valid socket path

## Other changes on this branch

### New thread button

One-click "thread" buttons in the `+` dropdown launch agent sessions with worktree isolation (in git repos) or plain sessions (outside git repos). See `docs/new-thread-button.md` for details.

## Upstream status

These changes have not been submitted as a PR to `wygoralves/panes` yet. The branch is ready for a PR once testing is complete.
