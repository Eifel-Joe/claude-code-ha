#!/usr/bin/env bash
set -euo pipefail

# Regression suite for persist-install --python: a failing pip (or venv setup)
# must make the script exit non-zero. It used to end with an `echo`, so the app
# migration recorded packages as installed although pip had failed.

repo_root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
tmp_dir=$(mktemp -d)
trap 'rm -rf "$tmp_dir"' EXIT

fail() {
    echo "FAIL (persist-install): $*" >&2
    exit 1
}

script="$repo_root/claude-terminal/scripts/persist-install"
fake_bin="$tmp_dir/bin"
pip_log="$tmp_dir/pip.log"
mkdir -p "$fake_bin"

# Fake pip: logs its arguments; the self-upgrade always succeeds, the real
# install exits with $FAKE_PIP_STATUS.
cat > "$fake_bin/pip" <<PIP
#!/bin/sh
printf '%s\n' "\$*" >> "$pip_log"
case "\$*" in
    *--upgrade\ pip*) exit 0 ;;
esac
exit "\${FAKE_PIP_STATUS:-0}"
PIP
chmod +x "$fake_bin/pip"

# Fake python3 for the "no venv yet" case: venv creation fails.
cat > "$fake_bin/python3" <<'PY'
#!/bin/sh
exit 1
PY
chmod +x "$fake_bin/python3"

# A data root whose venv already exists (activate is sourced, so keep it empty).
make_data_root() {
    local root="$1"
    mkdir -p "$root/packages/python/venv/bin"
    : > "$root/packages/python/venv/bin/python"
    : > "$root/packages/python/venv/bin/activate"
}

run_persist_install() {
    local root="$1" status="$2"
    shift 2
    PATH="$fake_bin:$PATH" PERSIST_DATA_ROOT="$root" FAKE_PIP_STATUS="$status" \
        bash "$script" "$@" > "$tmp_dir/out.log" 2>&1
}

# pip fails -> non-zero
make_data_root "$tmp_dir/data-fail"
: > "$pip_log"
if run_persist_install "$tmp_dir/data-fail" 1 --python foo; then
    fail "exit 0 although pip install failed: $(cat "$tmp_dir/out.log")"
fi
grep -qx 'install foo' "$pip_log" || fail "pip install foo was not called: $(cat "$pip_log")"
grep -q '❌' "$tmp_dir/out.log" || fail "no error message when pip failed: $(cat "$tmp_dir/out.log")"

# pip succeeds -> zero
make_data_root "$tmp_dir/data-ok"
: > "$pip_log"
run_persist_install "$tmp_dir/data-ok" 0 --python foo || \
    fail "non-zero exit although pip install succeeded: $(cat "$tmp_dir/out.log")"
grep -qx 'install foo' "$pip_log" || fail "pip install foo was not called: $(cat "$pip_log")"

# no venv yet and `python3 -m venv` fails -> non-zero, pip never runs
mkdir -p "$tmp_dir/data-novenv"
: > "$pip_log"
if run_persist_install "$tmp_dir/data-novenv" 0 --python foo; then
    fail "exit 0 although creating the venv failed: $(cat "$tmp_dir/out.log")"
fi
[ ! -s "$pip_log" ] || fail "pip ran although the venv could not be created: $(cat "$pip_log")"

echo "persist-install tests passed"
