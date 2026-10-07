# Sitzungsstand

## 2026-10-07 (6) — Release 3.1.0 (Folgepunkte 15, 17, 18; Issues)

### Stand
- Spec `docs/specs/2026-10-07-proxy-map-translations-design.md`, Plan
  `docs/plans/2026-10-07-proxy-map-translations.md`. Auf `main` (`bbeba7b`),
  Tag/Release `v3.1.0`. CI grün: Branch 37607065722, `main` 37607502832
  (Image-Service-Suite unter Node 22 `# pass 13`, inkl. „keine Warnung“).
- `http-proxy-middleware` 4.2 (statt 2.0.10, `http-proxy` raus, `httpxy`),
  `engines.node >=22.15`; Review fand einen echten Absturz (502 nach
  gesendeten Headern → `ERR_HTTP_HEADERS_SENT`), per Test reproduziert und
  behoben (`2429c6b`).
- `map`: `homeassistant_config` mit `path: /config`; Übersetzungen
  `claude-workbench/translations/{en,de}.yaml` für alle 9 Optionen.
- Version 3.1.0 statt 3.0.1 (neues Feature → Minor, Review-Hinweis, User).
- GitHub: Issues eingeschaltet, Vorlagen `.github/ISSUE_TEMPLATE/`
  (Bug, Feature, Verweis auf anthropics/claude-code); Auswahlseite vom User
  bestätigt.
- HA-Test 3.1.0: keine `map`-Warnung seit Store-Reload 12:28, kein `DEP0060`
  nach Panel-Nutzung (3.0.0 hatte es um 11:36:23), `/config` ok, deutsche
  Erklärungen sichtbar (User).
- HA-Prod 3.1.0 (Update durch User, 12:32:04): kein `DEP0060` nach
  Panel-Nutzung, keine `map`-Warnung für Claude Workbench beim Store-Reload
  12:31:32 (nur noch für fremde Apps Ism7MQTT, ESPHome-Legacy). Alte
  Repository-Einträge (`6ef0b4d0`, ESJavadex, heytcass) vom User entfernt.

### Verworfen
- `http-proxy` per npm-`overrides` auf `http-proxy-3` umbiegen (Alias-Trick,
  bleibt auf hpm 2); `--no-deprecation` (versteckt nur).
- `homeassistant_config` ohne `path` (Mount wanderte nach `/homeassistant`).

### Fallen
- `git checkout -- .` bei einer Gegenprobe setzte auch noch nicht committete
  Test-Änderungen zurück; Gegenproben nur auf einzelnen Dateien rückgängig
  machen oder vorher committen.
- Heredoc + Python-Regex mit Backslashes → wieder verstümmelt; Edit-Tool nehmen.
- `node --test tests/test-image-service.js` unter Windows: alle Tests pass,
  aber ein Datei-Fehlschlag durch nachlaufendes `ECONNRESET` (auch auf altem
  `main`); CI grün.
- DEP0060 erscheint erst beim ersten Proxy-Aufruf (Panel öffnen), nicht beim
  Start — Log-Prüfung erst nach Panel-Nutzung aussagekräftig.
- npm-Cache per `npm_config_cache` nach `.tmp/`.

### Nächste Schritte
- Folgepunkte im Memory `claude-code-ha-followups`: 3 (CPU ohne AVX2),
  7 (Fork-Survey 🟡).

### Empfohlene Skills
- `task-loop` für den nächsten Folgepunkt.

## 2026-10-07 (5) — Release 3.0.0: Claude Workbench (umgesetzt, Test + Prod)

### Stand
- Plan `docs/plans/2026-10-07-claude-workbench-rename.md` umgesetzt (Tasks
  1–13 abgehakt), gemergt nach `main` (`f80fd7f`), Tag/Release `v3.0.0`.
- GitHub-Repo umbenannt: `Eifel-Joe/claude-workbench` (alte URL → 301);
  lokales `origin` umgestellt. Das Repo ist bei GitHub kein Fork
  (`parent` leer) — Herkunft steht in README/DOCS/LICENSE.
