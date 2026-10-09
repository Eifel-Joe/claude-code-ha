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
