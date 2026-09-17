'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { parseArDaliBrowserManifest, validateBrowserManifest } = require('../dali-lang');

const browserDaliPath = path.join(__dirname, '..', 'browser', 'dali', 'browser.dali');
assert.ok(fs.existsSync(browserDaliPath), `browser.dali must exist at ${browserDaliPath}`);

const source = fs.readFileSync(browserDaliPath, 'utf8');
const manifest = parseArDaliBrowserManifest(source);

assert.equal(manifest.name, 'ArDaliBrowser');
assert.equal(manifest.engineName, 'chromium');
assert.equal(manifest.engine.embedder, 'qt_webengine');
assert.equal(validateBrowserManifest(manifest), true);

console.log('[INTEGRATION TEST] ArDali browser.dali manifest validation: PASS');
