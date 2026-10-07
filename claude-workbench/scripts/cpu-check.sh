#!/bin/bash
# Sourced by run.sh, the session picker and the health check.
#
# Claude Code's native binary needs x86-64-v2 (SSE4.2 and POPCNT). Without
# them it hangs without a word, e.g. on a Proxmox VM with CPU type kvm64.
# Verified 2026-10-07 on HA-Test: runs on x86-64-v2-AES (popcnt, sse4_2, no
# avx/avx2), hangs on kvm64. Anthropic ships no build for older CPUs and the
# npm package wraps the same binary, so the app can only say so.

# Prints the missing CPU flags (e.g. "sse4_2 popcnt"), nothing when Claude
# can run or the CPU cannot be read (no false alarms). x86_64 only.
claude_cpu_missing_flags() {
    local arch="${CPU_CHECK_ARCH:-$(uname -m)}"
    local cpuinfo="${CPU_CHECK_CPUINFO:-/proc/cpuinfo}"
    [ "$arch" = "x86_64" ] || return 0
    local line
    line=$(grep -m1 '^flags' "$cpuinfo" 2>/dev/null) || return 0
    local flags=" ${line#*:} " missing="" flag
    for flag in sse4_2 popcnt; do
        case "$flags" in
            *" $flag "*) ;;
            *) missing="${missing:+$missing }$flag" ;;
        esac
    done
    if [ -n "$missing" ]; then
        printf '%s\n' "$missing"
    fi
}

# Terminal hint for the missing flags passed as $1.
claude_cpu_explain() {
    printf '%s\n' \
        "⚠️  Claude Code cannot run on this CPU: it lacks $1" \
        "   (needs x86-64-v2). Proxmox: set the VM's CPU type to \"host\" or" \
        "   \"x86-64-v2-AES\" and restart the VM. The shell, ha, gh and your" \
        "   packages still work."
}
