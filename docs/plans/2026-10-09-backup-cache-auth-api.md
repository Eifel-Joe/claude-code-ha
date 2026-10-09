# npm-Cache aus den Backups, `auth_api` entfernen (3.1.3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** npm-Cache liegt in `/tmp` statt in `/data` (nicht mehr im Backup), `auth_api` ist weg.

**Architecture:** Neue Funktion `setup_npm_cache` in `claude-workbench/run.sh`, aufgerufen in `init_environment`; Profil-Heredoc exportiert dieselbe Variable; `auth_api` aus `config.yaml`, abgesichert in `tests/test-release-metadata.sh`. Spec: `docs/specs/2026-10-09-backup-cache-auth-api-design.md`.

**Tech Stack:** Bash, ShellCheck, HA-Supervisor-Konfiguration.

**Umgebung (Windows, Git Bash):** Keine Temp-Dateien auf C:. Vor jedem Testlauf:
`export TMPDIR=/d/Entwicklung/Claude-Code-HA/.tmp TMP='D:\Entwicklung\Claude-Code-HA\.tmp' TEMP='D:\Entwicklung\Claude-Code-HA\.tmp'`.
Neue Dateien mit dem Write-Tool, Mehrzeiliges mit dem Edit-Tool (keine Heredocs
über Bash). Nach jeder Änderung `git ls-files --eol | grep -c "crlf\|mixed"` → `0`.
Branch: `fix/backup-cache-auth-api`.

---

### Task 1: `auth_api` entfernen

**Files:**
- Modify: `tests/test-release-metadata.sh` (nach dem Block „publishes a host port“, ca. Zeile 86–88)
- Modify: `claude-workbench/config.yaml:74`

- [x] **Step 1: Test ergänzen** — direkt nach dem `fi` des Blocks `config.yaml publishes a host port` einfügen:

```bash
# auth_api only opens the Supervisor's username/password check; nothing in the
# app uses it (dropped in 3.1.3, heytcass/home-assistant-addons@3a6ee0d).
if grep -qE '^auth_api:' "$addon_dir/config.yaml"; then
    fail "config.yaml requests auth_api; the app never checks HA passwords"
fi
```

- [x] **Step 2: RED prüfen**

Run: `bash tests/test-release-metadata.sh`
Expected: Exit 1, `… config.yaml requests auth_api; the app never checks HA passwords`

- [x] **Step 3: Commit (RED)**

```bash
git add tests/test-release-metadata.sh
git commit -m "test: auth_api must not be requested"
```

- [x] **Step 4: Zeile `auth_api: true` aus `claude-workbench/config.yaml` löschen** (Edit-Tool; die Zeilen `hassio_api`, `hassio_role`, `homeassistant_api` bleiben).

- [x] **Step 5: GREEN prüfen**

Run: `bash tests/test-release-metadata.sh`
Expected: `Release metadata suite passed (version 3.1.2)`

- [x] **Step 6: Commit**

```bash
git add claude-workbench/config.yaml
git commit -m "security: drop the unused auth_api permission"
```

### Task 2: npm-Cache nach `/tmp`

**Files:**
- Create: `tests/test-npm-cache.sh`
- Modify: `tests/run-tests.sh` (nach `"$tests_dir/test-cpu-check.sh"`)
- Modify: `claude-workbench/run.sh` (Kopf-Variablen bei Zeile 11, neue Funktion vor `init_environment`, Aufruf in `init_environment`, Profil-Heredoc)

- [x] **Step 1: Test schreiben** — `tests/test-npm-cache.sh` (Write-Tool):

```bash
#!/usr/bin/env bash
set -euo pipefail

# npm's download cache must not live in /data: it went into every backup of
# the app (115 MB on a real install). run.sh points it at /tmp and removes the
# old one once.

repo_root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
tmp_dir=$(mktemp -d)
trap 'rm -rf "$tmp_dir"' EXIT

fail() {
    echo "FAIL (npm cache): $*" >&2
    exit 1
}

log="$tmp_dir/log"
: > "$log"
bashio::log.info() { printf 'info|%s\n' "$*" >> "$log"; }
bashio::log.warning() { printf 'warning|%s\n' "$*" >> "$log"; }
bashio::log.error() { printf 'error|%s\n' "$*" >> "$log"; }
bashio::config() { printf '%s\n' "${2:-}"; }

export NPM_CACHE_DIR="$tmp_dir/npm-cache"
export NPM_LEGACY_CACHE_DIR="$tmp_dir/data/home/.npm"
run_sh="$repo_root/claude-workbench/run.sh"

# shellcheck disable=SC2034  # read by the sourced run.sh
CLAUDE_RUN_SH_SKIP_MAIN=true
# shellcheck source=/dev/null
source "$run_sh"

command -v setup_npm_cache >/dev/null 2>&1 || fail "run.sh has no setup_npm_cache"

# An old cache in /data is removed, once, and npm points at the new place.
mkdir -p "$NPM_LEGACY_CACHE_DIR/_cacache"
: > "$NPM_LEGACY_CACHE_DIR/_cacache/blob"
unset npm_config_cache
setup_npm_cache
[ "${npm_config_cache:-}" = "$NPM_CACHE_DIR" ] || \
    fail "npm_config_cache is '${npm_config_cache:-}', expected $NPM_CACHE_DIR"
[ ! -e "$NPM_LEGACY_CACHE_DIR" ] || fail "the old cache in /data was not removed"
[ "$(grep -c 'Removed the old npm cache' "$log")" -eq 1 ] || \
    fail "the removal must be logged once: $(cat "$log")"

# Nothing to remove: quiet.
: > "$log"
setup_npm_cache
[ ! -s "$log" ] || fail "nothing to remove, but it logged: $(cat "$log")"
[ "${npm_config_cache:-}" = "$NPM_CACHE_DIR" ] || fail "npm_config_cache lost on a second run"

# Wiring. init_environment writes to fixed /data paths, so these are text checks.
sed -n '/^init_environment() {/,/^}/p' "$run_sh" | grep -qx '    setup_npm_cache' || \
    fail "init_environment does not call setup_npm_cache"
grep -qx 'export npm_config_cache="/tmp/npm-cache"' "$run_sh" || \
    fail "the shell profile does not point npm_config_cache at /tmp"

echo "npm cache suite passed"
```

