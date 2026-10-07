# Spec: Klare Meldung statt Hänger auf CPUs ohne SSE4.2/POPCNT (3.1.1)

Stand: 2026-10-07 · Ziel-Version: 3.1.1 · Status: Entwurf im Chat bestätigt
(Folgepunkt 3 aus Memory `claude-code-ha-followups`)

## Problem

Auf einer x86-VM mit Proxmox-CPU-Typ `kvm64` hängt Claude Code stumm: Das
Panel bleibt leer bzw. Claude startet nicht, ohne Fehlermeldung. Nutzer
sehen nicht, dass die CPU der Grund ist.

## Befunde (2026-10-07)

- **Anforderung der Binary ist x86-64-v2, nicht AVX2.** HA-Test
  vorübergehend auf Proxmox-CPU-Typ `x86-64-v2-AES`:
  `grep -o -w -E 'avx2|avx|sse4_2|popcnt' /proc/cpuinfo | sort -u` →
  `popcnt`, `sse4_2` (kein `avx`, kein `avx2`); `claude --version` →
  `2.1.292 (Claude Code)`, Autostart lief. Passt zu Buns „baseline“-Ziel
  (Nehalem: SSE4.2, POPCNT) und zur Notiz in CHANGELOG 2.0.12 (läuft auf AMD
  GX-415 ohne AVX2). Die frühere Annahme „AVX2“ (Memory) war falsch.
- `kvm64` fehlen `sse4_2` und `popcnt`; dort hängt Claude (frühere
  Beobachtung auf HA-Test, Memory).
- **Es gibt keine Alternative zum Installieren.** Manifest
  `downloads.claude.ai/claude-code-releases/2.1.292/manifest.json` kennt für
  Linux x64 nur `linux-x64` und `linux-x64-musl`, keine baseline-/legacy-
  Variante; `install.sh` prüft die CPU nicht. Das npm-Paket
  `@anthropic-ai/claude-code` 2.1.292 ist ebenfalls nur ein Wrapper um
  dieselbe native Binary (`bin/claude.exe`, `optionalDependencies`
  `…-linux-x64-musl`). Der npm-Ausweichpfad im Dockerfile (2.0.10) hilft also
  bei Download-Fehlern von `install.sh`, nicht bei der CPU.
- Claude läuft auf solchen CPUs also nicht; die App kann nur verhindern, dass
  es *stumm* hängt.

## Entscheidung

Variante 1 „klar sagen statt hängen“ (im Chat gewählt); verworfen:
nur eine Warnung im App-Log (wer nicht ins Log schaut, sieht weiter einen
Hänger); im Dockerfile `install.sh` überspringen (bringt nichts, npm liefert
dieselbe Binary); Prüfung auf AVX2 (zu streng, belegt falsch).

## Anforderungen

### 1. Gemeinsame Prüfung `claude-workbench/scripts/cpu-check.sh`

Wird von `run.sh`, Session-Picker und Health-Check eingebunden (`source`),
liegt im Image unter `/opt/scripts/cpu-check.sh`.

- `claude_cpu_missing_flags`: gibt die fehlenden Merkmale aus
  (`sse4_2`, `popcnt`, durch Leerzeichen getrennt) oder nichts.
  - Nur auf x86_64 (`uname -m`); auf aarch64 und allem anderen nichts.
  - Liest `/proc/cpuinfo` (erste `flags`-Zeile). Ist die Datei nicht lesbar
    oder hat keine `flags`-Zeile: nichts ausgeben (im Zweifel nicht blockieren).
  - Für Tests überschreibbar: `CPU_CHECK_CPUINFO` (Pfad), `CPU_CHECK_ARCH`.
- `claude_cpu_explain`: gibt den Hinweis fürs Terminal aus (englisch, wie
  die übrige Terminal-Ausgabe), z. B.:
  ```
  ⚠️  Claude Code cannot run on this CPU: it lacks sse4_2 popcnt
     (needs x86-64-v2). Proxmox: set the VM's CPU type to "host" or
     "x86-64-v2-AES" and restart the VM. The shell, ha, gh and your
     packages still work.
  ```

### 2. Health-Check (`scripts/health-check.sh`)

Neue Prüfung `check_cpu_compatibility` in `run_diagnostics`: bei fehlenden
Merkmalen `bashio::log.warning` mit derselben Aussage (Merkmale, x86-64-v2,
Proxmox-Hinweis); sonst eine `info`-Zeile „CPU meets Claude Code's requirements ✓“. Zählt
nicht als Fehler (Start läuft weiter).

