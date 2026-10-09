# Spec: Shift+Enter und Auto-Continue nach Rate-Limit (3.4.0)

Stand: 2026-10-09 · Ziel-Version: 3.4.0 (neue Option `auto_continue`) · Status: Entwurf im Chat bestätigt
Quelle: `docs/FORK-SURVEY-heytcass.md`, Teil mattbsea (Zeilen „Auto-Continue“ und „Shift+Enter“).
Befunde gegen `main` = `5e967c62` geprüft, Branch `feat/auto-continue-3.4.0`.

## Probleme

1. **Shift+Enter schickt ab statt umzubrechen.** Im Panel sendet Shift+Enter wie Enter ein
   CR; mehrzeilige Eingaben in Claude gehen nur über `\` + Enter von Hand.
   `/terminal-setup` hilft nicht: Es kennt nur Terminal-Apps wie iTerm2 oder VS Code, nicht
   ttyd im Browser. In `image-service/public/` gibt es keinen Treffer für `shiftKey`.
2. **Ein Rate-/Usage-Limit hält lange Sitzungen an.** Meldet Claude „… limit reached ·
   resets 3pm (Europe/Berlin)“, wartet die Sitzung, bis jemand „continue“ tippt. Die
   tmux-Session `claude` läuft auch ohne offenes Panel (`run.sh:824-830`), nach dem Reset
   könnte sie also unbeaufsichtigt weiterarbeiten, wenn der User das will.

## Befunde

- Panel: ttyd läuft im same-origin-iframe `#terminal-frame` (`index.html:466`, `:538`).
  Tasten werden schon heute dort abgefangen: Strg+V per `win.addEventListener('keydown', …, true)`
  (`index.html:589`). ttyd setzt `window.term` (xterm.js). Header-Knöpfe: `index.html:447-461`.
