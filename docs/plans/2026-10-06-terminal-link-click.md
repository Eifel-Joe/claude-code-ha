# Klickbare umgebrochene Links — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein Klick auf eine beliebige Zeile eines hart umgebrochenen Links im ttyd-Terminal öffnet die vollständige URL.

**Architecture:** Spec: `docs/specs/2026-10-06-terminal-link-click-design.md`. Alles in `claude-terminal/image-service/public/terminal-clipboard.js`: (1) `joinRows` liefert optional eine Zeichen→Quelle-Zuordnung, `linkSpansInRows` macht daraus URL-Abschnitte je Zeile; (2) `install()` registriert einen xterm-Link-Provider; (3) `install()` hüllt `win.open`, damit das ttyd-WebLinksAddon in Zeile 1 die volle URL öffnet.

**Tech Stack:** Browser-JS (ES5, UMD-Modul ohne Build), xterm.js-API von ttyd 1.7.7, Tests als Node-Skript mit `assert` und handgebauten Fakes.

**Arbeitsregeln (aus Projekt):**
- Branch: `feat/terminal-link-click` (existiert, Spec ist committet).
- Testlauf: `node tests/test-terminal-clipboard.js` (eigenes Mini-Framework, kein Filter; Erfolg = letzte Zeile `All N clipboard bridge tests passed`, aktuell N = 80).
- Nach jedem Commit: `git ls-files --eol | grep -c "crlf\|mixed"` → `0`.
- Nach jedem Task per `git show` prüfen, dass Escapes (`\s`, `\/`, `\n`) exakt wie im Plan stehen.
- Nicht-triviale Kommentare nach Skill `code-doku`.

---

### Task 1: `cleanUrl` herauslösen und `linkSpansInRows`

**Files:**
- Modify: `claude-terminal/image-service/public/terminal-clipboard.js` (`joinRows` ~Z. 281–326, `findLastUrl` ~Z. 225–255, Export ~Z. 645)
- Test: `tests/test-terminal-clipboard.js` (neue Tests vor dem Block `(async () => {` am Dateiende einfügen)

- [x] **Step 1: Failing tests schreiben**

```js
// --- Clickable links: which cells belong to which rebuilt URL ---

test('a one-row link gets one span covering exactly the URL', () => {
    const line = 'see https://example.com/a. ok';
    const links = bridge.linkSpansInRows(rows([line]), 46);
    const start = line.indexOf('https');
    assert.deepStrictEqual(links, [{
        url: 'https://example.com/a',
        spans: [{ row: 0, start, end: start + 'https://example.com/a'.length }]
    }]);
});

test('every URL on a line is linked, not only the last', () => {
    const links = bridge.linkSpansInRows(rows(['https://a.example.com/x and https://b.example.com/y']), 80);
    assert.deepStrictEqual(links.map(l => l.url), ['https://a.example.com/x', 'https://b.example.com/y']);
});

test('a hard-wrapped link spans both rows, skipping the continuation indent', () => {
    const captured = rows([
        '  ⎿  $ echo "PROBE https://claude.ai/code/arti',
        '     fact/8f1aa329-c6ce-447f-a58c-bd14ce569558',
        '     END"'
    ]);
    const links = bridge.linkSpansInRows(captured, 46);
    assert.strictEqual(links.length, 1);
    assert.strictEqual(links[0].url, 'https://claude.ai/code/artifact/8f1aa329-c6ce-447f-a58c-bd14ce569558');
    assert.deepStrictEqual(links[0].spans, [
        { row: 0, start: captured[0].text.indexOf('https'), end: captured[0].text.length },
        { row: 1, start: 5, end: captured[1].text.length }
    ]);
});

test('a link broken at a slash spans the short row and the next', () => {
    const rendered = rows([
        '  https://claude.ai/code/artifact',
        '  /8f1aa329-c6ce-447f-a58c-bd14ce569558'
    ]);
    const links = bridge.linkSpansInRows(rendered, 46);
    assert.deepStrictEqual(links[0].spans, [
        { row: 0, start: 2, end: rendered[0].text.length },
        { row: 1, start: 2, end: rendered[1].text.length }
    ]);
});

test('a truncated link gets no spans', () => {
    assert.deepStrictEqual(bridge.linkSpansInRows(rows(['https://example.com/a?x=']), 46), []);
});

test('a link running into the last row read gets no spans - it may go on below', () => {
    const edge = rows(['● https://example.com/verylong'], 30);
    assert.strictEqual(edge[0].full, true, 'fixture must fill the row');
    assert.deepStrictEqual(bridge.linkSpansInRows(edge, 30), []);
});
```

