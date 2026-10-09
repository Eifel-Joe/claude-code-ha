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
