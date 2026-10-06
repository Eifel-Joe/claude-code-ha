# Spec: Build-Parameter ins Dockerfile, armv7 entfernen, Doku bereinigen

Stand: 2026-10-07 · Ziel-Version: 2.3.0 · Status: Entwurf im Chat bestätigt
(Folgepunkte 5, 6-Rest und 8 aus Memory `claude-code-ha-followups`)

## Problem

1. **`build.yaml` ist deprecated.** Der Supervisor warnt bei jedem Build, HA-Test
   zuletzt am 2026-10-06 17:45:31:
   `App 6ef0b4d0_claude_terminal_pro uses build.yaml which is deprecated. Move build
   parameters into the Dockerfile directly.` Laut
   [Developer-Blog 2026-04-02](https://developers.home-assistant.io/blog/2026/04/02/builder-migration)
   wird die Datei künftig gar nicht mehr gelesen.
2. **armv7 ist tot.** HA hat 32-Bit-Systeme zu 2025.12 abgekündigt
   ([Blog 2025-05-22](https://home-assistant.io/blog/2025/05/22/deprecating-core-and-supervised-installation-methods-and-32-bit-systems/));
   dort holt der Supervisor keine Update-Informationen mehr, auch nicht für Apps.
   `ghcr.io/home-assistant/armv7-base` ist bei `3.21-2025.11.1` eingefroren, das
   Multi-Arch-Image `ghcr.io/home-assistant/base:3.21` enthält nur amd64 und arm64
   (Manifest am 2026-10-07 geprüft). Die CI baut armv7 schon heute nicht mehr.
3. **Veraltete Entwickler-Doku.** `DEVELOPMENT_STATUS.md` (Statusbericht
   Session-Picker „90 % Complete"), Root-`DOCS.md` (veraltete, unverlinkte Kopie von
   `claude-terminal/DOCS.md`, nennt `/config/claude-code`), `DEVELOPMENT.md`,
   `CLAUDE.md` und `flake.nix` nennen `/config/claude-config` bzw.
   `--build-arg BUILD_FROM=…`.

## Belegtes Supervisor-Verhalten

Quelle: `home-assistant/supervisor`, `supervisor/apps/build.py` (main, 2026-10-07).

- Ohne `build.yaml`: kein Warnhinweis, **kein `BUILD_FROM`** als Build-Argument;
  `BUILD_VERSION`, `BUILD_ARCH` und `--platform <arch>` werden weiter übergeben.
- Label `io.hass.version` (und arch, type, name, description, url) setzt der
  Supervisor selbst.
- Ältere Supervisor-Versionen übergaben ohne `build.yaml` ein Standard-`BUILD_FROM`
  (`{arch}-base:latest`). Unbelegt für die aktuelle Version, aber der Grund für die
  Entscheidung „festes `FROM`" unten.

## Entscheidung

### 1. Dockerfile statt `build.yaml`

- `claude-terminal/build.yaml` wird gelöscht.
- Dockerfile beginnt mit festem `FROM ghcr.io/home-assistant/base:3.21` —
  **ohne** `ARG BUILD_FROM`, damit ein von einem älteren Supervisor übergebenes
  `BUILD_FROM` (neuestes Alpine) die Basis nicht still austauscht.
- `LABEL` im Dockerfile: `org.opencontainers.image.title`, `.description`,
  `.licenses` wie bisher; `.source` neu `https://github.com/Eifel-Joe/claude-code-ha`
  (bisher `anthropics/claude-code`). Kein Versions-Label — die Version steht nur
  noch in `config.yaml`.
- CI (`.github/workflows/ci.yml`): `base` aus der Matrix und `BUILD_FROM` aus den
  Build-Argumenten entfernen, `BUILD_ARCH` bleibt; `build.yaml` aus der
  YAML-Validierung entfernen; Hadolint-Ausnahme DL3006 samt Kommentar entfernen,
  falls Hadolint ohne sie grün ist.

### 2. armv7 entfernen

- `config.yaml`: `arch` nur noch `aarch64`, `amd64`.
- Dockerfile: 32-Bit-Zweige raus — Claude-Code-Installation `1.0.128` per npm,
  HA-CLI `4.46.0` für armv7/armhf/i386, gh `armv6`/`2.96.0` und `i386`, Fälle
  `arm/*`, `386/*`, `armv7l`, `armv6l`, `i386|i686` der Arch-Erkennung; die
  zugehörigen Kommentare werden angepasst. Unbekannte Architektur bricht den Build
  weiterhin mit Meldung ab.
- `README.md` (Badge, Tabelle, Fußnoten), `claude-terminal/README.md`
  („Multi-Architecture Support"), `CLAUDE.md` (Add-on-Struktur,
  Multi-Architecture) auf amd64/aarch64.
- CHANGELOG: deutlicher Hinweis, dass armv7 entfällt und bestehende
  armv7-Installationen (die vom Supervisor ohnehin keine Updates mehr bekommen)
  auf ihrer Version bleiben.

### 3. Tests (`tests/test-release-metadata.sh`)

Entfällt: Abgleich `build.yaml`-Label ↔ `config.yaml`, Arch ↔ `build_from`.
Neu:
- `claude-terminal/build.yaml` existiert nicht.
- `config.yaml`-`arch` enthält nur `amd64` und `aarch64` (jede andere Arch hat kein
  Basis-Image).
- Dockerfile enthält `FROM ghcr.io/home-assistant/base:` mit festem Tag und kein
  `ARG BUILD_FROM`.
- Die bestehende Credential-Pfad-Prüfung wird auf `DEVELOPMENT.md` erweitert.

### 4. Doku

| Datei | Aktion |
|---|---|
| `DEVELOPMENT_STATUS.md` | löschen |
| `DOCS.md` (Root) | löschen |
| `DEVELOPMENT.md` | `BUILD_FROM`-Aufrufe → `docker/podman build` ohne Build-Arg; `/config/claude-config` → `/data`-Volume; armv7-Cross-Build raus |
| `CLAUDE.md` | Build-/Testbefehle wie oben; `build.yaml` aus der Struktur; Arch-Liste |
| `flake.nix` | Alias `build-addon` ohne `BUILD_FROM` |

### 5. Migrationsreste — bewusst nicht umgesetzt

| Rest | Begründung |
|---|---|
| Options-Merge pinnt Standardwerte | Supervisor liefert Optionen nur mit eingemischten Standards; keine API für nur nutzergesetzte Werte (`apply.js:161-164`). Fix hieße raten. |
| pip installiert neueste statt alter Versionen | Gewollt: alte Versionen für eine ältere Python-Version scheitern evtl. im neuen Image. |
| `.egg-info` ignoriert | Selten (Legacy-Installer); Übernahme läuft einmal pro Umzug, Prod ist umgezogen — kein Nutzen. |

### 6. Version

2.3.0 (Minor): Wegfall einer Architektur, deren Systeme keine Updates mehr
erhalten; Hinweis im CHANGELOG. Version nur in `config.yaml`.

## Nicht dabei

- Alpine-Wechsel auf 3.22+ (eigenes Thema, Paketstände prüfen).
- 32-Bit-Zuordnungen zur Laufzeit in `run.sh`, `install-ha-cli.sh`,
  `persist-install` (harmlos, betreffen keinen Build).
- `MAC_CLIPBOARD_MONITOR.md` / `mac-clipboard-monitor.py` (lädt nach
  `:8123/upload`; ob das über Ingress ankommt, ist ungeprüft) und die verwaiste
  Kopie `config/scripts/claude-session-picker.sh` → neue Folgepunkte im Memory.
- Sonstige Dockerfile-Änderungen.

## Ende-zu-Ende-Kriterium

1. CI grün, inklusive Image-Builds amd64 und aarch64.
2. HA-Test aktualisiert auf 2.3.0; Supervisor-Log zeigt für
   `6ef0b4d0_claude_terminal_pro` nach dem Update-Zeitpunkt **keine**
   `uses build.yaml which is deprecated`-Warnung (Gegenprobe vorher: Warnung
   2026-10-06 17:45:31 vorhanden).
3. App `state: started`, `claude --version` im Terminal liefert eine Version.
