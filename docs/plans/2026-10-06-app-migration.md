# App Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On first start, Claude Terminal Pro detects another installed Claude Terminal Pro app (the ESJavadex original) and, on first panel open, offers to take over Claude data, logins, packages and settings via a Supervisor partial backup; release as 2.2.0 together with the "App" wording.

**Architecture:** A small Node module set under `claude-terminal/scripts/app-migration/` (API client, paths, detect, apply, dialog, CLI). `run.sh` calls `cli.js detect` at startup; if an offer file exists, the tmux launch command runs `cli.js dialog` before Claude/the session picker. Tests use `node:test` against an in-process fake Supervisor that serves a backup fixture built with `tar`.

**Tech Stack:** Node 22 (in image; Node 24 locally/CI), `node:test`, global `fetch`, `tar` CLI, bash (`run.sh`), Supervisor REST API (v1 `/addons`, `/backups`).

**Spec:** `docs/specs/2026-10-06-app-migration-design.md`

**Commands:**
- Node suite: `node --test tests/test-app-migration.js` (locally in Git Bash: `PATH="/c/WINDOWS/system32:$PATH" node --test tests/test-app-migration.js` — Git's GNU tar reads `C:` in paths as a remote host; Linux/CI unaffected)
- Full suite (Linux/CI only — needs symlinks): `./tests/run-tests.sh`
- Release metadata check: `bash tests/test-release-metadata.sh`

---

## File Structure

| File | Responsibility |
|---|---|
| `claude-terminal/scripts/app-migration/paths.js` | All file locations under `MIGRATION_DATA_ROOT` (default `/data`) |
| `claude-terminal/scripts/app-migration/supervisor.js` | Supervisor API client: `get`, `post`, `download` |
| `claude-terminal/scripts/app-migration/detect.js` | Detection rules; writes `offer.json` |
| `claude-terminal/scripts/app-migration/apply.js` | Backup, download, extract, take over items, error rules |
| `claude-terminal/scripts/app-migration/dialog.js` | Pure `render` / `parseInput` for the selection window |
| `claude-terminal/scripts/app-migration/cli.js` | Entry point: `detect`, `dialog` |
| `claude-terminal/run.sh` | `detect_app_migration`, `with_migration_dialog`, wiring in `main`/`start_web_terminal` |
| `tests/fake-supervisor.js` | Fake Supervisor HTTP server + backup fixture builder |
| `tests/test-app-migration.js` | `node:test` suite |
| `tests/run-tests.sh` | runs the new suite |
| `tests/test-production-run.sh` | asserts `with_migration_dialog` |

`claude-terminal/Dockerfile` needs no change: `COPY scripts/ /opt/scripts/` already copies subdirectories, and the CLI is run with `node <file>`.

---

### Task 0: Verify backup format and API rights on HA-Test (gate)

Everything below assumes (a) an app with `hassio_role: manager` may create and download a partial backup, (b) the backup is a plain tar containing `<slug>.tar.gz`, (c) that inner archive holds the app's `/data` under `data/`, (d) a backup created without password is unencrypted. Verify before writing code.

**Result (2026-10-06, HA-Test, done):** all four hold. Outer tar: `6ef0b4d0_claude_terminal_pro.tar.gz` (no `./` prefix) and `./backup.json`. Inner `.tar.gz`, readable with `tar -tzf`: `./`, `./addon.json`, **`./image.tar`** (the locally built Docker image — backup was 671 MB), `data/…`. Consequence: extract **only `data`** from the inner archive (Task 4), and mention the backup size to the user (Task 6).

**Files:** none (manual, run by the user in the HA-Test panel → menu `8` bash)

- [ ] **Step 1: User runs in HA-Test (app `6ef0b4d0_claude_terminal_pro`):**

```bash
S=http://supervisor; H="Authorization: Bearer $SUPERVISOR_TOKEN"
self=$(curl -fsS -H "$H" $S/addons/self/info | jq -r .data.slug); echo "self=$self"
curl -fsS -H "$H" $S/addons | jq -r '.data.addons[] | "\(.slug) \(.state) \(.version)"'
bk=$(curl -fsS -H "$H" -H 'Content-Type: application/json' -X POST $S/backups/new/partial \
  -d "{\"name\":\"migration-format-check\",\"addons\":[\"$self\"],\"homeassistant\":false}" | jq -r .data.slug); echo "backup=$bk"
curl -fsS -H "$H" -o /tmp/bk.tar $S/backups/$bk/download && tar -tvf /tmp/bk.tar
inner=$(tar -tf /tmp/bk.tar | grep "$self.tar.gz"); echo "inner=$inner"
tar -xOf /tmp/bk.tar "$inner" | tar -tzf - | head -20
curl -fsS -H "$H" -X DELETE $S/backups/$bk >/dev/null && echo "test backup deleted"; rm -f /tmp/bk.tar
```

- [ ] **Step 2: Compare with the assumptions.** Expected: `backup=<hex>`, outer listing contains `backup.json` and `<self>.tar.gz` (possibly prefixed `./`), inner listing shows entries like `addon.json` and `data/home/.claude/...`.
  - If the inner archive is named differently or uses another prefix than `data/`, change `INNER_DATA_PREFIX` / `innerArchiveName()` in Task 4 and the fixture in Task 1 accordingly **before** implementing.
  - If the inner archive is not gzip-readable (encrypted SecureTar), stop and discuss — the design needs a password-less backup.
  - If any call returns 401/403, stop: the role assumption is wrong.

---

### Task 1: Fake Supervisor and backup fixture

**Files:**
- Create: `tests/fake-supervisor.js`
- Create: `tests/test-app-migration.js`

- [ ] **Step 1: Write `tests/fake-supervisor.js`**

```js
'use strict';
// In-process stand-in for the Home Assistant Supervisor API, plus a builder
// for a partial-backup tarball in the format verified on HA-Test (Task 0).
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { spawnSync } = require('node:child_process');

const SELF_SLUG = '6ef0b4d0_claude_terminal_pro';
const OLD_SLUG = 'a1b2c3d4_claude_terminal_pro';

function writeFile(file, content, mode) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  if (mode) fs.chmodSync(file, mode);
}

function tar(args, cwd) {
  const r = spawnSync('tar', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`tar ${args.join(' ')}: ${r.stderr}`);
}

// Builds <dir>/backup.tar containing <slug>.tar.gz whose data/ mirrors the old
// app's /data. Returns the path of backup.tar.
function buildBackupFixture(dir, slug = OLD_SLUG) {
  const app = path.join(dir, 'app');
  const data = path.join(app, 'data');
  writeFile(path.join(app, 'addon.json'), '{}');
  writeFile(path.join(data, 'home/.claude/projects/-config/memory/MEMORY.md'), '- [Heating](heating.md)\n');
  writeFile(path.join(data, 'home/.claude/projects/-config/memory/heating.md'), 'old memory\n');
  writeFile(path.join(data, 'home/.claude/CLAUDE.md'), 'old global instructions\n');
  writeFile(path.join(data, 'home/.claude/skills/shared/SKILL.md'), 'old skill\n');
  writeFile(path.join(data, 'home/.claude/.credentials.json'), '{"token":"old"}', 0o600);
  writeFile(path.join(data, 'home/.claude.json'), '{"oauthAccount":{"email":"x"}}');
  writeFile(path.join(data, '.config/gh/hosts.yml'), 'github.com:\n  user: old\n');
  writeFile(path.join(data, 'packages/python/venv/lib/python3.12/site-packages/requests-2.32.0.dist-info/METADATA'), '');
  writeFile(path.join(data, 'packages/python/venv/lib/python3.12/site-packages/pip-24.0.dist-info/METADATA'), '');
  // Mirrors the real layout from Task 0, including the image the app was built
  // from, which the migration must not unpack.
  writeFile(path.join(app, 'image.tar'), 'not a real image');
  tar(['-czf', path.join(dir, `${slug}.tar.gz`), '-C', app, 'addon.json', 'image.tar', 'data'], dir);
  writeFile(path.join(dir, 'backup.json'), '{}');
  tar(['-cf', path.join(dir, 'backup.tar'), '-C', dir, 'backup.json', `${slug}.tar.gz`], dir);
  return path.join(dir, 'backup.tar');
}

// opts: { apps, oldOptions, ownOptions, backupTar, failBackup, failStop }
function startFakeSupervisor(opts = {}) {
  const state = {
    calls: [],
    ownOptions: { ...(opts.ownOptions || {}) },
    stopped: [],
  };
  const apps = opts.apps || [
    { slug: SELF_SLUG, name: 'Claude Terminal Pro', version: '2.2.0', state: 'started' },
    { slug: OLD_SLUG, name: 'Claude Terminal Pro', version: '2.0.13', state: 'started' },
  ];
  const ok = (res, data = {}) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ result: 'ok', data }));
  };
  const err = (res, code, message) => {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ result: 'error', message }));
  };
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const json = body ? JSON.parse(body) : undefined;
      state.calls.push({ method: req.method, url: req.url, body: json });
      if (req.headers.authorization !== 'Bearer test-token') return err(res, 401, 'unauthorized');
      const m = `${req.method} ${req.url}`;
      if (m === 'GET /addons') return ok(res, { addons: apps });
      if (m === 'GET /addons/self/info') return ok(res, { slug: SELF_SLUG, options: state.ownOptions });
      if (m === `GET /addons/${OLD_SLUG}/info`) {
        return ok(res, { slug: OLD_SLUG, name: 'Claude Terminal Pro', version: '2.0.13',
          repository: 'esjavadex', options: opts.oldOptions || {} });
      }
      if (m === 'POST /backups/new/partial') {
        if (opts.failBackup) return err(res, 500, 'backup failed');
        return ok(res, { slug: 'bk1' });
      }
      if (m === 'GET /backups/bk1/download') {
        res.writeHead(200, { 'Content-Type': 'application/x-tar' });
        return fs.createReadStream(opts.backupTar).pipe(res);
      }
      if (m === 'POST /addons/self/options') { state.ownOptions = json.options; return ok(res); }
      if (m === `POST /addons/${OLD_SLUG}/stop`) {
        if (opts.failStop) return err(res, 500, 'stop failed');
        state.stopped.push(OLD_SLUG); return ok(res);
      }
      return err(res, 404, `unexpected ${m}`);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        url: `http://127.0.0.1:${server.address().port}`,
        state,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

module.exports = { buildBackupFixture, startFakeSupervisor, SELF_SLUG, OLD_SLUG };
```

- [ ] **Step 2: Write the first test in `tests/test-app-migration.js`**

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { buildBackupFixture, startFakeSupervisor, SELF_SLUG, OLD_SLUG } = require('./fake-supervisor');

const MOD = path.join(__dirname, '..', 'claude-terminal', 'scripts', 'app-migration');

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'mig-')); }

test('fixture: backup.tar holds the old app archive with data/', () => {
  const dir = tmp();
  const tarPath = buildBackupFixture(dir);
  const outer = spawnSync('tar', ['-tf', tarPath], { encoding: 'utf8' }).stdout;
  assert.match(outer, new RegExp(`${OLD_SLUG}\\.tar\\.gz`));
  const inner = spawnSync('tar', ['-tzf', path.join(dir, `${OLD_SLUG}.tar.gz`)], { encoding: 'utf8' }).stdout;
  assert.match(inner, /^data\/home\/\.claude\/CLAUDE\.md$/m);
  assert.match(inner, /^image\.tar$/m);
});
```

- [ ] **Step 3: Run:** `node --test tests/test-app-migration.js` — Expected: 1 test PASS (this task only builds test infrastructure; the fixture test guards it).

- [ ] **Step 4: Commit**

```bash
git add tests/fake-supervisor.js tests/test-app-migration.js
git commit -m "test: fake Supervisor and partial-backup fixture for app migration"
```

---

### Task 2: Paths and Supervisor client

**Files:**
- Create: `claude-terminal/scripts/app-migration/paths.js`
- Create: `claude-terminal/scripts/app-migration/supervisor.js`
- Test: `tests/test-app-migration.js`

- [ ] **Step 1: Append failing tests**

```js
const { migrationPaths } = require(path.join(MOD, 'paths'));
const { createClient } = require(path.join(MOD, 'supervisor'));

test('paths: everything lives under MIGRATION_DATA_ROOT', () => {
  const p = migrationPaths({ MIGRATION_DATA_ROOT: '/x' });
  assert.equal(p.home, path.join('/x', 'home'));
  assert.equal(p.offer, path.join('/x', 'migration', 'offer.json'));
  assert.equal(p.state, path.join('/x', 'migration', 'state'));
  assert.equal(p.work, path.join('/x', 'migration', 'work'));
});

test('client: get/post return data, errors throw, download writes the file', async () => {
  const dir = tmp();
  const sup = await startFakeSupervisor({ backupTar: buildBackupFixture(dir) });
  try {
    const client = createClient({ baseUrl: sup.url, token: 'test-token' });
    assert.equal((await client.get('/addons/self/info')).slug, SELF_SLUG);
    assert.equal((await client.post('/backups/new/partial', {})).slug, 'bk1');
    await assert.rejects(client.get('/nope'), /404/);
    const out = path.join(dir, 'dl.tar');
    await client.download('/backups/bk1/download', out);
    assert.equal(fs.statSync(out).size, fs.statSync(path.join(dir, 'backup.tar')).size);
    await assert.rejects(createClient({ baseUrl: sup.url, token: 'bad' }).get('/addons'), /401/);
  } finally { await sup.close(); }
});
```

- [ ] **Step 2: Run:** `node --test tests/test-app-migration.js` — Expected: FAIL, `Cannot find module '.../paths'`.

- [ ] **Step 3: Write `paths.js`**

```js
'use strict';
const path = require('node:path');

// Every file the migration touches, rooted at MIGRATION_DATA_ROOT so tests can
// run against a temp directory instead of the app's /data.
function migrationPaths(env = process.env) {
  const dataRoot = env.MIGRATION_DATA_ROOT || '/data';
  const dir = path.join(dataRoot, 'migration');
  return {
    dataRoot,
    home: path.join(dataRoot, 'home'),
    dir,
    offer: path.join(dir, 'offer.json'),
    state: path.join(dir, 'state'),
    work: path.join(dir, 'work'),
  };
}

module.exports = { migrationPaths };
```

- [ ] **Step 4: Write `supervisor.js`**

```js
'use strict';
const fs = require('node:fs');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');

// Minimal Supervisor API client. Responses are {result: "ok", data: {...}};
// anything else throws with the HTTP status and Supervisor's message.
function createClient({
  baseUrl = process.env.SUPERVISOR_API || 'http://supervisor',
  token = process.env.SUPERVISOR_TOKEN || '',
} = {}) {
  const auth = { Authorization: `Bearer ${token}` };

  async function call(method, path, body) {
    const res = await fetch(baseUrl + path, {
      method,
      headers: body ? { ...auth, 'Content-Type': 'application/json' } : auth,
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.result !== 'ok') {
      throw new Error(`${method} ${path} -> ${res.status} ${json.message || ''}`.trim());
    }
    return json.data || {};
  }

  // Streams to disk: a backup can be hundreds of MB.
  async function download(path, dest) {
    const res = await fetch(baseUrl + path, { headers: auth });
    if (!res.ok || !res.body) throw new Error(`GET ${path} -> ${res.status}`);
    await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(dest));
  }

  return {
    get: (path) => call('GET', path),
    post: (path, body) => call('POST', path, body || {}),
    download,
  };
}

module.exports = { createClient };
```

- [ ] **Step 5: Run:** `node --test tests/test-app-migration.js` — Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add claude-terminal/scripts/app-migration/paths.js claude-terminal/scripts/app-migration/supervisor.js tests/test-app-migration.js
git commit -m "feat(migration): paths and Supervisor API client"
```

---

### Task 3: Detection

**Files:**
- Create: `claude-terminal/scripts/app-migration/detect.js`
- Test: `tests/test-app-migration.js`

- [ ] **Step 1: Append failing tests**

```js
const { detect } = require(path.join(MOD, 'detect'));

async function withSupervisor(opts, fn) {
  const dir = tmp();
  const sup = await startFakeSupervisor({ backupTar: buildBackupFixture(dir), ...opts });
  const p = migrationPaths({ MIGRATION_DATA_ROOT: path.join(dir, 'data') });
  fs.mkdirSync(path.join(p.home, '.claude', 'skills'), { recursive: true }); // what init_environment creates
  try { return await fn(createClient({ baseUrl: sup.url, token: 'test-token' }), p, sup); }
  finally { await sup.close(); }
}

const OLD_OPTIONS = {
  auto_launch_claude: false, dangerously_skip_permissions: true, tmux_mouse: false,
  use_persistent_claude: false, auto_update_claude_on_start: false,
  persistent_apk_packages: ['htop', ' '], persistent_pip_packages: ['httpx'],
};

test('detect: offers the old app with its packages and settings', async () => {
  await withSupervisor({ oldOptions: OLD_OPTIONS }, async (client, p) => {
    const r = await detect(client, p);
    assert.equal(r.offered, true);
    const offer = JSON.parse(fs.readFileSync(p.offer, 'utf8'));
    assert.equal(offer.slug, OLD_SLUG);
    assert.equal(offer.version, '2.0.13');
    assert.deepEqual(offer.apk, ['htop']);
    assert.deepEqual(offer.pip, ['httpx']);
    assert.deepEqual(offer.settings, { auto_launch_claude: false, dangerously_skip_permissions: true, tmux_mouse: false });
  });
});

test('detect: no offer without another Claude Terminal Pro app', async () => {
  const apps = [{ slug: SELF_SLUG, state: 'started' }, { slug: 'core_samba', state: 'started' }];
  await withSupervisor({ apps }, async (client, p) => {
    assert.deepEqual(await detect(client, p), { offered: false, reason: 'no-old-app' });
    assert.equal(fs.existsSync(p.offer), false);
  });
});

test('detect: no offer when this app already has Claude data', async () => {
  await withSupervisor({}, async (client, p) => {
    fs.mkdirSync(path.join(p.home, '.claude', 'projects', '-config'), { recursive: true });
    assert.equal((await detect(client, p)).reason, 'own-data');
  });
  await withSupervisor({}, async (client, p) => {
    fs.writeFileSync(path.join(p.home, '.claude', '.credentials.json'), '{}');
    assert.equal((await detect(client, p)).reason, 'own-data');
  });
});

test('detect: no offer once done or declined', async () => {
  for (const s of ['done', 'never']) {
    await withSupervisor({}, async (client, p) => {
      fs.mkdirSync(p.dir, { recursive: true });
      fs.writeFileSync(p.state, `${s}\n`);
      assert.equal((await detect(client, p)).reason, 'state');
    });
  }
});

test('detect: prefers a running old app over a stopped one', async () => {
  const apps = [
    { slug: SELF_SLUG, state: 'started' },
    { slug: 'ffff0000_claude_terminal_pro', state: 'stopped' },
    { slug: OLD_SLUG, state: 'started' },
  ];
  await withSupervisor({ apps }, async (client, p) => {
    assert.equal((await detect(client, p)).offer.slug, OLD_SLUG);
  });
});
```

- [ ] **Step 2: Run:** `node --test tests/test-app-migration.js` — Expected: FAIL, `Cannot find module '.../detect'`.

- [ ] **Step 3: Write `detect.js`**

```js
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const OLD_SLUG_SUFFIX = '_claude_terminal_pro';
// Options worth carrying over. use_persistent_claude/auto_update_claude_on_start
// are deliberately left out: off in the old app, they froze the Claude version.
const SETTING_KEYS = [
  'auto_launch_claude', 'dangerously_skip_permissions', 'tmux_mouse',
  'remote_control', 'remote_control_session_name',
];

function readState(p) {
  try { return fs.readFileSync(p.state, 'utf8').trim(); } catch { return ''; }
}

// init_environment always creates ~/.claude (skills, commands), so its mere
// existence says nothing; a login or a project history does.
function hasOwnClaudeData(p) {
  if (fs.existsSync(path.join(p.home, '.claude', '.credentials.json'))) return true;
  const projects = path.join(p.home, '.claude', 'projects');
  return fs.existsSync(projects) && fs.readdirSync(projects).length > 0;
}

function listOption(value) {
  return Array.isArray(value)
    ? value.filter((v) => typeof v === 'string' && v.trim()).map((v) => v.trim())
    : [];
}

function pickOldApp(apps, selfSlug) {
  const candidates = apps.filter((a) => a.slug !== selfSlug && a.slug.endsWith(OLD_SLUG_SUFFIX));
  return candidates.find((a) => a.state === 'started') || candidates[0] || null;
}

async function detect(client, p) {
  if (['done', 'never'].includes(readState(p))) return { offered: false, reason: 'state' };
  if (hasOwnClaudeData(p)) return { offered: false, reason: 'own-data' };

  const self = await client.get('/addons/self/info');
  const { addons = [] } = await client.get('/addons');
  const old = pickOldApp(addons, self.slug);
  if (!old) return { offered: false, reason: 'no-old-app' };

  const info = await client.get(`/addons/${old.slug}/info`);
  const options = info.options || {};
  const offer = {
    slug: old.slug,
    name: info.name || old.name || old.slug,
    version: info.version || old.version || '',
    repository: info.repository || '',
    apk: listOption(options.persistent_apk_packages),
    pip: listOption(options.persistent_pip_packages),
    settings: Object.fromEntries(SETTING_KEYS.filter((k) => k in options).map((k) => [k, options[k]])),
  };
  fs.mkdirSync(p.dir, { recursive: true });
  fs.writeFileSync(p.offer, `${JSON.stringify(offer, null, 2)}\n`);
  return { offered: true, offer };
}

module.exports = { detect, hasOwnClaudeData, SETTING_KEYS };
```

- [ ] **Step 4: Run:** `node --test tests/test-app-migration.js` — Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add claude-terminal/scripts/app-migration/detect.js tests/test-app-migration.js
git commit -m "feat(migration): detect another Claude Terminal Pro app on first start"
```

---

### Task 4: Apply — backup, Claude data, login, gh

**Files:**
- Create: `claude-terminal/scripts/app-migration/apply.js`
- Test: `tests/test-app-migration.js`

- [ ] **Step 1: Append failing tests**

```js
const { apply } = require(path.join(MOD, 'apply'));

async function detectThenApply(opts, selected, deps = {}) {
  return withSupervisor({ oldOptions: OLD_OPTIONS, ...opts }, async (client, p, sup) => {
    const { offer } = await detect(client, p);
    const result = await apply(client, p, offer, selected,
      { today: '2026-10-06', persistInstall: deps.persistInstall || 'false-bin', ...deps });
    return { result, p, sup };
  });
}

test('apply: creates a named partial backup of only the old app', async () => {
  const { sup } = await detectThenApply({}, []);
  const call = sup.state.calls.find((c) => c.url === '/backups/new/partial');
  assert.deepEqual(call.body, {
    name: 'Claude Terminal Pro – Übernahme 2026-10-06', addons: [OLD_SLUG], homeassistant: false,
  });
});

test('apply: Claude data without the login file', async () => {
  const { result, p } = await detectThenApply({}, ['claude']);
  assert.equal(result.results.claude, 'ok');
  assert.equal(fs.readFileSync(path.join(p.home, '.claude/projects/-config/memory/heating.md'), 'utf8'), 'old memory\n');
  assert.equal(fs.readFileSync(path.join(p.home, '.claude/CLAUDE.md'), 'utf8'), 'old global instructions\n');
  assert.ok(fs.existsSync(path.join(p.home, '.claude.json')));
  assert.equal(fs.existsSync(path.join(p.home, '.claude/.credentials.json')), false);
});

test('apply: login and gh only when selected', async () => {
  const { result, p } = await detectThenApply({}, ['login', 'gh']);
  assert.equal(result.results.login, 'ok');
  assert.equal(result.results.gh, 'ok');
  assert.equal(fs.readFileSync(path.join(p.home, '.claude/.credentials.json'), 'utf8'), '{"token":"old"}');
  assert.ok(fs.existsSync(path.join(p.dataRoot, '.config/gh/hosts.yml')));
  assert.equal(fs.existsSync(path.join(p.home, '.claude/CLAUDE.md')), false);
});

test('apply: never overwrites files this app already has', async () => {
  await withSupervisor({ oldOptions: OLD_OPTIONS }, async (client, p) => {
    const { offer } = await detect(client, p);
    fs.mkdirSync(path.join(p.home, '.claude/skills/shared'), { recursive: true });
    fs.writeFileSync(path.join(p.home, '.claude/skills/shared/SKILL.md'), 'new skill\n');
    await apply(client, p, offer, ['claude'], { today: '2026-10-06', persistInstall: 'false-bin' });
    assert.equal(fs.readFileSync(path.join(p.home, '.claude/skills/shared/SKILL.md'), 'utf8'), 'new skill\n');
  });
});

test('apply: backup failure takes over nothing and stops nothing', async () => {
  const { result, p, sup } = await detectThenApply({ failBackup: true }, ['claude', 'login', 'stop']);
  assert.equal(result.ok, false);
  assert.match(result.fatal, /backup/);
  assert.equal(fs.existsSync(path.join(p.home, '.claude/CLAUDE.md')), false);
  assert.deepEqual(sup.state.stopped, []);
  assert.equal(fs.existsSync(p.state), false);
});

test('apply: unpacks only data/, not the app image', async () => {
  await withSupervisor({ oldOptions: OLD_OPTIONS }, async (client, p) => {
    const { offer } = await detect(client, p);
    await apply(client, p, offer, ['claude'], { today: '2026-10-06', persistInstall: 'false-bin', keepWork: true });
    assert.ok(fs.existsSync(path.join(p.work, 'app', 'data', 'home', '.claude')));
    assert.equal(fs.existsSync(path.join(p.work, 'app', 'image.tar')), false);
  });
});

test('apply: success marks done, removes the offer and the work dir', async () => {
  const { result, p } = await detectThenApply({}, ['claude']);
  assert.equal(result.ok, true);
  assert.equal(fs.readFileSync(p.state, 'utf8').trim(), 'done');
  assert.equal(fs.existsSync(p.offer), false);
  assert.equal(fs.existsSync(p.work), false);
});
```

- [ ] **Step 2: Run:** `node --test tests/test-app-migration.js` — Expected: FAIL, `Cannot find module '.../apply'`.

- [ ] **Step 3: Write `apply.js` (items `claude`, `login`, `gh`; `packages`, `settings`, `stop` follow in Task 5)**

```js
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// Verified on HA-Test (plan Task 0): the partial backup is a tar holding
// <slug>.tar.gz, whose data/ is the app's /data. That archive also carries
// image.tar, the locally built Docker image (hundreds of MB), so only data/ is
// extracted.
const INNER_DATA_PREFIX = 'data';
const innerArchiveName = (slug) => `${slug}.tar.gz`;

function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed: ${(r.stderr || '').trim()}`);
}