- [x] **Step 2: Lauf → FAIL**

Run: `node tests/test-terminal-clipboard.js`
Expected: 6× `FAIL …` mit `bridge.linkSpansInRows is not a function`, Exit-Code 1.

- [x] **Step 3: Implementierung**

In `findLastUrl` die Bereinigung in eine eigene Funktion `cleanUrl` direkt davor verschieben. `findLastUrl` wird zu:

```js
    // Strip what a sentence or bracket put after the link, then judge it.
    // Returns {url, problem}; url is null when the candidate is not usable.
    function cleanUrl(raw) {
        // Checked before punctuation is stripped: "…" and "..." are how a TUI
        // says "cut off here", and stripping them first would turn a truncated
        // link into a plausible one. A single trailing dot is just a full stop.
        if (/(…|\.\.\.)$/.test(raw)) return { url: null, problem: 'truncated' };

        var url = raw.replace(TRAILING_PUNCTUATION, '');
        // A closing bracket belongs to the URL only if it was opened inside it,
        // so "(see http://x/a)" keeps the paren out but "http://x/a_(b)" keeps
        // it in.
        var pairs = { ')': '(', ']': '[', '}': '{' };
        while (url && pairs[url.charAt(url.length - 1)]) {
            var close = url.charAt(url.length - 1);
            var open = pairs[close];
            // Keep it when the URL opens at least as many as it closes.
            if (url.split(open).length >= url.split(close).length) break;
            url = url.slice(0, -1).replace(TRAILING_PUNCTUATION, '');
        }

        var problem = urlProblem(url);
        return problem ? { url: null, problem: problem } : { url: url, problem: null };
    }

    /**
     * The last usable URL in terminal text, or null.
     *
     * @param {string} text
     * @param {boolean} [reportProblem] return {url, problem} instead of a string
     */
    function findLastUrl(text, reportProblem) {
        var fail = function (problem) {
            return reportProblem ? { url: null, problem: problem } : null;
        };
        if (!text) return fail('none');
        var matches = text.match(URL_PATTERN);
        if (!matches) return fail('none');

        var cleaned = cleanUrl(matches[matches.length - 1]);
        if (cleaned.problem) return fail(cleaned.problem);
        return reportProblem ? cleaned : cleaned.url;
    }
```

`joinRows` bekommt einen vierten Parameter `withMap`. Signatur und Kommentar:

```js
    // Rebuild the lines the terminal broke into rows. Three splits, each with
    // its own trace: see CHANGELOG 2.1.0. The glue per boundary is nothing, one
    // space, or a line break. withMap adds, per line, where each character came
    // from ({row, col}, null for a glue space) - what a click needs to find
    // the rebuilt URL under the mouse.
    function joinRows(rows, cols, join, withMap) {
        var lines = [];
        var maps = [];
```

Im Schleifenende den bisherigen Block

```js
            if (glue === null) {
                lines.push(row.text);
            } else {
                lines[lines.length - 1] += glue + chunk;
            }
```

ersetzen durch

