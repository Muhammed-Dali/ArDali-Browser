#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const iconsDir = path.join(rootDir, 'icons');

const iconExts = new Set(['.png', '.svg', '.ico', '.bmp', '.jpg', '.jpeg', '.webp']);
const excludedDirs = [
  '.git',
  'node_modules',
  'dist',
  'build',
  'squashfs-root',
  'ardali-bin',
  'packaging/local-test-pkg',
];

function getIconFiles() {
  const files = fs.readdirSync(iconsDir, { withFileTypes: true });
  return files
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => iconExts.has(path.extname(name).toLowerCase()))
    .sort((a, b) => a.localeCompare(b));
}

function hasReference(fileName) {
  const args = ['-n', '--fixed-strings', fileName, '.'];
  for (const dir of excludedDirs) {
    args.push('-g', `!${dir}/**`);
  }
  args.push('-g', '!icons/**');

  const result = spawnSync('rg', args, {
    cwd: rootDir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  return result.status === 0;
}

function main() {
  if (!fs.existsSync(iconsDir)) {
    console.error('icons/ klasoru bulunamadi.');
    process.exit(2);
  }

  const files = getIconFiles();
  const unused = files.filter((file) => !hasReference(file));

  if (unused.length === 0) {
    console.log(`OK: Kullanilmayan ikon yok (${files.length} dosya kontrol edildi).`);
    return;
  }

  console.log(`Kullanilmayan ikonlar (${unused.length}):`);
  for (const file of unused) {
    console.log(`- icons/${file}`);
  }
  process.exitCode = 1;
}

main();
