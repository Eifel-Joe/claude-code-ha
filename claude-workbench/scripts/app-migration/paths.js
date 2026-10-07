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
