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

module.exports = { stripAnsi, detectLimit, parseResetTime, PaneWatcher };
