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
# Not just "/usr/local/bin/claude": that would also match claude-session-picker.
case "$cmd" in
    *"/usr/local/bin/claude "*|*"/usr/local/bin/claude") ;;
    *) fail "auto-launch must start Claude on x86-64-v2: $cmd" ;;
esac

# --- persistent Claude smoke test in run.sh ---

# It runs `claude --version` at startup; on kvm64 that hangs into its 15 s
# timeout and then blames the install.
persistent_calls="$tmp_dir/persistent-calls"
export PERSISTENT_CLAUDE_ROOT="$tmp_dir/npm"
mkdir -p "$PERSISTENT_CLAUDE_ROOT/bin" "$PERSISTENT_CLAUDE_ROOT/lib/node_modules/@anthropic-ai/claude-code"
printf '{}\n' > "$PERSISTENT_CLAUDE_ROOT/lib/node_modules/@anthropic-ai/claude-code/package.json"
printf '#!/bin/sh\necho "$@" >> "%s"\necho "2.1.292 (Claude Code)"\n' "$persistent_calls" > "$PERSISTENT_CLAUDE_ROOT/bin/claude"
chmod +x "$PERSISTENT_CLAUDE_ROOT/bin/claude"
export CLAUDE_BIN_LINK="$tmp_dir/link/claude" CLAUDE_NATIVE_BIN_LINK="$tmp_dir/native/claude"
mkdir -p "$tmp_dir/link" "$tmp_dir/native"
bashio::config() {
    case "$1" in
        use_persistent_claude) printf '%s\n' true ;;
        auto_update_claude_on_start) printf '%s\n' false ;;
        *) printf '%s\n' "${2:-}" ;;
    esac
}
: > "$log"
: > "$persistent_calls"
CPU_CHECK_ARCH=x86_64 CPU_CHECK_CPUINFO="$kvm64" setup_persistent_claude
[ ! -s "$persistent_calls" ] || fail "kvm64: startup still ran the persistent Claude binary"
grep -q '^warning|.*cannot run on this CPU' "$log" || fail "kvm64: persistent setup did not name the CPU: $(cat "$log")"
! grep -q 'no working persistent Claude install' "$log" || fail "kvm64: persistent setup blames the install instead of the CPU"
CPU_CHECK_ARCH=x86_64 CPU_CHECK_CPUINFO="$v2" setup_persistent_claude
grep -q -- '--version' "$persistent_calls" || fail "x86-64-v2: persistent smoke test must still run"

# --- session picker ---

fake_claude="$tmp_dir/claude"
claude_calls="$tmp_dir/claude-calls"
printf '#!/bin/sh\necho "$@" >> "%s"\necho "2.1.292 (Claude Code)"\n' "$claude_calls" > "$fake_claude"
chmod +x "$fake_claude"
export CLAUDE_BIN="$fake_claude"
# shellcheck disable=SC2034  # read by the sourced picker
CLAUDE_PICKER_SKIP_MAIN=true
# The picker runs without nounset in production (unset options are normal).
set +u
# shellcheck source=/dev/null
source "$repo_root/claude-workbench/scripts/claude-session-picker.sh"

export CPU_CHECK_ARCH=x86_64 CPU_CHECK_CPUINFO="$kvm64"
: > "$claude_calls"
[ -z "$(get_installed_version)" ] || fail "kvm64: the version lookup must not run Claude"
case "$(claude_version_label)" in
    *"not supported on this CPU"*) ;;
    *) fail "kvm64: menu version label does not explain: $(claude_version_label)" ;;
esac
out=$(launch_claude_new < /dev/null 2>&1)
case "$out" in *"cannot run on this CPU"*) ;; *) fail "kvm64: new session does not explain: $out" ;; esac
launch_claude_continue < /dev/null > /dev/null 2>&1
launch_claude_resume < /dev/null > /dev/null 2>&1
printf 'foo\n' | launch_claude_custom > /dev/null 2>&1
[ ! -s "$claude_calls" ] || fail "kvm64: the picker still ran Claude: $(cat "$claude_calls")"
# The auth helper pipes into and finally execs claude; it must not even start.
out=$(launch_auth_helper < /dev/null 2>&1)
case "$out" in
    *"Starting Claude authentication helper"*) fail "kvm64: auth helper still starts: $out" ;;
    *"cannot run on this CPU"*) ;;
    *) fail "kvm64: auth helper does not explain: $out" ;;
esac
# The update item's label: never "up to date" without knowing the installed
# version. A pinned spec is the "latest" version, so this needs no network.
export CLAUDE_NPM_SPEC=@anthropic-ai/claude-code@9.9.9
: > "$claude_calls"
label=$(update_menu_label)
case "$label" in
    *"up to date"*) fail "kvm64: update label claims up to date: $label" ;;
    *"latest 9.9.9; installed version not checked on this CPU"*) ;;
    *) fail "kvm64: update label does not explain: $label" ;;
esac
[ ! -s "$claude_calls" ] || fail "kvm64: the update label ran Claude: $(cat "$claude_calls")"

export CPU_CHECK_CPUINFO="$v2"
[ "$(get_installed_version)" = "2.1.292" ] || fail "x86-64-v2: version lookup must run Claude"
launch_claude_new < /dev/null > /dev/null 2>&1
grep -q . "$claude_calls" || fail "x86-64-v2: new session did not start Claude"
label=$(update_menu_label)
[ "$label" = "Update Claude Code (2.1.292 → 9.9.9 available)" ] || \
    fail "x86-64-v2: update label with a newer release: $label"
export CLAUDE_NPM_SPEC=@anthropic-ai/claude-code@2.1.292
label=$(update_menu_label)
[ "$label" = "Update Claude Code (2.1.292, up to date)" ] || \
    fail "x86-64-v2: update label when current: $label"
label=$(CLAUDE_BIN="$tmp_dir/no-such-claude"; update_menu_label)
case "$label" in
    *"up to date"*) fail "missing binary: update label claims up to date: $label" ;;
    *"latest 2.1.292; installed version unknown"*) ;;
    *) fail "missing binary: update label does not explain: $label" ;;
esac
unset CLAUDE_NPM_SPEC
unset CPU_CHECK_ARCH CPU_CHECK_CPUINFO

echo "cpu-check suite passed"
