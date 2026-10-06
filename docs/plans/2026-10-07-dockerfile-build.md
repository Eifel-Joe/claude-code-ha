# Build-Parameter ins Dockerfile, armv7 raus, Doku — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Der Supervisor baut die App ohne `build.yaml` (keine Deprecation-Warnung mehr), nur noch für amd64/aarch64, und die Entwickler-Doku beschreibt den echten Build- und Datenpfad.

**Architecture:** Spec `docs/specs/2026-10-07-dockerfile-build-design.md`. Festes `FROM ghcr.io/home-assistant/base:3.21` plus `LABEL` im Dockerfile, `build.yaml` gelöscht, 32-Bit-Zweige raus. Alle Regeln werden als statische Prüfungen in `tests/test-release-metadata.sh` festgehalten (lokal lauffähig); das Image selbst baut nur die CI.

**Tech Stack:** Dockerfile (BuildKit), Bash-Testskript, GitHub Actions, Markdown.

**Arbeitsregeln:** Branch `chore/dockerfile-build-armv7` (existiert, Spec-Commit `89d6ca9`). Suite: `bash tests/test-release-metadata.sh` (Erfolg: letzte Zeile `Release metadata suite passed (version …)`). Weitere lokale Suiten zur Regression: `bash tests/test-startup-timeouts.sh`, `node tests/test-terminal-clipboard.js`, `PATH="/c/WINDOWS/system32:$PATH" node --test tests/test-app-migration.js`. ShellCheck wie CI: `shellcheck -S warning -e SC1008,SC1007,SC2155 -x claude-terminal/run.sh claude-terminal/scripts/*.sh claude-terminal/scripts/persist-install tests/*.sh`. Kein docker/podman/hadolint lokal → Image-Build und Hadolint nur in der CI. Nach jedem Commit `git ls-files --eol | grep -c "crlf\|mixed"` → `0`. Ergebnisse von Subagenten per `git show` prüfen (Escapes!).

---

### Task 1: Basis-Image und Labels ins Dockerfile, `build.yaml` löschen

**Files:**
- Modify: `tests/test-release-metadata.sh` (Kopfkommentar Z. 4–6; Block Z. 24–26; Block Z. 37–41)
- Modify: `claude-terminal/Dockerfile:1-2`
- Delete: `claude-terminal/build.yaml`
- Modify: `.github/workflows/ci.yml` (Hadolint-Ausnahmen, YAML-Validierung, Build-Matrix, Build-Args)

- [ ] **Step 1: Test anpassen (RED)**

In `tests/test-release-metadata.sh` den Kopfkommentar

```bash
# Enforces the release rule stated in CLAUDE.md: every change ships with a
# version bump and a matching changelog entry. Three files have to agree, and
# nothing checked this before, so they drifted silently.
```

ersetzen durch

```bash
# Enforces the release rule stated in CLAUDE.md: every change ships with a
# version bump and a matching changelog entry. config.yaml and CHANGELOG.md
# have to agree, and nothing checked this before, so they drifted silently.
```

Den Block

```bash
label_version=$(sed -n 's/^ *org.opencontainers.image.version: *"\{0,1\}\([^"]*\)"\{0,1\}$/\1/p' "$addon_dir/build.yaml")
[ "$label_version" = "$config_version" ] || \
    fail "build.yaml image version '$label_version' does not match config.yaml '$config_version'"
```

ersetzen durch

```bash
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
```

Den Block

```bash
# Every architecture the add-on claims must have a base image to build from.
while IFS= read -r arch; do
    grep -q "^  ${arch}: " "$addon_dir/build.yaml" || \
        fail "arch '$arch' is declared in config.yaml but has no build_from in build.yaml"
done < <(sed -n '/^arch:/,/^[a-z]/{s/^  - //p;}' "$addon_dir/config.yaml")
```

ersatzlos löschen (die Arch-Prüfung kommt in Task 2 neu).

- [ ] **Step 2: Test laufen lassen, Fehlschlag prüfen**

Run: `bash tests/test-release-metadata.sh`
Expected: `FAIL (release metadata): claude-terminal/build.yaml exists; build parameters belong in the Dockerfile`, Exit-Code 1.

- [ ] **Step 3: Dockerfile-Kopf ersetzen, `build.yaml` löschen**

`claude-terminal/Dockerfile` Z. 1–2

```dockerfile
ARG BUILD_FROM
FROM ${BUILD_FROM}
```

ersetzen durch