function today() { return new Date().toISOString().slice(0, 10); }

async function fetchOldData(client, offer, p, date) {
  const { slug } = await client.post('/backups/new/partial', {
    name: `Claude Terminal Pro – Übernahme ${date}`,
    addons: [offer.slug],
    homeassistant: false,
  });
  fs.rmSync(p.work, { recursive: true, force: true });
  fs.mkdirSync(p.work, { recursive: true });
  const outer = path.join(p.work, 'backup.tar');
  await client.download(`/backups/${slug}/download`, outer);
  run('tar', ['-xf', outer, '-C', p.work]);
  const inner = path.join(p.work, innerArchiveName(offer.slug));
  if (!fs.existsSync(inner)) throw new Error(`backup has no ${innerArchiveName(offer.slug)}`);
  const extracted = path.join(p.work, 'app');
  fs.mkdirSync(extracted);
  run('tar', ['-xzf', inner, '-C', extracted, INNER_DATA_PREFIX]);
  return { backupSlug: slug, oldData: path.join(extracted, INNER_DATA_PREFIX) };
}

// Copies src to dst without replacing anything that already exists there.
// Returns false when the source does not exist.
function copyMissing(src, dst, filter) {
  if (!fs.existsSync(src)) return false;
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.cpSync(src, dst, { recursive: true, force: false, errorOnExist: false, filter });
  return true;
}

