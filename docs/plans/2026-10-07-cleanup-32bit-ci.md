# Verwaiste Dateien, 32-Bit-Reste, CI auf Node 24 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keine 32-Bit-Reste und keine verwaisten Skripte mehr im Image, `persist-install --ha-cli --force` installiert die aktuelle HA-CLI, die CI läuft warnungsfrei auf Node-24-Actions und testet mit der Node-Version des Images.

**Architecture:** Spec `docs/specs/2026-10-07-cleanup-32bit-ci-design.md`. Regressionsschutz als statische Prüfung in `tests/test-release-metadata.sh`, Verhalten von `install_ha_cli` in `tests/test-persist-install.sh` mit gefälschtem `curl`. CI-Änderungen werden durch die CI selbst belegt.

**Tech Stack:** Bash, GitHub Actions.

**Arbeitsregeln:**
- Branch `chore/cleanup-32bit-ci` (Spec-Commit `2b4b2aa`).
- **Temporäre Dateien nur unter `.tmp/` im Projekt, nie auf C:.** Jede lokale Testausführung mit
  `export TMPDIR=/d/Entwicklung/Claude-Code-HA/.tmp TMP='D:\Entwicklung\Claude-Code-HA\.tmp' TEMP='D:\Entwicklung\Claude-Code-HA\.tmp'` davor.
- Hilfsskripte für Mehrzeilen-Ersetzungen mit dem Write-Tool nach `.tmp/` (Heredocs im Bash-Tool verstümmeln Backslashes).
- Suiten: `bash tests/test-release-metadata.sh`, `bash tests/test-persist-install.sh`, `bash tests/test-startup-timeouts.sh`, `node tests/test-terminal-clipboard.js`, `PATH="/c/WINDOWS/system32:$PATH" node --test tests/test-app-migration.js`, ShellCheck wie CI.
- Nach jedem Commit `git ls-files --eol | grep -c "crlf\|mixed"` → `0`.

---

### Task 1: `persist-install --ha-cli` holt die aktuelle Version

**Files:**
- Modify: `tests/test-persist-install.sh` (vor `echo "persist-install tests passed"`)
- Modify: `claude-terminal/scripts/persist-install` (`install_ha_cli`, Z. 184–217)

- [ ] **Step 1: Test ergänzen (RED)** — vor der letzten Zeile `echo "persist-install tests passed"` einfügen:

```bash
# --- persist-install --ha-cli -------------------------------------------------
# The CLI comes from the latest GitHub release, like the Dockerfile. A pinned
# 4.46.0 once downgraded it: the copy in /data/packages/bin sits in PATH ahead
# of the newer one shipped in the image.
curl_log="$tmp_dir/curl.log"
cat > "$fake_bin/curl" <<CURL
#!/bin/sh
printf '%s\n' "\$*" >> "$curl_log"
out=""
prev=""
for arg in "\$@"; do
    [ "\$prev" = "-o" ] && out="\$arg"
    prev="\$arg"
done
if [ -n "\$out" ]; then
    head -c 1100000 /dev/zero > "\$out"
    exit 0
fi
[ "\${FAKE_API_STATUS:-0}" -eq 0 ] || exit "\$FAKE_API_STATUS"
printf '%s' "\${FAKE_API_BODY:-}"
CURL
chmod +x "$fake_bin/curl"

case "$(uname -m)" in
    x86_64) want_arch=amd64 ;;
    aarch64) want_arch=aarch64 ;;
    *) want_arch="" ;;
esac

run_ha_cli() {
    local root="$1"
    mkdir -p "$root"
    : > "$curl_log"
    PATH="$fake_bin:$PATH" PERSIST_DATA_ROOT="$root" \
        bash "$script" --ha-cli --force > "$tmp_dir/out.log" 2>&1
}

if [ -n "$want_arch" ]; then
    # Latest release resolved from the API (compact JSON, as `curl` may get it)
    if ! FAKE_API_BODY='{"url":"x","tag_name":"9.9.1","name":"9.9.1"}' run_ha_cli "$tmp_dir/ha-ok"; then
        fail "--ha-cli failed although the API answered: $(cat "$tmp_dir/out.log")"
    fi
    grep -q "releases/download/9.9.1/ha_${want_arch}" "$curl_log" || \
        fail "--ha-cli did not download the latest release: $(cat "$curl_log")"
    [ -x "$tmp_dir/ha-ok/packages/bin/ha" ] || fail "--ha-cli left no binary"

    # API unreachable -> non-zero, nothing downloaded
    if FAKE_API_STATUS=22 run_ha_cli "$tmp_dir/ha-down"; then
        fail "--ha-cli exited 0 although the version lookup failed: $(cat "$tmp_dir/out.log")"
    fi
    if grep -q 'releases/download' "$curl_log"; then
        fail "--ha-cli downloaded although the version lookup failed: $(cat "$curl_log")"
    fi
    [ ! -e "$tmp_dir/ha-down/packages/bin/ha" ] || fail "--ha-cli left a binary after a failed lookup"

    # API answers without a tag -> non-zero
    if FAKE_API_BODY='{"message":"rate limit"}' run_ha_cli "$tmp_dir/ha-notag"; then
        fail "--ha-cli exited 0 although the API returned no tag_name"
    fi
fi
```

