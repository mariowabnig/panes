# Fork management and upstream sync

This repository is a fork of [wygoralves/panes](https://github.com/wygoralves/panes). This document covers how upstream changes interact with our fork and how to stay current without losing local work.

## Current setup

- `origin` — `mariowabnig/panes` (our fork)
- `upstream` — `wygoralves/panes` (original repo)

## Auto-sync behavior

GitHub forks do **not** auto-sync. Upstream commits accumulate on `upstream/master` but never touch our `master` unless we explicitly merge or rebase. Our changes are safe by default.

## What happens when upstream adds similar features

If the original author implements features that overlap with ours, `git merge upstream/master` will produce **merge conflicts** in the affected files. Git will not silently overwrite anything — we resolve conflicts manually and choose which version (or combination) to keep.

## Syncing with upstream

Run periodically to avoid large divergences:

```bash
cd ~/Downloads/Coding/panes
git fetch upstream
git merge upstream/master
# resolve conflicts if any
git push origin master
```

Rebase is also fine if you prefer linear history:

```bash
git fetch upstream
git rebase upstream/master
git push origin master --force-with-lease
```

## Things that would lose our changes

Do **not** do any of these:

- `git reset --hard upstream/master` — wipes all local commits
- `git push --force` with upstream's history — overwrites the fork
- Enabling GitHub's "Sync fork" button without checking for conflicts first — it fast-forwards `master` to upstream, which only works cleanly if we have no divergent commits

## Checking divergence

```bash
git fetch upstream
git rev-list --left-right --count upstream/master...master
```

Output format: `<behind> <ahead>`. As of 2026-04-04 we are 0 behind, 26 ahead.