```js
            if (glue === null) {
                lines.push(row.text);
                if (withMap) maps.push(sourceMap(i, 0, row.text.length));
            } else {
                lines[lines.length - 1] += glue + chunk;
                if (withMap) {
                    var map = maps[maps.length - 1];
                    if (glue) map.push(null);
                    // chunk is row.text minus its indent.
                    var offset = row.text.length - chunk.length;
                    Array.prototype.push.apply(map, sourceMap(i, offset, chunk.length));
                }
            }
```

und die Rückgabe durch

```js
        return { lines: lines, lastRowFull: previousFull, maps: withMap ? maps : null };
```

Direkt nach `joinRows` einfügen:

```js
    function sourceMap(row, offset, length) {
        var map = [];
        for (var k = 0; k < length; k++) map.push({ row: row, col: offset + k });
        return map;
    }

    // Consecutive cells of one row become one span; end is exclusive.
    function spansFor(map, start, end) {
        var spans = [];
        var current = null;
        for (var k = start; k < end; k++) {
            var cell = map[k];
            if (!cell) continue;
            if (current && current.row === cell.row && current.end === cell.col) {
                current.end += 1;
            } else {
                current = { row: cell.row, start: cell.col, end: cell.col + 1 };
                spans.push(current);
            }
        }
        return spans;
    }

    /**
     * Every usable URL in the rows, rebuilt the way "Copy link" rebuilds it,
     * with the cells it occupies: [{url, spans: [{row, start, end}]}].
     * row indexes `rows`; start/end are 0-based columns, end exclusive.
     */
    function linkSpansInRows(rows, cols) {
        var joined = joinRows(rows, cols, true, true);
        var links = [];
        var last = joined.lines.length - 1;
        for (var i = 0; i <= last; i++) {
            var line = joined.lines[i];
            var pattern = new RegExp(URL_PATTERN.source, 'g');
            var match;
            while ((match = pattern.exec(line)) !== null) {
                var cleaned = cleanUrl(match[0]);
                if (!cleaned.url) continue;
                var end = match.index + cleaned.url.length;
                // Same rule as findLinkInRows' atEdge: still growing when the
                // rows ran out, so half a link - better none.
                if (i === last && joined.lastRowFull && end === line.length) continue;
                links.push({ url: cleaned.url, spans: spansFor(joined.maps[i], match.index, end) });
            }
        }
        return links;
    }
```

Im Export-Objekt am Dateiende nach `findLinkInRows: findLinkInRows,` ergänzen:

```js
        linkSpansInRows: linkSpansInRows,
```

- [x] **Step 4: Lauf → PASS**

Run: `node tests/test-terminal-clipboard.js`
Expected: letzte Zeile `All 86 clipboard bridge tests passed`.

- [x] **Step 5: Commit**

```bash
git add claude-terminal/image-service/public/terminal-clipboard.js tests/test-terminal-clipboard.js
git commit -m "feat(terminal): map rebuilt links back to the cells they occupy

A click lands on a cell, so making a wrapped link clickable needs to know
which rows and columns belong to which rebuilt URL. Reuses the Copy-link
reassembly; URL cleanup is shared instead of duplicated.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Link-Provider in `install()`

**Files:**
- Modify: `claude-terminal/image-service/public/terminal-clipboard.js` (`rawRows` ~Z. 153–178, `install` ~Z. 441 ff.)
- Test: `tests/test-terminal-clipboard.js` (`makeWindow` ~Z. 72–187, neue Tests)

- [x] **Step 1: Fakes erweitern**

In `makeWindow` in `state` ergänzen:

```js
        linkProviders: [],
        openCalls: [],
        windows: []
```

Im `win`-Objekt nach `navigator: {}` (Komma davor setzen):

```js
        // window.open as the WebLinksAddon uses it: no arguments, then set
        // opener and location on what comes back.
        open(...args) {
            state.openCalls.push(args);
            const opened = { opener: 'parent', location: { href: '' } };
            state.windows.push(opened);
            return opened;
        }
