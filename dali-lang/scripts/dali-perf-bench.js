#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { parseDali } = require('../src/parser');
const { createProgramIR } = require('../src/ir');
const { compileToWebAudioModule } = require('../src/compiler-web-audio');
const { compileToWasmModuleSkeleton } = require('../src/compiler-wasm');

const root = path.resolve(__dirname, '..');
const examplesDir = path.join(root, 'examples');

function nowNs() {
  return process.hrtime.bigint();
}

function toMs(ns) {
  return Number(ns) / 1e6;
}

function discoverSources() {
  return fs.readdirSync(examplesDir)
    .filter((name) => /^web-.*\.(dali|dl)$/i.test(name))
    .sort((a, b) => a.localeCompare(b, 'en'))
    .map((name) => path.join(examplesDir, name));
}

function benchOne(label, fn, loops) {
  const times = [];
  for (let i = 0; i < loops; i += 1) {
    const t0 = nowNs();
    fn();
    const dt = nowNs() - t0;
    times.push(toMs(dt));
  }
  times.sort((a, b) => a - b);
  const sum = times.reduce((acc, v) => acc + v, 0);
  const avg = sum / times.length;
  const p50 = times[Math.floor(times.length * 0.5)];
  const p95 = times[Math.floor(times.length * 0.95)];
  console.log(`${label.padEnd(26)} avg=${avg.toFixed(3)}ms p50=${p50.toFixed(3)}ms p95=${p95.toFixed(3)}ms`);
}

function main() {
  const loopsArg = Number(process.argv[2] || 30);
  const loops = Number.isFinite(loopsArg) && loopsArg > 0 ? Math.floor(loopsArg) : 30;
  const sources = discoverSources();
  if (!sources.length) throw new Error('[perf] no web-*.dali/.dl examples found');

  console.log(`[perf] loops=${loops} modules=${sources.length}`);
  for (const sourceFile of sources) {
    const rel = path.relative(root, sourceFile).replace(/\\/g, '/');
    const source = fs.readFileSync(sourceFile, 'utf8');
    const ast = parseDali(source);

    console.log(`\n[perf] ${rel}`);
    benchOne('parseDali', () => parseDali(source), loops);
    benchOne('createProgramIR(v2)', () => createProgramIR(ast, { sourceLabel: rel, securityMode: 'strict', targetClass: 'bench' }), loops);
    benchOne('compileToWebAudioModule', () => compileToWebAudioModule(ast, { securityMode: 'strict' }), loops);
    benchOne('compileToWasmModule', () => compileToWasmModuleSkeleton(ast, { sourceLabel: rel, securityMode: 'strict' }), loops);
  }

  console.log('\n[perf] NOTE: underrun/CPU/glitch benchmarks require realtime host integration (AudioWorklet/native).');
}

try {
  main();
} catch (err) {
  console.error(err && err.message ? err.message : err);
  process.exit(1);
}
