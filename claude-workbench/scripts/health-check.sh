#!/usr/bin/with-contenv bashio

# Health check script for the Claude Workbench app
# Validates environment and provides diagnostic information

# shellcheck source=/dev/null
[ -f "${CPU_CHECK_SCRIPT:-/opt/scripts/cpu-check.sh}" ] && . "${CPU_CHECK_SCRIPT:-/opt/scripts/cpu-check.sh}"

check_system_resources() {
    bashio::log.info "=== System Resources Check ==="

    # Check available memory
    local mem_total=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
    local mem_free=$(awk '/MemAvailable/ {print int($2/1024)}' /proc/meminfo)
    bashio::log.info "Memory: ${mem_free}MB free of ${mem_total}MB total"

    if [ "$mem_free" -lt 256 ]; then
        bashio::log.error "Low memory warning: Less than 256MB available"
        bashio::log.info "This may cause installation or runtime issues"
    fi

    # Check disk space in /data
    local disk_free=$(df -m /data | tail -1 | awk '{print $4}')
    bashio::log.info "Disk space in /data: ${disk_free}MB free"

    if [ "$disk_free" -lt 100 ]; then
        bashio::log.error "Low disk space warning: Less than 100MB in /data"
    fi
}

check_directory_permissions() {
    bashio::log.info "=== Directory Permissions Check ==="

    # Check if /data is writable
    if [ -w "/data" ]; then
        bashio::log.info "/data directory: Writable ✓"
    else
        bashio::log.error "/data directory: Not writable ✗"
        return 1
    fi

    # Try to create test directory
    local test_dir="/data/.test_$$"
    if mkdir -p "$test_dir" 2>/dev/null; then
        bashio::log.info "Can create directories in /data ✓"
        rmdir "$test_dir"
    else
        bashio::log.error "Cannot create directories in /data ✗"
        return 1
    fi
}

# Runs "$1 --version" and prints its output; the status is the command's.
# Present and executable is not the same as runnable: a libc mismatch leaves
# a binary that aborts on launch, a CPU without x86-64-v2 one that hangs
# (umrath, heytcass upstream ff4ebec; owine's fork, commit cc0d74e7). So the
# checks run it, under a time limit, with stdin from /dev/null - as
# claude-doctor, stdin is the terminal, and a background job that touches it
# under timeout is stopped (SIGTTOU) and would look like a hang.
run_version_check() {
    local -a version_cmd=("$1" --version)
    if command -v timeout >/dev/null 2>&1; then
        version_cmd=(timeout "${HEALTH_VERSION_TIMEOUT:-10}" "${version_cmd[@]}")
    fi
    "${version_cmd[@]}" < /dev/null 2>&1
}

# Logs the result of run_version_check for a tool; returns 1 when it failed.
# A here-string, not a pipe, for the error lines: with pipefail an
# early-closing head could fail the check under bashio's errexit.
report_version_check() {
    local label="$1" tool="$2" output status=0
    output=$(run_version_check "$tool") || status=$?
    if [ "$status" -ne 0 ]; then
        bashio::log.error "${label} is present but fails to run or hangs (exit ${status}) ✗"
        bashio::log.info "Output of '${tool} --version':"
        head -n 5 <<< "$output"
        return 1
    fi
    local version="${output%%$'\n'*}"
    bashio::log.info "${label} ${3:-installed}: ${version:-(no version output)} ✓"
}

check_node_installation() {
    bashio::log.info "=== Node.js Installation Check ==="

    if ! command -v node >/dev/null 2>&1; then
        bashio::log.error "Node.js not found ✗"
        return 1
    fi
    report_version_check "Node.js" node || return 1

    if ! command -v npm >/dev/null 2>&1; then
        bashio::log.error "npm not found ✗"
        return 1
    fi
    report_version_check "npm" npm || return 1
}

check_claude_cli() {
    bashio::log.info "=== Claude CLI Check ==="

    local claude_path
    if ! claude_path=$(command -v claude 2>/dev/null); then
        bashio::log.error "Claude CLI not found ✗"
        bashio::log.info "Restart the app: it restores the built-in Claude Code."
        return 1
    fi
    bashio::log.info "Claude CLI found at: ${claude_path} ✓"

    if [ ! -x "$claude_path" ]; then
        bashio::log.error "Claude CLI is not executable ✗"
        return 1
    fi

    # On a CPU without x86-64-v2 `claude --version` would only hang until the
    # time limit, so say why instead of running it (cpu-check.sh).
    local missing=""
    if command -v claude_cpu_missing_flags >/dev/null 2>&1; then
        missing=$(claude_cpu_missing_flags)
    fi
    if [ -n "$missing" ]; then
        bashio::log.error "Claude CLI cannot run on this CPU (lacks ${missing}) ✗"
        return 1
    fi

    report_version_check "Claude CLI" "$claude_path" runs
}

# Claude Code hangs without a word on CPUs without x86-64-v2 (cpu-check.sh).
# A warning, not a failure: the shell, ha, gh and packages still work.
check_cpu_compatibility() {
    bashio::log.info "=== CPU Check ==="
    command -v claude_cpu_missing_flags >/dev/null 2>&1 || return 0
    local missing
    missing=$(claude_cpu_missing_flags)
    if [ -n "$missing" ]; then
        bashio::log.warning "CPU lacks ${missing}: Claude Code needs x86-64-v2 (SSE4.2, POPCNT) and will not start."
        bashio::log.warning "Proxmox: set the VM's CPU type to 'host' or 'x86-64-v2-AES' and restart the VM."
    else
        bashio::log.info "CPU meets Claude Code's requirements ✓"
    fi
    return 0
}