```dockerfile
# Home Assistant's multi-arch Alpine base (amd64 + arm64). Pinned here instead
# of build.yaml, which the Supervisor deprecated. Deliberately no ARG BUILD_FROM:
# older Supervisor versions pass their own default ({arch}-base:latest, the
# newest Alpine) and would silently replace this base through it.
FROM ghcr.io/home-assistant/base:3.21

LABEL \
    org.opencontainers.image.title="Home Assistant Add-on: Claude Terminal" \
    org.opencontainers.image.description="Terminal interface for Anthropic's Claude Code CLI" \
    org.opencontainers.image.source="https://github.com/Eifel-Joe/claude-code-ha" \
    org.opencontainers.image.licenses="MIT"
```

Run: `git rm claude-terminal/build.yaml`

- [ ] **Step 4: CI anpassen**

In `.github/workflows/ci.yml`:

a) Hadolint-Block

```yaml
          # DL3018: Alpine packages are intentionally unpinned; the base image
          #         tag pins the repository snapshot.
          # DL3006: `FROM ${BUILD_FROM}` is required — the Supervisor supplies
          #         the tagged base image as a build argument (see build.yaml).
          # DL3016: the npm fallback deliberately tracks latest on 64-bit; the
          #         32-bit path is pinned, and the lockfile pins the image
          #         service's own dependencies.
          ignore: DL3018,DL3006,DL3016
```

ersetzen durch

```yaml
          # DL3018: Alpine packages are intentionally unpinned; the base image
          #         tag pins the repository snapshot.
          # DL3016: the npm fallback deliberately tracks latest; the lockfile
          #         pins the image service's own dependencies.
          ignore: DL3018,DL3016
```

b) In der YAML-Validierung

```python
          for f in ("claude-terminal/config.yaml", "claude-terminal/build.yaml",
                    "repository.yaml"):
```

ersetzen durch

```python
          for f in ("claude-terminal/config.yaml", "repository.yaml"):
```

c) Build-Matrix

```yaml
          - arch: amd64
            base: ghcr.io/home-assistant/amd64-base:3.21
            platform: linux/amd64
          - arch: aarch64
            base: ghcr.io/home-assistant/aarch64-base:3.21
            platform: linux/arm64
```

ersetzen durch

```yaml
          - arch: amd64
            platform: linux/amd64
          - arch: aarch64
            platform: linux/arm64
```

d) Build-Args

```yaml
          build-args: |
            BUILD_FROM=${{ matrix.base }}
            BUILD_ARCH=${{ matrix.arch }}
```

ersetzen durch

```yaml
          build-args: |
            BUILD_ARCH=${{ matrix.arch }}
```

- [ ] **Step 5: Test laufen lassen (GREEN)**

Run: `bash tests/test-release-metadata.sh`
Expected: `Release metadata suite passed (version 2.2.2)`.
Run: `grep -n "build.yaml\|matrix.base\|DL3006" .github/workflows/ci.yml` → keine Ausgabe.

- [ ] **Step 6: Commit**

```bash
git add tests/test-release-metadata.sh claude-terminal/Dockerfile .github/workflows/ci.yml
git commit -m "build: pin the base image in the Dockerfile, drop build.yaml

The Supervisor warns on every build that build.yaml is deprecated and will
stop reading it. The Dockerfile now names the multi-arch base image itself,
without an ARG an older Supervisor could override, and carries the labels.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(`build.yaml` ist durch `git rm` bereits gestaged.)

---

### Task 2: armv7 entfernen

**Files:**
- Modify: `tests/test-release-metadata.sh` (nach dem `ARG BUILD_FROM`-Block aus Task 1)
- Modify: `claude-terminal/config.yaml:9-12`
- Modify: `claude-terminal/Dockerfile` (Arch-Erkennung, Claude-Code-, HA-CLI-, gh-Installation)

- [ ] **Step 1: Test ergänzen (RED)**

In `tests/test-release-metadata.sh` direkt nach dem `ARG BUILD_FROM`-Block einfügen:

```bash
# The multi-arch base image covers amd64 and arm64 only, and Home Assistant
# ended 32-bit support with 2025.12 (no more app updates there).
while IFS= read -r arch; do
    case "$arch" in
        amd64|aarch64) ;;
        *) fail "config.yaml declares arch '$arch'; only amd64 and aarch64 have a base image" ;;
    esac
done < <(sed -n '/^arch:/,/^[a-z]/{s/^  - //p;}' "$addon_dir/config.yaml")