async function apply(client, p, offer, selected, deps = {}) {
  const results = {};
  let old;
  try {
    old = await fetchOldData(client, offer, p, deps.today || today());
  } catch (e) {
    fs.rmSync(p.work, { recursive: true, force: true });
    return { ok: false, fatal: e.message, results };
  }
  const oldHome = path.join(old.oldData, 'home');

  async function step(name, fn) {
    if (!selected.includes(name)) return;
    // A step may return a status string ('not found'); anything else (API
    // responses, undefined) counts as 'ok', so results stay plain strings.
    try {
      const r = await fn();
      results[name] = typeof r === 'string' ? r : 'ok';
    } catch (e) { results[name] = `error: ${e.message}`; }
  }

  await step('claude', () => {
    copyMissing(path.join(oldHome, '.claude'), path.join(p.home, '.claude'),
      (src) => path.basename(src) !== '.credentials.json');
    copyMissing(path.join(oldHome, '.claude.json'), path.join(p.home, '.claude.json'));
  });
  await step('login', () => (copyMissing(path.join(oldHome, '.claude', '.credentials.json'),
    path.join(p.home, '.claude', '.credentials.json')) ? 'ok' : 'not found'));
  await step('gh', () => (copyMissing(path.join(old.oldData, '.config', 'gh'),
    path.join(p.dataRoot, '.config', 'gh')) ? 'ok' : 'not found'));

  if (!deps.keepWork) fs.rmSync(p.work, { recursive: true, force: true }); // keepWork: tests only
  fs.writeFileSync(p.state, 'done\n');
  fs.rmSync(p.offer, { force: true });
  return { ok: true, backupSlug: old.backupSlug, results };
}

