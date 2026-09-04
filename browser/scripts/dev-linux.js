'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

const root = path.resolve(__dirname, '..');
const buildDir = path.join(root, 'build');
const run = (command, args) => {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
};

// Reuse the generator recorded in an existing build directory. Forcing Ninja
// here breaks developer builds that were previously configured with Makefiles.
run('cmake', ['-S', '.', '-B', buildDir]);
run('cmake', ['--build', buildDir]);

const env = { ...process.env };
if (!env.QT_QPA_PLATFORM && env.DISPLAY && env.XDG_SESSION_TYPE === 'wayland') {
  env.QT_QPA_PLATFORM = 'xcb';
}

const browser = spawnSync(path.join(buildDir, 'ardali-browser'), [], {
  cwd: root,
  env,
  stdio: 'inherit'
});
process.exit(browser.status || 0);
