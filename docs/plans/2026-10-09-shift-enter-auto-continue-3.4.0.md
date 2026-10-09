# Shift+Enter und Auto-Continue (3.4.0) – Umsetzungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Shift+Enter fügt im Panel einen Zeilenumbruch ein; Auto-Continue tippt nach einem Usage-Limit „continue“ in die Claude-Pane, schaltbar per Option, Befehl `auto-continue` und Knopf im Panel.

**Architecture:** Neues Node-Modul `image-service/auto-continue.js` (Parser von mattbsea, eigener Bildschirm-Watcher, tmux per `execFile`, `/proc`-Prüfung auf Claude im Vordergrund), eingebunden in `server.js` mit `GET`/`POST /auto-continue`. Zustand in `/run/claude-workbench/auto-continue` (`on`/`off`), Anfangswert aus `run.sh` (`init_auto_continue`), umschaltbar per `scripts/auto-continue.sh`. Frontend-Helfer in neuem UMD-Modul `public/workbench-ui.js` (Shift+Enter, Knopf-Beschriftung), verdrahtet in `index.html`.

**Tech Stack:** Node 22 (Express, `node:test`), Bash (bashio), tmux, xterm.js 5.4 (in ttyd 1.7.7), Home Assistant App-Metadaten.

**Spec:** `docs/specs/2026-10-09-shift-enter-auto-continue-3.4.0-design.md` · **Branch:** `feat/auto-continue-3.4.0`

## Arbeitsregeln (gelten für jeden Task)

- Keine temporären Dateien auf C:. Jede Testausführung mit
  `export TMPDIR=/d/Entwicklung/Claude-Code-HA/.tmp TMP='D:\Entwicklung\Claude-Code-HA\.tmp' TEMP='D:\Entwicklung\Claude-Code-HA\.tmp'`;
  npm zusätzlich mit `npm_config_cache='D:/Entwicklung/Claude-Code-HA/.tmp/npm-cache'`.
- Dateien mit dem Write-/Edit-Tool schreiben, nicht per Heredoc im Bash-Tool (Backslashes).
  Nach jedem Schritt `git diff` lesen, besonders Regex-Zeilen (`\x1b`, `\d`, `\\\r`).
- Neue Test-Skripte ausführbar machen: `git update-index --chmod=+x tests/<datei>.sh` nach `git add`.
- Gegenproben nie mit `git checkout -- .` zurücknehmen, sondern mit dem Edit-Tool.
- Nach jedem Task: `git ls-files --eol | grep -c "crlf\|mixed"` → `0`.
- Im App-Code (run.sh, scripts/, image-service, Dockerfile) kein „claude-terminal“/„Claude Terminal“:
  Credits dort als „mattbsea's fork, commit …“.
- Lokal gibt es kein tmux und kein jq; alles, was tmux braucht, läuft gegen Fakes.
- Commit-Messages nennen WAS und WARUM und enden mit `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Dateien

| Datei | Rolle |
|---|---|
| `claude-workbench/image-service/auto-continue.js` (neu) | Parser, `PaneWatcher`, `claudeInForeground`, `createAutoContinue` |
| `claude-workbench/image-service/server.js` | Endpunkte `/auto-continue`, Start der Abfrage |
| `claude-workbench/image-service/public/workbench-ui.js` (neu) | `isShiftEnter`, `installShiftEnter`, `autoContinueLabel` |
| `claude-workbench/image-service/public/index.html` | Knopf, CSS, Verdrahtung |
| `claude-workbench/run.sh` | `AUTO_CONTINUE_DIR`, `init_auto_continue`, Aufruf in `main` |
| `claude-workbench/scripts/auto-continue.sh` (neu) | Befehl `auto-continue on|off|status` |
| `claude-workbench/Dockerfile` | Link `/usr/local/bin/auto-continue` |
| `claude-workbench/config.yaml`, `translations/en.yaml`, `translations/de.yaml` | Option `auto_continue` |
| `tests/test-auto-continue.js` (neu) | Modul-Tests (`node --test`) |
| `tests/test-workbench-ui.js` (neu) | Frontend-Helfer (`node --test`) |
| `tests/test-auto-continue-cmd.sh` (neu) | Befehl und `init_auto_continue` |
| `tests/test-image-service.js` | Endpunkt-Tests |
| `tests/test-release-metadata.sh` | Link-Prüfung im Dockerfile |
| `tests/test-startup-order.sh` | `init_auto_continue` vor `start_image_service` |
| `tests/run-tests.sh` | neue Suiten |
| Doku: `DOCS.md`, `README.md` (App), `CHANGELOG.md`, `README.md` (Repo-Badge), `docs/release-notes-3.4.0.md`, `docs/FORK-SURVEY-heytcass.md` | |

---

### Task 1: Parser übernehmen (`auto-continue.js`, Teil 1)

**Files:**
- Create: `claude-workbench/image-service/auto-continue.js`
- Create: `tests/test-auto-continue.js`
- Modify: `tests/run-tests.sh`

- [x] **Step 1: Failing test schreiben** – `tests/test-auto-continue.js`:

```js
#!/usr/bin/env node
'use strict';

/**
 * Auto-continue after a Claude usage limit (image-service/auto-continue.js).
 * The parser tests are mattbsea's (mattbsea's fork, test/auto-continue.test.js
 * at commit 00e22fc0); the watcher and controller tests are ours, against a
 * fake tmux, a fake /proc and a fake clock.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ac = require(path.join(__dirname, '..', 'claude-workbench', 'image-service', 'auto-continue.js'));

function formatInZone(epochMs, tz) {
    return new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: 'numeric', minute: '2-digit', hour12: true,
    }).format(new Date(epochMs));
}

test('detectLimit finds the banners Claude prints', () => {
    for (const line of [
        '5-hour limit reached ∙ resets 3pm (Europe/Berlin)',
        'Claude usage limit reached. Your limit will reset at 2pm',
        "You're out of extra usage · resets 3pm",
        'Please try again in 5 hours',
        "You've hit your limit · resets 3pm (Europe/Dublin)",
        'You’ve hit your session limit · resets 6pm',
        'Rate limit hit. Resets at 4pm',
    ]) {
        assert.notEqual(ac.detectLimit(line), null, line);
    }
    assert.equal(ac.detectLimit('All tests passed, nothing about limits here'), null);
});

test('stripAnsi removes colour codes but keeps line breaks', () => {
    assert.equal(ac.stripAnsi('\x1b[31mred\x1b[0m\nnext'), 'red\nnext');
});

test('parseResetTime reads a relative wait', () => {
    const now = Date.UTC(2026, 9, 9, 12, 0, 0);
    assert.equal(ac.parseResetTime('Please try again in 5 hours', now), now + 5 * 3600000);
    assert.equal(ac.parseResetTime('try again in 30 minutes', now), now + 30 * 60000);
});

test('parseResetTime resolves a same-day future time in the named zone', () => {
    const now = Date.UTC(2026, 2, 7, 21, 0, 0);
    const epoch = ac.parseResetTime("You've hit your session limit · resets 6pm (America/Los_Angeles)", now);
    assert.equal(formatInZone(epoch, 'America/Los_Angeles'), '03/07/2026, 6:00 PM');
});

test('parseResetTime rolls a passed time to tomorrow across the spring DST change', () => {
    const now = Date.UTC(2026, 2, 8, 5, 0, 0);
    const epoch = ac.parseResetTime("You've hit your session limit · resets 6pm (America/Los_Angeles)", now);
    assert.equal(formatInZone(epoch, 'America/Los_Angeles'), '03/08/2026, 6:00 PM');
    assert.equal(epoch, Date.UTC(2026, 2, 9, 1, 0, 0));
});

test('parseResetTime rolls a passed time to tomorrow across the autumn DST change', () => {
    const now = Date.UTC(2026, 9, 31, 22, 0, 0);
    const epoch = ac.parseResetTime("You've hit your session limit · resets 1pm (America/Los_Angeles)", now);
    assert.equal(formatInZone(epoch, 'America/Los_Angeles'), '11/01/2026, 1:00 PM');
    assert.equal(epoch, Date.UTC(2026, 10, 1, 21, 0, 0));
});

test('parseResetTime reads a 24-hour time in Europe/Berlin', () => {
    const now = Date.UTC(2026, 9, 9, 10, 0, 0); // 12:00 in Berlin (CEST, UTC+2)
    const epoch = ac.parseResetTime('5-hour limit reached ∙ resets 15:00 (Europe/Berlin)', now);
    assert.equal(epoch, Date.UTC(2026, 9, 9, 13, 0, 0));
});

test('parseResetTime falls back to the server zone for an unknown zone name', () => {
    const now = Date.UTC(2026, 2, 7, 10, 0, 0);
    assert.equal(typeof ac.parseResetTime('resets 6pm (Not/AZone)', now), 'number');
});

test('parseResetTime returns null without a time', () => {
    assert.equal(ac.parseResetTime('Claude usage limit reached.', Date.now()), null);
});
```

In `tests/run-tests.sh` nach der Zeile `node --test "$tests_dir/test-app-migration.js"` einfügen:

```bash
node --test "$tests_dir/test-auto-continue.js"
```

- [x] **Step 2: Test laufen lassen, RED erwarten**

Run: `node --test --test-reporter=tap tests/test-auto-continue.js`
Expected: FAIL, `Cannot find module …/auto-continue.js`

- [x] **Step 3: Implementierung** – `claude-workbench/image-service/auto-continue.js` (Teil 1; die
  Funktionen ab `stripAnsi` bis `parseResetTime` sind mattbseas Code aus `00e22fc0`, unverändert bis auf
  `const`-Stil; `module.exports` wird in Task 2–4 erweitert):

```js
'use strict';

/**
 * Auto-continue after a Claude usage limit.
 *
 * Polls the panes of the tmux session "claude", spots Claude's limit banner
 * ("5-hour limit reached ∙ resets 3pm (Europe/Berlin)") and, once the limit
 * has reset, types "continue" + Enter into that pane - only while the switch
 * is on, Claude is the pane's foreground program and the banner is still on
 * screen.
 *
 * The message parser (stripAnsi, detectLimit, parseResetTime and helpers) is
 * mattbsea's fork, web-terminal/auto-continue.js at commit 00e22fc0 (MIT;
 * developed in 16847c88, 533ae0ef, 5924cd08). His watcher reads a PTY stream;
 * this one re-reads the screen every poll, so a banner is tracked by its text
 * rather than by time windows (docs/specs/2026-10-09-shift-enter-auto-continue-3.4.0-design.md;
 * tests/test-auto-continue.js).
 */

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const RESUME_GRACE_MS = 60 * 1000;              // send 1 minute after the reset time
const FALLBACK_DELAY_MS = 30 * 60 * 1000;       // when the message names no time
const MAX_WAIT_MS = 24 * 60 * 60 * 1000;        // never plan further ahead than this
const POLL_INTERVAL_MS = 30 * 1000;
const ENTER_DELAY_MS = 500;                     // let the TUI take the text before Enter
const TMUX_TIMEOUT_MS = 5000;
const SESSION = 'claude';

