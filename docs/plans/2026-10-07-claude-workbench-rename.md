# Umbenennung in „Claude Workbench“ (3.0.0) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Release 3.0.0: die App heißt „Claude Workbench“ (Slug `claude_workbench`), liegt in `claude-workbench/`, im Repo `Eifel-Joe/claude-workbench`, hat ein eigenes Logo und eine eigene README mit Credits; die Übernahme aus `*_claude_terminal_pro` (ESJavadex und bisherige Eifel-Joe-App) bleibt.

**Architecture:** Reine Umbenennung ohne Funktionsänderung. Schutztests in `tests/test-release-metadata.sh` halten Name, Slug, Repo-URL, Logo-Größe und Selbstbezeichnung fest (RED vor jeder Änderung). Die Übernahme ändert nur den Backup-Namen; ihre Tests laufen mit der neuen eigenen Slug. Das GitHub-Repo wird erst nach grüner Branch-CI umbenannt, gemergt wird danach.

**Tech Stack:** Bash, Node `node:test`, Python + Pillow (nur Logo-Skript), GitHub Actions.

**Spec:** `docs/specs/2026-10-07-claude-workbench-rename-design.md`

**Arbeitsregeln (auch für Subagenten):**
- Branch `feat/claude-workbench` (existiert, Spec-Commit `bcfe8c8`). Nicht auf `main` arbeiten.
- Keine Temp-Dateien auf C:. Jede Shell vor Tests:
  `export TMPDIR=/d/Entwicklung/Claude-Code-HA/.tmp TMP='D:\Entwicklung\Claude-Code-HA\.tmp' TEMP='D:\Entwicklung\Claude-Code-HA\.tmp'`
- Mehrzeilige Ersetzungen mit dem Edit-Tool, nicht per Heredoc im Bash-Tool (Backslashes werden verstümmelt). Ergebnis jeweils per `git diff` prüfen.
- Kommentare dürfen weder `api.github.com` noch 32-Bit-Namen/-Versionen (`armv7`, `i386`, `1.0.128`, `4.46.0`) enthalten (bestehende Schutztests).
- Nach jeder Änderung: `git ls-files --eol | grep -c "crlf\|mixed"` → `0`.
- `gh` immer mit `--repo Eifel-Joe/claude-code-ha` (nach Task 10: `Eifel-Joe/claude-workbench`).
- Push, Repo-Umbenennung, Tag, Release und gh-Texte nur nach Freigabe des Users im Chat.

**Lokale Suiten** (in Task-Schritten „lokale Suiten“ genannt):
```bash
bash tests/test-release-metadata.sh
bash tests/test-persist-install.sh
bash tests/test-startup-timeouts.sh
node tests/test-terminal-clipboard.js
PATH="/c/WINDOWS/system32:$PATH" node --test tests/test-app-migration.js
shellcheck -S warning -e SC1008,SC1007,SC2155 -x claude-workbench/run.sh claude-workbench/scripts/*.sh claude-workbench/scripts/persist-install tests/*.sh
```
(Vor Task 1 heißt der Ordner noch `claude-terminal/`.) Node 24 meldet `ℹ pass N` / `ℹ fail 0`.

---

### Task 1: Ordner umbenennen, Pfade nachziehen (Refactor, Suiten bleiben grün)

**Files:**
- Rename: `claude-terminal/` → `claude-workbench/`
- Modify: `.github/workflows/ci.yml`, `tests/run-tests.sh`, `tests/test-persist-install.sh`, `tests/test-production-run.sh`, `tests/test-release-metadata.sh`, `tests/test-startup-hardening.sh`, `tests/test-startup-timeouts.sh`, `tests/test-app-migration.js`, `tests/test-image-service.js`, `tests/test-terminal-clipboard.js`, `flake.nix`, `CLAUDE.md`, `DEVELOPMENT.md`, `README.md`

- [x] **Step 1: Ausgangslage grün** — lokale Suiten mit dem alten Pfad laufen lassen (Shellcheck-Pfade `claude-terminal/…`). Erwartet: alle grün.

- [x] **Step 2: Ordner verschieben**

```bash
git mv claude-terminal claude-workbench
```

- [x] **Step 3: Pfade ersetzen** (einzeiliges `sed`, keine Backslashes nötig):

```bash
sed -i 's#claude-terminal#claude-workbench#g' \
  .github/workflows/ci.yml tests/run-tests.sh tests/test-persist-install.sh \
  tests/test-production-run.sh tests/test-release-metadata.sh \
  tests/test-startup-hardening.sh tests/test-startup-timeouts.sh \
  tests/test-app-migration.js tests/test-image-service.js \
  tests/test-terminal-clipboard.js flake.nix CLAUDE.md DEVELOPMENT.md README.md
```

Betroffen sind auch Image-Tags wie `local/claude-terminal:test` → `local/claude-workbench:test` und `local/claude-terminal-pro` → `local/claude-workbench-pro` in `CLAUDE.md` — Letzteres per Edit-Tool auf `local/claude-workbench` korrigieren (2 Stellen, `CLAUDE.md` Zeilen ~31 und ~34).

- [x] **Step 4: Kontrolle**

```bash
git grep -n "claude-terminal" -- . ':!docs' ':!claude-workbench/CHANGELOG.md'
```
Erwartet: nur `claude-workbench/image-service/package.json`, `package-lock.json` (Paketname, Task 4), `claude-workbench/image-service/public/terminal-clipboard.js:660` (Task 4), `claude-workbench/PERSISTENT_PACKAGES.md` (Task 6). `git diff --stat` zeigt die Renames als `R100`-Einträge (`git status` → `renamed:`).

