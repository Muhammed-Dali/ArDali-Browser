'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function defaultCacheDir(rootDir = process.cwd()) {
  return path.resolve(rootDir, '.cache', 'dali-ir');
}

function hashSource(sourceText) {
  return crypto.createHash('sha256').update(String(sourceText || ''), 'utf8').digest('hex');
}

function readJsonFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

function writeJsonFile(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data), 'utf8');
}

function loadOrCreateCachedIR({ sourceText, sourceLabel = '', rootDir = process.cwd(), buildIR, useCache = true }) {
  if (typeof buildIR !== 'function') {
    throw new Error('buildIR callback is required');
  }
  const srcHash = hashSource(sourceText);
  const cacheDir = defaultCacheDir(rootDir);
  const cachePath = path.join(cacheDir, `${srcHash}.json`);

  if (useCache && fs.existsSync(cachePath)) {
    try {
      const payload = readJsonFile(cachePath);
      if (payload && payload.sourceHash === srcHash && payload.ir) {
        return {
          cacheHit: true,
          sourceHash: srcHash,
          cachePath,
          ir: payload.ir
        };
      }
    } catch {
      // corrupted cache ignored
    }
  }

  const ir = buildIR();
  const payload = {
    sourceHash: srcHash,
    sourceLabel: String(sourceLabel || ''),
    ir,
    cachedAt: new Date().toISOString()
  };
  writeJsonFile(cachePath, payload);
  return {
    cacheHit: false,
    sourceHash: srcHash,
    cachePath,
    ir
  };
}

module.exports = {
  defaultCacheDir,
  hashSource,
  loadOrCreateCachedIR
};
