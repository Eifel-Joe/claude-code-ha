# Spec: Zeitgrenzen für Netzwerk-Schritte beim Start, README-Credential-Pfad

Stand: 2026-10-06 · Ziel-Version: 2.2.2 · Status: Entwurf im Chat bestätigt
(Folgepunkte 4 und 6 aus Memory `claude-code-ha-followups`)

## Problem

`run.sh` führt vor `start_web_terminal` Schritte aus, die ins Netz gehen und keine
Zeitgrenze haben. Hängt einer (Registry, Mirror, DNS), startet ttyd nie und das
Panel bleibt leer — ohne Hinweis im Log, warum.

| Stelle | Aufruf |
|---|---|
| `setup_persistent_claude` (run.sh ~344) | `npm install -g @anthropic-ai/claude-code@latest --prefer-online` bei `auto_update_claude_on_start` (Standard an) |
| `start_web_terminal` (run.sh ~551) | `npm install` für den Image-Service, nur wenn `node_modules` fehlt |
| `auto_install_packages` (run.sh ~430–456) | `persist-install <pkg>` je apk-Paket; `persist-install --python <alle>` in einem Aufruf |

Außerdem behaupten `claude-terminal/README.md:81` (App-Beschreibung im Store) und
die Projekt-`CLAUDE.md`, Credentials lägen in `/config/claude-config/`. Tatsächlich:
`/data/home/.claude` (`run.sh` exportiert `HOME=/data/home`,
`ANTHROPIC_CONFIG_DIR=/data/.config/claude`, `ANTHROPIC_HOME=/data`); DOCS.md ist
bereits korrekt.

## Entscheidung

Eine Hilfsfunktion in `run.sh`:

```
run_with_timeout <sekunden> <bezeichnung> <befehl…>
```

- nutzt `timeout`, wenn vorhanden (wie der bestehende `--version`-Check), sonst
  läuft der Befehl ohne Grenze;
- gibt den Exit-Status des Befehls zurück;
- erkennt einen Abbruch an der verstrichenen Zeit (`$SECONDS`), nicht am
  Exit-Code: GNU `timeout` liefert 124, BusyBox-`timeout` (Alpine-Basis, coreutils
  ist im Image nicht installiert) liefert den Signal-Status. Bei Abbruch:
  `bashio::log.warning "<bezeichnung> timed out after <n>s"`.

Zeitgrenzen (Variablen in `run.sh`, nur für Tests per Umgebung überschreibbar):

| Variable | Standard | Verwendet für |
|---|---|---|
| `STARTUP_NPM_TIMEOUT` | 300 | Claude-Update, Image-Service-`npm install` |
| `STARTUP_APK_TIMEOUT` | 300 | je apk-Paket |
| `STARTUP_PIP_TIMEOUT` | 900 | pip-Aufruf (Kompilieren auf dem Pi) |

Bestehende Fehlerpfade bleiben: Claude-Update → „update failed, continuing…", der
`--version`-Selbsttest verwirft eine halb installierte Version, dann läuft die
eingebaute; Paket → „Failed to install: …", nächstes Paket läuft weiter.
Umgebungsvariablen für npm werden per `env` gesetzt, nicht als Präfix vor einer
Shell-Funktion.

README Z. 81 und `CLAUDE.md` (Abschnitte Key Components, Credential System, Key
Environment Variables): Pfade/Variablen auf den tatsächlichen Stand korrigieren.

Verworfen: Netzwerk-Schritte in den Hintergrund und Terminal sofort starten —
Claude könnte starten, während npm das Binary austauscht; größerer Umbau.

## Nicht dabei

- Menüpunkt „Update Claude Code" im Session-Picker (interaktiv, Strg+C möglich).
- Eigene Zeitgrenze für `pip install --upgrade pip` in `persist-install` (durch die
  900 s des ganzen pip-Aufrufs abgedeckt).
- Optionen in `config.yaml` für die Zeitgrenzen.
- `DEVELOPMENT.md`, `DEVELOPMENT_STATUS.md` (insgesamt veraltete Entwickler-Doku).

## Tests

Neue Suite `tests/test-startup-timeouts.sh` (läuft lokal unter Git Bash, keine
Symlinks), in `tests/run-tests.sh` eingehängt:
- `run_with_timeout`: schneller Erfolg → 0, keine Warnung; schneller Fehler →
  Status erhalten, keine Timeout-Warnung; hängender Befehl bei Grenze 1 s → kehrt
  zurück, Status ≠ 0, Warnung „… timed out after 1s".
- `setup_persistent_claude` mit `auto_update_claude_on_start=true` und hängendem
  `npm`-Stub → kehrt zurück, Timeout-Warnung geloggt.
- `auto_install_packages`: hängendes apk-Paket → Warnung, nächstes Paket wird
  installiert; hängender pip-Aufruf → kehrt zurück, Warnung.
- Image-Service: `start_web_terminal` ruft `npm install` über `run_with_timeout`
  auf (Strukturprüfung per `grep`, die Funktion startet Server).

`tests/test-release-metadata.sh`: README und `CLAUDE.md` nennen `/config/claude-config/`
nicht als Credential-Speicherort.

Ende-zu-Ende: CI grün; HA-Test auf 2.2.2, im App-Log „Persistent Claude override:
update completed" und Panel startet normal. Ein echter Hänger wird auf HA nicht
provoziert.

## Release

2.2.2: `config.yaml`, `build.yaml`, CHANGELOG (🐛 Bug Fix + 📚 Documentation).
