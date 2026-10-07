# Spec: Ehrliches Label für „Update Claude Code“ im Session-Picker (3.1.2)

Stand: 2026-10-07 · Ziel-Version: 3.1.2 · Status: Entwurf im Chat bestätigt
(Kleinpunkt aus `docs/SESSION-STAND.md`, Abschnitt 3.1.1)

## Problem

Der Menüpunkt „Update Claude Code“ (nur bei `use_persistent_claude: true`)
zeigt auf CPUs ohne x86-64-v2 „(<neueste>, up to date)“. Ursache:
`update_menu_label` in `claude-workbench/scripts/claude-session-picker.sh`
fällt im letzten Zweig auf `${installed:-$latest}` zurück. Ist die
installierte Version unbekannt, behauptet das Label „aktuell“, ohne es zu
wissen.

## Befunde

- `get_installed_version` liefert leer, wenn (a) die CPU x86-64-v2 nicht
  erfüllt (Claude wird absichtlich nicht gestartet, 3.1.1), (b)
  `$CLAUDE_BIN` nicht ausführbar ist oder (c) `--version` nichts ausgibt.
- Schwester-Pfad: (b) und (c) laufen in denselben Zweig und zeigen
  ebenfalls fälschlich „up to date“.

## Entscheidung

Eigener Zweig für „installierte Version unbekannt“, geprüft nach „neueste
unbekannt“ und vor dem Versionsvergleich:

| Lage | Label |
|---|---|
| neueste unbekannt | `Update Claude Code (latest version unknown)` (unverändert) |
| installiert unbekannt, CPU ohne x86-64-v2 | `Update Claude Code (latest <v>; installed version not checked on this CPU)` |
| installiert unbekannt, sonst | `Update Claude Code (latest <v>; installed version unknown)` |
| neuere verfügbar | `Update Claude Code (<inst> → <v> available)` (unverändert) |
| aktuell | `Update Claude Code (<inst>, up to date)` (unverändert) |

Der Menüpunkt bleibt sichtbar (Ausblenden verschöbe die Menünummern).

## Verworfen

- Menüpunkt auf solchen CPUs ausblenden: Menünummern verschieben sich, die
  Doku nennt „Drop to bash shell“ ohnehin schon mit wechselnder Nummer.
- Installierte Version aus dem npm-Paket (`package.json`) lesen: zusätzlicher
  Pfad, der nur auf nicht unterstützten CPUs hilft — dort ist ein Update
  ohnehin wirkungslos.

## Nicht dabei

Startverhalten, Update-Ablauf (`launch_update_claude`), Menünummern,
Versionszeile `claude_version_label`.

## Tests

`tests/test-cpu-check.sh`, Abschnitt Session-Picker, neueste Version
offline über `CLAUDE_NPM_SPEC=@anthropic-ai/claude-code@9.9.9`:
- kvm64 → Label enthält „not checked on this CPU“, nicht „up to date“.
- x86-64-v2, `CLAUDE_BIN` nicht vorhanden → „installed version unknown“,
  nicht „up to date“.
- x86-64-v2, Fake-Claude 2.1.292, latest 2.1.292 → „2.1.292, up to date“;
  latest 9.9.9 → „2.1.292 → 9.9.9 available“.

## Ende-zu-Ende-Kriterium

HA-Test mit `use_persistent_claude: true`: auf CPU-Typ `host` zeigt der
Menüpunkt die installierte Version (unverändert). unbestätigt, ob ein
Wechsel auf `kvm64` für den Live-Test nötig ist — die Unit-Tests decken den
CPU-Zweig ab; Entscheidung beim User.