- [x] **Step 5: Lokale Suiten** (jetzt mit `claude-workbench/…`). Erwartet: alle grün, gleiche Testanzahl wie in Step 1.

- [x] **Step 6: Commit**

```bash
git add -A claude-terminal claude-workbench
git add .github/workflows/ci.yml tests flake.nix CLAUDE.md DEVELOPMENT.md README.md
git status --short   # nur Renames + die genannten Dateien
git commit -m "refactor: move the app folder to claude-workbench/

First step of the rename to Claude Workbench; paths only, no behaviour change.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Identität — Name, Slug, Repo-URL, Docker-Labels

**Files:**
- Modify: `tests/test-release-metadata.sh` (vor der letzten `echo`-Zeile)
- Modify: `claude-workbench/config.yaml:2-5,14,20`, `repository.yaml`, `claude-workbench/Dockerfile:8,10`

- [x] **Step 1: Schutztest schreiben** — direkt vor `echo "Release metadata suite passed (version $config_version)"` (Edit-Tool):

```bash
# Claude Workbench is an app of its own (spec 2026-10-07-claude-workbench-rename):
# own name, slug and repository, so it is not mistaken for ESJavadex's
# Claude Terminal Pro. The takeover keeps finding *_claude_terminal_pro apps.
config_field() {
    sed -n "s/^$1: *\"\{0,1\}\([^\"]*\)\"\{0,1\}\$/\1/p" "$addon_dir/config.yaml"
}
new_repo_url="https://github.com/Eifel-Joe/claude-workbench"
[ "$(config_field name)" = "Claude Workbench" ] || \
    fail "config.yaml name is '$(config_field name)', expected 'Claude Workbench'"
[ "$(config_field slug)" = "claude_workbench" ] || \
    fail "config.yaml slug is '$(config_field slug)', expected 'claude_workbench'"
[ "$(config_field panel_title)" = "Claude Workbench" ] || \
    fail "config.yaml panel_title is '$(config_field panel_title)', expected 'Claude Workbench'"
[ "$(config_field url)" = "$new_repo_url" ] || \
    fail "config.yaml url is '$(config_field url)', expected $new_repo_url"
grep -qx "url: $new_repo_url" "$repo_root/repository.yaml" || \
    fail "repository.yaml does not point to $new_repo_url"
grep -qx 'name: Claude Workbench for Home Assistant' "$repo_root/repository.yaml" || \
    fail "repository.yaml name is not 'Claude Workbench for Home Assistant'"
grep -q 'image.title="Home Assistant App: Claude Workbench"' "$dockerfile" || \
    fail "Dockerfile image.title label does not name Claude Workbench"
grep -q "image.source=\"$new_repo_url\"" "$dockerfile" || \
    fail "Dockerfile image.source label does not point to $new_repo_url"
```

- [x] **Step 2: RED prüfen**

Run: `bash tests/test-release-metadata.sh`
Expected: `FAIL (release metadata): config.yaml name is 'Claude Terminal Pro', expected 'Claude Workbench'`

- [x] **Step 3: `config.yaml`** (Edit-Tool):

```yaml
name: "Claude Workbench"
description: "Workbench for Anthropic's Claude Code CLI in Home Assistant: web terminal, persistent auth and packages, image paste, HA and GitHub CLIs"
version: "2.3.4"
slug: "claude_workbench"
```
(Version bleibt hier 2.3.4 — Bump in Task 7.) Außerdem `url: "https://github.com/Eifel-Joe/claude-workbench"` und `panel_title: "Claude Workbench"`.

- [x] **Step 4: `repository.yaml`** komplett:

```yaml
name: Claude Workbench for Home Assistant
url: https://github.com/Eifel-Joe/claude-workbench
maintainer: Eifel-Joe
```

- [x] **Step 5: Dockerfile-Labels**

```dockerfile
    org.opencontainers.image.title="Home Assistant App: Claude Workbench" \
    org.opencontainers.image.description="Workbench for Anthropic's Claude Code CLI in Home Assistant" \
    org.opencontainers.image.source="https://github.com/Eifel-Joe/claude-workbench" \
```

- [x] **Step 6: GREEN** — `bash tests/test-release-metadata.sh` → `Release metadata suite passed (version 2.3.4)`. Danach lokale Suiten komplett grün.

- [x] **Step 7: Commit**

```bash
git add tests/test-release-metadata.sh claude-workbench/config.yaml repository.yaml claude-workbench/Dockerfile
git commit -m "feat: name the app Claude Workbench with slug claude_workbench

Own name, slug and repository URL so the app is no longer mistaken for
ESJavadex's Claude Terminal Pro; a metadata test keeps them in place.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Übernahme — eigener Slug, Backup-Name, Schutztest

**Files:**
- Modify: `tests/fake-supervisor.js:9,72`, `tests/test-app-migration.js:213,623` + neuer Test nach `detect: prefers a running old app over a stopped one`
- Modify: `claude-workbench/scripts/app-migration/apply.js:39`, `claude-workbench/scripts/app-migration/dialog.js:68`

- [x] **Step 1: Tests anpassen (RED)**
  - `tests/fake-supervisor.js:9`: `const SELF_SLUG = '0e003122_claude_workbench';` (nach Review; vorher `6ef0b4d0_…`)
  - `tests/fake-supervisor.js:72`: `{ slug: SELF_SLUG, name: 'Claude Workbench', version: '3.0.0', state: 'started' },`
  - `tests/test-app-migration.js:213`: `name: 'Claude Workbench – Übernahme 2026-10-06', addons: [OLD_SLUG], homeassistant: false, background: true,`
  - `tests/test-app-migration.js:623`: `assert.match(kept, /Claude Workbench – Übernahme/);`
  - Neuer Test direkt nach `detect: prefers a running old app over a stopped one`:

```js
// The renamed app (3.0.0) still takes over from *_claude_terminal_pro, but a
// second Claude Workbench is never a source, even while it runs.
test('detect: never offers another Claude Workbench as the source', async () => {
  const apps = [
    { slug: SELF_SLUG, state: 'started' },
    { slug: 'ffff0000_claude_workbench', state: 'started' },
    { slug: OLD_SLUG, state: 'stopped' },
  ];
  await withSupervisor({ apps }, async (client, p) => {
    assert.equal((await detect(client, p)).offer.slug, OLD_SLUG);
  });
});
```

- [x] **Step 2: RED prüfen**

Run: `PATH="/c/WINDOWS/system32:$PATH" node --test tests/test-app-migration.js`
Expected: genau 2 Fehlschläge — `apply: creates a named partial backup of only the old app` (Name „Claude Terminal Pro – Übernahme …“) und `summary: a fatal result says whether the backup was removed`. Der neue Detect-Test ist sofort grün (Schutztest, sichert bestehendes Verhalten).

- [x] **Step 3: Implementierung**
  - `apply.js:39`: ``    name: `Claude Workbench – Übernahme ${date}`,``
  - `dialog.js:68`: ``        : [`  The partial backup "Claude Workbench – Übernahme …" (${result.backupSlug}) could not be deleted;`,``

- [x] **Step 4: GREEN** — Migrationssuite: `ℹ fail 0`, Anzahl = vorher + 1. Lokale Suiten grün.

- [x] **Step 5: Commit**

```bash
git add tests/fake-supervisor.js tests/test-app-migration.js claude-workbench/scripts/app-migration/apply.js claude-workbench/scripts/app-migration/dialog.js
git commit -m "feat(migration): name the takeover backup after Claude Workbench

Detection still looks for *_claude_terminal_pro (ESJavadex and the app
before 3.0.0); a new test pins that a second Claude Workbench is never
offered as the source.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Selbstbezeichnung im App-Code

**Files:**
- Modify: `tests/test-release-metadata.sh`
- Modify: `claude-workbench/run.sh:533,535,543,752`, `claude-workbench/scripts/claude-session-picker.sh:21,233`, `claude-workbench/scripts/health-check.sh:3,134`, `claude-workbench/scripts/ha-api-examples.sh:3`, `claude-workbench/scripts/persist-install:347`, `claude-workbench/image-service/server.js:4,160`, `claude-workbench/image-service/public/index.html:10,444`, `claude-workbench/image-service/public/terminal-clipboard.js:660`, `claude-workbench/image-service/package.json:2,4`, `claude-workbench/image-service/package-lock.json:2,8`

- [x] **Step 1: Schutztest** — nach dem Block aus Task 2 einfügen:

```bash
# The app calls itself Claude Workbench. "Claude Terminal" stays only where the
# old app is meant ("another Claude Terminal Pro app", the takeover code).
if grep -rn 'Claude Terminal' "$addon_dir/run.sh" "$addon_dir/scripts" \
        "$addon_dir/image-service/server.js" "$addon_dir/image-service/public" \
        --exclude-dir=app-migration | grep -v 'Claude Terminal Pro app'; then
    fail "the app still calls itself Claude Terminal (see lines above)"
fi
grep -q '"name": "claude-workbench-image-service"' "$addon_dir/image-service/package.json" || \
    fail "image-service/package.json is not named claude-workbench-image-service"
```

- [x] **Step 2: RED** — `bash tests/test-release-metadata.sh` listet die Fundstellen (`run.sh` Begrüßung, Session-Picker, health-check, ha-api-examples, persist-install, server.js, index.html) und endet mit `FAIL (release metadata): the app still calls itself Claude Terminal (see lines above)`.

- [x] **Step 3: Implementierung**
  - `run.sh` 533/535/543: `Welcome to Claude Terminal!` → `Welcome to Claude Workbench!` (`sed -i 's/Welcome to Claude Terminal!/Welcome to Claude Workbench!/' claude-workbench/run.sh`); 752: `Initializing Claude Workbench app...`. Kommentar 661 („another Claude Terminal Pro app (e.g. the ESJavadex original)“) bleibt.
  - `claude-session-picker.sh:21` (Rahmenbreite bleibt, ein Leerzeichen weniger):
    `    echo "║                    🤖 Claude Workbench                       ║"`
  - `claude-session-picker.sh:233`: Zeile `echo "   Update to Claude Terminal Pro v2.0.4+ to get gh pre-installed."` ersetzen durch
    `        echo "   Restart the app to reinstall it, or run: persist-install github-cli"`
  - `health-check.sh:3`: `# Health check script for the Claude Workbench app`; `:134`: `bashio::log.info "Claude Workbench Health Check"`
  - `ha-api-examples.sh:3`: `# Home Assistant API Examples for Claude Workbench`
  - `persist-install:347`: `echo "This script must run inside the Claude Workbench app"`
  - `server.js:4`: ` * Claude Workbench - Image Upload Service`; `:160`: `` console.log(`Claude Workbench image service running on port ${PORT}`); ``
  - `index.html:10`: `<title>Claude Workbench</title>`; `:444`: `<div id="header-title">Claude Workbench - Voice & image support</div>`
  - `terminal-clipboard.js:660`: `'claude-workbench: selection copy handled by the clipboard bridge'`
  - `package.json`: `"name": "claude-workbench-image-service"`, `"description": "Lightweight image upload service for Claude Workbench"`; `package-lock.json` Zeilen 2 und 8: `"name": "claude-workbench-image-service"`.

- [x] **Step 4: GREEN** — `bash tests/test-release-metadata.sh` grün; lokale Suiten grün (Clipboard-Suite: gleiche Anzahl).

- [x] **Step 5: Commit**

```bash
git add tests/test-release-metadata.sh claude-workbench/run.sh claude-workbench/scripts claude-workbench/image-service
git status --short   # kein node_modules
git commit -m "feat: the app calls itself Claude Workbench

Greeting, session picker, health check, image service and package name;
text about the old app and the takeover keeps saying Claude Terminal Pro.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Logo

**Files:**
- Create: `tools/make-logo.py`, `tools/logo/claude-spark.png` (Kopie des bisherigen `logo.png`)
- Modify: `claude-workbench/icon.png` (128×128), `claude-workbench/logo.png` (256×256)
- Modify: `tests/test-release-metadata.sh`

- [x] **Step 1: Schutztest**

```bash
# Icon and logo come from tools/make-logo.py (original spark plus ">_" in a
# terminal window). Home Assistant expects a 128x128 icon.
png_size() {
    od -An -tu1 -j16 -N8 "$1" | \
        awk '{print ($1*16777216+$2*65536+$3*256+$4) "x" ($5*16777216+$6*65536+$7*256+$8)}'
}
[ "$(png_size "$addon_dir/icon.png")" = "128x128" ] || \
    fail "icon.png is $(png_size "$addon_dir/icon.png"), expected 128x128 (tools/make-logo.py)"
[ "$(png_size "$addon_dir/logo.png")" = "256x256" ] || \
    fail "logo.png is $(png_size "$addon_dir/logo.png"), expected 256x256 (tools/make-logo.py)"
[ -f "$repo_root/tools/logo/claude-spark.png" ] || \
    fail "tools/logo/claude-spark.png (logo source) is missing"
```

- [x] **Step 2: RED** — Expected: `FAIL (release metadata): icon.png is 64x64, expected 128x128 (tools/make-logo.py)`

- [x] **Step 3: Quelle sichern** (vor dem Überschreiben!)

```bash
mkdir -p tools/logo && cp claude-workbench/logo.png tools/logo/claude-spark.png
```

- [x] **Step 4: `tools/make-logo.py`** (Write-Tool):

```python
"""Builds icon.png and logo.png for Claude Workbench.

The original Claude spark (tools/logo/claude-spark.png, the app's logo before
3.0.0) sits in a dark terminal window next to a ">_" prompt; chosen over a
redrawn spark in the 3.0.0 rename (docs/specs/2026-10-07-claude-workbench-rename-design.md).
The prompt is drawn as lines, so no font is needed. Run by hand after a logo
change: python tools/make-logo.py (needs Pillow).
"""
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SPARK = ROOT / "tools" / "logo" / "claude-spark.png"
APP = ROOT / "claude-workbench"
S = 512  # drawn at 512 px, scaled down for a clean edge

BACKGROUND = "#F1EFE8"
WINDOW = "#2C2C2A"
DOTS = "#888780"
PROMPT = "#F1EFE8"


def master():
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, S - 1, S - 1], radius=100, fill=BACKGROUND)
    win = (56, 72, S - 56, S - 72)
    d.rounded_rectangle(win, radius=36, fill=WINDOW)
    for x in (100, 136):
        d.ellipse([x - 12, 96, x + 12, 120], fill=DOTS)

    spark = Image.open(SPARK).convert("RGBA")
    spark = spark.crop(spark.getbbox())
    size = 230
    spark = spark.resize((size, size), Image.LANCZOS)
    cx, cy = S // 2 + 52, (win[1] + win[3]) // 2 + 6
    img.alpha_composite(spark, (cx - size // 2, cy - size // 2))

    # ">_" in the lower left corner of the window
    base = win[3] - 50
    d.line([(96, base - 70), (140, base - 35), (96, base)], fill=PROMPT, width=20, joint="curve")
    d.rounded_rectangle([160, base - 10, 224, base + 8], radius=6, fill=PROMPT)
    return img


def main():
    img = master()
    img.resize((128, 128), Image.LANCZOS).save(APP / "icon.png", optimize=True)
    img.resize((256, 256), Image.LANCZOS).save(APP / "logo.png", optimize=True)
    print("wrote", APP / "icon.png", "and", APP / "logo.png")


if __name__ == "__main__":
    main()
```

- [x] **Step 5: Erzeugen und ansehen**

```bash
python tools/make-logo.py
```
Expected: `wrote …icon.png and …logo.png`. Dann beide Bilder mit dem Read-Tool ansehen und mit `docs/plans/2026-10-07-claude-workbench-logo-preview.png` (vom User bestätigt) vergleichen: Fenster mit zwei Punkten, Original-Funke rechts oben, `>_` links unten, gut lesbar. Abweichungen (z. B. `>`-Größe) im Skript korrigieren, nicht in den PNGs. Ergebnis dem User per SendUserFile zeigen.

- [x] **Step 6: GREEN** — `bash tests/test-release-metadata.sh` grün.

- [x] **Step 7: Commit**

```bash
git add tools/make-logo.py tools/logo/claude-spark.png claude-workbench/icon.png claude-workbench/logo.png tests/test-release-metadata.sh
git commit -m "feat: Claude Workbench logo - original spark and prompt in a terminal window

Generated by tools/make-logo.py from the previous logo, so it can be
rebuilt; icon now at Home Assistant's 128x128.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Dokumentation, Credits, Lizenz, alte Repo-URL

**Files:**
- Modify: `tests/test-release-metadata.sh`
- Modify: `README.md`, `claude-workbench/README.md`, `claude-workbench/DOCS.md`, `claude-workbench/PERSISTENT_PACKAGES.md`, `claude-workbench/IMAGE_PASTE.md`, `claude-workbench/.claude/skills/persistent-package-manager/SKILL.md`, `CLAUDE.md`, `DEVELOPMENT.md`, `flake.nix`, `LICENSE`

- [x] **Step 1: Schutztest**

```bash
# After the GitHub rename the old repository URL only works through GitHub's
# redirect; links and the "add repository" button must use the new one.
# docs/ and the changelog keep history as it was.
if git -C "$repo_root" grep -n 'Eifel-Joe/claude-code-ha' -- . ':!docs' \
        ':!claude-workbench/CHANGELOG.md' ':!tests/test-release-metadata.sh'; then
    fail "the old repository URL Eifel-Joe/claude-code-ha is still used (see lines above)"
fi
# The MIT license must name its copyright holders, not the template placeholder.
if grep -n 'Your Name' "$repo_root/LICENSE"; then
    fail "LICENSE still carries the template placeholder instead of the copyright holders"
fi
grep -q 'Switching from Claude Terminal Pro' "$repo_root/README.md" || \
    fail "README.md has no 'Switching from Claude Terminal Pro' section"
```

- [x] **Step 2: RED** — Expected: Fundstellen der alten URL (README, DOCS, App-README, CLAUDE.md …), dann `FAIL (release metadata): the old repository URL …`.

- [x] **Step 3: `LICENSE`** — Zeile 3 ersetzen durch:

```
Copyright (c) 2025 Tom Cassady (original Claude Terminal app)
Copyright (c) 2025 Javier Santos (Claude Terminal Pro)
Copyright (c) 2026 Eifel-Joe (Claude Workbench)
```

- [x] **Step 4: Root-`README.md`** — Zeilen 1 bis einschließlich der Zeile vor `## Install` ersetzen (Edit-Tool) durch:

```markdown
# Claude Workbench for Home Assistant

[![Version](https://img.shields.io/badge/version-2.3.4-1f6feb)](claude-workbench/CHANGELOG.md)
[![Latest release](https://img.shields.io/github/v/release/Eifel-Joe/claude-workbench?label=release&color=1f6feb)](https://github.com/Eifel-Joe/claude-workbench/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-3fb950)](LICENSE)
[![Architectures](https://img.shields.io/badge/arch-amd64%20%7C%20aarch64-8957e5)](#architecture-support)
[![Base image](https://img.shields.io/badge/base-Alpine%203.21-0db7ed)](claude-workbench/Dockerfile)

<img src="claude-workbench/logo.png" alt="Claude Workbench logo" width="96" align="right">

Claude Workbench is a Home Assistant app that runs Anthropic's **Claude Code CLI** in a browser-based terminal, right inside your dashboard. It ships the tools you need for Home Assistant work — the `ha` and `gh` CLIs, git, Python — keeps your session alive across restarts with tmux, updates Claude Code on every start so new models work right away, and lets you install extra packages that survive reboots.

![Claude Workbench screenshot](claude-workbench/screenshot.png)

**Highlights**

- **Always current Claude Code** — updated on every start, plus a 🔄 *Update Claude Code* menu item
- **Secure by default** — reachable only through the Home Assistant sidebar (ingress), no open port
- **Phone-friendly terminal** — copy, swipe scrolling, on-screen keyboard, image paste, clickable login links
- **Persistent packages** — `persist-install` keeps apk and pip packages across restarts
- **Remote Control** and access to other apps' config folders
- **One-step switch from Claude Terminal Pro** — see below

Claude Workbench grew out of Claude Terminal Pro; see [Credits](#credits).

## Switching from Claude Terminal Pro

This works for ESJavadex's Claude Terminal Pro and for this project's own app before 3.0.0 (it was called Claude Terminal Pro, too). Home Assistant treats Claude Workbench as a new app, so it is installed next to the old one:

1. Add the repository `https://github.com/Eifel-Joe/claude-workbench` (see [Install](#install)).
2. Install **Claude Workbench** and start it.
3. Open the panel. Claude Workbench finds the old app and offers to take over your Claude memories, `CLAUDE.md`, history, logins, packages and settings — via a partial backup of the old app, which is kept as a fallback. The old app is stopped afterwards.
4. Once everything works, uninstall the old app.
5. Remove the old repository entry (**Settings → Apps → App Store → ⋮ → Repositories**). This project's old URL (ending in `claude-code-ha`) is redirected by GitHub to the new one, so Claude Workbench would otherwise show up twice.

---
```

Danach im Rest der Datei:
  - Install-Abschnitt: Badge-Link `repository_url=https%3A%2F%2Fgithub.com%2FEifel-Joe%2Fclaude-workbench`, Schritt 3 `Add https://github.com/Eifel-Joe/claude-workbench`, Schritt 4 `Install **Claude Workbench** …`.
  - Support: Issues-Link `https://github.com/Eifel-Joe/claude-workbench/issues`.
  - `## Credits` ersetzen durch:

```markdown
## Credits

Claude Workbench is maintained by [@Eifel-Joe](https://github.com/Eifel-Joe). It grew out of
**Claude Terminal Pro** and would not exist without the people who built it:

- **Javier Santos** ([@ESJavadex](https://github.com/ESJavadex)) — created Claude Terminal Pro
  ([ESJavadex/claude-code-ha](https://github.com/ESJavadex/claude-code-ha)): persistent packages,
  tmux persistence, multi-arch and much more. Greetings and thanks, Javier! More of his
  AI + Home Assistant work: [Javadex](https://www.javadex.es/)
- **Tom Cassady** ([@heytcass](https://github.com/heytcass)) — created the original Claude Terminal app
  ([heytcass/home-assistant-addons](https://github.com/heytcass/home-assistant-addons))
- **Community fork contributions:** [@Moulbi](https://github.com/Moulbi),
  [@PeterLinuxOSS](https://github.com/PeterLinuxOSS), [@nsleigh](https://github.com/nsleigh),
  [@marcjay](https://github.com/marcjay), [@martinboksa](https://github.com/martinboksa) —
  each change is credited in the [changelog](claude-workbench/CHANGELOG.md)

Built and maintained with the help of Claude Code itself.

**Trademarks:** Claude, Claude Code and the Claude spark logo are trademarks of Anthropic.
Claude Workbench is an independent community project and is not made or endorsed by Anthropic.
```

  - Übrige Vorkommen von „Claude Terminal Pro“ als Selbstbezeichnung (`grep -n "Claude Terminal" README.md`) → „Claude Workbench“; Erwähnungen der alten App bleiben.

- [x] **Step 5: `claude-workbench/README.md`** (Store-Seite der App):
  - Titel `# Claude Workbench for Home Assistant`, Untertitel: `A workbench for Anthropic's Claude Code CLI in Home Assistant: web terminal, persistent packages, HA and GitHub CLIs.`
  - Bild: `![Claude Workbench screenshot](screenshot.png)`, Bildunterschrift `*Claude Workbench running in Home Assistant*`.
  - Fork-Attribution-Kasten (Zeile 9) ersetzen durch: `> Claude Workbench grew out of Claude Terminal Pro by Javier Santos ([ESJavadex/claude-code-ha](https://github.com/ESJavadex/claude-code-ha)), which builds on Tom Cassady's Claude Terminal ([heytcass/home-assistant-addons](https://github.com/heytcass/home-assistant-addons)). See [Credits](#credits).`
  - `## What is Claude Terminal Pro?` → `## What is Claude Workbench?`
  - Installation: URL `https://github.com/Eifel-Joe/claude-workbench`, `Install the Claude Workbench app`.
  - Neuer Abschnitt nach Installation: `## Switching from Claude Terminal Pro` mit denselben 5 Schritten wie in der Root-README.
  - `## Credits` ersetzen durch:

```markdown
## Credits

**Maintainer:** [@Eifel-Joe](https://github.com/Eifel-Joe)
**Claude Terminal Pro:** Javier Santos ([@ESJavadex](https://github.com/ESJavadex)) — persistent package management and many enhancements Claude Workbench builds on
**Original Claude Terminal:** Tom Cassady ([@heytcass](https://github.com/heytcass)) — the initial app

Claude, Claude Code and the Claude spark logo are trademarks of Anthropic. Claude Workbench is an independent community project and is not made or endorsed by Anthropic.
```

- [x] **Step 6: `claude-workbench/DOCS.md`** (in HA angezeigt):
  - Titel `# Claude Workbench`, Untertitel `A workbench for Anthropic's Claude Code CLI in Home Assistant.`
  - About: `Claude Workbench provides a web-based terminal with Claude Code CLI pre-installed plus persistent package management. It grew out of Claude Terminal Pro (ESJavadex) and the original Claude Terminal (heytcass).`
  - Installation: URL `https://github.com/Eifel-Joe/claude-workbench`, `Install the Claude Workbench app`.
  - `### Switching from another Claude Terminal Pro app` → `### Switching from Claude Terminal Pro`; erster Satz: `If a Claude Terminal Pro app is installed — ESJavadex's, or this project's own app before 3.0.0 — Claude Workbench offers on the first panel open to take over its data.` Rest (Ziffern 1–6) bleibt. Danach ergänzen: `Afterwards uninstall the old app and remove its repository entry (Settings → Apps → App Store → ⋮ → Repositories); GitHub redirects this project's old URL, so Claude Workbench would otherwise show up twice.`
  - Credits wie in Step 5 (Maintainer / Claude Terminal Pro / Original Claude Terminal + Markenhinweis).

- [x] **Step 7: Übrige Doku**
  - `PERSISTENT_PACKAGES.md`: `**Settings** → **Add-ons** → **Claude Terminal**` → `**Settings** → **Apps** → **Claude Workbench**` (Zeilen ~102, ~383); Abschnitt `### Via config file (Advanced)` (ab Zeile ~122 bis vor `## 📚 Examples`) löschen — bashio liest Optionen über die Supervisor-API, die Datei gibt es nicht.
  - `IMAGE_PASTE.md:5`: `Claude Workbench supports pasting and uploading images …`
  - `SKILL.md:14`: `… in the Claude Workbench Home Assistant app that …`; `:254`: `**Settings** → **Apps** → **Claude Workbench**`.
  - `CLAUDE.md`: Projektbeschreibung Zeile 7 → `**Claude Workbench** app (formerly Claude Terminal Pro)`; Fork-Attribution Zeile 9 → `**Origin:** Claude Workbench (Eifel-Joe/claude-workbench) grew out of [ESJavadex/claude-code-ha](https://github.com/ESJavadex/claude-code-ha) (Claude Terminal Pro) by Javier Santos, itself based on [heytcass/home-assistant-addons](https://github.com/heytcass/home-assistant-addons) by Tom Cassady.`; Zeile 23 `Build the Claude Workbench app with Podman`; Zeile ~364 `Settings → Apps → Claude Workbench`.
  - `DEVELOPMENT.md:3`: `… for the Claude Workbench app.`
  - `flake.nix:37`: `Build the Claude Workbench app`.

- [x] **Step 8: GREEN + Kontrolle**

```bash
bash tests/test-release-metadata.sh
git grep -n "Claude Terminal\|claude-terminal\|claude-code-ha" -- . ':!docs' ':!claude-workbench/CHANGELOG.md'
```
Erwartet: Suite grün; `git grep` zeigt nur bewusst behaltene Stellen (Erwähnungen der alten App/Credits, `ESJavadex/claude-code-ha`, Übernahme-Code/-Tests, `run.sh:661`, Schutztest selbst). Liste gegen die Spec prüfen. Lokale Suiten grün.

- [x] **Step 9: Commit**

```bash
git add tests/test-release-metadata.sh README.md claude-workbench/README.md claude-workbench/DOCS.md claude-workbench/PERSISTENT_PACKAGES.md claude-workbench/IMAGE_PASTE.md claude-workbench/.claude/skills/persistent-package-manager/SKILL.md CLAUDE.md DEVELOPMENT.md flake.nix LICENSE
git commit -m "docs: introduce Claude Workbench as an app of its own, with credits

README and store docs describe the app itself, explain switching from
Claude Terminal Pro and credit Javier Santos and Tom Cassady; LICENSE
names its copyright holders instead of the template placeholder.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Version 3.0.0, Changelog, Release-Notes

**Files:**
- Modify: `claude-workbench/config.yaml` (`version`), `README.md` (Badge), `claude-workbench/CHANGELOG.md` (oben)
- Create: `docs/release-notes-3.0.0.md`

- [x] **Step 1: RED** — nur `config.yaml` auf `version: "3.0.0"` setzen, dann `bash tests/test-release-metadata.sh`
  Expected: `FAIL (release metadata): CHANGELOG.md has no '## 3.0.0' section for the current version`

- [x] **Step 2: CHANGELOG** — oberhalb von `## 2.3.4` einfügen:

```markdown
## 3.0.0

### ✨ New Feature - Claude Terminal Pro is now Claude Workbench
- **Own name, slug and repository**: the app is called Claude Workbench
  (slug `claude_workbench`) and lives in `Eifel-Joe/claude-workbench`, so it
  is no longer mistaken for ESJavadex's Claude Terminal Pro. New logo: the
  Claude spark and a `>_` prompt in a terminal window.
- **Breaking**: Home Assistant treats it as a new app. Install Claude Workbench
  next to the old app; on the first panel open it takes over memories,
  `CLAUDE.md`, history, logins, packages and settings from any
  `*_claude_terminal_pro` app (ESJavadex's or this project's before 3.0.0).
  Then uninstall the old app and remove the old repository entry.

### 📚 Documentation
- README and store docs describe Claude Workbench as an app of its own, with
  credits to Javier Santos (Claude Terminal Pro) and Tom Cassady (Claude
  Terminal) and a trademark note.
- LICENSE names its copyright holders instead of a template placeholder.

### 🔧 Technical
- App folder renamed to `claude-workbench/`; `tools/make-logo.py` rebuilds
  icon and logo.
```

- [x] **Step 3: README-Badge** — `badge/version-2.3.4-` → `badge/version-3.0.0-`.

- [x] **Step 4: `docs/release-notes-3.0.0.md`** (Write-Tool):

```markdown
## Claude Terminal Pro is now Claude Workbench

This project has its own name now: **Claude Workbench**, in the repository `Eifel-Joe/claude-workbench`, with a new logo. Same app, same features — it is no longer mistaken for ESJavadex's Claude Terminal Pro, which it grew out of.

### ⚠️ Breaking: install it as a new app

Home Assistant treats Claude Workbench as a new app (new slug `claude_workbench`). Your existing Claude Terminal Pro app keeps running but gets no more updates.

1. Add the repository `https://github.com/Eifel-Joe/claude-workbench` (Settings → Apps → App Store → ⋮ → Repositories).
2. Install **Claude Workbench** and start it.
3. Open the panel and confirm the takeover: memories, `CLAUDE.md`, history, logins, packages and settings come over from the old app (a partial backup of it is kept).
4. Uninstall the old app.
5. Remove the old repository entry `https://github.com/Eifel-Joe/claude-code-ha` — GitHub redirects it, so Claude Workbench would otherwise show up twice.

Coming from ESJavadex's Claude Terminal Pro? Same steps.

### Credits
Claude Workbench builds on Claude Terminal Pro by Javier Santos (@ESJavadex) and the original Claude Terminal by Tom Cassady (@heytcass). Thank you!

Full details: [CHANGELOG](https://github.com/Eifel-Joe/claude-workbench/blob/main/claude-workbench/CHANGELOG.md).
```

- [x] **Step 5: GREEN** — `bash tests/test-release-metadata.sh` → `Release metadata suite passed (version 3.0.0)`; lokale Suiten grün; `git ls-files --eol | grep -c "crlf\|mixed"` → `0`.

- [x] **Step 6: Commit**

```bash
git add claude-workbench/config.yaml claude-workbench/CHANGELOG.md README.md docs/release-notes-3.0.0.md
git commit -m "release: 3.0.0 - Claude Terminal Pro is now Claude Workbench

Major version because Home Assistant sees a new slug as a new app; the
changelog and release notes walk through the switch.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Code-Review

- [x] **Step 1:** Subagent `superpowers:code-reviewer` mit Spec, Plan und `git diff main...feat/claude-workbench`. Prüfauftrag: jede Spec-Anforderung umgesetzt? Selbstbezeichnungen vollständig, Erwähnungen der alten App korrekt behalten? Übernahme-Erkennung unverändert? Pfade in CI/Tests vollständig? Escapes in den Bash-Ergänzungen (`config_field`-`sed`) korrekt? Temp-Regel (`.tmp/`) im Prompt mitgeben.
- [x] **Step 2:** Befunde über `superpowers:receiving-code-review` prüfen, berechtigte per TDD beheben, je ein Commit.

---

### Task 9: Branch pushen, CI (Freigabe nötig)

- [x] **Step 1:** User um Freigabe für `git push -u origin feat/claude-workbench` bitten, dann pushen.
- [x] **Step 2:** CI-Lauf beobachten: `gh run list --repo Eifel-Joe/claude-code-ha --branch feat/claude-workbench --limit 1`, dann `gh run watch <id> --repo Eifel-Joe/claude-code-ha`.
  Expected: alle Jobs grün, im Build-Log beider Architekturen Kontext `claude-workbench`, `Release metadata suite passed (version 3.0.0)`.

---

### Task 10: GitHub-Repo umbenennen (Freigabe nötig)

- [x] **Step 1:** User um Freigabe bitten, dann:

```bash
gh repo rename claude-workbench --repo Eifel-Joe/claude-code-ha --yes
git remote set-url origin https://github.com/Eifel-Joe/claude-workbench.git
git fetch origin && git remote -v
```
Expected: `origin https://github.com/Eifel-Joe/claude-workbench.git`, Fetch ohne Fehler.
- [x] **Step 2:** Weiterleitung prüfen: `curl -sI https://github.com/Eifel-Joe/claude-code-ha | head -3` → `301` auf `…/claude-workbench`.

---

### Task 11: Merge nach `main`, Push (Freigabe nötig)

- [ ] **Step 1:** `git switch main && git merge --no-ff feat/claude-workbench -m "Merge branch 'feat/claude-workbench': Claude Terminal Pro is now Claude Workbench (3.0.0)"`
- [ ] **Step 2:** Lokale Suiten auf `main` grün.
- [ ] **Step 3:** Freigabe → `git push origin main`; CI auf `main` grün (`gh run list --repo Eifel-Joe/claude-workbench --branch main --limit 1`).

---

### Task 12: HA-Test Ende-zu-Ende

- [ ] **Step 1:** Supervisor- und App-Log von `6ef0b4d0_claude_terminal_pro` als Ausgangslage per MCP sichern.
- Hinweis: Nach dem Merge zeigt der *alte* Repository-Eintrag (alte URL, über GitHubs Weiterleitung) ebenfalls schon „Claude Workbench“. Bis Step 5 steht sie deshalb zweimal im Store — erwartet. Installiert wird aus dem *neuen* Eintrag; den alten Eintrag lässt HA erst entfernen, wenn die alte App deinstalliert ist.
- [ ] **Step 2:** User fügt in HA-Test die Repository-URL `https://github.com/Eifel-Joe/claude-workbench` hinzu (oder per MCP, falls `ha_manage_app` das anbietet; sonst User). Per MCP prüfen: „Claude Workbench“ 3.0.0 mit neuem Logo im Store.
- [ ] **Step 3:** Aus dem *neuen* Eintrag installieren und starten (per MCP auf HA-Test): Slug muss `0e003122_claude_workbench` sein, nicht `6ef0b4d0_claude_workbench`. Bei „Request timed out“ Supervisor-Log prüfen, nicht erneut auslösen. App-Log: „Initializing Claude Workbench app...“, Übernahme-Angebot für `6ef0b4d0_claude_terminal_pro` erkannt.
- [ ] **Step 4:** User öffnet das Panel, bestätigt die Übernahme; Ergebnis im Terminal zeigen lassen. Danach: Claude startet ohne Login, Memories vorhanden, `persist-install --list` zeigt die Pakete.
- [ ] **Step 5:** User deinstalliert die alte App und entfernt den alten Repository-Eintrag; per MCP prüfen: alte App weg, Claude Workbench genau einmal im Store.

---

### Task 13: Release (Freigabe nötig)

- [ ] **Step 1:** Release-Text (`docs/release-notes-3.0.0.md`) dem User zeigen, Freigabe abwarten.
- [ ] **Step 2:** `git tag v3.0.0 && git push origin v3.0.0`, dann `gh release create v3.0.0 --repo Eifel-Joe/claude-workbench --title "3.0.0 — Claude Workbench" --notes-file docs/release-notes-3.0.0.md`.

---

### Task 14: HA-Prod (User) und Übergabe

- [ ] **Step 1:** User führt auf HA-Prod den Ablauf aus Task 12 aus; per MCP Supervisor- und App-Log prüfen (gestartet, Übernahme ok, alte App weg).
- [ ] **Step 2:** `docs/SESSION-STAND.md` ergänzen; Memory `claude-code-ha-followups` aktualisieren (neuer Name, Slug, Repo-URL); Plan-Checkboxen abhaken; Commit + Push (Freigabe).
