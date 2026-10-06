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

// Nothing to offer: a leftover offer.json would make the terminal show the dialog.
function noOffer(p, reason) {
  fs.rmSync(p.offer, { force: true });
  return { offered: false, reason };
}

async function detect(client, p) {
  if (['done', 'never'].includes(readState(p))) return noOffer(p, 'state');
  if (hasOwnClaudeData(p)) return noOffer(p, 'own-data');

  const self = await client.get('/addons/self/info');
  const { addons = [] } = await client.get('/addons');
  const old = pickOldApp(addons, self.slug);
  if (!old) return noOffer(p, 'no-old-app');

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
  // Atomic: the terminal must never read a half-written offer.
  const tmp = `${p.offer}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(offer, null, 2)}\n`);
  fs.renameSync(tmp, p.offer);
  return { offered: true, offer };
}

module.exports = { detect, hasOwnClaudeData, SETTING_KEYS };