Dann `chmod +x tests/test-npm-cache.sh` und `git update-index --chmod=+x tests/test-npm-cache.sh` nach dem `git add`.

- [x] **Step 2: RED prüfen**

Run: `bash tests/test-npm-cache.sh`
Expected: Exit 1, `FAIL (npm cache): run.sh has no setup_npm_cache`

- [x] **Step 3: Suite in `tests/run-tests.sh` eintragen** — nach `"$tests_dir/test-cpu-check.sh"` die Zeile `"$tests_dir/test-npm-cache.sh"`.

- [x] **Step 4: Commit (RED)**

```bash
git add tests/test-npm-cache.sh tests/run-tests.sh
git update-index --chmod=+x tests/test-npm-cache.sh
git commit -m "test: npm's cache must live in /tmp, not in /data"
```

- [x] **Step 5: Kopf-Variablen in `run.sh`** — nach der Zeile `STARTUP_NPM_TIMEOUT="${STARTUP_NPM_TIMEOUT:-300}"` einfügen:

```bash
# npm's download cache; overridable for tests only (tests/test-npm-cache.sh).
NPM_CACHE_DIR="${NPM_CACHE_DIR:-/tmp/npm-cache}"
NPM_LEGACY_CACHE_DIR="${NPM_LEGACY_CACHE_DIR:-/data/home/.npm}"
```

- [x] **Step 6: Funktion** — direkt vor `init_environment() {` einfügen:

```bash
# npm keeps only a download cache. Under HOME=/data/home it landed in
# /data/home/.npm and so in every backup of the app (115 MB on a real install;
# heytcass/home-assistant-addons#105). /tmp is emptied on every restart, at
# the price of a full download (~113 MB, measured) for the update on start.
setup_npm_cache() {
    export npm_config_cache="$NPM_CACHE_DIR"
    if [ -d "$NPM_LEGACY_CACHE_DIR" ]; then
        rm -rf "$NPM_LEGACY_CACHE_DIR"
        bashio::log.info "Removed the old npm cache from $NPM_LEGACY_CACHE_DIR (kept it out of backups)"
    fi
}

```

- [x] **Step 7: Aufruf** — in `init_environment` direkt nach `    export XDG_DATA_HOME="/data/.local/share"` eine Zeile `    setup_npm_cache` (4 Leerzeichen Einrückung).

- [x] **Step 8: Profil** — im Heredoc `PROFILE_EOF` nach der Zeile `export GH_CONFIG_DIR="/data/.config/gh"` einfügen:

```bash

# npm's download cache stays out of /data (and so out of backups)
export npm_config_cache="/tmp/npm-cache"
```

- [x] **Step 9: GREEN prüfen**

Run: `bash tests/test-npm-cache.sh`
Expected: `npm cache suite passed`

- [x] **Step 10: Gegenprobe** — den Aufruf `    setup_npm_cache` in `init_environment` vorübergehend auskommentieren → Test fällt mit `init_environment does not call setup_npm_cache`; wiederherstellen (Edit-Tool, kein `git checkout -- .`) → grün.

- [x] **Step 11: Volle lokale Suite + ShellCheck**

```bash
bash tests/test-release-metadata.sh
bash tests/test-persist-install.sh
bash tests/test-startup-timeouts.sh
bash tests/test-cpu-check.sh < /dev/null
bash tests/test-npm-cache.sh
node tests/test-terminal-clipboard.js
PATH="/c/WINDOWS/system32:$PATH" node --test tests/test-app-migration.js
shellcheck -S warning -e SC1008,SC1007,SC2155 -x claude-workbench/run.sh claude-workbench/scripts/*.sh claude-workbench/scripts/persist-install tests/*.sh
```
Expected: alle grün, ShellCheck ohne Ausgabe.