module.exports = { apply };
```

- [ ] **Step 4: Run:** `node --test tests/test-app-migration.js` — Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add claude-terminal/scripts/app-migration/apply.js tests/test-app-migration.js
git commit -m "feat(migration): take over Claude data, login and gh from a partial backup"
```

---

### Task 5: Apply — packages, settings, stop

**Files:**
- Modify: `claude-terminal/scripts/app-migration/apply.js`
- Test: `tests/test-app-migration.js`

- [ ] **Step 1: Append failing tests**

```js
// A persist-install stand-in that logs its arguments and fails for "badpkg".
function fakePersistInstall(dir) {
  const log = path.join(dir, 'persist.log');
  const bin = path.join(dir, 'persist-install.js');
  fs.writeFileSync(bin, `require('fs').appendFileSync(${JSON.stringify(log)}, process.argv.slice(2).join(' ') + '\\n');
process.exit(process.argv.includes('badpkg') ? 1 : 0);\n`);
  return { log, deps: { persistInstall: process.execPath, persistInstallArgs: [bin] } };
}

test('apply: reinstalls packages from old options plus the old venv, records them', async () => {
  const fake = fakePersistInstall(tmp());
  const { result, sup } = await detectThenApply({ ownOptions: { persistent_apk_packages: ['git'] } }, ['packages'], fake.deps);
  assert.equal(result.results.packages, 'ok');
  assert.deepEqual(fs.readFileSync(fake.log, 'utf8').trim().split('\n'), ['htop', '--python httpx', '--python requests']);
  assert.deepEqual(sup.state.ownOptions.persistent_apk_packages, ['git', 'htop']);
  assert.deepEqual(sup.state.ownOptions.persistent_pip_packages, ['httpx', 'requests']);
});

test('apply: settings are merged into this app\'s options, excluded keys untouched', async () => {
  const own = { auto_launch_claude: true, use_persistent_claude: true, auto_update_claude_on_start: true };
  const { result, sup } = await detectThenApply({ ownOptions: own }, ['settings']);
  assert.equal(result.results.settings, 'ok');
  assert.deepEqual(sup.state.ownOptions, {
    auto_launch_claude: false, dangerously_skip_permissions: true, tmux_mouse: false,
    use_persistent_claude: true, auto_update_claude_on_start: true,
  });
});

test('apply: stops the old app last when everything succeeded', async () => {
  const { result, sup } = await detectThenApply({}, ['claude', 'stop']);
  assert.equal(result.results.stop, 'ok');
  assert.deepEqual(sup.state.stopped, [OLD_SLUG]);
  assert.equal(sup.state.calls.at(-1).url, `/addons/${OLD_SLUG}/stop`);
});

test('apply: a failed item keeps the old app running', async () => {
  const fake = fakePersistInstall(tmp());
  const oldOptions = { ...OLD_OPTIONS, persistent_apk_packages: ['badpkg'] };
  const { result, sup } = await detectThenApply({ oldOptions }, ['claude', 'packages', 'stop'], fake.deps);
  assert.match(result.results.packages, /^error: .*badpkg/);
  assert.equal(result.results.claude, 'ok');
  assert.match(result.results.stop, /^skipped/);
  assert.deepEqual(sup.state.stopped, []);
});
```

