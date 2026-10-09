# CI-Runner, Health-Check, tmux, Sicherheits-Doku (3.3.0) – Umsetzungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** CI-Runner festschreiben, den Health-Check Claude wirklich starten lassen und als `claude-doctor` anbieten, eigene tmux-Einstellungen erlauben, die Oberfläche ohne Cache ausliefern und die Sicherheits-Doku ehrlich machen.

**Architecture:** Bash-Änderungen in `scripts/health-check.sh` und `run.sh` (`setup_tmux`), je mit Test unter `tests/`; eine Zeile im `Dockerfile`; Node-Änderung in `image-service/server.js`, getestet in `tests/test-image-service.js`; Workflows und Doku mit statischen Prüfungen in `tests/test-release-metadata.sh`.

**Tech Stack:** Bash (bashio), Node 22 (Express), GitHub Actions, Home Assistant App-Metadaten.

**Spec:** `docs/specs/2026-10-09-safer-defaults-3.3.0-design.md` · **Branch:** `feat/safer-defaults-3.3.0`

## Arbeitsregeln (gelten für jeden Task)

- Keine temporären Dateien auf C:. Jede Testausführung mit
  `export TMPDIR=/d/Entwicklung/Claude-Code-HA/.tmp TMP='D:\Entwicklung\Claude-Code-HA\.tmp' TEMP='D:\Entwicklung\Claude-Code-HA\.tmp'`;
  npm zusätzlich mit `npm_config_cache='D:/Entwicklung/Claude-Code-HA/.tmp/npm-cache'`.
- Dateien mit dem Write-/Edit-Tool schreiben, nicht per Heredoc im Bash-Tool (Backslashes).
  Nach jedem Schritt `git diff` lesen.
- Neue Test-Skripte ausführbar machen: `git update-index --chmod=+x tests/<datei>.sh` nach `git add`.
- Gegenproben nie mit `git checkout -- .` zurücknehmen, sondern mit dem Edit-Tool.
- Nach jedem Task: `git ls-files --eol | grep -c "crlf\|mixed"` → `0`.
- Im App-Code (run.sh, scripts/, image-service, Dockerfile) kein „claude-terminal“/„Claude Terminal“:
  Credits dort als „owine's fork, commit …“ bzw. „heytcass upstream, commit …“.
