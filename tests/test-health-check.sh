#!/usr/bin/env bash
set -euo pipefail

# health-check.sh runs under bashio, which turns on errexit, errtrace, nounset
# and pipefail. Counting failures with `check || ((errors++))` returned 1 on the
# first failure (the expression's value was the old count, 0) and errexit ended
# the script there: the remaining checks and the summary never ran.

repo_root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
tmp_dir=$(mktemp -d)
trap 'rm -rf "$tmp_dir"' EXIT

fail() {
    echo "FAIL (health check): $*" >&2
    exit 1
}

# Run in a separate bash: errexit must be live inside run_diagnostics, which a
# `cmd || …` in this script would switch off.
driver="$tmp_dir/driver.sh"
cat > "$driver" << 'DRIVER_EOF'
set -o errexit -o errtrace -o nounset -o pipefail
bashio::log.info() { printf 'info|%s\n' "$*"; }
bashio::log.warning() { printf 'warning|%s\n' "$*"; }
bashio::log.error() { printf 'error|%s\n' "$*"; }
CPU_CHECK_SCRIPT=/nonexistent
# shellcheck source=/dev/null
source "$1"
check_system_resources() { echo "ran|resources"; return 1; }
check_directory_permissions() { echo "ran|permissions"; }
check_node_installation() { echo "ran|node"; return 1; }
check_claude_cli() { echo "ran|claude"; }
check_cpu_compatibility() { echo "ran|cpu"; }
check_network_connectivity() { echo "ran|network"; }
run_diagnostics
DRIVER_EOF

status=0
out=$(bash "$driver" "$repo_root/claude-workbench/scripts/health-check.sh") || status=$?

for check in resources permissions node claude cpu network; do
    grep -qx "ran|$check" <<< "$out" || \
        fail "check '$check' did not run after an earlier one failed: $out"
done
grep -qx 'error|❌ 2 check(s) failed' <<< "$out" || fail "summary missing or wrong: $out"
[ "$status" -eq 2 ] || fail "run_diagnostics should return the failure count 2, got $status"

echo "Health check suite passed"
