# Picker-Label „Update Claude Code“ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Der Menüpunkt „Update Claude Code“ behauptet nie mehr „up to date“, wenn die installierte Version unbekannt ist.

**Architecture:** Ein zusätzlicher Zweig in `update_menu_label` (`claude-workbench/scripts/claude-session-picker.sh`), getestet in `tests/test-cpu-check.sh` (sourced den Picker). Spec: `docs/specs/2026-10-07-picker-update-label-design.md`.

**Tech Stack:** Bash, ShellCheck.

**Umgebung (Windows, Git Bash):** Keine Temp-Dateien auf C:. Vor jedem Testlauf:
`export TMPDIR=/d/Entwicklung/Claude-Code-HA/.tmp TMP='D:\Entwicklung\Claude-Code-HA\.tmp' TEMP='D:\Entwicklung\Claude-Code-HA\.tmp'`.
Mehrzeiliges mit dem Edit-Tool, nicht per Heredoc. Nach jeder Änderung
`git ls-files --eol | grep -c "crlf\|mixed"` → `0`.

---

### Task 1: Tests für das Label (RED)

**Files:**
- Test: `tests/test-cpu-check.sh` (Abschnitt `# --- session picker ---`)

- [x] **Step 1: kvm64-Fall ergänzen** — direkt nach dem Auth-Helper-Block (nach der Zeile `esac`, die auf `*) fail "kvm64: auth helper does not explain: $out" ;;` folgt) und vor `export CPU_CHECK_CPUINFO="$v2"` einfügen:

```bash
# The update item's label: never "up to date" without knowing the installed
# version. A pinned spec is the "latest" version, so this needs no network.
export CLAUDE_NPM_SPEC=@anthropic-ai/claude-code@9.9.9
: > "$claude_calls"
label=$(update_menu_label)
case "$label" in
    *"up to date"*) fail "kvm64: update label claims up to date: $label" ;;
    *"latest 9.9.9; installed version not checked on this CPU"*) ;;
    *) fail "kvm64: update label does not explain: $label" ;;
esac
[ ! -s "$claude_calls" ] || fail "kvm64: the update label ran Claude: $(cat "$claude_calls")"
```

- [x] **Step 2: x86-64-v2-Fälle ergänzen** — nach `grep -q . "$claude_calls" || fail "x86-64-v2: new session did not start Claude"` und vor `unset CPU_CHECK_ARCH CPU_CHECK_CPUINFO` einfügen:

```bash
label=$(update_menu_label)
[ "$label" = "Update Claude Code (2.1.292 → 9.9.9 available)" ] || \
    fail "x86-64-v2: update label with a newer release: $label"
export CLAUDE_NPM_SPEC=@anthropic-ai/claude-code@2.1.292
label=$(update_menu_label)
[ "$label" = "Update Claude Code (2.1.292, up to date)" ] || \
    fail "x86-64-v2: update label when current: $label"
label=$(CLAUDE_BIN="$tmp_dir/no-such-claude"; update_menu_label)
case "$label" in
    *"up to date"*) fail "missing binary: update label claims up to date: $label" ;;
    *"latest 2.1.292; installed version unknown"*) ;;
    *) fail "missing binary: update label does not explain: $label" ;;
esac
unset CLAUDE_NPM_SPEC
```

- [x] **Step 3: RED prüfen**

Run: `bash tests/test-cpu-check.sh < /dev/null`
Expected: Exit 1, `FAIL (…): kvm64: update label claims up to date: Update Claude Code (9.9.9, up to date)`

- [x] **Step 4: Commit**

```bash
git add tests/test-cpu-check.sh
git commit -m "test: picker update label must not claim up to date without a version"
```

### Task 2: Label korrigieren (GREEN)

**Files:**
- Modify: `claude-workbench/scripts/claude-session-picker.sh` (`update_menu_label`, ca. Zeile 130–142)

- [x] **Step 1: Funktion ersetzen** durch:

```bash
update_menu_label() {
    local installed latest
    installed=$(get_installed_version)
    latest=$(get_latest_version)

    if [ -z "$latest" ]; then
        echo "Update Claude Code (latest version unknown)"
    elif [ -z "$installed" ]; then
        # Unknown installed version is not "up to date". On a CPU without
        # x86-64-v2 the version is deliberately not asked for (cpu-check.sh);
        # otherwise the binary is missing or printed no version.
        if [ -n "$(claude_cpu_missing)" ]; then
            echo "Update Claude Code (latest $latest; installed version not checked on this CPU)"
        else
            echo "Update Claude Code (latest $latest; installed version unknown)"
        fi
    elif version_is_newer "$latest" "$installed"; then
        echo "Update Claude Code ($installed → $latest available)"
    else
        echo "Update Claude Code ($installed, up to date)"
    fi
}
```

