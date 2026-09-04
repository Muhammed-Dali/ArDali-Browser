'use strict';

const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const rootDir = path.resolve(__dirname, '..');
const buildDir = path.join(rootDir, 'build');

const run = (cmd, args) => {
  console.log(`[BUILD] ${cmd} ${args.join(' ')}`);
  const result = spawnSync(cmd, args, { cwd: rootDir, stdio: 'inherit' });
  if (result.status !== 0) {
    console.error(`[ERROR] Komut başarısız oldu (çıkış kodu: ${result.status})`);
    process.exit(result.status || 1);
  }
};

// 1. CMake configure & build
if (!fs.existsSync(path.join(buildDir, 'CMakeCache.txt'))) {
  run('cmake', ['-S', '.', '-B', 'build', '-G', 'Ninja']);
}
run('cmake', ['--build', 'build']);

// 2. Linux Wayland / XCB display environment setup
const env = { ...process.env };
if (!env.QT_QPA_PLATFORM && env.DISPLAY && env.XDG_SESSION_TYPE === 'wayland') {
  env.QT_QPA_PLATFORM = 'xcb';
}

const binaryPath = path.join(buildDir, 'ardali-browser');
console.log(`[START] Tarayıcı başlatılıyor: ${binaryPath}`);

const child = spawnSync(binaryPath, [], {
  cwd: rootDir,
  env,
  stdio: 'inherit'
});

process.exit(child.status || 0);
