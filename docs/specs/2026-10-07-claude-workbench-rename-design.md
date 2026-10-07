# Spec: Umbenennung in „Claude Workbench“ (eigene App, Version 3.0.0)

Stand: 2026-10-07 · Ziel-Version: 3.0.0 · Status: Entwurf im Chat bestätigt

## Problem

Die App heißt wie das Original „Claude Terminal Pro“ (Slug
`claude_terminal_pro`), das Repo wie das Original `claude-code-ha`
(`Eifel-Joe/claude-code-ha` vs. `ESJavadex/claude-code-ha`), und die README
stellt sie als „maintained fork“ vor. Im App Store, auf GitHub und in
Gesprächen ist sie dadurch nicht vom Original zu unterscheiden. Ziel: eine
eigenständige App mit eigenem Namen, Logo, Repo und README — mit klaren
Credits an Javier Santos (ESJavadex) und Tom Cassady (heytcass).

## Entscheidungen

| Frage | Entscheidung | Verworfen |
|---|---|---|
| Umfang | Anzeigename **und** Slug neu | nur Anzeigename (kein eigenständiger Slug) |
| Name / Slug | **Claude Workbench** / `claude_workbench` | Claude Code Studio, Claude Code Console, Claude Code for HA |
| Version | **3.0.0** (neuer Slug = für HA eine andere App, Breaking) | 2.4.0 |
| Umstieg | **harter Wechsel**: 3.0.0 enthält nur noch Claude Workbench | Übergangsversion der alten App mit Hinweis |
| Repo | auf GitHub umbenennen in `Eifel-Joe/claude-workbench` | Repo-Name bleibt |
| Ordner | `claude-terminal/` → `claude-workbench/` (per `git mv`) | Ordner bleibt |
| Logo | **Original-Funkenzeichen** (aus dem bisherigen `logo.png`) plus `>_` im Terminalfenster | eigener nachgezeichneter Funke (B1/B2), Werkbank, Werkzeug, HA-Haus |

Zum Logo: Das Funkenzeichen ist eine Marke von Anthropic. Der User hat sich
bewusst für das Original entschieden („im schlimmsten Fall müssen wir es
ändern“). Die README trägt einen Markenhinweis (Abschnitt 4).

## Anforderungen

### 1. Identität

- `config.yaml`: `name: "Claude Workbench"`, `slug: "claude_workbench"`,
  `panel_title: "Claude Workbench"`, `version: "3.0.0"`, `url` auf das neue
  Repo, `description` ohne „Fork of heytcass/home-assistant-addons“.
- `repository.yaml`: `name: Claude Workbench for Home Assistant`, neue `url`,
  `maintainer: Eifel-Joe`.
- Dockerfile-Labels: `org.opencontainers.image.title="Home Assistant App:
  Claude Workbench"`, `…source` auf das neue Repo.
- Logo: aus dem bisherigen `logo.png` (Original-Funke) und `>_` im
  Terminalfenster (Vorschau `docs/plans/2026-10-07-claude-workbench-logo-preview.png`, im Chat bestätigt) neu
  erzeugt: `icon.png` 128×128 und `logo.png`. Das Erzeugungsskript liegt im
  Repo (`tools/make-logo.py`, braucht Pillow, läuft nur bei Logo-Änderungen
  von Hand), damit das Logo reproduzierbar bleibt.
- Selbstbezeichnungen der App → „Claude Workbench“:
  - `run.sh`: Begrüßung „Welcome to Claude Workbench!“ (3×), Start-Log
    „Initializing Claude Workbench app...“
  - `scripts/claude-session-picker.sh`: Kopfzeile
  - `image-service/public/index.html`: `<title>`, `#header-title`
  - `image-service/server.js`: Kopfkommentar, Start-Log
  - `image-service/package.json` + `package-lock.json`: `name`
    `claude-workbench-image-service`, `description`
  - `image-service/public/terminal-clipboard.js:660`: Fehlertext-Präfix
  - `scripts/health-check.sh`, `scripts/ha-api-examples.sh`,
    `scripts/persist-install` (Meldung „must run inside …“)
  - `.claude/skills/persistent-package-manager/SKILL.md`,
    `PERSISTENT_PACKAGES.md` (Menüpfad **Settings → Apps → Claude
    Workbench**; der veraltete Hinweis auf `/config/claude-terminal/options.json`
    wird durch den Weg über die App-Konfiguration ersetzt), `IMAGE_PASTE.md`,
    `DOCS.md`, `README.md` im App-Ordner
  - `DEVELOPMENT.md`, `flake.nix`, `CLAUDE.md` (Projektbeschreibung, Pfade)
- Session-Picker-Hinweis „Update to Claude Terminal Pro v2.0.4+ …“ entfällt
  (betrifft nur Uralt-Versionen der alten App). Umgesetzt (laut Plan) als
  Ersatz: „Restart the app to reinstall it, or run: persist-install github-cli“.

### 2. Ordner und Pfade

- `git mv claude-terminal claude-workbench`.
- Alle Pfadverweise außerhalb von `docs/` und `CHANGELOG.md` anpassen:
  `.github/workflows/ci.yml`, `tests/*` (inkl. `run-tests.sh`,
  `test-release-metadata.sh`), `CLAUDE.md`, `DEVELOPMENT.md`, `README.md`,
  `flake.nix`.

### 3. Übernahme (bleibt erhalten)