if grep -nE 'armv7|armhf|armv6|i386|1\.0\.128' "$dockerfile"; then
    fail "Dockerfile still carries 32-bit branches"
fi
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag prüfen**

Run: `bash tests/test-release-metadata.sh`
Expected: `FAIL (release metadata): config.yaml declares arch 'armv7'; only amd64 and aarch64 have a base image`.

- [ ] **Step 3: `config.yaml`**

```yaml
arch:
  - aarch64
  - amd64
  - armv7
```

ersetzen durch

```yaml
arch:
  - aarch64
  - amd64
```

- [ ] **Step 4: Test laufen lassen, nächster Fehlschlag**

Run: `bash tests/test-release-metadata.sh`
Expected: Zeilen mit `armv7`/`armhf`/`i386`/`1.0.128` aus dem Dockerfile, dann `FAIL (release metadata): Dockerfile still carries 32-bit branches`.

- [ ] **Step 5: Dockerfile — Arch-Erkennung**

Den Block vom Kommentar `# Home Assistant Supervisor always passes BUILD_ARCH (amd64|aarch64|armv7|armhf|i386)` bis einschließlich der Zeile `    echo "Resolved add-on architecture: ${ADDON_ARCH} (BUILD_ARCH='${BUILD_ARCH}' TARGETARCH='${TARGETARCH}/${TARGETVARIANT}' uname='$(uname -m)')"` ersetzen durch

```dockerfile
# The Supervisor passes BUILD_ARCH (amd64|aarch64) as a --build-arg. A plain
# `docker build` falls back to BuildKit's TARGETARCH, then to the build host.
# Only 64-bit targets exist: Home Assistant ended 32-bit support with 2025.12,
# and the base image above covers amd64 and arm64 only.
ARG BUILD_ARCH
ARG TARGETARCH

RUN ADDON_ARCH="${BUILD_ARCH}"; \
    if [ -z "${ADDON_ARCH}" ]; then \
        case "${TARGETARCH}" in \
            amd64) ADDON_ARCH="amd64" ;; \
            arm64) ADDON_ARCH="aarch64" ;; \
        esac; \
    fi; \
    if [ -z "${ADDON_ARCH}" ]; then \
        case "$(uname -m)" in \
            x86_64)        ADDON_ARCH="amd64" ;; \
            aarch64|arm64) ADDON_ARCH="aarch64" ;; \
        esac; \
    fi; \
    case "${ADDON_ARCH}" in \
        amd64|aarch64) ;; \
        *) echo "Unsupported architecture (BUILD_ARCH='${BUILD_ARCH}' TARGETARCH='${TARGETARCH}' uname='$(uname -m)'); only amd64 and aarch64 are built" && exit 1 ;; \
    esac; \
    printf '%s\n' "${ADDON_ARCH}" > /etc/addon-arch && \
    echo "Resolved add-on architecture: ${ADDON_ARCH} (BUILD_ARCH='${BUILD_ARCH}' TARGETARCH='${TARGETARCH}' uname='$(uname -m)')"
```

- [ ] **Step 6: Dockerfile — Claude Code**

Den Block vom Kommentar `# Install Claude Code CLI. Current native releases do not publish a 32-bit ARM` bis einschließlich `    fi` (Ende des `RUN`) ersetzen durch

```dockerfile
# Install Claude Code CLI: native latest, npm as fallback.
# install.sh ends by running "claude install", an interactive TUI that never
# finishes without a TTY, so the build hung forever and the npm fallback never
# ran (upstream issue #44). The timeout turns that hang into a failure the ||
# catches; 300s leaves room for the binary download on slow hosts. A
# half-finished native install is removed before the fallback, because run.sh
# links /root/.local/bin/claude onto PATH ahead of the npm binary.
RUN (timeout 300 bash -c "curl -fsSL https://claude.ai/install.sh | bash" \
    && ln -sf /root/.local/bin/claude /usr/local/bin/claude) \
    || { rm -f /root/.local/bin/claude; npm install -g @anthropic-ai/claude-code; }
```

- [ ] **Step 7: Dockerfile — HA-CLI**