- [x] **Step 2: GREEN prüfen**

Run: `bash tests/test-cpu-check.sh < /dev/null`
Expected: `cpu-check suite passed`, Exit 0

- [x] **Step 3: Gegenprobe Schwester-Zweig** — nur in dieser Datei den `elif [ -z "$installed" ]`-Zweig vorübergehend entfernen, Test muss mit `kvm64: update label claims up to date` fallen; danach Zweig wiederherstellen (Edit-Tool, kein `git checkout -- .`), Test wieder grün.

- [x] **Step 4: Volle lokale Suite + ShellCheck**

```bash
bash tests/test-release-metadata.sh
bash tests/test-persist-install.sh
bash tests/test-startup-timeouts.sh
bash tests/test-cpu-check.sh < /dev/null
node tests/test-terminal-clipboard.js
PATH="/c/WINDOWS/system32:$PATH" node --test tests/test-app-migration.js
shellcheck -S warning -e SC1008,SC1007,SC2155 -x claude-workbench/run.sh claude-workbench/scripts/*.sh claude-workbench/scripts/persist-install tests/*.sh
```
Expected: alle grün, ShellCheck ohne Ausgabe.

- [x] **Step 5: Commit**

```bash
git add claude-workbench/scripts/claude-session-picker.sh
git commit -m "fix(picker): do not claim 'up to date' when the installed version is unknown"
```

### Task 3: Release 3.1.2 vorbereiten

**Files:**
- Modify: `claude-workbench/config.yaml` (`version: "3.1.1"` → `"3.1.2"`)
- Modify: `README.md:3` (Badge `version-3.1.1` → `version-3.1.2`)
- Modify: `claude-workbench/CHANGELOG.md` (oben)
- Create: `docs/release-notes-3.1.2.md`

- [x] **Step 1: Version und Badge** auf 3.1.2.

- [x] **Step 2: CHANGELOG** direkt unter `# Changelog` einfügen:

```markdown
## 3.1.2

### 🐛 Bug Fix - Update menu no longer claims "up to date" without knowing
- With `use_persistent_claude`, the session menu's **🔄 Update Claude Code**
  item showed the latest release as "up to date" whenever the installed
  version was unknown: on a CPU without x86-64-v2 (where the app does not run
  Claude to ask) or when the binary was missing. It now says the installed
  version was not checked on this CPU, or is unknown.
```

- [x] **Step 3: Release-Notes** `docs/release-notes-3.1.2.md`:

```markdown
## Update menu no longer claims "up to date" without knowing

With `use_persistent_claude`, the session menu's **🔄 Update Claude Code** item showed the latest release as "up to date" even when it could not tell which version was installed — on a CPU without x86-64-v2, or when the Claude binary was missing. It now says so instead.

Full details: [CHANGELOG](https://github.com/Eifel-Joe/claude-workbench/blob/main/claude-workbench/CHANGELOG.md).
```

- [x] **Step 4: Prüfen**

Run: `bash tests/test-release-metadata.sh` → grün; `git ls-files --eol | grep -c "crlf\|mixed"` → `0`.

- [x] **Step 5: Commit**

```bash
git add claude-workbench/config.yaml README.md claude-workbench/CHANGELOG.md docs/release-notes-3.1.2.md
git commit -m "chore(release): 3.1.2"
```

### Task 4: Review, CI, HA-Test, Release (je mit Freigabe)

- [x] **Step 1:** Code-Review per Subagent (`superpowers:requesting-code-review`) über `main..fix/picker-update-label` gegen Spec und Plan.
- [ ] **Step 2:** Push des Branches (Freigabe), CI über `gh run list --repo Eifel-Joe/claude-workbench --branch fix/picker-update-label` (bei zwei Läufen den zweiten nehmen) → grün.
- [ ] **Step 3:** Merge nach `main` (`--no-ff`), Push (Freigabe), CI auf `main` grün.
- [ ] **Step 4:** HA-Test: `ha_manage_app` check_updates, dann update auf 3.1.2; App-Log prüfen. User prüft im Picker (bei `use_persistent_claude: true`) das Label auf CPU-Typ `host`: zeigt die installierte Version wie bisher.
- [ ] **Step 5:** Tag `v3.1.2` und GitHub-Release mit `docs/release-notes-3.1.2.md` (Freigabe).
- [ ] **Step 6:** `docs/SESSION-STAND.md` ergänzen, Memory `claude-code-ha-followups` aktualisieren, `.tmp/` leeren.
