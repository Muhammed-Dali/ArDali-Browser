#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { parseDali } = require('../dali-lang/src/parser');
const { validateSourceLimits, validateProgramSecurity } = require('../dali-lang/src/security-validator');
const { createProgramIR } = require('../dali-lang/src/ir');
const { compileToWebAudioModule } = require('../dali-lang/src/compiler-web-audio');
const { compileToWasmModuleSkeleton } = require('../dali-lang/src/compiler-wasm');
const { compileToNativeSkeleton } = require('../dali-lang/src/compiler-native');

const root = path.resolve(__dirname, '..');
const examplesDir = path.join(root, 'dali-lang', 'examples');

function sha256(input) {
  return crypto.createHash('sha256').update(String(input)).digest('hex');
}

function canonicalizeIrForParity(ir) {
  const clone = JSON.parse(JSON.stringify(ir || {}));
  if (clone && clone.compilerProfile && typeof clone.compilerProfile === 'object') {
    clone.compilerProfile.targetClass = '__normalized__';
  }
  clone.generatedAt = '';
  return clone;
}

function getExampleFiles() {
  return fs.readdirSync(examplesDir)
    .filter((name) => /^web-.*\.(dl|dali)$/i.test(name))
    .sort((a, b) => a.localeCompare(b, 'en'))
    .map((name) => path.join(examplesDir, name));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function verifySingleSource(sourcePath) {
  const rel = path.relative(root, sourcePath).replace(/\\/g, '/');
  const source = fs.readFileSync(sourcePath, 'utf8');

  validateSourceLimits(source, path.basename(sourcePath));
  const ast = parseDali(source);
  validateProgramSecurity(ast, { mode: 'strict' });

  const targetClasses = ['hybrid', 'wasm-hybrid', 'native-poc'];
  const parityHashes = [];
  for (const targetClass of targetClasses) {
    const ir = createProgramIR(ast, {
      sourceLabel: rel,
      securityMode: 'strict',
      targetClass,
      includeTimestamp: false
    });
    const canonical = canonicalizeIrForParity(ir);
    parityHashes.push({ targetClass, hash: sha256(JSON.stringify(canonical)) });
  }

  const uniqueHashes = new Set(parityHashes.map((x) => x.hash));
  assert(
    uniqueHashes.size === 1,
    `[dali-ir-parity] IR mismatch across target classes for ${rel}: ${JSON.stringify(parityHashes)}`
  );

  const webModule = compileToWebAudioModule(ast, {
    sourceLabel: rel,
    securityMode: 'strict'
  });
  const wasmModule = compileToWasmModuleSkeleton(ast, {
    sourceLabel: rel,
    securityMode: 'strict'
  });
  const nativeModule = compileToNativeSkeleton(ast, {
    sourceLabel: rel,
    securityMode: 'strict'
  });

  assert(typeof webModule === 'string' && webModule.length > 120, `[dali-ir-parity] invalid web module output for ${rel}`);
  assert(typeof wasmModule === 'string' && wasmModule.includes('const __daliIR ='), `[dali-ir-parity] invalid wasm module output for ${rel}`);
  assert(typeof nativeModule === 'string' && nativeModule.includes('// IR Hash:'), `[dali-ir-parity] invalid native module output for ${rel}`);

  console.log(`[dali-ir-parity] ok: ${rel}`);
}

function main() {
  const files = getExampleFiles();
  if (!files.length) {
    console.log('[dali-ir-parity] no web-*.dl/.dali examples found, skipping');
    return;
  }

  for (const sourcePath of files) {
    verifySingleSource(sourcePath);
  }

  console.log(`[dali-ir-parity] PASS (${files.length} modules)`);
}

try {
  main();
} catch (error) {
  console.error(error?.message || error);
  process.exit(1);
}