Den Block vom Kommentar `# Install Home Assistant CLI (ha command)` bis zur Zeile `    esac && \` des `case` (einschließlich) plus die folgenden drei Zeilen `if [ "${HA_VERSION}" = "latest" ] …` bis `    fi && \` ersetzen durch

```dockerfile
# Install Home Assistant CLI (ha command), latest release. Its asset names use
# the same arch names as the add-on (ha_amd64, ha_aarch64).
RUN HA_ARCH=$(cat /etc/addon-arch) && \
    echo "Fetching latest Home Assistant CLI version..." && \
    HA_VERSION=$(curl -fsSL https://api.github.com/repos/home-assistant/cli/releases/latest | jq -r '.tag_name') && \
```

Die nachfolgenden Zeilen ab `    echo "Installing Home Assistant CLI ${HA_VERSION} for ${HA_ARCH}..." && \` bleiben unverändert.

- [ ] **Step 8: Dockerfile — GitHub CLI**

Den Block vom Kommentar `# Install GitHub CLI (gh command)` bis zur Zeile `    fi && \` nach `GH_VERSION=$(curl … | sed 's/^v//');` ersetzen durch

```dockerfile
# Install GitHub CLI (gh command), latest release.
RUN case "$(cat /etc/addon-arch)" in \
        amd64)   GH_ARCH="amd64" ;; \
        aarch64) GH_ARCH="arm64" ;; \
        *)       echo "Unsupported architecture for gh: $(cat /etc/addon-arch)" && exit 1 ;; \
    esac && \
    echo "Fetching latest GitHub CLI version..." && \
    GH_VERSION=$(curl -fsSL https://api.github.com/repos/cli/cli/releases/latest | jq -r '.tag_name' | sed 's/^v//') && \
```

Die nachfolgenden Zeilen ab `    echo "Installing GitHub CLI v${GH_VERSION} for ${GH_ARCH}..." && \` bleiben unverändert.

- [ ] **Step 9: Test laufen lassen (GREEN) und Sichtprüfung**

Run: `bash tests/test-release-metadata.sh` → `Release metadata suite passed (version 2.2.2)`.
Run: `sed -n 1,130p claude-terminal/Dockerfile` und prüfen: jedes `RUN … \`-Fortsetzungs-Ende sauber, kein verwaistes `fi`/`esac`, `TARGETVARIANT` nirgends mehr (`grep -n TARGETVARIANT claude-terminal/Dockerfile` → leer).

- [ ] **Step 10: Commit**

```bash
git add tests/test-release-metadata.sh claude-terminal/config.yaml claude-terminal/Dockerfile
git commit -m "build: drop armv7

Home Assistant ended 32-bit support with 2025.12: the Supervisor there no
longer fetches app updates, the armv7 base image is frozen and the new
multi-arch base has no armv7 variant. The pinned 32-bit tool versions go
with it.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Entwickler-Doku und Nutzer-Doku

**Files:**
- Modify: `tests/test-release-metadata.sh` (Credential-Pfad-Block am Ende)
- Modify: `DEVELOPMENT.md`, `CLAUDE.md`, `flake.nix`, `README.md`, `claude-terminal/README.md`, `claude-terminal/DOCS.md`
- Delete: `DEVELOPMENT_STATUS.md`, `DOCS.md` (Repo-Root)

- [ ] **Step 1: Test ergänzen (RED)**

In `tests/test-release-metadata.sh` direkt vor `echo "Release metadata suite passed …"` einfügen:

```bash
# Local builds need no build argument any more; docs and tooling that still
# pass the old one send developers to a base image the app no longer uses.
for f in "$repo_root/CLAUDE.md" "$repo_root/DEVELOPMENT.md" "$repo_root/flake.nix" \
         "$repo_root/.github/workflows/ci.yml"; do
    if grep -n 'BUILD_FROM' "$f"; then
        fail "$(basename "$f") still passes BUILD_FROM; the Dockerfile pins the base image"
    fi
done

# The developer guide set up credentials and options under /config; both live
# in /data (credentials in /data/home/.claude, options in /data/options.json).
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
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag prüfen**

Run: `bash tests/test-release-metadata.sh`
Expected: `CLAUDE.md:31:podman build --build-arg BUILD_FROM=…` usw., dann `FAIL (release metadata): CLAUDE.md still passes BUILD_FROM; …`.

- [ ] **Step 3: Dateien löschen**

```bash
git rm DEVELOPMENT_STATUS.md DOCS.md
```

- [ ] **Step 4: `DEVELOPMENT.md`**

Jede Ersetzung exakt:

| Stelle | alt | neu |
|---|---|---|
| Z. 19–20 | `podman build --build-arg BUILD_FROM=ghcr.io/home-assistant/amd64-base:3.21 \`<br>`  -t local/claude-terminal:test ./claude-terminal` | `podman build -t local/claude-terminal:test ./claude-terminal` |
| Z. 22–24 | `# 2. Create test configuration`<br>`mkdir -p /tmp/test-config/claude-config`<br>`echo '{"auto_launch_claude": false}' > /tmp/test-config/options.json` | `# 2. Create test directories. /config is Home Assistant's configuration,`<br>`#    /data is the app's private storage: options.json and credentials`<br>`#    (/data/home/.claude) live there.`<br>`mkdir -p /tmp/test-config /tmp/test-data`<br>`echo '{"auto_launch_claude": false}' > /tmp/test-data/options.json` |
| Z. 32 | `  -v /tmp/test-config:/config \` | `  -v /tmp/test-config:/config \`<br>`  -v /tmp/test-data:/data \` |
| Z. 53–54 | wie Z. 19–20 | `podman build -t local/claude-terminal:test ./claude-terminal` |
| Z. 61 | `  -v /tmp/test-config:/config local/claude-terminal:test` | `  -v /tmp/test-config:/config -v /tmp/test-data:/data local/claude-terminal:test` |
| Z. 89, 92, 94 | `/tmp/test-config/options.json` | `/tmp/test-data/options.json` |
| Z. 100–104 | `# Start with clean credentials`<br>`rm -rf /tmp/test-config/claude-config/*`<br><br>`# Pre-populate credentials for testing`<br>`cp ~/.config/anthropic/* /tmp/test-config/claude-config/` | `# Start with clean credentials`<br>`rm -rf /tmp/test-data/home/.claude`<br><br>`# Pre-populate credentials for testing`<br>`mkdir -p /tmp/test-data/home/.claude`<br>`cp ~/.claude/.credentials.json /tmp/test-data/home/.claude/` |
| Z. 111 | `… -v /tmp/test-config-2:/config local/claude-terminal:test` | `… -v /tmp/test-config-2:/config -v /tmp/test-data-2:/data local/claude-terminal:test` |
| Z. 112 | `… -v /tmp/test-config-3:/config local/claude-terminal:test` | `… -v /tmp/test-config-3:/config -v /tmp/test-data-3:/data local/claude-terminal:test` |
| Z. 144 | `podman exec test-claude-dev ls -la /config/claude-config/` | `podman exec test-claude-dev ls -la /data/home/.claude/` |
| Z. 196 | `… -p 7682:7680 -v /tmp/test-config:/config local/claude-terminal:test` | `… -p 7682:7680 -v /tmp/test-config:/config -v /tmp/test-data:/data local/claude-terminal:test` |
| Z. 202–203 | `mkdir -p /tmp/test-config/claude-config`<br>`chmod 755 /tmp/test-config/claude-config` | `mkdir -p /tmp/test-config /tmp/test-data`<br>`chmod 755 /tmp/test-config /tmp/test-data` |
| Z. 206 | `ls -laZ /tmp/test-config/` | `ls -laZ /tmp/test-config/ /tmp/test-data/` |
| Z. 212–213 | `podman build --no-cache --build-arg BUILD_FROM=ghcr.io/home-assistant/amd64-base:3.21 \`<br>`  -t local/claude-terminal:test ./claude-terminal` | `podman build --no-cache -t local/claude-terminal:test ./claude-terminal` |
| Z. 227 | `rm -rf /tmp/test-config*` | `rm -rf /tmp/test-config* /tmp/test-data*` |
| Z. 249–261 (Code-Block + Satz) | `git add .` … `The changes will automatically be built and distributed to Home Assistant users.` | siehe unten |
| Z. 269–273 | `mkdir -p /tmp/ha-config/{.storage,claude-config}`<br>`echo '{"auto_launch_claude": false}' > /tmp/ha-config/options.json`<br><br>`podman run -d --name test-ha-claude -p 7680:7680 \`<br>`  -v /tmp/ha-config:/config local/claude-terminal:test` | `mkdir -p /tmp/ha-config/.storage /tmp/ha-data`<br>`echo '{"auto_launch_claude": false}' > /tmp/ha-data/options.json`<br><br>`podman run -d --name test-ha-claude -p 7680:7680 \`<br>`  -v /tmp/ha-config:/config -v /tmp/ha-data:/data local/claude-terminal:test` |
| Z. 279–290 | Cross-Platform-Block | siehe unten |

Neuer Inhalt „Production Deployment" (ersetzt den Code-Block Z. 249–259 und den Satz Z. 261):

````markdown
```bash
# Bump the version in claude-terminal/config.yaml and add a matching section
# at the top of claude-terminal/CHANGELOG.md; tests/test-release-metadata.sh
# fails the build if they disagree.
./tests/run-tests.sh

# Stage deliberately and commit on a branch, then open a pull request.
git status
git add <changed files>
git commit
```

Home Assistant rebuilds the app on each device once `version` in `config.yaml` changes.
````

Neuer Inhalt „Cross-Platform Testing" (ersetzt den Code-Block Z. 278–291):

````markdown
```bash
# The base image is multi-arch (amd64, arm64). Home Assistant Supervisor always
# passes BUILD_ARCH; reproduce that locally so the Dockerfile resolves the right
# architecture, and add --platform so the emulated toolchain matches.
podman build --platform linux/arm64 \
  --build-arg BUILD_ARCH=aarch64 \
  -t local/claude-terminal:arm64 ./claude-terminal
```
````

- [ ] **Step 5: `CLAUDE.md`**

| alt | neu |
|---|---|
| `podman build --build-arg BUILD_FROM=ghcr.io/home-assistant/amd64-base:3.21 -t local/claude-terminal-pro ./claude-terminal` | `podman build -t local/claude-terminal-pro ./claude-terminal` |
| `podman run -p 7680:7680 -v $(pwd)/config:/config local/claude-terminal-pro` | `podman run -p 7680:7680 -v $(pwd)/config:/config -v $(pwd)/data:/data local/claude-terminal-pro` |
| `a real multi-arch image build.` | `real image builds for amd64 and aarch64.` |
| `- **config.yaml** - Home Assistant add-on configuration (multi-arch, ingress, ports)` | `- **config.yaml** - Home Assistant add-on configuration (version, arch list, ingress, options)` |
| `- **Dockerfile** - Alpine-based container with Node.js and Claude Code CLI` | `- **Dockerfile** - Alpine-based container with Node.js and Claude Code CLI; pins the base image (\`FROM ghcr.io/home-assistant/base:3.21\`) and the image labels. There is no build.yaml (deprecated by the Supervisor).` |
| `- **build.yaml** - Multi-architecture build configuration (amd64, aarch64, armv7)` | Zeile löschen |
| `4. **Multi-Architecture**: Supports amd64, aarch64, armv7 platforms` | `4. **Architectures**: amd64 and aarch64 (Home Assistant ended 32-bit support with 2025.12)` |
| `podman build --build-arg BUILD_FROM=ghcr.io/home-assistant/amd64-base:3.21 -t local/claude-terminal:test ./claude-terminal` | `podman build -t local/claude-terminal:test ./claude-terminal` |
| `# Create test config directory`<br>`mkdir -p /tmp/test-config/claude-config` | `# Create test directories (/config = HA configuration, /data = app storage)`<br>`mkdir -p /tmp/test-config /tmp/test-data` |
| `echo '{"auto_launch_claude": false}' > /tmp/test-config/options.json` | `echo '{"auto_launch_claude": false}' > /tmp/test-data/options.json` |
| `podman run -d --name test-claude-dev -p 7680:7680 -v /tmp/test-config:/config local/claude-terminal:test` | `podman run -d --name test-claude-dev -p 7680:7680 -v /tmp/test-config:/config -v /tmp/test-data:/data local/claude-terminal:test` |
| `- **Volume contents**: \`ls -la /tmp/test-config/\` to verify persistence` | `- **Volume contents**: \`ls -la /tmp/test-data/\` to verify persistence` |
| `- Requires multi-architecture compatibility` | `- Builds for amd64 and aarch64 only` |

Danach: `grep -n "BUILD_FROM\|build.yaml\|armv7\|test-config/claude-config" CLAUDE.md` → keine Ausgabe außer der neuen Dockerfile-Zeile mit „There is no build.yaml".

- [ ] **Step 6: `flake.nix`**

`alias build-addon='podman build --build-arg BUILD_FROM=ghcr.io/home-assistant/amd64-base:3.21 -t local/claude-terminal ./claude-terminal'`
→ `alias build-addon='podman build -t local/claude-terminal ./claude-terminal'`

- [ ] **Step 7: `README.md`**

a) Badge Z. 6: `arch-amd64%20%7C%20aarch64%20%7C%20armv7-8957e5` → `arch-amd64%20%7C%20aarch64-8957e5`.

b) In „Architecture support" die Zeile `| \`armv7\` | portable JS …` und die drei Fußnoten-Zeilen `¹ …`, `² …`, `³ …` samt der Leerzeile davor löschen. Danach den Satz `The target architecture is resolved from Home Assistant's \`BUILD_ARCH\` build argument, …` ersetzen durch:

```markdown
32-bit systems (armv7, armhf, i386) are not supported: Home Assistant ended support for them with 2025.12, and the Supervisor there no longer offers app updates. Version 2.2.2 was the last release built for armv7.
```

(Der Satz nennt `armv7` bewusst; die Prüfung aus Step 1 testet für `README.md` deshalb nur die Tabellenzeile.)

- [ ] **Step 8: `claude-terminal/README.md`**

- Z. 25: `- **Claude Code CLI**: Latest native release on amd64/aarch64; ARMv7 uses the final portable JavaScript release (\`1.0.128\`) because current native releases do not publish ARM32 binaries` → `- **Claude Code CLI**: Latest native release`
- Z. 30: `- **Multi-Architecture Support**: Works on amd64, aarch64, and armv7 platforms` → `- **Multi-Architecture Support**: Works on amd64 and aarch64`
- „Version History" (v1.0.2 …) bleibt unverändert (Historie).

- [ ] **Step 9: `claude-terminal/DOCS.md`**

- Z. 53: `- **Requires** a claude.ai OAuth login (API keys are not supported) and Claude Code v2.1.51 or later. It is therefore not available on the ARMv7 build, which pins the portable \`1.0.128\` release` → `- **Requires** a claude.ai OAuth login (API keys are not supported) and Claude Code v2.1.51 or later`
- Den Absatz `On ARMv7, use the final portable JavaScript release because current Claude Code` / `native releases do not publish ARM32 binaries:` samt dem folgenden ```` ```bash ```` -Block mit `@1.0.128` und der Leerzeile danach löschen.

- [ ] **Step 10: Test laufen lassen (GREEN)**

Run: `bash tests/test-release-metadata.sh` → `Release metadata suite passed (version 2.2.2)`.
Run: `grep -rn "BUILD_FROM\|claude-config" --include=*.md --include=*.nix --include=*.yml . | grep -v "^./docs/\|CHANGELOG.md"`
Expected: nur die bewusst stehenden Hinweise auf die einmalige Übernahme aus `/config/claude-config` (`CLAUDE.md` Abschnitt „Credential System", `claude-terminal/DOCS.md`), kein `BUILD_FROM`.
Run: `ls DEVELOPMENT_STATUS.md DOCS.md` → beide „No such file or directory".

- [ ] **Step 11: Commit**

```bash
git add tests/test-release-metadata.sh DEVELOPMENT.md CLAUDE.md flake.nix README.md claude-terminal/README.md claude-terminal/DOCS.md
git commit -m "docs: build without BUILD_FROM, test data under /data, drop armv7

