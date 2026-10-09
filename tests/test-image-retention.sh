#!/usr/bin/env bash
set -euo pipefail

# Pasted and dropped images land in /data/images and went into every backup of
# the app; nothing ever removed one. run.sh now deletes the image service's own
# pasted-* files older than image_retention_days on start. Anything it cannot
# read as a whole number deletes nothing.

repo_root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
tmp_dir=$(mktemp -d)
trap 'rm -rf "$tmp_dir"' EXIT

fail() {
    echo "FAIL (image retention): $*" >&2
    exit 1
}

log="$tmp_dir/log"
: > "$log"
bashio::log.info() { printf 'info|%s\n' "$*" >> "$log"; }
bashio::log.warning() { printf 'warning|%s\n' "$*" >> "$log"; }
bashio::log.error() { printf 'error|%s\n' "$*" >> "$log"; }
config_days=30
bashio::config() {
    case "$1" in
        image_retention_days) printf '%s\n' "$config_days" ;;
        *) printf '%s\n' "${2:-}" ;;
    esac
}

export IMAGE_UPLOAD_DIR="$tmp_dir/images"
run_sh="$repo_root/claude-workbench/run.sh"
# shellcheck disable=SC2034  # read by the sourced run.sh
CLAUDE_RUN_SH_SKIP_MAIN=true
# shellcheck source=/dev/null
source "$run_sh"

command -v prune_uploaded_images >/dev/null 2>&1 || fail "run.sh has no prune_uploaded_images"

d="$IMAGE_UPLOAD_DIR"
setup_images() {
    rm -rf "$d"
    mkdir -p "$d/sub"
    touch -d '40 days ago' "$d/pasted-old.png" "$d/notes-old.txt" "$d/sub/pasted-nested.png"
    touch -d '29 days ago' "$d/pasted-29d.png"
    touch "$d/pasted-new.png"
}

# 30 days: only the old pasted image goes.
setup_images
: > "$log"
config_days=30
prune_uploaded_images
[ ! -e "$d/pasted-old.png" ] || fail "a 40-day-old pasted image was kept"
for keep in pasted-new.png pasted-29d.png notes-old.txt sub/pasted-nested.png; do
    [ -e "$d/$keep" ] || fail "$keep must not be deleted"
done
grep -q '^info|Removed 1 uploaded image(s) older than 30 day(s)' "$log" || \
    fail "the removal was not logged: $(cat "$log")"

# 0 keeps everything; values that are not whole numbers delete nothing.
for value in 0 '' abc -1 '3 0' 1.5 3651 4294967297; do
    setup_images
    config_days="$value"
    prune_uploaded_images || fail "value '$value' made prune_uploaded_images fail"
    [ -e "$d/pasted-old.png" ] || fail "value '$value' deleted an image"
done

# Above the schema's limit of 3650 the value is refused, not passed on: BusyBox
# find keeps -mtime in 32 bits, so 4294967297 would wrap to +0 and delete every
# image older than a day (GNU find here would not show it).
for value in 3651 4294967297; do
    : > "$log"
    config_days="$value"
    prune_uploaded_images
    grep -q "^warning|image_retention_days '$value'" "$log" || \
        fail "value '$value' above 3650 was not refused: $(cat "$log")"
done

# No upload folder yet: nothing to do, no error.
rm -rf "$d"
config_days=30
prune_uploaded_images || fail "a missing upload folder made prune_uploaded_images fail"

# A failing find must not stop the app from starting (run.sh runs under set -e).
# Called plainly, not in `|| fail`: that would switch errexit off inside the
# function and hide the abort. Under this script's set -e a failure ends the test.
setup_images
: > "$log"
config_days=30
find() { return 1; }
prune_uploaded_images
unset -f find
grep -q '^warning|' "$log" || fail "a failing find was not logged"

# The schema caps the option where the code does.
grep -qx '  image_retention_days: int(0,3650)?' "$repo_root/claude-workbench/config.yaml" || \
    fail "config.yaml must cap image_retention_days at 3650"

# Wiring.
sed -n '/^main() {/,/^}/p' "$run_sh" | grep -qx '    prune_uploaded_images' || \
    fail "main() does not call prune_uploaded_images"

echo "Image retention suite passed"
