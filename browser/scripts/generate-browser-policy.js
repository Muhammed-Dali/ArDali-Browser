'use strict';

const fs = require('fs');
const path = require('path');
const { parseArDaliBrowserManifest, validateBrowserManifest } = require('../../dali-lang');

const [sourcePath, outputPath] = process.argv.slice(2);
if (!sourcePath || !outputPath) throw new Error('Usage: generate-browser-policy <browser.dali> <output.json>');
const source = fs.readFileSync(sourcePath, 'utf8');
const manifest = parseArDaliBrowserManifest(source);
validateBrowserManifest(manifest);
const policy = {
  version: 1,
  name: manifest.name,
  engine: manifest.engineName,
  embedder: manifest.engine.embedder,
  capabilities: manifest.capabilities,
  tabs: manifest.tabs,
  platforms: manifest.platforms
};
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(policy, null, 2)}\n`, 'utf8');
