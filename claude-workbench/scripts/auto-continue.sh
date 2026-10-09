#!/usr/bin/env bash
# auto-continue: switch auto-continue after a usage limit on or off while the
# app runs, or show what the image service has planned. The switch is a file
# the image service re-reads every 30 seconds (image-service/auto-continue.js);
# after a restart the option auto_continue applies again.
set -euo pipefail

dir="${AUTO_CONTINUE_DIR:-/run/claude-workbench}"
state_file="$dir/auto-continue"
status_file="$dir/auto-continue.status"

usage() {
    cat << 'EOF'
Usage: auto-continue on|off|status

  on      type "continue" into Claude one minute after a usage limit resets
  off     stop that; anything already planned is dropped
  status  show the switch and what is planned (default)
EOF
}

case "${1:-status}" in
    on|off)
        mkdir -p "$dir"
        printf '%s\n' "$1" > "$state_file"
        # The service's report describes the old switch until its next check.
        rm -f "$status_file"
        echo "Auto-continue is now $1 (the image service picks it up within 30 seconds)."
        ;;
    status)
        if [ -f "$status_file" ]; then
            cat "$status_file"
        else
            state=$(cat "$state_file" 2>/dev/null || echo off)
            echo "Auto-continue: ${state}"
            echo "No report from the image service yet."
        fi
        ;;
    -h|--help|help)
        usage
        ;;
    *)
        usage >&2
        exit 2
        ;;
esac
