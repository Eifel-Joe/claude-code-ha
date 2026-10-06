# Zeitgrenzen beim Start + Credential-Pfad — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Kein Netzwerk-Schritt vor dem Web-Terminal kann den Start der App unbegrenzt blockieren; README und Projekt-`CLAUDE.md` nennen den echten Credential-Ort.

**Architecture:** Spec `docs/specs/2026-10-06-startup-timeouts-design.md`. Hilfsfunktion `run_with_timeout` in `claude-terminal/run.sh`, drei Zeitgrenzen-Variablen, Aufrufstellen umgestellt. Neue Test-Suite `tests/test-startup-timeouts.sh`, die lokal unter Git Bash läuft.

**Tech Stack:** Bash (run.sh mit bashio), GNU/BusyBox `timeout`, Bash-Testskripte.

**Arbeitsregeln:** Branch `fix/startup-timeouts`. Neue Suite: `bash tests/test-startup-timeouts.sh` (Erfolg: letzte Zeile `Startup timeout suite passed`). `bash tests/test-release-metadata.sh`. ShellCheck wie CI: `shellcheck -S warning -e SC1008,SC1007,SC2155 -x claude-terminal/run.sh claude-terminal/scripts/*.sh claude-terminal/scripts/persist-install tests/*.sh` (falls lokal nicht vorhanden: CI). Nach jedem Commit `git ls-files --eol | grep -c "crlf\|mixed"` → `0`. `tests/test-production-run.sh` läuft nur in der CI (Symlinks).

---

### Task 1: `run_with_timeout` und Grenzwerte

**Files:**
- Create: `tests/test-startup-timeouts.sh`
- Modify: `tests/run-tests.sh` (nach `"$tests_dir/test-production-run.sh"`)
- Modify: `claude-terminal/run.sh` (nach `set -o pipefail`, Z. 5)

- [x] **Step 1: Test-Suite anlegen**

`tests/test-startup-timeouts.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

# Startup steps that touch the network run before the web terminal starts, so
# one that hangs must be cut off. A hang is a stub sleeping far past a 1 s limit.

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
tmp_dir=$(mktemp -d)
trap 'rm -rf "$tmp_dir"' EXIT

fail() {
    echo "FAIL (startup timeouts): $*" >&2
    exit 1
}

log="$tmp_dir/log"
: > "$log"
bashio::log.info() { printf 'info|%s\n' "$*" >> "$log"; }
bashio::log.warning() { printf 'warning|%s\n' "$*" >> "$log"; }
bashio::log.error() { printf 'error|%s\n' "$*" >> "$log"; }

config_apk_packages=''
config_pip_packages=''
bashio::config() {
    case "$1" in
        use_persistent_claude) printf '%s\n' true ;;
        auto_update_claude_on_start) printf '%s\n' true ;;
        persistent_apk_packages) printf '%s\n' "$config_apk_packages" ;;
        persistent_pip_packages) printf '%s\n' "$config_pip_packages" ;;
        *) printf '%s\n' "${2:-}" ;;
    esac
}

export STARTUP_NPM_TIMEOUT=1 STARTUP_APK_TIMEOUT=1 STARTUP_PIP_TIMEOUT=1

# shellcheck disable=SC2034  # read by the sourced run.sh
CLAUDE_RUN_SH_SKIP_MAIN=true
# shellcheck source=/dev/null
source "$repo_root/claude-terminal/run.sh"

# --- run_with_timeout ---

run_with_timeout 5 "fast step" true || fail "a quick success must return 0"
! grep -q 'timed out' "$log" || fail "a quick success must not be reported as a timeout"

status=0
run_with_timeout 5 "failing step" sh -c 'exit 3' || status=$?
[ "$status" -eq 3 ] || fail "the command's own status must come back (got $status)"
! grep -q 'timed out' "$log" || fail "a quick failure is not a timeout"

status=0
started=$SECONDS
run_with_timeout 1 "hanging step" sleep 30 || status=$?
[ $((SECONDS - started)) -lt 10 ] || fail "a hanging command must be cut off"
[ "$status" -ne 0 ] || fail "a cut-off command must not report success"
grep -qx 'warning|hanging step timed out after 1s' "$log" || \
    fail "a cut-off command must be logged as a timeout"

echo "Startup timeout suite passed"
```

In `tests/run-tests.sh` nach der Zeile `"$tests_dir/test-production-run.sh"` einfügen:

```bash
"$tests_dir/test-startup-timeouts.sh"
```

- [x] **Step 2: RED**

