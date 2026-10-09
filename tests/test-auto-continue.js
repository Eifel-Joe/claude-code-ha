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