- `detect.js` sucht weiter nach Apps mit Slug-Endung `_claude_terminal_pro`
  (ESJavadex-App und bisherige Eifel-Joe-App). Die eigene Workbench wird nie
  als Quelle angeboten.
- Backup-Name: „Claude Workbench – Übernahme <Datum>“ (`apply.js`,
  Hinweistext in `dialog.js`).
- Texte, die die *alte* App meinen („Claude Terminal Pro 2.0.13 (…)“ im
  Dialog), bleiben.
- Tests:
  - RED zuerst: erwarteter Backup-Name „Claude Workbench – Übernahme …“
    (Test und Dialog-Hinweis).
  - `fake-supervisor.js`: `SELF_SLUG` wird `0e003122_claude_workbench` (Hash der neuen Repo-URL; nach Review korrigiert, vorher `6ef0b4d0_…`); die
    bestehenden Erkennungstests müssen damit weiter grün sein (eigene
    Workbench + alte `*_claude_terminal_pro` → Angebot für die alte).
  - Schutztest (sofort grün, sichert das Verhalten ab): eine zweite
    Workbench `ffff0000_claude_workbench` wird nicht als Quelle angeboten;
    sind zwei `*_claude_terminal_pro` vorhanden, gewinnt wie bisher die
    gestartete.

### 4. README als eigene App, Credits, Lizenz

- Root-`README.md` und `claude-workbench/README.md` stellen Claude Workbench
  als eigene App vor (Zweck, Funktionen, Installation, Konfiguration). Der
  Abschnitt „What's different in this fork“ entfällt.
- Neuer Abschnitt **„Switching from Claude Terminal Pro“** für beide Fälle
  (ESJavadex-App und bisherige Eifel-Joe-App):
  1. neue Repository-URL in HA hinzufügen
  2. Claude Workbench installieren und starten — und zwar die mit der
     App-Adresse `0e003122_claude_workbench` (neue Repo-URL). Nach Review
     ergänzt: Der alte Repository-Eintrag zeigt per GitHub-Weiterleitung
     ebenfalls Claude Workbench (`6ef0b4d0_claude_workbench`); daraus
     installiert, ließe sich der alte Eintrag nie mehr entfernen. Der
     Metadaten-Test rechnet den Hash aus der Repo-URL nach.
  3. Übernahme im Panel bestätigen
  4. alte App deinstallieren
  5. alten Repository-Eintrag entfernen (GitHub leitet die alte URL weiter,
     sonst erscheint Claude Workbench doppelt im App Store)
- Credits: Claude Workbench ist aus Claude Terminal Pro hervorgegangen;
  Javier Santos (ESJavadex) als Grundlage, Tom Cassady (heytcass) als Ursprung,
  die Community-Forks wie bisher.
- Markenhinweis: „Claude“ und das Funkenzeichen sind Marken von Anthropic;
  Claude Workbench ist kein Anthropic-Produkt.
- `LICENSE`: Platzhalter `Copyright (c) 2025 [Your Name]` ersetzen durch
  Copyright-Zeilen für Tom Cassady, Javier Santos und Eifel-Joe.
- Sprache bleibt Englisch. Badges und „Add repository“-Link zeigen auf das
  neue Repo.
- `DOCS.md` (wird in HA angezeigt): gleiche Umstiegs-Anleitung, gleiche
  Credits.
- Release-Notes `docs/release-notes-3.0.0.md` mit Umstiegs-Anleitung;
  `CHANGELOG.md` oben ergänzen.

### 5. GitHub-Repo umbenennen

- Eigener Schritt **nach** grüner CI auf dem Branch und **nur mit Freigabe**:
  `gh repo rename claude-workbench --repo Eifel-Joe/claude-code-ha`.
- Danach lokales `origin` auf die neue URL setzen.
- Die URL-Änderungen im Repo (Abschnitt 1, 4) werden vorher committet; bis
  zum Umbenennen leiten die Links ins Leere bzw. auf 404 — der Merge nach
  `main` erfolgt daher erst nach dem Umbenennen.

## Nicht enthalten

- Keine Übergangsversion der alten App.
- Keine Funktionsänderungen.
- Alte Specs, Pläne, Release-Notes, `SESSION-STAND.md`, `FORK-SURVEY.md` und
  CHANGELOG-Verlauf bleiben unverändert (dokumentieren den damaligen Stand).
- Kein Logo-Neuentwurf jenseits des bestätigten Entwurfs.

## Ende-zu-Ende-Kriterium

1. CI auf dem Branch grün: Tests, ShellCheck, Hadolint, Image-Build aus
   `claude-workbench/` für amd64 und aarch64.
2. `grep -rI "claude-terminal\|Claude Terminal" --exclude-dir=.git
   --exclude-dir=docs --exclude=CHANGELOG.md .` findet nur die bewusst
   behaltenen Stellen (Übernahme-Texte zur alten App, Credits/Umstieg).
3. HA-Test: Repository `https://github.com/Eifel-Joe/claude-workbench`
   hinzugefügt → „Claude Workbench“ mit neuem Logo im App Store →
   als `0e003122_claude_workbench` installiert und gestartet → Übernahme aus `6ef0b4d0_claude_terminal_pro`
   angeboten und durchgeführt → Claude startet ohne erneuten Login, Memories
   und persistente Pakete vorhanden → alte App und alter Repository-Eintrag
   entfernt, Workbench erscheint nur einmal.
4. HA-Prod: derselbe Ablauf, vom User ausgelöst; per MCP geprüft
   (Supervisor- und App-Log).
