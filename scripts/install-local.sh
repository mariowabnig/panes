#!/bin/bash
set -e

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP="/Applications/Panes.app"
SRC="$REPO_ROOT/src-tauri/target/release/bundle/macos/Panes.app"

if [ ! -d "$SRC" ]; then
  echo "No build found at $SRC — run 'pnpm tauri build' first"
  exit 1
fi

[ -d "$APP" ] && rm -rf "$APP"
cp -R "$SRC" "$APP"
echo "Installed $(du -sh "$APP" | cut -f1) → $APP"
