# Spec: Verwaiste Dateien, 32-Bit-Reste zur Laufzeit, CI auf Node 24

Stand: 2026-10-07 · Ziel-Version: 2.3.1 · Status: Entwurf im Chat bestätigt
(Folgepunkte 10, 11, 12 aus Memory `claude-code-ha-followups`)

## Problem

1. **Verwaiste Dateien.**
   - `config/scripts/claude-session-picker.sh`: alte, abweichende Kopie; nichts
     verweist darauf (Skripte liegen seit 1.x unter `/opt/scripts/`, CHANGELOG).
   - `claude-terminal/scripts/install-ha-cli.sh`: wird nirgends aufgerufen,
     landet aber im Image und pinnt HA-CLI `4.42.0`.
   - Die Doku schlägt seit 2.3.0 für lokale podman-Läufe `$(pwd)/data:/data` vor;
     dort landen Credentials (`/data/home/.claude`). `.gitignore` schützt nur
     `/config/claude-config/` und `/config/options.json`.
2. **32-Bit-Reste zur Laufzeit** (2.3.0 baut nur noch amd64/aarch64):
   - `run.sh:360-365` pinnt auf armv7/armv6/armhf Claude `1.0.128`;
     `run.sh:524` (Kommentar) nennt das ARMv7-Image.
   - `claude-session-picker.sh:56` (Kommentar) nennt ARMv7.
   - **Fehler:** `persist-install --ha-cli --force` installiert fest HA-CLI
     `4.46.0` (Pin war nur für 32 Bit gedacht) — auch auf amd64/aarch64. Diese
     Kopie liegt in `/data/packages/bin`, also im PATH vor der aktuellen CLI aus
     dem Image.
3. **CI-Warnungen** (Lauf 37548664129):
   - Node 20: GitHub erzwingt seit 2026-06-16 Node 24, Node 20 ist seit
     2026-09-23 entfernt
     ([Changelog](https://github.blog/changelog/2025-09-19-deprecation-of-node-20-on-github-actions-runners/)).
     Die Actions laufen erzwungen auf Node 24 (grün), melden aber Warnungen.
   - Die Regressionstests laufen auf Node `v20.20.2`, das Image hat Node
     `22.23.2` (Alpine 3.21 `APKINDEX`).
   - `ubuntu-latest` wechselt 2026-10-19 bis 2026-11-19 auf Ubuntu 26.04
     ([runner-images#14748](https://github.com/actions/runner-images/issues/14748));
     keine entfernten Tools angekündigt.

## Entscheidung

### 1. Verwaiste Dateien
- Löschen: `config/scripts/claude-session-picker.sh`,
  `claude-terminal/scripts/install-ha-cli.sh`.
- `.gitignore`: `/data/` ergänzen (mit Kommentar: lokaler Mount, Credentials).
  Bestehende `/config/…`-Einträge bleiben unverändert.

### 2. 32-Bit-Reste
- `run.sh`: armv7-`case` mit `1.0.128` entfernen; Kommentar Remote Control ohne
  ARMv7-Hinweis.
- `claude-session-picker.sh`: Kommentar „A pinned spec (ARMv7)“ → „A pinned
  spec“; Logik bleibt.
- `persist-install` `install_ha_cli`: Version per
  `https://api.github.com/repos/home-assistant/cli/releases/latest`
  (`tag_name`), wie das Dockerfile; Arch nur `x86_64→amd64`,
  `aarch64→aarch64`. Schlägt die Abfrage fehl oder ist sie leer: Fehlermeldung,
  Exit 1, nichts installiert. Kommentar „Keep this in sync with the Dockerfile's
  32-bit pin“ entfällt.
- Regressionsschutz in `tests/test-release-metadata.sh`: kein `armv7l`,
  `armv6l`, `armhf`, `i386`, `i686`, `1.0.128`, `4.46.0` in `run.sh` und
  `claude-terminal/scripts/*`.

### 3. CI
- `actions/checkout@v7` (auch `claude.yml`), `actions/setup-node@v7`,
  `docker/setup-qemu-action@v4`, `docker/setup-buildx-action@v4`,
  `docker/build-push-action@v7`, `hadolint/hadolint-action@v3.5.0`.
  Laut Release-Notes keine uns betreffenden Breaking Changes (setup-node ≥ v5
  cacht automatisch; `cache: npm` ist ohnehin gesetzt).
- `node-version: "22"`.
- Ubuntu 26: eigener Zwischen-Commit mit `runs-on: ubuntu-26.04` für alle Jobs,
  CI-Lauf abwarten, danach Commit zurück auf `ubuntu-latest`.

### 4. Version
2.3.1 (Patch): 🐛 `persist-install --ha-cli --force`, 🔧 Bereinigung/CI.

## Nicht dabei
- Alpine 3.22+, Fork-Survey (Punkt 7), Clipboard-Monitor (Punkt 9).
- Vereinfachung der Pinned-Spec-Logik im Session-Picker.
- Weitere `.gitignore`-Umbauten (z. B. `/config/` komplett).

## Arbeitsweise
Temporäre Dateien nur unter `.tmp/` im Projekt; lokale Tests mit
`TMPDIR`/`TMP`/`TEMP` auf `D:/Entwicklung/Claude-Code-HA/.tmp`.

## Ende-zu-Ende-Kriterium
1. CI grün auf `ubuntu-26.04` (Zwischen-Commit) und auf `ubuntu-latest`
   (Endstand), jeweils ohne Node-20-Annotations; Regressionstests laufen auf
   Node 22.
2. HA-Test auf 2.3.1, `state: started`, App-Log fehlerfrei.
3. Im Terminal auf HA-Test installiert `persist-install --ha-cli --force` die
   aktuelle HA-CLI-Version (nicht 4.46.0); danach `rm /data/packages/bin/ha`.
