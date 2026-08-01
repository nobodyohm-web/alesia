#!/bin/bash
# Alesia launcher — macOS.
#
# Double-clickable on its own, and the target of Alesia.app (see build.sh).
# The .app is what goes in the Dock; this file is what actually runs.
#
# WHY THE PATH DANCE: an app launched from the Dock or Finder inherits a bare
# environment (/usr/bin:/bin:/usr/sbin:/sbin) and never sources ~/.zshrc, so a
# bun installed in ~/.bun/bin is invisible to it. A launcher that just calls
# `bun` works from a terminal and fails from the Dock, which is the one place
# it is meant to work.

set -u

# Resolve this script's own directory, following symlinks, so the repo is found
# regardless of where the launcher is invoked from.
SELF="${BASH_SOURCE[0]}"
while [ -L "$SELF" ]; do
  LINK="$(readlink "$SELF")"
  case "$LINK" in
    /*) SELF="$LINK" ;;
    *) SELF="$(dirname "$SELF")/$LINK" ;;
  esac
done
HERE="$(cd "$(dirname "$SELF")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"

fail() {
  printf '\n\033[31m%s\033[0m\n\n' "$1"
  printf 'Press Return to close this window.'
  read -r _
  exit 1
}

[ -f "$REPO/package.json" ] || fail "Alesia not found at $REPO — is this launcher still inside the repository?"

cd "$REPO" || fail "Cannot enter $REPO"

for dir in "$HOME/.bun/bin" /opt/homebrew/bin /usr/local/bin; do
  [ -x "$dir/bun" ] && PATH="$dir:$PATH"
done
export PATH

command -v bun >/dev/null 2>&1 || fail "bun is not installed. Install it with:
  curl -fsSL https://bun.com/install | bash"

[ -d "$REPO/node_modules" ] || {
  printf '\033[33mFirst run: installing dependencies...\033[0m\n'
  bun install || fail "bun install failed."
}

# The agent needs at least one model provider key. Warning rather than failing:
# the backtest studies below run fine without any key at all.
if [ ! -f "$REPO/.env" ]; then
  printf '\033[33mNo .env found. Copy env.example to .env and add an API key,\n'
  printf 'or press Return to continue anyway (the backtests need no key).\033[0m\n'
  read -r _
fi

# Escape hatch for build.sh, which verifies every check above without launching
# the TUI — an interactive app is not something a build script can test.
if [ "${ALESIA_LAUNCHER_CHECK:-}" = "1" ]; then
  echo "launcher OK — repo=$REPO bun=$(command -v bun) version=$(bun --version)"
  exit 0
fi

printf '\033[36mAlesia\033[0m — %s\n\n' "$REPO"
exec bun start
