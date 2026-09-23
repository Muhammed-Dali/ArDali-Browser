'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { parseDaliNiraBrowserManifest, validateBrowserManifest } = require('../dali-lang');

const browserDaliPath = path.join(__dirname, '..', 'browser', 'dali', 'browser.dali');
assert.ok(fs.existsSync(browserDaliPath), `browser.dali must exist at ${browserDaliPath}`);

const source = fs.readFileSync(browserDaliPath, 'utf8');
const manifest = parseDaliNiraBrowserManifest(source);

assert.equal(manifest.name, 'DaliNiraBrowser');
assert.equal(manifest.engineName, 'chromium');
assert.equal(manifest.engine.embedder, 'qt_webengine');
assert.equal(validateBrowserManifest(manifest), true);

console.log('[INTEGRATION TEST] DaliNira browser.dali manifest validation: PASS');
