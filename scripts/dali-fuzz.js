#!/usr/bin/env node
'use strict';

const { parseDali } = require('../dali-lang/src/parser');
const { validateSourceLimits, validateProgramSecurity } = require('../dali-lang/src/security-validator');
const { compileToWebAudioModule } = require('../dali-lang/src/compiler-web-audio');
const { compileToWasmModuleSkeleton } = require('../dali-lang/src/compiler-wasm');
const { createProgramIR } = require('../dali-lang/src/ir');

function createRng(seedInput) {
  let s = (Number(seedInput) >>> 0) || 0x9e3779b9;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 0xffffffff;
  };
}

function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)] || arr[0];
}

function randInt(rng, min, max) {
  return Math.floor(rng() * (max - min + 1)) + min;
}

function randFixed(rng, min, max, digits = 2) {
  const n = min + (max - min) * rng();
  return Number(n.toFixed(digits));
}

function buildEffect(rng) {
  const effects = ['preamp', 'low_shelf', 'peaking', 'high_shelf', 'compressor', 'limiter'];
  const effect = pick(rng, effects);

  if (effect === 'preamp') {
    return `  preamp {\n    gain: ${randFixed(rng, -18, 18, 1)}db;\n  }`;
  }
  if (effect === 'low_shelf' || effect === 'peaking' || effect === 'high_shelf') {
    return `  ${effect} {\n    freq: ${randInt(rng, 20, 18000)}hz;\n    gain: ${randFixed(rng, -12, 12, 1)}db;\n    q: ${randFixed(rng, 0.2, 6.0, 2)};\n  }`;
  }
  if (effect === 'compressor') {
    return `  compressor {\n    threshold: ${randFixed(rng, -48, -1, 1)}db;\n    ratio: ${randFixed(rng, 1.0, 12.0, 2)};\n    attack: ${randFixed(rng, 0.1, 80, 1)}ms;\n    release: ${randFixed(rng, 5, 600, 1)}ms;\n    knee: ${randFixed(rng, 0, 12, 1)}db;\n    makeup: ${randFixed(rng, -6, 12, 1)}db;\n  }`;
  }

  return `  limiter {\n    ceiling: ${randFixed(rng, -8, -0.2, 1)}db;\n    attack: ${randFixed(rng, 0.1, 25, 1)}ms;\n    release: ${randFixed(rng, 10, 900, 1)}ms;\n  }`;
}

function generateValidProgram(rng, id) {
  const chainCount = randInt(rng, 1, 14);
  const chainBlocks = [];
  for (let i = 0; i < chainCount; i += 1) {
    chainBlocks.push(buildEffect(rng));
  }

  const sampleRate = pick(rng, [44100, 48000, 96000]);
  const latency = randInt(rng, 10, 80);
  const safety = pick(rng, ['strict', 'safe']);
  const profile = pick(rng, ['balanced', 'realtime']);

  return [
    `preset "fuzz_${id}" {`,
    '  engine {',
    '    input: web;',
    '    output: speakers;',
    `    safety: ${safety};`,
    `    profile: ${profile};`,
    '  }',
    '  chain {',
    chainBlocks.join('\n'),
    '  }',
    '  quality {',
    `    sample_rate: ${sampleRate};`,
    `    max_latency_ms: ${latency}ms;`,
    `    backend: ${pick(rng, ['webaudio', 'audioworklet'])};`,
    '  }',
    '}'
  ].join('\n');
}

function generateAdversarialInputs() {
  const deepNested = `preset "deep" {\n  chain {\n${'x {\n'.repeat(90)}gain = 1;\n${'}\n'.repeat(90)}  }\n}`;
  const hugeLine = `preset "huge" {\n  chain {\n    preamp gain = 1;\n  }\n}\n${'a'.repeat(270000)}`;
  const malformed = 'preset "bad" { chain { preamp { gain: 2db; }';
  return [deepNested, hugeLine, malformed];
}

function runValidCase(source, label) {
  validateSourceLimits(source, label);
  const ast = parseDali(source);
  validateProgramSecurity(ast, { mode: 'strict' });
  compileToWebAudioModule(ast, { sourceLabel: label, securityMode: 'strict' });
  compileToWasmModuleSkeleton(ast, { sourceLabel: label, securityMode: 'strict' });
  createProgramIR(ast, { sourceLabel: label, securityMode: 'strict', targetClass: 'hybrid', includeTimestamp: false });
}

function main() {
  const args = process.argv.slice(2);
  const seedArg = args.find((x) => x.startsWith('--seed='));
  const casesArg = args.find((x) => x.startsWith('--cases='));

  const seed = seedArg ? Number(seedArg.split('=')[1]) : 1337;
  const totalCases = casesArg ? Math.max(10, Math.min(400, Number(casesArg.split('=')[1]) || 160)) : 160;
  const rng = createRng(seed);

  let validOk = 0;
  for (let i = 0; i < totalCases; i += 1) {
    const source = generateValidProgram(rng, i + 1);
    runValidCase(source, `fuzz_valid_${i + 1}.dl`);
    validOk += 1;
  }

  const adversarial = generateAdversarialInputs();
  let rejected = 0;
  adversarial.forEach((input, index) => {
    try {
      validateSourceLimits(input, `fuzz_adversarial_${index + 1}.dl`);
      const ast = parseDali(input);
      validateProgramSecurity(ast, { mode: 'strict' });
      throw new Error(`[dali-fuzz] adversarial case unexpectedly accepted: #${index + 1}`);
    } catch (_) {
      rejected += 1;
    }
  });

  console.log(`[dali-fuzz] PASS seed=${seed} valid_ok=${validOk} adversarial_rejected=${rejected}/${adversarial.length}`);
}

try {
  main();
} catch (error) {
  console.error(error?.message || error);
  process.exit(1);
}
