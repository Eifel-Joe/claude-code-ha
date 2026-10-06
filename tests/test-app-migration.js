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