```

Im `win.term`-Objekt nach `onSelectionChange(...)`:

```js
        registerLinkProvider(provider) {
            state.linkProviders.push(provider);
            return { dispose() {} };
        },
```

- [x] **Step 2: Failing tests schreiben**

```js
const WRAPPED_LINK = [
    '  https://claude.ai/code/artifact',
    '  /8f1aa329-c6ce-447f-a58c-bd14ce569558'
];
const FULL_LINK = 'https://claude.ai/code/artifact/8f1aa329-c6ce-447f-a58c-bd14ce569558';

function provideLinks(env, bufferLineNumber) {
    let result = 'not called';
    env.state.linkProviders[0].provideLinks(bufferLineNumber, links => { result = links; });
    return result;
}

test('install registers one link provider', () => {
    const env = makeWindow({ buffer: WRAPPED_LINK, cols: 46 });
    bridge.install(env.win);
    assert.strictEqual(env.state.linkProviders.length, 1);
});

test('every row of a wrapped link is a link to the full URL', () => {
    const env = makeWindow({ buffer: WRAPPED_LINK, cols: 46 });
    bridge.install(env.win);

    const first = provideLinks(env, 1);
    assert.strictEqual(first.length, 1);
    assert.strictEqual(first[0].text, FULL_LINK);
    // xterm ranges: 1-based columns, end inclusive.
    assert.deepStrictEqual(first[0].range, {
        start: { x: 3, y: 1 }, end: { x: WRAPPED_LINK[0].length, y: 1 }
    });

    const second = provideLinks(env, 2);
    assert.strictEqual(second[0].text, FULL_LINK);
    assert.deepStrictEqual(second[0].range, {
        start: { x: 3, y: 2 }, end: { x: WRAPPED_LINK[1].length, y: 2 }
    });
});

test('a row without a link reports none', () => {
    const env = makeWindow({ buffer: ['plain output', 'more'], cols: 46 });
    bridge.install(env.win);
    assert.strictEqual(provideLinks(env, 1), undefined);
});

test('clicking a link opens the full URL with the opener cleared', () => {
    const env = makeWindow({ buffer: WRAPPED_LINK, cols: 46 });
    bridge.install(env.win);

    provideLinks(env, 2)[0].activate({}, FULL_LINK);
    assert.strictEqual(env.state.windows.length, 1);
    assert.strictEqual(env.state.windows[0].opener, null);
    assert.strictEqual(env.state.windows[0].location.href, FULL_LINK);
});

test('a terminal without registerLinkProvider still installs', () => {
    const env = makeWindow({ buffer: WRAPPED_LINK, cols: 46 });
    delete env.win.term.registerLinkProvider;
    assert.ok(bridge.install(env.win));
});
```

- [x] **Step 3: Lauf → FAIL**

Run: `node tests/test-terminal-clipboard.js`
Expected: `FAIL install registers one link provider` (0 ≠ 1) sowie FAIL der drei Tests, die `provideLinks` aufrufen (`Cannot read properties of undefined (reading 'provideLinks')`) — 4 FAIL; der Test ohne `registerLinkProvider` besteht schon. Exit-Code 1.

- [x] **Step 4: Implementierung**

`rawRows` auf eine Hilfsfunktion mit Pufferzeile `y` je Zeile umstellen:

```js
    /** The raw rows for a mode, each tagged with whether it filled the width. */
    function rawRows(term, mode) {
        var buffer = term.buffer.active;
        if (mode === 'all') return rowsBetween(term, 0, buffer.length - 1);
        if (mode === 'screen-down') return rowsBetween(term, buffer.viewportY, buffer.length - 1);
        // The rows currently on screen, wherever the viewport is scrolled.
        return rowsBetween(term, buffer.viewportY,
            Math.min(buffer.viewportY + term.rows - 1, buffer.length - 1));
    }

    // y is the 0-based buffer line, so a caller can map a row back to the
    // screen even where getLine() skipped one.
    function rowsBetween(term, from, to) {
        var buffer = term.buffer.active;
        var cols = term.cols;
        var rows = [];
        for (var y = from; y <= to; y++) {
            var line = buffer.getLine(y);
            if (!line) continue;
            var text = line.translateToString(true);
            rows.push({ text: text, full: text.length >= cols, wrapped: !!line.isWrapped, y: y });
        }
        return rows;
    }
