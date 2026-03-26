#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const examplesDir = path.join(root, 'dali-lang', 'examples');
const cliPath = path.join(root, 'dali-lang', 'src', 'cli.js');
const baselinePath = path.join(root, 'scripts', 'baselines', 'dali-web-regression-baseline.json');

const args = new Set(process.argv.slice(2));
const shouldUpdate = args.has('--update');

function hash(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function stableStringify(obj) {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return `[${obj.map((v) => stableStringify(v)).join(',')}]`;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

function parseQualityKeys(code) {
  const m = code.match(/quality:\s*({[\s\S]*?})\s*,\s*buildGraph:/);
  if (!m) return [];
  const keys = [];
  const keyRe = /"([^"]+)"\s*:/g;
  let km;
  while ((km = keyRe.exec(m[1])) !== null) {
    keys.push(km[1]);
  }
  return Array.from(new Set(keys)).sort();
}

function collectRegexValues(code, re, mapper) {
  const out = [];
  let m;
  while ((m = re.exec(code)) !== null) {
    out.push(mapper(m));
  }
  return out;
}

function buildSignature(sourceFile, generatedCode) {
  const nodeCtorCounts = Object.create(null);
  collectRegexValues(
    generatedCode,
    /new\s+([A-Za-z0-9_]+Node)\s*\(/g,
    (m) => m[1]
  ).forEach((name) => {
    nodeCtorCounts[name] = (nodeCtorCounts[name] || 0) + 1;
  });

  const safeConnectCount = (generatedCode.match(/__safeConnect\(/g) || []).length;

  const biquadShape = collectRegexValues(
    generatedCode,
    /new\s+BiquadFilterNode\([^\n]*?\{\s*type:\s*'([^']+)'\s*,\s*frequency:\s*([0-9.]+)\s*,\s*gain:\s*([\-0-9.]+)\s*,\s*Q:\s*([0-9.]+)\s*\}\)/g,
    (m) => `${m[1]}:${m[2]}:${m[3]}:${m[4]}`
  );

  const compressorShape = collectRegexValues(
    generatedCode,
    /new\s+DynamicsCompressorNode\([^\n]*?\{\s*threshold:\s*([\-0-9.]+)\s*,\s*ratio:\s*([\-0-9.]+)\s*,\s*attack:\s*([\-0-9.]+)\s*,\s*release:\s*([\-0-9.]+)\s*,\s*knee:\s*([\-0-9.]+)\s*\}\)/g,
    (m) => `${m[1]}:${m[2]}:${m[3]}:${m[4]}:${m[5]}`
  );

  const gainShape = collectRegexValues(
    generatedCode,
    /new\s+GainNode\([^\n]*?\{\s*gain:\s*([\-0-9.]+)\s*\}\)/g,
    (m) => m[1]
  );

  const presetNameMatch = generatedCode.match(/presetName:\s*"([^"]+)"/);
  const backendMatch = generatedCode.match(/backend:\s*"([^"]+)"/);

  const signature = {
    sourceFile,
    presetName: presetNameMatch ? presetNameMatch[1] : null,
    backend: backendMatch ? backendMatch[1] : null,
    lineCount: generatedCode.split('\n').length,
    nodeCtorCounts,
    safeConnectCount,
    qualityKeys: parseQualityKeys(generatedCode),
    hashes: {
      fullCodeSha256: hash(generatedCode),
      biquadShapeSha256: hash(biquadShape.join('|')),
      compressorShapeSha256: hash(compressorShape.join('|')),
      gainShapeSha256: hash(gainShape.join('|')),
      graphShapeSha256: hash(`${safeConnectCount}|${stableStringify(nodeCtorCounts)}`)
    },
    stats: {
      biquadCount: biquadShape.length,
      compressorCount: compressorShape.length,
      gainNodeCount: gainShape.length
    }
  };

  signature.signatureSha256 = hash(stableStringify(signature));
  return signature;
}

function compileToTemp(sourceFile) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aurivo-dali-reg-'));
  const outFile = path.join(tmpDir, `${path.basename(sourceFile)}.generated.js`);
  const proc = spawnSync(process.execPath, [cliPath, sourceFile, outFile], {
    cwd: root,
    encoding: 'utf8'
  });
  if (proc.status !== 0) {
    throw new Error(
      `[regression] compile failed for ${path.relative(root, sourceFile)}\n${proc.stdout || ''}${proc.stderr || ''}`
    );
  }
  const code = fs.readFileSync(outFile, 'utf8');
  return { code, outFile };
}

