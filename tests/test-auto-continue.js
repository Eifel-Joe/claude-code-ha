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

// Claude's banners start their line; prose and tool output that mention a
// rate limit mid-line must not plan a "continue" into an idle Claude.
test('PaneWatcher ignores a rate limit mentioned in Claude\'s prose', () => {
    const w = new ac.PaneWatcher();
    const screen = '● The Shelly API answered HTTP 429 "rate limit reached" - I added a backoff.\n> ';
    assert.equal(w.observe(screen, T0), null);
    assert.equal(w.dueAt, null);
});

test('PaneWatcher ignores a rate limit in a tool\'s error line', () => {
    const w = new ac.PaneWatcher();
    assert.equal(w.observe('⎿  Error: rate limit reached\n> ', T0), null);
    assert.equal(w.dueAt, null);
});

test('PaneWatcher takes a banner behind Claude\'s output marker', () => {
    // What `!echo 'Claude usage limit reached. ...'` shows inside Claude.
    const w = new ac.PaneWatcher();
    const change = w.observe('⎿  Claude usage limit reached. Resets at 15:00 (UTC)\n> ', T0);
    assert.equal(change.type, 'scheduled');
    assert.equal(w.dueAt, Date.UTC(2026, 9, 9, 15, 1, 0));
});

test('PaneWatcher takes the "out of extra usage" banner', () => {
    const w = new ac.PaneWatcher();
    const change = w.observe("You're out of extra usage · resets 3pm (UTC)\n> ", T0);
    assert.equal(change.type, 'scheduled');
    assert.equal(w.dueAt, Date.UTC(2026, 9, 9, 15, 1, 0));
});

test('PaneWatcher reads the reset time from the banner, not from tool output', () => {
    const w = new ac.PaneWatcher();
    const change = w.observe('5-hour limit reached ∙ resets 3pm (UTC)\n⎿ curl: please try again in 2 seconds\n> ', T0);
    assert.equal(change.type, 'scheduled');
    assert.equal(change.matched, '5-hour limit reached');
    assert.equal(w.dueAt, Date.UTC(2026, 9, 9, 15, 1, 0));
});

test('PaneWatcher is not misled by "reset" in a shell line', () => {
    const w = new ac.PaneWatcher();
    w.observe('5-hour limit reached ∙ resets 3pm (UTC)\n$ git reset 4 files\n> ', T0);
    assert.equal(w.dueAt, Date.UTC(2026, 9, 9, 15, 1, 0));
});

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

// Fake tmux: one pane per entry of `screens` ({ '%0': { pid, screen } }).
// `onCall(args)` runs before each answer, to change things mid-poll.
function makeTmux(screens, onCall = () => {}) {
    const calls = [];
    const tmux = async (args) => {
        calls.push(args);
        onCall(args);
        if (args[0] === 'list-panes') {
            if (screens === null) throw new Error("can't find session: claude");
            return Object.entries(screens).map(([id, p]) => `${id} ${p.pid}`).join('\n') + '\n';
        }
        if (args[0] === 'capture-pane') return screens[args[args.length - 1]].screen;
        return '';
    };
    return { tmux, calls };
}

// `hooks.onCall(args, t)` is handed to the fake tmux (see makeTmux).
function makeController(screens, stats = PROC_CLAUDE, hooks = {}) {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-state-'));
    const procRoot = makeProc(stats);
    const clock = { now: T0 };
    const logs = [];
    let t = null;
    const fake = makeTmux(screens, (args) => { if (hooks.onCall && t) hooks.onCall(args, t); });
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
    t = { ctl, stateDir, clock, logs, calls: fake.calls, sends, cleanup };
    return t;
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

test('switching off while a poll waits for tmux plans nothing', async () => {
    let switchOff = true;
    const t = makeController({ '%0': { pid: 348, screen: RELATIVE } }, PROC_CLAUDE, {
        onCall: (args, tc) => {
            if (args[0] === 'capture-pane' && switchOff) {
                switchOff = false;
                tc.ctl.setEnabled(false);
            }
        },
    });
    try {
        t.ctl.setEnabled(true);
        await t.ctl.poll();
        assert.deepEqual(t.ctl.status(), { enabled: false, scheduled: [], lastSent: null });
        const text = fs.readFileSync(path.join(t.stateDir, 'auto-continue.status'), 'utf8');
        assert.ok(!text.includes('Will send'), text);
        const afterOff = t.logs.slice(t.logs.indexOf('off'));
        assert.ok(!afterOff.some((l) => l.startsWith('limit detected')), t.logs.join('\n'));

        // Back on, past the time the dropped plan would have been due: this
        // poll only plans afresh.
        t.ctl.setEnabled(true);
        t.clock.now = T0 + 6 * 3600000;
        await t.ctl.poll();
        assert.deepEqual(t.sends(), []);
        assert.deepEqual(t.ctl.status().scheduled,
            [{ pane: '%0', at: new Date(t.clock.now + 5 * 3600000 + 60000).toISOString() }]);
    } finally { t.cleanup(); }
});

test('the command\'s "off" written during a poll stops the remaining sends', async () => {
    let armed = false;
    const t = makeController({
        '%0': { pid: 348, screen: RELATIVE },
        '%1': { pid: 348, screen: RELATIVE },
    }, PROC_CLAUDE, {
        onCall: (args, tc) => {
            // Pane %0 is due and gets its "continue"; then the command
            // switches off (file only) before pane %1 is looked at.
            if (armed && args[0] === 'capture-pane' && args[args.length - 1] === '%1') {
                fs.writeFileSync(path.join(tc.stateDir, 'auto-continue'), 'off\n');
            }
        },
    });
    try {
        t.ctl.setEnabled(true);
        await t.ctl.poll();
        assert.equal(t.ctl.status().scheduled.length, 2);
        armed = true;
        t.clock.now = T0 + 6 * 3600000;
        await t.ctl.poll();
        assert.deepEqual(t.sends(), [
            ['send-keys', '-t', '%0', '-l', 'continue'],
            ['send-keys', '-t', '%0', 'Enter'],
        ]);
    } finally { t.cleanup(); }
});

test('status shows no plans once the command has switched off', async () => {
    const t = makeController({ '%0': { pid: 348, screen: RELATIVE } });
    try {
        t.ctl.setEnabled(true);
        await t.ctl.poll();
        assert.equal(t.ctl.status().scheduled.length, 1);
        fs.writeFileSync(path.join(t.stateDir, 'auto-continue'), 'off\n');
        assert.deepEqual(t.ctl.status(), { enabled: false, scheduled: [], lastSent: null });
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