- CI grün: Branch-Lauf 37600460758, `main` 37601028703 (Build aus
  `context: claude-workbench`, amd64 + aarch64).
- Code-Review per Subagent: wichtiger Befund umgesetzt (`37564be`): der alte
  Repository-Eintrag listet Workbench per Weiterleitung als
  `6ef0b4d0_claude_workbench`; Anleitung nennt `0e003122_claude_workbench`
  (Hash = sha1 der kleingeschriebenen Repo-URL, Metadaten-Test rechnet nach).
- HA-Test: `0e003122_claude_workbench` 3.0.0 installiert, Übernahme aus
  `6ef0b4d0_claude_terminal_pro` (alle 6 Punkte ok, Start ohne Login, vom
  User bestätigt), alte App deinstalliert und alter Repository-Eintrag
  entfernt (per MCP, Supervisor-Log 11:38:53/54). Store: Workbench einmal.
- HA-Prod (vom User): `0e003122_claude_workbench` 3.0.0 installiert, Übernahme
  11:49–11:50 alle Punkte ok inkl. „Python packages installed!“, Start ohne
  Login (User); `persist-install --list` zeigt fastmcp 4.0.11, pdfplumber
  0.11.10, pypdf 6.19.0, websocket-client 1.9.2 (166 MB). Alte App vom User
  deinstalliert (Supervisor-Log 11:52:27). Offen (User): alten
  Repository-Eintrag `6ef0b4d0` (…/claude-code-ha) auf Prod entfernen.

### Verworfen
- Siehe Abschnitt (4); zusätzlich: Übersetzungen und `map: config` nicht mehr
  in 3.0.0 aufgenommen (neue Folgepunkte).

### Fallen
- Store auf Prod hatte den alten Eintrag noch nicht neu eingelesen → Workbench
  erschien dort nur einmal (richtiger Eintrag `0e003122`).
- `gh release view --json isLatest` gibt es nicht (`gh release list` zeigt
  „Latest“).
- Image-Service-Tests lokal unter Windows: 9/9 pass, aber Exit 1 durch
  nachlaufendes `ECONNRESET` (auch auf altem `main`); CI grün.
- Mit `PATH="/c/WINDOWS/system32:$PATH"` greift Windows-`timeout` statt GNU.

### Nächste Schritte
- Neue Folgepunkte im Memory `claude-code-ha-followups`: 17 (Optionen ohne
  Erklärung — `claude-workbench/translations/en.yaml`/`de.yaml` fehlen),
  18 (Supervisor-Warnung „deprecated map option 'config'; use
  'homeassistant_config'“). Daneben 3, 7, 15.

### Empfohlene Skills
- `task-loop` für den nächsten Folgepunkt.

## 2026-10-07 (4) — Umbenennung in Claude Workbench: Spec + Plan

### Stand
- GitHub aufgeräumt: `main` gepusht (`fca0da7`), 9 gemergte Remote-Branches
  und 10 lokale gelöscht; `git ls-remote --heads origin` → nur `main`.
- Spec `docs/specs/2026-10-07-claude-workbench-rename-design.md` und Plan
  `docs/plans/2026-10-07-claude-workbench-rename.md` vom User freigegeben,
  auf Branch `feat/claude-workbench` (lokal, nicht gepusht; `bcfe8c8`,
  `4bd4928`). Noch keine Code-Änderung.
- Bestätigtes Logo: `docs/plans/2026-10-07-claude-workbench-logo-preview.png`.

### Verworfen
- Nur Anzeigename ändern (User will eigenen Slug), Übergangsversion der alten
  App, nachgezeichneter Funke (User wählte das Original), Ordner behalten.

### Fallen
- Nach dem Merge zeigt der alte HA-Repository-Eintrag per GitHub-Weiterleitung
  schon Claude Workbench → zweimal im Store bis zum Entfernen des alten
  Eintrags (erst möglich nach Deinstallation der alten App).
- Push meldet `git: 'credential-manager-core' is not a git command` —
  harmlos, Push klappt trotzdem.

### Nächste Schritte
- Plan ab Task 1 umsetzen (`docs/plans/2026-10-07-claude-workbench-rename.md`).
- Danach Folgepunkte im Memory `claude-code-ha-followups` (3, 7, 15).

