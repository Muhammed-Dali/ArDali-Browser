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
  const result = [];
  const walk = (dir) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!iconExts.has(path.extname(entry.name).toLowerCase())) continue;
      result.push(path.relative(iconsDir, fullPath).replace(/\\/g, '/'));
    }
  };
  walk(iconsDir);
  return result.sort((a, b) => a.localeCompare(b));
}

function hasReference(relativePath) {
  const fileName = path.basename(relativePath);
  const references = [
    `icons/${relativePath}`,
    `icons\\${relativePath.replace(/\//g, '\\')}`,
    fileName,
  ];
  const args = ['-n', '--fixed-strings'];
  for (const reference of references) {
    args.push('-e', reference);
  }
  args.push('.');
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