Run: `bash tests/test-startup-timeouts.sh`
Expected: Abbruch mit `run_with_timeout: command not found` (Exit ≠ 0) — `set -e` beendet beim ersten Aufruf; `|| fail` greift bei „command not found" (127), also `FAIL (startup timeouts): a quick success must return 0`.

- [x] **Step 3: Implementierung** — in `claude-terminal/run.sh` direkt nach `set -o pipefail`:

```bash

# Time limits for startup steps that touch the network. They all run before the
# web terminal starts, so a hung registry or mirror would leave the panel blank
# for good. pip gets longer: on a Pi it may compile wheels on first install.
# Overridable only so the tests can use a 1 s limit.
STARTUP_NPM_TIMEOUT="${STARTUP_NPM_TIMEOUT:-300}"
STARTUP_APK_TIMEOUT="${STARTUP_APK_TIMEOUT:-300}"
STARTUP_PIP_TIMEOUT="${STARTUP_PIP_TIMEOUT:-900}"

# Run a startup step under a time limit and return its own status. A cut-off is
# told by the elapsed time, not the exit code: GNU timeout returns 124, BusyBox
# timeout (Alpine) does not promise that.
run_with_timeout() {
    local seconds="$1"
    local label="$2"
    local started=$SECONDS
    local status=0
    shift 2

    if command -v timeout >/dev/null 2>&1; then
        timeout "$seconds" "$@" || status=$?
    else
        "$@" || status=$?
    fi

    if [ "$status" -ne 0 ] && [ $((SECONDS - started)) -ge "$seconds" ]; then
        bashio::log.warning "$label timed out after ${seconds}s"
    fi
    return "$status"
}
```

- [x] **Step 4: GREEN**

Run: `bash tests/test-startup-timeouts.sh`
Expected: `Startup timeout suite passed`, Laufzeit wenige Sekunden.

- [x] **Step 5: Commit**

```bash
git add tests/test-startup-timeouts.sh tests/run-tests.sh claude-terminal/run.sh
git commit -m "feat(startup): add a time limit helper for network steps

Every network step in run.sh runs before the web terminal starts, so a
hung registry or mirror left the panel blank with nothing in the log.
The helper cuts a step off and logs it as a timeout.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: npm-Schritte (Claude-Update, Image-Service)

**Files:**
- Modify: `claude-terminal/run.sh` (`setup_persistent_claude` ~Z. 344; `start_web_terminal` ~Z. 551)
- Test: `tests/test-startup-timeouts.sh` (vor `echo "Startup timeout suite passed"`)

- [x] **Step 1: Tests**

```bash
# --- Claude Code update on start ---

stub_bin="$tmp_dir/bin"
mkdir -p "$stub_bin"
printf '#!/bin/sh\nexec sleep 30\n' > "$stub_bin/npm"
chmod +x "$stub_bin/npm"
PATH="$stub_bin:$PATH"

PERSISTENT_CLAUDE_ROOT="$tmp_dir/npm"
CLAUDE_BIN_LINK="$tmp_dir/claude"
CLAUDE_NATIVE_BIN_LINK="$tmp_dir/native/claude"
: > "$log"
started=$SECONDS
setup_persistent_claude
[ $((SECONDS - started)) -lt 10 ] || fail "a hanging Claude Code update must not block startup"
grep -qx 'warning|Persistent Claude override: npm update timed out after 1s' "$log" || \
    fail "a hanging Claude Code update must be logged as a timeout"

# start_web_terminal launches servers, so check the call instead of running it.
grep -q 'run_with_timeout "$STARTUP_NPM_TIMEOUT" "Image service: npm install" npm install' \
    "$repo_root/claude-terminal/run.sh" || \
    fail "the image service's npm install must run under the time limit"
```

- [x] **Step 2: RED** — Run: `bash tests/test-startup-timeouts.sh` → Expected: nach ~30 s `FAIL (startup timeouts): a hanging Claude Code update must not block startup`.

- [x] **Step 3: Implementierung**

In `setup_persistent_claude` die Zeile

```bash
        if NPM_CONFIG_PREFIX="$persistent_root" npm install -g "$claude_npm_spec" --prefer-online; then
```

ersetzen durch

```bash
        if run_with_timeout "$STARTUP_NPM_TIMEOUT" "Persistent Claude override: npm update" \
                env NPM_CONFIG_PREFIX="$persistent_root" npm install -g "$claude_npm_spec" --prefer-online; then
```

In `start_web_terminal` die Zeile

```bash
        cd "${service_dir}" && npm install || bashio::log.error "npm install failed"
```

ersetzen durch

```bash
        cd "${service_dir}" && \
            run_with_timeout "$STARTUP_NPM_TIMEOUT" "Image service: npm install" npm install || \
            bashio::log.error "npm install failed"
