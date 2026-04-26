#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.resolve(__dirname, '..');
const distArg = process.argv[2] || 'dist';
const distDir = path.resolve(root, distArg);
const outPath = path.join(distDir, 'SHA256SUMS.txt');

const includeExt = new Set([
  '.appimage',
  '.blockmap',
  '.deb',
  '.rpm',
  '.yml',
  '.yaml',
  '.exe',
  '.zip',
  '.dmg',
  '.pkg'
]);

function sha256(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

if (!fs.existsSync(distDir) || !fs.statSync(distDir).isDirectory()) {
  console.error(`[release:checksums] dist directory not found: ${distDir}`);
  process.exit(1);
}

const files = fs
  .readdirSync(distDir, { withFileTypes: true })
  .filter((e) => e.isFile())
  .map((e) => e.name)
  .filter((name) => {
    const lower = name.toLowerCase();
    if (lower === 'sha256sums.txt' || lower === 'sha256sums.txt.asc') return false;
    const ext = path.extname(lower);
    return includeExt.has(ext);
  })
  .sort((a, b) => a.localeCompare(b));

if (!files.length) {
  console.error('[release:checksums] no release files found in dist');
  process.exit(1);
}

const lines = files.map((name) => {
  const sum = sha256(path.join(distDir, name));
  return `${sum}  ${name}`;
});

fs.writeFileSync(outPath, `${lines.join('\n')}\n`, 'utf8');
console.log(`[release:checksums] wrote ${outPath} (${files.length} entries)`);
