#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const cliPath = path.join(root, 'dali-lang', 'src', 'cli.js');
const examplesDir = path.join(root, 'dali-lang', 'examples');

if (!fs.existsSync(cliPath)) {
  console.error('[dali-compile:wasm] cli bulunamadı:', cliPath);
  process.exit(1);
}
if (!fs.existsSync(examplesDir)) {
  console.error('[dali-compile:wasm] examples bulunamadı:', examplesDir);
  process.exit(1);
}

const files = fs.readdirSync(examplesDir)
  .filter((name) => /^web-.*\.(dl|dali)$/i.test(name))
  .sort((a, b) => a.localeCompare(b, 'tr'));

if (!files.length) {
  console.warn('[dali-compile:wasm] derlenecek web-*.dl/.dali bulunamadı');
  process.exit(0);
}

let failed = false;
for (const file of files) {
  const inFile = path.join(examplesDir, file);
  const outFile = path.join(examplesDir, `${file}.wasm.generated.js`);
  const proc = spawnSync(process.execPath, [cliPath, inFile, outFile, '--target', 'wasm'], {
    cwd: root,
    stdio: 'inherit'
  });
  if (proc.status !== 0) {
    failed = true;
    console.error('[dali-compile:wasm] hata:', file);
  } else {
    console.log('[dali-compile:wasm] tamam:', path.relative(root, outFile));
  }
}

process.exit(failed ? 1 : 0);