- [ ] **Step 2: RED prüfen** — `bash tests/test-persist-install.sh` → `FAIL (persist-install): --ha-cli did not download the latest release: … releases/download/4.46.0/ha_amd64`.

- [ ] **Step 3: `install_ha_cli` umbauen** — den Funktionsanfang

```bash
install_ha_cli() {
    # Keep this in sync with the Dockerfile's 32-bit pin. The image already
    # ships `ha` in /usr/bin, and $PERSIST_BIN comes FIRST in PATH, so an
    # unconditional install here silently downgraded a working newer CLI.
    local HA_VERSION="4.46.0"
    local BASE_URL="https://github.com/home-assistant/cli/releases/download/${HA_VERSION}"
    local image_ha="/usr/bin/ha"
```

ersetzen durch

```bash
install_ha_cli() {
    # The image already ships `ha` in /usr/bin, and $PERSIST_BIN comes FIRST in
    # PATH, so an unconditional install here would shadow it.
    local image_ha="/usr/bin/ha"
```

und den Arch-Block

```bash
    case "$machine" in
        x86_64)     arch="amd64" ;;
        aarch64)    arch="aarch64" ;;
        armv7l)     arch="armv7" ;;
        armv6l)     arch="armhf" ;;
        i386|i686)  arch="i386" ;;
        *)
            echo "❌ Unsupported architecture: $machine"
            return 1
            ;;
    esac

    local download_url="${BASE_URL}/ha_${arch}"
```

ersetzen durch

```bash
    case "$machine" in
        x86_64)     arch="amd64" ;;
        aarch64)    arch="aarch64" ;;
        *)
            echo "❌ Unsupported architecture: $machine"
            return 1
            ;;
    esac

    # Latest release, as the Dockerfile does. A pinned version here (4.46.0,
    # kept for 32-bit builds) downgraded the CLI on every arch, because this
    # copy sits in PATH ahead of the image's. grep/sed instead of jq so it
    # works on compact and pretty-printed JSON alike.
    local api_url="https://api.github.com/repos/home-assistant/cli/releases/latest"
    local HA_VERSION
    HA_VERSION=$(curl -fsSL "$api_url" 2>/dev/null \
        | grep -o '"tag_name": *"[^"]*"' | head -n 1 | sed 's/.*"\([^"]*\)"$/\1/')
    if [ -z "$HA_VERSION" ]; then
        echo "❌ Could not determine the latest Home Assistant CLI version"
        echo "   ($api_url)"
        return 1
    fi

    local download_url="https://github.com/home-assistant/cli/releases/download/${HA_VERSION}/ha_${arch}"
```

- [ ] **Step 4: GREEN** — `bash tests/test-persist-install.sh` → `persist-install tests passed`; `git diff claude-terminal/scripts/persist-install` auf korrekte Escapes (`'"tag_name": *"[^"]*"'`, `'s/.*"\([^"]*\)"$/\1/'`) prüfen.

- [ ] **Step 5: Commit**

```bash
git add tests/test-persist-install.sh claude-terminal/scripts/persist-install
git commit -m "fix(persist-install): --ha-cli installs the latest HA CLI

It installed a fixed 4.46.0, a pin meant for 32-bit builds, on every arch.
The copy lives in /data/packages/bin, ahead of the image's newer CLI in
PATH, so --ha-cli --force silently downgraded ha. A failed version lookup
now stops with an error instead of downloading anything.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Regressionsschutz + 32-Bit-Reste in `run.sh` und Session-Picker, verwaiste Dateien

**Files:**
- Modify: `tests/test-release-metadata.sh` (nach dem Block `Dockerfile still carries 32-bit branches`)
- Modify: `claude-terminal/run.sh:360-365`, `:519-524`
- Modify: `claude-terminal/scripts/claude-session-picker.sh:56`
- Delete: `claude-terminal/scripts/install-ha-cli.sh`, `config/scripts/claude-session-picker.sh`
- Modify: `.gitignore`

- [ ] **Step 1: Test ergänzen (RED)** — nach dem `fi` des Blocks `Dockerfile still carries 32-bit branches` einfügen:

```bash
# The runtime scripts had their own 32-bit branches and pins (Claude 1.0.128,
# HA CLI 4.46.0); with only 64-bit images they are dead code at best, and the
# HA CLI pin downgraded `persist-install --ha-cli --force` on every arch.
if grep -rniE 'armv7|armv6|armhf|i386|i686|1\.0\.128|4\.46\.0' \
        "$addon_dir/run.sh" "$addon_dir/scripts"; then
    fail "run.sh or scripts/ still carry 32-bit branches or pins"
