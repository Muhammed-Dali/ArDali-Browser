'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { parseArDaliBrowserManifest, validateBrowserManifest } = require('../src/browser-manifest');

const sampleManifestSource = `
browser "ArDaliBrowserTest" {
  engine chromium {
    embedder qt_webengine;
    sandbox strict;
    process_model multi_process;
  }
  tabs {
    ownership single_live_page;
    detach preserve_context;
    attach preserve_context;
    tab_strip native_pointer;
  }
  capabilities {
    allow window.create;
    allow window.reparent_live_page;
    allow navigation.http_https;
    deny filesystem.unscoped;
    deny process.spawn;
  }
  platform wayland {
    attach require_verified_global_coordinates;
  }
}
`;
const manifest = parseArDaliBrowserManifest(sampleManifestSource);
assert.equal(manifest.name, 'ArDaliBrowserTest');
assert.equal(manifest.engineName, 'chromium');
assert.equal(manifest.engine.embedder, 'qt_webengine');
assert.equal(validateBrowserManifest(manifest), true);
assert.throws(() => validateBrowserManifest({ ...manifest, tabs: { ...manifest.tabs, detach: 'copy_url' } }), /preserve one live page/);
console.log('DALI browser manifest validation: ok');
