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

// The banner text if `line` is one of Claude's limit banners, else null.
// Claude's banners start their line ("5-hour limit reached…", "Claude usage
// limit reached…", "You're out of extra usage…", "You've hit your limit…",
// "Rate limit hit…", "Please try again in 5 hours"), at most behind a frame or
// output marker (⎿ ● │). detectLimit() matches anywhere, so Claude's prose or
// a tool's output mentioning a rate limit mid-line would plan a "continue"
// into an idle Claude. Accepted residual risk: a bare tool line that itself
// starts with e.g. "Rate limit reached" still counts.
function bannerMatch(line) {
    const body = line
        .replace(/^[^\p{L}\d]+/u, '')
        .replace(/^(?:Claude(?: AI)?|You.{0,3}re)\s+/i, '');
    for (const re of LIMIT_PATTERNS) {
        const m = body.match(re);
        if (m && m.index === 0) return m[0];
    }
    return null;
}

// Screen lines that carry a limit banner, trimmed.
function limitLines(text) {
    return text.split('\n').map((line) => line.trim()).filter((line) => bannerMatch(line) !== null);
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

        // Banner lines only: "try again in 2 seconds" from curl or a
        // "git reset 4 files" elsewhere on screen must not move the plan.
        const resetAt = parseResetTime(lines.join('\n'), nowMs);
        const wanted = resetAt !== null ? resetAt + RESUME_GRACE_MS : nowMs + FALLBACK_DELAY_MS;
        this.dueAt = Math.min(wanted, nowMs + MAX_WAIT_MS);
        this.pendingSig = sig;
        return {
            type: 'scheduled',
            dueAt: this.dueAt,
            matched: bannerMatch(lines[lines.length - 1]),
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

module.exports = {
    stripAnsi,
    detectLimit,
    parseResetTime,
    PaneWatcher,
    claudeInForeground,
    clock,
    createAutoContinue,
};