fi
```

- [ ] **Step 2: RED prüfen** — `bash tests/test-release-metadata.sh` → Trefferliste (`run.sh:362`, `:363`, `:524`, `claude-session-picker.sh:56`, `install-ha-cli.sh:23…`; `persist-install` ist nach Task 1 schon sauber), dann `FAIL (release metadata): run.sh or scripts/ still carry 32-bit branches or pins`.

- [ ] **Step 3: `run.sh`** — den Block

```bash
    # Current Claude Code native releases do not provide 32-bit ARM binaries.
    case "$(uname -m)" in
        armv7l|armv6l|armhf)
            claude_npm_spec="@anthropic-ai/claude-code@1.0.128"
            ;;
    esac

```

ersatzlos löschen (einschließlich der Leerzeile danach). Im Remote-Control-Kommentar

```bash
    # commands. Needs a claude.ai OAuth login and Claude Code v2.1.51+, so it does
    # nothing on the ARMv7 image that pins the portable 1.0.128 release.
```

ersetzen durch

```bash
    # commands. Needs a claude.ai OAuth login and Claude Code v2.1.51+.
```

- [ ] **Step 4: Session-Picker-Kommentar** — `# The version the Update option would install. A pinned spec (ARMv7) is its` → `# The version the Update option would install. A pinned spec is its`.

- [ ] **Step 5: Dateien löschen, `.gitignore`**

```bash
git rm -q claude-terminal/scripts/install-ha-cli.sh config/scripts/claude-session-picker.sh
```

In `.gitignore` direkt nach der Zeile `/config/options.json` anfügen:

```gitignore
# Local /data mount for podman test runs (DEVELOPMENT.md). The app keeps
# credentials there (/data/home/.claude), so it must never be committed.
/data/
```

- [ ] **Step 6: GREEN** — `bash tests/test-release-metadata.sh` → `Release metadata suite passed (version 2.3.0)`.

- [ ] **Step 7: Prüfen und committen** — `git check-ignore -v data/x` → `.gitignore:…:/data/`. `bash tests/test-startup-timeouts.sh` → `Startup timeout suite passed`.

```bash
git add tests/test-release-metadata.sh claude-terminal/run.sh claude-terminal/scripts/claude-session-picker.sh .gitignore
git commit -m "chore: drop 32-bit runtime leftovers and orphaned scripts

2.3.0 builds amd64 and aarch64 only, so the armv7 pin in run.sh is dead.
install-ha-cli.sh was never called and pinned HA CLI 4.42.0; the root
config/scripts copy of the session picker was a stale leftover. /data/ is
ignored because local test runs mount it and keep credentials there.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```


---

### Task 3: CI auf Node-24-Actions und Node 22

**Files:** `.github/workflows/ci.yml`, `.github/workflows/claude.yml`

- [ ] **Step 1: Ersetzungen** (alle Vorkommen):

| alt | neu | Datei |
|---|---|---|
| `actions/checkout@v4` | `actions/checkout@v7` | ci.yml (3×), claude.yml (1×) |
| `actions/setup-node@v4` | `actions/setup-node@v7` | ci.yml |
| `node-version: "20"` | `node-version: "22"` | ci.yml |
| `hadolint/hadolint-action@v3.1.0` | `hadolint/hadolint-action@v3.5.0` | ci.yml |
| `docker/setup-qemu-action@v3` | `docker/setup-qemu-action@v4` | ci.yml |
| `docker/setup-buildx-action@v3` | `docker/setup-buildx-action@v4` | ci.yml |
| `docker/build-push-action@v6` | `docker/build-push-action@v7` | ci.yml |

Kommentar über `node-version` ergänzen: `# Same major as the image (Alpine 3.21 ships Node 22).`

- [ ] **Step 2: Prüfen** — `grep -n "uses:\|node-version" .github/workflows/*.yml` zeigt nur die neuen Versionen; `python -c "import yaml,sys;[yaml.safe_load(open(f)) for f in sys.argv[1:]]" .github/workflows/ci.yml .github/workflows/claude.yml` ohne Fehler (falls `yaml` lokal fehlt: Validierung durch die CI).

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml .github/workflows/claude.yml
git commit -m "ci: move actions to their Node 24 majors, test on Node 22

GitHub removed Node 20 from the runners and forced the old majors onto
Node 24, warning on every run. The suites also ran on Node 20 while the
image ships Node 22.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Release 2.3.1 vorbereiten