// Apostrophes may be ASCII or typographic depending on the terminal/font path.
const LIMIT_PATTERNS = [
    /\d+[- ]hour limit reached/i,
    /(?:usage|session|rate) limit reached/i,
    /out of extra usage/i,
    /you.{0,3}ve hit your (?:[a-z]+ )?limit/i,
    /rate limit (?:hit|reached)/i,
    /please try again in \d+/i,
];

function stripAnsi(text) {
    return text
        .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?/g, '')          // OSC sequences
        .replace(/\x1b\[[0-9;:?]*[\x20-\x2f]*[\x40-\x7e]/g, '')      // CSI sequences
        .replace(/\x1b[\x40-\x5f]/g, '')                             // other ESC sequences
        .replace(/[\x00-\x09\x0b-\x1f\x7f]/g, ' ');
}

function detectLimit(text) {
    for (const re of LIMIT_PATTERNS) {
        const m = text.match(re);
        if (m) return m[0];
    }
    return null;
}

const ABSOLUTE_RESET_RE = /resets?(?:\s+at)?\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?(?:\s*\(([^)]+)\))?/gi;

function lastAbsoluteResetMatch(text) {
    const matches = [...text.matchAll(ABSOLUTE_RESET_RE)];
    if (matches.length === 0) return null;
    const m = matches[matches.length - 1];
    return {
        raw: m[0],
        hour: parseInt(m[1], 10),
        minute: m[2] ? parseInt(m[2], 10) : 0,
        ampm: m[3] ? m[3].toLowerCase() : null,
        tz: m[4] ? m[4].trim() : null,
    };
}

// Calendar date + time, as rendered in `tz` at instant `atMs`. Null if `tz`
// isn't a name Intl recognizes (caller falls back to the server's own zone).
function zonedParts(tz, atMs) {
    try {
        const fmt = new Intl.DateTimeFormat('en-US', {
            timeZone: tz || undefined,
            hour12: false,
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit',
        });
        const parts = {};
        for (const p of fmt.formatToParts(new Date(atMs))) parts[p.type] = p.value;
        return {
            year: Number(parts.year),
            month: Number(parts.month),
            day: Number(parts.day),
            hour: parts.hour === '24' ? 0 : Number(parts.hour),
            minute: Number(parts.minute),
        };
    } catch (e) {
        return null;
    }
}

// UTC offset (minutes) of `tz` at instant `atMs`, per instant so it is right
// on either side of a DST change.
function tzOffsetMinutes(tz, atMs) {
    const p = zonedParts(tz, atMs);
    if (p === null) return 0;
    const asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, 0);
    return Math.round((asUTC - atMs) / 60000);
}

// Epoch ms of the next `hour:minute` wall-clock time in `tz` at or after
// `nowMs` (today, else tomorrow), resolving the target instant's own offset.
function nextOccurrenceEpoch(tz, hour, minute, nowMs) {
    const today = zonedParts(tz, nowMs);
    if (today === null) return null;

    const epochForDay = (day) => {
        let guess = Date.UTC(today.year, today.month - 1, day, hour, minute, 0);
        for (let i = 0; i < 2; i++) {
            guess = Date.UTC(today.year, today.month - 1, day, hour, minute, 0)
                - tzOffsetMinutes(tz, guess) * 60000;
        }
        return guess;
    };

    const todayEpoch = epochForDay(today.day);
    return todayEpoch > nowMs ? todayEpoch : epochForDay(today.day + 1);
}

// Epoch ms when the limit lifts, or null if the text names no time.
function parseResetTime(text, nowMs) {
    const relMatches = [...text.matchAll(/try again in (\d+)\s*(hour|minute|second)s?/gi)];
    if (relMatches.length > 0) {
        const m = relMatches[relMatches.length - 1];
        const n = parseInt(m[1], 10);
        const unitMs = { hour: 3600000, minute: 60000, second: 1000 }[m[2].toLowerCase()];
        return nowMs + n * unitMs;
    }

    const m = lastAbsoluteResetMatch(text);
    if (m === null) return null;

    let hour = m.hour;
    if (m.ampm === 'pm' && hour !== 12) hour += 12;
    if (m.ampm === 'am' && hour === 12) hour = 0;
    if (hour > 23 || m.minute > 59) return null;

    const epoch = nextOccurrenceEpoch(m.tz, hour, m.minute, nowMs);
    if (epoch !== null) return epoch;
    return m.tz ? nextOccurrenceEpoch(null, hour, m.minute, nowMs) : null;
}

module.exports = { stripAnsi, detectLimit, parseResetTime };
```

  Hinweis: `fs`, `path`, `execFile` und die Konstanten ab `RESUME_GRACE_MS` werden erst in Task 2–4
  benutzt; ShellCheck/ESLint laufen auf JS nicht, das ist bis dahin in Ordnung.

- [x] **Step 4: GREEN**

Run: `node --test --test-reporter=tap tests/test-auto-continue.js`
Expected: `# pass 9`, `# fail 0`

- [x] **Step 5: Commit**

```bash
git add claude-workbench/image-service/auto-continue.js tests/test-auto-continue.js tests/run-tests.sh
git commit -m "feat: parse Claude usage-limit banners (mattbsea's parser)"
```

---

### Task 2: `PaneWatcher` – Bildschirm statt Datenstrom

**Files:**
- Modify: `claude-workbench/image-service/auto-continue.js`
- Test: `tests/test-auto-continue.js`

- [x] **Step 1: Failing tests anhängen** (ans Ende von `tests/test-auto-continue.js`):

```js
const T0 = Date.UTC(2026, 9, 9, 12, 0, 0);
const RELATIVE = 'some output\nPlease try again in 5 hours\n> ';

test('PaneWatcher plans one minute after the reset', () => {
    const w = new ac.PaneWatcher();
    const change = w.observe(RELATIVE, T0);
    assert.equal(change.type, 'scheduled');
    assert.equal(change.hasResetTime, true);
    assert.equal(w.dueAt, T0 + 5 * 3600000 + 60000);
    assert.equal(w.isDue(w.dueAt - 1), false);
    assert.equal(w.isDue(w.dueAt), true);
});

test('PaneWatcher keeps the plan while the same banner stays on screen', () => {
    const w = new ac.PaneWatcher();
    w.observe(RELATIVE, T0);
    const due = w.dueAt;
    // A relative wait re-read 10 minutes later must not move the plan.
    assert.equal(w.observe(RELATIVE, T0 + 10 * 60000), null);
    assert.equal(w.dueAt, due);
});

test('PaneWatcher falls back to 30 minutes without a reset time', () => {
    const w = new ac.PaneWatcher();
    const change = w.observe('Claude usage limit reached.\n', T0);
    assert.equal(change.hasResetTime, false);
    assert.equal(w.dueAt, T0 + 30 * 60000);
});

test('PaneWatcher drops the plan when the banner leaves the screen', () => {
    const w = new ac.PaneWatcher();
    w.observe(RELATIVE, T0);
    assert.deepEqual(w.observe('fresh screen\n> ', T0 + 60000), { type: 'cleared' });
    assert.equal(w.dueAt, null);
    assert.equal(w.observe('fresh screen\n> ', T0 + 120000), null);
});

test('PaneWatcher does not answer the same visible banner twice', () => {
    const w = new ac.PaneWatcher();
    w.observe('Claude usage limit reached.\n', T0);
    w.done();
    assert.equal(w.observe('Claude usage limit reached.\n> continue\n', T0 + 60000), null);
    assert.equal(w.dueAt, null);
});

test('PaneWatcher plans again for a new banner after answering', () => {
    const w = new ac.PaneWatcher();
    w.observe('5-hour limit reached ∙ resets 3pm (UTC)\n', T0);
    w.done();
    const change = w.observe('5-hour limit reached ∙ resets 3pm (UTC)\n5-hour limit reached ∙ resets 8pm (UTC)\n', T0);
    assert.equal(change.type, 'scheduled');
    assert.equal(w.dueAt, Date.UTC(2026, 9, 9, 20, 1, 0));
});

test('PaneWatcher forgets an answered banner once it has scrolled away', () => {
    const w = new ac.PaneWatcher();
    w.observe('Claude usage limit reached.\n', T0);
    w.done();
    w.observe('other text\n', T0 + 60000);
    assert.equal(w.observe('Claude usage limit reached.\n', T0 + 120000).type, 'scheduled');
});

test('PaneWatcher never plans further than 24 hours ahead', () => {
    const w = new ac.PaneWatcher();
    w.observe('Please try again in 48 hours\n', T0);
    assert.equal(w.dueAt, T0 + 24 * 3600000);
});
```

- [x] **Step 2: RED**

Run: `node --test --test-reporter=tap tests/test-auto-continue.js`
Expected: die 8 neuen Tests FAIL mit `ac.PaneWatcher is not a constructor`.

- [x] **Step 3: Implementierung** – in `auto-continue.js` vor `module.exports` einfügen:

