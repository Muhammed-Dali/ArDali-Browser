'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const html = read('soundEffects.html');
const boot = read('modules/soundEffects/boot.js');
const renderer = read('soundEffectsRenderer.js');

assert.match(html, /<script src="modules\/soundEffects\/boot\.js"><\/script>/);
assert.doesNotMatch(html, /<script src="soundEffectsRenderer\.js"><\/script>/);
assert.match(boot, /requestAnimationFrame/);
assert.match(boot, /soundEffectsRenderer\.js/);
assert.match(boot, /shellPaintMs/);
assert.match(renderer, /createAllEffectPanels\(\)/);
assert.match(renderer, /data-rendered="false"/);
assert.match(renderer, /ensureEffectPanelRendered\(effectName\)/);
assert.match(renderer, /loadAllSettings\(\['eq32', 'audiophile'\]\)/);
assert.match(renderer, /requestIdleCallback/);
assert.match(renderer, /setupEQPresetListener\(\)/);
assert.match(renderer, /interactiveMs/);

console.log('audio effects startup invariants: ok');
