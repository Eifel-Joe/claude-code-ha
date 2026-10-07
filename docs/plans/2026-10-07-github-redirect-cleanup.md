# GitHub-Versionen ohne API, Test-Temp, Mac-Monitor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Release 2.3.4: HA-CLI- und gh-Version ohne `api.github.com` ermitteln, Migrationstests räumen ihre Temp-Ordner auf, Mac-Clipboard-Monitor entfernt, `DEVELOPMENT.md` ohne `sudo kill -9`.

**Architecture:** `https://github.com/<repo>/releases/latest` leitet auf `…/releases/tag/<tag>` weiter; `curl -fsSL -o /dev/null -w '%{url_effective}'` liefert die Ziel-URL, der Tag ist alles nach `/releases/tag/`. Gleiches Muster in `persist-install` (getestet mit Fake-`curl`) und an zwei Stellen im Dockerfile (nur in der CI prüfbar). Ein Schutztest in `tests/test-release-metadata.sh` verhindert, dass `api.github.com` zurückkommt.

**Tech Stack:** Bash, Dockerfile (bash mit `pipefail`), Node `node:test`.

**Spec:** `docs/specs/2026-10-07-github-redirect-cleanup-design.md`

**Arbeitsregeln (auch für Subagenten):**
- Branch `fix/github-redirect-cleanup` (existiert, Spec-Commit `0a2e65e`).
- Keine Temp-Dateien auf C:. Jede Shell vor Tests:
  `export TMPDIR=/d/Entwicklung/Claude-Code-HA/.tmp TMP='D:\Entwicklung\Claude-Code-HA\.tmp' TEMP='D:\Entwicklung\Claude-Code-HA\.tmp'`
- Mehrzeilige Ersetzungen mit dem Edit-Tool, nicht per Heredoc/sed im Bash-Tool (Backslashes werden verstümmelt). Ergebnis jeweils per `git diff` prüfen.
- Kommentare dürfen `api.github.com` nicht wörtlich enthalten (Schutztest aus Task 1), ebenso keine 32-Bit-Namen/-Versionen (bestehender Schutztest).
- Nach jeder Änderung: `git ls-files --eol | grep -c "crlf\|mixed"` → `0`.

---

### Task 1: Schutztests in `test-release-metadata.sh` (RED)

**Files:**
- Modify: `tests/test-release-metadata.sh` (vor der letzten Zeile `echo "Release metadata suite passed …"`)

- [x] **Step 1: Prüfungen einfügen** — direkt vor `echo "Release metadata suite passed (version $config_version)"`:

```bash
# Release versions come from github.com's releases/latest redirect. The REST
# API allows 60 unauthenticated requests per hour per IP; a CI image build
# failed on its 403 (run 37584251742).
for f in "$addon_dir/Dockerfile" "$addon_dir/scripts/persist-install"; do
    if grep -n 'api\.github\.com' "$f"; then
        fail "$(basename "$f") queries api.github.com; read the tag from the releases/latest redirect"
    fi
done

# The Mac clipboard monitor uploaded to <host>:8123/upload (HA Core, not the
# app) or the direct port that 2.1.0 closed; pasting into the terminal
# replaces it.
for f in mac-clipboard-monitor.py MAC_CLIPBOARD_MONITOR.md; do
    [ ! -e "$repo_root/$f" ] || fail "$f is back; it cannot reach the app since 2.1.0"
done
```

- [x] **Step 2: RED prüfen**

Run: `bash tests/test-release-metadata.sh`
Expected: Exit 1, Ausgabe enthält die Dockerfile-Zeilen mit `api.github.com` und `FAIL … Dockerfile queries api.github.com`.

(Kein Commit — Task 2–4 machen ihn grün; Commit am Ende von Task 4.)

---

### Task 2: `persist-install --ha-cli` liest den Tag aus der Weiterleitung

**Files:**
- Modify: `tests/test-persist-install.sh:99-215`
- Modify: `claude-terminal/scripts/persist-install:247-259`

- [x] **Step 1: Fake-`curl` umstellen** — in `tests/test-persist-install.sh` den Heredoc `cat > "$fake_bin/curl" <<CURL … CURL` (Zeilen 99–115) ersetzen durch:

```bash
cat > "$fake_bin/curl" <<CURL
#!/bin/sh
printf '%s\n' "\$*" >> "$curl_log"
# Release lookup: persist-install asks curl where releases/latest redirects to.
case "\$*" in
    *url_effective*)
        [ "\${FAKE_LATEST_STATUS:-0}" -eq 0 ] || exit "\$FAKE_LATEST_STATUS"
        printf '%s' "\${FAKE_LATEST_URL:-}"
        exit 0
        ;;
esac
out=""
prev=""
for arg in "\$@"; do
    [ "\$prev" = "-o" ] && out="\$arg"
    prev="\$arg"
done
if [ -n "\$out" ]; then
    [ "\${FAKE_DL_STATUS:-0}" -eq 0 ] || exit "\$FAKE_DL_STATUS"
    cp "$fake_ha" "\$out"
    exit 0
fi
exit 0
CURL
```

Und direkt nach `chmod +x "$fake_bin/curl"` die Ziel-URL als Variable:

```bash
latest_tag_url="https://github.com/home-assistant/cli/releases/tag/9.9.1"
```

- [x] **Step 2: Testfälle umstellen** — im Block `if [ -n "$want_arch" ]; then … fi` (Zeilen 148–215):

  a) Erfolgsfall (Zeilen 149–152) ersetzen:

```bash
    # Latest release read from where releases/latest redirects to
    if ! FAKE_LATEST_URL="$latest_tag_url" run_ha_cli "$tmp_dir/ha-ok"; then
        fail "--ha-cli failed although releases/latest redirected to a tag: $(cat "$tmp_dir/out.log")"
    fi
    if grep -q 'api\.github\.com' "$curl_log"; then
        fail "--ha-cli queried the rate-limited REST API: $(cat "$curl_log")"
    fi
    grep -q 'github.com/home-assistant/cli/releases/latest' "$curl_log" || \
        fail "--ha-cli did not look up releases/latest: $(cat "$curl_log")"
```

  (Die folgenden Zeilen 153–158 — Download-URL, Binary, `.ha-version` = `9.9.1` — bleiben unverändert.)

  b) Fall „API unreachable“ (Zeilen 160–167) ersetzen:

```bash
    # Lookup fails (no network) -> non-zero, nothing downloaded
    if FAKE_LATEST_STATUS=22 run_ha_cli "$tmp_dir/ha-down"; then
        fail "--ha-cli exited 0 although the version lookup failed: $(cat "$tmp_dir/out.log")"
    fi
    if grep -q 'releases/download' "$curl_log"; then
        fail "--ha-cli downloaded although the version lookup failed: $(cat "$curl_log")"
    fi
    [ ! -e "$tmp_dir/ha-down/packages/bin/ha" ] || fail "--ha-cli left a binary after a failed lookup"
```

  c) Fall „API answers without a tag“ (Zeilen 169–175) ersetzen durch zwei Fälle:

```bash
    # Redirect ends somewhere that is not a release tag -> non-zero, no download
    for bad_url in "" "https://github.com/home-assistant/cli/releases" \
                   "https://github.com/home-assistant/cli/releases/tag/"; do
        if FAKE_LATEST_URL="$bad_url" run_ha_cli "$tmp_dir/ha-notag"; then
            fail "--ha-cli exited 0 although releases/latest resolved to '$bad_url'"
        fi
        if grep -q 'releases/download' "$curl_log"; then
            fail "--ha-cli downloaded although releases/latest resolved to '$bad_url': $(cat "$curl_log")"
        fi
    done
```

  d) In den Fällen `ha-replace` (Zeile 180) und `ha-dlfail` (Zeile 210) jeweils `FAKE_API_BODY='{"tag_name":"9.9.1"}'` durch `FAKE_LATEST_URL="$latest_tag_url"` ersetzen.

  e) Kontrolle: `grep -n 'FAKE_API' tests/test-persist-install.sh` → keine Treffer.

- [x] **Step 3: RED prüfen**

Run: `bash tests/test-persist-install.sh`
Expected: Exit 1 mit `FAIL (persist-install): --ha-cli failed although releases/latest redirected to a tag: … Could not determine the latest Home Assistant CLI version …` (der alte Code fragt die API, das Fake-`curl` antwortet dort leer).