```js
// Screen lines that carry a limit banner, trimmed.
function limitLines(text) {
    return text.split('\n').map((line) => line.trim()).filter((line) => detectLimit(line) !== null);
}

/**
 * Tracks one tmux pane. Each poll hands it the whole visible screen, and the
 * same banner keeps showing up until it scrolls away. So a banner is known by
 * its "signature" - all limit lines on screen, joined - instead of by
 * mattbsea's reset-time tolerance and 12 h stale window, which assume a stream
 * that shows each banner once:
 * - same signature as the plan: keep it (a relative "try again in 5 hours"
 *   would otherwise move 30 s further on every poll);
 * - same signature as the one already answered: nothing (no second
 *   "continue" for a banner still on screen, not even in the 30 min fallback);
 * - no limit line on screen: drop the plan and forget the answered banner.
 * Edge: the very same text appearing again while the old one is still shown
 * is missed - never sent twice.
 */
class PaneWatcher {
    constructor() {
        this.dueAt = null;
        this.pendingSig = null;
        this.answeredSig = null;
    }

    // One fresh screen. Returns null, {type: 'cleared'} or
    // {type: 'scheduled', dueAt, matched, hasResetTime}.
    observe(screen, nowMs) {
        const text = stripAnsi(screen);
        const lines = limitLines(text);
        if (lines.length === 0) {
            this.answeredSig = null;
            if (this.dueAt === null) return null;
            this.cancel();
            return { type: 'cleared' };
        }
        const sig = lines.join('\n');
        if (sig === this.answeredSig) return null;
        if (this.dueAt !== null && sig === this.pendingSig) return null;

        const resetAt = parseResetTime(text, nowMs);
        const wanted = resetAt !== null ? resetAt + RESUME_GRACE_MS : nowMs + FALLBACK_DELAY_MS;
        this.dueAt = Math.min(wanted, nowMs + MAX_WAIT_MS);
        this.pendingSig = sig;
        return {
            type: 'scheduled',
            dueAt: this.dueAt,
            matched: detectLimit(lines[lines.length - 1]),
            hasResetTime: resetAt !== null,
        };
    }

    isDue(nowMs) {
        return this.dueAt !== null && nowMs >= this.dueAt;
    }

    // The planned banner is dealt with (sent, or skipped on purpose).
    done() {
        this.answeredSig = this.pendingSig;
        this.cancel();
    }

    cancel() {
        this.dueAt = null;
        this.pendingSig = null;
    }
}
```

`module.exports` ersetzen durch:

```js
module.exports = { stripAnsi, detectLimit, parseResetTime, PaneWatcher };
```

- [x] **Step 4: GREEN**

Run: `node --test --test-reporter=tap tests/test-auto-continue.js`
Expected: `# pass 17`, `# fail 0`

- [x] **Step 5: Commit**

```bash
git add claude-workbench/image-service/auto-continue.js tests/test-auto-continue.js
git commit -m "feat: track limit banners per tmux pane by their screen text"
```

---

### Task 3: Claude im Vordergrund (`/proc`)

**Files:**
- Modify: `claude-workbench/image-service/auto-continue.js`
- Test: `tests/test-auto-continue.js`

- [x] **Step 1: Failing tests anhängen:**

```js
// Fake /proc: { pid: 'pid (comm) state ppid pgrp session tty_nr tpgid ...' }
function makeProc(stats) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-proc-'));
    for (const [pid, line] of Object.entries(stats)) {
        fs.mkdirSync(path.join(root, pid));
        fs.writeFileSync(path.join(root, pid, 'stat'), `${line} 0 0 0\n`);
    }
    fs.mkdirSync(path.join(root, 'self'));
    return root;
}

// HA-Test 3.3.0: bash -c (no job control) runs claude in its own process group.
const PROC_CLAUDE = {
    348: '348 (bash) S 347 348 348 34816 348',
    354: '354 (claude) S 348 348 348 34816 348',
};
// Interactive bash in another pane with vim in the foreground.
const PROC_VIM = {
    500: '500 (bash) S 1 500 500 34817 600',
    600: '600 (vim) S 500 600 500 34817 600',
};

test('claudeInForeground finds claude in the pane\'s foreground group', () => {
    const root = makeProc({ ...PROC_CLAUDE, ...PROC_VIM });
    try {
        assert.equal(ac.claudeInForeground(root, 348), true);
        assert.equal(ac.claudeInForeground(root, 500), false);
        assert.equal(ac.claudeInForeground(root, 999), false);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('claudeInForeground reads a comm with spaces and parentheses', () => {
    const root = makeProc({
        700: '700 (my (odd) sh) S 1 700 700 34818 700',
    });
    try {
        assert.equal(ac.claudeInForeground(root, 700), false);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
```

- [x] **Step 2: RED**

Run: `node --test --test-reporter=tap tests/test-auto-continue.js`
Expected: 2 FAIL, `ac.claudeInForeground is not a function`.

- [x] **Step 3: Implementierung** – vor `module.exports` einfügen:

```js
// comm, process group and the terminal's foreground group from
// /proc/<pid>/stat (proc(5): "pid (comm) state ppid pgrp session tty_nr tpgid
// ..."). comm may contain spaces and parentheses, so it ends at the last ")".
function readStat(procRoot, pid) {
    try {
        const raw = fs.readFileSync(path.join(procRoot, String(pid), 'stat'), 'utf8');
        const open = raw.indexOf('(');
        const close = raw.lastIndexOf(')');
        if (open < 0 || close < open) return null;
        const rest = raw.slice(close + 2).split(' ');
        return { comm: raw.slice(open + 1, close), pgrp: Number(rest[2]), tpgid: Number(rest[5]) };
    } catch {
        return null;
    }
}

/**
 * Whether Claude runs in the foreground of the pane whose shell is `panePid`.
 * tmux's pane_current_command cannot tell: on HA-Test it says "bash" for the
 * Claude pane, because `bash -c` has no job control and claude stays in bash's
 * process group. The terminal's foreground group (tpgid) does tell: it holds
 * claude there, and vim (not claude) when vim runs in an interactive shell.
 */
function claudeInForeground(procRoot, panePid) {
    const pane = readStat(procRoot, panePid);
    if (!pane || !(pane.tpgid > 0)) return false;
    let entries;
    try {
        entries = fs.readdirSync(procRoot);
    } catch {
        return false;
    }
    return entries.some((entry) => {
        if (!/^\d+$/.test(entry)) return false;
        const stat = readStat(procRoot, entry);
        return stat !== null && stat.pgrp === pane.tpgid && stat.comm === 'claude';
    });
}
```

`module.exports` ersetzen durch:

```js
module.exports = { stripAnsi, detectLimit, parseResetTime, PaneWatcher, claudeInForeground };
```

- [x] **Step 4: GREEN**

Run: `node --test --test-reporter=tap tests/test-auto-continue.js`
Expected: `# pass 19`, `# fail 0`

- [x] **Step 5: Commit**

```bash
git add claude-workbench/image-service/auto-continue.js tests/test-auto-continue.js
git commit -m "feat: send only where claude is the pane's foreground program"
```

---

### Task 4: Steuerung `createAutoContinue` (Abfrage, Senden, Zustand, Status)

**Files:**
- Modify: `claude-workbench/image-service/auto-continue.js`
- Test: `tests/test-auto-continue.js`

- [x] **Step 1: Failing tests anhängen:**

