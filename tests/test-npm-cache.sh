#!/usr/bin/env bash
set -euo pipefail

# npm's download cache must not live in /data: it went into every backup of
# the app (115 MB on a real install). run.sh points it at /tmp and removes the
# old one once.

repo_root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
tmp_dir=$(mktemp -d)
trap 'rm -rf "$tmp_dir"' EXIT

fail() {
    echo "FAIL (npm cache): $*" >&2
    exit 1
}

log="$tmp_dir/log"
: > "$log"
bashio::log.info() { printf 'info|%s\n' "$*" >> "$log"; }
bashio::log.warning() { printf 'warning|%s\n' "$*" >> "$log"; }
bashio::log.error() { printf 'error|%s\n' "$*" >> "$log"; }
bashio::config() { printf '%s\n' "${2:-}"; }

export NPM_CACHE_DIR="$tmp_dir/npm-cache"
export NPM_LEGACY_CACHE_DIR="$tmp_dir/data/home/.npm"
run_sh="$repo_root/claude-workbench/run.sh"

# shellcheck disable=SC2034  # read by the sourced run.sh
CLAUDE_RUN_SH_SKIP_MAIN=true
# shellcheck source=/dev/null
source "$run_sh"

command -v setup_npm_cache >/dev/null 2>&1 || fail "run.sh has no setup_npm_cache"

# An old cache in /data is removed, once, and npm points at the new place.
mkdir -p "$NPM_LEGACY_CACHE_DIR/_cacache"
: > "$NPM_LEGACY_CACHE_DIR/_cacache/blob"
unset npm_config_cache
setup_npm_cache
[ "${npm_config_cache:-}" = "$NPM_CACHE_DIR" ] || \
    fail "npm_config_cache is '${npm_config_cache:-}', expected $NPM_CACHE_DIR"
[ ! -e "$NPM_LEGACY_CACHE_DIR" ] || fail "the old cache in /data was not removed"
[ "$(grep -c 'Removed the old npm cache' "$log")" -eq 1 ] || \
    fail "the removal must be logged once: $(cat "$log")"

# Nothing to remove: quiet.
: > "$log"
setup_npm_cache
[ ! -s "$log" ] || fail "nothing to remove, but it logged: $(cat "$log")"
[ "${npm_config_cache:-}" = "$NPM_CACHE_DIR" ] || fail "npm_config_cache lost on a second run"

# Wiring. init_environment writes to fixed /data paths, so these are text checks.
# No grep -q after sed: under pipefail an early grep exit makes sed die of
# SIGPIPE and the check fails although the line is there (CI run 37970222395).
sed -n '/^init_environment() {/,/^}/p' "$run_sh" | grep -x '    setup_npm_cache' > /dev/null || \
    fail "init_environment does not call setup_npm_cache"
sed -n "/<< 'PROFILE_EOF'/,/^PROFILE_EOF/p" "$run_sh" | \
    grep -qx 'export npm_config_cache="/tmp/npm-cache"' || \
    fail "the shell profile does not point npm_config_cache at /tmp"

echo "npm cache suite passed"
