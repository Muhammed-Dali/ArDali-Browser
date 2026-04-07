'use strict';

const crypto = require('crypto');

function inferUnitKind(unit) {
  const u = String(unit || '').toLowerCase();
  if (u === 'hz') return 'frequency';
  if (u === 'ms') return 'time';
  if (u === 'db') return 'gain_db';
  if (u === '%') return 'percent';
  if (u === 'x') return 'multiplier';
  return 'scalar';
}

function normalizeLiteral(literal) {
  if (!literal || typeof literal !== 'object') return { type: 'ident', value: '' };
  if (literal.type === 'number') {
    const value = Number(literal.value);
    const unit = String(literal.unit || '').toLowerCase();
    return {
      type: 'number',
      value,
      unit,
      typed: {
        kind: 'numeric',
        unitKind: inferUnitKind(unit),
        finite: Number.isFinite(value)
      }
    };
  }
  if (literal.type === 'string' || literal.type === 'ident') {
    return {
      type: literal.type,
      value: String(literal.value || ''),
      typed: {
        kind: literal.type === 'string' ? 'string' : 'identifier'
      }
    };
  }
  return {
    type: String(literal.type || 'ident'),
    value: String(literal.value || ''),
    typed: {
      kind: 'unknown'
    }
  };
}

function normalizeParams(params) {
  const out = {};
  const keys = Object.keys(params || {}).sort((a, b) => a.localeCompare(b));
  for (const key of keys) out[key] = normalizeLiteral(params[key]);
  return out;
}

function normalizeChain(chain) {
  const list = Array.isArray(chain) ? chain : [];
  return list.map((fx, index) => ({
    id: index,
    effect: String(fx?.effect || '').trim().toLowerCase(),
    params: normalizeParams(fx?.params || {})
  }));
}

function normalizeQuality(quality) {
  const out = {};
  const keys = Object.keys(quality || {}).sort((a, b) => a.localeCompare(b));
  for (const key of keys) out[key] = normalizeLiteral(quality[key]);
  return out;
}

function normalizePermissions(permissions) {
  const allow = Array.isArray(permissions?.allow) ? permissions.allow : [];
  const deny = Array.isArray(permissions?.deny) ? permissions.deny : [];
  return {
    allow: allow.map((x) => String(x || '').trim().toLowerCase()).sort((a, b) => a.localeCompare(b)),
    deny: deny.map((x) => String(x || '').trim().toLowerCase()).sort((a, b) => a.localeCompare(b))
  };
}

function normalizeTasks(tasks) {
  const list = Array.isArray(tasks) ? tasks : [];
  return list.map((task, index) => ({
    id: index,
    name: String(task?.name || '').trim(),
    source: {
      provider: normalizeLiteral(task?.source?.provider),
      url: normalizeLiteral(task?.source?.url),
      mode: normalizeLiteral(task?.source?.mode)
    },
    process: normalizeChain(task?.process || []),
    output: {
      profile: normalizeLiteral(task?.output?.profile),
      max_latency_ms: normalizeLiteral(task?.output?.max_latency_ms)
    }
  }));
}

function createProgramIR(ast, options = {}) {
  const presets = Array.isArray(ast?.presets) ? ast.presets : [];
  const ir = {
    irVersion: 1,
    language: 'dali',
    generatedAt: new Date().toISOString(),
    sourceLabel: String(options.sourceLabel || ''),
    presetCount: presets.length,
    presets: presets.map((preset, index) => ({
      id: index,
      name: String(preset?.name || ''),
      io: {
        input: String(preset?.input || '').trim().toLowerCase(),
        output: String(preset?.output || '').trim().toLowerCase()
      },
      quality: normalizeQuality(preset?.quality || {}),
      chain: normalizeChain(preset?.chain || []),
      permissions: normalizePermissions(preset?.permissions || {}),
      tasks: normalizeTasks(preset?.tasks || [])
    }))
  };
  return ir;
}

function hashIR(ir) {
  const json = JSON.stringify(ir);
  return crypto.createHash('sha256').update(json).digest('hex');
}

module.exports = {
  createProgramIR,
  hashIR
};