```

Vor `function install(win, options)` einfügen:

```js
    // Rows read on each side of the hovered one. A login URL is a few hundred
    // characters; 40 rows hold it even in a 20-column pane.
    var LINK_WINDOW_ROWS = 40;

    // The WebLinksAddon's own way of opening a link: a blank window first, so
    // the opener can be cleared before the page loads.
    function openLink(win, open, url) {
        var opened = open.call(win);
        if (!opened) return;
        try { opened.opener = null; } catch (err) { /* Electron can throw */ }
        opened.location.href = url;
    }

    /**
     * Make every row of a wrapped link clickable. ttyd's WebLinksAddon only
     * joins rows xterm.js wrapped itself (isWrapped); Claude Code and tmux
     * break lines hard, so it links row 1 to a fragment and the rest not at
     * all. Registered after the addon, so on row 1 the addon still wins -
     * installOpenRedirect covers that row.
     *
     * @param open the frame's original window.open, never the redirect
     */
    function installLinkProvider(win, term, open) {
        if (typeof term.registerLinkProvider !== 'function') return;
        term.registerLinkProvider({
            provideLinks: function (bufferLineNumber, callback) {
                var y = bufferLineNumber - 1;
                var buffer = term.buffer.active;
                var rows = rowsBetween(term, Math.max(0, y - LINK_WINDOW_ROWS),
                    Math.min(buffer.length - 1, y + LINK_WINDOW_ROWS));
                var links = [];
                linkSpansInRows(rows, term.cols).forEach(function (link) {
                    link.spans.forEach(function (span) {
                        if (rows[span.row].y !== y) return;
                        links.push({
                            // xterm.js ranges: 1-based columns, end inclusive.
                            range: {
                                start: { x: span.start + 1, y: bufferLineNumber },
                                end: { x: span.end, y: bufferLineNumber }
                            },
                            text: link.url,
                            activate: function () { openLink(win, open, link.url); }
                        });
                    });
                });
                callback(links.length ? links : undefined);
            }
        });
    }
```

In `install()` direkt nach `installMobileInput(win, term);`:

```js
        installLinkProvider(win, term, win.open);
```

(Task 3 ersetzt `win.open` hier durch das gesicherte Original.)

- [x] **Step 5: Lauf → PASS**

Run: `node tests/test-terminal-clipboard.js`
Expected: `All 91 clipboard bridge tests passed`.

- [x] **Step 6: Commit**

```bash
git add claude-terminal/image-service/public/terminal-clipboard.js tests/test-terminal-clipboard.js
git commit -m "feat(terminal): make every row of a wrapped link clickable

ttyd's WebLinksAddon only joins rows xterm.js wrapped itself, so a login
URL that Claude Code or tmux broke across rows was a link to a fragment on
row 1 and nothing below. A link provider now links each row to the full,
rebuilt URL.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `window.open` für Zeile 1 umleiten

**Files:**
- Modify: `claude-terminal/image-service/public/terminal-clipboard.js` (neue Funktion vor `install`, Aufruf in `install`)
- Test: `tests/test-terminal-clipboard.js`

- [x] **Step 1: Failing tests schreiben**