The developer guide and project notes still passed the removed build
argument and set up credentials in /config/claude-config. Credentials and
options live in /data. DEVELOPMENT_STATUS.md and the root DOCS.md were
stale, unlinked copies and are removed.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Release 2.3.0 vorbereiten

**Files:**
- Modify: `claude-terminal/config.yaml` (`version`)
- Modify: `claude-terminal/CHANGELOG.md` (oben)
- Modify: `README.md` (Versions-Badge Z. 3)
- Create: `docs/release-notes-2.3.0.md`

- [ ] **Step 1: Version bumpen (RED)**

`claude-terminal/config.yaml`: `version: "2.2.2"` → `version: "2.3.0"`.
Run: `bash tests/test-release-metadata.sh`
Expected: `FAIL (release metadata): CHANGELOG.md has no '## 2.3.0' section for the current version`.

- [ ] **Step 2: CHANGELOG oben einfügen**

```markdown
## 2.3.0

### 🔧 Technical - Build parameters moved into the Dockerfile
- The Supervisor warned on every install and update that `build.yaml` is
  deprecated and will stop reading it. The Dockerfile now names the base image
  (`ghcr.io/home-assistant/base:3.21`, multi-arch) and the image labels itself;
  `build.yaml` is gone. Nothing changes in how the app runs.

### 🔧 Technical - armv7 is no longer built (breaking for 32-bit systems)
- Home Assistant ended support for 32-bit systems with 2025.12; the Supervisor
  there no longer offers app updates, and the new base image has no armv7
  variant. 2.2.2 stays the last release for armv7; existing installations keep
  running on it.
- The pinned 32-bit tool versions (Claude Code 1.0.128, HA CLI 4.46.0, gh armv6)
  are removed from the image build.

### 📚 Documentation
- The development guide and project notes build without a base-image argument
  and keep test options and credentials under `/data`, where the app reads them.
  The stale `DEVELOPMENT_STATUS.md` and an unlinked old copy of `DOCS.md` are
  removed.

```

