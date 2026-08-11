'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

const root = path.resolve(__dirname, '..');
const buildDir = path.join(root, 'build');
const run = (command, args) => {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
};

run('cmake', ['-S', '.', '-B', buildDir, '-G', 'Ninja']);
run('cmake', ['--build', buildDir]);

const browser = spawnSync(path.join(buildDir, 'ardali-browser'), [], {
  cwd: root,
  stdio: 'inherit'
});
process.exit(browser.status || 0);
