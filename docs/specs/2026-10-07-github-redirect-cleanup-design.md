# Spec: GitHub-Versionen ohne API, Test-Temp aufräumen, Mac-Monitor raus

Stand: 2026-10-07 · Ziel-Version: 2.3.4 · Status: Entwurf im Chat bestätigt
(Folgepunkte 13, 14, 9 aus Memory `claude-code-ha-followups`, dazu der Rest
von „veraltete DEVELOPMENT.md“ aus `docs/SESSION-STAND.md`)

## Problem

1. **GitHub-API-Rate-Limit.** Drei Stellen fragen die neueste Version über
   `api.github.com` ab, ohne Token (60 Anfragen/h pro IP):
   - `claude-terminal/Dockerfile`, HA-CLI (`repos/home-assistant/cli/releases/latest`)
   - `claude-terminal/Dockerfile`, GitHub-CLI (`repos/cli/cli/releases/latest`)
   - `claude-terminal/scripts/persist-install`, `install_ha_cli`
   Bei 403 fällt der Build aus (CI-Lauf 37584251742, aarch64, erst per Rerun
   grün) bzw. `persist-install --ha-cli --force` bricht ab. Auf HA-Geräten
   baut der Supervisor das Image selbst — hinter einem NAT mit mehreren
   Geräten oder nach mehreren Builds ist das Limit schnell erreicht.
2. **Migrationstests hinterlassen Temp-Ordner.** `tmp()` in
   `tests/test-app-migration.js:12` legt per `mkdtempSync` `mig-*`-Ordner an,
   die nie gelöscht werden.
3. **Mac-Clipboard-Monitor ist tot.** `mac-clipboard-monitor.py` lädt an
   `<URL>/upload`. Mit `:8123` antwortet HA Core (nicht die App), Port 7680 ist
   seit 2.1.0 nicht mehr veröffentlicht, Ingress verlangt eine
   Browser-Sitzung. Bild-Einfügen per Strg+V/Cmd+V und Drag-and-drop im
   Terminal (`terminal-clipboard.js`, gleicher `/upload`-Weg über Ingress)
   ersetzt ihn.
4. **DEVELOPMENT.md:** Bis auf den Tipp `sudo lsof -ti:7680 | xargs kill -9`
   (sudo, beendet fremde Prozesse hart) in 2.3.0 bereits aktualisiert;
   `DEVELOPMENT_STATUS.md` ist seit 2.3.0 gelöscht.

## Anforderungen

### 1. Version aus der Weiterleitung statt aus der API

`https://github.com/<owner>/<repo>/releases/latest` leitet per 302 auf
`…/releases/tag/<tag>` weiter (geprüft 2026-10-07: HA-CLI `5.5.0`, gh
`v2.102.0`). Der Tag ist der letzte Pfadteil der Ziel-URL.

- Abfrage: `curl -fsSL -o /dev/null -w '%{url_effective}' <repo>/releases/latest`
  (folgt der Weiterleitung, lädt nur die HTML-Seite und verwirft sie).
- Der Tag gilt nur, wenn die Ziel-URL `/releases/tag/` enthält und der Rest
  nicht leer ist. Sonst: Fehler, **kein** Download.
- Download-URLs bleiben unverändert
  (`…/releases/download/<tag>/ha_<arch>`, gh-Tarball mit Version im Namen).
- `persist-install --ha-cli`:
  - Zeitgrenze `--max-time 30` bleibt für die Abfrage.
  - Fehlermeldung nennt die Abfrage-URL und „no network, or GitHub did not
    redirect to a release“ — kein Rate-Limit-Hinweis mehr.
  - Ausgaben, `.ha-version`, Austausch über `ha.new` bleiben wie in 2.3.3.
- Dockerfile (`ha` und `gh`): gleicher Weg; leerer/ungültiger Tag bricht den
  Build mit Meldung ab (`exit 1`), statt eine kaputte URL zu laden.
- `api.github.com` kommt weder im Dockerfile noch in `persist-install` vor;
  ein Schutztest prüft das.

### 2. Migrationstests räumen auf

`tmp()` merkt sich jeden angelegten Ordner; ein `after()`-Hook auf oberster
Ebene löscht alle mit `fs.rmSync(dir, { recursive: true, force: true })`.

### 3. Mac-Clipboard-Monitor entfernen

`mac-clipboard-monitor.py` und `MAC_CLIPBOARD_MONITOR.md` löschen. Keine
weiteren Verweise im Repo (geprüft per `grep`, außer `docs/`-Historie).

### 4. DEVELOPMENT.md

Abschnitt „Port Already In Use“: nur noch „anderen Host-Port nehmen“
(`-p 7682:7680`), kein `sudo`/`kill -9`.

### 5. Release 2.3.4

`config.yaml`, README-Badge, CHANGELOG oben, `docs/release-notes-2.3.4.md`.

## Optionen (Punkt 1)

| Option | Bewertung |
|---|---|
| **A: Tag aus der Weiterleitung** | kein Limit, kein Token, Version bleibt sichtbar — **gewählt** |
| B: GitHub-Token beim Build | hilft nur der CI; Supervisor baut auf den Geräten ohne Token |
| C: feste Versionen + Bump-Bot | widerspricht der Entscheidung „neueste Version“ (2.3.1), eigenes Projekt |
| D: `releases/latest/download/<asset>` ohne Version | geht für `ha`, nicht für `gh` (Version im Dateinamen); `.ha-version` ginge verloren |

## Nicht dabei

- Versions-Pinning, Token im Build, Prüfsummen.
- CPU-Check ohne AVX2 (Folgepunkt 3), Fork-Survey-Punkte (Folgepunkt 7).
- Sonstige Umschreibung von `DEVELOPMENT.md`.

## Verifikation

- `tests/test-persist-install.sh` (lokal):
  - Fake-`curl` liefert für die `releases/latest`-Abfrage eine Ziel-URL
    `…/releases/tag/9.9.1` → Download von `releases/download/9.9.1/ha_<arch>`,
    `.ha-version` = `9.9.1`.
  - Ziel-URL leer, oder ohne `/releases/tag/` (z. B. `…/releases`) → Exit ≠ 0,
    kein `releases/download` im curl-Log, vorhandene Kopie unverändert.
  - Kein Aufruf von `api.github.com` im curl-Log.
- `tests/test-release-metadata.sh`: kein `api.github.com` in
  `claude-terminal/Dockerfile` und `claude-terminal/scripts/persist-install`;
  `mac-clipboard-monitor.py` existiert nicht; Version 2.3.4.
- Migrationstests: Anzahl `mig-*` unter `.tmp/` vor und nach
  `node --test tests/test-app-migration.js` gleich (0 neue).
- Dockerfile (nur CI): Build-Log für amd64 und aarch64 zeigt
  „Installing Home Assistant CLI 5.…“ und „Installing GitHub CLI v2.…“.
- ShellCheck wie CI, `git ls-files --eol` ohne CRLF.

## Ende-zu-Ende-Kriterium

CI auf dem Branch grün mit beiden Versionszeilen im Build-Log; HA-Test baut
2.3.4 (`state: started`, App-Log ohne Fehler); im App-Terminal installiert
`persist-install --ha-cli --force` die aktuelle HA-CLI (v5.5.0 oder neuer)
und meldet „ha runs ✓“.