```js
// Fake tmux: one pane per entry of `screens` ({ '%0': { pid, screen } }).
function makeTmux(screens) {
    const calls = [];
    const tmux = async (args) => {
        calls.push(args);
        if (args[0] === 'list-panes') {
            if (screens === null) throw new Error("can't find session: claude");
            return Object.entries(screens).map(([id, p]) => `${id} ${p.pid}`).join('\n') + '\n';
        }
        if (args[0] === 'capture-pane') return screens[args[args.length - 1]].screen;
        return '';
    };
    return { tmux, calls };
}

function makeController(screens, stats = PROC_CLAUDE) {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-state-'));
    const procRoot = makeProc(stats);
    const clock = { now: T0 };
    const logs = [];
    const fake = makeTmux(screens);
    const ctl = ac.createAutoContinue({
        stateDir,
        procRoot,
        tmux: fake.tmux,
        now: () => clock.now,
        log: (m) => logs.push(m),
        sleep: async () => {},
    });
    const cleanup = () => {
        fs.rmSync(stateDir, { recursive: true, force: true });
        fs.rmSync(procRoot, { recursive: true, force: true });
    };
    const sends = () => fake.calls.filter((a) => a[0] === 'send-keys');
    return { ctl, stateDir, clock, logs, calls: fake.calls, sends, cleanup };
}

test('switched off: no tmux call, no log line', async () => {
    const t = makeController({ '%0': { pid: 348, screen: RELATIVE } });
    try {
        await t.ctl.poll();
        assert.deepEqual(t.calls, []);
        assert.deepEqual(t.logs, []);
        assert.equal(t.ctl.status().enabled, false);
    } finally { t.cleanup(); }
});

test('on: plans, then sends "continue" and Enter to that pane', async () => {
    const t = makeController({ '%0': { pid: 348, screen: RELATIVE } });
    try {
        t.ctl.setEnabled(true);
        await t.ctl.poll();
        assert.deepEqual(t.sends(), []);
        const planned = t.ctl.status().scheduled;
        assert.deepEqual(planned, [{ pane: '%0', at: new Date(T0 + 5 * 3600000 + 60000).toISOString() }]);
        assert.ok(t.logs.some((l) => l.startsWith('limit detected in pane %0')), t.logs.join('\n'));

        t.clock.now = T0 + 5 * 3600000 + 60000;
        await t.ctl.poll();
        assert.deepEqual(t.sends(), [
            ['send-keys', '-t', '%0', '-l', 'continue'],
            ['send-keys', '-t', '%0', 'Enter'],
        ]);
        assert.deepEqual(t.ctl.status().lastSent, { pane: '%0', at: new Date(t.clock.now).toISOString() });
        assert.deepEqual(t.ctl.status().scheduled, []);

        // The banner is still visible: no second "continue".
        t.clock.now += 30 * 60000;
        await t.ctl.poll();
        assert.equal(t.sends().length, 2);
    } finally { t.cleanup(); }
});

test('tmux is asked for exactly the claude session, wrapped lines joined', async () => {
    const t = makeController({ '%0': { pid: 348, screen: RELATIVE } });
    try {
        t.ctl.setEnabled(true);
        await t.ctl.poll();
        assert.deepEqual(t.calls[0], ['list-panes', '-s', '-t', '=claude', '-F', '#{pane_id} #{pane_pid}']);
        assert.deepEqual(t.calls[1], ['capture-pane', '-p', '-J', '-t', '%0']);
    } finally { t.cleanup(); }
});

test('nothing is sent when the banner is gone by then', async () => {
    const screens = { '%0': { pid: 348, screen: RELATIVE } };
    const t = makeController(screens);
    try {
        t.ctl.setEnabled(true);
        await t.ctl.poll();
        screens['%0'].screen = 'continue\nWorking on it...\n';
        t.clock.now = T0 + 6 * 3600000;
        await t.ctl.poll();
        assert.deepEqual(t.sends(), []);
        assert.ok(t.logs.some((l) => l.includes('no longer on screen')), t.logs.join('\n'));
    } finally { t.cleanup(); }
});

test('nothing is sent when claude is not in the foreground', async () => {
    const t = makeController({ '%1': { pid: 500, screen: RELATIVE } }, PROC_VIM);
    try {
        t.ctl.setEnabled(true);
        await t.ctl.poll();
        t.clock.now = T0 + 6 * 3600000;
        await t.ctl.poll();
        assert.deepEqual(t.sends(), []);
        assert.ok(t.logs.some((l) => l.includes('Claude is not the foreground program')), t.logs.join('\n'));
        // Skipped on purpose: not planned again for the same banner.
        t.clock.now += 3600000;
        await t.ctl.poll();
        assert.deepEqual(t.ctl.status().scheduled, []);
    } finally { t.cleanup(); }
});

test('switching off drops the plan and nothing is sent later', async () => {
    const t = makeController({ '%0': { pid: 348, screen: RELATIVE } });
    try {
        t.ctl.setEnabled(true);
        await t.ctl.poll();
        t.ctl.setEnabled(false);
        assert.deepEqual(t.ctl.status(), { enabled: false, scheduled: [], lastSent: null });
        assert.ok(t.logs.some((l) => l === 'off'), t.logs.join('\n'));
        assert.ok(t.logs.some((l) => l.includes('switched off')), t.logs.join('\n'));
        t.clock.now = T0 + 6 * 3600000;
        await t.ctl.poll();
        assert.deepEqual(t.sends(), []);
    } finally { t.cleanup(); }
});

test('the command\'s "off" in the state file is honoured on the next poll', async () => {
    const t = makeController({ '%0': { pid: 348, screen: RELATIVE } });
    try {
        t.ctl.setEnabled(true);
        await t.ctl.poll();
        fs.writeFileSync(path.join(t.stateDir, 'auto-continue'), 'off\n');
        t.clock.now = T0 + 6 * 3600000;
        await t.ctl.poll();
        assert.deepEqual(t.sends(), []);
        assert.deepEqual(t.ctl.status().scheduled, []);
    } finally { t.cleanup(); }
});

test('a missing tmux session is no error and logs nothing', async () => {
    const t = makeController(null);
    try {
        t.ctl.setEnabled(true);
        await t.ctl.poll();
        assert.deepEqual(t.logs, ['on']);
    } finally { t.cleanup(); }
});

test('the status file is plain text for the auto-continue command', async () => {
    const t = makeController({ '%0': { pid: 348, screen: RELATIVE } });
    try {
        t.ctl.setEnabled(true);
        await t.ctl.poll();
        const text = fs.readFileSync(path.join(t.stateDir, 'auto-continue.status'), 'utf8');
        const due = ac.clock(T0 + 5 * 3600000 + 60000);
        assert.equal(text,
            'Auto-continue: on\n' +
            `Will send "continue" to pane %0 at ${due}\n` +
            'Last sent: never\n');
        t.ctl.setEnabled(false);
        assert.equal(fs.readFileSync(path.join(t.stateDir, 'auto-continue.status'), 'utf8'),
            'Auto-continue: off\nLast sent: never\n');
    } finally { t.cleanup(); }
});

test('setEnabled writes on/off to the state file', () => {
    const t = makeController({});
    try {
        t.ctl.setEnabled(true);
        assert.equal(fs.readFileSync(path.join(t.stateDir, 'auto-continue'), 'utf8'), 'on\n');
        t.ctl.setEnabled(false);
        assert.equal(fs.readFileSync(path.join(t.stateDir, 'auto-continue'), 'utf8'), 'off\n');
    } finally { t.cleanup(); }
});
```

- [x] **Step 2: RED**

Run: `node --test --test-reporter=tap tests/test-auto-continue.js`
Expected: 10 FAIL, `ac.createAutoContinue is not a function`.

- [x] **Step 3: Implementierung** – vor `module.exports` einfügen:

```js
function runTmux(args) {
    return new Promise((resolve, reject) => {
        execFile('tmux', args, { timeout: TMUX_TIMEOUT_MS }, (err, stdout) => (err ? reject(err) : resolve(stdout)));
    });
}

// HH:MM in the container's zone (TZ), for the log and the status file.
function clock(ms) {
    return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
        .format(new Date(ms));
}

/**
 * The switch lives in <stateDir>/auto-continue ("on"/"off"), written by
 * run.sh on start (option auto_continue), by the auto-continue command and by
 * POST /auto-continue; it is re-read on every poll. <stateDir>/auto-continue.status
 * is the plain-text summary the command prints.
 */
function createAutoContinue(options = {}) {
    const stateDir = options.stateDir || process.env.AUTO_CONTINUE_DIR || '/run/claude-workbench';
    const procRoot = options.procRoot || '/proc';
    const tmux = options.tmux || runTmux;
    const now = options.now || Date.now;
    const log = options.log || ((msg) => console.log(`[auto-continue] ${msg}`));
    const sleep = options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    const stateFile = path.join(stateDir, 'auto-continue');
    const statusFile = path.join(stateDir, 'auto-continue.status');
    const watchers = new Map(); // pane id -> PaneWatcher
    let lastSent = null;        // { pane, at }
    let lastEnabled = null;     // null until the first poll: an "off" start logs nothing
    let polling = false;

    function isEnabled() {
        try {
            return fs.readFileSync(stateFile, 'utf8').trim() === 'on';
        } catch {
            return false;
        }
    }

    function status() {
        const scheduled = [...watchers.entries()]
            .filter(([, w]) => w.dueAt !== null)
            .map(([pane, w]) => ({ pane, at: new Date(w.dueAt).toISOString() }))
            .sort((a, b) => a.at.localeCompare(b.at));
        return {
            enabled: isEnabled(),
            scheduled,
            lastSent: lastSent && { pane: lastSent.pane, at: new Date(lastSent.at).toISOString() },
        };
    }

    function writeStatus() {
        const s = status();
        const lines = [`Auto-continue: ${s.enabled ? 'on' : 'off'}`];
        for (const item of s.scheduled) {
            lines.push(`Will send "continue" to pane ${item.pane} at ${clock(Date.parse(item.at))}`);
        }
        lines.push(lastSent ? `Last sent: pane ${lastSent.pane} at ${clock(lastSent.at)}` : 'Last sent: never');
        try {
            fs.mkdirSync(stateDir, { recursive: true });
            fs.writeFileSync(statusFile, lines.join('\n') + '\n');
        } catch (err) {
            log(`could not write ${statusFile}: ${err.message}`);
        }
    }

    function applyEnabled(enabled) {
        if (enabled === lastEnabled) return;
        if (enabled) {
            log('on');
        } else {
            if (lastEnabled === true) log('off');
            for (const [pane, w] of watchers) {
                if (w.dueAt !== null) log(`not sent to pane ${pane}: switched off`);
            }
            watchers.clear();
        }
        lastEnabled = enabled;
    }

    function setEnabled(enabled) {
        fs.mkdirSync(stateDir, { recursive: true });
        fs.writeFileSync(stateFile, enabled ? 'on\n' : 'off\n');
        applyEnabled(enabled);
        writeStatus();
    }

    async function listPanes() {
        let out;
        try {
            // "=claude": exactly this session, not a prefix match.
            out = await tmux(['list-panes', '-s', '-t', `=${SESSION}`, '-F', '#{pane_id} #{pane_pid}']);
        } catch {
            return []; // no session yet (start-up) or tmux gone: nothing to watch
        }
        return out.split('\n')
            .map((line) => line.trim().split(' '))
            .filter(([id, pid]) => /^%\d+$/.test(id || '') && /^\d+$/.test(pid || ''))
            .map(([id, pid]) => ({ id, pid: Number(pid) }));
    }

    async function send(pane, watcher) {
        try {
            await tmux(['send-keys', '-t', pane.id, '-l', 'continue']);
            await sleep(ENTER_DELAY_MS);
            await tmux(['send-keys', '-t', pane.id, 'Enter']);
            lastSent = { pane: pane.id, at: now() };
            log(`sent "continue" to pane ${pane.id}`);
        } catch (err) {
            // Not retried: a retry after "continue" went through but Enter
            // failed would type it twice.
            log(`could not send to pane ${pane.id}: ${err.message}`);
        }
        watcher.done();
    }

    async function checkPanes() {
        const panes = await listPanes();
        const ids = new Set(panes.map((p) => p.id));
        for (const [pane, w] of watchers) {
            if (ids.has(pane)) continue;
            if (w.dueAt !== null) log(`not sent to pane ${pane}: the pane is gone`);
            watchers.delete(pane);
        }
        for (const pane of panes) {
            let screen;
            try {
                screen = await tmux(['capture-pane', '-p', '-J', '-t', pane.id]);
            } catch {
                continue;
            }
            if (!watchers.has(pane.id)) watchers.set(pane.id, new PaneWatcher());
            const w = watchers.get(pane.id);
            const t = now();
            const change = w.observe(screen, t);
            if (change && change.type === 'scheduled') {
                log(`limit detected in pane ${pane.id}: "${change.matched}"` +
                    (change.hasResetTime ? '' : ' (no reset time in the message)') +
                    `; will send "continue" at ${clock(change.dueAt)}`);
            } else if (change && change.type === 'cleared') {
                log(`not sent to pane ${pane.id}: the limit message is no longer on screen`);
            }
            if (!w.isDue(t)) continue;
            if (!claudeInForeground(procRoot, pane.pid)) {
                log(`not sent to pane ${pane.id}: Claude is not the foreground program`);
                w.done();
                continue;
            }
            if (!isEnabled()) return; // switched off meanwhile; the next poll drops the plans
            await send(pane, w);
        }
    }

    // Never throws: a failing check must not take the image service down.
    async function poll() {
        if (polling) return;
        polling = true;
        try {
            const enabled = isEnabled();
            applyEnabled(enabled);
            if (enabled) await checkPanes();
        } catch (err) {
            log(`check failed: ${err.message}`);
        } finally {
            polling = false;
            writeStatus();
        }
    }

    function start(intervalMs = POLL_INTERVAL_MS) {
        const timer = setInterval(poll, intervalMs);
        timer.unref();
        poll();
        return timer;
    }

    return { poll, start, setEnabled, isEnabled, status };
}
```

