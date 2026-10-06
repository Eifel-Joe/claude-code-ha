# Spec: Datenübernahme aus einer anderen Claude-Terminal-Pro-App

Stand: 2026-10-06 · Ziel-Version: 2.2.0 · Status: freigegeben (Entwurf im Chat bestätigt)

## Problem

Wer von der App aus `ESJavadex/claude-code-ha` auf diesen Fork umsteigt, bekommt in
Home Assistant eine **neue** App (anderer Repository-Hash im Slug). Jede App hat ein
eigenes `/data`; dort liegen Claude-Memories, `~/.claude/CLAUDE.md`, Sitzungsverlauf,
Einstellungen und Logins. Beim Deinstallieren der alten App ist das weg. Heute muss
man die Daten von Hand über `/config` umziehen — inklusive Login-Token in `/config`.

## Ziel

Die neue App erkennt beim ersten Start eine installierte alte App und bietet beim
ersten Öffnen des Panels an, deren Daten zu übernehmen — ohne Schritt in der alten
App, ohne dass Daten über `/config` laufen.

## Nicht-Ziele

- Übernahme aus dem Ur-Add-on `heytcass` (anderer Slug) — nicht unterstützt.
- Kopieren der alten persistenten Paket-Binaries (`/data/packages`): Die alte
  Persistenz hat auf 2.0.13 nachweislich nichts kopiert (mmackenzie2026, `9a02e6cd`),
  und 2.1.0 hat sie umgebaut. Pakete werden **neu installiert**.
- Übernahme von `use_persistent_claude` / `auto_update_claude_on_start`: In der alten
  App aus, und genau das fror die Claude-Version ein.
- Rückübertragung in die alte App, Zwei-Wege-Sync.

## Belegte Voraussetzungen

- Rolle `hassio_role: manager` darf laut Supervisor `api/middleware/security.py`
  (Rolle `ROLE_MANAGER`): `/addons` (Liste), `/addons/<slug>/…` (Info, Optionen,
  Stop; außer `security`), `/backups.*` (anlegen, herunterladen).
- Alte App 2.0.13 legt Claude-Daten unter `HOME=/data/home` ab (`run.sh` Upstream,
  Zeilen 47–55), gh unter `/data/.config/gh`, pip-venv unter
  `/data/packages/python/venv`.
- **Noch zu verifizieren (erster Umsetzungsschritt):** reale Struktur eines per API
  angelegten Teil-Backups (erwartet: äußeres tar → `<slug>.tar.gz` → `data/…`) und
  ob es ohne Passwort unverschlüsselt ist. Testfixture wird aus diesem realen Format
  gebaut.

## Verhalten

### Erkennung (beim Start, `run.sh`, nicht interaktiv)

Ein Angebot entsteht nur, wenn **alle** zutreffen:

1. Eigene App hat keine Claude-Daten: weder `/data/home/.claude/.credentials.json`
   noch Einträge unter `/data/home/.claude/projects/`.
2. Kein Zustand `done` oder `never` in `/data/migration/state`.
3. Unter `/addons` ist eine **andere** App installiert, deren Slug auf
   `_claude_terminal_pro` endet (eigener Slug via `/addons/self/info`).
   Bei mehreren Treffern: die erste laufende, sonst die erste.

Dann: Version, Name und Optionen der alten App lesen, pip-Paketliste bleibt offen
(kommt erst aus dem Backup), Angebot nach `/data/migration/offer.json` schreiben.
Kein Backup in diesem Schritt. Jeder API-Fehler hier → kein Angebot, Log-Warnung,
Start läuft normal weiter.

### Auswahlfenster (beim ersten Öffnen des Panels)

Liegt ein Angebot vor, zeigt der Startbefehl vor Claude bzw. dem Menü:

```
  Alte App gefunden: Claude Terminal Pro 2.0.13 (<Repository>)
  Was soll übernommen werden?   [Ziffer = an/aus]
  [x] 1  Claude-Daten: Memories, CLAUDE.md, Verlauf, Einstellungen
  [x] 2  Claude-Login
  [x] 3  GitHub-Login (gh)
  [x] 4  Pakete neu installieren: apk: <liste> | pip: <liste aus Optionen>
  [x] 5  Alte App danach stoppen
  [x] 6  Einstellungen: auto_launch_claude=…, dangerously_skip_permissions=…, …
  Enter = übernehmen   s = später fragen   n = nie fragen
```

- Alle sechs Punkte werden immer angezeigt und sind standardmäßig an (ob die alte
  venv pip-Pakete enthält, ist erst nach dem Backup bekannt). Bei Punkt 6 der
  Hinweis „gilt ab dem nächsten Neustart". Texte im Fenster auf Englisch, wie die
  übrige App-Oberfläche.
- `s`: nichts tun, beim nächsten Start der App erneut fragen (das Fenster läuft in
  der tmux-Sitzung, die über Browser-Neuladen hinweg bestehen bleibt).
- `n`: Zustand `never`, nie wieder fragen.
- Enter: Übernahme (unten), danach Zusammenfassung, dann weiter wie gewohnt.

### Übernahme (Enter)

Reihenfolge; Schritt a/b sind Voraussetzung für alles Weitere:

a. `POST /backups/new/partial` mit nur der alten App, Name
   „Claude Terminal Pro – Übernahme <JJJJ-MM-TT>", ohne Passwort.
b. `GET /backups/<slug>/download` nach `/data/migration/work/`, inneres Archiv
   der alten App entpacken.
c. Je nach Auswahl aus dem Backup nach `/data` kopieren (`cp -a`, nichts
   Vorhandenes überschreiben):
   - 1 → `data/home/.claude/` ohne `.credentials.json`, `data/home/.claude.json`
   - 2 → `data/home/.claude/.credentials.json`
   - 3 → `data/.config/gh/`
d. Punkt 4: apk-Liste aus den alten Optionen, pip-Liste aus alten Optionen plus
   Namen der `*.dist-info` in der alten venv (aus dem Backup). Je Paket
   `persist-install` bzw. `persist-install --python`; erfolgreiche Pakete in die
   eigenen Optionen `persistent_apk_packages` / `persistent_pip_packages`.
e. Punkt 6: `auto_launch_claude`, `dangerously_skip_permissions`, `tmux_mouse`,
   `remote_control`, `remote_control_session_name` (soweit in der alten App
   vorhanden) in die eigenen Optionen übernehmen — zusammengeführt mit den
   aktuellen eigenen Optionen, `POST /addons/self/options`.
f. Punkt 5, als letzter Schritt: `POST /addons/<alt>/stop`.
g. `/data/migration/work` löschen, Zustand `done`, Zusammenfassung mit Ergebnis
   je Punkt und Hinweis auf das Backup unter *Einstellungen → System → Backups*.

## Fehlerverhalten

- a oder b schlägt fehl → nichts übernehmen, alte App nicht stoppen, Meldung,
  Zustand bleibt offen (nächster Start der App fragt erneut). Existiert das Backup
  schon (Fehler bei Download/Entpacken), wird es wieder gelöscht; misslingt das,
  nennt die Meldung das Backup, damit man es von Hand löschen kann.
- Ein Punkt in c–e schlägt fehl → übrige Punkte laufen weiter; Zusammenfassung
  nennt den Fehler. Punkt 5 wird dann **nicht** ausgeführt (alte App bleibt als
  Rückfall verfügbar), Meldung sagt das. Ebenso, wenn Punkt 1 oder 2 gewählt war und
  im Backup nichts gefunden wurde.
