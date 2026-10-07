# Sitzungsstand

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
