# Sitzungsstand

## 2026-10-07 — Spec + Plan 2.3.0 (Dockerfile statt build.yaml, armv7 raus, Doku)

### Stand
- Branch `chore/dockerfile-build-armv7`: Spec
  `docs/specs/2026-10-07-dockerfile-build-design.md` (`89d6ca9`) und Plan
  `docs/plans/2026-10-07-dockerfile-build.md` (`91f6aff`), beide vom User
  freigegeben. Noch kein Produktionscode, nichts gepusht.
- Gegenprobe HA-Test: Supervisor-Warnung `uses build.yaml which is deprecated`
  für `6ef0b4d0_claude_terminal_pro`, zuletzt 2026-10-06 17:45:31.
- User: HA-Prod auf 2.2.2 aktualisiert (laut User, nicht per MCP geprüft); alte
  ESJavadex-App wird gerade deinstalliert.

### Verworfen
- armv7 über `${BUILD_ARCH}-base` behalten: Supervisor auf 32-Bit holt seit
  2025.12 keine App-Updates mehr, `armv7-base` seit 2025.11 eingefroren.
- `ARG BUILD_FROM` mit Default: ältere Supervisor übergeben ohne build.yaml
  `{arch}-base:latest` und würden Alpine still tauschen.
- Migrationsreste (Options-Pinning, pip-Versionen, `.egg-info`) bewusst nicht
  umgesetzt — Begründung in der Spec, Abschnitt 5.

### Fallen
- `ghcr.io/home-assistant/base:3.21` enthält nur amd64/arm64 (Manifest geprüft).
- Supervisor-Quelle heißt jetzt `supervisor/apps/build.py` (nicht `addons/`).
- Lokal kein docker/podman/hadolint: Image-Build und Hadolint nur in der CI.

### Nächste Schritte
- Plan `docs/plans/2026-10-07-dockerfile-build.md` ab Task 1 umsetzen.

### Empfohlene Skills
- `superpowers:executing-plans` bzw. `superpowers:subagent-driven-development`,
  `superpowers:test-driven-development`, danach `superpowers:requesting-code-review`.

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
