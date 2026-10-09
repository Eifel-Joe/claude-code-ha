# Spec: npm-Cache aus den Backups, `auth_api` entfernen (3.1.3)

Stand: 2026-10-09 · Ziel-Version: 3.1.3 · Status: Entwurf im Chat bestätigt
(Folgepunkt 20 im Memory `claude-code-ha-followups`: Sichtung des Originals
heytcass/home-assistant-addons, Remote `heytcass`)

## Problem

1. **npm-Cache im Backup.** `HOME=/data/home`; das Claude-Update beim Start
   (`run.sh`, `setup_persistent_claude`, `npm install -g … --prefer-online`)
   und der Picker-Menüpunkt „Update Claude Code“ füllen `/data/home/.npm`.
   Der Cache ist reiner Download-Cache, landet aber in jedem Backup der App —
   auch im automatischen vor jedem App-Update.
2. **`auth_api: true` ohne Nutzen.** `config.yaml:74`. Die Berechtigung
   öffnet nur `http://supervisor/auth` (prüft HA-Benutzername/Passwort
   gegen Core). Kein Code der App ruft das auf (grep über `claude-workbench/`:
   kein `/auth`-Aufruf). Aus einer Root-Shell mit Claude ist das nur ein Weg,
   HA-Passwörter durchzuprobieren.

## Befunde (Messungen)

- HA-Prod 2026-10-08 (`du -sh`): `/data/home/.npm` 115 MB,
  `/data/.cache` 616 KB, `/data/.local/share/claude` nicht vorhanden,
  `/data/npm` 235 MB (die Claude-Installation selbst).
- HA-Test 2026-10-09, Claude bereits installiert, gleiche Version:
  `npm install -g @anthropic-ai/claude-code@latest --prefer-online` mit
  leerem Cache 19,1 s und 113 MB Download; mit gefülltem Cache 2,9 s.
  Lokal (Windows) gleiches Bild: 30–34 s / 116 MB gegenüber 6 s.
- Der Cache enthält im Wesentlichen eine Claude-Version (113–116 MB), wächst
  also nicht unbegrenzt.
- Herkunft: heytcass/home-assistant-addons#105 (`37ead95`, npm-Cache hatte
  dort Backups um mehrere GB vergrößert, Lösung `npm_config_cache=/tmp/…`)
  und heytcass/home-assistant-addons@3a6ee0d (`auth_api` entfernt).

## Optionen

| | A: Cache nach `/tmp` | B: `backup_exclude: ["home/.npm"]` |
|---|---|---|
| Backup | ohne Cache | ohne Cache |
| Platte | kein dauerhafter Cache | 115 MB bleiben in `/data` |
| Start mit Auto-Update | +~16 s, 113 MB Download je Neustart | wie bisher |
| Umfang | 3 Stellen (Start, Profil, Altordner löschen) | 1 Zeile |

## Entscheidung

**A** (User, 2026-10-09, nach Messung): Der Cache gehört nicht nach `/data`.
Der Preis (Download und längerer Start bei Auto-Update) wird im CHANGELOG
genannt.

- Neue Funktion `setup_npm_cache` in `claude-workbench/run.sh`, aufgerufen in
  `init_environment` direkt nach den XDG-Exporten:
  - `export npm_config_cache="$NPM_CACHE_DIR"` (Standard `/tmp/npm-cache`);
    gilt damit für das Update beim Start, das `npm install` des
    Image-Service und — über die von tmux geerbte Umgebung — den Picker.
  - Existiert `$NPM_LEGACY_CACHE_DIR` (Standard `/data/home/.npm`), wird er
    gelöscht und das einmal geloggt
    (`Removed the old npm cache from /data/home/.npm (kept it out of backups)`).
  - `NPM_CACHE_DIR` und `NPM_LEGACY_CACHE_DIR` sind nur für Tests
    überschreibbar (Muster `PERSIST_DATA_ROOT`).
- Im Profil `/etc/profile.d/persistent-packages.sh` (Heredoc in
  `init_environment`) zusätzlich `export npm_config_cache="/tmp/npm-cache"`,
  damit auch `npm` in der Shell nicht nach `/data` schreibt.
- `auth_api: true` aus `config.yaml` entfernen; `tests/test-release-metadata.sh`
  schlägt fehl, wenn `auth_api` wieder auftaucht.

## Verworfen

- **B** (`backup_exclude`): schneller, aber der Cache bliebe dauerhaft in
  `/data` (User-Entscheidung).
- Zusätzlich `npm cache clean` nach dem Update: unnötig, `/tmp` ist nach
  jedem Neustart leer.
- `npm_config_cache` im Picker explizit setzen: doppelt, der Picker erbt die
  Umgebung von `run.sh` über tmux; Shells bekommen sie über das Profil.

## Nicht dabei

`/data/.cache` (616 KB), `/data/npm` (Claude-Installation), `backup_exclude`,
übrige heytcass-Punkte (Boot-Smoke-Test in der CI, Health-Check mit
`claude --version`, Sicherheits-Doku) — eigene Runde.

## Tests

- Neue Suite `tests/test-npm-cache.sh` (lokal lauffähig, in `run-tests.sh`):
  sourced `run.sh` mit `CLAUDE_RUN_SH_SKIP_MAIN=true`, Pfade unter
  `$TMPDIR`:
  - nach `setup_npm_cache` ist `npm_config_cache` = `$NPM_CACHE_DIR`;
  - ein vorhandener Altordner (mit Datei) ist danach weg, Log enthält die
    Meldung genau einmal;
  - ohne Altordner: kein Fehler, keine Meldung;
  - `init_environment` ruft `setup_npm_cache` auf, und der Profil-Heredoc
    exportiert `npm_config_cache="/tmp/npm-cache"` (Textprüfung auf
    `run.sh`, da `init_environment` fest auf `/data` schreibt).
- `tests/test-release-metadata.sh`: `auth_api` in `config.yaml` → Fehlschlag.

## Credits

CHANGELOG und `docs/release-notes-3.1.3.md` nennen
„(heytcass, heytcass/home-assistant-addons#105)“ beim Cache und
„(heytcass, heytcass/home-assistant-addons@3a6ee0d)“ bei `auth_api`.

## Ende-zu-Ende-Kriterium (HA-Test)

1. Nach dem Update auf 3.1.3 enthält das App-Log einmal
   „Removed the old npm cache from /data/home/.npm“.
2. In der App-Shell: `du -sh /data/home/.npm` → nicht vorhanden;
   `ls -d /tmp/npm-cache` → vorhanden; `echo $npm_config_cache` →
   `/tmp/npm-cache`.
3. Ein neues Teil-Backup der App ist um rund 110 MB kleiner als das
   automatische Backup vor dem Update (Größen per MCP `ha_manage_backup`).
4. `ha_get_app` zeigt `auth_api: false`; App startet, Picker-Update läuft.