- [ ] **Step 3: README-Versions-Badge**

`README.md` Z. 3: `badge/version-2.2.0-1f6feb` → `badge/version-2.3.0-1f6feb`.

- [ ] **Step 4: Release-Notes**

`docs/release-notes-2.3.0.md`:

```markdown
## Build parameters moved into the Dockerfile

The Supervisor warned on every install and update that `build.yaml` is deprecated. The Dockerfile now names the base image (`ghcr.io/home-assistant/base:3.21`) and the labels itself, and `build.yaml` is gone. Nothing changes in how the app runs.

## armv7 is no longer built

Home Assistant ended support for 32-bit systems with 2025.12, and the Supervisor there no longer offers app updates. 2.2.2 stays the last release for armv7; existing installations keep running on it.

## Documentation
- The development guide builds without a base-image argument and keeps test options and credentials under `/data`.

Full details: [CHANGELOG](https://github.com/Eifel-Joe/claude-code-ha/blob/main/claude-terminal/CHANGELOG.md).
```

- [ ] **Step 5: Alle lokalen Suiten**

```bash
bash tests/test-release-metadata.sh
bash tests/test-startup-timeouts.sh
node tests/test-terminal-clipboard.js
PATH="/c/WINDOWS/system32:$PATH" node --test tests/test-app-migration.js
shellcheck -S warning -e SC1008,SC1007,SC2155 -x claude-terminal/run.sh claude-terminal/scripts/*.sh claude-terminal/scripts/persist-install tests/*.sh
git ls-files --eol | grep -c "crlf\|mixed"
```

