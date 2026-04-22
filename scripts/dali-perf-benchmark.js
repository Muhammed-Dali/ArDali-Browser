#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');

const { parseDali } = require('../dali-lang/src/parser');
const { validateSourceLimits, validateProgramSecurity } = require('../dali-lang/src/security-validator');
const { createProgramIR } = require('../dali-lang/src/ir');
const { compileToWebAudioModule } = require('../dali-lang/src/compiler-web-audio');
const { compileToWasmModuleSkeleton } = require('../dali-lang/src/compiler-wasm');

const root = path.resolve(__dirname, '..');
const examplesDir = path.join(root, 'dali-lang', 'examples');
const budgetPath = path.join(root, 'scripts', 'baselines', 'dali-perf-budget.json');
const snapshotPath = path.join(root, 'scripts', 'baselines', 'dali-perf-last-run.json');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[rank];
}

function stats(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  const sum = sorted.reduce((acc, x) => acc + x, 0);
  return {
    count: sorted.length,
    mean: sorted.length ? sum / sorted.length : 0,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    max: sorted.length ? sorted[sorted.length - 1] : 0
  };
}

function ms(start) {
  return performance.now() - start;
}

function discoverSources() {
  return fs.readdirSync(examplesDir)
    .filter((name) => /^web-.*\.(dl|dali)$/i.test(name))
    .sort((a, b) => a.localeCompare(b, 'en'))
    .map((name) => path.join(examplesDir, name));
}

function readBudget() {
  if (!fs.existsSync(budgetPath)) {
    throw new Error(`[dali-perf] missing budget file: ${path.relative(root, budgetPath)}`);
  }
  const budget = JSON.parse(fs.readFileSync(budgetPath, 'utf8'));
  return budget;
}

function benchmarkSource(sourcePath, iterations, warmup) {
  const sourceRel = path.relative(root, sourcePath).replace(/\\/g, '/');
  const source = fs.readFileSync(sourcePath, 'utf8');

  const parseTimes = [];
  const irTimes = [];
  const compileWebTimes = [];
  const compileWasmTimes = [];

  for (let i = 0; i < warmup + iterations; i += 1) {
    let t0 = performance.now();
    validateSourceLimits(source, path.basename(sourcePath));
    const ast = parseDali(source);
    const parseMs = ms(t0);

    t0 = performance.now();
    validateProgramSecurity(ast, { mode: 'strict' });
    createProgramIR(ast, {
      sourceLabel: sourceRel,
      securityMode: 'strict',
      targetClass: 'hybrid',
      includeTimestamp: false
    });
    const irMs = ms(t0);

    t0 = performance.now();
    compileToWebAudioModule(ast, { sourceLabel: sourceRel, securityMode: 'strict' });
    const webMs = ms(t0);

    t0 = performance.now();
    compileToWasmModuleSkeleton(ast, { sourceLabel: sourceRel, securityMode: 'strict' });
    const wasmMs = ms(t0);

    if (i >= warmup) {
      parseTimes.push(parseMs);
      irTimes.push(irMs);
      compileWebTimes.push(webMs);
      compileWasmTimes.push(wasmMs);
    }
  }

  return {
    source: sourceRel,
    parse: stats(parseTimes),
    ir: stats(irTimes),
    compile_web: stats(compileWebTimes),
    compile_wasm: stats(compileWasmTimes)
  };
}

function enforceBudgets(report, budget) {
  const limits = budget?.limits || {};
  const failures = [];

  const maxParseP95 = Number(limits.parse_ms_p95) || 0;
  const maxIrP95 = Number(limits.ir_ms_p95) || 0;
  const maxWebP95 = Number(limits.compile_web_ms_p95) || 0;
  const maxWasmP95 = Number(limits.compile_wasm_ms_p95) || 0;

  for (const module of report.modules) {
    if (maxParseP95 > 0 && module.parse.p95 > maxParseP95) {
      failures.push(`${module.source}: parse p95 ${module.parse.p95.toFixed(2)}ms > ${maxParseP95}ms`);
    }
    if (maxIrP95 > 0 && module.ir.p95 > maxIrP95) {
      failures.push(`${module.source}: ir p95 ${module.ir.p95.toFixed(2)}ms > ${maxIrP95}ms`);
    }
    if (maxWebP95 > 0 && module.compile_web.p95 > maxWebP95) {
      failures.push(`${module.source}: compile_web p95 ${module.compile_web.p95.toFixed(2)}ms > ${maxWebP95}ms`);
    }
    if (maxWasmP95 > 0 && module.compile_wasm.p95 > maxWasmP95) {
      failures.push(`${module.source}: compile_wasm p95 ${module.compile_wasm.p95.toFixed(2)}ms > ${maxWasmP95}ms`);
    }
  }

  if (failures.length) {
    throw new Error(`[dali-perf] budget exceeded:\n- ${failures.join('\n- ')}`);
  }
}

function main() {
  const args = new Set(process.argv.slice(2));
  const quick = args.has('--quick');

  const iterations = quick ? 6 : 14;
  const warmup = quick ? 1 : 3;

  const files = discoverSources();
  if (!files.length) {
    console.log('[dali-perf] no web-*.dl/.dali examples found, skipping');
    return;
  }

  const budget = readBudget();
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    iterations,
    warmup,
    modules: files.map((file) => benchmarkSource(file, iterations, warmup))
  };

  fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
  fs.writeFileSync(snapshotPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  report.modules.forEach((mod) => {
    console.log(
      `[dali-perf] ${mod.source} :: parse p95=${mod.parse.p95.toFixed(2)}ms | ir p95=${mod.ir.p95.toFixed(2)}ms | web p95=${mod.compile_web.p95.toFixed(2)}ms | wasm p95=${mod.compile_wasm.p95.toFixed(2)}ms`
    );
  });

  enforceBudgets(report, budget);
  console.log(`[dali-perf] PASS (budget file: ${path.relative(root, budgetPath)})`);
}

try {
  main();
} catch (error) {
  console.error(error?.message || error);
  process.exit(1);
}
