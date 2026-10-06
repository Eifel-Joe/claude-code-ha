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