- [ ] **Step 2: Run:** `node --test tests/test-app-migration.js` — Expected: the four new tests FAIL (`results.packages` etc. undefined).

- [ ] **Step 3: Extend `apply.js`** — add helpers above `apply` and the three steps before the cleanup block:

```js
const PIP_BOOTSTRAP = new Set(['pip', 'setuptools', 'wheel']);
const unique = (list) => [...new Set(list)];

// Package names from the old venv's *.dist-info directories.
function pipNamesFromVenv(oldData) {
  const lib = path.join(oldData, 'packages', 'python', 'venv', 'lib');
  if (!fs.existsSync(lib)) return [];
  const names = [];
  for (const py of fs.readdirSync(lib)) {
    const sitePackages = path.join(lib, py, 'site-packages');
    if (!fs.existsSync(sitePackages)) continue;
    for (const entry of fs.readdirSync(sitePackages)) {
      const m = /^(.+?)-[^-]+\.dist-info$/.exec(entry);
      if (m && !PIP_BOOTSTRAP.has(m[1].toLowerCase())) names.push(m[1]);
    }
  }
  return names;
}

// Supervisor replaces the whole option set, so merge into the current one.
async function mergeOwnOptions(client, change) {
  const self = await client.get('/addons/self/info');
  const current = self.options || {};
  await client.post('/addons/self/options', { options: { ...current, ...change(current) } });
}
```