- [x] **Step 4: Implementierung** — in `claude-terminal/scripts/persist-install` den Block von `# Latest release, as the Dockerfile does.` bis einschließlich zum schließenden `fi` der `[ -z "$HA_VERSION" ]`-Prüfung (Zeilen 247–259) ersetzen durch:

```bash
    # Latest release, as the Dockerfile does. A pinned version here (kept for
    # 32-bit builds) downgraded the CLI on every arch, because this
    # copy sits in PATH ahead of the image's.
    # The tag is read from where github.com redirects releases/latest
    # (.../releases/tag/<tag>). GitHub's REST API allows only 60
    # unauthenticated requests per hour per IP and failed a CI build with 403;
    # the redirect has no such limit.
    local latest_url="https://github.com/home-assistant/cli/releases/latest"
    local resolved_url
    local HA_VERSION=""
    resolved_url=$(curl -fsSL --max-time 30 -o /dev/null -w '%{url_effective}' \
        "$latest_url" 2>/dev/null) || resolved_url=""
    case "$resolved_url" in
        */releases/tag/?*) HA_VERSION="${resolved_url##*/releases/tag/}" ;;
    esac
    case "$HA_VERSION" in
        */*) HA_VERSION="" ;;
    esac
    if [ -z "$HA_VERSION" ]; then
        echo "❌ Could not determine the latest Home Assistant CLI version"
        echo "   ($latest_url — no network, or GitHub did not redirect to a release)"
        return 1
    fi
```

- [x] **Step 5: GREEN prüfen**

Run: `bash tests/test-persist-install.sh`
Expected: `persist-install tests passed`, Exit 0.

Run: `grep -n 'api\.github\.com' claude-terminal/scripts/persist-install`
Expected: keine Ausgabe.

- [x] **Step 6: ShellCheck**

Run: `shellcheck -S warning -e SC1008,SC1007,SC2155 -x claude-terminal/scripts/persist-install tests/test-persist-install.sh`
Expected: keine Ausgabe, Exit 0.

- [x] **Step 7: Commit**

```bash
git add claude-terminal/scripts/persist-install tests/test-persist-install.sh
git commit -m "fix(persist-install): read the HA CLI tag from the releases/latest redirect

The unauthenticated REST API allows 60 requests per hour per IP and
answered 403 in CI; the redirect to .../releases/tag/<tag> has no such
limit. A redirect that does not end in a tag stops before any download.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Dockerfile — `ha` und `gh` über die Weiterleitung

**Files:**
- Modify: `claude-terminal/Dockerfile:87-117`

Nicht lokal baubar (kein docker/podman/hadolint). Prüfkriterium vorab: (1) Schutztest aus Task 1 grün für das Dockerfile; (2) in der CI zeigt das Build-Log für amd64 und aarch64 `Installing Home Assistant CLI 5.` und `Installing GitHub CLI v2.`; Hadolint-Job grün.

- [x] **Step 1: HA-CLI-Block ersetzen** — von `# Install Home Assistant CLI (ha command), latest release.` bis `echo "Home Assistant CLI ${HA_VERSION} installed successfully"`:

```dockerfile
# Install Home Assistant CLI (ha command), latest release. Its asset names use
# the same arch names as the add-on (ha_amd64, ha_aarch64). The tag comes from
# where github.com redirects releases/latest (.../releases/tag/<tag>); GitHub's
# REST API allows 60 unauthenticated requests per hour per IP and failed CI
# builds with 403.
RUN HA_ARCH=$(cat /etc/addon-arch) && \
    echo "Fetching latest Home Assistant CLI version..." && \
    HA_URL=$(curl -fsSL -o /dev/null -w '%{url_effective}' https://github.com/home-assistant/cli/releases/latest) && \
    case "${HA_URL}" in */releases/tag/?*) ;; *) echo "No release tag in '${HA_URL}'" && exit 1 ;; esac && \
    HA_VERSION="${HA_URL##*/releases/tag/}" && \
    echo "Installing Home Assistant CLI ${HA_VERSION} for ${HA_ARCH}..." && \
    curl -fsSL -o /usr/bin/ha \
        "https://github.com/home-assistant/cli/releases/download/${HA_VERSION}/ha_${HA_ARCH}" && \
    chmod +x /usr/bin/ha && \
    echo "Home Assistant CLI ${HA_VERSION} installed successfully"
```

