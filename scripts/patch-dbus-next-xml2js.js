#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const packagePath = path.join(__dirname, '..', 'node_modules', 'dbus-next', 'package.json');
const patchedRange = '^0.6.2';

if (!fs.existsSync(packagePath)) {
  process.exit(0);
}

const manifest = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
manifest.dependencies = manifest.dependencies || {};

if (manifest.dependencies.xml2js === patchedRange) {
  process.exit(0);
}

manifest.dependencies.xml2js = patchedRange;
fs.writeFileSync(packagePath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`[patch-dbus-next] xml2js dependency range set to ${patchedRange}`);