Inside `apply`, after the `gh` step:

```js
  const persistInstall = deps.persistInstall || '/usr/local/bin/persist-install';
  const persistArgs = deps.persistInstallArgs || [];
  const install = (args) => spawnSync(persistInstall, [...persistArgs, ...args], { stdio: 'inherit' }).status === 0;

  await step('packages', async () => {
    const failed = [];
    const apk = offer.apk.filter((pkg) => install([pkg]) || (failed.push(pkg), false));
    const pip = unique([...offer.pip, ...pipNamesFromVenv(old.oldData)])
      .filter((pkg) => install(['--python', pkg]) || (failed.push(pkg), false));
    await mergeOwnOptions(client, (cur) => ({
      persistent_apk_packages: unique([...(cur.persistent_apk_packages || []), ...apk]),
      persistent_pip_packages: unique([...(cur.persistent_pip_packages || []), ...pip]),
    }));
    if (failed.length) throw new Error(`could not install ${failed.join(', ')}`);
  });

  await step('settings', () => mergeOwnOptions(client, () => offer.settings));

  // Last, and only if nothing failed: the old app is the fallback.
  if (selected.includes('stop')) {
    if (Object.values(results).some((r) => r.startsWith('error'))) {
      results.stop = 'skipped: an earlier item failed, the old app keeps running';
    } else {
      await step('stop', () => client.post(`/addons/${offer.slug}/stop`));
    }
  }
```

Note: `step('stop', …)` runs only because `selected.includes('stop')`; the guard above handles the skip.

- [ ] **Step 4: Run:** `node --test tests/test-app-migration.js` — Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add claude-terminal/scripts/app-migration/apply.js tests/test-app-migration.js
git commit -m "feat(migration): reinstall packages, carry settings, stop the old app last"
```

---

### Task 6: Dialog and CLI

**Files:**
- Create: `claude-terminal/scripts/app-migration/dialog.js`
- Create: `claude-terminal/scripts/app-migration/cli.js`
- Test: `tests/test-app-migration.js`

- [ ] **Step 1: Append failing tests**

```js
const { ITEMS, render, parseInput, renderSummary } = require(path.join(MOD, 'dialog'));

const OFFER = { slug: OLD_SLUG, name: 'Claude Terminal Pro', version: '2.0.13', repository: 'esjavadex',
  apk: ['htop'], pip: ['httpx'], settings: { auto_launch_claude: false } };

test('dialog: all six items, all on, packages and settings spelled out', () => {
  const text = render(OFFER, [...ITEMS]);
  assert.equal(ITEMS.length, 6);
  assert.equal((text.match(/\[x\]/g) || []).length, 6);
  assert.match(text, /Claude Terminal Pro 2\.0\.13/);
  assert.match(text, /apk: htop/);
  assert.match(text, /pip: httpx/);
  assert.match(text, /auto_launch_claude=false/);
});

test('dialog: digits toggle, empty line applies, s and n', () => {
  let r = parseInput('3', [...ITEMS]);
  assert.equal(r.action, 'toggle');
  assert.equal(r.selected.includes('gh'), false);
  r = parseInput(' 3 ', r.selected);
  assert.equal(r.selected.includes('gh'), true);
  assert.equal(parseInput('', ITEMS).action, 'apply');
  assert.equal(parseInput('S', ITEMS).action, 'later');
  assert.equal(parseInput('n', ITEMS).action, 'never');
  assert.equal(parseInput('9', ITEMS).action, 'invalid');
});

test('cli: detect exits 0 and prints the reason when nothing is offered', () => {
  const dir = tmp();
  const r = spawnSync(process.execPath, [path.join(MOD, 'cli.js'), 'detect'], {
    encoding: 'utf8',
    env: { ...process.env, MIGRATION_DATA_ROOT: dir, SUPERVISOR_API: 'http://127.0.0.1:9', SUPERVISOR_TOKEN: 'x' },
  });
  assert.equal(r.status, 0);
  assert.match(r.stdout + r.stderr, /App migration: detection failed/);
});

test('summary: names failures and the kept backup', () => {
  const text = renderSummary({ ok: true, backupSlug: 'bk1', results: { claude: 'ok', packages: 'error: could not install x' } });
  assert.match(text, /Claude data .*ok/);
  assert.match(text, /error: could not install x/);
  assert.match(text, /Settings → System → Backups/);
});
```

- [ ] **Step 2: Run:** `node --test tests/test-app-migration.js` — Expected: FAIL, `Cannot find module '.../dialog'`.

- [ ] **Step 3: Write `dialog.js`**

```js
'use strict';

const ITEMS = ['claude', 'login', 'gh', 'packages', 'stop', 'settings'];

function label(item, offer) {
  switch (item) {
    case 'claude': return 'Claude data: memories, CLAUDE.md, history, settings';
    case 'login': return 'Claude login';
    case 'gh': return 'GitHub login (gh)';
    case 'packages': {
      const apk = offer.apk.length ? offer.apk.join(' ') : '-';
      const pip = offer.pip.length ? offer.pip.join(' ') : '-';
      return `Reinstall packages: apk: ${apk} | pip: ${pip} (+ packages found in the old Python venv)`;
    }
    case 'stop': return 'Stop the old app afterwards';
    case 'settings': {
      const s = Object.entries(offer.settings).map(([k, v]) => `${k}=${v}`).join(', ') || '-';
      return `Settings: ${s} (applies after the next restart)`;
    }
    default: return item;
  }
}

function render(offer, selected) {
  const lines = [
    '',
    `  Found another app: ${offer.name} ${offer.version}${offer.repository ? ` (${offer.repository})` : ''}`,
    '  What should be taken over?   [type a digit + Enter to toggle]',
    '',
    ...ITEMS.map((item, i) => `  [${selected.includes(item) ? 'x' : ' '}] ${i + 1}  ${label(item, offer)}`),
    '',
    '  A partial backup of the old app is created first and kept as a fallback',
    '  (it includes the old app image, typically several hundred MB).',
    '  Enter = take over    s = ask again next start    n = never ask',
    '',
  ];
  return lines.join('\n');
}