`module.exports` ersetzen durch:

```js
module.exports = {
    stripAnsi,
    detectLimit,
    parseResetTime,
    PaneWatcher,
    claudeInForeground,
    clock,
    createAutoContinue,
};
```

- [x] **Step 4: GREEN**

Run: `node --test --test-reporter=tap tests/test-auto-continue.js`
Expected: `# pass 29`, `# fail 0`

- [x] **Step 5: Gegenprobe** – in `checkPanes` die Zeile `if (!claudeInForeground(procRoot, pane.pid)) {`
  vorübergehend in `if (false) {` ändern (Edit-Tool), Tests laufen lassen: „nothing is sent when claude
  is not in the foreground“ muss FAIL zeigen. Zurück per Edit-Tool, Tests wieder GREEN.

- [x] **Step 6: Commit**

```bash
git add claude-workbench/image-service/auto-continue.js tests/test-auto-continue.js
git commit -m "feat: auto-continue controller - poll tmux, send continue, on/off state"
```

---

### Nachtrag nach Tasks 1–4 (Code-Review)

Die Code-Blöcke von Task 1–4 sind der Stand vor dem Review. Danach geändert (Begründung im
Spec-Nachtrag): `bannerMatch` (nur Meldungen am Zeilenanfang, Reset-Zeit nur aus diesen Zeilen,
`8784ed3a`), Abschalten während einer Abfrage (`c315aa16`), `poll` wirft nie, Statusdatei-Fehler
nur einmal geloggt, Test-Hygiene (`de6fb13e`). Stand: 42 Tests grün. **Für Task 5 wichtig:**
`setEnabled` kann bei Dateifehlern werfen – der POST-Handler fängt das und antwortet 500.

### Task 5: Endpunkte im Image-Service

**Files:**
- Modify: `claude-workbench/image-service/server.js`
- Test: `tests/test-image-service.js`

- [ ] **Step 1: Failing tests** – in `tests/test-image-service.js`:
  - neue Variable unter `let uploadDir;`: `let autoContinueDir;`
  - in `test.before` direkt nach `uploadDir = fs.mkdtempSync(…)`:
    `autoContinueDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-ac-'));`
  - im `env` des `spawn` nach `UPLOAD_DIR: uploadDir`: `, AUTO_CONTINUE_DIR: autoContinueDir`
  - in `test.after` nach der `uploadDir`-Zeile:
    `if (autoContinueDir) fs.rmSync(autoContinueDir, { recursive: true, force: true });`
  - neue Tests vor `test('/terminal proxies HTTP through to ttyd', …)`:

```js
test('/auto-continue reports the switch, off by default', async () => {
    const res = await fetch(`http://127.0.0.1:${PORT}/auto-continue`);
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(await res.json(), { enabled: false, scheduled: [], lastSent: null });
});

test('POST /auto-continue switches it and writes the state file', async () => {
    const post = (body) => fetch(`http://127.0.0.1:${PORT}/auto-continue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body
    });
    let res = await post(JSON.stringify({ enabled: true }));
    assert.strictEqual(res.status, 200);
    assert.strictEqual((await res.json()).enabled, true);
    assert.strictEqual(fs.readFileSync(path.join(autoContinueDir, 'auto-continue'), 'utf8'), 'on\n');

    res = await post(JSON.stringify({ enabled: false }));
    assert.strictEqual((await res.json()).enabled, false);
    assert.strictEqual(fs.readFileSync(path.join(autoContinueDir, 'auto-continue'), 'utf8'), 'off\n');
});

test('POST /auto-continue refuses anything but a boolean', async () => {
    for (const body of [JSON.stringify({ enabled: 'yes' }), JSON.stringify({}), '{not json']) {
        const res = await fetch(`http://127.0.0.1:${PORT}/auto-continue`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body
        });
        assert.strictEqual(res.status, 400, body);
    }
    assert.strictEqual(fs.readFileSync(path.join(autoContinueDir, 'auto-continue'), 'utf8'), 'off\n');
});
```

- [ ] **Step 2: RED**

Run: `cd claude-workbench/image-service && npm_config_cache='D:/Entwicklung/Claude-Code-HA/.tmp/npm-cache' npm ci && cd ../.. && node --test --test-reporter=tap tests/test-image-service.js`
Expected: die 3 neuen Tests FAIL (404 bzw. HTML statt JSON); die übrigen 15 wie bisher.
(`npm ci` nur, falls `node_modules` fehlt.)

- [ ] **Step 3: Implementierung** – in `server.js`:
  - nach `const { createProxyMiddleware } = require('http-proxy-middleware');`:

```js
const { createAutoContinue } = require('./auto-continue');
```

  - nach dem `/upload`-Handler (vor dem Kommentar `// Shown in the terminal frame …`):

```js
// Auto-continue after a usage limit (auto-continue.js): the panel's button
// reads and flips the switch here; the auto-continue command and run.sh write
// the same state file.
const autoContinue = createAutoContinue();

app.get('/auto-continue', (req, res) => {
    res.json(autoContinue.status());
});

app.post('/auto-continue', express.json({ limit: '1kb' }), (req, res) => {
    if (typeof req.body?.enabled !== 'boolean') {
        return res.status(400).json({ success: false, error: 'enabled must be true or false' });
    }
    autoContinue.setEnabled(req.body.enabled);
    res.json(autoContinue.status());
});
```

  - im `server.listen`-Callback nach `console.log(\`Terminal proxy available at /terminal/\`);`:

```js
    autoContinue.start();
```

  Ungültiges JSON wirft in `express.json` einen Fehler mit `status: 400`; die vorhandene
  Fehler-Middleware antwortet damit (`err.status || 500`).

- [ ] **Step 4: GREEN**

Run: `node --test --test-reporter=tap tests/test-image-service.js`
Expected: 18 Einzeltests ok (unter Windows ggf. der bekannte ECONNRESET-Datei-Fehlschlag; maßgeblich sind die Einzeltests).

- [ ] **Step 5: Commit**

```bash
git add claude-workbench/image-service/server.js tests/test-image-service.js
git commit -m "feat: GET/POST /auto-continue in the image service"
```

---

### Task 6: Option `auto_continue` und Anfangszustand in `run.sh`

**Files:**
- Modify: `claude-workbench/config.yaml`, `claude-workbench/translations/en.yaml`, `claude-workbench/translations/de.yaml`
- Modify: `claude-workbench/run.sh` (Kopf bei Zeile 25, neue Funktion vor `start_image_service()`, `main`)
- Create: `tests/test-auto-continue-cmd.sh` (Teil `init_auto_continue`; der Befehl folgt in Task 7)
- Modify: `tests/test-startup-order.sh`, `tests/run-tests.sh`

- [ ] **Step 1: Failing test** – `tests/test-auto-continue-cmd.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

# Auto-continue's switch is the file $AUTO_CONTINUE_DIR/auto-continue ("on" or
# "off"). run.sh writes it from the option auto_continue on every start
# (init_auto_continue); the auto-continue command flips it at runtime.

repo_root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
tmp_dir=$(mktemp -d)
trap 'rm -rf "$tmp_dir"' EXIT

fail() {
    echo "FAIL (auto-continue): $*" >&2
    exit 1
}

log="$tmp_dir/log"
: > "$log"
bashio::log.info() { printf 'info|%s\n' "$*" >> "$log"; }
bashio::log.warning() { printf 'warning|%s\n' "$*" >> "$log"; }
bashio::log.error() { printf 'error|%s\n' "$*" >> "$log"; }
config_value=false
bashio::config() {
    case "$1" in
        auto_continue) printf '%s\n' "$config_value" ;;
        *) printf '%s\n' "${2:-}" ;;
    esac
}

export AUTO_CONTINUE_DIR="$tmp_dir/run"
# shellcheck disable=SC2034  # read by the sourced run.sh
CLAUDE_RUN_SH_SKIP_MAIN=true
# shellcheck source=/dev/null
source "$repo_root/claude-workbench/run.sh"

command -v init_auto_continue >/dev/null 2>&1 || fail "run.sh has no init_auto_continue"
state="$AUTO_CONTINUE_DIR/auto-continue"

# Off by default, and silent.
config_value=false
init_auto_continue
[ "$(cat "$state")" = "off" ] || fail "option false did not write off"
[ ! -s "$log" ] || fail "an off start must not log: $(cat "$log")"

# On: writes on and says how to switch it.
config_value=true
init_auto_continue
[ "$(cat "$state")" = "on" ] || fail "option true did not write on"
grep -q '^info|Auto-continue after a usage limit is on' "$log" || fail "an on start was not logged: $(cat "$log")"

# A stale status from before the restart is removed.
printf 'Auto-continue: on\n' > "$AUTO_CONTINUE_DIR/auto-continue.status"
config_value=false
init_auto_continue
[ ! -e "$AUTO_CONTINUE_DIR/auto-continue.status" ] || fail "the old status file was kept"

# Anything unreadable counts as off.
for value in '' maybe 1 yes; do
    config_value="$value"
    init_auto_continue
    [ "$(cat "$state")" = "off" ] || fail "option '$value' did not write off"
done

# A directory that cannot be created must not abort the start.
: > "$tmp_dir/blocker"
AUTO_CONTINUE_DIR="$tmp_dir/blocker/run"
config_value=true
init_auto_continue
grep -q '^warning|Could not write the auto-continue switch' "$log" || fail "a failed write was not logged: $(cat "$log")"
AUTO_CONTINUE_DIR="$tmp_dir/run"

echo "Auto-continue suite passed"
```

  Hinweis: Nur `true` schaltet ein (die Option ist `bool?`, HA liefert `true`/`false`); `1`/`yes`
  zählen bewusst als aus.

`tests/test-startup-order.sh`: in der Schleife `for step in run_health_check install_tools start_image_service …`
den Schritt `init_auto_continue` ergänzen und nach der Prüfung `install_tools` < `start_image_service` einfügen:

```bash
[ "$(line_of init_auto_continue)" -lt "$(line_of start_image_service)" ] || \
    fail "init_auto_continue must write the switch before the image service reads it"
```

