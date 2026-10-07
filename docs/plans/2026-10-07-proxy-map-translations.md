# Proxy ohne DEP0060, `map` ohne Warnung, Erklärungstexte (3.1.0) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Release 3.1.0: `http-proxy-middleware` 4 statt 2 (kein `util._extend`/DEP0060 mehr), `map` mit `homeassistant_config` und `path: /config` (keine Supervisor-Warnung), Erklärungstexte für alle Optionen auf Deutsch und Englisch.

**Architecture:** Erst Schutztests für das bestehende Proxy-Verhalten (Pfad-Weitergabe HTTP/WebSocket, 502 bei totem ttyd), dann ein RED-Test „keine Deprecation-/Experimental-Warnung auf stderr“, dann das Upgrade. `map` und Übersetzungen werden über `tests/test-release-metadata.sh` festgehalten.

**Tech Stack:** Node 22/24 (`node:test`), Express 4, http-proxy-middleware 4 (ESM, per `require()` geladen), Bash, YAML.

**Spec:** `docs/specs/2026-10-07-proxy-map-translations-design.md`

**Arbeitsregeln (auch für Subagenten):**
- Branch `fix/proxy-map-translations` (existiert, Spec-Commit `68bb327`).
- Keine Temp-Dateien auf C:. Jede Shell vor Tests/npm:
  `export TMPDIR=/d/Entwicklung/Claude-Code-HA/.tmp TMP='D:\Entwicklung\Claude-Code-HA\.tmp' TEMP='D:\Entwicklung\Claude-Code-HA\.tmp' npm_config_cache='D:\Entwicklung\Claude-Code-HA\.tmp\npm-cache'`
- Mehrzeilige Ersetzungen mit dem Edit-Tool, nicht per Heredoc im Bash-Tool. Ergebnis per `git diff` prüfen.
- Nach jeder Änderung: `git ls-files --eol | grep -c "crlf\|mixed"` → `0`.
- `gh` immer mit `--repo Eifel-Joe/claude-workbench`.
- Push, Tag, Release und gh-Texte nur nach Freigabe im Chat.

**Lokale Suiten** („lokale Suiten“ in den Schritten):
```bash
bash tests/test-release-metadata.sh
bash tests/test-persist-install.sh
bash tests/test-startup-timeouts.sh
node tests/test-terminal-clipboard.js
PATH="/c/WINDOWS/system32:$PATH" node --test tests/test-app-migration.js
node --test tests/test-image-service.js
shellcheck -S warning -e SC1008,SC1007,SC2155 -x claude-workbench/run.sh claude-workbench/scripts/*.sh claude-workbench/scripts/persist-install tests/*.sh
```
Bekannt: `test-image-service.js` endet unter Windows mit Exit 1 durch ein nachlaufendes `ECONNRESET` nach dem WebSocket-Test, obwohl alle Tests `pass` sind; maßgeblich sind `ℹ pass`/`ℹ fail`. In der CI grün.

---

### Task 1: Schutztests für das heutige Proxy-Verhalten (grün auf hpm 2)

**Files:**
- Modify: `tests/test-image-service.js`

- [x] **Step 1: ttyd-Stub merkt sich die Upgrade-Pfade** — in `test.before` den Upgrade-Handler erweitern; oben bei den `let`-Variablen `let ttydUpgradeUrls = [];` ergänzen:

```js
    ttyd.on('upgrade', (req, socket) => {
        ttydUpgrades++;
        ttydUpgradeUrls.push(req.url);
```

- [x] **Step 2: Pfad-Assertion im WebSocket-Test** — im Test `/terminal forwards a WebSocket upgrade to ttyd` nach der letzten Assertion:

```js
    assert.strictEqual(ttydUpgradeUrls.at(-1), '/ws', 'the /terminal prefix must be stripped for WebSocket upgrades');
```

- [x] **Step 3: Neuer Test HTTP-Pfad** — direkt nach `/terminal proxies HTTP through to ttyd`:

