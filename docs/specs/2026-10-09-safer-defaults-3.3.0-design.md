# Spec: CI-Runner, Health-Check mit echtem Claude-Start, tmux-Ergänzungen, Sicherheits-Doku (3.3.0)

Stand: 2026-10-09 · Ziel-Version: 3.3.0 (neuer Befehl `claude-doctor`) · Status: Entwurf im Chat bestätigt
Quelle: offene Punkte aus `docs/FORK-SURVEY-heytcass.md` („Umsetzungsstand“) und dem
heytcass-Original (Folgepunkt 20). Befunde gegen `main` = `d2db73b9` geprüft.

## Probleme

1. **CI-Runner wechselt ungefragt.** `.github/workflows/ci.yml` (3 Jobs) und
   `claude.yml` laufen auf `ubuntu-latest`. GitHub stellt das Label ab 2026-10-19 auf
   Ubuntu 26 um (Hinweis im CI-Lauf 37909804599). Ein Bruch käme unangekündigt.
2. **Health-Check meldet „Claude ok“, obwohl Claude nicht läuft.**
   `scripts/health-check.sh:73` (`check_claude_cli`) prüft nur `command -v` und das
   x-Bit. Eine nicht startfähige Binary (libc-Fehler, CPU ohne x86-64-v2) bekommt
   einen grünen Haken. Der Zweig „nicht gefunden“ meldet „Attempting to install
   Claude CLI…“ (`:88`) und tut dann nichts.
3. **Health-Check ist im Terminal nicht aufrufbar.** Er läuft nur beim Start
   (`run.sh` `run_health_check`); wer im Terminal ein Problem hat, kennt den Pfad
   `/opt/scripts/health-check.sh` nicht.
4. **Eigene tmux-Einstellungen gehen still verloren.** `run.sh:330-358` (`setup_tmux`)
   überschreibt `~/.tmux.conf` bei jedem Start. Es gibt keinen Ort für eigene
   Einstellungen. Ohne `focus-events` erfahren Claude Code und vim nicht, wann das
   Fenster den Fokus hat.
5. **Browser kann nach einem Update alte Oberflächen-Dateien mischen.**
   `image-service/server.js:156` liefert `public/` (`index.html`,
   `terminal-clipboard.js`) per `express.static` mit dem Standard `max-age=0` aus.
   Laut owine (`67dd7e55`) nutzte Safari danach alte JS mit neuer HTML weiter.
6. **Die Sicherheits-Doku ist veraltet und verschweigt den Zugriffskreis.**
   `claude-workbench/README.md:133-139` („Version 1.0.2 includes …“) beschreibt
   einen Stand von 2025. Nirgends steht, dass jeder angemeldete HA-User das Panel
   öffnen kann.

## Belege zu 6

