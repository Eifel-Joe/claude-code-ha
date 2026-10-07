#!/usr/bin/env bash
set -euo pipefail

# Enforces the release rule stated in CLAUDE.md: every change ships with a
# version bump and a matching changelog entry. config.yaml and CHANGELOG.md
# have to agree, and nothing checked this before, so they drifted silently.

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
addon_dir="$repo_root/claude-workbench"

fail() {
    echo "FAIL (release metadata): $*" >&2
    exit 1
}

config_version=$(sed -n 's/^version: *"\{0,1\}\([^"]*\)"\{0,1\}$/\1/p' "$addon_dir/config.yaml")
[ -n "$config_version" ] || fail "could not read version from config.yaml"

case "$config_version" in
    [0-9]*.[0-9]*.[0-9]*) ;;
    *) fail "config.yaml version '$config_version' is not semver" ;;
esac

# build.yaml is deprecated: the Supervisor warns on every build and will stop
# reading it. The Dockerfile carries the base image and labels, the version
# lives only in config.yaml (the Supervisor labels the image with it).
[ ! -e "$addon_dir/build.yaml" ] || \
    fail "claude-workbench/build.yaml exists; build parameters belong in the Dockerfile"

dockerfile="$addon_dir/Dockerfile"
# Dockerfile keywords are case-insensitive; a second stage would make the final
# image something other than the pinned base.
from_lines=$(grep -iE '^[[:space:]]*FROM[[:space:]]' "$dockerfile" || true)
[ "$(printf '%s\n' "$from_lines" | grep -c .)" -eq 1 ] || \
    fail "Dockerfile must have exactly one FROM; found: $(printf '%s' "$from_lines" | tr '\n' '|')"
printf '%s\n' "$from_lines" | grep -qE '^FROM ghcr\.io/home-assistant/base:[0-9]+\.[0-9]+' || \
    fail "Dockerfile must start from a tagged ghcr.io/home-assistant/base image"
# Without build.yaml, older Supervisor versions still pass BUILD_FROM
# ({arch}-base:latest, the newest Alpine). An ARG would let that replace the
# pinned base without anyone noticing.
if grep -niE '^[[:space:]]*ARG[[:space:]]+BUILD_FROM' "$dockerfile"; then
    fail "Dockerfile declares ARG BUILD_FROM; a Supervisor-supplied value would swap the base image"
fi

# The multi-arch base image covers amd64 and arm64 only, and Home Assistant
# ended 32-bit support with 2025.12 (no more app updates there). The list must
# be in block form ("  - amd64"): a flow list would slip past this check, so an
# empty result fails too.
arches=$(sed -n '/^arch:/,/^[a-z]/{s/^  - //p;}' "$addon_dir/config.yaml")
[ -n "$arches" ] || \
    fail "config.yaml has no arch list in block form (\"  - amd64\")"
while IFS= read -r arch; do
    case "$arch" in
        amd64|aarch64) ;;
        *) fail "config.yaml declares arch '$arch'; only amd64 and aarch64 have a base image" ;;
    esac
done <<< "$arches"

if grep -nE 'armv7|armhf|armv6|i386|1\.0\.128' "$dockerfile"; then
    fail "Dockerfile still carries 32-bit branches"
fi

# The runtime scripts had their own 32-bit branches and pins (Claude 1.0.128,
# HA CLI 4.46.0); with only 64-bit images they are dead code at best, and the
# HA CLI pin downgraded `persist-install --ha-cli --force` on every arch.
if grep -rniE 'armv7|armv6|armhf|i386|i686|1\.0\.128|4\.46\.0' \
        "$addon_dir/run.sh" "$addon_dir/scripts"; then
    fail "run.sh or scripts/ still carry 32-bit branches or pins"
fi

grep -qx "## $config_version" "$addon_dir/CHANGELOG.md" || \
    fail "CHANGELOG.md has no '## $config_version' section for the current version"

# The newest changelog section must be the current version, so a bump cannot
# land with its notes buried under an older release.
newest=$(grep -m1 '^## ' "$addon_dir/CHANGELOG.md" | sed 's/^## //')
[ "$newest" = "$config_version" ] || \
    fail "newest CHANGELOG entry is '$newest' but config.yaml is at '$config_version'"

# The README version badge drifted before (it showed 2.2.0 while 2.2.2 shipped).
grep -q "badge/version-${config_version}-" "$repo_root/README.md" || \
    fail "README.md version badge does not show $config_version"

# Publishing a host port would bypass Home Assistant ingress authentication and
# expose ttyd's unauthenticated root shell on the LAN. Keep that closed.
if grep -qE '^\s+[0-9]+/tcp: *[0-9]+' "$addon_dir/config.yaml"; then
    fail "config.yaml publishes a host port; ttyd runs --writable with no auth, use ingress only"
fi

grep -q 'interface 127.0.0.1' "$addon_dir/run.sh" || \
    fail "ttyd must bind 127.0.0.1 only; it runs --writable with no credentials"

