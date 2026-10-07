# Spec: Proxy ohne DEP0060, `map` ohne Warnung, Erklärungstexte (3.0.1)

Stand: 2026-10-07 · Ziel-Version: 3.0.1 · Status: Entwurf im Chat bestätigt
(Folgepunkte 15, 17, 18 aus Memory `claude-code-ha-followups`)

## Problem

1. **DEP0060 im App-Log.** Node meldet `DeprecationWarning: The util._extend API
   is deprecated`. Quelle: `http-proxy` 1.18.1 (`lib/http-proxy/index.js:2`,
   `common.js:3`), seit 2020 ungepflegt, gezogen über
   `http-proxy-middleware` 2.0.10 (`claude-workbench/image-service`). Auch
   `http-proxy-middleware` 3.x hängt an `http-proxy`; erst 4.x nutzt `httpxy`.
2. **Supervisor-Warnung** (HA-Test, seit 3.0.0 gesehen): „App 'Claude
   Workbench' uses deprecated map option 'config'; use 'homeassistant_config'
   instead.“ Quelle: `map: - config:rw` in `config.yaml`
   (Supervisor `apps/validate.py`, Migration „2023-10“).
3. **Optionen ohne Erklärung.** HA zeigt in der Konfiguration nur die rohen
   Namen (`tmux_mouse` …), weil `claude-workbench/translations/` fehlt. Der
   User musste nachfragen, wofür `tmux_mouse` ist.

## Entscheidungen

| Frage | Entscheidung | Verworfen |
|---|---|---|
| DEP0060 | `http-proxy-middleware` → **4.2** (ESM, `httpxy`), Optionen auf v4-API | npm-`overrides` `http-proxy` → `http-proxy-3` (Alias-Trick, bleibt auf hpm 2); Warnung per `--no-deprecation` stummschalten (versteckt nur) |
| `map` | `homeassistant_config` mit **`path: /config`** | `homeassistant_config` ohne Pfad (Mount wanderte nach `/homeassistant`, Terminal/Doku/Nutzer erwarten `/config`) |
| Sprachen | **en + de** | nur en |
| Version | 3.0.1 (Patch, kein Verhaltenswechsel für Nutzer) | |

Belege `map`: Supervisor `apps/validate.py` (Regex `RE_VOLUME`, Warnung bei
`MappingType.CONFIG`, Dict-Form mit `type`/`read_only`/`path`) und
`docker/app.py` (Ziel `app_mapping[HOMEASSISTANT_CONFIG].path or
PATH_HOMEASSISTANT_CONFIG`, d. h. ohne `path` → `/homeassistant`).

Belege hpm 4: `npm view http-proxy-middleware@4.2.0` → `type: module`,
`engines.node: ^22.15.0 || ^24.0.0 || >=26.0.0`, Abhängigkeit `httpxy`.
Image: Node v22.23.2 (App-Log HA-Test 2026-10-07), CI: Node 22, lokal Node 24.

## Anforderungen

### 1. Proxy (`claude-workbench/image-service`)

- `package.json`: `"http-proxy-middleware": "^4.2.0"`; `package-lock.json`
  per `npm install` neu erzeugt; kein `node_modules/http-proxy` mehr im Lockfile.
- `server.js` bleibt CommonJS; `require('http-proxy-middleware')` lädt das
  ES-Modul (require(esm), Node ≥ 22.12). Falls das in der CI (Node 22) eine
  Warnung ausgibt, Umstellung auf dynamisches `import()` — der neue Test
  (unten) deckt das auf.
- Proxy-Optionen auf v4:
  - Fehlerbehandlung unter `on: { error }`, Verhalten wie bisher: HTTP → 502
    „Failed to connect to terminal“, WebSocket → Socket schließen.
  - Logging über `logger`, nur Warnungen/Fehler (bisher `logLevel: 'warn'`).
  - Pfad: `/terminal`-Präfix wird für HTTP (Express-Mount) und WebSocket
    (`server.on('upgrade', …)`, roher Pfad) korrekt entfernt.
  - Ziel weiter `http://127.0.0.1:${TTYD_PORT}`, `ws: true`, `changeOrigin`.
- Tests (`tests/test-image-service.js`):
  - RED: neuer Test startet den Dienst, schickt eine HTTP-Anfrage und eine
    WebSocket-Verbindung durch `/terminal` und verlangt, dass stderr keine
    `DeprecationWarning` und kein `DEP0060` enthält.
  - Bestehende 9 Tests (HTTP-Proxy, WebSocket als erste Anfrage …) bleiben
    grün. Vorab neue Schutztests (beim Planen ergänzt — einen Fehlerfall-Test
    gab es noch nicht): Pfad ohne `/terminal` bei HTTP und WebSocket, 502
    „Failed to connect to terminal“ bei nicht erreichbarem ttyd.
- Metadaten-Test: Lockfile enthält kein `"node_modules/http-proxy"`.

### 2. `map` in `config.yaml`

