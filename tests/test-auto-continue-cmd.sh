#!/usr/bin/env bash
set -euo pipefail

# Auto-continue's switch is the file $AUTO_CONTINUE_DIR/auto-continue ("on" or
# "off"). run.sh writes it from the option auto_continue on every start
# (init_auto_continue); the auto-continue command flips it at runtime.

repo_root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
tmp_dir=$(mktemp -d)
trap 'rm -rf "$tmp_dir"' EXIT

fail() {
    echo "FAIL (auto-continue): $*" >&2
    exit 1
}

log="$tmp_dir/log"
: > "$log"
bashio::log.info() { printf 'info|%s\n' "$*" >> "$log"; }
bashio::log.warning() { printf 'warning|%s\n' "$*" >> "$log"; }
bashio::log.error() { printf 'error|%s\n' "$*" >> "$log"; }
config_value=false
bashio::config() {
    case "$1" in
        auto_continue) printf '%s\n' "$config_value" ;;
        *) printf '%s\n' "${2:-}" ;;
    esac
}

export AUTO_CONTINUE_DIR="$tmp_dir/run"
# shellcheck disable=SC2034  # read by the sourced run.sh
CLAUDE_RUN_SH_SKIP_MAIN=true
# shellcheck source=/dev/null
source "$repo_root/claude-workbench/run.sh"

command -v init_auto_continue >/dev/null 2>&1 || fail "run.sh has no init_auto_continue"
state="$AUTO_CONTINUE_DIR/auto-continue"

# Off by default, and silent.
config_value=false
init_auto_continue
[ "$(cat "$state")" = "off" ] || fail "option false did not write off"
[ ! -s "$log" ] || fail "an off start must not log: $(cat "$log")"

# On: writes on and says how to switch it.
config_value=true
init_auto_continue
[ "$(cat "$state")" = "on" ] || fail "option true did not write on"
grep -q '^info|Auto-continue after a usage limit is on' "$log" || fail "an on start was not logged: $(cat "$log")"

# A stale status from before the restart is removed.
printf 'Auto-continue: on\n' > "$AUTO_CONTINUE_DIR/auto-continue.status"
config_value=false
init_auto_continue
[ ! -e "$AUTO_CONTINUE_DIR/auto-continue.status" ] || fail "the old status file was kept"

# Anything unreadable counts as off.
for value in '' maybe 1 yes; do
    config_value="$value"
    init_auto_continue
    [ "$(cat "$state")" = "off" ] || fail "option '$value' did not write off"
done

# A directory that cannot be created must not abort the start.
: > "$tmp_dir/blocker"
AUTO_CONTINUE_DIR="$tmp_dir/blocker/run"
config_value=true
init_auto_continue
grep -q '^warning|Could not write the auto-continue switch' "$log" || fail "a failed write was not logged: $(cat "$log")"
AUTO_CONTINUE_DIR="$tmp_dir/run"

echo "Auto-continue suite passed"
