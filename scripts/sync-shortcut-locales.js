// Backward-compatible wrapper. Use `node scripts/sync-locales.js --group shortcuts`.
const baseArgv = process.argv.slice(0, 2);
const passthrough = process.argv.slice(2);
process.argv = [...baseArgv, '--group', 'shortcuts', ...passthrough];
require('./sync-locales.js');
