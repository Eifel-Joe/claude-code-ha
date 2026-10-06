# Fork-Survey: ESJavadex/claude-code-ha

Stand: 2026-10-06 · Basis: `upstream/main` = `Eifel-Joe/main` = 2.0.13 (`54b9ea4`)
Methode: alle 24 Forks als Remotes gefetcht, alle Branches; Commits, die nicht in
`upstream/*` liegen, per `git patch-id` dedupliziert (229 Treffer → 180 eindeutig).

Spalte **Empf.**: ✅ übernehmen · 🟡 prüfen/angepasst übernehmen · ❌ nicht übernehmen

## Warum keine neuen Modelle (Fable, Opus 5, Opus 5.5)?

Die Modelle hängen an der Claude-Code-CLI-Version, nicht am Add-on.
- Das Add-on wird **lokal gebaut** (kein `image:` in `config.yaml`); die CLI ist die
  „latest" vom Build-Zeitpunkt, `DISABLE_AUTOUPDATER=1` blockiert Self-Updates.
  HA baut nur neu, wenn sich `version` ändert → seit 2.0.13 eingefroren.
- Der Ausweg `use_persistent_claude` + `auto_update_claude_on_start` ist in 2.0.13
  **wirkungslos**: `$HOME/.local/bin/claude` (Build-Binary) steht im PATH vor
  `/usr/local/bin/claude` (marcjay `dc85535d`, nsleigh `7f75d61a`).
