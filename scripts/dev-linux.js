'use strict';

const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const rootDir = path.resolve(__dirname, '..');
const buildDir = path.join(rootDir, 'build');
const cachePath = path.join(buildDir, 'CMakeCache.txt');

const run = (cmd, args) => {
  console.log(`[BUILD] ${cmd} ${args.join(' ')}`);
  const result = spawnSync(cmd, args, { cwd: rootDir, stdio: 'inherit' });
  if (result.status !== 0) {
    console.error(`[ERROR] Komut başarısız oldu (çıkış kodu: ${result.status})`);
    process.exit(result.status || 1);
  }
};

// 1. CMake configure & build. CMake caches absolute paths, so a renamed or
// moved build directory must be refreshed before it can be reused.
let configureArgs = ['-S', '.', '-B', 'build', '-G', 'Ninja'];
if (fs.existsSync(cachePath)) {
  const cache = fs.readFileSync(cachePath, 'utf8');
  const cachedBuildDir = cache.match(/^CMAKE_CACHEFILE_DIR:INTERNAL=(.*)$/m)?.[1];
  const cachedSourceDir = cache.match(/^CMAKE_HOME_DIRECTORY:INTERNAL=(.*)$/m)?.[1];
  if ((cachedBuildDir && path.resolve(cachedBuildDir) !== buildDir) ||
      (cachedSourceDir && path.resolve(cachedSourceDir) !== rootDir)) {
    console.log('[BUILD] Taşınmış CMake önbelleği algılandı; build metadata yenileniyor.');
    configureArgs = ['--fresh', ...configureArgs];
  }
}
run('cmake', configureArgs);
run('cmake', ['--build', 'build', '--target', 'dalinira-browser']);

// 2. Linux Wayland / XCB display environment setup
const env = { ...process.env };
if (!env.QT_QPA_PLATFORM && env.DISPLAY && env.XDG_SESSION_TYPE === 'wayland') {
  env.QT_QPA_PLATFORM = 'xcb';
}

const binaryPath = path.join(buildDir, 'dalinira-browser');
console.log(`[START] Tarayıcı başlatılıyor: ${binaryPath}`);

const child = spawnSync(binaryPath, [], {
  cwd: buildDir,   // Run from build dir so runtime artifacts don't pollute the source tree
  env,
  stdio: 'inherit'
});

process.exit(child.status || 0);
