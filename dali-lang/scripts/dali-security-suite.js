'use strict';

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const cli = path.join(root, 'src', 'cli.js');

const cases = [
  {
    label: 'valid-hardened-web-eq32',
    file: path.join(root, 'examples', 'web-eq32-reference.dl'),
    args: ['--hardened'],
    shouldPass: true
  },
  {
    label: 'malicious-unknown-effect',
    args: ['--strict'],
    shouldPass: false,
    source: [
      'preset "Malicious Unknown Effect" {',
      '  engine {',
      '    input: web;',
      '    output: speakers;',
      '    safety: strict;',
      '    profile: realtime;',
      '  }',
      '  chain {',
      '    shellwarp {',
      '      gain: 3db;',
      '    }',
      '  }',
      '  quality {',
      '    sample_rate: 48000;',
      '    max_latency_ms: 20;',
      '    safety: strict;',
      '  }',
      '}'
    ].join('\n')
  },
  {
    label: 'malicious-unsafe-capability',
    args: ['--hardened'],
    shouldPass: false,
    source: [
      'preset "Malicious Unsafe Capability" {',
      '  engine {',
      '    input: web;',
      '    output: speakers;',
      '    safety: strict;',
      '    profile: realtime;',
      '  }',
      '  permissions {',
      '    allow: shell.exec;',
      '  }',
      '  chain {',
      '    preamp {',
      '      gain: -1db;',
      '    }',
      '  }',
      '  quality {',
      '    sample_rate: 48000;',
      '    max_latency_ms: 20;',
      '    safety: strict;',
      '  }',
      '}'
    ].join('\n')
  },
  {
    label: 'malicious-out-of-range-latency',
    args: ['--strict'],
    shouldPass: false,
    source: [
      'preset "Malicious Out Of Range Latency" {',
      '  engine {',
      '    input: web;',
      '    output: speakers;',
      '    safety: strict;',
      '    profile: realtime;',
      '  }',
      '  chain {',
      '    preamp {',
      '      gain: -1db;',
      '    }',
      '  }',
      '  quality {',
      '    sample_rate: 48000;',
      '    max_latency_ms: 250;',
      '    safety: strict;',
      '  }',
      '}'
    ].join('\n')
  },
  {
    label: 'malicious-unsafe-http-task-url',
    args: ['--strict'],
    shouldPass: false,
    source: [
      'preset "Malicious HTTP Task URL" {',
      '  engine {',
      '    input: web;',
      '    output: speakers;',
      '    safety: strict;',
      '    profile: realtime;',
      '  }',
      '  permissions {',
      '    allow: media.analyze;',
      '  }',
      '  chain {',
      '    preamp { gain: -1db; }',
      '  }',
      '  task "http-task" {',
      '    source {',
      '      provider: youtube;',
      '      url: "http://example.com/insecure";',
      '      mode: metadata_only;',
      '    }',
      '    process {',
      '      preamp { gain: -1db; }',
      '    }',
      '    output {',
      '      profile: music;',
      '      max_latency_ms: 12;',
      '    }',
      '  }',
      '  quality {',
      '    sample_rate: 48000;',
      '    max_latency_ms: 20;',
      '    safety: strict;',
      '  }',
      '}'
    ].join('\n')
  },
  {
    label: 'malicious-hardened-missing-capability',
    args: ['--hardened'],
    shouldPass: false,
    source: [
      'preset "Malicious Hardened Missing Capability" {',
      '  engine {',
      '    input: web;',
      '    output: speakers;',
      '    safety: strict;',
      '    profile: realtime;',
      '  }',
      '  chain {',
      '    preamp { gain: -1db; }',
      '  }',
      '  task "missing-allow" {',
      '    source {',
      '      provider: youtube;',
      '      url: "https://example.com/track";',
      '      mode: metadata_only;',
      '    }',
      '    process {',
      '      preamp { gain: -1db; }',
      '    }',
      '    output {',
      '      profile: music;',
      '      max_latency_ms: 20;',
      '    }',
      '  }',
      '  quality {',
      '    sample_rate: 48000;',
      '    max_latency_ms: 20;',
      '    safety: strict;',
      '  }',
      '}'
    ].join('\n')
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