- Commit-Messages nennen WAS und WARUM und enden mit `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

### Task 1: CI-Runner auf `ubuntu-24.04` festschreiben

**Files:**
- Modify: `tests/test-release-metadata.sh` (vor der Schlusszeile `echo "Release metadata suite passed …"`)
- Modify: `.github/workflows/ci.yml:19,62,86`, `.github/workflows/claude.yml:20`

- [x] **Step 1: Failing test** – in `tests/test-release-metadata.sh` direkt vor `echo "Release metadata suite passed (version $config_version)"` einfügen:

```bash
# ubuntu-latest moves to the next Ubuntu release without notice (Ubuntu 26
# from 2026-10-19). Pin the runner image so a switch is a deliberate change.
if grep -n 'runs-on: *ubuntu-latest' "$repo_root"/.github/workflows/*.yml; then
    fail "a workflow runs on ubuntu-latest; pin the runner image (ubuntu-24.04)"
fi
```

- [x] **Step 2: RED** – `bash tests/test-release-metadata.sh`
  Expected: 4 Trefferzeilen, dann `FAIL (release metadata): a workflow runs on ubuntu-latest; …`, Exit 1.

- [x] **Step 3: Implementation** – in beiden Workflows jedes `runs-on: ubuntu-latest` durch `runs-on: ubuntu-24.04` ersetzen (Edit-Tool, `replace_all` je Datei).

- [x] **Step 4: GREEN** – `bash tests/test-release-metadata.sh`
  Expected: `Release metadata suite passed (version 3.2.0)`.

- [x] **Step 5: Commit**

```bash
git add tests/test-release-metadata.sh .github/workflows/ci.yml .github/workflows/claude.yml
git commit -m "ci: pin runners to ubuntu-24.04

ubuntu-latest becomes Ubuntu 26 from 2026-10-19; a runner switch should be
a deliberate change, not a surprise in the middle of a release. The metadata
suite rejects ubuntu-latest from now on.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Health-Check startet Claude wirklich

**Files:**
- Modify: `tests/test-health-check.sh` (neuer Teil vor `echo "Health check suite passed"`)
- Modify: `claude-workbench/scripts/health-check.sh:73-91` (`check_claude_cli`)

- [x] **Step 1: Failing test** – in `tests/test-health-check.sh` die Schlusszeile `echo "Health check suite passed"` ersetzen durch:

```bash
# check_claude_cli used to pass on `command -v` and the x bit alone, so a
# binary that cannot start (libc mismatch, CPU without x86-64-v2) got a green
# tick. It now runs `claude --version` under a time limit (umrath, heytcass
# upstream ff4ebec; owine's fork, commit cc0d74e7) and skips the run when
# the CPU cannot execute Claude at all.
bashio::log.info() { printf 'info|%s\n' "$*"; }
bashio::log.warning() { printf 'warning|%s\n' "$*"; }
bashio::log.error() { printf 'error|%s\n' "$*"; }
CPU_CHECK_SCRIPT="$repo_root/claude-workbench/scripts/cpu-check.sh"
# shellcheck source=/dev/null
source "$repo_root/claude-workbench/scripts/health-check.sh"

stub_dir="$tmp_dir/bin"
mkdir -p "$stub_dir"
ran_marker="$tmp_dir/claude-ran"
good_cpu="$tmp_dir/cpuinfo-good"
old_cpu="$tmp_dir/cpuinfo-old"
printf 'flags\t\t: fpu sse4_2 popcnt\n' > "$good_cpu"
printf 'flags\t\t: fpu sse2\n' > "$old_cpu"

write_stub() {
    printf '#!/bin/bash\ntouch "%s"\n%s\n' "$ran_marker" "$1" > "$stub_dir/claude"
    chmod +x "$stub_dir/claude"
}

# Runs check_claude_cli with only the stub dir and the system tools in PATH
# (a real claude on the developer's machine must not be found).
# Prints the log; the exit status goes to $tmp_dir/rc.
run_claude_check() {
    local cpuinfo="$1" rc=0
    rm -f "$ran_marker"
    (
        PATH="$stub_dir:/usr/bin:/bin"
        CPU_CHECK_ARCH=x86_64 CPU_CHECK_CPUINFO="$cpuinfo" HEALTH_CLAUDE_TIMEOUT=1
        export CPU_CHECK_ARCH CPU_CHECK_CPUINFO HEALTH_CLAUDE_TIMEOUT
        check_claude_cli
    ) || rc=$?
    printf '%s\n' "$rc" > "$tmp_dir/rc"
}

# Works: version in the log, status 0.
write_stub 'echo "2.1.300 (Claude Code)"'
out=$(run_claude_check "$good_cpu")
[ "$(cat "$tmp_dir/rc")" -eq 0 ] || fail "a working claude failed the check: $out"
grep -qx 'info|Claude CLI runs: 2.1.300 (Claude Code) ✓' <<< "$out" || \
    fail "a working claude does not report its version: $out"

# Present but broken: the real error in the log, status 1.
write_stub 'echo "Error relocating /x/claude: posix_getdents: symbol not found" >&2; exit 127'
out=$(run_claude_check "$good_cpu")
[ "$(cat "$tmp_dir/rc")" -eq 1 ] || fail "a broken claude passed the check: $out"
grep -q '^error|Claude CLI is present but fails to run' <<< "$out" || \
    fail "a broken claude is not reported: $out"
grep -qx 'Error relocating /x/claude: posix_getdents: symbol not found' <<< "$out" || \
    fail "the real error of a broken claude is not shown: $out"

# Hangs: the time limit ends it, status 1. exec, so timeout kills the
# process that holds the output pipe.
write_stub 'exec sleep 30'
start=$SECONDS
out=$(run_claude_check "$good_cpu")
[ "$(cat "$tmp_dir/rc")" -eq 1 ] || fail "a hanging claude passed the check: $out"
[ $((SECONDS - start)) -lt 10 ] || fail "the time limit did not end a hanging claude"
grep -q '^error|Claude CLI is present but fails to run' <<< "$out" || \
    fail "a hanging claude is not reported: $out"

# Missing: the real way out, no promise of an install, status 1.
rm -f "$stub_dir/claude"
out=$(run_claude_check "$good_cpu")
[ "$(cat "$tmp_dir/rc")" -eq 1 ] || fail "a missing claude passed the check: $out"
grep -qx 'info|Restart the app: startup reinstalls Claude Code.' <<< "$out" || \
    fail "a missing claude gets no restart hint: $out"
if grep -q 'Attempting to install' <<< "$out"; then
    fail "the check still promises an install it never does: $out"
fi

# CPU without x86-64-v2: claude is not started (it would hang), status 1.
write_stub 'echo "2.1.300 (Claude Code)"'
out=$(run_claude_check "$old_cpu")
[ "$(cat "$tmp_dir/rc")" -eq 1 ] || fail "claude passed on a CPU that cannot run it: $out"
[ ! -e "$ran_marker" ] || fail "claude was started on a CPU that cannot run it"
grep -qx 'error|Claude CLI cannot run on this CPU (lacks sse4_2 popcnt) ✗' <<< "$out" || \
    fail "the CPU reason is not reported: $out"

echo "Health check suite passed"
```

- [x] **Step 2: RED** – `bash tests/test-health-check.sh`
  Expected: `FAIL (health check): a working claude does not report its version: …` (heute „Claude CLI is executable ✓“), Exit 1.

- [x] **Step 3: Implementation** – in `claude-workbench/scripts/health-check.sh` die ganze Funktion `check_claude_cli()` (Zeilen 73–91) ersetzen durch:

```bash
check_claude_cli() {
    bashio::log.info "=== Claude CLI Check ==="

    local claude_path
    if ! claude_path=$(command -v claude 2>/dev/null); then
        bashio::log.error "Claude CLI not found ✗"
        bashio::log.info "Restart the app: startup reinstalls Claude Code."
        return 1
    fi
    bashio::log.info "Claude CLI found at: ${claude_path} ✓"

    if [ ! -x "$claude_path" ]; then
        bashio::log.error "Claude CLI is not executable ✗"
        return 1
    fi

    # Present and executable is not the same as runnable: a libc mismatch or a
    # CPU without x86-64-v2 leaves a binary that aborts or hangs on launch
    # (umrath, heytcass upstream ff4ebec; owine's fork, commit cc0d74e7). So
    # run it, once, under a time limit. On such a CPU it would only hang until
    # the limit, so say why instead (cpu-check.sh).
    local missing=""
    if command -v claude_cpu_missing_flags >/dev/null 2>&1; then
        missing=$(claude_cpu_missing_flags)
    fi
    if [ -n "$missing" ]; then
        bashio::log.error "Claude CLI cannot run on this CPU (lacks ${missing}) ✗"
        return 1
    fi

    local -a version_cmd=("$claude_path" --version)
    if command -v timeout >/dev/null 2>&1; then
        version_cmd=(timeout "${HEALTH_CLAUDE_TIMEOUT:-10}" "${version_cmd[@]}")
    fi
    local output status=0
    output=$("${version_cmd[@]}" 2>&1) || status=$?
    if [ "$status" -eq 0 ]; then
        bashio::log.info "Claude CLI runs: ${output%%$'\n'*} ✓"
        return 0
    fi
    bashio::log.error "Claude CLI is present but fails to run or hangs (exit ${status}) ✗"
    bashio::log.info "Output of '${claude_path} --version':"
    # A here-string, not a pipe: with pipefail an early-closing head could fail
    # the check under bashio's errexit.
    head -n 5 <<< "$output"
    return 1
}
```

- [x] **Step 4: GREEN** – `bash tests/test-health-check.sh`
  Expected: `Health check suite passed`. Danach Schwester-Pfad-Check: `check_node_installation` ruft `node --version`/`npm --version` ohne Zeitgrenze auf – bleibt so (Node ist im Image, kein bekannter Hänger; nicht im Scope der Spec), im Review erwähnen.

- [x] **Step 5: Commit**

```bash
git add tests/test-health-check.sh claude-workbench/scripts/health-check.sh
git commit -m "fix: health check runs claude --version instead of trusting the x bit

A binary that cannot start (libc mismatch, CPU without x86-64-v2) passed the
check with a green tick. The check now runs it once under a 10 s limit and
shows the real error; on a CPU that cannot run Claude it says so instead of
hanging. The not-found branch promised an install it never did and now
points at a restart. (umrath, heytcass ff4ebec; owine cc0d74e7)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Befehl `claude-doctor`

**Files:**
- Modify: `tests/test-release-metadata.sh` (vor der Schlusszeile)
- Modify: `claude-workbench/Dockerfile:141-146`
- Modify: `claude-workbench/DOCS.md` (Abschnitt `## Troubleshooting`, Zeile 214ff)

- [x] **Step 1: Failing test** – in `tests/test-release-metadata.sh` vor der Schlusszeile einfügen:

```bash
# claude-doctor makes the startup health check callable from the terminal;
# nobody knows /opt/scripts/health-check.sh by heart.
grep -qE '^\s*(RUN |&& )?ln -sf /opt/scripts/health-check\.sh /usr/local/bin/claude-doctor' "$addon_dir/Dockerfile" || \
    fail "Dockerfile does not link /usr/local/bin/claude-doctor to /opt/scripts/health-check.sh"
```

- [x] **Step 2: RED** – `bash tests/test-release-metadata.sh`
  Expected: `FAIL (release metadata): Dockerfile does not link /usr/local/bin/claude-doctor …`, Exit 1.

- [x] **Step 3: Implementation** – im Dockerfile

```dockerfile
COPY .claude/ /opt/.claude/
RUN chmod +x /run.sh \
    && chmod +x /opt/scripts/*.sh
```

ersetzen durch

```dockerfile
COPY .claude/ /opt/.claude/
# claude-doctor: the startup health check, callable from the terminal
# (owine's fork, commit cc0d74e7)
RUN chmod +x /run.sh \
    && chmod +x /opt/scripts/*.sh \
    && ln -sf /opt/scripts/health-check.sh /usr/local/bin/claude-doctor
```

  In `claude-workbench/DOCS.md` unter `## Troubleshooting` als ersten Punkt (vor „**Claude does not start on a virtual machine …**“) einfügen:

```markdown
- **Run `claude-doctor`** in the terminal (session menu → "🐚 Drop to bash
  shell") for the health check the app runs on every start: memory, disk,
  Node.js, whether Claude Code actually starts, the CPU and the network. The
  last line sums up how many checks failed.
```

- [x] **Step 4: GREEN** – `bash tests/test-release-metadata.sh`
  Expected: `Release metadata suite passed (version 3.2.0)`. Das Image selbst baut erst die CI (Task 8).

- [x] **Step 5: Commit**

```bash
git add tests/test-release-metadata.sh claude-workbench/Dockerfile claude-workbench/DOCS.md
git commit -m "feat: claude-doctor runs the health check from the terminal

The health check only ran on start; users with a problem in the terminal
had no way to call it. (owine cc0d74e7)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: tmux lädt `~/.tmux.conf.local`, `focus-events on`

**Files:**
- Create: `tests/test-tmux-config.sh`
- Modify: `tests/run-tests.sh` (nach `"$tests_dir/test-image-retention.sh"`)
- Modify: `claude-workbench/run.sh:345-358` (Heredoc in `setup_tmux`)
- Modify: `claude-workbench/DOCS.md` (nach Abschnitt `### tmux Mouse Mode`)

- [x] **Step 1: Failing test** – `tests/test-tmux-config.sh` anlegen:

```bash
#!/usr/bin/env bash
set -euo pipefail

# ~/.tmux.conf is rewritten on every start, so own settings were lost without
# a word. It now loads ~/.tmux.conf.local last, which the app never writes
# (owine's fork, commits 1175851a, 1e0a33e2), and passes focus events on to
# Claude Code and vim.

repo_root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
tmp_dir=$(mktemp -d)
trap 'rm -rf "$tmp_dir"' EXIT

fail() {
    echo "FAIL (tmux config): $*" >&2
    exit 1
}

bashio::log.info() { :; }
bashio::log.warning() { :; }
bashio::log.error() { :; }
bashio::config() { printf '%s\n' "${2:-}"; }

# shellcheck disable=SC2034  # read by the sourced run.sh
CLAUDE_RUN_SH_SKIP_MAIN=true
# shellcheck source=/dev/null
source "$repo_root/claude-workbench/run.sh"

command -v setup_tmux >/dev/null 2>&1 || fail "run.sh has no setup_tmux"

export HOME="$tmp_dir/home"
export TMUX_WRAPPER_PATH="$tmp_dir/tmux-claude"
mkdir -p "$HOME"
setup_tmux

conf="$HOME/.tmux.conf"
[ -f "$conf" ] || fail "setup_tmux wrote no $conf"
grep -qx 'set -g focus-events on' "$conf" || fail "focus-events is not on"
last=$(grep -vE '^[[:space:]]*(#|$)' "$conf" | tail -n 1)
[ "$last" = 'source-file -q ~/.tmux.conf.local' ] || \
    fail "the last directive must load ~/.tmux.conf.local so own settings win, got: $last"

echo "tmux config suite passed"
```

  In `tests/run-tests.sh` nach der Zeile `"$tests_dir/test-image-retention.sh"` einfügen:

```bash
"$tests_dir/test-tmux-config.sh"
```

- [x] **Step 2: RED** – `bash tests/test-tmux-config.sh`
  Expected: `FAIL (tmux config): focus-events is not on`, Exit 1.

- [x] **Step 3: Implementation** – im Heredoc von `setup_tmux` (`run.sh`)

```
# Reduce escape-time so claude/vim feel responsive inside tmux
set -g escape-time 20
```

ersetzen durch

```
# Reduce escape-time so claude/vim feel responsive inside tmux
set -g escape-time 20

# Pass focus in/out events on, so Claude Code and vim notice when the
# terminal gains or loses focus
set -g focus-events on
```

und

```
set -g status-right '%H:%M'
TMUX_EOF
```

ersetzen durch

```
set -g status-right '%H:%M'

# Own settings: this file is rewritten on every start, ~/.tmux.conf.local is
# never touched by the app. Loaded last, so it overrides everything above
# (owine's fork, commit 1175851a).
source-file -q ~/.tmux.conf.local
TMUX_EOF
```

  (Der Heredoc ist ungequotet; `~` wird darin von Bash nicht expandiert, tmux expandiert es selbst.)

  In `claude-workbench/DOCS.md` nach dem Abschnitt `### tmux Mouse Mode` (vor `### Copying Text Out of the Terminal`) einfügen:

````markdown
### Own tmux Settings
- The app rewrites `~/.tmux.conf` on every start. Put your own settings in
  `~/.tmux.conf.local` (that is `/data/home/.tmux.conf.local`): it is loaded
  last, so it overrides the defaults, and it survives restarts and updates
- Example – a green status bar:
  ```bash
  echo 'set -g status-bg colour22' >> ~/.tmux.conf.local
  tmux source-file ~/.tmux.conf
  ```
- Restarting the app loads it as well
````

- [x] **Step 4: GREEN** – `bash tests/test-tmux-config.sh`
  Expected: `tmux config suite passed`.

- [x] **Step 5: Commit**

```bash
git add tests/test-tmux-config.sh tests/run-tests.sh claude-workbench/run.sh claude-workbench/DOCS.md
git update-index --chmod=+x tests/test-tmux-config.sh
git commit -m "feat: tmux loads ~/.tmux.conf.local and passes focus events on

~/.tmux.conf is rewritten on every start, so own settings were lost without
a word; ~/.tmux.conf.local is loaded last and never written by the app.
focus-events lets Claude Code and vim notice focus changes.
(owine 1175851a, 1e0a33e2; also BartBourgeois, Maheidem)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Oberfläche mit `Cache-Control: no-cache`

**Files:**
- Modify: `tests/test-image-service.js` (nach dem Test „the static UI is served at the root“, Zeile 257–261)
- Modify: `claude-workbench/image-service/server.js:155-156`

- [x] **Step 1: Failing test** – nach `test('the static UI is served at the root', …)` einfügen:

```js
test('the UI is revalidated on every load (Cache-Control: no-cache)', async () => {
    // After an app update the browser must not combine a cached
    // terminal-clipboard.js with the new index.html (owine's fork, 67dd7e55).
    for (const file of ['/', '/terminal-clipboard.js']) {
        const res = await fetch(`http://127.0.0.1:${PORT}${file}`);
        assert.strictEqual(res.status, 200, `${file} not served`);
        assert.strictEqual(res.headers.get('cache-control'), 'no-cache',
            `${file} must be revalidated on every load`);
    }
});
```

- [x] **Step 2: RED** – `node --test --test-reporter=tap tests/test-image-service.js`
  Expected: der neue Test `not ok` mit `'public, max-age=0' !== 'no-cache'`; die übrigen 14 wie bisher (unter Windows der bekannte ECONNRESET-Dateifehlschlag).

- [x] **Step 3: Implementation** – in `server.js`

```js
// Serve static files (HTML interface) - MUST be after API routes
app.use(express.static(path.join(__dirname, 'public')));
```

ersetzen durch

```js
// Serve static files (HTML interface) - MUST be after API routes.
// no-cache: the browser revalidates every file (ETag; a 304 when unchanged),
// so after an app update index.html and terminal-clipboard.js cannot come
// from different versions - Safari kept old JS with new HTML
// (owine's fork, commit 67dd7e55).
app.use(express.static(path.join(__dirname, 'public'), {
    setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'),
}));
```

- [x] **Step 4: GREEN** – `node --test --test-reporter=tap tests/test-image-service.js`
  Expected: 15 Einzeltests `ok` (Windows: bekannter Dateifehlschlag ECONNRESET bleibt; maßgeblich die Einzeltests, unter Linux in der CI 15/0).

- [x] **Step 5: Commit**

```bash
git add tests/test-image-service.js claude-workbench/image-service/server.js
git commit -m "fix: serve the panel UI with Cache-Control: no-cache

With the default max-age=0 a browser could keep an old terminal-clipboard.js
next to a new index.html after an update. no-cache keeps the ETag, so an
unchanged file still costs only a 304. (owine 67dd7e55)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Sicherheits-Doku

**Files:**
- Modify: `tests/test-release-metadata.sh` (vor der Schlusszeile)
- Modify: `claude-workbench/README.md:84-93` (Volumes-Zeile) und `:133-139` (`## Security`)
- Modify: `claude-workbench/DOCS.md` (neuer Abschnitt `## Security` vor `## Troubleshooting`)

- [x] **Step 1: Failing test** – in `tests/test-release-metadata.sh` vor der Schlusszeile einfügen:

```bash
# The old "Version 1.0.2 includes …" security section described 2025 and kept
# quiet about who can open the panel. The current one must say it.
if grep -n 'Version 1.0.2 includes' "$addon_dir/README.md"; then
    fail "README.md still carries the outdated 'Version 1.0.2' security section"
fi
grep -q 'every signed-in Home Assistant user' "$addon_dir/README.md" || \
    fail "README.md security section does not say who can open the panel"
```

- [x] **Step 2: RED** – `bash tests/test-release-metadata.sh`
  Expected: Trefferzeile `135:Version 1.0.2 includes …`, dann `FAIL (release metadata): README.md still carries the outdated …`, Exit 1.

- [x] **Step 3: Implementation**

  a) `claude-workbench/README.md`, den Abschnitt von `## Security` bis vor `## Development Environment` ersetzen durch:

```markdown
## Security

- **Who can open the terminal: every signed-in Home Assistant user, not only
  administrators.** The app sets `panel_admin: true`, but that only hides the
  sidebar entry from non-admins. Home Assistant's ingress view accepts any
  valid ingress session, and Home Assistant deliberately lets every signed-in
  user create one and read an app's ingress URL
  (`homeassistant/components/hassio/ingress.py`: `requires_auth = False`;
  `websocket_api.py`: `WS_NO_ADMIN_ENDPOINTS`, since home-assistant/core#60120).
  The Supervisor checks the session, not the user's role. Checked against
  Home Assistant Core and Supervisor on 2026-10-09; the app cannot change it.
- **What is behind the panel:** a root shell in the app's container that can
  write your whole Home Assistant configuration (`/config`) and the other
  apps' folders (`/addon_configs`), and holds `SUPERVISOR_TOKEN` with the
  Supervisor's `manager` role (install, configure, start and stop apps). With
  `dangerously_skip_permissions` on, Claude acts there without asking.
- **No open port:** the app publishes no host port. The terminal (`ttyd`)
  listens on `127.0.0.1` only and is reached through Home Assistant ingress,
  which requires a Home Assistant login.
- **What follows:** treat every account on your Home Assistant as trusted
  while this app is installed. If you hand out limited accounts (family,
  guests, a wall tablet), stop or uninstall the app.
- **Login data** for Claude stays in the app's private `/data`
  (`/data/home/.claude`, mode 600), not in `/config`.
```

  b) Im selben README unter `## Configuration` die veraltete Zeile

```markdown
- **Volumes**: Access to both `/config` (Home Assistant) and `/addons` (for development)
```

  ersetzen durch (das App mappt kein `/addons`, sondern `all_app_configs`, siehe `config.yaml` `map:`):

```markdown
- **Volumes**: `/config` (Home Assistant configuration) and `/addon_configs` (the other apps' folders), both read-write
```

  c) `claude-workbench/DOCS.md`, direkt vor `## Troubleshooting` einfügen:

```markdown
## Security

**Every signed-in Home Assistant user can open this terminal, not only
administrators.** `panel_admin: true` only hides the sidebar entry; Home
Assistant lets any signed-in user open an app's ingress page. Behind it is a
root shell that can write your whole configuration and use the Supervisor
API. If you hand out limited accounts, stop or uninstall the app. Details and
sources: the
[Security section of the README](https://github.com/Eifel-Joe/claude-workbench/blob/main/claude-workbench/README.md#security).
```

- [x] **Step 4: GREEN** – `bash tests/test-release-metadata.sh`
  Expected: `Release metadata suite passed (version 3.2.0)`. Durchsicht: `git diff claude-workbench/README.md claude-workbench/DOCS.md` – keine Aussage ohne Beleg aus der Spec („Belege zu 6“).

- [x] **Step 5: Commit**

```bash
git add tests/test-release-metadata.sh claude-workbench/README.md claude-workbench/DOCS.md
git commit -m "docs: say who can open the panel, replace the 1.0.2 security section

panel_admin only hides the sidebar entry; Home Assistant lets every
signed-in user open an app's ingress page (checked in Core and Supervisor on
2026-10-09). The old section described a 2025 release. Also corrects the
volume list: the app maps /addon_configs, not /addons.
(umrath, heytcass 8e65403)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Release 3.3.0 vorbereiten

**Files:**
- Modify: `claude-workbench/config.yaml` (`version: "3.2.0"` → `"3.3.0"`)
- Modify: `README.md:3` (Badge `version-3.2.0-` → `version-3.3.0-`)
- Modify: `claude-workbench/CHANGELOG.md` (oben, unter `# Changelog`)
- Create: `docs/release-notes-3.3.0.md`

- [x] **Step 1: RED** – nur die Version in `config.yaml` auf `3.3.0` setzen, dann `bash tests/test-release-metadata.sh`
  Expected: `FAIL (release metadata): CHANGELOG.md has no '## 3.3.0' section …`.

- [x] **Step 2: CHANGELOG** – unter `# Changelog` einfügen:

```markdown
## 3.3.0

### ✨ New Feature - `claude-doctor`
- **The health check is now a terminal command**: `claude-doctor` runs the
  same checks the app runs on every start — memory, disk, Node.js, Claude
  Code, CPU and network — and sums up the failures (owine,
  owine/claude-terminal-home-assistant `cc0d74e7`).

### ✨ New Feature - Own tmux settings
- **`~/.tmux.conf.local`** is loaded last, so it overrides the app's tmux
  defaults and survives restarts and updates; `~/.tmux.conf` itself is still
  rewritten on every start (owine, owine/claude-terminal-home-assistant
  `1175851a`; also BartBourgeois and Maheidem).
- **Focus events** are passed on, so Claude Code and vim notice when the
  terminal gains or loses focus (owine `1e0a33e2`).

### 🐛 Bug Fix - Health check tells whether Claude Code really starts
- It checked only that `claude` exists and is executable, so a binary that
  cannot start (library mismatch, CPU without x86-64-v2) got a green tick. It
  now runs `claude --version` under a 10 s limit and shows the real error; on
  a CPU that cannot run Claude it says so instead of waiting. The "Attempting
  to install" line, which never installed anything, now points at a restart
  (umrath, heytcass/home-assistant-addons `ff4ebec`; owine `cc0d74e7`).

### 🐛 Bug Fix - No stale panel files after an update
- The panel's files are served with `Cache-Control: no-cache`, so a browser
  cannot combine an old script with the new page after an update (owine
  `67dd7e55`).

### 📚 Documentation - Who can open the panel
- The README's security section said "Version 1.0.2 includes …". It now
  states that every signed-in Home Assistant user can open the panel —
  `panel_admin` only hides the sidebar entry — and what is behind it, with
  sources (umrath, heytcass/home-assistant-addons `8e65403`). DOCS has a
  short version; the volume list names `/addon_configs` instead of `/addons`.

### 🔧 Technical - CI runners pinned
- The workflows run on `ubuntu-24.04` instead of `ubuntu-latest`, which
  becomes Ubuntu 26 on 2026-10-19.
```

- [x] **Step 3: Badge** – `README.md` Zeile 3: `version-3.2.0-` → `version-3.3.0-`.

- [x] **Step 4: Release-Notes** – `docs/release-notes-3.3.0.md` anlegen:

```markdown
## claude-doctor, own tmux settings, honest security notes

- **`claude-doctor`** runs the app's health check in the terminal — and the check now actually starts Claude Code, so a binary that cannot run no longer gets a green tick.
- **Own tmux settings** go in `~/.tmux.conf.local`; they override the defaults and survive restarts and updates.
- **Security notes:** every signed-in Home Assistant user can open the panel, not only administrators (`panel_admin` only hides the sidebar entry). The README now says so and what is behind the panel. If you hand out limited accounts, stop or uninstall the app.
- **Fixes:** the panel's files are no longer served stale after an update; CI runs on a pinned Ubuntu 24.04.

These come from [@umrath](https://github.com/umrath) in [heytcass/home-assistant-addons](https://github.com/heytcass/home-assistant-addons) (`ff4ebec`, `8e65403`) and the fork by [@owine](https://github.com/owine) ([owine/claude-terminal-home-assistant](https://github.com/owine/claude-terminal-home-assistant), `cc0d74e7`, `1175851a`, `1e0a33e2`, `67dd7e55`); BartBourgeois and Maheidem had the tmux idea too. Thank you! Full details: [CHANGELOG](https://github.com/Eifel-Joe/claude-workbench/blob/main/claude-workbench/CHANGELOG.md).
```

- [x] **Step 5: GREEN** – `bash tests/test-release-metadata.sh`
  Expected: `Release metadata suite passed (version 3.3.0)`.

- [x] **Step 6: Commit**

```bash
git add claude-workbench/config.yaml README.md claude-workbench/CHANGELOG.md docs/release-notes-3.3.0.md
git commit -m "release: 3.3.0

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Volle Prüfung, Review, CI, HA-Test, Release (je mit Freigabe)

- [x] **Step 1: Volle lokale Suite** (mit TMP-Exports aus den Arbeitsregeln):

```bash
bash tests/test-release-metadata.sh
bash tests/test-persist-install.sh
bash tests/test-startup-timeouts.sh
bash tests/test-cpu-check.sh < /dev/null
bash tests/test-npm-cache.sh
bash tests/test-health-check.sh
bash tests/test-startup-order.sh
bash tests/test-claude-assets.sh
bash tests/test-auth-helper.sh
bash tests/test-image-retention.sh
bash tests/test-tmux-config.sh
node tests/test-terminal-clipboard.js
PATH="/c/WINDOWS/system32:$PATH" node --test tests/test-app-migration.js
node --test --test-reporter=tap tests/test-image-service.js
```

  Expected: alles grün (Image-Service: 15 Einzeltests maßgeblich).

- [x] **Step 2: ShellCheck wie die CI**

```bash
shellcheck -S warning -e SC1008,SC1007,SC2155 -x claude-workbench/run.sh claude-workbench/scripts/*.sh claude-workbench/scripts/persist-install tests/*.sh
```

  Expected: keine Ausgabe. CRLF-Check `0`. `.tmp/` auf Test-Reste prüfen.

- [x] **Step 3:** Code-Review per Subagent (`superpowers:requesting-code-review`) über `main..feat/safer-defaults-3.3.0` gegen Spec und Plan; Befunde über `superpowers:receiving-code-review` prüfen.
- [x] **Step 4:** Push des Branches (Freigabe); CI `gh run list --repo Eifel-Joe/claude-workbench --branch feat/safer-defaults-3.3.0` → grün; im Job-Log „Runner Image … ubuntu-24.04“, „tmux config suite passed“, Image-Service 15/0, beide Image-Builds grün.
- [x] **Step 5:** Merge nach `main` (`--no-ff`), Push (Freigabe), CI auf `main` grün.
- [x] **Step 6:** HA-Test (`ha_manage_app` check_updates, dann update auf 3.3.0). Prüfen (Ende-zu-Ende-Kriterium der Spec):
  - App-Log: „Claude CLI runs: <Version> ✓“ und die Zusammenfassung des Health-Checks;
  - User im Terminal (Picker 8): `claude-doctor` → dieselben Checks und Zusammenfassung;
  - User: `echo 'set -g status-bg colour22' >> ~/.tmux.conf.local; tmux source-file ~/.tmux.conf` → Statusleiste grün; danach `rm ~/.tmux.conf.local` und App-Neustart nach Belieben.
- [ ] **Step 7:** Tag `v3.3.0` und GitHub-Release „3.3.0 — claude-doctor, own tmux settings, honest security notes“ mit `docs/release-notes-3.3.0.md` (Text-Freigabe vorher).
- [ ] **Step 8:** HA-Prod-Update durch den User; Supervisor- und App-Log per MCP prüfen.
- [ ] **Step 9:** `docs/SESSION-STAND.md` ergänzen, Tabelle „Umsetzungsstand“ in `docs/FORK-SURVEY-heytcass.md` (tmux, no-cache, `claude-doctor`) und Memory `claude-code-ha-followups` (heytcass-Rest: nur noch Boot-Smoke-Test offen; CI-Runner erledigt) aktualisieren, `.tmp/` gezielt leeren.