- Claude Code versteht `\` + Enter in jedem Terminal als Zeilenumbruch ohne Absenden. In bash
  ist dieselbe Folge eine Zeilenfortsetzung, also harmlos.
- tmux auf HA-Test 3.3.0, Ausgabe vom User am 2026-10-09:
  ```
  1.1 %0 cmd=bash pid=348      (Claude-Pane, Fenster zählen ab 1)
  2.1 %1 cmd=tmux pid=493
  348  347 bash   bash -c eval "$CLAUDE_LAUNCH_CMD"
  354  348 claude /usr/local/bin/claude
  ```
  `pane_current_command` meldet für die Claude-Pane `bash`: `bash -c` hat keine Job-Control,
  Claude liegt in der Prozessgruppe von bash. Als Filter „läuft hier Claude?“ taugt das
  nicht. Der Prozessname von Claude ist `claude` (native Binary).
- Image-Service (`image-service/server.js`, Node, root) läuft im selben Container und
  derselben PID-Namensraum wie tmux (`ps` zeigt `node /opt/image-service/server.js` neben
  `tmux: server`). Er startet vor `setup_tmux` (`run.sh:870-874`) und wird bei Absturz neu
  gestartet (Supervisor-Schleife, `IMAGE_SERVICE_SUPERVISOR_PID`).
- Vorlage mattbsea (heytcass-Fork, MIT): `claude-terminal/web-terminal/auto-continue.js` und
  `test/auto-continue.test.js` @ `00e22fc0` (Entwicklung über `16847c88`, `533ae0ef`,
  `5924cd08`, `00e22fc0`); Shift+Enter `6e44e41f`. mattbsea liest den PTY-Datenstrom und
  schaltet Auto-Continue standardmäßig **ein**.

## Optionen

### Shift+Enter
- **A (gewählt): `keydown`-Listener in der Capture-Phase im iframe-Fenster**, wie bei Strg+V.
  Unabhängig davon, ob ttyd selbst `attachCustomKeyEventHandler` belegt (es gibt nur einen Slot).
- B: `term.attachCustomKeyEventHandler` wie mattbsea. Verworfen: Würde einen von ttyd belegten
  Handler überschreiben bzw. von ttyd überschrieben.
- Gesendet wird `\` + CR als Eingabe, so als wäre sie getippt: `term.input('\\\r', true)`.
  ttyd 1.7.7 bündelt `@xterm/xterm` 5.4.0 (`html/yarn.lock` im Tag 1.7.7), dessen Typings
  `input(data, wasUserInput)` enthalten; ttyd leitet `onData` an den Socket weiter
  (`html/src/components/terminal/xterm/index.ts:176`). Fehlt `term.input`, wird Shift+Enter
  nicht abgefangen (Enter wie bisher). **Nicht** `term.paste`: Das würde Bracketed Paste
  auslösen.
- Verworfen: ESC + CR (Meta+Enter). Hängt an `escape-time` in tmux und daran, wie Claude die
  Folge deutet; `\` + CR ist dokumentiert und robust.

### Auto-Continue: woher kommt der Bildschirminhalt
- **A (gewählt): Image-Service fragt tmux ab** (`list-panes`, `capture-pane -p`) alle 30 s.
  Node hat `Intl` für die Zeitzonen-Rechnung; der Parser von mattbsea passt fast 1:1.
- B: Bash-Schleife in `run.sh`. Verworfen: Reset-Zeit mit Zeitzone und Sommerzeit in
  BusyBox-`date` ist fehleranfällig, nicht testbar wie Node.
- C: `tmux pipe-pane` als Datenstrom. Verworfen: ein Slot pro Pane (kollidiert mit eigener
  Nutzung), mehr Prozess-Verwaltung; Abfragen genügt, weil die Meldung stehen bleibt.

### Auto-Continue: Schalter
- Gewählt (User, Variante B): **Option `auto_continue` als Anfangszustand plus Schalter zur
  Laufzeit** — Befehl `auto-continue` und Knopf im Panel-Header.
- Verworfen: nur Option (Umschalten bräuchte Neustart der App, der beendet die tmux-Session),
  nur Laufzeit-Schalter (kein dauerhafter Wunschzustand).

## Entscheidung

### 1. Shift+Enter
- Neue reine Funktion `isShiftEnter(event)` (keydown, `key === 'Enter'`, `shiftKey`, kein
  Strg/Alt/Meta, nicht `isComposing`) in `terminal-clipboard.js` bzw. einem eigenen kleinen
  Modul in `public/`, exportiert für Node-Tests.
- Im iframe-Fenster ein Capture-`keydown`-Listener: trifft `isShiftEnter`, dann
  `preventDefault` + `stopImmediatePropagation` und `\` + CR an das Terminal.
- Installiert bei jedem Laden des iframes (wie `installImagePaste`, mit Schutz gegen
  doppelte Installation).
- Keine Option.

### 2. Auto-Continue: Modul `image-service/auto-continue.js`
- **Parser von mattbsea übernehmen:** `stripAnsi`, `detectLimit` (Muster aus `00e22fc0`),
  `parseResetTime` (relativ „try again in N hours“, absolut „resets 3pm (TZ)“, DST-fest per
  `Intl`, unbekannte Zone → Server-Zone), Konstanten: Puffer +1 min nach Reset, Rückfall
  30 min ohne Uhrzeit, Obergrenze 24 h. Kopfkommentar mit Herkunft (mattbsea, Commits, MIT).
  Den Watcher (Datenstrom, Timer) übernehmen wir nicht, siehe nächster Punkt.
- **Watcher je Pane** (Schlüssel = Pane-ID `%N`), aber gespeist aus dem Bildschirminhalt
  statt aus dem Datenstrom. Weil dieselbe Meldung bei jeder Abfrage wieder auf dem Bildschirm
  steht, ersetzt eine **Signatur** mattbseas Zeit-Toleranz und Stale-Logik: Signatur = alle
  Bildschirmzeilen mit Limit-Meldung, zusammengefügt.
  - Gleiche Signatur wie die geplante → Plan bleibt (sonst würde „try again in 5 hours“
    bei jeder Abfrage 30 s weiterwandern).
  - Gleiche Signatur wie die zuletzt beantwortete → nichts (kein zweites „continue“ auf
    denselben, noch sichtbaren Banner, auch nicht im Rückfall ohne Uhrzeit).
  - Keine Limit-Zeile mehr auf dem Bildschirm → Plan verworfen („nicht mehr sichtbar“) und
    die beantwortete Signatur vergessen, die nächste Meldung gilt als neu.
  - Grenzfall: Erscheint nach dem Senden exakt dieselbe Meldung erneut, während die alte noch
    sichtbar ist, wird sie nicht erkannt (verpasst, nie doppelt gesendet).
- Fällig wird erst bei der nächsten Abfrage nach Reset + 1 min, also bis zu 30 s später.
- **Abfrage alle 30 s**, nur wenn eingeschaltet:
  `tmux list-panes -s -t =claude -F '#{pane_id} #{pane_pid}'` (`=` = genau diese Session,
  kein Präfix-Treffer); je Pane `tmux capture-pane -p -J -t <pane_id>` (`-J` fügt umbrochene
  Zeilen zusammen, damit „resets 3pm (Europe/Berlin)“ nicht zerreißt). tmux-Aufrufe per `execFile`
  mit Argument-Array, ohne Shell, mit Zeitgrenze. Fehlt die Session (Start, Neustart),
  passiert nichts und es wird nicht geloggt (kein Rauschen).
- **Claude-Filter:** Eine Pane zählt nur, wenn in der Vordergrund-Prozessgruppe ihres
  Terminals ein Prozess mit `comm` = `claude` läuft: `tpgid` aus `/proc/<pane_pid>/stat`
  (Feld 8), dann alle `/proc/<pid>/stat` mit `pgrp` = `tpgid` auf `comm` prüfen. Der
  `/proc`-Pfad ist für Tests einstellbar. Begründung siehe Befunde (`pane_current_command`
  meldet `bash`). Läuft in einer interaktiven bash z. B. vim im Vordergrund, wird nichts
  gesendet.
- **Senden:** Zur fälligen Zeit wird die Pane erneut gelesen. Gesendet wird nur, wenn
  (a) Auto-Continue noch an ist, (b) der Claude-Filter greift und (c) die Limit-Meldung noch
  auf dem Bildschirm steht. Dann `tmux send-keys -t <pane_id> -l continue`, nach 0,5 s
  `tmux send-keys -t <pane_id> Enter`. Gesendet wird nur dieser feste Text; Bildschirmtext
  wird nie ausgeführt oder weitergereicht.
- Verschwundene Panes: Watcher wird verworfen (mit Log, falls etwas geplant war).
- Abstürze im Modul dürfen den Image-Service nicht beenden (try/catch je Abfrage).
- **Log** (stdout des Image-Service, landet im App-Log), Präfix `[auto-continue]`: Limit
  erkannt, geplant für (Uhrzeit), gesendet, nicht gesendet (Grund), ein-/ausgeschaltet.

### 3. Zustand und Schalter
- **Option** `auto_continue: false` (`config.yaml` options + schema `bool?`), Übersetzungen
  en/de (Hinweis: arbeitet nach dem Reset ohne Aufsicht weiter, zusammen mit „Ohne
  Rückfragen ausführen“ besonders bedenken; zur Laufzeit per Knopf oder `auto-continue`
  umschaltbar).
- **Zustandsdatei** `/run/claude-workbench/auto-continue` mit Inhalt `on` oder `off`.
  `run.sh` schreibt sie beim Start aus der Option, **vor** `start_image_service`. `/run` ist
  flüchtig: nach einem Neustart gilt wieder die Option.
- **Statusdatei** `/run/claude-workbench/auto-continue.status` (Klartext, Uhrzeiten in der
  Container-Zone), vom Image-Service nach jeder Abfrage und jedem Umschalten geschrieben;
  `auto-continue status` gibt sie nur aus (kein jq nötig). Zeilen: `Auto-continue: on|off`,
  je geplanter Pane `Will send "continue" to pane %0 at 15:01`, `Last sent: pane %0 at 14:02`
  oder `Last sent: never`. Die HTTP-Antwort (`GET`) baut dieselben Daten als JSON:
  `enabled`, `scheduled` (Liste: `pane`, `at` ISO), `lastSent` (`pane`, `at`) oder `null`.
- **Befehl** `auto-continue on|off|status` (`scripts/auto-continue.sh`, Link nach
  `/usr/local/bin/auto-continue` im Dockerfile wie `claude-doctor`). `on`/`off` schreiben die
  Zustandsdatei, `status` gibt Zustand und Plan lesbar aus (Uhrzeit lokal). Unbekanntes
  Argument → Hilfe, Exit 2. Fehlt die Statusdatei, sagt `status` das, ohne Fehler.
- **Image-Service** liest die Zustandsdatei bei jeder Abfrage und bei jedem HTTP-Aufruf. Beim
  Wechsel auf `off` werden alle geplanten Eingaben verworfen.
- **HTTP:** `GET /auto-continue` → Inhalt wie Statusdatei. `POST /auto-continue` mit JSON
  `{"enabled": true|false}` → schreibt die Zustandsdatei, antwortet mit dem neuen Status;
  alles andere als ein Boolean → 400. Nur über Ingress erreichbar wie `/upload`.
- **Knopf im Header** neben den vorhandenen: „Auto-continue: off“ / „Auto-continue: on“ /
  „Continue 15:01“ (nächste geplante Uhrzeit, Ortszeit des Browsers). Tippen schaltet um.
  Das Panel fragt beim Laden, alle 30 s und nach jedem Umschalten ab. Fehler beim Abfragen →
  Knopf zeigt „Auto-continue: ?“, kein Modal.

### Sicherheit
- Standard aus. Der Endpunkt öffnet keinen neuen Zugang: Wer Ingress erreicht, hat ohnehin
  die Root-Shell (siehe Sicherheits-Doku 3.3.0).
- tmux nur per `execFile` ohne Shell; nur der feste Text `continue` wird gesendet.
- Doku (README/DOCS): Auto-Continue arbeitet nach dem Reset ohne Aufsicht weiter, auch mit
  „Ohne Rückfragen ausführen“.

### Credits
CHANGELOG und Release-Notes: „Auto-continue after a usage limit (mattbsea, heytcass fork,
commits 16847c88 … 00e22fc0)“ und „Shift+Enter inserts a newline (mattbsea, heytcass fork,
commit 6e44e41f)“. Im App-Code nur in der Form „mattbsea's fork, commit …“ (kein
„claude-terminal“, siehe `tests/test-release-metadata.sh`).

## Ausdrücklich nicht dabei
- Kein konfigurierbarer Text statt „continue“.
- Keine HA-Benachrichtigung beim Senden.
- Keine Mobil-Toolbar-Tasten Esc/Pfeile (eigener offener Punkt).
- Keine Bildgrenze von mattbsea (`image_retention_days` gibt es seit 3.2.0).
- Laufzeit-Schalter überdauert keinen Neustart der App.
- Keine Erkennung für andere Sessions als `claude` (eigene `tmux new -s …`).

## Tests
- **Node (`tests/test-auto-continue.js`, `node --test`):** mattbseas Parser-Tests übernommen
  (Muster, relative/absolute Zeiten, Zeitzone, Sommerzeit, alter Banner); Watcher mit
  gefälschtem tmux-Runner, gefälschtem `/proc`-Baum und gefälschter Uhr: plant bei Meldung,
  sendet `-l continue` dann `Enter` an die richtige Pane-ID; sendet **nicht**, wenn die
  Meldung beim Fälligwerden weg ist, wenn `off`, wenn kein `claude` im Vordergrund; `off`
  verwirft Plan; fehlende Session wirft nicht; Statusdatei-Inhalt.
- **`tests/test-image-service.js`:** `GET`/`POST /auto-continue`, 400 bei Nicht-Boolean,
  POST schreibt die Zustandsdatei.
- **Shift+Enter:** Node-Test für `isShiftEnter` (Shift+Enter ja; Enter, Strg+Shift+Enter,
  keyup, Komposition nein) und dafür, dass der Listener `\r` mit Backslash sendet und das
  Ereignis stoppt (Fake-Fenster wie in `test-terminal-clipboard.js`).
- **Shell (`tests/test-auto-continue-cmd.sh`):** `on`/`off` schreiben die Datei, `status`
  mit und ohne Statusdatei, unbekanntes Argument → Exit 2.
- **`run.sh`:** Anfangszustand aus der Option (bestehende Test-Muster für `run.sh`).
- **`tests/test-release-metadata.sh`:** neue Option hat Übersetzungen (bestehende Prüfung),
  Link `auto-continue` im Dockerfile.

## Ende-zu-Ende-Kriterium (HA-Test)
1. **Shift+Enter:** In Claude „Zeile 1“, Shift+Enter, „Zeile 2“ → beide Zeilen stehen im
   Eingabefeld, nichts wurde abgeschickt; Enter schickt beides ab.
2. **Auto-Continue an:** Knopf zeigt „Auto-continue: off“, Tippen → „on“. In Claude
   `!echo "Claude usage limit reached. Resets at HH:MM"` mit HH:MM = jetzt + 2 min (Ortszeit
   des Containers). Erwartet binnen 30 s: App-Log „limit detected“ und „will send continue
   at …“, Knopf „Continue HH:MM+1“, `auto-continue status` zeigt denselben Plan. Etwa 1 min
   nach HH:MM: Log „sent“, in Claude wurde „continue“ abgeschickt.
3. **Gegenprobe:** Ablauf wie 2, aber vor der Uhrzeit `auto-continue off` → Log „discarded“,
   nichts wird gesendet, Knopf zeigt „off“.
4. App-Log ohne `[auto-continue]`-Zeilen, solange es aus ist.