check_network_connectivity() {
    bashio::log.info "=== Network Connectivity Check ==="

    # Check DNS resolution first
    if host claude.ai >/dev/null 2>&1 || nslookup claude.ai >/dev/null 2>&1; then
        bashio::log.info "DNS resolution working ✓"
    else
        bashio::log.error "DNS resolution failing - check network configuration"
        bashio::log.info "Try setting custom DNS servers (e.g., 8.8.8.8, 1.1.1.1)"
    fi

    # Try to reach Claude installer endpoint
    if curl -s --head --connect-timeout 10 --max-time 15 https://claude.ai/install.sh > /dev/null; then
        bashio::log.info "Can reach Claude installer ✓"
    else
        bashio::log.warning "Cannot reach Claude installer - this may affect Claude CLI installation"
        bashio::log.info "This could be due to:"
        bashio::log.info "  - Network proxy/firewall blocking access"
        bashio::log.info "  - DNS resolution issues"
        bashio::log.info "  - Slow network connection (try increasing timeout)"
    fi

    # Try to reach GitHub Container Registry
    if curl -s --head --connect-timeout 10 --max-time 15 https://ghcr.io > /dev/null; then
        bashio::log.info "Can reach GitHub Container Registry ✓"
    else
        bashio::log.error "Cannot reach GitHub Container Registry (ghcr.io)"
        bashio::log.info "This is likely the cause of installation failures"
        bashio::log.info "Possible solutions:"
        bashio::log.info "  1. Check if your network blocks ghcr.io"
        bashio::log.info "  2. Try using a VPN or different network"
        bashio::log.info "  3. Check VM network adapter settings"
    fi

    # Try to reach Anthropic API
    if curl -s --head --connect-timeout 10 --max-time 15 https://api.anthropic.com > /dev/null; then
        bashio::log.info "Can reach Anthropic API ✓"
    else
        bashio::log.warning "Cannot reach Anthropic API - this may affect Claude functionality"
    fi
}

run_diagnostics() {
    bashio::log.info "========================================="
    bashio::log.info "Claude Workbench Health Check"
    bashio::log.info "========================================="

    local errors=0

    # Count with an assignment: `check || ((errors++))` evaluates to the old
    # count, 0, on the first failure, so (( )) returned 1 and bashio's errexit
    # ended the script before the other checks and the summary
    # (owine's fork, PR #374; tests/test-health-check.sh).
    check_system_resources || errors=$((errors + 1))
    check_directory_permissions || errors=$((errors + 1))
    check_node_installation || errors=$((errors + 1))
    check_claude_cli || errors=$((errors + 1))
    check_cpu_compatibility
    check_network_connectivity || errors=$((errors + 1))

    bashio::log.info "========================================="

    if [ "$errors" -eq 0 ]; then
        bashio::log.info "✅ All checks passed successfully!"
    else
        bashio::log.error "❌ $errors check(s) failed"
        bashio::log.info "Please review the errors above"

        # Provide VirtualBox-specific advice if relevant
        if [ -f /proc/modules ] && grep -q vboxguest /proc/modules; then
            bashio::log.info ""
            bashio::log.info "=== VirtualBox Environment Detected ==="
            bashio::log.warning "VirtualBox users commonly experience network issues"
            bashio::log.info ""
            bashio::log.info "Required VM settings:"
            bashio::log.info "  • Memory: At least 2GB RAM (4GB recommended)"
            bashio::log.info "  • Storage: At least 8GB disk space"
            bashio::log.info "  • VirtualBox Guest Additions: MUST be installed"
            bashio::log.info ""
            bashio::log.info "Network adapter configuration:"
            bashio::log.info "  • Recommended: Bridged Adapter mode"
            bashio::log.info "  • Alternative: NAT with port forwarding"
            bashio::log.info "  • Ensure 'Cable Connected' is checked"
            bashio::log.info ""
            bashio::log.info "If installation fails with network timeout:"
            bashio::log.info "  1. Try changing VM network adapter to Bridged mode"
            bashio::log.info "  2. Restart the VM after network changes"
            bashio::log.info "  3. Check if your host firewall blocks container registries"
            bashio::log.info "  4. Try installation during off-peak hours (network congestion)"
            bashio::log.info "  5. Consider using Home Assistant on bare metal or Docker instead"
        fi

        # Check for Proxmox environment
        if [ -f /proc/cpuinfo ] && grep -q "QEMU Virtual CPU" /proc/cpuinfo; then
            bashio::log.info ""
            bashio::log.info "=== Virtual Environment Detected (Possibly Proxmox) ==="
            bashio::log.info "If running in Proxmox, ensure:"
            bashio::log.info "  • VM has sufficient resources (2GB+ RAM)"
            bashio::log.info "  • Network device uses VirtIO (recommended)"
            bashio::log.info "  • Firewall rules allow container registry access"
            bashio::log.info "  • DNS is properly configured in the VM"
        fi
    fi

    return $errors
}

# Run if executed directly
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
    run_diagnostics
fi