`tests/run-tests.sh`: nach `"$tests_dir/test-tmux-config.sh"` einfügen:

```bash
"$tests_dir/test-auto-continue-cmd.sh"
```

- [ ] **Step 2: RED**

Run: `git add tests/test-auto-continue-cmd.sh && git update-index --chmod=+x tests/test-auto-continue-cmd.sh && bash tests/test-auto-continue-cmd.sh; bash tests/test-startup-order.sh`
Expected: `FAIL (auto-continue): run.sh has no init_auto_continue` und Startup-order FAIL für `init_auto_continue`.

- [ ] **Step 3: Implementierung**

`run.sh`, nach Zeile 25 (`IMAGE_UPLOAD_DIR="${IMAGE_UPLOAD_DIR:-/data/images}"`):

```bash
# Auto-continue's switch ("on"/"off"), read by the image service on every poll
# and flipped by the auto-continue command. /run is cleared on restart, so the
# option decides again after every start (image-service/auto-continue.js).
AUTO_CONTINUE_DIR="${AUTO_CONTINUE_DIR:-/run/claude-workbench}"
```

`run.sh`, neue Funktion direkt vor `start_image_service() {`:

```bash
# Write auto-continue's initial state from the option. Must run before the
# image service starts; a failure only logs, the panel matters more.
init_auto_continue() {
    local state=off

    [ "$(bashio::config 'auto_continue' 'false')" = "true" ] && state=on
    if ! { mkdir -p "$AUTO_CONTINUE_DIR" && printf '%s\n' "$state" > "$AUTO_CONTINUE_DIR/auto-continue"; } 2>/dev/null; then
        bashio::log.warning "Could not write the auto-continue switch to ${AUTO_CONTINUE_DIR}; auto-continue stays off"
        return 0
    fi
    rm -f "$AUTO_CONTINUE_DIR/auto-continue.status"
    if [ "$state" = "on" ]; then
        bashio::log.info "Auto-continue after a usage limit is on (switch it with: auto-continue on|off)"
    fi
}
```

`run.sh` `main`: zwischen `prune_uploaded_images` und dem Kommentar `# Serve the panel before …` einfügen:

```bash
    init_auto_continue
```

`config.yaml`: unter `options:` nach `image_retention_days: 30` → `  auto_continue: false`;
unter `schema:` nach `image_retention_days: int(0,3650)?` → `  auto_continue: bool?`.

`translations/en.yaml` am Ende von `configuration:`:

```yaml
  auto_continue:
    name: "Auto-continue after a usage limit"
    description: "When Claude reports a usage limit, types “continue” into the Claude session one minute after the reset. Claude then works on unattended, also with “Run without asking”. Switch it at runtime with the ⏩ button or `auto-continue on|off`; after a restart this setting applies again."
```

`translations/de.yaml` am Ende von `configuration:`:

```yaml
  auto_continue:
    name: "Nach Nutzungslimit automatisch weitermachen"
    description: "Meldet Claude ein Nutzungslimit, tippt die App eine Minute nach dem Reset „continue“ in die Claude-Sitzung. Claude arbeitet dann ohne Aufsicht weiter, auch mit „Ohne Rückfragen ausführen“. Zur Laufzeit mit dem Knopf ⏩ oder `auto-continue on|off` umschaltbar; nach einem Neustart gilt wieder diese Einstellung."
```

- [ ] **Step 4: GREEN**

Run: `bash tests/test-auto-continue-cmd.sh && bash tests/test-startup-order.sh && bash tests/test-release-metadata.sh`
Expected: `Auto-continue suite passed`, `Startup order suite passed`, Release-Metadata ohne FAIL.

- [ ] **Step 5: Commit**

```bash
git add claude-workbench/run.sh claude-workbench/config.yaml claude-workbench/translations/en.yaml claude-workbench/translations/de.yaml tests/test-auto-continue-cmd.sh tests/test-startup-order.sh tests/run-tests.sh
git commit -m "feat: option auto_continue sets the switch on every start"
```

---

### Task 7: Befehl `auto-continue`

**Files:**
- Create: `claude-workbench/scripts/auto-continue.sh`
- Modify: `claude-workbench/Dockerfile:146-149`
- Modify: `tests/test-auto-continue-cmd.sh`, `tests/test-release-metadata.sh`

- [ ] **Step 1: Failing tests** – in `tests/test-auto-continue-cmd.sh` vor `echo "Auto-continue suite passed"` einfügen:

```bash
# --- the auto-continue command ---
cmd="$repo_root/claude-workbench/scripts/auto-continue.sh"
[ -f "$cmd" ] || fail "scripts/auto-continue.sh is missing"
export AUTO_CONTINUE_DIR="$tmp_dir/cmd"

out=$(bash "$cmd" on) || fail "on failed"
[ "$(cat "$AUTO_CONTINUE_DIR/auto-continue")" = "on" ] || fail "on did not write on"
printf '%s\n' "$out" | grep -q 'Auto-continue is now on' || fail "on said: $out"

bash "$cmd" off > /dev/null || fail "off failed"
[ "$(cat "$AUTO_CONTINUE_DIR/auto-continue")" = "off" ] || fail "off did not write off"

# status without a word from the service yet
out=$(bash "$cmd" status) || fail "status failed without a status file"
printf '%s\n' "$out" | grep -q '^Auto-continue: off$' || fail "status said: $out"
printf '%s\n' "$out" | grep -q 'No report from the image service yet' || fail "status did not explain the missing report: $out"

# status prints the service's report as it is
printf 'Auto-continue: on\nWill send "continue" to pane %%0 at 15:01\nLast sent: never\n' > "$AUTO_CONTINUE_DIR/auto-continue.status"
out=$(bash "$cmd") || fail "no argument failed"
[ "$out" = "$(cat "$AUTO_CONTINUE_DIR/auto-continue.status")" ] || fail "status did not print the report: $out"

# unknown word: help on stderr, exit 2, state untouched
rc=0
bash "$cmd" maybe > /dev/null 2> "$tmp_dir/err" || rc=$?
[ "$rc" -eq 2 ] || fail "an unknown argument exited $rc, not 2"
grep -q 'Usage: auto-continue' "$tmp_dir/err" || fail "no usage on stderr"
[ "$(cat "$AUTO_CONTINUE_DIR/auto-continue")" = "off" ] || fail "an unknown argument changed the state"

bash "$cmd" --help | grep -q 'Usage: auto-continue' || fail "--help shows no usage"
```

`tests/test-release-metadata.sh`, nach der `claude-doctor`-Prüfung:

```bash
# auto-continue switches auto-continue at runtime from the terminal.
grep -qE '^\s*(RUN |&& )?ln -sf /opt/scripts/auto-continue\.sh /usr/local/bin/auto-continue' "$addon_dir/Dockerfile" || \
    fail "Dockerfile does not link /usr/local/bin/auto-continue to /opt/scripts/auto-continue.sh"
```

- [ ] **Step 2: RED**

Run: `bash tests/test-auto-continue-cmd.sh; bash tests/test-release-metadata.sh`
Expected: `FAIL (auto-continue): scripts/auto-continue.sh is missing` und der Dockerfile-FAIL.

- [ ] **Step 3: Implementierung** – `claude-workbench/scripts/auto-continue.sh`:

```bash
#!/usr/bin/env bash
# auto-continue: switch auto-continue after a usage limit on or off while the
# app runs, or show what the image service has planned. The switch is a file
# the image service re-reads every 30 seconds (image-service/auto-continue.js);
# after a restart the option auto_continue applies again.
set -euo pipefail

dir="${AUTO_CONTINUE_DIR:-/run/claude-workbench}"
state_file="$dir/auto-continue"
status_file="$dir/auto-continue.status"

usage() {
    cat << 'EOF'
Usage: auto-continue on|off|status

  on      type "continue" into Claude one minute after a usage limit resets
  off     stop that; anything already planned is dropped
  status  show the switch and what is planned (default)
EOF
}

case "${1:-status}" in
    on|off)
        mkdir -p "$dir"
        printf '%s\n' "$1" > "$state_file"
        echo "Auto-continue is now $1 (the image service picks it up within 30 seconds)."
        ;;
    status)
        if [ -f "$status_file" ]; then
            cat "$status_file"
        else
            state=$(cat "$state_file" 2>/dev/null || echo off)
            echo "Auto-continue: ${state}"
            echo "No report from the image service yet."
        fi
        ;;
    -h|--help|help)
        usage
        ;;
    *)
        usage >&2
        exit 2
        ;;
esac
```

  Hinweis: Nach `on`/`off` kann die Statusdatei bis zu 30 s den alten Stand zeigen; der Knopf im Panel
  schaltet über `POST` und aktualisiert sie sofort. In der Ausgabe von `on`/`off` steht das.

`git add claude-workbench/scripts/auto-continue.sh && git update-index --chmod=+x claude-workbench/scripts/auto-continue.sh`

`Dockerfile`, die Zeile `&& ln -sf /opt/scripts/health-check.sh /usr/local/bin/claude-doctor` ersetzen durch:

```dockerfile
    && ln -sf /opt/scripts/health-check.sh /usr/local/bin/claude-doctor \
    && ln -sf /opt/scripts/auto-continue.sh /usr/local/bin/auto-continue
```

  und den Kommentar darüber ergänzen:

```dockerfile
# claude-doctor: the startup health check, callable from the terminal
# (owine's fork, commit cc0d74e7); auto-continue: the runtime switch for
# auto-continue after a usage limit (mattbsea's fork, commit 00e22fc0)
```

- [ ] **Step 4: GREEN**

Run: `bash tests/test-auto-continue-cmd.sh && bash tests/test-release-metadata.sh`
Expected: `Auto-continue suite passed`, Release-Metadata ohne FAIL.

ShellCheck wie die CI (lokal, falls installiert; sonst in der CI):
`shellcheck -S warning -e SC1008,SC1007,SC2155 -x claude-workbench/run.sh claude-workbench/scripts/*.sh claude-workbench/scripts/persist-install tests/*.sh`

- [ ] **Step 5: Commit**

```bash
git add claude-workbench/scripts/auto-continue.sh claude-workbench/Dockerfile tests/test-auto-continue-cmd.sh tests/test-release-metadata.sh
git commit -m "feat: auto-continue command switches it at runtime"
```

---

### Task 8: Frontend-Helfer `workbench-ui.js`