- Ein Rebuild kann **ewig hängen**: `install.sh` startet eine interaktive TUI ohne TTY
  (Upstream-Issue #44, Fix: `timeout 90` um den Installer).

## A. Kritisch / Kern-Fixes

| Fork | Commit | Inhalt | Empf. |
|---|---|---|---|
| marcjay | `dc85535d` | Persistent-Claude-Override wurde wegen PATH-Reihenfolge nie benutzt | ✅ |
| nsleigh | `7f75d61a` (PR #40) | Auto-Launch nutzt absoluten Pfad `/usr/local/bin/claude` | ✅ |
| nsleigh | `3739ac86` (PR #42) | Session-Picker zeigt tatsächliche Claude-Version | ✅ |
| Issue #44 | – | `timeout` um `install.sh` im Dockerfile (Build-Hänger) | ✅ (selbst umsetzen) |
| mmackenzie2026 | `9a02e6cd` (PR #38) | `persist-install` kopierte nie etwas (relative Pfade aus `apk info -L`) | 🟡 Alternative: Moulbi `7aa6a09f` |
| Moulbi | `89f78e34` | **Security:** ttyd auf Port 7681 = Root-Shell ohne Auth im LAN; Ports schließen, ttyd an 127.0.0.1; Healthcheck-Fix; Credential-Migration (Dotfiles) | ✅ (Breaking: kein Direktzugriff per IP:Port) |
| Moulbi | `7aa6a09f` | Persistente Pakete neu: apk-World + Cache replayen (python3 überlebt Restart); 44 Pakete raus; `hassio_role` enger | 🟡 groß, aber sauberer als #38 |
| Moulbi | `d4cbd18d` | Docker: `pipefail`, damit fehlgeschlagene Downloads den Build abbrechen | ✅ |
| Moulbi | `e1b89dab` | Doku: Credential-Pfade korrigiert + CI-Check | 🟡 |
| RobSlabaugh | `739b793a` | `IS_SANDBOX=1` immer setzen + tmux-Session-Persistenz | 🟡 tmux ist in 2.0.13 schon drin → nur IS_SANDBOX prüfen |

## B. Terminal / UI / Mobile

| Fork | Commit | Inhalt | Empf. |
|---|---|---|---|
| PeterLinuxOSS = nsleigh | `1f3b663d` (PR #37) | Kopieren aus dem Terminal funktioniert (Issue #30) | ✅ |
| PeterLinuxOSS = nsleigh | `481657d9`, `6d5bebc2`, `3002018b`, `9b7fd1bc`, `f9353ba1`, `f67f74ea`, `7dfbf3d9`, `1bcab681`, `cf8e0399` | Touch: Swipe-Scroll, Prompt über Bildschirmtastatur, Tipp-Wiederholung auf Mobil (Issue #31) | ✅ als Block |
| nsleigh | `a033e183` | Bild- und Text-Paste im ttyd-iframe (Ctrl+V → „No image found") | ✅ |
| nsleigh | `c054d838`, `975a37f1` (PR #41) | Menüpunkt „Update Claude Code" im Session-Picker, installiert vs. latest | ✅ (passt zur Modell-Frage) |
| nsleigh | `f14bd324` | Doku: Ingress-Tipp-Lag + Direktport-Workaround | 🟡 kollidiert mit Moulbi-Security-Fix |
| marcjay | `f6674b77`, `78891e6f`, `67e5ebee` | Toolbar-Buttons Esc / Shift+Tab, Portrait-Layout | 🟡 |

## C. Neue Features (optional)

| Fork | Commit | Inhalt | Empf. |
|---|---|---|---|
| martinboksa | `2c3cc623`, `9d1fc212`, `4b47e3a2` (PR #29) | Option `remote_control` → `claude --remote-control` (Issue #28) | ✅ |
| scholarnemo | `22a7cc6a` | Optionen `anthropic_auth_token`, `anthropic_base_url`, `anthropic_model` | 🟡 `anthropic_model` = Default-Modell setzbar |
| scholarnemo | `b2a93752` | Option HA-Long-Lived-Token → `HASS_TOKEN` | 🟡 |
| Pluimvee / ivanpeople / dirksenrdh | `ba5ab756`, `3b0df78a`, `c3e99f5a`+`2716b659` | `map: all_addon_configs` (Zugriff auf Configs anderer Add-ons, Issues #9/#11) | ✅ (einmal) |
| marcjay | `b557503e`, `466e1e9f`, `0c8e9b53`, `aedc898c`, `e0d7da31`, `ab616cec`, `5cd43d9f`, `640789d2` | „Claude Agent"-Layer: HA-MCP-Auto-Registrierung, SSH (Key-Auth, Host-Keys persistent), Telegram-Channel (+Bun), `/rc`, eigener Slug `claude_agent` | 🟡 nur Teile (HA-MCP, SSH) – Slug-Umbenennung nicht |
| erikvg01 | `a43fe5a3` | Port 8090 für eigenes Dashboard freigeben | ❌ privat |
| zraken | 12 Commits (`e9eeca5a` … `b391006e`) | z.ai-GLM-Backend | ❌ (durch scholarnemo `anthropic_base_url` generisch abgedeckt) |
| kvarnelis | `f933f96b`, `d9176300` | Umbau zu „Codex Terminal" (OpenAI) | ❌ |

## D. Build / CI

| Fork | Commit | Inhalt | Empf. |
|---|---|---|---|
| JanOveSaltvedt | `88ba5f64` | GitHub Action baut Docker-Image | 🟡 |
| Moulbi | in `89f78e34` | CI-Workflow | 🟡 |
| albertonoys | `076ae1f6`, `e242b4e1` | Versions-Pinning mit SHA256 für HA-CLI/gh; armv7 raus | 🟡 Pinning gut, aber blockiert „latest" Claude |
| Tecnico1931 | `5614f516` | Proxmox/ohne AVX: nur npm-Install (alt, 2.0.10 – in Upstream als Fallback enthalten) | ❌ |
| wnsdyd2234 | `a343f358`, `20989e45` | Workaround für #44: nur noch `npm install`, dann auf 2.0.30 gepinnt | ❌ (Timeout-Fix besser) |
| giantorth | `efbfa450`, `a7466d29`, `94ba1bf5` | Ingress-/Proxy-Experimente | ❌ unfertig |
| Pluimvee | `dcff5499` | Version-Bump nur zum Rebuild | ❌ (machen wir selbst) |

## E. Eigene Linie: miczu71 (129 Commits)

Kein Fork-Patch-Set, sondern ein separater Zweig („unsnow-iac" gerettet, Add-on-Version
5.1.6, Claude 2.1.289 gepinnt). Inhalte u. a.:
- Claude-Version **fest gepinnt + gebacken**, täglicher CI-Bot öffnet Bump-PRs mit Changelog
- Ingress-only (gleiche Security-Lücke wie Moulbi), least-privilege Token, Release-Automatik
- ha-mcp-Auto-Wiring, tmux + SSH, Mouse-Wheel-Fixes, Dependabot, Image-Smoke-Test in CI
- `fix/alpine-3.21-statx` = bereits in Upstream 2.0.12

Empfehlung: ❌ nicht mergen (andere Historie), aber 🟡 als Vorlage für das
Update-Konzept (Pin + Bump-Bot) nutzen.

## F. Bereits in Upstream / irrelevant

- `c6cc3b17`, `2d40d091`, `dd232ca5`, `1762dd2a`, `20d55198`, `428691e5`, `b9e27c30`,
  `f691725e` (in RobSlabaugh, erikvg01, giantorth, jimmyhideous, miczu71): alte
  1.6.x-Historie, Inhalt steht bereits in Upstream (CHANGELOG 1.6.0/1.6.1).
- Repo-URL-/Slug-/README-Umbiegungen auf den jeweiligen Fork (Pluimvee `9593be9d`,
  dirksenrdh `d2bcb030`/`3d0b9e5a`/`5cb8b96b`, scholarnemo `716da9d0`, batesaj `ff91d6d1` (Port 7682 „API bridge" ohne Code), Moulbi `efa5450e`,
  zraken `a8130385`/`62009d5a`/`b391006e`, RobSlabaugh `5c0acd10`,
  scholarnemo `ff0db75e`, nsleigh Version-/Changelog-Bumps).