### Empfohlene Skills
- `superpowers:executing-plans` oder `superpowers:subagent-driven-development`,
  pro Task `superpowers:test-driven-development`.

## 2026-10-07 (3) — Release 2.3.4 (Folgepunkte 9, 13, 14; Prod nachgezogen)

### Stand
- Spec `docs/specs/2026-10-07-github-redirect-cleanup-design.md`, Plan
  `docs/plans/2026-10-07-github-redirect-cleanup.md` (abgehakt). Auf `main`
  (`8c51581`), Tag/Release `v2.3.4`.
- CI grün: Branch-Lauf 37592072331, `main` 37592623079. Build-Log beider
  Architekturen: „Installing Home Assistant CLI 5.5.0“, „Installing GitHub CLI
  v2.102.0“ — ohne `api.github.com`.
- HA-Test auf 2.3.4 (`state: started`, Log fehlerfrei); vom User im
  App-Terminal: `persist-install --ha-cli --force` → v5.5.0, „ha runs ✓“;
  Kopie danach laut User per `rm` entfernt (Image-CLI gilt wieder).
- HA-Prod: vom User von 2.3.0 auf 2.3.3 und dann auf 2.3.4 aktualisiert; per
  MCP geprüft (Backup vor Update, `state: started`, Log fehlerfrei). Alte App
  `789f524e` ist deinstalliert.

### Verworfen
- GitHub-Token beim Build (Supervisor baut auf den Geräten ohne Token),
  Versions-Pinning (widerspricht „neueste Version“), `releases/latest/download`
  ohne Version (geht nicht für `gh`, `.ha-version` ginge verloren).
- Mac-Clipboard-Monitor auf Ingress umbauen (Einfügen im Terminal ersetzt ihn).

### Fallen
- Echtes `curl -f -w '%{url_effective}'` gibt die URL auch bei Exit 22 aus —
  der `|| resolved_url=""` in `persist-install` ist nötig; das Fake-`curl` im
  Test bildet das nach (Gegenprobe ohne Schutz fiel durch).
- Node 24 lokal meldet `ℹ pass`/`ℹ fail` statt `# pass`.
- Prod-Update per MCP blockiert der Auto-Mode-Klassifizierer („Production
  Deploy“) — der User startet Prod-Updates selbst.
- Docker-Cache: ein Versions-Bump ohne geänderte `RUN`-Zeilen baut in Sekunden
  aus dem Cache; HA-CLI/gh bleiben dann auf dem Stand des älteren Builds.

### Nächste Schritte
- Folgepunkte im Memory `claude-code-ha-followups`: 3 (CPU ohne AVX2),
  7 (Fork-Survey 🟡), 15 (Node-Warnung DEP0060 im Image-Service).
- Remote-Branch `fix/github-redirect-cleanup` kann gelöscht werden.

### Empfohlene Skills
- `task-loop` für den nächsten Folgepunkt.

## 2026-10-07 (2) — Release 2.3.3 (Folgepunkte 10–12, persist-install --ha-cli)

### Stand
- Spec `docs/specs/2026-10-07-cleanup-32bit-ci-design.md`, Plan
  `docs/plans/2026-10-07-cleanup-32bit-ci.md` (abgehakt). 2.3.1 (Bereinigung,
  CI), 2.3.2 (`ha --version` gibt es nicht) und 2.3.3 (Hinweis auf verdeckende
  Kopie) auf `main` (`ef6999e`); nur Tag/Release `v2.3.3` als Sammel-Release.
- CI grün auf `main` (Lauf 37587636406). Ubuntu-26.04-Probe grün
  (Lauf 37583213130); Actions auf Node-24-Majors, Tests auf Node 22.