- [x] **Step 2: gh-Block ersetzen** — von `# Install GitHub CLI (gh command), latest release.` bis `echo "GitHub CLI v${GH_VERSION} installed successfully"`:

```dockerfile
# Install GitHub CLI (gh command), latest release; tag from the releases/latest
# redirect like the HA CLI above.
RUN case "$(cat /etc/addon-arch)" in \
        amd64)   GH_ARCH="amd64" ;; \
        aarch64) GH_ARCH="arm64" ;; \
        *)       echo "Unsupported architecture for gh: $(cat /etc/addon-arch)" && exit 1 ;; \
    esac && \
    echo "Fetching latest GitHub CLI version..." && \
    GH_URL=$(curl -fsSL -o /dev/null -w '%{url_effective}' https://github.com/cli/cli/releases/latest) && \
    case "${GH_URL}" in */releases/tag/v?*) ;; *) echo "No release tag in '${GH_URL}'" && exit 1 ;; esac && \
    GH_VERSION="${GH_URL##*/releases/tag/v}" && \
    echo "Installing GitHub CLI v${GH_VERSION} for ${GH_ARCH}..." && \
    curl -fsSL -o /tmp/gh.tar.gz \
        "https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_linux_${GH_ARCH}.tar.gz" && \
    tar -xzf /tmp/gh.tar.gz -C /tmp && \
    mv "/tmp/gh_${GH_VERSION}_linux_${GH_ARCH}/bin/gh" /usr/bin/gh && \
    chmod +x /usr/bin/gh && \
    rm -rf /tmp/gh* && \
    echo "GitHub CLI v${GH_VERSION} installed successfully"
```

- [x] **Step 3: Lokal prüfen, was geht**

Run: `grep -n 'api\.github\.com\|jq -r' claude-terminal/Dockerfile`
Expected: keine Treffer.

Run (Logik der Tag-Extraktion mit echten Weiterleitungen):
```bash
for r in home-assistant/cli cli/cli; do u=$(curl -fsSL -o /dev/null -w '%{url_effective}' "https://github.com/$r/releases/latest"); echo "$r -> ${u##*/releases/tag/}"; done
```
Expected: `home-assistant/cli -> 5.5.0` (oder neuer), `cli/cli -> v2.102.0` (oder neuer).

- [x] **Step 4: Commit**

```bash
git add claude-terminal/Dockerfile
git commit -m "fix(docker): read ha and gh release tags from the releases/latest redirect

Same reason as persist-install: the REST API's unauthenticated limit
broke an aarch64 CI build with 403. A redirect without a tag stops the
build with a message instead of fetching a broken URL.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Mac-Clipboard-Monitor entfernen, DEVELOPMENT.md

**Files:**
- Delete: `mac-clipboard-monitor.py`, `MAC_CLIPBOARD_MONITOR.md`
- Modify: `DEVELOPMENT.md:189-196`

- [x] **Step 1: Löschen**

```bash
git rm -q mac-clipboard-monitor.py MAC_CLIPBOARD_MONITOR.md
```

- [x] **Step 2: Verweise prüfen**

Run: `git grep -n -i 'mac-clipboard\|MAC_CLIPBOARD' -- . ':!docs/'`
Expected: keine Treffer.

- [x] **Step 3: DEVELOPMENT.md** — Abschnitt „Port Already In Use“ ersetzen:

````markdown
#### Port Already In Use
```bash
# Map the container's 7680 to a free host port instead
podman run -d --name test-claude-dev -p 7682:7680 -v /tmp/test-config:/config -v /tmp/test-data:/data local/claude-terminal:test
```
````

Run: `grep -n 'sudo\|kill -9' DEVELOPMENT.md`
Expected: keine Treffer.

- [x] **Step 4: Schutztests grün**

Run: `bash tests/test-release-metadata.sh`
Expected: `Release metadata suite passed (version 2.3.3)`.

- [x] **Step 5: Commit**

```bash
git add tests/test-release-metadata.sh DEVELOPMENT.md
git commit -m "chore: drop the Mac clipboard monitor, guard the API-free lookups

