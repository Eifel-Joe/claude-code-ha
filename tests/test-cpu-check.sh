#!/usr/bin/env bash
set -euo pipefail

# Claude Code's binary needs x86-64-v2 (SSE4.2, POPCNT); on a Proxmox kvm64 CPU
# it hangs without a word. The app has to say so instead of hanging.

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
tmp_dir=$(mktemp -d)
trap 'rm -rf "$tmp_dir"' EXIT

fail() {
    echo "FAIL (cpu check): $*" >&2
    exit 1
}

# Proxmox kvm64 and x86-64-v2-AES flag lines (shortened, real flag names).
kvm64="$tmp_dir/cpuinfo-kvm64"
printf 'processor\t: 0\nflags\t\t: fpu vme de pse tsc msr pae mce cx8 apic sep mtrr pge mca cmov pat pse36 clflush mmx fxsr sse sse2 syscall nx lm nopl pni cx16 x2apic hypervisor lahf_lm\n' > "$kvm64"
v2="$tmp_dir/cpuinfo-v2"
printf 'processor\t: 0\nflags\t\t: fpu vme de pse tsc msr pae mce cx8 apic sep mtrr pge mca cmov pat pse36 clflush mmx fxsr sse sse2 syscall nx lm pni ssse3 cx16 sse4_1 sse4_2 x2apic popcnt aes hypervisor lahf_lm\n' > "$v2"

export CPU_CHECK_SCRIPT="$repo_root/claude-workbench/scripts/cpu-check.sh"
# shellcheck source=/dev/null
source "$CPU_CHECK_SCRIPT"

# --- claude_cpu_missing_flags ---

[ "$(CPU_CHECK_ARCH=x86_64 CPU_CHECK_CPUINFO="$kvm64" claude_cpu_missing_flags)" = "sse4_2 popcnt" ] || \
    fail "kvm64 must miss sse4_2 popcnt, got '$(CPU_CHECK_ARCH=x86_64 CPU_CHECK_CPUINFO="$kvm64" claude_cpu_missing_flags)'"
[ -z "$(CPU_CHECK_ARCH=x86_64 CPU_CHECK_CPUINFO="$v2" claude_cpu_missing_flags)" ] || \
    fail "x86-64-v2 must miss nothing"
[ -z "$(CPU_CHECK_ARCH=aarch64 CPU_CHECK_CPUINFO="$kvm64" claude_cpu_missing_flags)" ] || \
    fail "only x86_64 is checked"
[ -z "$(CPU_CHECK_ARCH=x86_64 CPU_CHECK_CPUINFO="$tmp_dir/missing" claude_cpu_missing_flags)" ] || \
    fail "an unreadable cpuinfo must not block Claude"

explain=$(claude_cpu_explain "sse4_2 popcnt")
case "$explain" in
    *"cannot run on this CPU"*"sse4_2 popcnt"*"x86-64-v2"*'"host"'*) ;;
    *) fail "explanation lacks cause or fix: $explain" ;;
esac

# --- health check ---

log="$tmp_dir/log"
: > "$log"
bashio::log.info() { printf 'info|%s\n' "$*" >> "$log"; }
bashio::log.warning() { printf 'warning|%s\n' "$*" >> "$log"; }
bashio::log.error() { printf 'error|%s\n' "$*" >> "$log"; }
# shellcheck source=/dev/null
source "$repo_root/claude-workbench/scripts/health-check.sh"

CPU_CHECK_ARCH=x86_64 CPU_CHECK_CPUINFO="$kvm64" check_cpu_compatibility || \
    fail "the CPU check must not count as a failed health check"
grep -q '^warning|.*sse4_2 popcnt.*x86-64-v2' "$log" || fail "health check did not warn about kvm64: $(cat "$log")"
grep -q "^warning|.*Proxmox" "$log" || fail "health check warning lacks the Proxmox fix"
: > "$log"
CPU_CHECK_ARCH=x86_64 CPU_CHECK_CPUINFO="$v2" check_cpu_compatibility
! grep -q '^warning|' "$log" || fail "x86-64-v2 must not warn: $(cat "$log")"

# --- auto-launch in run.sh ---

bashio::config() {
    case "$1" in
        auto_launch_claude) printf '%s\n' true ;;
        *) printf '%s\n' "${2:-}" ;;
    esac
}
# shellcheck disable=SC2034  # read by the sourced run.sh
CLAUDE_RUN_SH_SKIP_MAIN=true
# shellcheck source=/dev/null
source "$repo_root/claude-workbench/run.sh"

: > "$log"
cmd=$(CPU_CHECK_ARCH=x86_64 CPU_CHECK_CPUINFO="$kvm64" get_claude_launch_command)
case "$cmd" in
    *"/usr/local/bin/claude "*|*"/usr/local/bin/claude") fail "auto-launch still starts Claude on kvm64: $cmd" ;;
esac
grep -q '^warning|.*cannot run on this CPU' "$log" || fail "auto-launch did not log why Claude is not started"
cmd=$(CPU_CHECK_ARCH=x86_64 CPU_CHECK_CPUINFO="$v2" get_claude_launch_command)
case "$cmd" in
    *"/usr/local/bin/claude"*) ;;
    *) fail "auto-launch must start Claude on x86-64-v2: $cmd" ;;
esac

echo "cpu-check suite passed"
