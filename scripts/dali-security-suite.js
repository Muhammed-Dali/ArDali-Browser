'use strict';

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const cli = path.join(root, 'dali-lang', 'src', 'cli.js');

const cases = [
  {
    label: 'valid-hardened-web-eq32',
    file: path.join(root, 'dali-lang', 'examples', 'web-eq32-reference.dl'),
    args: ['--hardened'],
    shouldPass: true
  },
  {
    label: 'malicious-unknown-effect',
    file: path.join(root, 'dali-lang', 'spec', 'malicious-presets', 'unknown-effect.dl'),
    args: ['--strict'],
    shouldPass: false
  },
  {
    label: 'malicious-unsafe-capability',
    file: path.join(root, 'dali-lang', 'spec', 'malicious-presets', 'unsafe-capability.dl'),
    args: ['--hardened'],
    shouldPass: false
  },
  {
    label: 'malicious-out-of-range-latency',
    file: path.join(root, 'dali-lang', 'spec', 'malicious-presets', 'out-of-range-latency.dl'),
    args: ['--strict'],
    shouldPass: false
  },
  {
    label: 'malicious-unsafe-http-task-url',
    file: path.join(root, 'dali-lang', 'spec', 'malicious-presets', 'unsafe-http-task-url.dl'),
    args: ['--strict'],
    shouldPass: false
  },
  {
    label: 'malicious-hardened-missing-capability',
    file: path.join(root, 'dali-lang', 'spec', 'malicious-presets', 'hardened-missing-capability.dl'),
    args: ['--hardened'],
    shouldPass: false
  },
  {
    label: 'malicious-invalid-unit',
    args: ['--strict'],
    shouldPass: false,
    source: [
      'preset "Malicious Invalid Unit" {',
      '  engine {',
      '    input: web;',
      '    output: speakers;',
      '    safety: strict;',
      '    profile: realtime;',
      '  }',
      '  chain {',
      '    preamp {',
      '      gain: 3khz;',
      '    }',
      '  }',
      '  quality {',
      '    sample_rate: 48000;',
      '    max_latency_ms: 20;',
      '    safety: strict;',
      '  }',
      '}'
    ].join('\n')
  }
];

function runCase(testCase) {
  const inputFile = testCase.file || path.join('/tmp', `dali-security-${testCase.label}.dl`);
  if (!testCase.file && testCase.source) {
    fs.writeFileSync(inputFile, String(testCase.source), 'utf8');
  }
  const outFile = path.join('/tmp', `dali-security-${testCase.label}.generated.js`);
  const proc = spawnSync(
    process.execPath,
    [cli, inputFile, outFile, ...testCase.args],
    { encoding: 'utf8' }
  );
  const ok = proc.status === 0;
  const pass = testCase.shouldPass ? ok : !ok;
  const state = pass ? 'PASS' : 'FAIL';
  const expected = testCase.shouldPass ? 'success' : 'failure';
  console.log(`[${state}] ${testCase.label} expected=${expected} exit=${proc.status}`);
  if (!pass) {
    if (proc.stdout) console.log(proc.stdout.trim());
    if (proc.stderr) console.error(proc.stderr.trim());
  }
  return pass;
}

function main() {
  let failed = 0;
  for (const t of cases) {
    if (!runCase(t)) failed += 1;
  }
  if (failed > 0) {
    console.error(`[dali-security-suite] failed=${failed}/${cases.length}`);
    process.exit(1);
  }
  console.log(`[dali-security-suite] all ${cases.length} cases passed`);
}

main();
