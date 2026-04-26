#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cp = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const MANIFEST_PATH = path.join(ROOT, 'third_party', 'binary-manifest.json');

function fail(msg) {
  console.error(`\n[verify:binary-manifest] FAIL: ${msg}`);
  process.exit(1);
}

function sha256File(absPath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(absPath));
  return hash.digest('hex');
}

function getTrackedSharedObjects() {
  let out = '';
  try {
    out = cp.execFileSync('git', ['ls-files', '*.so', '*.so.*'], {
      cwd: ROOT,
      encoding: 'utf8'
    });
  } catch (err) {
    // Some restricted sandboxes may raise EPERM even when subprocess output is available.
    if (err && err.status === 0 && typeof err.stdout === 'string') {
      out = err.stdout;
    } else {
      throw err;
    }
  }
  out = out.trim();
  if (!out) return [];
  return out.split(/\r?\n/).map((x) => x.trim()).filter(Boolean).sort();
}

if (!fs.existsSync(MANIFEST_PATH)) {
  fail(`manifest not found: ${MANIFEST_PATH}`);
}

const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
const entries = Array.isArray(manifest.entries) ? manifest.entries : [];
if (!entries.length) {
  fail('manifest.entries is empty');
}

const manifestPaths = entries.map((e) => e.path).sort();
const trackedPaths = getTrackedSharedObjects();

const missingFromManifest = trackedPaths.filter((p) => !manifestPaths.includes(p));
const staleInManifest = manifestPaths.filter((p) => !trackedPaths.includes(p));

if (missingFromManifest.length || staleInManifest.length) {
  if (missingFromManifest.length) {
    console.error('[verify:binary-manifest] Paths tracked in git but missing in manifest:');
    for (const p of missingFromManifest) console.error(`  - ${p}`);
  }
  if (staleInManifest.length) {
    console.error('[verify:binary-manifest] Paths in manifest but not tracked in git:');
    for (const p of staleInManifest) console.error(`  - ${p}`);
  }
  fail('manifest path set mismatch');
}

let ok = true;
for (const entry of entries) {
  const rel = String(entry.path || '').trim();
  const expected = String(entry.sha256 || '').trim().toLowerCase();
  const abs = path.join(ROOT, rel);

  if (!rel || !expected) {
    console.error(`[verify:binary-manifest] Invalid entry: ${JSON.stringify(entry)}`);
    ok = false;
    continue;
  }

  if (!fs.existsSync(abs)) {
    console.error(`[verify:binary-manifest] Missing file: ${rel}`);
    ok = false;
    continue;
  }

  const actual = sha256File(abs);
  if (actual !== expected) {
    console.error(`[verify:binary-manifest] Hash mismatch: ${rel}`);
    console.error(`  expected: ${expected}`);
    console.error(`  actual:   ${actual}`);
    ok = false;
  } else {
    console.log(`[verify:binary-manifest] OK ${rel}`);
  }
}

if (!ok) {
  fail('one or more binary integrity checks failed');
}

console.log(`\n[verify:binary-manifest] PASS: ${entries.length} files verified.`);
