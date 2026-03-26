#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const examplesDir = path.join(root, 'dali-lang', 'examples');

function listWasmModules() {
  return fs
    .readdirSync(examplesDir)
    .filter((name) => /^web-.*\.(dl|dali)\.wasm\.generated\.js$/i.test(name))
    .sort((a, b) => a.localeCompare(b, 'en'))
    .map((name) => path.join(examplesDir, name));
}

async function main() {
  const files = listWasmModules();
  if (!files.length) {
    throw new Error('[dali-wasm-smoke] no wasm generated modules found. Run: npm run -s dali:compile:web:wasm');
  }

  console.log(`[dali-wasm-smoke] testing ${files.length} module(s)`);

  for (const file of files) {
    const rel = path.relative(root, file);
    delete require.cache[require.resolve(file)];
    const mod = require(file);

    if (!mod || typeof mod.initWasmRuntime !== 'function') {
      throw new Error(`[dali-wasm-smoke] ${rel}: missing initWasmRuntime`);
    }

    const runtime = await mod.initWasmRuntime({
      preferWasm: false,
      allowFallback: true
    });

    if (!runtime || runtime.mode !== 'js-fallback' || typeof runtime.buildGraph !== 'function') {
      throw new Error(`[dali-wasm-smoke] ${rel}: fallback init failed`);
    }

    console.log(`[dali-wasm-smoke] ok: ${rel} -> ${runtime.mode}`);
  }

  console.log('[dali-wasm-smoke] PASS');
}

main().catch((err) => {
  console.error(err && err.message ? err.message : err);
  process.exit(1);
});
