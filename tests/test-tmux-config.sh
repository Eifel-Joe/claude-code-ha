#!/usr/bin/env bash
set -euo pipefail

# ~/.tmux.conf is rewritten on every start, so own settings were lost without
# a word. It now loads ~/.tmux.conf.local last, which the app never writes
# (owine's fork, commits 1175851a, 1e0a33e2), and passes focus events on to
# Claude Code and vim.

repo_root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
tmp_dir=$(mktemp -d)
trap 'rm -rf "$tmp_dir"' EXIT

fail() {
    echo "FAIL (tmux config): $*" >&2
    exit 1
}

bashio::log.info() { :; }
bashio::log.warning() { :; }
bashio::log.error() { :; }
bashio::config() { printf '%s\n' "${2:-}"; }

# shellcheck disable=SC2034  # read by the sourced run.sh
CLAUDE_RUN_SH_SKIP_MAIN=true
# shellcheck source=/dev/null
source "$repo_root/claude-workbench/run.sh"

command -v setup_tmux >/dev/null 2>&1 || fail "run.sh has no setup_tmux"

export HOME="$tmp_dir/home"
export TMUX_WRAPPER_PATH="$tmp_dir/tmux-claude"
mkdir -p "$HOME"
setup_tmux

conf="$HOME/.tmux.conf"
[ -f "$conf" ] || fail "setup_tmux wrote no $conf"
grep -qx 'set -g focus-events on' "$conf" || fail "focus-events is not on"
last=$(grep -vE '^[[:space:]]*(#|$)' "$conf" | tail -n 1)
[ "$last" = 'source-file -q ~/.tmux.conf.local' ] || \
    fail "the last directive must load ~/.tmux.conf.local so own settings win, got: $last"

echo "tmux config suite passed"
