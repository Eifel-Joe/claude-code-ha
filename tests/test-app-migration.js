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
