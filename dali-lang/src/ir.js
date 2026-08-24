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

function inferParamSemanticType(paramKey, literal) {
  const key = String(paramKey || '').trim().toLowerCase();
  if (!literal || typeof literal !== 'object') return 'unknown';
  if (literal.type === 'string') return 'string';
  if (literal.type === 'ident') return 'identifier';
  if (literal.type !== 'number') return 'unknown';

  const unit = String(literal.unit || '').toLowerCase();
  if (unit === 'hz' || key.includes('freq')) return 'frequency_hz';
  if (unit === 'ms' || key.includes('attack') || key.includes('release') || key.includes('latency')) return 'time_ms';
  if (unit === 'db' || key.includes('gain') || key.includes('threshold') || key.includes('ceiling') || key.includes('knee')) return 'gain_db';
  if (unit === '%' || key.includes('mix') || key.includes('amount')) return 'ratio_percent';
  if (key.includes('ratio')) return 'ratio_scalar';
  if (key.includes('q')) return 'q_factor';
  return 'numeric_scalar';
}

function enrichParamTyping(params) {
  const out = {};
  const keys = Object.keys(params || {}).sort((a, b) => a.localeCompare(b));
  for (const key of keys) {
    const literal = params[key];
    const normalized = normalizeLiteral(literal);
    out[key] = {
      ...normalized,
      semanticType: inferParamSemanticType(key, normalized)
    };
  }
  return out;
}

function estimateStageLatencyMs(effectName, params) {
  const effect = String(effectName || '').trim().toLowerCase();
  if (effect === 'preamp') return 0.02;
  if (effect === 'low_shelf' || effect === 'peaking' || effect === 'high_shelf') return 0.08;
  if (effect === 'compressor') {
    const attack = Number(params?.attack?.value);
    if (Number.isFinite(attack)) return Math.max(0.1, Math.min(10, attack * 0.04));
    return 0.6;
  }
  if (effect === 'limiter') return 0.4;
  return 0.25;
}

function estimateCpuComplexity(effectName) {
  const effect = String(effectName || '').trim().toLowerCase();
  if (effect === 'preamp') return 1;
  if (effect === 'low_shelf' || effect === 'peaking' || effect === 'high_shelf') return 3;
  if (effect === 'compressor') return 6;
  if (effect === 'limiter') return 4;
  return 2;
}

function normalizeChainV2(chain) {
  const list = Array.isArray(chain) ? chain : [];
  return list.map((fx, index) => {
    const effect = String(fx?.effect || '').trim().toLowerCase();
    const params = enrichParamTyping(fx?.params || {});
    return {
      id: index,
      effect,
      stageType: `fx.${effect || 'unknown'}`,
      params,
      realtime: {
        estimatedStageLatencyMs: estimateStageLatencyMs(effect, params),
        estimatedCpuCostUnits: estimateCpuComplexity(effect),
        allocationFreeAtRuntime: true
      }
    };
  });
}

function estimatePresetRealtimeProfile(preset, chain) {
  const requestedLatency = Number(preset?.quality?.max_latency_ms?.value);
  const requestedSampleRate = Number(preset?.quality?.sample_rate?.value);
  const chainLatency = chain.reduce((acc, stage) => acc + Number(stage?.realtime?.estimatedStageLatencyMs || 0), 0);
  const chainCpu = chain.reduce((acc, stage) => acc + Number(stage?.realtime?.estimatedCpuCostUnits || 0), 0);
  const estimatedStateBytes = Math.max(256, chain.length * 192);

  return {
    targetSampleRateHz: Number.isFinite(requestedSampleRate) ? requestedSampleRate : null,
    requestedMaxLatencyMs: Number.isFinite(requestedLatency) ? requestedLatency : null,
    estimatedGraphLatencyMs: Number(chainLatency.toFixed(3)),
    estimatedCpuCostUnits: chainCpu,
    estimatedStateBytes,
    lockFreeSafe: true,
    gcFreeTarget: true
  };
}

function collectPresetCapabilities(preset, chain, tasks) {
  const effectSet = new Set(chain.map((stage) => stage.effect).filter(Boolean));
  const permissions = normalizePermissions(preset?.permissions || {});
  const taskList = Array.isArray(tasks) ? tasks : [];
  const taskProviderSet = new Set();
  let networkRequested = false;

  for (const task of taskList) {
    const provider = String(task?.source?.provider?.value || '').trim().toLowerCase();
    const url = String(task?.source?.url?.value || '').trim().toLowerCase();
    if (provider) taskProviderSet.add(provider);
    if (url.startsWith('http://') || url.startsWith('https://')) networkRequested = true;
  }

  return {
    effects: Array.from(effectSet).sort((a, b) => a.localeCompare(b)),
    taskProviders: Array.from(taskProviderSet).sort((a, b) => a.localeCompare(b)),
    permissions,
    networkRequested,
    requiresAudioGraph: chain.length > 0
  };
}

function createProgramIR(ast, options = {}) {
  const presets = Array.isArray(ast?.presets) ? ast.presets : [];
  const includeTimestamp = options.includeTimestamp !== false;
  const ir = {
    irVersion: 2,
    language: 'dali',
    generatedAt: includeTimestamp ? new Date().toISOString() : '',
    sourceLabel: String(options.sourceLabel || ''),
    compilerProfile: {
      targetClass: String(options.targetClass || 'hybrid'),
      securityMode: String(options.securityMode || 'strict').toLowerCase(),
      deterministicRuntimeTarget: true
    },
    presetCount: presets.length,
    presets: presets.map((preset, index) => {
      const chain = normalizeChainV2(preset?.chain || []);
      const tasks = normalizeTasks(preset?.tasks || []);
      return {
        id: index,
        name: String(preset?.name || ''),
        io: {
          input: String(preset?.input || '').trim().toLowerCase(),
          output: String(preset?.output || '').trim().toLowerCase()
        },
        quality: normalizeQuality(preset?.quality || {}),
        chain,
        permissions: normalizePermissions(preset?.permissions || {}),
        tasks,
        capabilityProfile: collectPresetCapabilities(preset, chain, tasks),
        realtimeProfile: estimatePresetRealtimeProfile(preset, chain)
      };
    })
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
