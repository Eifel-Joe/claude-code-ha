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
const INSTALL_TIMEOUT_MS = 15 * 60 * 1000; // per persist-install call
const PROGRESS_EVERY_MS = 15 * 1000;

// A synchronous backup request only answers once the backup is written; with the
// app image inside that can take longer than fetch's 300 s header timeout on slow
// hardware. So run it as a Supervisor background job and poll /jobs/<id>, whose
// "reference" is the backup slug once done (supervisor api/backups.py, jobs).
// Progress goes to the terminal: the backup alone can take many minutes, and a
// silent screen looks like a hang.
async function createBackup(client, offer, { date, pollMs, log, progressEveryMs }) {
  log('  Creating a partial backup of the old app...');
  const created = await client.post('/backups/new/partial', {
    name: `Claude Terminal Pro – Übernahme ${date}`,
    addons: [offer.slug],
    homeassistant: false,
    background: true,
  });
  if (created.slug) return created.slug; // finished before the request returned
  const started = Date.now();
  const deadline = started + BACKUP_TIMEOUT_MS;
  let lastProgress = started;
  for (;;) {
    const job = await client.get(`/jobs/${created.job_id}`);
    if (job.done) {
      if (job.errors && job.errors.length) {
        throw new Error(`backup failed: ${job.errors.map((e) => e.message).join('; ')}`);
      }
      if (!job.reference) throw new Error('backup finished without a backup slug');
      return job.reference;
    }
    const now = Date.now();
    if (now > deadline) throw new Error('backup still running after 60 minutes');
    if (now - lastProgress >= progressEveryMs) {
      log(`  Still creating the backup… ${Math.round((now - started) / 1000)} s`);
      lastProgress = now;
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

async function fetchOldData(client, offer, p, opts) {
  const slug = await createBackup(client, offer, opts);
  fs.rmSync(p.work, { recursive: true, force: true });
  fs.mkdirSync(p.work, { recursive: true });
  const outer = path.join(p.work, 'backup.tar');
  opts.log('  Downloading the backup...');
  await client.download(`/backups/${slug}/download`, outer);
  opts.log('  Unpacking the backup...');
  run('tar', ['-xf', outer, '-C', p.work]);
  fs.rmSync(outer, { force: true }); // halves peak disk use before the inner archive is unpacked
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
  fs.cpSync(src, dst, { recursive: true, force: false, errorOnExist: false,
    preserveTimestamps: true, verbatimSymlinks: true, filter });
  return true;
}

const PIP_BOOTSTRAP = new Set(['pip', 'setuptools', 'wheel']);
const unique = (list) => [...new Set(list)];

// PEP 503: "Foo_Bar", "foo.bar" and "foo-bar" are the same project.
const normalisePip = (name) => name.toLowerCase().replace(/[-_.]+/g, '-');

// First spelling wins, duplicates by normalised name dropped.
function uniquePip(list) {
  const seen = new Set();
  return list.filter((name) => {
    const key = normalisePip(name);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Package names (normalised) from the old venv's *.dist-info directories.
// pip marks packages installed by name with a REQUESTED file; their
// dependencies lack it and are pulled in again by pip itself. A venv without
// any marker (older pip, other installer) falls back to every package.
function pipNamesFromVenv(oldData) {
  const lib = path.join(oldData, 'packages', 'python', 'venv', 'lib');
  if (!fs.existsSync(lib)) return [];
  const all = [];
  for (const py of fs.readdirSync(lib)) {
    const sitePackages = path.join(lib, py, 'site-packages');
    if (!fs.existsSync(sitePackages)) continue;
    for (const entry of fs.readdirSync(sitePackages)) {
      const m = /^(.+?)-[^-]+\.dist-info$/.exec(entry);
      if (!m) continue;
      const name = normalisePip(m[1]);
      if (PIP_BOOTSTRAP.has(name)) continue;
      all.push({ name, requested: fs.existsSync(path.join(sitePackages, entry, 'REQUESTED')) });
    }
  }
  const requested = all.filter((d) => d.requested);
  // readdir order is not sorted on every filesystem (ext4).
  return (requested.length ? requested : all).map((d) => d.name).sort();
}

// Supervisor replaces the whole option set, so merge into the current one.
async function mergeOwnOptions(client, change) {
  const self = await client.get('/addons/self/info');
  const current = self.options || {};
  await client.post('/addons/self/options', { options: { ...current, ...change(current) } });
}

async function apply(client, p, offer, selected, deps = {}) {
  const results = {};
  const log = deps.log || console.log;
  let old;
  try {
    old = await fetchOldData(client, offer, p, {
      date: deps.today || today(),
      pollMs: deps.pollMs || POLL_MS,
      log,
      progressEveryMs: deps.progressEveryMs ?? PROGRESS_EVERY_MS,
    });
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
    const found = copyMissing(path.join(oldHome, '.claude'), path.join(p.home, '.claude'),
      (src) => path.basename(src) !== '.credentials.json');
    if (!found) return 'not found';
    const keptJson = fs.existsSync(path.join(p.home, '.claude.json'));
    copyMissing(path.join(oldHome, '.claude.json'), path.join(p.home, '.claude.json'));
    return keptJson ? 'ok (kept existing .claude.json)' : 'ok';
  });
  await step('login', () => (copyMissing(path.join(oldHome, '.claude', '.credentials.json'),
    path.join(p.home, '.claude', '.credentials.json')) ? 'ok' : 'not found'));
  await step('gh', () => (copyMissing(path.join(old.oldData, '.config', 'gh'),
    path.join(p.dataRoot, '.config', 'gh')) ? 'ok' : 'not found'));

  const persistInstall = deps.persistInstall || '/usr/local/bin/persist-install';
  const persistArgs = deps.persistInstallArgs || [];
  // Bounded: a hanging apk/pip (mirror down, prompt) must not keep the dialog,
  // and with it Claude, blocked forever. A killed run has status null.
  const installTimeoutMs = deps.installTimeoutMs || INSTALL_TIMEOUT_MS;
  const install = (args) => {
    const r = spawnSync(persistInstall, [...persistArgs, ...args],
      { stdio: 'inherit', timeout: installTimeoutMs, killSignal: 'SIGKILL' });
    return !r.error && r.status === 0;
  };

  await step('packages', async () => {
    const failed = [];
    const pipWanted = uniquePip([...offer.pip, ...pipNamesFromVenv(old.oldData)]);
    log(`  Installing packages: apk: ${offer.apk.join(' ') || '-'} | pip: ${pipWanted.join(' ') || '-'}`);
    const apk = offer.apk.filter((pkg) => install([pkg]) || (failed.push(pkg), false));
    // One pip run resolves all versions together and is much faster; only if
    // it fails, retry one by one to find the culprit(s).
    const pip = pipWanted.length && install(['--python', ...pipWanted])
      ? pipWanted
      : pipWanted.filter((pkg) => install(['--python', pkg]) || (failed.push(pkg), false));
    await mergeOwnOptions(client, (cur) => ({
      persistent_apk_packages: unique([...(cur.persistent_apk_packages || []), ...apk]),
      persistent_pip_packages: uniquePip([...(cur.persistent_pip_packages || []), ...pip]),
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

  if (!deps.keepWork) fs.rmSync(p.work, { recursive: true, force: true }); // keepWork: tests only
  fs.writeFileSync(p.state, 'done\n');
  fs.rmSync(p.offer, { force: true });
  return { ok: true, backupSlug: old.backupSlug, results };
}

module.exports = { apply };
