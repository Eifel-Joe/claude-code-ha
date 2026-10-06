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

const POLL_MS = 2000;
const BACKUP_TIMEOUT_MS = 60 * 60 * 1000;

// A synchronous backup request only answers once the backup is written; with the
// app image inside that can take longer than fetch's 300 s header timeout on slow
// hardware. So run it as a Supervisor background job and poll /jobs/<id>, whose
// "reference" is the backup slug once done (supervisor api/backups.py, jobs).
async function createBackup(client, offer, date, pollMs) {
  const created = await client.post('/backups/new/partial', {
    name: `Claude Terminal Pro – Übernahme ${date}`,
    addons: [offer.slug],
    homeassistant: false,
    background: true,
  });
  if (created.slug) return created.slug; // finished before the request returned
  const deadline = Date.now() + BACKUP_TIMEOUT_MS;
  for (;;) {
    const job = await client.get(`/jobs/${created.job_id}`);
    if (job.done) {
      if (job.errors && job.errors.length) {
        throw new Error(`backup failed: ${job.errors.map((e) => e.message).join('; ')}`);
      }
      if (!job.reference) throw new Error('backup finished without a backup slug');
      return job.reference;
    }
    if (Date.now() > deadline) throw new Error('backup still running after 60 minutes');
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

async function fetchOldData(client, offer, p, date, pollMs = POLL_MS) {
  const slug = await createBackup(client, offer, date, pollMs);
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
    old = await fetchOldData(client, offer, p, deps.today || today(), deps.pollMs);
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