```

- [x] **Step 4: GREEN** — `bash tests/test-startup-timeouts.sh` → `Startup timeout suite passed`.

- [x] **Step 5: Commit**

```bash
git add tests/test-startup-timeouts.sh claude-terminal/run.sh
git commit -m "fix(startup): stop a hung npm from keeping the panel blank

The Claude Code update on start (on by default) and the image service's
fallback npm install had no time limit and run before ttyd starts. Both
now give up after 300 s; a half-finished update is rejected by the
existing --version check, so the built-in Claude Code is used.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Auto-Install der Pakete

**Files:**
- Modify: `claude-terminal/run.sh` (`auto_install_packages` ~Z. 441 und ~Z. 454)
- Test: `tests/test-startup-timeouts.sh`

- [x] **Step 1: Tests** (vor der Abschlusszeile)

```bash
# --- Package auto-install ---

PERSIST_INSTALL_LOG="$tmp_dir/persist-install.log"
export PERSIST_INSTALL_LOG
PERSIST_INSTALL_BIN="$stub_bin/persist-install"
cat > "$PERSIST_INSTALL_BIN" << 'STUB_EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$PERSIST_INSTALL_LOG"
for argument in "$@"; do
    if [ "$argument" = hang ]; then exec sleep 30; fi
done
STUB_EOF
chmod +x "$PERSIST_INSTALL_BIN"

config_apk_packages=$'hang\ngit'
config_pip_packages=''
: > "$log"
: > "$PERSIST_INSTALL_LOG"
started=$SECONDS
auto_install_packages
[ $((SECONDS - started)) -lt 10 ] || fail "a hanging apk package must not block startup"
grep -qx 'git' "$PERSIST_INSTALL_LOG" || fail "the package after a hanging one must still be installed"
grep -qx "warning|Auto-install of hang timed out after 1s" "$log" || \
    fail "a hanging apk package must be logged as a timeout"

config_apk_packages=''
config_pip_packages=$'requests\nhang'
: > "$log"
started=$SECONDS
auto_install_packages
[ $((SECONDS - started)) -lt 10 ] || fail "a hanging pip install must not block startup"
grep -qx 'warning|Auto-install of Python packages timed out after 1s' "$log" || \
    fail "a hanging pip install must be logged as a timeout"
```

- [x] **Step 2: RED** — Expected: nach ~30 s `FAIL (startup timeouts): a hanging apk package must not block startup`.

- [x] **Step 3: Implementierung** — in `auto_install_packages`

```bash
                "$persist_install" "$package" || bashio::log.warning "Failed to install: $package"
```

ersetzen durch

```bash
                run_with_timeout "$STARTUP_APK_TIMEOUT" "Auto-install of $package" \
                    "$persist_install" "$package" || bashio::log.warning "Failed to install: $package"
```

und

```bash
            "$persist_install" --python "${pip_package_list[@]}" || \
                bashio::log.warning "Failed to install Python packages"
```

ersetzen durch

```bash
            run_with_timeout "$STARTUP_PIP_TIMEOUT" "Auto-install of Python packages" \
                "$persist_install" --python "${pip_package_list[@]}" || \
                bashio::log.warning "Failed to install Python packages"
```

- [x] **Step 4: GREEN** — `bash tests/test-startup-timeouts.sh` → `Startup timeout suite passed`.

- [x] **Step 5: Commit**

```bash
git add tests/test-startup-timeouts.sh claude-terminal/run.sh
git commit -m "fix(startup): put a time limit on package auto-install

persistent_apk_packages and persistent_pip_packages are installed before
ttyd starts, so a hung mirror blocked the panel too. apk gets 300 s per
package, so one stuck package does not cost the rest; the single pip
call gets 900 s because a Pi may compile wheels on first install.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Credential-Pfad in README und `CLAUDE.md`

**Files:**
- Modify: `claude-terminal/README.md:81`
- Modify: `CLAUDE.md` (Key Components Punkt 2, Credential System „Persistent Storage", Key Environment Variables)
- Modify: `tests/test-release-metadata.sh` (vor der letzten `echo`-Zeile)

- [x] **Step 1: Test**

```bash
# Credentials live in the app's private /data (HOME=/data/home). The store page
# and the project instructions kept naming /config/claude-config/.
for doc in "$addon_dir/README.md" "$repo_root/CLAUDE.md"; do
    if grep -nE '(stored|storage|saved)[^.]*/config/claude-config|=/config/claude-config' "$doc"; then
        fail "$(basename "$doc") names /config/claude-config as where credentials live; they are in /data/home/.claude"
    fi