**Files:**
- Create: `claude-workbench/image-service/public/workbench-ui.js`
- Create: `tests/test-workbench-ui.js`
- Modify: `tests/run-tests.sh`

- [ ] **Step 1: Failing test** – `tests/test-workbench-ui.js`:

```js
#!/usr/bin/env node
'use strict';

/**
 * Panel helpers (image-service/public/workbench-ui.js): Shift+Enter inserts a
 * newline instead of submitting (mattbsea's fork, commit 6e44e41f), and the
 * auto-continue button's label.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ui = require(path.join(__dirname, '..', 'claude-workbench', 'image-service', 'public', 'workbench-ui.js'));

function key(extra) {
    return Object.assign({
        type: 'keydown', key: 'Enter', shiftKey: true,
        ctrlKey: false, altKey: false, metaKey: false, isComposing: false,
    }, extra);
}

test('isShiftEnter matches plain Shift+Enter only', () => {
    assert.equal(ui.isShiftEnter(key()), true);
    assert.equal(ui.isShiftEnter(key({ shiftKey: false })), false);
    assert.equal(ui.isShiftEnter(key({ ctrlKey: true })), false);
    assert.equal(ui.isShiftEnter(key({ altKey: true })), false);
    assert.equal(ui.isShiftEnter(key({ metaKey: true })), false);
    assert.equal(ui.isShiftEnter(key({ type: 'keyup' })), false);
    assert.equal(ui.isShiftEnter(key({ isComposing: true })), false);
    assert.equal(ui.isShiftEnter(key({ key: 'a' })), false);
});

function fakeWindow(term) {
    const listeners = [];
    return {
        term,
        addEventListener(type, fn, capture) { listeners.push({ type, fn, capture }); },
        fire(event) {
            const e = Object.assign({
                prevented: false, stopped: false,
                preventDefault() { this.prevented = true; },
                stopImmediatePropagation() { this.stopped = true; },
            }, event);
            for (const l of listeners) if (l.type === e.type) l.fn(e);
            return e;
        },
        listeners,
    };
}

test('Shift+Enter sends backslash + CR as typed input and stops the event', () => {
    const inputs = [];
    const win = fakeWindow({ input(data, wasUserInput) { inputs.push([data, wasUserInput]); } });
    assert.equal(ui.installShiftEnter(win), true);
    assert.equal(win.listeners[0].capture, true, 'must run before xterm (capture phase)');

    const e = win.fire(key());
    assert.deepEqual(inputs, [['\\\r', true]]);
    assert.equal(e.prevented, true);
    assert.equal(e.stopped, true);

    const plain = win.fire(key({ shiftKey: false }));
    assert.equal(inputs.length, 1, 'plain Enter is left to xterm');
    assert.equal(plain.prevented, false);
});

test('without term.input Shift+Enter is left alone', () => {
    const win = fakeWindow({});
    ui.installShiftEnter(win);
    const e = win.fire(key());
    assert.equal(e.prevented, false);
});

test('installShiftEnter installs once per window', () => {
    const win = fakeWindow({ input() {} });
    assert.equal(ui.installShiftEnter(win), true);
    assert.equal(ui.installShiftEnter(win), false);
    assert.equal(win.listeners.length, 1);
});

const fmt = (iso) => `T(${iso})`;

test('autoContinueLabel shows off, on, the planned time and unknown', () => {
    assert.deepEqual(ui.autoContinueLabel(null, fmt),
        { text: 'Auto-continue: ?', short: '?', on: false, title: 'Auto-continue after a usage limit: state unknown' });
    assert.deepEqual(ui.autoContinueLabel({ enabled: false, scheduled: [] }, fmt),
        { text: 'Auto-continue: off', short: 'off', on: false, title: 'Auto-continue after a usage limit is off - click to switch it on' });
    assert.deepEqual(ui.autoContinueLabel({ enabled: true, scheduled: [] }, fmt),
        { text: 'Auto-continue: on', short: 'on', on: true, title: 'Auto-continue after a usage limit is on - click to switch it off' });
    assert.deepEqual(ui.autoContinueLabel({ enabled: true, scheduled: [{ pane: '%0', at: 'A' }, { pane: '%1', at: 'B' }] }, fmt),
        { text: 'Continue T(A)', short: 'T(A)', on: true, title: 'Sends "continue" at T(A) - click to switch auto-continue off' });
});
```

`tests/run-tests.sh`: nach `node "$tests_dir/test-terminal-clipboard.js"` einfügen:

```bash
node --test "$tests_dir/test-workbench-ui.js"
```

- [ ] **Step 2: RED**

Run: `node --test --test-reporter=tap tests/test-workbench-ui.js`
Expected: FAIL, `Cannot find module …/workbench-ui.js`

- [ ] **Step 3: Implementierung** – `claude-workbench/image-service/public/workbench-ui.js`:

```js
/**
 * Small panel helpers, loaded by index.html and testable in Node
 * (tests/test-workbench-ui.js).
 *
 * Shift+Enter: Claude Code's /terminal-setup cannot configure ttyd in a
 * browser, so Shift+Enter sent a plain CR and submitted. Claude Code treats
 * backslash + CR as "newline, don't submit" in any terminal (in bash it is a
 * line continuation), so Shift+Enter sends that instead (mattbsea's fork,
 * commit 6e44e41f). A capture listener on the ttyd frame's window runs before
 * xterm.js, like the Ctrl+V handler in index.html; ttyd's own key handler slot
 * stays untouched. term.input() is xterm.js 5.4 (bundled with ttyd 1.7.7): it
 * goes out exactly like typed keys, unlike term.paste(), which would wrap the
 * text in bracketed-paste markers.
 */
(function (root, factory) {
    'use strict';
    var api = factory();
    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    }
    if (root) {
        root.ClaudeWorkbenchUi = api;
    }
})(typeof self !== 'undefined' ? self : null, function () {
    'use strict';

    var INSTALL_FLAG = '__claudeShiftEnterInstalled';

    function isShiftEnter(e) {
        return e.type === 'keydown' && e.key === 'Enter' && e.shiftKey &&
            !e.ctrlKey && !e.altKey && !e.metaKey && !e.isComposing;
    }

    /** Install the Shift+Enter handler on the ttyd frame's window, once. */
    function installShiftEnter(win) {
        if (!win || win[INSTALL_FLAG]) return false;
        win[INSTALL_FLAG] = true;
        win.addEventListener('keydown', function (e) {
            if (!isShiftEnter(e)) return;
            var term = win.term;
            if (!term || typeof term.input !== 'function') return; // plain Enter then
            e.preventDefault();
            e.stopImmediatePropagation();
            term.input('\\\r', true);
        }, true);
        return true;
    }

    /**
     * Label for the auto-continue button from GET /auto-continue (null when
     * that failed). formatTime turns an ISO time into the viewer's HH:MM.
     */
    function autoContinueLabel(status, formatTime) {
        if (!status || typeof status.enabled !== 'boolean') {
            return { text: 'Auto-continue: ?', short: '?', on: false,
                title: 'Auto-continue after a usage limit: state unknown' };
        }
        if (!status.enabled) {
            return { text: 'Auto-continue: off', short: 'off', on: false,
                title: 'Auto-continue after a usage limit is off - click to switch it on' };
        }
        var next = (status.scheduled || [])[0];
        if (next) {
            var time = formatTime(next.at);
            return { text: 'Continue ' + time, short: time, on: true,
                title: 'Sends "continue" at ' + time + ' - click to switch auto-continue off' };
        }
        return { text: 'Auto-continue: on', short: 'on', on: true,
            title: 'Auto-continue after a usage limit is on - click to switch it off' };
    }

    return {
        isShiftEnter: isShiftEnter,
        installShiftEnter: installShiftEnter,
        autoContinueLabel: autoContinueLabel
    };
});
```

- [ ] **Step 4: GREEN**

Run: `node --test --test-reporter=tap tests/test-workbench-ui.js`
Expected: `# pass 5`, `# fail 0`

- [ ] **Step 5: Commit**

```bash
git add claude-workbench/image-service/public/workbench-ui.js tests/test-workbench-ui.js tests/run-tests.sh
git commit -m "feat: Shift+Enter inserts a newline; auto-continue button label"
```

---

### Task 9: Knopf und Verdrahtung in `index.html`

Nicht automatisiert testbar (Optik, echtes ttyd). **Prüfkriterium vorher:** auf HA-Test (Task 11)
(a) Shift+Enter bricht in Claude um, ohne abzuschicken; (b) der Knopf ⏩ zeigt den Zustand und schaltet
um; (c) am Handy (≤ 700 px) zeigt er `off`/`on`/Uhrzeit statt des langen Texts. Lokal zusätzlich:
`index.html` wird vom Image-Service ausgeliefert und `workbench-ui.js` mit 200 (Test in Step 1).

**Files:**
- Modify: `claude-workbench/image-service/public/index.html`
- Test: `tests/test-image-service.js`

- [ ] **Step 1: Failing test** – in `tests/test-image-service.js` nach `test('the static UI is served at the root', …)`:

```js
test('the UI loads the panel helpers and has the auto-continue button', async () => {
    const html = await (await fetch(`http://127.0.0.1:${PORT}/`)).text();
    assert.match(html, /<script src="workbench-ui\.js"><\/script>/);
    assert.match(html, /id="auto-continue-btn"/);
    const js = await fetch(`http://127.0.0.1:${PORT}/workbench-ui.js`);
    assert.strictEqual(js.status, 200);
});
```

Run: `node --test --test-reporter=tap tests/test-image-service.js` → dieser Test FAIL.

- [ ] **Step 2: Knopf** – in `index.html` vor `<button id="link-btn" …>`:

```html
                <button id="auto-continue-btn" class="header-btn" title="Auto-continue after a usage limit">
                    <span>⏩</span>
                    <span class="btn-label">Auto-continue: ?</span>
                    <span class="btn-short">?</span>
                </button>
```

- [ ] **Step 3: CSS** – nach der Regel `#voice-btn.recording { … }`:

```css
        #auto-continue-btn.auto-on {
            background: #2e7d32;
        }

        #auto-continue-btn.auto-on:hover {
            background: #1b5e20;
        }

        .header-btn .btn-short {
            display: none;
        }
```

  und im Block `@media (max-width: 700px)` nach `.header-btn .btn-label { display: none; }`:

```css
            /* Auto-continue shows its state (off/on/15:01), not just an icon. */
            #auto-continue-btn {
                width: auto;
                padding: 0 8px;
            }

            .header-btn .btn-short {
                display: inline;
            }
```

- [ ] **Step 4: Skripte** – `<script src="terminal-clipboard.js"></script>` ergänzen zu:

```html
    <script src="terminal-clipboard.js"></script>
    <script src="workbench-ui.js"></script>
```

  In `loadTerminal()` die Zeile
  `iframe.addEventListener('load', () => installImagePaste(iframe));` ersetzen durch:

```js
            iframe.addEventListener('load', () => {
                installImagePaste(iframe);
                installTerminalKeys(iframe);
            });
```

  Nach der Funktion `installImagePaste` (vor `// Fixes mouse-selection copy …`) einfügen:

```js
        // Shift+Enter inserts a newline in Claude (public/workbench-ui.js).
        function installTerminalKeys(iframe) {
            let win;
            try { win = iframe.contentWindow; win.document; } catch { return; }
            ClaudeWorkbenchUi.installShiftEnter(win);
        }

        // --- Auto-continue after a usage limit (image-service/auto-continue.js) ---
        const autoContinueBtn = document.getElementById('auto-continue-btn');

        function renderAutoContinue(status) {
            const formatTime = (iso) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const label = ClaudeWorkbenchUi.autoContinueLabel(status, formatTime);
            autoContinueBtn.querySelector('.btn-label').textContent = label.text;
            autoContinueBtn.querySelector('.btn-short').textContent = label.short;
            autoContinueBtn.title = label.title;
            autoContinueBtn.classList.toggle('auto-on', label.on);
            autoContinueBtn.dataset.enabled = status && typeof status.enabled === 'boolean' ? String(status.enabled) : '';
        }

        async function refreshAutoContinue() {
            try {
                const res = await fetch('auto-continue');
                renderAutoContinue(res.ok ? await res.json() : null);
            } catch {
                renderAutoContinue(null);
            }
        }

        autoContinueBtn.addEventListener('click', async () => {
            // Unknown state (the last request failed): switch nothing, ask again.
            if (autoContinueBtn.dataset.enabled === '') return refreshAutoContinue();
            const enabled = autoContinueBtn.dataset.enabled !== 'true';
            try {
                const res = await fetch('auto-continue', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ enabled })
                });
                renderAutoContinue(res.ok ? await res.json() : null);
            } catch {
                renderAutoContinue(null);
            }
        });

        refreshAutoContinue();
        setInterval(refreshAutoContinue, 30000);
```

- [ ] **Step 5: GREEN**

Run: `node --test --test-reporter=tap tests/test-image-service.js && node tests/test-terminal-clipboard.js`
Expected: alle Einzeltests ok.

- [ ] **Step 6: Commit**

```bash
git add claude-workbench/image-service/public/index.html tests/test-image-service.js
git commit -m "feat: auto-continue button in the panel header, Shift+Enter wired up"
```

---

### Task 10: Doku, Version 3.4.0, Release-Notes

**Files:**
- Modify: `claude-workbench/config.yaml` (`version: "3.4.0"`), `README.md` (Badge `version-3.4.0`)
- Modify: `claude-workbench/CHANGELOG.md`, `claude-workbench/DOCS.md`, `claude-workbench/README.md`
- Create: `docs/release-notes-3.4.0.md`
- Modify: `docs/FORK-SURVEY-heytcass.md` (Tabelle „Umsetzungsstand“)

- [ ] **Step 1: Version** – `config.yaml` `version: "3.3.0"` → `"3.4.0"`; Repo-`README.md` Badge
  `version-3.3.0` → `version-3.4.0`. `bash tests/test-release-metadata.sh` → kein FAIL.

- [ ] **Step 2: CHANGELOG** – oben in `claude-workbench/CHANGELOG.md` nach `# Changelog`:

```markdown
## 3.4.0

### ✨ New Feature - Auto-continue after a usage limit
- **Opt-in, off by default** (`auto_continue`): when Claude reports a usage
  limit ("5-hour limit reached ∙ resets 3pm"), the app types `continue` into
  the Claude session one minute after the reset, so a long task goes on
  unattended (mattbsea, mattbsea's heytcass fork, commits `16847c88`,
  `533ae0ef`, `5924cd08`, `00e22fc0` - his message parser is used as is).
- **Switch it at runtime** with the new ⏩ button in the panel header (shows
  off/on and the planned time) or `auto-continue on|off|status` in the
  terminal; after a restart the option applies again.
- **Only where it is safe**: it types into a pane of the `claude` session
  only if Claude is the foreground program there and the limit message is
  still on screen, never twice for the same message.

### ✨ New Feature - Shift+Enter inserts a newline
- **Shift+Enter** no longer submits in the panel: it inserts a line break in
  Claude's input (backslash + Enter, which Claude Code understands in any
  terminal) (mattbsea, mattbsea's heytcass fork, commit `6e44e41f`).
```

- [ ] **Step 3: DOCS.md** – nach dem Abschnitt `### Pasted Images` (vor `**Example Configuration**:`):

```markdown
### Auto-Continue After a Usage Limit
- **Default**: `auto_continue: false`
- When Claude reports a usage limit, the app types `continue` into the Claude
  session one minute after the reset (up to 30 s later, it checks every 30 s)
- Switch it while the app runs with the ⏩ button in the panel header or
  `auto-continue on|off|status` in the terminal (in Claude: `!auto-continue on`);
  after a restart the option applies again
- It only types into a pane of the `claude` tmux session where Claude is the
  foreground program and the limit message is still on screen
- Claude then works on unattended - with `dangerously_skip_permissions` it
  also runs commands without asking
```

  Im Beispiel darunter nach `image_retention_days: 30` die Zeile `auto_continue: false` ergänzen.
  Wo `DOCS.md` Tastatur/Terminal-Bedienung beschreibt (Abschnitt mit „Click the link“, ca. Zeile 92),
  einen Punkt ergänzen: `- **Shift+Enter** inserts a new line in Claude's input instead of sending it.`

- [ ] **Step 4: App-README** – in `claude-workbench/README.md` in der Feature-Liste je eine Zeile für
  Shift+Enter und Auto-Continue (opt-in) ergänzen; im Abschnitt zur Sicherheit (enthält
  „every signed-in Home Assistant user“) einen Satz: „Auto-continue (off by default) lets Claude go on
  unattended after a usage limit; with `dangerously_skip_permissions` that includes commands.“

- [ ] **Step 5: Release-Notes** – `docs/release-notes-3.4.0.md` im Stil von
  `docs/release-notes-3.3.0.md` (zuerst lesen), Titel „3.4.0 — Auto-continue after a usage limit,
  Shift+Enter“, Inhalt aus dem CHANGELOG plus Abschnitt „Upgrade notes“: nichts zu tun, Auto-Continue
  ist aus; Credits wie im CHANGELOG.

- [ ] **Step 6: Survey** – in `docs/FORK-SURVEY-heytcass.md` Tabelle „Umsetzungsstand“ eine Zeile
  einfügen `| Shift+Enter, Auto-Continue nach Usage-Limit (Knopf, Befehl, Option) | mattbsea | ✅ 3.4.0 |`
  und in der Sammelzeile „offen“ „Shift+Enter (mattbsea), Auto-Continue (mattbsea)“ streichen.

- [ ] **Step 7: Prüfen und committen**

Run: `bash tests/test-release-metadata.sh && git ls-files --eol | grep -c "crlf\|mixed"`
Expected: kein FAIL, `0`.

```bash
git add claude-workbench/config.yaml README.md claude-workbench/CHANGELOG.md claude-workbench/DOCS.md claude-workbench/README.md docs/release-notes-3.4.0.md docs/FORK-SURVEY-heytcass.md
git commit -m "docs: 3.4.0 - auto-continue and Shift+Enter, credits to mattbsea"
```

---

### Task 11: Gesamtprüfung, Review, CI, HA-Test

- [ ] **Step 1: Alle lokalen Suiten** (mit TMPDIR/TMP/TEMP auf `.tmp`):
  `bash tests/test-release-metadata.sh`, `bash tests/test-persist-install.sh`,
  `bash tests/test-startup-timeouts.sh`, `bash tests/test-cpu-check.sh < /dev/null`,
  `bash tests/test-npm-cache.sh`, `bash tests/test-health-check.sh`, `bash tests/test-startup-order.sh`,
  `bash tests/test-claude-assets.sh`, `bash tests/test-auth-helper.sh`, `bash tests/test-image-retention.sh`,
  `bash tests/test-tmux-config.sh`, `bash tests/test-auto-continue-cmd.sh`,
  `node tests/test-terminal-clipboard.js`, `node --test tests/test-workbench-ui.js`,
  `node --test tests/test-auto-continue.js`,
  `PATH="/c/WINDOWS/system32:$PATH" node --test tests/test-app-migration.js`,
  `node --test --test-reporter=tap tests/test-image-service.js`. Ausgaben zeigen.
- [ ] **Step 2: Code-Review per Subagent** (`superpowers:requesting-code-review`) gegen Spec und Plan,
  Befunde über `superpowers:receiving-code-review` prüfen; Fixes mit Test und eigenem Commit.
- [ ] **Step 3: Push des Branches nur nach Freigabe im Chat**, CI abwarten
  (`gh run watch <id> --repo Eifel-Joe/claude-workbench --exit-status` im Hintergrund).
- [ ] **Step 4: Merge nach `main`, Push, HA-Test-Update** (nach Freigabe): `ha_manage_app check_updates`,
  dann `update`; App-Log prüfen (Start ohne `[auto-continue]`-Zeilen, da aus).
- [ ] **Step 5: Ende-zu-Ende auf HA-Test** laut Spec, Abschnitt „Ende-zu-Ende-Kriterium“, Punkte 1–4
  (User bedient Panel und Claude; ich lese App-Log per MCP). Ergebnisse in `docs/SESSION-STAND.md`.
- [ ] **Step 6: Release** (nach Freigabe): Tag `v3.4.0`, GitHub-Release „3.4.0 — Auto-continue after a
  usage limit, Shift+Enter“ mit `docs/release-notes-3.4.0.md`; HA-Prod-Update startet der User, danach
  Supervisor- und App-Log per MCP prüfen.
