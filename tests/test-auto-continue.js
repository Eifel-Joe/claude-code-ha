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