done
```

- [x] **Step 2: RED** — `bash tests/test-release-metadata.sh` → Trefferzeile README:81 und `FAIL (release metadata): README.md names /config/claude-config …`.

- [x] **Step 3: Doku korrigieren**

`claude-terminal/README.md` Z. 81:

```markdown
- **Authentication**: OAuth with Anthropic (credentials kept in the app's private `/data`, under `/data/home/.claude`, not in `/config`)
```

`CLAUDE.md`:
- `2. **Credential Management**: Persistent authentication storage in \`/config/claude-config/\`` →
  `2. **Credential Management**: Credentials live in the app's private \`/data\` (\`/data/home/.claude\`)`
- `- **Persistent Storage**: Credentials saved to \`/config/claude-config/\` (survives restarts)` →
  `- **Persistent Storage**: Credentials live in \`/data/home/.claude\` (survives restarts and updates); an older release's \`/config/claude-config\` is copied into \`/data\` once on start`
- Abschnitt „Key Environment Variables", die drei Zeilen ersetzen durch:

```markdown
- `HOME=/data/home`
- `ANTHROPIC_CONFIG_DIR=/data/.config/claude`
- `ANTHROPIC_HOME=/data`
```

(Quelle: `run.sh` `init_environment`, `export HOME="$data_home"` usw.)

- [x] **Step 4: GREEN** — `bash tests/test-release-metadata.sh` → `Release metadata suite passed (version 2.2.1)`.

- [x] **Step 5: Commit**

```bash
git add claude-terminal/README.md CLAUDE.md tests/test-release-metadata.sh
git commit -m "docs: say where credentials really live

The store page and the project instructions said /config/claude-config/;
since 2.1.0 they are in the app's private /data (HOME=/data/home), as
DOCS.md already says. The metadata suite now rejects the old claim.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Version 2.2.2

**Files:** `claude-terminal/config.yaml`, `claude-terminal/build.yaml`, `claude-terminal/CHANGELOG.md`

- [x] **Step 1:** `config.yaml` `version: "2.2.2"`, `build.yaml` `org.opencontainers.image.version: "2.2.2"`.
- [x] **Step 2:** CHANGELOG oben unter `# Changelog`:

```markdown
## 2.2.2

### 🐛 Bug Fix - A hung download could keep the panel blank
- Before the terminal starts, the app updates Claude Code (on by default) and
  installs the packages from `persistent_apk_packages` / `persistent_pip_packages`.
  None of these had a time limit, so a stuck npm registry or package mirror left
  the panel blank with nothing in the log saying why.
- They now give up and log `… timed out after Ns`: 300 s for the Claude Code
  update and for each apk package, 900 s for the pip install (a Pi may compile
  packages on first install). The app then starts as usual, with the built-in
  Claude Code if the update did not finish.

### 📚 Documentation
- The app description said credentials are stored in `/config/claude-config/`.
  They are in the app's private `/data` (`/data/home/.claude`), as the
  documentation already said.

```

- [x] **Step 3:** `bash tests/test-release-metadata.sh` → `Release metadata suite passed (version 2.2.2)`; `bash tests/test-startup-timeouts.sh` → passed; `node tests/test-terminal-clipboard.js | tail -1` → `All 100 …`; ShellCheck (siehe Kopf) ohne Befund; `git ls-files --eol | grep -c "crlf\|mixed"` → 0.
- [x] **Step 4: Commit** — `git commit -m "docs: release notes for 2.2.2"` (mit Co-Authored-By-Zeile).

---

### Task 6: Review, CI, HA-Test (je Schritt Freigabe)

- [x] **Step 1:** `superpowers:requesting-code-review` auf `main..fix/startup-timeouts`.
- [x] **Step 2:** Freigabe → Branch pushen, CI abwarten (`gh … --repo Eifel-Joe/claude-code-ha`).
- [x] **Step 3:** Freigabe → Merge nach `main`, Push.
- [x] **Step 4:** Freigabe → HA-Test: `check_updates`, Update auf 2.2.2; im App-Log `Persistent Claude override: update completed` und kein `timed out`; Panel startet (Supervisor `state: started`, Ingress liefert `/terminal-clipboard.js` mit 200).
- [x] **Step 5:** Release-Notes/Tag/GitHub-Release nur nach Freigabe des Textes; HA-Prod nur nach ausdrücklicher Freigabe.
- [x] **Step 6:** `docs/SESSION-STAND.md`, Memory `claude-code-ha-followups` (Punkte 4 und 6) aktualisieren.