```js
test('/terminal strips its prefix before forwarding HTTP to ttyd', async () => {
    const res = await fetch(`http://127.0.0.1:${PORT}/terminal/token?x=1`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(await res.text(), 'ttyd-stub:/token?x=1');
});
```

- [x] **Step 4: Neuer Test 502 bei totem ttyd** — am Dateiende:

```js
test('/terminal answers 502 when ttyd is not reachable', async () => {
    const port = await freePort();
    const deadTtydPort = await freePort(); // nothing listens here
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-502-'));
    const proc = spawn(process.execPath, [SERVER], {
        cwd: SERVICE_DIR,
        env: {
            ...process.env,
            IMAGE_SERVICE_PORT: String(port),
            TTYD_PORT: String(deadTtydPort),
            UPLOAD_DIR: dir
        },
        stdio: 'ignore'
    });
    try {
        assert.ok(await waitForHealth(port), 'instance never became healthy');
        const res = await fetch(`http://127.0.0.1:${port}/terminal/`);
        assert.strictEqual(res.status, 502);
        assert.strictEqual(await res.text(), 'Failed to connect to terminal');
    } finally {
        proc.kill('SIGKILL');
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
```

- [x] **Step 5: Lauf** — `node --test tests/test-image-service.js`
  Expected: `ℹ pass 11`, `ℹ fail 0` (9 bisher + 2 neu). Falls ein Schutztest auf hpm 2 rot ist: STOP — dann beschreibt er nicht das heutige Verhalten; Erwartung mit dem tatsächlichen Verhalten abgleichen, bevor weitergemacht wird.

- [x] **Step 6: Commit**

```bash
git add tests/test-image-service.js
git commit -m "test(image-service): pin proxy path forwarding and the 502 on a dead ttyd

Guards for the http-proxy-middleware upgrade: the /terminal prefix is
stripped for HTTP and WebSocket, and an unreachable ttyd still answers
502 'Failed to connect to terminal'.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Keine Deprecation-Warnung — http-proxy-middleware 4

**Files:**
- Modify: `tests/test-image-service.js`, `tests/test-release-metadata.sh`
- Modify: `claude-workbench/image-service/package.json`, `claude-workbench/image-service/package-lock.json`, `claude-workbench/image-service/server.js:22,103-117,151-155`

- [x] **Step 1: stderr des Dienstes sammeln** — in `tests/test-image-service.js` bei den `let`-Variablen `let serviceStderr = '';` und in `test.before` die stderr-Zeile ersetzen:

```js
    child.stderr.on('data', (d) => {
        serviceStderr += d;
        process.stderr.write(`[service] ${d}`);
    });
```

- [x] **Step 2: RED-Test** — als letzten Test vor dem 502-Test einfügen (läuft nach den HTTP- und WebSocket-Tests derselben Instanz):

```js
// http-proxy 1.x (pulled in by http-proxy-middleware 2/3) calls util._extend,
// which Node reports as DEP0060 in the app log. Loading the ESM-only
// http-proxy-middleware 4 through require() must not warn either.
test('the service proxies without deprecation or experimental warnings', () => {
    assert.doesNotMatch(serviceStderr, /DeprecationWarning|ExperimentalWarning|DEP0060/);
});
```

- [x] **Step 3: Lockfile-Schutz** — in `tests/test-release-metadata.sh` vor `echo "Release metadata suite passed …"`:

```bash
# http-proxy 1.x is unmaintained and calls util._extend (DEP0060 in the app
# log); http-proxy-middleware 4 replaced it with httpxy.
if grep -n '"node_modules/http-proxy"' "$addon_dir/image-service/package-lock.json"; then
    fail "image-service still installs http-proxy (util._extend, DEP0060); use http-proxy-middleware 4"
fi
```

- [x] **Step 4: RED prüfen**
  - `node --test tests/test-image-service.js` → der neue Test schlägt fehl, Meldung enthält `DEP0060`.
  - `bash tests/test-release-metadata.sh` → `FAIL (release metadata): image-service still installs http-proxy …`
  - Falls der Image-Service-Test **nicht** rot wird (Warnung erscheint nicht): STOP, Ursache klären (wird `util._extend` nur in bestimmten Pfaden gerufen?) und den Test so anpassen, dass er die Warnung im App-Log tatsächlich reproduziert.

- [x] **Step 5: Upgrade**

```bash
cd claude-workbench/image-service && npm install http-proxy-middleware@^4.2.0 && cd ../..
grep -n '"http-proxy-middleware"' claude-workbench/image-service/package.json
grep -c '"node_modules/http-proxy"' claude-workbench/image-service/package-lock.json
```
Expected: `"http-proxy-middleware": "^4.2.0"`, Zähler `0`.

- [x] **Step 6: `server.js` auf die v4-API** — den Block `const terminalProxy = createProxyMiddleware({ … });` ersetzen (Kommentar darüber bleibt):

```js
const terminalProxy = createProxyMiddleware({
    target: `http://127.0.0.1:${TTYD_PORT}`,
    changeOrigin: true,
    ws: true, // Enable WebSocket proxying
    // Express strips the /terminal mount from req.url for HTTP; WebSocket
    // upgrades come through server.on('upgrade') with the raw path, so the
    // prefix is removed here for those.
    pathRewrite: {
        '^/terminal': ''
    },
    on: {
        error: (err, req, res) => {
            console.error('Proxy error:', err.message);
            // res may be a raw socket (WebSocket) instead of an Express response
            if (typeof res.status === 'function') {
                res.status(502).send('Failed to connect to terminal');
            } else if (typeof res.end === 'function') {
                res.end();
            }
        }
    },
    // Warnings and errors only (logLevel: 'warn' in http-proxy-middleware 2).
    logger: { info: () => {}, warn: console.warn, error: console.error }
});
```

Den Kommentar über `server.on('upgrade', terminalProxy.upgrade);` prüfen: er beschreibt das interne Flag von http-proxy-middleware; in v4 existiert `upgrade` weiterhin (der Test „WebSocket upgrade … very first proxy request“ belegt es). Bei Bedarf Versionsbezug im Kommentar anpassen.

- [x] **Step 7: GREEN**
  - `node --test tests/test-image-service.js` → `ℹ pass 12`, `ℹ fail 0`.
  - `bash tests/test-release-metadata.sh` → grün.
  - Wenn ein Pfad-Test rot ist: `pathRewrite` gegen das tatsächliche `req.url` in v4 prüfen (Debug-Ausgabe des Stubs), nicht raten.
  - Wenn der Warnungs-Test wegen `ExperimentalWarning` (require(esm)) rot ist: `server.js` lädt das Modul per `const { createProxyMiddleware } = await import('http-proxy-middleware')` in einer async-Startfunktion; erneut laufen lassen.
- [x] **Step 8: Audit wie in der CI** — `cd claude-workbench/image-service && node ../../.github/scripts/audit-image-service.js; cd ../..` → `npm audit: no blocking advisories …`. Ist der Allowlist-Eintrag `GHSA-vfj7-8cjw-p6xm` (braces) nicht mehr nötig, bleibt er trotzdem (harmlos); Kommentar nur anpassen, wenn er falsch geworden ist.
- [x] **Step 9: Lokale Suiten** grün.
- [x] **Step 10: Commit**

```bash
git add tests/test-image-service.js tests/test-release-metadata.sh claude-workbench/image-service/package.json claude-workbench/image-service/package-lock.json claude-workbench/image-service/server.js
git commit -m "fix(image-service): http-proxy-middleware 4, no more DEP0060 in the app log

http-proxy 1.x, pulled in by http-proxy-middleware 2, calls util._extend
and is unmaintained; version 4 uses httpxy. Options moved to the v4 API
(on.error, logger); a test checks the service logs no deprecation or
experimental warning.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `map` ohne Supervisor-Warnung

**Files:**
- Modify: `tests/test-release-metadata.sh`, `claude-workbench/config.yaml` (Block `map:`)

- [x] **Step 1: Test** — vor `echo "Release metadata suite passed …"`:

```bash
# Supervisor 2023-10: "config" became "homeassistant_config" and logs a
# deprecation warning on every store reload. Without an explicit path that
# mount lands in /homeassistant, while the terminal, the docs and every user
# expect the Home Assistant configuration in /config.
if grep -nE '^\s+-\s+config(:(rw|ro))?(\s|$)' "$addon_dir/config.yaml"; then
    fail "config.yaml maps the deprecated 'config' option; use homeassistant_config with path /config"
fi
ha_map=$(grep -A2 -E '^\s+- type: homeassistant_config\s*$' "$addon_dir/config.yaml" || true)
printf '%s\n' "$ha_map" | grep -qE '^\s+read_only: false\s*$' && \
    printf '%s\n' "$ha_map" | grep -qE '^\s+path: /config\s*$' || \
    fail "config.yaml needs '- type: homeassistant_config' with read_only: false and path: /config"
```

- [x] **Step 2: RED** — Expected: Zeile `  - config:rw …` wird gelistet, dann `FAIL (release metadata): config.yaml maps the deprecated 'config' option …`

- [x] **Step 3: `config.yaml`** — den `map:`-Block ersetzen durch:

```yaml
map:
  # Home Assistant configuration, read-write, mounted at /config as before
  # (homeassistant_config defaults to /homeassistant)
  - type: homeassistant_config
    read_only: false
    path: /config
  - all_app_configs:rw    # Config/data folders of all other apps (e.g. AppDaemon, Node-RED, ESPHome)
```

- [x] **Step 4: GREEN** — `bash tests/test-release-metadata.sh` grün. YAML-Syntax wie die CI prüfen: `python -c "import yaml; yaml.safe_load(open('claude-workbench/config.yaml'))"` (ohne Fehler; falls PyYAML lokal fehlt, übernimmt die CI-Prüfung „Validate add-on YAML“).
- [x] **Step 5: Commit**

```bash
git add tests/test-release-metadata.sh claude-workbench/config.yaml
git commit -m "fix: map the HA configuration as homeassistant_config at /config

The Supervisor warns that the 'config' map option is deprecated. The
replacement mounts at /homeassistant by default, so the path stays /config
explicitly; nothing changes for users.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Erklärungstexte (en, de)

**Files:**
- Modify: `tests/test-release-metadata.sh`
- Create: `claude-workbench/translations/en.yaml`, `claude-workbench/translations/de.yaml`

- [x] **Step 1: Test** — vor `echo "Release metadata suite passed …"`:

```bash
# Without translations Home Assistant shows bare option names (tmux_mouse …)
# with no explanation. Every option needs a name and a description in each
# language, so a new option cannot ship unexplained.
option_keys=$(sed -n '/^options:/,/^[a-z]/{s/^  \([a-z_]*\):.*/\1/p;}' "$addon_dir/config.yaml")
[ -n "$option_keys" ] || fail "could not read the option names from config.yaml"
for lang in en de; do
    tr_file="$addon_dir/translations/$lang.yaml"
    [ -f "$tr_file" ] || fail "translations/$lang.yaml is missing; Home Assistant shows bare option names without it"
    while IFS= read -r key; do
        entry=$(grep -A2 -E "^  $key:\s*$" "$tr_file" || true)
        printf '%s\n' "$entry" | grep -qE '^    name: .+' && \
            printf '%s\n' "$entry" | grep -qE '^    description: .+' || \
            fail "translations/$lang.yaml has no name and description for '$key'"
    done <<< "$option_keys"
done
```

- [x] **Step 2: RED** — Expected: `FAIL (release metadata): translations/en.yaml is missing; …`

- [x] **Step 3: `claude-workbench/translations/en.yaml`** (Write-Tool):

```yaml
configuration:
  auto_launch_claude:
    name: "Start Claude automatically"
    description: "Opens Claude Code as soon as you open the panel. Off: shows the session menu first."
  remote_control:
    name: "Remote Control"
    description: "Starts Claude with Remote Control so you can drive the session from claude.ai/code or the Claude app. Only works with “Start Claude automatically”."
  remote_control_session_name:
    name: "Remote session name"
    description: "Fixed title for the session in the session list. Empty: Claude picks a name."
  tmux_mouse:
    name: "Mouse in tmux"
    description: "On: mouse wheel and swiping scroll Claude's history; open links with 🔗 Copy link, select text while holding Shift. Off: normal selection and clickable links."
  dangerously_skip_permissions:
    name: "Run without asking"
    description: "Claude runs commands and edits files without asking first. Only use this if you trust every step."
  persistent_apk_packages:
    name: "Persistent system packages"
    description: "Alpine packages (apk) installed on every start and kept across restarts, e.g. git or vim."
  persistent_pip_packages:
    name: "Persistent Python packages"
    description: "Python packages (pip) installed on every start into the persistent Python environment."
  use_persistent_claude:
    name: "Keep Claude Code current in /data"
    description: "Installs Claude Code in persistent storage so new versions and models arrive without a new app image."
  auto_update_claude_on_start:
    name: "Update Claude Code on start"
    description: "Updates Claude Code on every start. Only with “Keep Claude Code current in /data”; off: update from the session menu only."
```

- [x] **Step 4: `claude-workbench/translations/de.yaml`** (Write-Tool):

```yaml
configuration:
  auto_launch_claude:
    name: "Claude automatisch starten"
    description: "Öffnet Claude Code direkt beim Öffnen des Panels. Aus: zuerst das Sitzungsmenü."
  remote_control:
    name: "Remote Control"
    description: "Startet Claude mit Remote Control, damit du die Sitzung über claude.ai/code oder die Claude-App steuern kannst. Wirkt nur mit „Claude automatisch starten“."
  remote_control_session_name:
    name: "Name der Remote-Sitzung"
    description: "Fester Titel der Sitzung in der Sitzungsliste. Leer: Claude vergibt einen Namen."
  tmux_mouse:
    name: "Maus in tmux"
    description: "An: Mausrad und Wischen scrollen im Claude-Verlauf; Links nur über 🔗 Copy link, Markieren mit gedrückter Umschalttaste. Aus: normales Markieren und klickbare Links."
  dangerously_skip_permissions:
    name: "Ohne Rückfragen ausführen"
    description: "Claude führt Befehle und Dateiänderungen ohne Bestätigung aus. Nur nutzen, wenn du jedem Schritt vertraust."
  persistent_apk_packages:
    name: "Dauerhafte Systempakete"
    description: "Alpine-Pakete (apk), die bei jedem Start installiert werden und Neustarts überstehen, z. B. git oder vim."
  persistent_pip_packages:
    name: "Dauerhafte Python-Pakete"
    description: "Python-Pakete (pip), die bei jedem Start in die dauerhafte Python-Umgebung installiert werden."
  use_persistent_claude:
    name: "Claude Code in /data aktuell halten"
    description: "Installiert Claude Code in den dauerhaften Speicher, damit neue Versionen und Modelle ohne neues App-Image ankommen."
  auto_update_claude_on_start:
    name: "Claude Code beim Start aktualisieren"
    description: "Aktualisiert Claude Code bei jedem Start. Wirkt nur mit „Claude Code in /data aktuell halten“; aus: nur über das Sitzungsmenü."
```

- [x] **Step 5: GREEN** — `bash tests/test-release-metadata.sh` grün. Gegenprobe: in `de.yaml` vorübergehend die `description:` von `tmux_mouse` löschen → `FAIL … no name and description for 'tmux_mouse'`; dann `git checkout -- claude-workbench/translations/de.yaml` ist nicht möglich (neue Datei) → Änderung per Edit-Tool rückgängig machen und erneut grün laufen lassen. YAML-Syntax: `python -c "import yaml; [yaml.safe_load(open(f, encoding='utf-8')) for f in ('claude-workbench/translations/en.yaml','claude-workbench/translations/de.yaml')]"`.
- [x] **Step 6: Commit**

```bash
git add tests/test-release-metadata.sh claude-workbench/translations/en.yaml claude-workbench/translations/de.yaml
git commit -m "feat: explain every app option in English and German

Home Assistant showed bare option names such as tmux_mouse; the
translations add a name and a one-line description. A metadata test
requires both for every option in config.yaml.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Version 3.1.0, Changelog, Release-Notes

**Files:**
- Modify: `claude-workbench/config.yaml` (`version`), `README.md` (Badge), `claude-workbench/CHANGELOG.md`
- Create: `docs/release-notes-3.1.0.md`

- [x] **Step 1: RED** — `version: "3.1.0"` setzen, `bash tests/test-release-metadata.sh` → `FAIL … CHANGELOG.md has no '## 3.1.0' section …`
- [x] **Step 2: CHANGELOG** — oberhalb von `## 3.0.0`:

```markdown
## 3.1.0

### ✨ New Feature - Every option explained
- The app's Configuration tab shows a name and a short explanation for each
  option, in English and German, instead of bare names like `tmux_mouse`.

### 🐛 Bug Fix - No more warnings in the logs
- **App log**: the image service no longer logs `DEP0060 util._extend`. It
  came from `http-proxy`, unmaintained since 2020, pulled in by
  `http-proxy-middleware` 2; version 4 uses `httpxy` instead.
- **Supervisor log**: no more "uses deprecated map option 'config'". The Home
  Assistant configuration is mapped as `homeassistant_config`, still at
  `/config`, so nothing changes in the terminal.
```

- [x] **Step 3: Badge** — `README.md`: `badge/version-3.0.0-` → `badge/version-3.1.0-`.
- [x] **Step 4: `docs/release-notes-3.1.0.md`** (Write-Tool):

```markdown
## Every option explained, no more log warnings

### Options with explanations
The Configuration tab now shows a name and a short explanation for every option — in English and German — instead of bare names like `tmux_mouse`.

### Cleaner logs
- The app log no longer shows `DEP0060 util._extend`: the terminal proxy moved from `http-proxy-middleware` 2 (with the unmaintained `http-proxy`) to version 4.
- The Supervisor log no longer warns about the deprecated `config` map option. The Home Assistant configuration stays at `/config`.

Just update — no other changes.

Full details: [CHANGELOG](https://github.com/Eifel-Joe/claude-workbench/blob/main/claude-workbench/CHANGELOG.md).
```

- [x] **Step 5: GREEN** — `bash tests/test-release-metadata.sh` → `Release metadata suite passed (version 3.1.0)`; lokale Suiten grün.
- [x] **Step 6: Commit**

```bash
git add claude-workbench/config.yaml claude-workbench/CHANGELOG.md README.md docs/release-notes-3.1.0.md
git commit -m "release: 3.1.0 - options explained, no warnings in the logs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Code-Review

- [x] **Step 1:** Subagent `superpowers:code-reviewer` mit Spec, Plan und `git diff main...fix/proxy-map-translations`; Temp-Regel (`.tmp/`, `npm_config_cache`) im Prompt. Prüfauftrag: v4-Optionen korrekt (Fehlerfall, Logger, Pfade HTTP/WS), require(esm) in Node 22 ohne Warnung, `map`-Dict gültig für den Supervisor, Übersetzungs-YAML gültig und vollständig, Bash-Tests ohne stilles Bestehen.
- [x] **Step 2:** Befunde über `superpowers:receiving-code-review` prüfen, berechtigte per TDD beheben.

---

### Task 7: Push, CI, Merge (Freigaben)

- [x] **Step 1:** Freigabe → `git push -u origin fix/proxy-map-translations`; CI beobachten (`gh run list --repo Eifel-Joe/claude-workbench --branch fix/proxy-map-translations --limit 1`, `gh run watch <id> --repo Eifel-Joe/claude-workbench --exit-status`). Expected: alle Jobs grün, Image-Service-Suite `# pass 12`, Audit ohne blockierende Advisories.
- [x] **Step 2:** `git switch main && git merge --no-ff fix/proxy-map-translations -m "Merge branch 'fix/proxy-map-translations': options explained, no log warnings (3.1.0)"`; lokale Suiten grün.
- [x] **Step 3:** Freigabe → `git push origin main`; CI auf `main` grün.

---

### Task 8: HA-Test

- [x] **Step 1:** `ha_manage_app check_updates` (HA-Test), dann `update` für `0e003122_claude_workbench`. Bei „Request timed out“ Supervisor-Log prüfen, nicht erneut auslösen.
- [x] **Step 2:** Supervisor-Log (`system_service`, `supervisor`, Suche `Claude Workbench`) ab dem Update: keine Zeile „deprecated map option“.
- [x] **Step 3:** App-Log: `state: started`, kein `DEP0060`/`DeprecationWarning`, „Image service is healthy“.
- [x] **Step 4:** User: Panel öffnen, Claude startet; im Terminal `ls /config/configuration.yaml` zeigt die Datei; Konfigurationstab zeigt die deutschen Namen/Erklärungen (Screenshot).

---

### Task 9: Release, Prod, Übergabe (Freigaben)

- [x] **Step 1:** Release-Text zeigen, Freigabe → `git tag v3.1.0 && git push origin v3.1.0`, `gh release create v3.1.0 --repo Eifel-Joe/claude-workbench --title "3.1.0 — Options explained, cleaner logs" --notes-file docs/release-notes-3.1.0.md`.
- [x] **Step 2:** User aktualisiert HA-Prod; danach per MCP Supervisor- und App-Log (wie Task 8, Steps 2–3).
- [x] **Step 3:** `docs/SESSION-STAND.md` ergänzen, Memory `claude-code-ha-followups` (15, 17, 18 erledigt), Plan abhaken; Commit, Push (Freigabe), gemergten Branch auf GitHub löschen (Freigabe).