**Files:** `claude-terminal/config.yaml`, `claude-terminal/CHANGELOG.md`, `README.md` (Badge), `docs/release-notes-2.3.1.md`

- [ ] **Step 1: RED** — `version: "2.3.0"` → `"2.3.1"`; `bash tests/test-release-metadata.sh` → `FAIL … CHANGELOG.md has no '## 2.3.1' section`.
- [ ] **Step 2: CHANGELOG oben:**

```markdown
## 2.3.1

### 🐛 Bug Fix - `persist-install --ha-cli --force` installed an old HA CLI
- It always installed version 4.46.0, a pin meant for 32-bit builds, on every
  architecture. That copy lives in `/data/packages/bin`, ahead of the image's
  newer `ha` in PATH, so it silently downgraded the CLI. It now installs the
  latest release, like the image build, and stops with an error if the version
  lookup fails. If you used `--force` before, remove the old copy with
  `rm /data/packages/bin/ha`.

### 🔧 Technical - Cleanup after dropping armv7
- Removed the remaining 32-bit branches at runtime (Claude Code 1.0.128 pin)
  and the unused `install-ha-cli.sh` (pinned HA CLI 4.42.0).
- CI: actions moved to their Node 24 releases, test suites run on Node 22 like
  the image.

```

- [ ] **Step 3:** `README.md` Badge `badge/version-2.3.0-1f6feb` → `badge/version-2.3.1-1f6feb`.
- [ ] **Step 4:** `docs/release-notes-2.3.1.md`:

```markdown
## `persist-install --ha-cli --force` installed an old HA CLI

It always installed version 4.46.0, a pin left over from 32-bit builds. That copy sits in `/data/packages/bin`, ahead of the image's newer `ha` in PATH, so it silently downgraded the CLI. It now installs the latest release and stops with an error if the version lookup fails. If you used `--force` before, remove the old copy with `rm /data/packages/bin/ha`.

## Cleanup
- Remaining 32-bit code paths and an unused HA CLI installer script removed.
- CI moved to current GitHub Actions releases; tests run on Node 22 like the image.

Full details: [CHANGELOG](https://github.com/Eifel-Joe/claude-code-ha/blob/main/claude-terminal/CHANGELOG.md).
```

- [ ] **Step 5: Alle lokalen Suiten** (mit `TMPDIR`/`TMP`/`TEMP` auf `.tmp`): Metadaten (2.3.1), persist-install, Startup-Timeouts, Clipboard (100), Migration (`fail 0`), ShellCheck ohne Ausgabe, CRLF `0`. Danach `ls /tmp/tmp.* 2>/dev/null` → keine neuen Einträge.
- [ ] **Step 6: Commit** `release: 2.3.1` (config.yaml, CHANGELOG, README, Release-Notes).

---

### Task 5: Review, Ubuntu-26-Probe, CI, HA-Test, Release (mit Freigaben)

- [ ] **Step 1: Code-Review** per Subagent gegen Spec/Plan (`git diff 2b4b2aa..HEAD`); Subagent arbeitet nur unter `.tmp/`.
- [ ] **Step 2: Ubuntu-26-Zwischen-Commit** — in `ci.yml` alle drei `runs-on: ubuntu-latest` → `runs-on: ubuntu-26.04`; Commit `ci: run all jobs on ubuntu-26.04 (probe before the label switch)`.
- [ ] **Step 3: Push — nur nach Freigabe.** CI-Lauf abwarten: alle Jobs grün auf Ubuntu 26.04 (im Log „Ubuntu 26.04“ bzw. Runner-Image prüfen), ShellCheck per `apt` installiert, keine Node-20-Annotations.
- [ ] **Step 4: Zurück auf `ubuntu-latest`** — Commit `ci: back to ubuntu-latest after the 26.04 probe`; Push (Freigabe aus Step 3 gilt für diesen zweiten Push mit) und CI grün abwarten.
- [ ] **Step 5: Merge nach `main` (`--no-ff`) und Push — nur nach Freigabe.**
- [ ] **Step 6: HA-Test auf 2.3.1** — nur nach Freigabe; `check_updates`, `update` (bei Timeout Supervisor-Log, nicht erneut auslösen); `state: started`, Log fehlerfrei. User: `persist-install --ha-cli --force` zeigt aktuelle Version, danach `rm /data/packages/bin/ha`.
- [ ] **Step 7: Tag `v2.3.1` + Release** — Titel und Text vorher im Chat, nur nach Freigabe.
- [ ] **Step 8: Abschluss** — Memory (Punkte 10–12 erledigt), `docs/SESSION-STAND.md`, Plan abhaken, `.tmp/` leeren.