The monitor uploaded to <host>:8123/upload (HA Core) or the direct port
closed in 2.1.0, so it has not reached the app since; pasting or
dropping an image into the terminal replaces it. The metadata suite now
fails if api.github.com or the monitor come back. DEVELOPMENT.md no
longer suggests sudo kill -9 for a busy port.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Migrationstests räumen ihre Temp-Ordner auf

**Files:**
- Modify: `tests/test-app-migration.js:1-12`

Prüfkriterium (Test kann seine eigene Aufräumarbeit nicht sinnvoll prüfen): Anzahl `mig-*` unter `.tmp/` ist vor und nach einem Lauf gleich.

- [x] **Step 1: Ausgangslage messen (RED)**

```bash
export TMPDIR=/d/Entwicklung/Claude-Code-HA/.tmp TMP='D:\Entwicklung\Claude-Code-HA\.tmp' TEMP='D:\Entwicklung\Claude-Code-HA\.tmp'
mkdir -p .tmp && before=$(ls -d .tmp/mig-* 2>/dev/null | wc -l)
PATH="/c/WINDOWS/system32:$PATH" node --test tests/test-app-migration.js 2>&1 | tail -3
after=$(ls -d .tmp/mig-* 2>/dev/null | wc -l); echo "before=$before after=$after"
```
Expected: alle Tests `pass`, `after` > `before` (Reste bleiben liegen).

- [x] **Step 2: Implementierung** — Zeile 12 `function tmp() { … }` ersetzen durch:

```js
// Every fixture directory is removed once the file's tests have run; they
// used to pile up in the system temp directory.
const tmpDirs = [];
function tmp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-'));
  tmpDirs.push(dir);
  return dir;
}
test.after(() => {
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
});
```

- [x] **Step 3: GREEN messen**

```bash
rm -rf .tmp/mig-*
PATH="/c/WINDOWS/system32:$PATH" node --test tests/test-app-migration.js 2>&1 | tail -8
ls -d .tmp/mig-* 2>/dev/null | wc -l
```
Expected: `# fail 0`, Anzahl `mig-*` = `0`.

- [x] **Step 4: Commit**

```bash
git add tests/test-app-migration.js
git commit -m "test(migration): remove the mig-* fixture directories after the run

They were never deleted and piled up in the system temp directory.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Release 2.3.4 vorbereiten

**Files:**
- Modify: `claude-terminal/config.yaml` (`version: "2.3.4"`), `README.md:3` (Badge `version-2.3.4-`), `claude-terminal/CHANGELOG.md` (oben)
- Create: `docs/release-notes-2.3.4.md`

- [x] **Step 1: RED** — nur CHANGELOG-Abschnitt oben einfügen (nach `# Changelog`):

```markdown
## 2.3.4

### 🐛 Bug Fix - HA CLI and GitHub CLI lookups no longer hit GitHub's API limit
- The image build and `persist-install --ha-cli` asked GitHub's REST API for
  the latest release. Without a token it allows 60 requests per hour per IP,
  and a build failed with 403. They now read the version from where
  `github.com/<repo>/releases/latest` redirects to, which has no such limit.
  If that redirect does not end in a release, nothing is downloaded and an
  existing copy stays in place.

### 🛠️ Improvement - Mac clipboard monitor removed
- `mac-clipboard-monitor.py` uploaded to `<host>:8123/upload`, which is Home
  Assistant itself, or to the direct port closed in 2.1.0, so it could not
  reach the app. Paste (Ctrl+V / Cmd+V) or drop an image into the terminal
  instead; it lands in `/data/images` the same way.

### 🔧 Technical
- The migration tests remove their temporary directories.
- `DEVELOPMENT.md` suggests another host port instead of `sudo kill -9` when
  7680 is busy.
```

Run: `bash tests/test-release-metadata.sh`
Expected: `FAIL … newest CHANGELOG entry is '2.3.4' but config.yaml is at '2.3.3'`.

