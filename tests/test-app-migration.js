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

const { migrationPaths } = require(path.join(MOD, 'paths'));
const { createClient } = require(path.join(MOD, 'supervisor'));

test('paths: everything lives under MIGRATION_DATA_ROOT', () => {
  const p = migrationPaths({ MIGRATION_DATA_ROOT: '/x' });
  assert.equal(p.home, path.join('/x', 'home'));
  assert.equal(p.offer, path.join('/x', 'migration', 'offer.json'));
  assert.equal(p.state, path.join('/x', 'migration', 'state'));
  assert.equal(p.work, path.join('/x', 'migration', 'work'));
});

test('client: get/post return data, backup job flow, download writes the file, errors throw', async () => {
  const dir = tmp();
  const sup = await startFakeSupervisor({ backupTar: buildBackupFixture(dir) });
  try {
    const client = createClient({ baseUrl: sup.url, token: 'test-token' });
    assert.equal((await client.get('/addons/self/info')).slug, SELF_SLUG);
    assert.deepEqual(await client.post('/backups/new/partial', { background: true }), { job_id: 'job1' });
    assert.deepEqual(sup.state.calls.at(-1).body, { background: true });
    assert.equal((await client.get('/jobs/job1')).done, false);
    const job = await client.get('/jobs/job1');
    assert.equal(job.done, true);
    assert.equal(job.reference, 'bk1');
    const out = path.join(dir, 'dl.tar');
    await client.download('/backups/bk1/download', out);
    assert.deepEqual(fs.readFileSync(out), fs.readFileSync(path.join(dir, 'backup.tar')));
    await assert.rejects(client.get('/nope'), /404/);
    await assert.rejects(createClient({ baseUrl: sup.url, token: 'bad' }).get('/addons'), /401/);
  } finally { await sup.close(); }
});

test("client: download before the backup exists fails with Supervisor's message", async () => {
  const dir = tmp();
  const sup = await startFakeSupervisor({ backupTar: buildBackupFixture(dir) });
  try {
    const client = createClient({ baseUrl: sup.url, token: 'test-token' });
    await assert.rejects(client.download('/backups/bk1/download', path.join(dir, 'x.tar')), /404 no such backup/);
  } finally { await sup.close(); }
});

test('client: network errors name the request', async () => {
  await assert.rejects(
    createClient({ baseUrl: 'http://127.0.0.1:9', token: 'x' }).get('/addons'),
    /GET \/addons -> /);
});

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

const { apply } = require(path.join(MOD, 'apply'));

async function detectThenApply(opts, selected, deps = {}) {
  return withSupervisor({ oldOptions: OLD_OPTIONS, ...opts }, async (client, p, sup) => {
    const { offer } = await detect(client, p);
    const result = await apply(client, p, offer, selected,
      { today: '2026-10-06', pollMs: 1, persistInstall: deps.persistInstall || 'false-bin', ...deps });
    return { result, p, sup };
  });
}

test('apply: creates a named partial backup of only the old app', async () => {
  const { sup } = await detectThenApply({}, []);
  const call = sup.state.calls.find((c) => c.url === '/backups/new/partial');
  assert.deepEqual(call.body, {
    name: 'Claude Terminal Pro – Übernahme 2026-10-06', addons: [OLD_SLUG], homeassistant: false, background: true,
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
    await apply(client, p, offer, ['claude'], { today: '2026-10-06', pollMs: 1, persistInstall: 'false-bin' });
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
    await apply(client, p, offer, ['claude'], { today: '2026-10-06', pollMs: 1, persistInstall: 'false-bin', keepWork: true });
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