function discoverSources() {
  return fs
    .readdirSync(examplesDir)
    .filter((name) => /^web-.*\.(dl|dali)$/i.test(name))
    .sort((a, b) => a.localeCompare(b, 'en'))
    .map((name) => path.join(examplesDir, name));
}

function buildCurrentSnapshot() {
  const sources = discoverSources();
  const modules = Object.create(null);

  for (const sourceFile of sources) {
    const rel = path.relative(root, sourceFile).replace(/\\/g, '/');
    const { code } = compileToTemp(sourceFile);
    modules[rel] = buildSignature(rel, code);
  }

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    moduleCount: Object.keys(modules).length,
    modules,
    snapshotHash: hash(stableStringify(modules))
  };
}

function readBaseline() {
  if (!fs.existsSync(baselinePath)) return null;
  return JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
}

function writeBaseline(snapshot) {
  fs.mkdirSync(path.dirname(baselinePath), { recursive: true });
  fs.writeFileSync(baselinePath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
}

function diffSnapshots(base, current) {
  const diffs = [];
  const baseKeys = new Set(Object.keys((base && base.modules) || {}));
  const curKeys = new Set(Object.keys(current.modules));

  for (const key of curKeys) {
    if (!baseKeys.has(key)) {
      diffs.push(`+ new module: ${key}`);
      continue;
    }
    const b = base.modules[key];
    const c = current.modules[key];
    if (b.signatureSha256 !== c.signatureSha256) {
      diffs.push(`~ changed: ${key}`);
      if ((b && b.hashes && b.hashes.graphShapeSha256) !== (c && c.hashes && c.hashes.graphShapeSha256)) {
        diffs.push(`  - graph shape changed`);
      }
      if ((b && b.hashes && b.hashes.biquadShapeSha256) !== (c && c.hashes && c.hashes.biquadShapeSha256)) {
        diffs.push(`  - biquad settings changed`);
      }
      if ((b && b.hashes && b.hashes.compressorShapeSha256) !== (c && c.hashes && c.hashes.compressorShapeSha256)) {
        diffs.push(`  - compressor settings changed`);
      }
      if ((b && b.hashes && b.hashes.gainShapeSha256) !== (c && c.hashes && c.hashes.gainShapeSha256)) {
        diffs.push(`  - gain settings changed`);
      }
      if ((b && b.hashes && b.hashes.fullCodeSha256) !== (c && c.hashes && c.hashes.fullCodeSha256)) {
        diffs.push(`  - generated code changed`);
      }
    }
  }

  for (const key of baseKeys) {
    if (!curKeys.has(key)) {
      diffs.push(`- removed module: ${key}`);
    }
  }

  return diffs;
}

function printSnapshotSummary(snapshot) {
  console.log(`[regression] modules: ${snapshot.moduleCount}`);
  for (const [source, sig] of Object.entries(snapshot.modules)) {
    const nodes = Object.entries(sig.nodeCtorCounts)
      .map(([k, v]) => `${k}:${v}`)
      .join(', ');
    console.log(`  - ${source} | ${sig.presetName || 'unknown'} | nodes(${nodes}) | links:${sig.safeConnectCount}`);
  }
}

function main() {
  if (!fs.existsSync(cliPath)) {
    throw new Error(`[regression] missing cli: ${cliPath}`);
  }
  if (!fs.existsSync(examplesDir)) {
    throw new Error(`[regression] missing examples dir: ${examplesDir}`);
  }

  const snapshot = buildCurrentSnapshot();

  if (shouldUpdate) {
    writeBaseline(snapshot);
    console.log(`[regression] baseline updated: ${path.relative(root, baselinePath)}`);
    printSnapshotSummary(snapshot);
    return;
  }

  const baseline = readBaseline();
  if (!baseline) {
    throw new Error(
      `[regression] baseline not found. Run: npm run -s dali:test:regression:update`
    );
  }

  const diffs = diffSnapshots(baseline, snapshot);
  printSnapshotSummary(snapshot);

  if (diffs.length > 0) {
    console.error('[regression] FAIL: differences detected against baseline');
    for (const d of diffs) console.error(`  ${d}`);
    console.error('[regression] if these changes are intentional, update baseline: npm run -s dali:test:regression:update');
    process.exit(1);
  }

  console.log('[regression] PASS: snapshot matches baseline');
}

try {
  main();
} catch (err) {
  console.error(err && err.message ? err.message : err);
  process.exit(1);
}