- HA-Core `dev` @ `bc163ce175` (2026-10-09), `homeassistant/components/hassio/`:
  `ingress.py` `HassIOIngress.requires_auth = False` (nur das Ingress-Session-Cookie
  zählt); `websocket_api.py` `WS_NO_ADMIN_ENDPOINTS` erlaubt Nicht-Admins
  `/ingress/session`, `/ingress/validate_session` und `/addons/<slug>/info`
  (Kommentar: „Endpoints needed for ingress can't require admin because add-ons can
  set `panel_admin: false`“, eingeführt mit home-assistant/core#60120).
- Supervisor `main` @ `2760df9b88`, `supervisor/api/ingress.py`: `panel_admin`
  geht nur in die Panel-Liste (`ATTR_ADMIN`), die Session prüft keine Rolle.
- Unser `config.yaml` setzt `panel_admin: true` – das blendet also nur den
  Seitenleisten-Eintrag aus.

## Entscheidungen

| # | Entscheidung | Verworfen |
|---|---|---|
| 1 | Alle 4 `runs-on` auf `ubuntu-24.04`; `tests/test-release-metadata.sh` verbietet `ubuntu-latest` in `.github/workflows/` | mitwandern mit `ubuntu-latest` (Bruch unangekündigt); `ubuntu-26.04` jetzt (neu, kein Nutzen) |
| 2a | `check_claude_cli` startet `claude --version` **einmal** mit `timeout 10`, Ausgabe in einer Variablen. Erfolg: „Claude CLI runs: <Version> ✓“. Fehler (auch Timeout): „Claude CLI is present but fails to run ✗“, danach die ersten 5 Zeilen der Ausgabe, Rückgabe 1 | zweimal starten wie heytcass (doppelte Wartezeit bei Hängern) |
| 2b | CPU-Gate: meldet `claude_cpu_missing_flags` etwas, wird `--version` nicht gestartet; Fehler „Claude CLI cannot run on this CPU (lacks …) ✗“, Rückgabe 1. Ohne `cpu-check.sh` (Funktion fehlt) läuft der Check normal | Start trotzdem (10 s Hänger beim Start und bei jedem `claude-doctor`) |
| 2c | Ohne `timeout`-Befehl läuft `--version` ohne Zeitgrenze (wie `run.sh:41`) | Check überspringen (verdeckt den eigentlichen Fall) |
| 2d | „Attempting to install Claude CLI…“ ersetzt durch „Restart the app: startup reinstalls Claude Code.“ | Zeile ersatzlos streichen (Nutzer bliebe ohne Weg) |
| 3 | Dockerfile: `ln -sf /opt/scripts/health-check.sh /usr/local/bin/claude-doctor` im `RUN` nach `COPY scripts/`; Erwähnung in DOCS „Troubleshooting“ | Wrapper-Skript (ein Symlink reicht, `with-contenv bashio` im Shebang funktioniert auch aus ttyd) |
| 4a | Letzte Zeile von `~/.tmux.conf`: `source-file -q ~/.tmux.conf.local` (eigene Einstellungen überschreiben den Standard); dazu `set -g focus-events on` | `~/.tmux.local.conf` (owine); beide Namen lesen |
| 4b | Die Datei wird nicht angelegt; DOCS erklärt sie mit Beispiel | Vorlage anlegen (würde bei jedem Start Fragen aufwerfen, ob sie überschrieben wird) |
| 5 | `express.static(…, { setHeaders })` setzt `Cache-Control: no-cache` für alle Dateien aus `public/`; ETag bleibt, unveränderte Dateien kommen als 304 | Unterscheidung nach Dateityp (in `public/` liegen nur HTML und JS); Hash-Dateinamen (Build-Schritt, Aufwand) |
| 6 | README-Abschnitt „Security“ neu: Zugriffskreis mit Belegen und Stand, kein Host-Port, was hinter dem Panel liegt (Root-Shell, `/config` rw, `SUPERVISOR_TOKEN`, Supervisor-API), Empfehlung: bei eingeschränkten HA-Konten die App stoppen oder deinstallieren. DOCS bekommt einen kurzen Absatz mit Verweis | Port-7681-Teil von umrath (wir veröffentlichen keinen Port); Abschnitt nur löschen |

## Credits (CHANGELOG und Release-Notes)

- Health-Check startet Claude wirklich: umrath (heytcass/home-assistant-addons `ff4ebec`), Vorlage owine (owine/claude-terminal-home-assistant `cc0d74e7`)
- `claude-doctor`: owine (`cc0d74e7`)
- `~/.tmux.conf.local`, `focus-events`: owine (`1175851a`, `1e0a33e2`), BartBourgeois, Maheidem
- `no-cache` für die Oberfläche: owine (`67dd7e55`)
- Sicherheits-Doku: umrath (heytcass/home-assistant-addons `8e65403`)
- Im App-Code (run.sh, scripts/, image-service) nur „owine's fork, commit …“ bzw.
  „heytcass upstream, commit …“ – `test-release-metadata.sh` verbietet dort „claude-terminal“.

## Nicht dabei

- Port-7681-Warnung (kein Port), `display-time`, Anlegen einer `~/.tmux.conf.local`
- Origin-Check / Rate-Limit im Bild-Service (owine `8ed192d3` …)
- Boot-Smoke-Test des Images in der CI (heytcass `d50e6c0`) – eigener Schritt
- Umstieg auf Ubuntu 26 (später, bewusst)

## Tests

| # | Test | RED vor der Änderung |
|---|---|---|
| 1 | `test-release-metadata.sh`: kein `ubuntu-latest` in `.github/workflows/*.yml` | ja (4 Treffer) |
| 2 | `test-health-check.sh`: `check_claude_cli` mit Stub-`claude` im PATH – läuft (Version im Log, 0), kaputt (Fehlertext im Log, 1), hängt (Timeout, 1; Stub `sleep`, Grenze per Variable verkürzbar), fehlt (Neustart-Hinweis, kein „Attempting“, 1), CPU zu alt (Stub wird nicht gestartet, 1) | ja |
| 3 | `test-release-metadata.sh`: Dockerfile legt `/usr/local/bin/claude-doctor` → `/opt/scripts/health-check.sh` an | ja |
| 4 | neuer `tests/test-tmux-config.sh`: `setup_tmux` mit `CLAUDE_RUN_SH_SKIP_MAIN=true`, `HOME` und `TMUX_WRAPPER_PATH` unter `$TMPDIR`; `focus-events on` vorhanden, letzte Anweisung ist `source-file -q ~/.tmux.conf.local` | ja |
| 5 | `test-image-service.js`: `GET /` und `GET /terminal-clipboard.js` tragen `Cache-Control: no-cache` | ja |
| 6 | Doku: Durchsicht; `test-release-metadata.sh` verbietet „Version 1.0.2 includes“ im README | ja |

Die Zeitgrenze für `--version` ist per Umgebungsvariable (`HEALTH_CLAUDE_TIMEOUT`,
Standard 10) überschreibbar, damit der Hänger-Test nicht 10 s dauert.

## Ende-zu-Ende-Kriterium (HA-Test, 3.3.0)

1. App-Log zeigt im Health-Check „Claude CLI runs: <Version> ✓“ und die Zusammenfassung.
2. `claude-doctor` im Terminal (Picker-Menü 8) liefert dieselbe Ausgabe.
3. `echo 'set -g status-bg colour22' > ~/.tmux.conf.local; tmux source-file ~/.tmux.conf`
   färbt die Statusleiste grün.
4. CI grün auf `ubuntu-24.04` (Job-Log nennt das Runner-Image), inklusive
   Test 5 unter Linux.