function parseInput(line, selected) {
  const s = line.trim().toLowerCase();
  if (s === '') return { action: 'apply', selected };
  if (s === 's') return { action: 'later', selected };
  if (s === 'n') return { action: 'never', selected };
  const n = Number(s);
  if (Number.isInteger(n) && n >= 1 && n <= ITEMS.length) {
    const item = ITEMS[n - 1];
    const next = selected.includes(item) ? selected.filter((i) => i !== item) : [...selected, item];
    return { action: 'toggle', selected: next };
  }
  return { action: 'invalid', selected };
}

const SUMMARY_LABELS = {
  claude: 'Claude data', login: 'Claude login', gh: 'GitHub login', packages: 'Packages',
  settings: 'Settings', stop: 'Stop old app',
};

function renderSummary(result) {
  if (!result.ok) {
    return `\n  Nothing was taken over: ${result.fatal}\n  The old app is unchanged. You will be asked again on the next start.\n`;
  }
  const lines = Object.entries(result.results).map(([k, v]) => `  ${SUMMARY_LABELS[k] || k}: ${v}`);
  return ['', ...lines, '',
    `  The partial backup of the old app is kept under Settings → System → Backups.`,
    '  It contains the old login; delete it once you no longer need it.', ''].join('\n');
}

module.exports = { ITEMS, render, parseInput, renderSummary };
```

- [ ] **Step 4: Write `cli.js`**

```js
#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const readline = require('node:readline/promises');
const { migrationPaths } = require('./paths');
const { createClient } = require('./supervisor');
const { detect } = require('./detect');
const { apply } = require('./apply');
const { ITEMS, render, parseInput, renderSummary } = require('./dialog');

async function runDetect() {
  try {
    const r = await detect(createClient(), migrationPaths());
    console.log(r.offered
      ? `App migration: offering data from ${r.offer.name} ${r.offer.version} (${r.offer.slug})`
      : `App migration: nothing to offer (${r.reason})`);
  } catch (e) {
    console.log(`App migration: detection failed, skipping (${e.message})`);
  }
}

async function runDialog() {
  const p = migrationPaths();
  if (!fs.existsSync(p.offer)) return;
  const offer = JSON.parse(fs.readFileSync(p.offer, 'utf8'));
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  let selected = [...ITEMS];
  try {
    for (;;) {
      process.stdout.write('\x1b[2J\x1b[H' + render(offer, selected));
      const r = parseInput(await rl.question('  > '), selected);
      selected = r.selected;
      if (r.action === 'later') return;
      if (r.action === 'never') {
        fs.writeFileSync(p.state, 'never\n');
        fs.rmSync(p.offer, { force: true });
        return;
      }
      if (r.action === 'apply') {
        console.log('\n  Creating a backup of the old app and taking over, this can take a few minutes...\n');
        const result = await apply(createClient(), p, offer, selected);
        console.log(renderSummary(result));
        await rl.question('  Press Enter to continue ');
        return;
      }
    }
  } finally {
    rl.close();
  }
}

const mode = process.argv[2];
const job = mode === 'detect' ? runDetect() : mode === 'dialog' ? runDialog() : Promise.resolve();
// The dialog sits in front of Claude/the session picker: never block them.
job.catch((e) => console.log(`App migration: ${e.message}`)).finally(() => process.exit(0));
```

- [ ] **Step 5: Run:** `node --test tests/test-app-migration.js` — Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add claude-terminal/scripts/app-migration/dialog.js claude-terminal/scripts/app-migration/cli.js tests/test-app-migration.js
git commit -m "feat(migration): selection window and CLI entry point"
```

---

### Task 7: Wire into run.sh and the test runner

**Files:**
- Modify: `claude-terminal/run.sh` (new functions before `start_web_terminal`; call in `main`; use in `start_web_terminal`)
- Modify: `tests/test-production-run.sh` (append assertions before the final success line)
- Modify: `tests/run-tests.sh`

- [ ] **Step 1: Append failing assertions to `tests/test-production-run.sh`** (before its final `echo "Production run.sh regression suite passed"`)

```bash
# A pending migration offer puts the selection window in front of Claude.
APP_MIGRATION_OFFER="$tmp_dir/offer.json"
APP_MIGRATION_CLI="/opt/scripts/app-migration/cli.js"
[ "$(with_migration_dialog 'clear && picker')" = 'clear && picker' ] || \
    fail "launch command must stay unchanged without a migration offer"
printf '{}\n' > "$APP_MIGRATION_OFFER"
[ "$(with_migration_dialog 'clear && picker')" = 'node /opt/scripts/app-migration/cli.js dialog; clear && picker' ] || \
    fail "a pending migration offer must show the dialog before the launch command"
```

- [ ] **Step 2: Verify it fails** — locally `bash -n tests/test-production-run.sh` only (suite needs Linux symlinks); the failure (`with_migration_dialog: command not found`) is confirmed in CI after the push in Task 10. Record this limitation in the commit message.

- [ ] **Step 3: Add to `claude-terminal/run.sh`, directly above `start_web_terminal() {`**

```bash
# Offer to take over Claude data from another Claude Terminal Pro app (e.g. the
# ESJavadex original) installed alongside. Detection only reads the Supervisor
# API and writes an offer file; the selection window runs in the terminal.
detect_app_migration() {
    local cli="${APP_MIGRATION_CLI:-/opt/scripts/app-migration/cli.js}"
    [ -f "$cli" ] || return 0
    local line
    while IFS= read -r line; do
        bashio::log.info "$line"
    done < <(node "$cli" detect 2>&1 || true)
}

# Prefixes the launch command with the selection window while an offer exists.
with_migration_dialog() {
    local launch_command="$1"
    local offer="${APP_MIGRATION_OFFER:-/data/migration/offer.json}"
    local cli="${APP_MIGRATION_CLI:-/opt/scripts/app-migration/cli.js}"
    if [ -f "$offer" ]; then
        printf 'node %s dialog; %s\n' "$cli" "$launch_command"
    else
        printf '%s\n' "$launch_command"
    fi
}
```

- [ ] **Step 4: Use it in `start_web_terminal`** — replace

```bash
    launch_command=$(get_claude_launch_command)
```

with

```bash
    launch_command=$(with_migration_dialog "$(get_claude_launch_command)")
```

- [ ] **Step 5: Call detection in `main`** — after `setup_persistent_packages`:

```bash
    setup_persistent_packages
    detect_app_migration
    start_web_terminal
```