```js
test("the addon's fragment on row 1 opens the full URL", () => {
    const env = makeWindow({ buffer: WRAPPED_LINK, cols: 46 });
    bridge.install(env.win);

    // Exactly what WebLinksAddon's handleLink does.
    const opened = env.win.open();
    opened.opener = null;
    opened.location.href = 'https://claude.ai/code/artifact';

    assert.strictEqual(env.state.windows.length, 1);
    assert.strictEqual(env.state.windows[0].opener, null);
    assert.strictEqual(env.state.windows[0].location.href, FULL_LINK);
});

test('a URL that is not the start of a rebuilt link is opened unchanged', () => {
    const env = makeWindow({ buffer: WRAPPED_LINK, cols: 46 });
    bridge.install(env.win);

    env.win.open().location.href = 'https://other.example.com/x';
    assert.strictEqual(env.state.windows[0].location.href, 'https://other.example.com/x');
});

test('a complete link is not stretched to a longer one that starts the same', () => {
    const env = makeWindow({
        buffer: ['https://example.com/a', 'https://example.com/ab'], cols: 80
    });
    bridge.install(env.win);

    // "/a" is a link of its own on screen, not a fragment of "/ab".
    env.win.open().location.href = 'https://example.com/a';
    assert.strictEqual(env.state.windows[0].location.href, 'https://example.com/a');
});

test('window.open with arguments goes straight through', () => {
    const env = makeWindow({ buffer: WRAPPED_LINK, cols: 46 });
    bridge.install(env.win);

    const opened = env.win.open('https://claude.ai/code/artifact', '_blank');
    assert.deepStrictEqual(env.state.openCalls, [['https://claude.ai/code/artifact', '_blank']]);
    assert.strictEqual(opened, env.state.windows[0]);
});

test('the link provider opens through the original window.open, not the redirect', () => {
    const env = makeWindow({ buffer: WRAPPED_LINK, cols: 46 });
    const original = env.win.open;
    let originalCalls = 0;
    env.win.open = function (...args) { originalCalls++; return original.apply(this, args); };
    const counted = env.win.open;
    bridge.install(env.win);
    assert.notStrictEqual(env.win.open, counted, 'open must be wrapped');

    provideLinks(env, 2)[0].activate({}, FULL_LINK);
    assert.strictEqual(originalCalls, 1);
    assert.strictEqual(env.state.windows[0].location.href, FULL_LINK);
});
```

- [x] **Step 2: Lauf → FAIL**

Run: `node tests/test-terminal-clipboard.js`
Expected: `FAIL the addon's fragment on row 1 opens the full URL` (href ist das Bruchstück) und `FAIL the link provider opens through the original window.open…` (`open must be wrapped`). Die beiden „unchanged/goes straight through"-Tests und der Längen-Test bestehen schon (heutiges Verhalten). Exit-Code 1.

- [x] **Step 3: Implementierung**

Vor `function install(win, options)` (nach `installLinkProvider`) einfügen:

```js
    // The rebuilt link that url is a proper start of, newest first as in
    // findLink, or url itself. A url that is a complete link on screen stays
    // as it is, even if a longer link happens to start the same way.
    function fullLinkFor(term, url) {
        var links = linkSpansInRows(rawRows(term, 'all'), term.cols);
        var i;
        for (i = 0; i < links.length; i++) {
            if (links[i].url === url) return url;
        }
        for (i = links.length - 1; i >= 0; i--) {
            var full = links[i].url;
            if (full.length > url.length && full.indexOf(url) === 0) return full;
        }
        return url;
    }

    /**
     * Row 1 of a wrapped link belongs to ttyd's WebLinksAddon: xterm.js asks
     * link providers in registration order and the addon came first. Its
     * handler calls window.open() with no arguments and then sets
     * location.href to the fragment it saw, so the fragment is swapped for the
     * rebuilt URL on its way in. Everything stays inside the click, so no
     * popup blocker steps in. Calls with arguments are not the addon's and go
     * through untouched. Rejected: disposing the addon via xterm.js private
     * fields (_core, _addonManager), which breaks silently on an update.
     *
     * @returns the original window.open, or null if there is none
     */
    function installOpenRedirect(win, term) {
        var originalOpen = win.open;
        if (typeof originalOpen !== 'function') return null;
        win.open = function () {
            if (arguments.length) return originalOpen.apply(win, arguments);
            var opened = originalOpen.call(win);
            if (!opened) return opened;
            return {
                get opener() { return opened.opener; },
                set opener(value) { opened.opener = value; },
                location: {
                    get href() { return opened.location.href; },
                    set href(url) { opened.location.href = fullLinkFor(term, url); }
                },
                close: function () { opened.close(); }
            };
        };
        return originalOpen;
    }
```

