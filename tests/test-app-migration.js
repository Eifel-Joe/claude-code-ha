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
