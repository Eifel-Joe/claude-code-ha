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

# check_claude_cli used to pass on `command -v` and the x bit alone, so a
# binary that cannot start (libc mismatch, CPU without x86-64-v2) got a green
# tick. It now runs `claude --version` under a time limit (umrath, heytcass
# upstream ff4ebec; owine's fork, commit cc0d74e7) and skips the run when
# the CPU cannot execute Claude at all.
bashio::log.info() { printf 'info|%s\n' "$*"; }
bashio::log.warning() { printf 'warning|%s\n' "$*"; }
bashio::log.error() { printf 'error|%s\n' "$*"; }
CPU_CHECK_SCRIPT="$repo_root/claude-workbench/scripts/cpu-check.sh"
# shellcheck source=/dev/null
source "$repo_root/claude-workbench/scripts/health-check.sh"

stub_dir="$tmp_dir/bin"
mkdir -p "$stub_dir"
ran_marker="$tmp_dir/claude-ran"
good_cpu="$tmp_dir/cpuinfo-good"
old_cpu="$tmp_dir/cpuinfo-old"
printf 'flags\t\t: fpu sse4_2 popcnt\n' > "$good_cpu"
printf 'flags\t\t: fpu sse2\n' > "$old_cpu"

write_stub() {
    printf '#!/bin/bash\ntouch "%s"\n%s\n' "$ran_marker" "$1" > "$stub_dir/claude"
    chmod +x "$stub_dir/claude"
}

# Runs check_claude_cli with only the stub dir and the system tools in PATH
# (a real claude on the developer's machine must not be found).
# Prints the log; the exit status goes to $tmp_dir/rc.
run_claude_check() {
    local cpuinfo="$1" rc=0
    rm -f "$ran_marker"
    (
        PATH="$stub_dir:/usr/bin:/bin"
        CPU_CHECK_ARCH=x86_64 CPU_CHECK_CPUINFO="$cpuinfo" HEALTH_CLAUDE_TIMEOUT=1
        export CPU_CHECK_ARCH CPU_CHECK_CPUINFO HEALTH_CLAUDE_TIMEOUT
        check_claude_cli
    ) || rc=$?
    printf '%s\n' "$rc" > "$tmp_dir/rc"
}

# Works: version in the log, status 0.
write_stub 'echo "2.1.300 (Claude Code)"'
out=$(run_claude_check "$good_cpu")
[ "$(cat "$tmp_dir/rc")" -eq 0 ] || fail "a working claude failed the check: $out"
grep -qx 'info|Claude CLI runs: 2.1.300 (Claude Code) ✓' <<< "$out" || \
    fail "a working claude does not report its version: $out"

# Present but broken: the real error in the log, status 1.
write_stub 'echo "Error relocating /x/claude: posix_getdents: symbol not found" >&2; exit 127'
out=$(run_claude_check "$good_cpu")
[ "$(cat "$tmp_dir/rc")" -eq 1 ] || fail "a broken claude passed the check: $out"
grep -q '^error|Claude CLI is present but fails to run' <<< "$out" || \
    fail "a broken claude is not reported: $out"
grep -qx 'Error relocating /x/claude: posix_getdents: symbol not found' <<< "$out" || \
    fail "the real error of a broken claude is not shown: $out"

# Hangs: the time limit ends it, status 1. exec, so timeout kills the
# process that holds the output pipe.
write_stub 'exec sleep 30'
start=$SECONDS
out=$(run_claude_check "$good_cpu")
[ "$(cat "$tmp_dir/rc")" -eq 1 ] || fail "a hanging claude passed the check: $out"
[ $((SECONDS - start)) -lt 10 ] || fail "the time limit did not end a hanging claude"
grep -q '^error|Claude CLI is present but fails to run' <<< "$out" || \
    fail "a hanging claude is not reported: $out"

# Missing: the real way out, no promise of an install, status 1.
rm -f "$stub_dir/claude"
out=$(run_claude_check "$good_cpu")
[ "$(cat "$tmp_dir/rc")" -eq 1 ] || fail "a missing claude passed the check: $out"
grep -qx 'info|Restart the app: startup reinstalls Claude Code.' <<< "$out" || \
    fail "a missing claude gets no restart hint: $out"
if grep -q 'Attempting to install' <<< "$out"; then
    fail "the check still promises an install it never does: $out"
fi

# CPU without x86-64-v2: claude is not started (it would hang), status 1.
write_stub 'echo "2.1.300 (Claude Code)"'
out=$(run_claude_check "$old_cpu")
[ "$(cat "$tmp_dir/rc")" -eq 1 ] || fail "claude passed on a CPU that cannot run it: $out"
[ ! -e "$ran_marker" ] || fail "claude was started on a CPU that cannot run it"
grep -qx 'error|Claude CLI cannot run on this CPU (lacks sse4_2 popcnt) ✗' <<< "$out" || \
    fail "the CPU reason is not reported: $out"

echo "Health check suite passed"