Expected: `Release metadata suite passed (version 2.3.0)`, `Startup timeout suite passed`, Clipboard-Suite ohne Fehler, Migrationstests `# fail 0`, ShellCheck ohne Ausgabe, `0`.

- [ ] **Step 6: Commit**

```bash
git add claude-terminal/config.yaml claude-terminal/CHANGELOG.md README.md docs/release-notes-2.3.0.md
git commit -m "release: 2.3.0

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Review, CI, HA-Test, Release (mit Freigaben)

- [ ] **Step 1: Code-Review** per Subagent (`superpowers:requesting-code-review`) gegen Spec und Plan, Diff `main..chore/dockerfile-build-armv7`. Befunde über `superpowers:receiving-code-review` prüfen.
- [ ] **Step 2: Push** des Branches — **nur nach Freigabe im Chat**. Dann CI: `gh run list --repo Eifel-Joe/claude-code-ha --branch chore/dockerfile-build-armv7 --limit 1` und `gh run view <id> --repo Eifel-Joe/claude-code-ha`. Erwartet: Lint (inkl. Hadolint ohne DL3006), Regression suites, Build amd64 und Build aarch64 grün. Scheitert Hadolint an DL3006: Ausnahme mit korrigiertem Kommentar zurück (Spec erlaubt das).
- [ ] **Step 3: Merge nach `main`** (`--no-ff`, wie bisher) und Push — **nur nach Freigabe**.
- [ ] **Step 4: HA-Test**: Zeitpunkt notieren, Update auf 2.3.0 per MCP (bei „Request timed out" Supervisor-Log prüfen, nicht erneut auslösen). Prüfen:
  - `ha_get_logs(source="system_service", slug="supervisor", search="build.yaml")` → kein Eintrag nach dem Update-Zeitpunkt (Gegenprobe: 2026-10-06 17:45:31).
  - App `state: started`, Version 2.3.0.
  - App-Log ohne Fehler; im Terminal `claude --version` (User oder per Log „Claude Code … installed").
- [ ] **Step 5: Tag `v2.3.0` und GitHub-Release** mit `docs/release-notes-2.3.0.md` — **Text vorher im Chat zeigen, nur nach Freigabe**.
- [ ] **Step 6: Abschluss**: Memory `claude-code-ha-followups` aktualisieren (Punkte 5, 6, 8 erledigt; neue Punkte: Mac-Clipboard-Monitor `:8123/upload` über Ingress ungeprüft; verwaiste `config/scripts/claude-session-picker.sh`), `docs/SESSION-STAND.md` ergänzen, Plan-Checkboxen abhaken.
