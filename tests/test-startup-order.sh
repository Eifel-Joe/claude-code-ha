#!/usr/bin/env bash
set -euo pipefail

# The image service is the ingress entry point. It used to start inside
# start_web_terminal, after Claude Code's update and the package installs, so
# Home Assistant showed a bare 502 for as long as those took (23 s on a real
# install, minutes on a slow link). It now starts right after the environment
# and the required tools are in place.

repo_root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
run_sh="$repo_root/claude-workbench/run.sh"

fail() {
    echo "FAIL (startup order): $*" >&2
    exit 1
}

main_body=$(sed -n '/^main() {/,/^}/p' "$run_sh")
line_of() {
    printf '%s\n' "$main_body" | grep -nx "    $1" | cut -d: -f1
}

for step in run_health_check install_tools start_image_service setup_persistent_claude \
        setup_persistent_packages start_web_terminal; do
    [ -n "$(line_of "$step")" ] || fail "main() does not call $step"
done

[ "$(line_of install_tools)" -lt "$(line_of start_image_service)" ] || \
    fail "the image service needs curl from install_tools for its readiness check"
[ "$(line_of start_image_service)" -lt "$(line_of setup_persistent_claude)" ] || \
    fail "the image service must start before Claude Code's update"
[ "$(line_of start_image_service)" -lt "$(line_of setup_persistent_packages)" ] || \
    fail "the image service must start before the package installs"
# The health check's network probes run up to three 15 s curls; offline, the
# panel would stay a bare 502 for that long if they ran first.
[ "$(line_of start_image_service)" -lt "$(line_of run_health_check)" ] || \
    fail "the image service must start before the health check's network probes"

if sed -n '/^start_web_terminal() {/,/^}/p' "$run_sh" | grep -q 'start_image_service'; then
    fail "start_web_terminal still starts the image service"
fi

echo "Startup order suite passed"