- HA-Test auf 2.3.3; vom User im App-Terminal bestätigt: `--force` installiert
  v5.5.0 („ha runs ✓"), ohne `--force` ⚠️-Hinweis auf die Kopie (v5.5.0), nach
  `rm` wieder „Nothing to do".
- HA-Prod: laut User 2.2.2, nicht per MCP geprüft; Update nur mit Freigabe.

### Verworfen
- `persist-install --ha-cli` streichen (User wählte „neueste Version holen").
- `/config/` komplett in `.gitignore` (nur `/data/` ergänzt).
- Versionsdatei für die Image-CLI (Dockerfile-Änderung, nicht nötig).

### Fallen
- Die HA-CLI hat kein `--version` (4.x und 5.x, `cmd/root.go` ohne `Version`).
- Im Image gibt es `/usr/bin/ha`: ohne `--force` greift immer zuerst diese
  Prüfung; Tests überschreiben den Pfad mit `PERSIST_IMAGE_HA`.
- Git Bash hält Dateien nur mit Shebang für ausführbar — Test-Fakes brauchen eins.
- Eigene Kommentare mit `4.46.0`/`armv7` lösen den Metadaten-Schutz aus.
- api.github.com ohne Token: 403 durch Rate-Limit möglich (CI-Lauf
  37584251742, per Rerun grün) → Folgepunkt 13.
- Temp-Dateien nur unter `.tmp/` im Projekt (Memory `no-temp-files-on-c`);
  lokale Tests mit `TMPDIR`/`TMP`/`TEMP` darauf.

### Nächste Schritte
- HA-Prod auf 2.3.3 (Freigabe nötig).
- Folgepunkte im Memory `claude-code-ha-followups` (3, 7, 9, 13, 14).

### Empfohlene Skills
- `task-loop` für den nächsten Folgepunkt.

## 2026-10-07 — Release 2.3.0 (Dockerfile statt build.yaml, armv7 raus, Doku)

### Stand
- Spec `docs/specs/2026-10-07-dockerfile-build-design.md`, Plan
  `docs/plans/2026-10-07-dockerfile-build.md` (alle Schritte abgehakt). Gemergt
  nach `main` (`d016c71`), CI grün (Branch: Lauf 37548664129, main: 37549114833;
  Build-Log: `FROM ghcr.io/home-assistant/base:3.21`, Claude Code nativ
  installiert, Hadolint ohne DL3006 grün). Tag + GitHub-Release `v2.3.0`.
- HA-Test auf 2.3.0 (Update 2026-10-07 01:58): Supervisor-Build ohne
  `BUILD_FROM`, keine `build.yaml`-Warnung mehr (letzte 2026-10-06 17:45:31),
  `state: started`, App-Log ohne Fehler („Claude CLI is executable ✓").
  unbestätigt: `claude --version` im Terminal (User gab Release frei, Ausgabe
  nicht gezeigt).
- HA-Prod: laut User auf 2.2.2, nicht per MCP geprüft. Update auf 2.3.0 nur
  mit Freigabe.
- Lokal grün: `bash tests/test-release-metadata.sh` (2.3.0),
  `bash tests/test-startup-timeouts.sh`, ShellCheck; Clipboard (100) und
  Migration (57) vor dem Review-Commit `d2d8b0b`, der nur Doku/Metadaten-Test
  berührt.

### Verworfen
- armv7 über `${BUILD_ARCH}-base` behalten: Supervisor auf 32-Bit holt seit
  2025.12 keine App-Updates mehr, `armv7-base` seit 2025.11 eingefroren.
- `ARG BUILD_FROM` mit Default: ältere Supervisor übergeben ohne build.yaml
  `{arch}-base:latest` und würden Alpine still tauschen.
- Migrationsreste (Options-Pinning, pip-Versionen, `.egg-info`) bewusst nicht
  umgesetzt — Begründung in der Spec, Abschnitt 5.
- `options.json` für lokale Testläufe (weder unter `/config` noch `/data`):
  bashio liest Optionen über die Supervisor-API
  (`bashio::app.config` → `GET /addons/self/options/config`); lokal gelten die
  Standardwerte aus `run.sh`.

### Fallen
- `ghcr.io/home-assistant/base:3.21` enthält nur amd64/arm64 (Manifest geprüft).
- Supervisor-Quelle heißt jetzt `supervisor/apps/build.py` (nicht `addons/`).
- Lokal kein docker/podman/hadolint: Image-Build und Hadolint nur in der CI.
- Escapes: Heredocs über das Bash-Tool verstümmeln `\\` + Zeilenumbruch.
  Python-Skripte für Mehrzeilen-Ersetzungen mit dem Write-Tool anlegen und
  Backslashes über `chr(92)` bauen.
- Die Version steht seit 2.3.0 nur noch in `config.yaml` (plus README-Badge,
  vom Metadaten-Test geprüft) — `build.yaml` gibt es nicht mehr.

### Nächste Schritte
- HA-Prod auf 2.3.0 (Freigabe nötig).
- Folgepunkte im Memory `claude-code-ha-followups` (3, 7, 9–12).

### Empfohlene Skills
- `task-loop` für den nächsten Folgepunkt.

## 2026-10-06 — Releases 2.2.1 (klickbare Links) und 2.2.2 (Zeitgrenzen beim Start)

### Stand
- **2.2.1** (Folgepunkt 2): Plan `docs/plans/2026-10-06-terminal-link-click.md`,
  Spec `docs/specs/2026-10-06-terminal-link-click-design.md`. Auf `main`, Tag und
  GitHub-Release `v2.2.1`. HA-Test live vom User bestätigt: alle Zeilen des
  `/login`-Links öffnen die korrekte, vollständige URL.
- **2.2.2** (Folgepunkte 4 und 6): Plan `docs/plans/2026-10-06-startup-timeouts.md`,
  Spec `docs/specs/2026-10-06-startup-timeouts-design.md`. Auf `main` (`b081ad7`),
  CI grün (Lauf 37489708521, inkl. Image-Builds mit `coreutils`). HA-Test auf 2.2.2:
  App-Log „Persistent Claude override: update completed" nach 3 s, kein
  „timed out", Image-Service healthy, `state: started`. Tag/Release `v2.2.2`.
- Lokal: `bash tests/test-startup-timeouts.sh`, `bash tests/test-release-metadata.sh`,
  `node tests/test-terminal-clipboard.js` (100) grün; ShellCheck ohne Befund.
- Offen: HA-Prod steht auf 2.2.0 — Update nur nach ausdrücklicher Freigabe.

### Verworfen
- 2.2.1: nur `window.open` umleiten; ttyd-Addon über private xterm-Felder abschalten;
  Bruchstück über den ganzen Puffer auflösen (öffnete nach zweitem `/login` den
  falschen Link).
- 2.2.2: Netzwerk-Schritte in den Hintergrund verlegen (Claude könnte während des
  Binary-Tauschs starten); automatisches Aufräumen von npm-Resten (npm-Verhalten
  nach Abbruch unbelegt).

### Fallen
- `gh` ohne `--repo Eifel-Joe/claude-code-ha` zielt auf Upstream (404 bei `gh run`).
- `build.yaml` trägt die Version mit; `tests/test-release-metadata.sh` prüft das.
- HA-Basis-Image hat kein `coreutils`: BusyBox-`timeout` killt nur den direkten
  Prozess. Deshalb `coreutils` im Dockerfile — nicht entfernen.
- Browser-Pane führt `file://` nicht aus: Prüfstand über `python -m http.server`
  mit temporärer `.claude/launch.json` (nicht committen).
- HA-Update per MCP kann wegen des Image-Builds mit „Request timed out" antworten,
  obwohl der Build läuft: Supervisor-Log prüfen, nicht erneut auslösen.
- Update-Entität in HA Core hängt nach einem Supervisor-Update einige Minuten nach.
- `tests/test-production-run.sh` läuft lokal nicht (Symlinks); neue Bash-Tests
  daher in eigene, lokal lauffähige Suiten legen.

### Nächste Schritte
- HA-Prod auf 2.2.2 (Freigabe nötig).
- Übrige Folgepunkte: Memory `claude-code-ha-followups` (1, 3, 5, 7, 8).
- Veraltete `DEVELOPMENT.md` / `DEVELOPMENT_STATUS.md` (u. a. `/config/claude-config`).

### Empfohlene Skills
- `task-loop` für den nächsten Folgepunkt.
