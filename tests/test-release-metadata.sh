#!/usr/bin/env bash
set -euo pipefail

# Enforces the release rule stated in CLAUDE.md: every change ships with a
# version bump and a matching changelog entry. config.yaml and CHANGELOG.md
# have to agree, and nothing checked this before, so they drifted silently.

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
addon_dir="$repo_root/claude-terminal"

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
    fail "claude-terminal/build.yaml exists; build parameters belong in the Dockerfile"

dockerfile="$addon_dir/Dockerfile"
grep -qE '^FROM ghcr\.io/home-assistant/base:[0-9]+\.[0-9]+' "$dockerfile" || \
    fail "Dockerfile must start from a tagged ghcr.io/home-assistant/base image"
# Without build.yaml, older Supervisor versions still pass BUILD_FROM
# ({arch}-base:latest, the newest Alpine). An ARG would let that replace the
# pinned base without anyone noticing.
if grep -nE '^ARG BUILD_FROM' "$dockerfile"; then
    fail "Dockerfile declares ARG BUILD_FROM; a Supervisor-supplied value would swap the base image"
fi

grep -qx "## $config_version" "$addon_dir/CHANGELOG.md" || \
    fail "CHANGELOG.md has no '## $config_version' section for the current version"

# The newest changelog section must be the current version, so a bump cannot
# land with its notes buried under an older release.
newest=$(grep -m1 '^## ' "$addon_dir/CHANGELOG.md" | sed 's/^## //')
[ "$newest" = "$config_version" ] || \
    fail "newest CHANGELOG entry is '$newest' but config.yaml is at '$config_version'"

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

echo "Release metadata suite passed (version $config_version)"