### 3. Autostart (`run.sh`, `get_claude_launch_command`)

Bei fehlenden Merkmalen startet der Autostart Claude **nicht**: Warnung ins
App-Log und Startbefehl ohne `/usr/local/bin/claude` — der Session-Picker
(oder, falls nicht vorhanden, eine Login-Shell). Gilt auch für den
Rückfallpfad „Session picker not found“.

### 4. Session-Picker (`scripts/claude-session-picker.sh`)

- Alle Stellen, die die Binary aufrufen, prüfen vorher die CPU:
  - Versionsanzeige (`get_installed_claude_version`, `show_menu`) zeigt
    „not supported on this CPU“ statt `claude --version` aufzurufen.
  - Neue Sitzung, Fortsetzen, Liste, eigener Befehl: zeigen `claude_cpu_explain`
    und „Press Enter to return to menu…“ statt Claude zu starten.
  - Nach „Update Claude Code“ keine Versionsabfrage der neuen Binary.
- Am Dateiende `main "$@"` nur, wenn `CLAUDE_PICKER_SKIP_MAIN` nicht `true`
  ist (für Tests, wie `CLAUDE_RUN_SH_SKIP_MAIN` in `run.sh`).

### 4a. Nach Review ergänzt

- Picker-Menüpunkt „Auth helper“ (`launch_auth_helper`) ist ebenfalls
  geschützt: `claude-auth-helper.sh` pipet in `claude` und endet mit
  `exec claude`.
- `run.sh` `setup_persistent_claude`: bei fehlenden Merkmalen kein
  `--version`-Smoke-Test (lief 15 s in die Zeitgrenze und meldete dann
  fälschlich „no working persistent Claude install … install it manually“),
  stattdessen Warnung mit der CPU als Ursache.
- DOCS nennt den Menüpunkt „Drop to bash shell“ beim Namen (die Nummer ist
  7 oder 8, je nach `use_persistent_claude`).

### 5. Doku

`DOCS.md` → Troubleshooting: „Claude does not start / panel stays blank on
a VM“ mit Ursache (x86-64-v2: SSE4.2, POPCNT) und Proxmox-Lösung.

### 6. Tests (neue, lokal lauffähige Suite `tests/test-cpu-check.sh`)

Mit Fixture-`cpuinfo`-Dateien unter `$TMPDIR`:
- `kvm64`-Flags → `claude_cpu_missing_flags` = `sse4_2 popcnt`;
  `x86-64-v2`-Flags → leer; `CPU_CHECK_ARCH=aarch64` mit kvm64-Datei → leer;
  fehlende Datei → leer.
- `run.sh` (`get_claude_launch_command`, `auto_launch_claude=true`) mit
  kvm64-Fixture: Ausgabe enthält keinen Claude-Aufruf
  (`/usr/local/bin/claude ` bzw. am Ende), Warnung im Log; mit v2-Fixture:
  Claude-Aufruf wie bisher.
- Session-Picker (gesourct mit `CLAUDE_PICKER_SKIP_MAIN=true`, `claude` als
  Fake im PATH bzw. per `CLAUDE_BIN`-Überschreibung): mit kvm64-Fixture wird
  der Fake nie aufgerufen (Versionsanzeige, `launch_claude_new`), die
  Erklärung erscheint; mit v2-Fixture wird er aufgerufen.
- `run-tests.sh` nimmt die Suite auf; CI-ShellCheck deckt `cpu-check.sh` ab
  (`scripts/*.sh`).

### 7. Release

3.1.1 (Bug Fix), CHANGELOG, README-Badge, Release-Notes.

## Nicht enthalten

- Claude auf solchen CPUs lauffähig machen (keine Binary verfügbar).
- Änderungen am Dockerfile-Installationspfad (npm-Ausweichpfad bleibt für
  Download-Fehler).
- Prüfung weiterer CPU-Merkmale ohne Beleg.

## Ende-zu-Ende-Kriterium

1. CI grün (inkl. neuer Suite, Image-Build amd64/aarch64).
2. HA-Test auf 3.1.1, CPU-Typ vorübergehend `kvm64` (User stellt um):
   App-Log zeigt die CPU-Warnung; Panel zeigt statt Hänger den Hinweis und
   den Session-Picker; Bash (Option 8), `ha` und `gh` funktionieren.
3. HA-Test zurück auf `x86-64-v3`/`host`: Log „CPU meets Claude Code's requirements ✓“,
   Claude startet automatisch wie bisher.
4. HA-Prod: Update durch User, App-Log ohne CPU-Warnung, Claude startet.