- [ ] **Step 6: Add the Node suite to `tests/run-tests.sh`** — after `node "$tests_dir/test-terminal-clipboard.js"`:

```bash
node --test "$tests_dir/test-app-migration.js"
```

- [ ] **Step 7: Local checks**

Run: `bash $TEMP/check.sh` (bash -n + ShellCheck vs. baseline) — Expected: `--- new vs base:` with nothing listed.
Run: `node --test tests/test-app-migration.js` — Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add claude-terminal/run.sh tests/test-production-run.sh tests/run-tests.sh
git commit -m "feat(migration): detect at startup, show the window before Claude

The production run.sh suite needs symlinks and only runs in CI; the new
with_migration_dialog assertions are verified there."
```

---

### Task 8: "App" instead of "add-on" in user-visible text

**Files:**
- Modify: `claude-terminal/run.sh` (log messages only), `claude-terminal/scripts/claude-session-picker.sh` (echo/printf text only), `README.md`, `claude-terminal/README.md`, `claude-terminal/DOCS.md`, `claude-terminal/config.yaml` (`description` only)

Rule: change words a user reads ("add-on" → "app", "Add-on Store" → "App Store", "Settings → Add-ons" → "Settings → Apps"). Do **not** change slugs, file names, config keys, `CHANGELOG.md` entries before 2.2.0, URLs, or code identifiers.

- [ ] **Step 1: List candidates**

Run: `grep -n -i "add-on\|addon" claude-terminal/run.sh claude-terminal/scripts/claude-session-picker.sh README.md claude-terminal/README.md claude-terminal/DOCS.md claude-terminal/config.yaml | grep -v -i "addon_config\|all_app_configs\|/addons\|addons/\|slug\|home-assistant-addons\|ADDON_ARCH\|addon-arch"`

- [ ] **Step 2: Edit each listed line by hand** (no blanket sed — URLs like `heytcass/home-assistant-addons` and `my.home-assistant.io/...add_addon_repository` must stay).

- [ ] **Step 3: Verify nothing functional changed**

Run: `git diff --stat` and `git diff claude-terminal/run.sh claude-terminal/scripts/claude-session-picker.sh | grep '^[-+]' | grep -v -E 'log\.|echo|printf|^[-+]\s*#'` — Expected: no output (only messages/comments changed).
Run: `bash $TEMP/check.sh` — Expected: nothing new vs. base.
Run: `bash tests/test-release-metadata.sh` — Expected: passed.

- [ ] **Step 4: Commit**

```bash
git add -u
git commit -m "docs: call it an app, as Home Assistant does since 2026"
```

---

### Task 9: README, DOCS, CHANGELOG, version 2.2.0

**Files:**
- Modify: `README.md` (the "Coming from the ESJavadex repository?" paragraph, line ~30, and add a line to "What's different in this fork")
- Modify: `claude-terminal/DOCS.md` (Installation section)
- Modify: `claude-terminal/CHANGELOG.md`, `claude-terminal/config.yaml`, `claude-terminal/build.yaml`

- [ ] **Step 1: README — replace the paragraph starting "Coming from the ESJavadex repository?"** with:

```markdown
**Switching from the ESJavadex app?** Install this app next to it. On first start it
finds the old app and, when you open the panel, offers to take over your Claude
memories, `CLAUDE.md`, history, logins, packages and settings — via a partial
backup of the old app, which is kept as a fallback. The old app is stopped
afterwards; uninstall it once everything works.
```

and add as first bullet under "What's different in this fork":

```markdown
- **One-step switch from the ESJavadex app** — memories, logins, packages and settings are taken over on first start
```

- [ ] **Step 2: DOCS.md** — after the numbered installation steps add:

```markdown
### Switching from another Claude Terminal Pro app

If another Claude Terminal Pro app (for example from `ESJavadex/claude-code-ha`) is
installed, this app offers on the first panel open to take over its data. Choose
with the digits 1–6, then press Enter:

1. Claude data (memories, `CLAUDE.md`, history, settings) · 2. Claude login ·
3. GitHub login · 4. reinstall packages · 5. stop the old app · 6. settings

A partial backup of the old app is created first and kept under
Settings → System → Backups. `s` asks again on the next start, `n` never asks again.
```

- [ ] **Step 3: Version 2.2.0** — `claude-terminal/config.yaml` `version: "2.2.0"`, `claude-terminal/build.yaml` `org.opencontainers.image.version: "2.2.0"`; new top section in `claude-terminal/CHANGELOG.md`:

```markdown
## 2.2.0

### ✨ New Feature - Switch from another Claude Terminal Pro app in one step
- On first start the app looks for another installed Claude Terminal Pro app (for
  example the ESJavadex original). When you open the panel, a window offers to take
  over Claude data (memories, `CLAUDE.md`, history, settings), the Claude and GitHub
  logins, packages (reinstalled, not copied) and app settings, and to stop the old app.
- Works through a partial backup of the old app, created via the Supervisor API and
  kept as a fallback; the old app itself is never modified. If any item fails, the
  old app is not stopped. Nothing that already exists in this app is overwritten.

### 📝 Wording
- "Add-on" is now "app" throughout, as in Home Assistant since 2026.
```

- [ ] **Step 4: Verify**

Run: `bash tests/test-release-metadata.sh` — Expected: `Release metadata suite passed (version 2.2.0)`.

- [ ] **Step 5: Commit**

```bash
git add README.md claude-terminal/DOCS.md claude-terminal/CHANGELOG.md claude-terminal/config.yaml claude-terminal/build.yaml
git commit -m "release: 2.2.0 - switch from another Claude Terminal Pro app in one step"
```

---

### Task 10: CI, release, live test on HA-Prod

- [ ] **Step 1: Push the branch (needs the user's go)** — `git push -u origin feat/app-migration`; watch CI: `gh run watch <id> -R Eifel-Joe/claude-code-ha --exit-status`. Expected: Lint, Regression suites (incl. `test-app-migration.js` and the new `with_migration_dialog` assertions), Build amd64/aarch64 all `success`.
- [ ] **Step 2: Release (needs the user's go, release text shown first)** — fast-forward `main`, tag `v2.2.0`, `gh release create` with notes from the CHANGELOG section.
- [ ] **Step 3: HA-Prod live test (user's decision, backup exists)** — preconditions: the ESJavadex app with real data is installed; the fork app is not installed on Prod (or has no Claude data). Add the repository, install, open the panel. Success criteria from the spec:
  - window appears with the old app's version and packages;
  - after Enter: `/memory` shows the old memories, the global `CLAUDE.md` is there, Claude starts without a new login, `gh auth status` is logged in, pip packages import;
  - old app is stopped; the partial backup is listed under Settings → System → Backups.
- [ ] **Step 4:** Update `docs/FORK-SURVEY.md`/memory notes with the outcome; offer to delete the migration backup and uninstall the old app.
