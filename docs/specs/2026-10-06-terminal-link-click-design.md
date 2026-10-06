# Spec: Umgebrochene Links im Terminal direkt anklicken

Stand: 2026-10-06 · Ziel-Version: 2.2.1 · Status: Entwurf (Ansatz 1 im Chat bestätigt)

## Problem

Claude Code gibt den OAuth-Login-Link (und andere lange URLs) hart umgebrochen über
mehrere Terminal-Zeilen aus. Ein Klick auf den Link im Terminal öffnet heute
höchstens eine **abgeschnittene** URL (erste Zeile) oder tut nichts (Folgezeilen).
Der „🔗 Copy link"-Button setzt den Link korrekt zusammen, ein Direktklick nicht.

## Ursache (belegt)

- ttyd 1.7.7 lädt `@xterm/addon-web-links` (`terminal.loadAddon(new WebLinksAddon())`
  in ttyd `html/src/components/terminal/xterm/index.ts`). Das Addon verbindet nur
  Zeilen, die xterm selbst weich umgebrochen hat (`isWrapped`).
- Die Zeilen der App sind hart umgebrochen: Claude Code bricht an `/` bzw. eine
  Spalte zu kurz um, tmux zeichnet neu, `isWrapped` ist immer `false`
  (live gemessen für 2.1.0, siehe CHANGELOG 2.1.0 und Tests
  „rejoins tmux hard-wrapped rows…" in `tests/test-terminal-clipboard.js`).
- Folge: Zeile 1 ist ein Link auf das Bruchstück; Folgezeilen beginnen ohne
  `https://` und werden nicht erkannt.
- Das Addon öffnet per `const w = window.open(); w.opener = null; w.location.href = uri`
  im iframe-Fenster.
- Bei mehreren Link-Providern gewinnt in xterm der zuerst registrierte
  (`Linkifier._checkLinkProviderResult`). Ein nachträglich registrierter eigener
  Provider verliert in Zeile 1 also gegen das Addon.

## Entscheidung: Ansatz 1

Verworfen:
- *Nur `window.open` umleiten* — Folgezeilen blieben nicht klickbar.
- *ttyd-Addon über private xterm-Felder (`_core`, `_addonManager`) abschalten* —
  bricht still bei ttyd-/xterm-Updates.

Umsetzung in `claude-terminal/image-service/public/terminal-clipboard.js`, in
`install(win, …)`, das bereits iframe-Fenster und `term` hat:

### A. Zuordnung URL → Zeilenabschnitte (reine Funktion)

`linkSpansInRows(rows, cols)` liefert alle gültigen, zusammengesetzten URLs mit
ihren Abschnitten je Quellzeile:
`[{ url, spans: [{ row, start, end }] }]` (`row` = Index in `rows`, `start`/`end`
= 0-basierte Spalten, `end` exklusiv).

- Nutzt dieselbe Zusammensetzung wie „Copy link": `joinRows` wird erweitert, so
  dass es je zusammengesetzter Zeile zusätzlich eine Zuordnung Zeichen →
  (Quellzeile, Spalte) liefert; eingefügte Leerzeichen (glue `' '`) haben keine
  Quelle. Bestehende Aufrufer bleiben unverändert.
- URL-Erkennung, Abschneiden von Satzzeichen/Klammern und Ablehnung
  (`urlProblem`) wie bei `findLastUrl`, aber für **alle** URLs einer Zeile, nicht
  nur die letzte. Abgelehnte (abgeschnittene, ungültige) URLs liefern keine Spans.
- Eine URL, die bis an das Ende der gelesenen Zeilen läuft (`atEdge`-Fall), liefert
  keine Spans — lieber kein Link als ein halber.

### B. Eigener Link-Provider (öffentliche xterm-API)

`term.registerLinkProvider({ provideLinks(y, cb) })`:
- liest ein Fenster von Zeilen um Pufferzeile `y` (je 40 Zeilen davor/danach, durch
  Pufferanfang/-ende begrenzt) und ruft `linkSpansInRows` auf;
- liefert für jeden Span auf Zeile `y` einen Link
  `{ range: {start:{x,y}, end:{x,y}} (1-basiert, end inklusive), text, activate }`;
- `activate` öffnet die **volle** URL nach demselben Muster wie das Addon
  (`window.open()`, `opener = null`, `location.href = url`).

### C. Umleitung für Zeile 1

`win.open` wird gehüllt: Ein Aufruf **ohne Argumente** (Muster des Addons) öffnet
das echte leere Fenster und gibt ein Objekt zurück, dessen `opener` an das echte
Fenster durchgereicht wird und dessen `location.href`-Setter die Ziel-URL auflöst:
ist sie ein echter (kürzerer) Anfang einer URL, die `linkSpansInRows` über den
ganzen Puffer (`rawRows(term, 'all')`) findet, wird die volle URL gesetzt — bei
mehreren Treffern die zuletzt im Puffer stehende, wie bei `findLink` —, sonst die
übergebene. Aufrufe mit Argumenten gehen unverändert
an das Original. Alles läuft synchron im Klick (kein Popup-Blocker).

Bekannter Schönheitsfehler: Beim Überfahren von Zeile 1 unterstreicht das Addon nur
das Bruchstück.

## Nicht dabei

- Klicks bei aktiviertem `tmux_mouse` (Klicks gehen dann an tmux).
- Eigenes Tipp-Verhalten auf Touch-Geräten — dort bleibt „🔗 Copy link".
- Änderungen an „Copy link"/„Copy"-Dialog, an ttyd oder am Dockerfile.
- Spaltenversatz durch doppelt breite Zeichen vor einer URL in derselben Zeile
  (`translateToString` zählt Zeichen, nicht Zellen); URLs selbst sind ASCII.

## Tests

Automatisch, `tests/test-terminal-clipboard.js` (node:test, vorhandene Fakes):
- `linkSpansInRows`: ein einzeiliger Link; harter Umbruch mit Einrückung; Umbruch
  an `/` mit kurzer Zeile; Umbruch eine Spalte zu kurz; zwei Links; abgeschnittener
  Link → keine Spans; Link am Ende der gelesenen Zeilen → keine Spans; Satzzeichen
  danach nicht im Span.
- Provider: `install` registriert einen Provider; `provideLinks` liefert für jede
  Zeile eines umgebrochenen Links einen Link mit korrekten 1-basierten Ranges und
  `text` = volle URL; `activate` öffnet die volle URL mit `opener = null`.
- Umleitung: `win.open()` + `location.href = Bruchstück` öffnet die volle URL;
  fremde URL bleibt unverändert; `win.open(url, …)` geht unverändert durch;
  Installieren zweimal hüllt nicht doppelt.

Ende-zu-Ende (zuerst HA-Test, Prod nur nach ausdrücklicher Freigabe): In der App
`/login` in Claude aufrufen, nacheinander erste, mittlere und letzte Zeile des
Links anklicken. Jeder Klick öffnet einen neuen Tab mit exakt der URL, die
„Copy link" liefert (Vergleich der Länge und des Endes der URL wird gezeigt).

## Release

2.2.1: `config.yaml`-Version, CHANGELOG-Eintrag (🐛 Bug Fix), DOCS.md-Abschnitt
„Copying Text Out of the Terminal" um den Direktklick ergänzen.