# Credentials live in the app's private /data (HOME=/data/home). The store page
# and the project instructions kept naming /config/claude-config/.
for doc in "$addon_dir/README.md" "$repo_root/CLAUDE.md"; do
    if grep -nE '(stored|storage|saved)[^.]*/config/claude-config|=/config/claude-config' "$doc"; then
        fail "$(basename "$doc") names /config/claude-config as where credentials live; they are in /data/home/.claude"
    fi
done

# Local builds need no build argument any more; docs and tooling that still
# pass the old one send developers to a base image the app no longer uses.
for f in "$repo_root/CLAUDE.md" "$repo_root/DEVELOPMENT.md" "$repo_root/flake.nix" \
         "$repo_root/.github/workflows/ci.yml"; do
    if grep -n 'BUILD_FROM' "$f"; then
        fail "$(basename "$f") still passes BUILD_FROM; the Dockerfile pins the base image"
    fi
done

# The developer guide set up credentials under /config/claude-config; they live
# in the app's private /data (/data/home/.claude).
if grep -n 'claude-config' "$repo_root/DEVELOPMENT.md"; then
    fail "DEVELOPMENT.md still uses /config/claude-config; credentials live in /data/home/.claude"
fi

# README keeps one sentence saying armv7 is unsupported, so only its
# architecture table is checked; DOCS.md must not mention armv7 at all.
if grep -nE '^\| `armv7`' "$repo_root/README.md"; then
    fail "README.md still lists armv7 in the architecture table"
fi
if grep -niE 'armv7' "$addon_dir/DOCS.md"; then
    fail "DOCS.md still describes armv7, which is no longer built"
fi

# Release versions come from github.com's releases/latest redirect. The REST
# API allows 60 unauthenticated requests per hour per IP; a CI image build
# failed on its 403 (run 37584251742).
for f in "$addon_dir/Dockerfile" "$addon_dir/scripts/persist-install"; do
    if grep -n 'api\.github\.com' "$f"; then
        fail "$(basename "$f") queries api.github.com; read the tag from the releases/latest redirect"
    fi
done

# The Mac clipboard monitor uploaded to <host>:8123/upload (HA Core, not the
# app) or the direct port that 2.1.0 closed; pasting into the terminal
# replaces it.
for f in mac-clipboard-monitor.py MAC_CLIPBOARD_MONITOR.md; do
    [ ! -e "$repo_root/$f" ] || fail "$f is back; it cannot reach the app since 2.1.0"
done

# Claude Workbench is an app of its own (spec 2026-10-07-claude-workbench-rename):
# own name, slug and repository, so it is not mistaken for ESJavadex's
# Claude Terminal Pro. The takeover keeps finding *_claude_terminal_pro apps.
config_field() {
    sed -n "s/^$1: *\"\{0,1\}\([^\"]*\)\"\{0,1\}\$/\1/p" "$addon_dir/config.yaml"
}
new_repo_url="https://github.com/Eifel-Joe/claude-workbench"
[ "$(config_field name)" = "Claude Workbench" ] || \
    fail "config.yaml name is '$(config_field name)', expected 'Claude Workbench'"
[ "$(config_field slug)" = "claude_workbench" ] || \
    fail "config.yaml slug is '$(config_field slug)', expected 'claude_workbench'"
[ "$(config_field panel_title)" = "Claude Workbench" ] || \
    fail "config.yaml panel_title is '$(config_field panel_title)', expected 'Claude Workbench'"
[ "$(config_field url)" = "$new_repo_url" ] || \
    fail "config.yaml url is '$(config_field url)', expected $new_repo_url"
grep -qx "url: $new_repo_url" "$repo_root/repository.yaml" || \
    fail "repository.yaml does not point to $new_repo_url"
grep -qx 'name: Claude Workbench for Home Assistant' "$repo_root/repository.yaml" || \
    fail "repository.yaml name is not 'Claude Workbench for Home Assistant'"
grep -q 'image.title="Home Assistant App: Claude Workbench"' "$dockerfile" || \
    fail "Dockerfile image.title label does not name Claude Workbench"
grep -q "image.source=\"$new_repo_url\"" "$dockerfile" || \
    fail "Dockerfile image.source label does not point to $new_repo_url"

# The app calls itself Claude Workbench. "Claude Terminal" stays only where the
# old app is meant ("another Claude Terminal Pro app", the takeover code).
if grep -rn 'Claude Terminal' "$addon_dir/run.sh" "$addon_dir/scripts" \
        "$addon_dir/image-service/server.js" "$addon_dir/image-service/public" \
        --exclude-dir=app-migration | grep -v 'Claude Terminal Pro app'; then
    fail "the app still calls itself Claude Terminal (see lines above)"
fi
grep -q '"name": "claude-workbench-image-service"' "$addon_dir/image-service/package.json" || \
    fail "image-service/package.json is not named claude-workbench-image-service"

echo "Release metadata suite passed (version $config_version)"
