#!/usr/bin/env node
// Fails on any high/critical advisory in the image service's production
// dependencies, except the ones allowlisted below with a reason.
'use strict';
const { spawnSync } = require('node:child_process');

const ALLOWLIST = {
  // braces stack exhaustion on deeply nested *patterns*. Every braces release
  // is affected, so there is no fix to take; npm's only "fix" downgrades
  // http-proxy-middleware to 0.2.0. Not reachable here: the proxy is mounted
  // with app.use('/terminal', ...) and no glob patterns, so no request data
  // ever becomes a braces pattern.
  'GHSA-vfj7-8cjw-p6xm': 'braces: no patched release, pattern input not attacker-controlled',
};

const audit = spawnSync('npm', ['audit', '--omit=dev', '--json'], {
  encoding: 'utf8', shell: process.platform === 'win32',
});
const report = JSON.parse(audit.stdout);
const blocking = new Map();
for (const vuln of Object.values(report.vulnerabilities || {})) {
  for (const via of vuln.via) {
    if (typeof via !== 'object') continue;
    if (via.severity !== 'high' && via.severity !== 'critical') continue;
    const id = via.url.split('/').pop();
    if (!(id in ALLOWLIST)) blocking.set(id, `${via.severity}\t${via.name}\t${id}\t${via.title}`);
  }
}

if (blocking.size) {
  console.error('Blocking advisories:\n' + [...blocking.values()].join('\n'));
  process.exit(1);
}
console.log(`npm audit: no blocking advisories (allowlisted: ${Object.keys(ALLOWLIST).join(', ')})`);