```yaml
map:
  - type: homeassistant_config
    read_only: false
    path: /config
  - all_app_configs:rw
```

- Kommentare wie bisher (HA-Konfiguration bzw. Configs anderer Apps).
- Metadaten-Test: `config.yaml` enthält `type: homeassistant_config` mit
  `path: /config` und `read_only: false`; ein String-Eintrag `config:` (mit
  oder ohne `:rw`/`:ro`) lässt ihn fehlschlagen.
- `tests/test-release-metadata.sh` liest `config.yaml` bisher per `sed`; die
  YAML-Prüfung in der CI (`Validate add-on YAML`) bleibt.

### 3. Erklärungstexte

`claude-workbench/translations/en.yaml` und `de.yaml`, Format:

```yaml
configuration:
  <option>:
    name: …
    description: …
```

Texte:

| Option | de: name / description | en: name / description |
|---|---|---|
| `auto_launch_claude` | Claude automatisch starten / Öffnet Claude Code direkt beim Öffnen des Panels. Aus: zuerst das Sitzungsmenü. | Start Claude automatically / Opens Claude Code as soon as you open the panel. Off: shows the session menu first. |
| `remote_control` | Remote Control / Startet Claude mit Remote Control, damit du die Sitzung über claude.ai/code oder die Claude-App steuern kannst. Wirkt nur mit „Claude automatisch starten“. | Remote Control / Starts Claude with Remote Control so you can drive the session from claude.ai/code or the Claude app. Only works with “Start Claude automatically”. |
| `remote_control_session_name` | Name der Remote-Sitzung / Fester Titel der Sitzung in der Sitzungsliste. Leer: Claude vergibt einen Namen. | Remote session name / Fixed title for the session in the session list. Empty: Claude picks a name. |
| `tmux_mouse` | Maus in tmux / An: Mausrad und Wischen scrollen im Claude-Verlauf; Links nur über 🔗 Copy link, Markieren mit gedrückter Umschalttaste. Aus: normales Markieren und klickbare Links. | Mouse in tmux / On: mouse wheel and swiping scroll Claude's history; open links with 🔗 Copy link, select text while holding Shift. Off: normal selection and clickable links. |
| `dangerously_skip_permissions` | Ohne Rückfragen ausführen / Claude führt Befehle und Dateiänderungen ohne Bestätigung aus. Nur nutzen, wenn du jedem Schritt vertraust. | Run without asking / Claude runs commands and edits files without asking first. Only use this if you trust every step. |
| `persistent_apk_packages` | Dauerhafte Systempakete / Alpine-Pakete (apk), die bei jedem Start installiert werden und Neustarts überstehen, z. B. git oder vim. | Persistent system packages / Alpine packages (apk) installed on every start and kept across restarts, e.g. git or vim. |
| `persistent_pip_packages` | Dauerhafte Python-Pakete / Python-Pakete (pip), die bei jedem Start in die dauerhafte Python-Umgebung installiert werden. | Persistent Python packages / Python packages (pip) installed on every start into the persistent Python environment. |
| `use_persistent_claude` | Claude Code in /data aktuell halten / Installiert Claude Code in den dauerhaften Speicher, damit neue Versionen und Modelle ohne neues App-Image ankommen. | Keep Claude Code current in /data / Installs Claude Code in persistent storage so new versions and models arrive without a new app image. |
| `auto_update_claude_on_start` | Claude Code beim Start aktualisieren / Aktualisiert Claude Code bei jedem Start. Wirkt nur mit „Claude Code in /data aktuell halten“; aus: nur über das Sitzungsmenü. | Update Claude Code on start / Updates Claude Code on every start. Only with “Keep Claude Code current in /data”; off: update from the session menu only. |

- Metadaten-Test: jede Option unter `options:` in `config.yaml` hat in beiden
  Dateien einen `name:` und eine `description:`; Dateien fehlen → Fehlschlag.

### 4. Release

- `config.yaml` 3.0.1, README-Badge, CHANGELOG-Eintrag, Release-Notes
  `docs/release-notes-3.0.1.md`.

## Nicht enthalten

- Weitere Abhängigkeits-Updates (Express 5, multer …).
- Neue Optionen oder Verhaltensänderungen.
- Übersetzung weiterer Texte (Log, Session-Picker, Doku).

## Ende-zu-Ende-Kriterium

1. CI grün (Tests inkl. neuem Deprecation-Test, Image-Build amd64/aarch64).
2. HA-Test nach Update auf 3.0.1:
   - Supervisor-Log ohne „deprecated map option 'config'“ für Claude Workbench.
   - App-Log ohne `DEP0060` / `DeprecationWarning`.
   - Terminal öffnet sich (Panel), Claude startet; im Terminal ist `/config`
     die HA-Konfiguration (`ls /config/configuration.yaml`).
   - Konfigurationsseite der App zeigt die deutschen Namen und Erklärungen.
3. HA-Prod: Update durch den User, danach Supervisor- und App-Log per MCP.