- Die alte App wird außer beim Stoppen nie verändert.
- Login-Daten berühren nie `/config`; Zwischendateien nur in `/data/migration/work`.
- Das Übernahme-Backup enthält Login-Token (wie jedes HA-Backup der alten App) und
  bleibt bewusst als Sicherung stehen; die Zusammenfassung sagt das.

## Bausteine

| Datei | Aufgabe |
|---|---|
| `claude-terminal/scripts/app-migration/supervisor.js` (neu) | kleiner Supervisor-API-Client (`get`, `post`, `download`); Basis-URL per `SUPERVISOR_API` überschreibbar |
| `claude-terminal/scripts/app-migration/paths.js` (neu) | alle Pfade unter `MIGRATION_DATA_ROOT` (Standard `/data`) |
| `claude-terminal/scripts/app-migration/detect.js` (neu) | Erkennung, schreibt `offer.json` |
| `claude-terminal/scripts/app-migration/apply.js` (neu) | Backup, Download, Übernahme der Punkte, Fehlerregeln |
| `claude-terminal/scripts/app-migration/dialog.js` (neu) | Fenster rendern, Eingabe auswerten (reine Funktionen) |
| `claude-terminal/scripts/app-migration/cli.js` (neu) | Einstieg `node cli.js detect` / `node cli.js dialog` |
| `claude-terminal/run.sh` | `detect_app_migration` beim Start; `with_migration_dialog` setzt den Dialog vor den Startbefehl |
| `tests/fake-supervisor.js`, `tests/test-app-migration.js` (neu) | Fake-Supervisor, Test-Backup, `node:test`-Suite |

Umsetzung in Node statt Bash: Node ist im Image vorhanden (image-service), JSON und
HTTP sind direkt verfügbar, und die Tests laufen auch lokal unter Windows.

## Tests

Automatisch (CI), gegen den Fake-Supervisor mit einem Test-Backup im realen Format:

- Erkennung: kein Angebot ohne alte App; kein Angebot bei vorhandenen eigenen Daten;
  kein Angebot bei Zustand `never`/`done`; Angebot bei alter App mit korrekten
  Optionen; eigene App wird nicht als „alt" erkannt.
- Übernahme je Punkt einzeln und alle zusammen: Memory, `~/.claude/CLAUDE.md`,
  `.claude.json`, Login, gh landen am richtigen Ort; nichts Vorhandenes überschrieben.
- Pakete: richtige Listen an `persist-install` (Stub), Optionen aktualisiert.
- Einstellungen: zusammengeführt, ausgeschlossene Optionen bleiben unverändert.
- Fehlerpfade: Backup-Fehler → nichts übernommen, kein Stop; Paket-Fehler → Rest
  übernommen, kein Stop.
- Dialog-Eingabe: Ziffern schalten um, `s`/`n`/Enter.

Live direkt auf HA-Prod (Entscheidung des Users; Backup der alten App liegt vor):
Die ESJavadex-App mit echten Daten bleibt installiert; die Fork-App ist dort vorher
nicht installiert bzw. ohne eigene Claude-Daten. Das Backup-Format wird vorab auf
Prod an einem Teil-Backup der alten App verifiziert (lesend). Dann Fork 2.2.0
installieren. Rückfall bei Fehlern: alte App bleibt unverändert und wird bei Fehlern
nicht gestoppt. Erfolgskriterium: Fenster erscheint; nach Enter sind Memory und
CLAUDE.md da (`/memory`), Claude startet ohne erneuten Login, pip-Paket importierbar,
alte App gestoppt, Übernahme-Backup in der Backup-Liste.

## Mit-Release 2.2.0: „App" statt „Add-on"

Home Assistant nennt Add-ons seit 2026 „Apps". Alle für Nutzer sichtbaren Texte
(Menü, Log-Meldungen, Dialog, README, DOCS, CHANGELOG ab 2.2.0) sagen „App".
Interne Bezeichner (Slug, Dateinamen, `config.yaml`-Schlüssel) bleiben unverändert.
Eigener Commit.
