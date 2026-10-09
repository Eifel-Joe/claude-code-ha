#!/usr/bin/env bash
set -euo pipefail

# The auth helper wrote the login code to /tmp/claude-auth-code, which nothing
# read, and deleted /config/auth-code.txt only after Claude had run. /config is
# in every Home Assistant backup, so the file goes before Claude starts.

repo_root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
tmp_dir=$(mktemp -d)
trap 'rm -rf "$tmp_dir"' EXIT

fail() {
    echo "FAIL (auth helper): $*" >&2
    exit 1
}

helper="$repo_root/claude-workbench/scripts/claude-auth-helper.sh"
bin="$tmp_dir/bin"
mkdir -p "$bin"
# Stub claude: records whether the code file still exists, then the code it got.
cat > "$bin/claude" << 'STUB_EOF'
#!/bin/sh
if [ -e "$CLAUDE_AUTH_CODE_FILE" ]; then echo present; else echo absent; fi > "$CLAUDE_STUB_LOG"
cat >> "$CLAUDE_STUB_LOG"
STUB_EOF
printf '#!/bin/sh\n' > "$bin/clear"
chmod +x "$bin/claude" "$bin/clear"

export CLAUDE_AUTH_CODE_FILE="$tmp_dir/auth-code.txt"
export CLAUDE_STUB_LOG="$tmp_dir/claude.log"

# Option 2: read the code from the file.
printf 'secret-code\n' > "$CLAUDE_AUTH_CODE_FILE"
printf '2\n' | PATH="$bin:$PATH" timeout 30 bash "$helper" > "$tmp_dir/out" 2>&1 || \
    fail "helper did not finish: $(cat "$tmp_dir/out")"
[ -f "$CLAUDE_STUB_LOG" ] || fail "claude was not started: $(cat "$tmp_dir/out")"
[ "$(head -n 1 "$CLAUDE_STUB_LOG")" = absent ] || \
    fail "the code file still existed while Claude ran"
grep -qx 'secret-code' "$CLAUDE_STUB_LOG" || fail "claude did not get the code"
[ ! -e "$CLAUDE_AUTH_CODE_FILE" ] || fail "the code file was not removed"

# Option 1: typed code goes to Claude and nowhere else.
rm -f "$CLAUDE_STUB_LOG"
printf '1\nmanual-code\n' | PATH="$bin:$PATH" timeout 30 bash "$helper" > "$tmp_dir/out" 2>&1 || \
    fail "helper did not finish: $(cat "$tmp_dir/out")"
grep -qx 'manual-code' "$CLAUDE_STUB_LOG" || fail "claude did not get the typed code"
if grep -q '/tmp/claude-auth-code' "$helper"; then
    fail "the helper still writes the code to /tmp/claude-auth-code"
fi

echo "Auth helper suite passed"
