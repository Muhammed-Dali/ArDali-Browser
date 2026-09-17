#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const cliPath = path.join(root, 'src', 'cli.js');
const examplesDir = path.join(root, 'examples');
const baselinePath = path.join(root, 'scripts', 'baselines', 'dali-golden-baseline.json');

function hash(text) {
  return crypto.createHash('sha256').update(String(text)).digest('hex');
}

function normalizeGeneratedCode(code) {
  return String(code || '')
    .replace(/"generatedAt"\s*:\s*"[^"]+"/g, '"generatedAt":"<normalized>"')
    .replace(/generatedAt:\s*"[^"]+"/g, 'generatedAt:"<normalized>"');
}

function discoverSources() {
  return fs.readdirSync(examplesDir)
    .filter((name) => /^web-.*\.(dali|dl)$/i.test(name))
    .sort((a, b) => a.localeCompare(b, 'en'))
    .map((name) => path.join(examplesDir, name));
}

function compileSource(sourceFile, target) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dali-golden-'));
  const outFile = path.join(tmpDir, `${path.basename(sourceFile)}.${target}.generated.js`);
  const args = [cliPath, sourceFile, outFile, '--target', target];
  const proc = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8' });
  if (proc.status !== 0) {
    throw new Error(`[golden] compile failed: ${path.relative(root, sourceFile)} (${target})\n${proc.stdout || ''}${proc.stderr || ''}`);
  }
  return fs.readFileSync(outFile, 'utf8');
}

function buildSnapshot() {
  const modules = {};
  for (const source of discoverSources()) {
    const rel = path.relative(root, source).replace(/\\/g, '/');
    const jsCode = normalizeGeneratedCode(compileSource(source, 'js'));
    const wasmCode = normalizeGeneratedCode(compileSource(source, 'wasm'));
    modules[rel] = {
      source: rel,
      js: {
        sha256: hash(jsCode),
        lineCount: jsCode.split('\n').length
      },
      wasm: {
        sha256: hash(wasmCode),
        lineCount: wasmCode.split('\n').length
      }
    };
  }
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    moduleCount: Object.keys(modules).length,
    modules,
    snapshotHash: hash(JSON.stringify(modules))
  };
}

function loadBaseline() {
  if (!fs.existsSync(baselinePath)) return null;
  return JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
}

function saveBaseline(snapshot) {
  fs.mkdirSync(path.dirname(baselinePath), { recursive: true });
  fs.writeFileSync(baselinePath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
}

function compare(base, current) {
  if (base && typeof base.snapshotHash === 'string' && base.snapshotHash === current.snapshotHash) {
    return [];
  }
  const diffs = [];
  const baseKeys = new Set(Object.keys((base && base.modules) || {}));
  const curKeys = new Set(Object.keys(current.modules));

  for (const key of curKeys) {
    if (!baseKeys.has(key)) {
      diffs.push(`+ new: ${key}`);
      continue;
    }
    const b = base.modules[key];
    const c = current.modules[key];
    if (b.js.sha256 !== c.js.sha256) diffs.push(`~ js changed: ${key} (base=${String(b.js.sha256).slice(0, 12)} cur=${String(c.js.sha256).slice(0, 12)})`);
    if (b.wasm.sha256 !== c.wasm.sha256) diffs.push(`~ wasm changed: ${key} (base=${String(b.wasm.sha256).slice(0, 12)} cur=${String(c.wasm.sha256).slice(0, 12)})`);
  }

  for (const key of baseKeys) {
    if (!curKeys.has(key)) diffs.push(`- removed: ${key}`);
  }

  return diffs;
}

function printSummary(snapshot) {
  console.log(`[golden] modules=${snapshot.moduleCount} snapshot=${snapshot.snapshotHash.slice(0, 12)}`);
  for (const [file, mod] of Object.entries(snapshot.modules)) {
    console.log(`  - ${file} | js:${mod.js.sha256.slice(0, 8)} wasm:${mod.wasm.sha256.slice(0, 8)}`);
  }
}

function main() {
  if (!fs.existsSync(cliPath)) throw new Error(`[golden] missing cli: ${cliPath}`);
  if (!fs.existsSync(examplesDir)) throw new Error(`[golden] missing examples: ${examplesDir}`);

  const update = process.argv.includes('--update');
  const snapshot = buildSnapshot();

  if (update) {
    saveBaseline(snapshot);
    console.log(`[golden] baseline updated: ${path.relative(root, baselinePath)}`);
    printSummary(snapshot);
    return;
  }

  const baseline = loadBaseline();
  if (!baseline) {
    throw new Error('[golden] baseline missing. Run: npm run -s dali:test:golden:update');
  }

  printSummary(snapshot);
  const diffs = compare(baseline, snapshot);
  if (diffs.length > 0) {
    console.error('[golden] FAIL: differences detected');
    for (const diff of diffs) console.error(`  ${diff}`);
    console.error('[golden] if intentional: npm run -s dali:test:golden:update');
    process.exit(1);
  }

  console.log('[golden] PASS');
}

try {
  main();
} catch (err) {
  console.error(err && err.message ? err.message : err);
  process.exit(1);
}