In `install()` die Zeile aus Task 2

```js
        installLinkProvider(win, term, win.open);
```

ersetzen durch

```js
        var originalOpen = installOpenRedirect(win, term);
        if (originalOpen) installLinkProvider(win, term, originalOpen);
```

- [x] **Step 4: Lauf → PASS**

Run: `node tests/test-terminal-clipboard.js`
Expected: `All 96 clipboard bridge tests passed`.

Hinweis: Der Test „a terminal without registerLinkProvider still installs" aus Task 2 muss weiter bestehen.

- [x] **Step 5: Commit**

```bash
git add claude-terminal/image-service/public/terminal-clipboard.js tests/test-terminal-clipboard.js
git commit -m "fix(terminal): open the full URL when row 1 of a wrapped link is clicked

xterm.js gives row 1 to ttyd's WebLinksAddon, which was registered first
and opens only the fragment it sees. Its window.open() call is now
redirected to the rebuilt URL; calls with arguments are left alone.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Echtes xterm.js im Browser (lokale Prüfung, kein Commit)

Kein ttyd unter Windows, daher ein Prüfstand mit dem echten xterm.js + WebLinksAddon, wie ttyd sie lädt. Prüft, was die Fakes nicht können: Provider-Reihenfolge, Klick-Aktivierung, `window.open`.

**Files:**
- Create (Scratchpad, nicht im Repo): `<scratchpad>/linktest/index.html`, Kopie von `terminal-clipboard.js` daneben

- [x] **Step 1: Prüfstand anlegen**

`index.html`:

```html
<!doctype html>
<html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/css/xterm.css">
<script src="https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/lib/xterm.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@xterm/addon-web-links@0.11.0/lib/addon-web-links.js"></script>
<script src="terminal-clipboard.js"></script>
</head><body style="margin:0">
<div id="t" style="width:470px;height:300px"></div>
<script>
  window.opened = [];
  // Record instead of opening tabs, keeping the addon's call shape.
  window.open = function () {
    var w = { opener: 'parent', location: { href: '' } };
    window.opened.push({ args: [].slice.call(arguments), win: w });
    return w;
  };
  var term = new Terminal({ cols: 46, rows: 10 });
  term.loadAddon(new WebLinksAddon.WebLinksAddon());
  term.open(document.getElementById('t'));
  window.term = term;
  term.write('  https://claude.ai/code/artifact\r\n  /8f1aa329-c6ce-447f-a58c-bd14ce569558\r\n');
  ClaudeTerminalClipboard.install(window);
</script></body></html>
```

Öffnen: im Browser-Pane als `file:///…/linktest/index.html` (kein Server nötig; die CDN-Skripte laden auch von `file://`). Falls `Terminal`/`WebLinksAddon` als globale Namen nicht existieren: Konsole lesen und die UMD-Namen anpassen, nicht raten.

- [x] **Step 2: Klicks prüfen**

Im Browser-Pane nacheinander auf Zeile 1 und Zeile 2 des Links klicken (Koordinaten aus Screenshot), danach per JavaScript `window.opened.map(o => o.win.location.href)` lesen.
Erwartet: zwei Einträge, beide `https://claude.ai/code/artifact/8f1aa329-c6ce-447f-a58c-bd14ce569558`, beide `opener === null`. Ergebnis im Chat zeigen.