- [x] **Step 2: GREEN** — `config.yaml` `version: "2.3.4"`, README-Badge `version-2.3.4-`.

Run: `bash tests/test-release-metadata.sh`
Expected: `Release metadata suite passed (version 2.3.4)`.

- [x] **Step 3: Release-Notes** `docs/release-notes-2.3.4.md`:

```markdown
## HA CLI and GitHub CLI lookups no longer hit GitHub's API limit

The image build and `persist-install --ha-cli` asked GitHub's REST API for the latest release. Without a token it allows 60 requests per hour per IP, and builds could fail with 403. The version now comes from where `github.com/<repo>/releases/latest` redirects to, which has no such limit. If that lookup fails, nothing is downloaded and an existing copy stays.

## Mac clipboard monitor removed

`mac-clipboard-monitor.py` could not reach the app since 2.1.0 (it uploaded to Home Assistant itself or to the closed direct port). Paste or drop an image into the terminal instead.

## Cleanup
- Migration tests remove their temporary directories.
- `DEVELOPMENT.md` no longer suggests `sudo kill -9` for a busy port.

Full details: [CHANGELOG](https://github.com/Eifel-Joe/claude-code-ha/blob/main/claude-terminal/CHANGELOG.md).
```

- [x] **Step 4: Volle lokale Suite + ShellCheck + EOL**

```bash
export TMPDIR=/d/Entwicklung/Claude-Code-HA/.tmp TMP='D:\Entwicklung\Claude-Code-HA\.tmp' TEMP='D:\Entwicklung\Claude-Code-HA\.tmp'
bash tests/test-release-metadata.sh
bash tests/test-persist-install.sh
bash tests/test-startup-timeouts.sh
node tests/test-terminal-clipboard.js 2>&1 | tail -2
PATH="/c/WINDOWS/system32:$PATH" node --test tests/test-app-migration.js 2>&1 | grep -E '^# (pass|fail)'
shellcheck -S warning -e SC1008,SC1007,SC2155 -x claude-terminal/run.sh claude-terminal/scripts/*.sh claude-terminal/scripts/persist-install tests/*.sh
git ls-files --eol | grep -c "crlf\|mixed"
```
Expected: alle Suiten „passed“/`# fail 0`, ShellCheck ohne Ausgabe, EOL `0`.

- [x] **Step 5: Commit**

```bash
git add claude-terminal/config.yaml README.md claude-terminal/CHANGELOG.md docs/release-notes-2.3.4.md
git commit -m "release: 2.3.4

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Review, CI, HA-Test, Release (mit Freigaben)

- [x] **Step 1: Code-Review** per Subagent gegen Spec/Plan (`git diff 0a2e65e..HEAD`); Subagent arbeitet nur unter `.tmp/`. Befunde über `receiving-code-review` prüfen.
- [x] **Step 2: Push des Branches — nur nach Freigabe.** CI abwarten (`gh run list --repo Eifel-Joe/claude-code-ha --branch fix/github-redirect-cleanup`): alle Jobs grün; im Build-Log beider Architekturen `Installing Home Assistant CLI 5.` und `Installing GitHub CLI v2.`.
- [x] **Step 3: Merge nach `main` (`--no-ff`) und Push — nur nach Freigabe.** CI auf `main` grün.
- [x] **Step 4: HA-Test auf 2.3.4** — nur nach Freigabe; `check_updates`, `update` (bei Timeout Supervisor-Log, nicht erneut auslösen); `state: started`, App-Log fehlerfrei. User im App-Terminal: `persist-install --ha-cli --force` → „Installing Home Assistant CLI v5.…“, „ha runs ✓“; danach `rm /data/packages/bin/ha /data/packages/bin/.ha-version`.
- [x] **Step 5: Tag `v2.3.4` + Release** — Titel und Text vorher im Chat, nur nach Freigabe.
- [x] **Step 6: HA-Prod auf 2.3.4** — nur nach Freigabe (User startet das Update selbst); danach Logs per MCP prüfen.
- [x] **Step 7: Abschluss** — Memory (Punkte 9, 13, 14 erledigt), `docs/SESSION-STAND.md`, Plan abhaken, `.tmp/` leeren.