- [x] **Step 12: Commit**

```bash
git add claude-workbench/run.sh
git commit -m "fix: keep npm's download cache in /tmp, out of the app's backups"
```

### Task 3: Release 3.1.3 vorbereiten

**Files:**
- Modify: `claude-workbench/config.yaml` (`version: "3.1.2"` → `"3.1.3"`)
- Modify: `README.md:3` (Badge `version-3.1.2` → `version-3.1.3`)
- Modify: `claude-workbench/CHANGELOG.md` (oben)
- Create: `docs/release-notes-3.1.3.md`

- [x] **Step 1: Version und Badge** auf 3.1.3.

- [x] **Step 2: CHANGELOG** direkt unter `# Changelog`:

```markdown
## 3.1.3

### 🛠️ Improvement - Smaller backups: npm's cache no longer lives in /data
- npm kept its download cache in `/data/home/.npm` (about 115 MB), so it went
  into every backup of the app — including the one Home Assistant makes before
  each app update. It now lives in `/tmp/npm-cache` and is gone after a
  restart; the old folder is removed once on start (heytcass,
  heytcass/home-assistant-addons#105).
- Trade-off: with `auto_update_claude_on_start`, every start now downloads
  Claude Code again (about 113 MB, about 16 s longer start, measured), even
  without a new version.

### 🔒 Security - No access to Home Assistant's password check
- Dropped the `auth_api` permission. It only lets an app check Home Assistant
  usernames and passwords, which Claude Workbench never does (heytcass,
  heytcass/home-assistant-addons@3a6ee0d).
```

- [x] **Step 3: Release-Notes** `docs/release-notes-3.1.3.md`:

```markdown
## Smaller backups, one permission less

- **npm's cache is out of your backups.** It sat in `/data/home/.npm` (about 115 MB) and went into every backup of the app, including the automatic one before each update. It now lives in `/tmp` and the old folder is removed on the first start. With *Update Claude Code on start* enabled, each start downloads Claude Code again (about 113 MB, roughly 16 s longer). Idea from heytcass/home-assistant-addons#105.
- **`auth_api` removed.** The app never checks Home Assistant passwords, so it no longer asks for the permission to do so. Idea from heytcass/home-assistant-addons@3a6ee0d.

Thanks to Tom Cassady ([@heytcass](https://github.com/heytcass)). Full details: [CHANGELOG](https://github.com/Eifel-Joe/claude-workbench/blob/main/claude-workbench/CHANGELOG.md).
```

- [x] **Step 4: Prüfen** — `bash tests/test-release-metadata.sh` → `… (version 3.1.3)`; CRLF-Check `0`.

- [x] **Step 5: Commit**

```bash
git add claude-workbench/config.yaml README.md claude-workbench/CHANGELOG.md docs/release-notes-3.1.3.md
git commit -m "chore(release): 3.1.3"
```

### Task 4: Review, CI, HA-Test, Release (je mit Freigabe)

- [x] **Step 1:** Code-Review per Subagent (`superpowers:requesting-code-review`) über `main..fix/backup-cache-auth-api` gegen Spec und Plan; Befunde über `superpowers:receiving-code-review` prüfen.
- [x] **Step 2:** Push des Branches (Freigabe); CI über `gh run list --repo Eifel-Joe/claude-workbench --branch fix/backup-cache-auth-api` → grün (inkl. neuer Suite in „Regression suites“).
- [x] **Step 3:** Merge nach `main` (`--no-ff`), Push (Freigabe), CI auf `main` grün.
- [x] **Step 4:** (Backup-Vergleich auf Prod verschoben, siehe Step 6) HA-Test: vorher Größe des letzten Teil-Backups der App notieren (`ha_manage_backup`); `ha_manage_app` check_updates, dann update auf 3.1.3. Prüfen:
  - App-Log: einmal „Removed the old npm cache from /data/home/.npm“;
  - `ha_get_app`: `auth_api: false`, `state: started`;
  - User in der App-Shell: `du -sh /data/home/.npm` (nicht vorhanden), `ls -d /tmp/npm-cache`, `echo $npm_config_cache` → `/tmp/npm-cache`; Picker-Punkt 7 „Update Claude Code“ läuft;
  - neues Teil-Backup der App (Freigabe) um rund 110 MB kleiner als das vor dem Update.
- [x] **Step 5:** Tag `v3.1.3` und GitHub-Release „3.1.3 — Smaller backups, one permission less“ mit `docs/release-notes-3.1.3.md` (Freigabe).
- [x] **Step 6:** HA-Prod-Update durch den User; Supervisor- und App-Log per MCP prüfen. Backup-Vergleich: automatisches Backup „Claude Workbench 3.1.2“ (vor dem Update, mit Cache) gegen ein späteres Teil-Backup nur der App (User legt es an); Größen per MCP `ha_manage_backup` list.
- [x] **Step 7:** `docs/SESSION-STAND.md` ergänzen, Memory `claude-code-ha-followups` aktualisieren, `.tmp/` leeren.
