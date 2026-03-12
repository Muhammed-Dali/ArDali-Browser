#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

function fileExists(p) {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

function isExecutable(p) {
  try {
    fs.accessSync(p, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function readTextFile(p) {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}

function shouldDisableElectronSandbox() {
  const manual =
    process.env.AURIVO_NO_SANDBOX === '1' ||
    process.env.AURIVO_NO_SANDBOX === 'true' ||
    process.env.ELECTRON_NO_SANDBOX === '1' ||
    process.env.ELECTRON_NO_SANDBOX === 'true';
  if (manual) return true;

  // If unprivileged user namespaces are disabled, Electron sandbox often fails with:
  // sandbox_host_linux.cc(...) "Operation not permitted".
  const usernsClone = readTextFile('/proc/sys/kernel/unprivileged_userns_clone');
  if (usernsClone && usernsClone.trim() === '0') return true;

  const maxUserNs = readTextFile('/proc/sys/user/max_user_namespaces');
  if (maxUserNs && Number(maxUserNs.trim()) === 0) return true;

  return false;
}

function assertElectronBinaryMatchesPlatform() {
  const root = path.resolve(__dirname, '..');
  const distDir = path.join(root, 'node_modules', 'electron', 'dist');

  // If electron isn't installed yet, npm will fail later; don't block here.
  if (!fileExists(distDir)) return;

  const winExe = path.join(distDir, 'electron.exe');
  const linuxBin = path.join(distDir, 'electron');
  const macApp = path.join(distDir, 'Electron.app', 'Contents', 'MacOS', 'Electron');

  if (process.platform === 'linux') {
    if (fileExists(winExe) && !fileExists(linuxBin)) {
      console.error('\n[dev] ❌ Windows Electron binary tespit edildi (electron.exe). Linux\'ta çalışmaz.');
      console.error('[dev] Çözüm: `rm -rf node_modules && npm ci` (Linux\'ta) çalıştırın.');
      process.exit(1);
    }
    if (fileExists(linuxBin) && !isExecutable(linuxBin)) {
      console.error('\n[dev] ❌ Electron binary çalıştırılabilir değil:', linuxBin);
      console.error('[dev] Çözüm: yeniden kurulum önerilir: `rm -rf node_modules && npm ci`');
      process.exit(1);
    }
  }

  if (process.platform === 'win32') {
    if (fileExists(linuxBin) && !fileExists(winExe)) {
      console.error('\n[dev] ❌ Linux Electron binary tespit edildi. Windows\'ta çalışmaz.');
      console.error('[dev] Çözüm: `rmdir /s /q node_modules` sonra `npm ci` (Windows\'ta).');
      process.exit(1);
    }
  }

  if (process.platform === 'darwin') {
    if (fileExists(winExe) && !fileExists(macApp)) {
      console.error('\n[dev] ❌ Windows Electron binary tespit edildi (electron.exe). macOS\'ta çalışmaz.');
      console.error('[dev] Çözüm: `rm -rf node_modules && npm ci` (macOS\'ta) çalıştırın.');
      process.exit(1);
    }
  }
}

function run(cmd) {
  const env = { ...process.env };
  // If set, Electron runs as plain Node.js and `require('electron').app` is undefined.
  // This breaks the desktop app startup.
  delete env.ELECTRON_RUN_AS_NODE;

  const child = spawn(cmd, {
    stdio: 'inherit',
    shell: true,
    env
  });
  child.on('exit', (code) => process.exit(code ?? 1));
}

assertElectronBinaryMatchesPlatform();

function resolveElectronBinary() {
  try {
    const p = require('electron');
    if (typeof p === 'string' && p.length > 0) return p;
  } catch {
    // ignore
  }

  const root = path.resolve(__dirname, '..');
  const distDir = path.join(root, 'node_modules', 'electron', 'dist');

  if (process.platform === 'win32') return path.join(distDir, 'electron.exe');
  if (process.platform === 'darwin') {
    return path.join(distDir, 'Electron.app', 'Contents', 'MacOS', 'Electron');
  }
  return path.join(distDir, 'electron');
}

function spawnWait(command, args, options) {
  return new Promise((resolve) => {
    const child = spawn(command, args, options);
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

async function runDevPosix(platform) {
  const root = path.resolve(__dirname, '..');
  const env = { ...process.env, AURIVO_DEV: '1' };
  delete env.ELECTRON_RUN_AS_NODE;

  const noSandbox = platform === 'linux' ? shouldDisableElectronSandbox() : false;
  if (noSandbox) {
    console.warn('[dev] ⚠ Electron sandbox dev modda kapatıldı (--no-sandbox).');
    console.warn('[dev]    Kalıcı çözüm: kernel userns ayarlarını etkinleştirmek.');
  }

  const copyExit = await spawnWait(
    process.execPath,
    ['native/copy-libs.js', platform],
    { stdio: 'inherit', cwd: root, env }
  );
  if (copyExit !== 0) process.exit(copyExit);

  const electronBinary = resolveElectronBinary();
  if ((platform === 'linux' || platform === 'darwin') && electronBinary.toLowerCase().endsWith('.exe')) {
    console.error('\n[dev] ❌ Windows Electron binary tespit edildi (electron.exe). Bu platformda çalışmaz.');
    console.error('[dev] Çözüm: `rm -rf node_modules && npm ci` (bu platformda) çalıştırın.');
    process.exit(1);
  }

  const args = ['.', '--enable-logging'];
  if (noSandbox) args.push('--no-sandbox');

  const exitCode = await spawnWait(electronBinary, args, { stdio: 'inherit', cwd: root, env });
  process.exit(exitCode);
}

(async () => {
  switch (process.platform) {
    case 'win32':
      run('npm run -s dev:win');
      break;
    case 'linux':
      await runDevPosix('linux');
      break;
    case 'darwin':
      await runDevPosix('darwin');
      break;
    default:
      console.warn('[dev] Unsupported platform:', process.platform, '- falling back to `npm start`');
      run('npm start');
      break;
  }
})().catch((e) => {
  console.error('[dev] Unexpected error:', e?.stack || e);
  process.exit(1);
});