Schlägt das fehl: STOP, `superpowers:systematic-debugging`, nicht raten.

---

### Task 5: Version, Changelog, Doku

**Files:**
- Modify: `claude-terminal/config.yaml` (`version: "2.2.0"` → `"2.2.1"`)
- Modify: `claude-terminal/CHANGELOG.md` (oben einfügen)
- Modify: `claude-terminal/DOCS.md` (Abschnitt „Copying Text Out of the Terminal", ~Z. 68–80)

- [x] **Step 1: Version** — in `claude-terminal/config.yaml` die Zeile `version:` auf `2.2.1` setzen (Anführungszeichen-Stil der Datei beibehalten).

- [x] **Step 2: CHANGELOG** — direkt unter `# Changelog` einfügen:

```markdown
## 2.2.1

### 🐛 Bug Fix - Clicking a wrapped link opened only part of it
- Claude Code and tmux break a long URL (such as the login link) across rows. The
  terminal's built-in link detection only joins rows it wrapped itself, so a click
  on the first row opened a cut-off URL and the other rows were not clickable.
- Every row of such a link is now clickable and opens the full URL, rebuilt the
  same way **🔗 Copy link** rebuilds it. Not with `tmux_mouse` enabled (clicks go to
  tmux then) and not by tapping on a phone - use **🔗 Copy link** there.

```

- [x] **Step 3: DOCS** — im Abschnitt „Copying Text Out of the Terminal" den Satz „There are four ways" durch „There are five ways" ersetzen und vor dem Punkt `**`🔗 Copy link`**` einfügen:

```markdown
- **Click the link** in the terminal (desktop, with `tmux_mouse` off): any row of
  a link that wraps over several rows opens the whole URL in a new tab.
```

Vorher prüfen, ob „four ways" wirklich so dasteht (`grep -n "four ways" claude-terminal/DOCS.md`); sonst Wortlaut an den tatsächlichen Text anpassen.

- [x] **Step 4: Prüfen**

Run:
```bash
node tests/test-terminal-clipboard.js | tail -1
bash tests/test-release-metadata.sh
git ls-files --eol | grep -c "crlf\|mixed"
```
Expected: `All 96 clipboard bridge tests passed`; Release-Metadaten-Test ohne Fehler (falls er unter Windows an Symlinks scheitert: Ausgabe zeigen, CI entscheidet); `0`.

- [x] **Step 5: Commit**

```bash
git add claude-terminal/config.yaml claude-terminal/CHANGELOG.md claude-terminal/DOCS.md
git commit -m "docs: release notes for 2.2.1

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Review, Push, Live-Test (je Schritt Freigabe im Chat)

- [x] **Step 1:** `superpowers:requesting-code-review` auf `main..feat/terminal-link-click`; Rückmeldungen über `superpowers:receiving-code-review`.
- [x] **Step 2:** ShellCheck ist nicht betroffen (keine Shell-Dateien geändert). `node tests/test-image-service.js` zusätzlich laufen lassen (liefert `public/` aus).
- [ ] **Step 3: Freigabe einholen**, dann Branch pushen und CI abwarten (ccd_pr-Tools, kein Polling per Hand). Merge nach `main` erst nach Freigabe.
- [ ] **Step 4: HA-Test** (nach Freigabe): App auf 2.2.1 aktualisieren (steht noch auf 2.1.0), Panel öffnen, in Claude `/login` aufrufen, erste, mittlere und letzte Zeile des Links anklicken. Kriterium: jeder Klick öffnet einen Tab mit exakt der URL, die „🔗 Copy link" liefert (Länge und Ende vergleichen und zeigen).
- [ ] **Step 5: HA-Prod** nur nach ausdrücklicher Freigabe, gleiches Kriterium.
- [ ] **Step 6:** Memory `claude-code-ha-followups` Punkt 2 aktualisieren, `docs/SESSION-STAND.md` anlegen/ergänzen.
