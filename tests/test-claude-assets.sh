#!/usr/bin/env bash
set -euo pipefail

# The image ships Claude Code commands and a skill in /opt/.claude. They were
# copied only when $HOME/.claude did not exist yet, so every existing install
# kept its first version forever. They are now refreshed on every start; only
# the shipped files are written, everything else in $HOME/.claude stays.

repo_root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
tmp_dir=$(mktemp -d)
trap 'rm -rf "$tmp_dir"' EXIT

fail() {
    echo "FAIL (claude assets): $*" >&2
    exit 1
}

warnings=0
bashio::log.info() { :; }
bashio::log.warning() { warnings=$((warnings + 1)); }
bashio::log.error() { :; }
bashio::config() { printf '%s\n' "${2:-}"; }

shipped="$tmp_dir/opt-claude"
mkdir -p "$shipped/skills/persistent-package-manager" "$shipped/commands"
printf 'new skill\n' > "$shipped/skills/persistent-package-manager/SKILL.md"
printf 'new install command\n' > "$shipped/commands/install.md"
export SHIPPED_CLAUDE_DIR="$shipped"

run_sh="$repo_root/claude-workbench/run.sh"
# shellcheck disable=SC2034  # read by the sourced run.sh
CLAUDE_RUN_SH_SKIP_MAIN=true
# shellcheck source=/dev/null
source "$run_sh"

command -v install_shipped_claude_assets >/dev/null 2>&1 || \
    fail "run.sh has no install_shipped_claude_assets"

# An existing install with an old skill, an own skill and a login.
target="$tmp_dir/home/.claude"
mkdir -p "$target/skills/persistent-package-manager" "$target/skills/my-skill"
printf 'old skill\n' > "$target/skills/persistent-package-manager/SKILL.md"
printf 'mine\n' > "$target/skills/my-skill/SKILL.md"
printf '{"login":"kept"}\n' > "$target/.credentials.json"

install_shipped_claude_assets "$target"

cmp -s "$shipped/skills/persistent-package-manager/SKILL.md" \
    "$target/skills/persistent-package-manager/SKILL.md" || fail "the shipped skill was not updated"
cmp -s "$shipped/commands/install.md" "$target/commands/install.md" || \
    fail "a newly shipped command did not arrive"
[ "$(cat "$target/skills/my-skill/SKILL.md")" = mine ] || fail "an own skill was touched"
[ "$(cat "$target/.credentials.json")" = '{"login":"kept"}' ] || fail "the login was touched"

# A fresh install gets the files too.
install_shipped_claude_assets "$tmp_dir/fresh/.claude"
[ -f "$tmp_dir/fresh/.claude/skills/persistent-package-manager/SKILL.md" ] || \
    fail "a fresh install did not get the shipped skill"

# A failing copy (e.g. /data full) must not stop the app from starting
# (run.sh runs under set -e); it is logged instead. Called plainly, not in
# `|| fail`: that would switch errexit off inside the function and hide the
# abort. Under this script's set -e a failure ends the test.
cp() { return 1; }
install_shipped_claude_assets "$tmp_dir/full/.claude"
unset -f cp
[ "$warnings" -gt 0 ] || fail "a failing copy was not logged"

# Wiring. init_environment writes to fixed /data paths, so this is a text check.
sed -n '/^init_environment() {/,/^}/p' "$run_sh" | \
    grep -qx '    install_shipped_claude_assets "$data_home/.claude"' || \
    fail "init_environment does not call install_shipped_claude_assets"

echo "Claude assets suite passed"
