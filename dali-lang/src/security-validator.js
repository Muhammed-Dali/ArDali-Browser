'use strict';
const fs = require('fs');
const path = require('path');

const ALLOWED_IO = Object.freeze({
  input: new Set(['web', 'music']),
  output: new Set(['speakers'])
});

const ALLOWED_EFFECT_PARAMS = Object.freeze({
  preamp: new Set(['gain']),
  low_shelf: new Set(['freq', 'gain', 'q']),
  peaking: new Set(['freq', 'gain', 'q']),
  high_shelf: new Set(['freq', 'gain', 'q']),
  compressor: new Set(['threshold', 'ratio', 'attack', 'release', 'knee', 'makeup']),
  limiter: new Set(['ceiling', 'attack', 'release'])
});

const ALLOWED_QUALITY_KEYS = new Set([
  'sample_rate',
  'max_latency_ms',
  'true_peak_protection',
  'profile',
  'safety',
  'backend'
]);

const COMPLEXITY_LIMITS = Object.freeze({
  maxSourceBytes: 256 * 1024,
  maxSourceLines: 6000,
  maxPresets: 4,
  maxPresetNameLength: 96,
  maxEffectsPerPreset: 128,
  maxTotalEffects: 384,
  maxParamsPerEffect: 8,
  maxQualityKeys: 8,
  maxIdentifierLength: 64,
  maxTasksPerPreset: 12
});

function loadCapabilityPolicy() {
  const policyPath = path.resolve(__dirname, '..', 'spec', 'capability-policy.json');
  const fallback = {
    policyVersion: 1,
    defaultMode: 'deny',
    allowedCapabilities: ['media.analyze', 'media.transcode', 'shell.exec', 'net.raw'],
    forbiddenAllow: ['shell.exec', 'net.raw']
  };
  try {
    if (!fs.existsSync(policyPath)) return fallback;
    const raw = JSON.parse(fs.readFileSync(policyPath, 'utf8'));
    return {
      ...fallback,
      ...raw,
      allowedCapabilities: Array.isArray(raw.allowedCapabilities) ? raw.allowedCapabilities : fallback.allowedCapabilities,
      forbiddenAllow: Array.isArray(raw.forbiddenAllow) ? raw.forbiddenAllow : fallback.forbiddenAllow
    };
  } catch (_) {
    return fallback;
  }
}

const CAPABILITY_POLICY = Object.freeze(loadCapabilityPolicy());
const ALLOWED_CAPABILITIES = Object.freeze(new Set(
  CAPABILITY_POLICY.allowedCapabilities.map((x) => String(x || '').trim().toLowerCase())
));
const FORBIDDEN_ALLOW_CAPABILITIES = Object.freeze(new Set(
  CAPABILITY_POLICY.forbiddenAllow.map((x) => String(x || '').trim().toLowerCase())
));

const ALLOWED_TASK_PROVIDERS = Object.freeze(new Set([
  'youtube',
  'web',
  'local'
]));

const ALLOWED_TASK_MODES = Object.freeze(new Set([
  'metadata_only',
  'analyze_only'
]));

const NUMERIC_RULES = Object.freeze({
  preamp: {
    gain: { min: -24, max: 24, units: new Set(['db', '']) }
  },
  low_shelf: {
    freq: { min: 20, max: 22000, units: new Set(['hz']) },
    gain: { min: -18, max: 18, units: new Set(['db', '']) },
    q: { min: 0.1, max: 10, units: new Set(['']) }
  },
  peaking: {
    freq: { min: 20, max: 22000, units: new Set(['hz']) },
    gain: { min: -18, max: 18, units: new Set(['db', '']) },
    q: { min: 0.1, max: 24, units: new Set(['']) }
  },
  high_shelf: {
    freq: { min: 20, max: 22000, units: new Set(['hz']) },
    gain: { min: -18, max: 18, units: new Set(['db', '']) },
    q: { min: 0.1, max: 10, units: new Set(['']) }
  },
  compressor: {
    threshold: { min: -72, max: 0, units: new Set(['db', '']) },
    ratio: { min: 1, max: 60, units: new Set(['']) },
    attack: { min: 0.01, max: 500, units: new Set(['ms', '']) },
    release: { min: 1, max: 5000, units: new Set(['ms', '']) },
    knee: { min: 0, max: 24, units: new Set(['db', '']) },
    makeup: { min: -24, max: 24, units: new Set(['db', '']) }
  },
  limiter: {
    ceiling: { min: -24, max: 0, units: new Set(['db', '']) },
    attack: { min: 0.01, max: 200, units: new Set(['ms', '']) },
    release: { min: 1, max: 3000, units: new Set(['ms', '']) }
  },
  quality: {
    sample_rate: { min: 8000, max: 384000, units: new Set(['']) },
    max_latency_ms: { min: 0, max: 200, units: new Set(['', 'ms']) }
  }
});

const ALLOWED_UNITS = Object.freeze(new Set(['', 'hz', 'ms', 'db', 'x', '%']));

function literalToText(literal) {
  if (!literal || typeof literal !== 'object') return '';
  if (literal.type === 'ident' || literal.type === 'string') {
    return String(literal.value || '').trim().toLowerCase();
  }
  if (literal.type === 'number') {
    return `${literal.value}${literal.unit || ''}`.trim().toLowerCase();
  }
  return '';
}

function ensure(condition, message) {
  if (!condition) throw new Error(`[DALI SECURITY] ${message}`);
}

function formatLocSuffix(loc) {
  if (!loc || !Number.isFinite(Number(loc.line)) || !Number.isFinite(Number(loc.col))) return '';
  return ` at ${Number(loc.line)}:${Number(loc.col)}`;
}

function validateSourceLimits(sourceText, label = 'source') {
  const src = String(sourceText || '');
  const bytes = Buffer.byteLength(src, 'utf8');
  ensure(bytes <= COMPLEXITY_LIMITS.maxSourceBytes, `${label} too large (${bytes} bytes > ${COMPLEXITY_LIMITS.maxSourceBytes})`);

  const lines = src.length === 0 ? 0 : src.split(/\r?\n/).length;
  ensure(lines <= COMPLEXITY_LIMITS.maxSourceLines, `${label} too many lines (${lines} > ${COMPLEXITY_LIMITS.maxSourceLines})`);
}

function validateNumericLiteral(contextLabel, literal, rule) {
  ensure(literal && literal.type === 'number', `${contextLabel} must be numeric`);
  const value = Number(literal.value);
  ensure(Number.isFinite(value), `${contextLabel} must be a finite number`);
  ensure(!Object.is(value, -0), `${contextLabel} must not use negative zero`);
  const unit = String(literal.unit || '').toLowerCase();
  ensure(ALLOWED_UNITS.has(unit), `${contextLabel} unit '${unit || '(none)'}' is not supported`);
  ensure(Math.abs(value) <= 1e9, `${contextLabel} absolute value too large`);
  if (rule.units) {
    ensure(rule.units.has(unit), `${contextLabel} unit '${unit || '(none)'}' is not allowed`);
  }
  if (Number.isFinite(rule.min)) {
    ensure(value >= rule.min, `${contextLabel} must be >= ${rule.min}`);
  }
  if (Number.isFinite(rule.max)) {
    ensure(value <= rule.max, `${contextLabel} must be <= ${rule.max}`);
  }
}

function validateLiteralSafety(contextLabel, literal) {
  if (!literal || typeof literal !== 'object') return;
  if (literal.type === 'number') {
    const value = Number(literal.value);
    ensure(Number.isFinite(value), `${contextLabel} must be a finite number`);
    ensure(!Object.is(value, -0), `${contextLabel} must not use negative zero`);
    ensure(Math.abs(value) <= 1e9, `${contextLabel} absolute value too large`);
    const unit = String(literal.unit || '').toLowerCase();
    ensure(ALLOWED_UNITS.has(unit), `${contextLabel} unit '${unit || '(none)'}' is not supported`);
  }
}

function validateEffectParamValue(effectName, paramName, literal, presetIndex, effectIndex, loc) {
  const fxRules = NUMERIC_RULES[effectName] || {};
  const paramRule = fxRules[paramName];
  if (!paramRule) return;
  const locSuffix = formatLocSuffix(loc);
  validateNumericLiteral(`Preset #${presetIndex} effect #${effectIndex} '${effectName}.${paramName}'${locSuffix}`, literal, paramRule);
}

function validateQualityValue(key, literal, presetIndex, loc) {
  const locSuffix = formatLocSuffix(loc);
  const rule = NUMERIC_RULES.quality[key];
  if (rule) {
    validateNumericLiteral(`Preset #${presetIndex} quality '${key}'${locSuffix}`, literal, rule);
    return;
  }

  if (key === 'profile') {
    const value = literalToText(literal);
    ensure(['realtime', 'balanced', 'safe', ''].includes(value), `Preset #${presetIndex}: unsupported profile '${value}'${locSuffix}`);
    return;
  }

  if (key === 'safety') {
    const value = literalToText(literal);
    ensure(['strict', 'safe', 'normal', ''].includes(value), `Preset #${presetIndex}: unsupported safety mode '${value}'${locSuffix}`);
    return;
  }

  if (key === 'true_peak_protection') {
    const value = literalToText(literal);
    ensure(['on', 'off', 'true', 'false', '1', '0', ''].includes(value), `Preset #${presetIndex}: unsupported true_peak_protection '${value}'${locSuffix}`);
    return;
  }

  if (key === 'backend') {
    const value = literalToText(literal);
    ensure(['webaudio', 'audioworklet', ''].includes(value), `Preset #${presetIndex}: unsupported backend '${value}'${locSuffix}`);
  }
}

function validatePreset(preset, index, mode = 'strict') {
  const idx = Number(index) + 1;
  ensure(preset && typeof preset === 'object', `Invalid preset object at index ${idx}`);
  ensure(String(preset.name || '').length <= COMPLEXITY_LIMITS.maxPresetNameLength, `Preset #${idx}: name too long`);

  const input = String(preset.input || '').trim().toLowerCase();
  const output = String(preset.output || '').trim().toLowerCase();
  ensure(ALLOWED_IO.input.has(input), `Preset #${idx}: unsupported input '${preset.input}'. Allowed: web,music`);
  ensure(ALLOWED_IO.output.has(output), `Preset #${idx}: unsupported output '${preset.output}'. Allowed: speakers`);

  ensure(Array.isArray(preset.chain), `Preset #${idx}: chain must be an array`);
  ensure(preset.chain.length <= COMPLEXITY_LIMITS.maxEffectsPerPreset, `Preset #${idx}: too many effects (${preset.chain.length} > ${COMPLEXITY_LIMITS.maxEffectsPerPreset})`);
  for (let i = 0; i < preset.chain.length; i += 1) {
    const fx = preset.chain[i];
    const effectName = String(fx?.effect || '').trim().toLowerCase();
    const effectLocSuffix = formatLocSuffix(fx?.loc);
    ensure(ALLOWED_EFFECT_PARAMS[effectName], `Preset #${idx} effect #${i + 1}: '${effectName}' is not allowed${effectLocSuffix}`);
    ensure(effectName.length <= COMPLEXITY_LIMITS.maxIdentifierLength, `Preset #${idx} effect #${i + 1}: effect name too long`);

    const params = fx?.params && typeof fx.params === 'object' ? fx.params : {};
    const paramKeys = Object.keys(params);
    ensure(paramKeys.length <= COMPLEXITY_LIMITS.maxParamsPerEffect, `Preset #${idx} effect '${effectName}': too many params (${paramKeys.length} > ${COMPLEXITY_LIMITS.maxParamsPerEffect})`);
    const allowedParams = ALLOWED_EFFECT_PARAMS[effectName];
    for (const key of paramKeys) {
      const paramLocSuffix = formatLocSuffix(fx?.paramLocs?.[key]);
      ensure(allowedParams.has(key), `Preset #${idx} effect '${effectName}': param '${key}' is not allowed${paramLocSuffix}`);
      ensure(String(key).length <= COMPLEXITY_LIMITS.maxIdentifierLength, `Preset #${idx} effect '${effectName}': param key too long`);
      validateLiteralSafety(`Preset #${idx} effect '${effectName}.${key}'${paramLocSuffix}`, params[key]);
      validateEffectParamValue(effectName, key, params[key], idx, i + 1, fx?.paramLocs?.[key]);
    }
  }

  const quality = preset.quality && typeof preset.quality === 'object' ? preset.quality : {};
  const qualityKeys = Object.keys(quality);
  ensure(qualityKeys.length <= COMPLEXITY_LIMITS.maxQualityKeys, `Preset #${idx}: too many quality keys (${qualityKeys.length} > ${COMPLEXITY_LIMITS.maxQualityKeys})`);
  for (const key of qualityKeys) {
    const qualityLocSuffix = formatLocSuffix(preset?.qualityLocs?.[key]);
    ensure(ALLOWED_QUALITY_KEYS.has(key), `Preset #${idx}: quality key '${key}' is not allowed${qualityLocSuffix}`);
    ensure(String(key).length <= COMPLEXITY_LIMITS.maxIdentifierLength, `Preset #${idx}: quality key too long`);
    validateLiteralSafety(`Preset #${idx} quality '${key}'${qualityLocSuffix}`, quality[key]);
    validateQualityValue(key, quality[key], idx, preset?.qualityLocs?.[key]);
  }

  const permissions = preset.permissions && typeof preset.permissions === 'object' ? preset.permissions : { allow: [], deny: [] };
  const allowList = Array.isArray(permissions.allow) ? permissions.allow : [];
  const denyList = Array.isArray(permissions.deny) ? permissions.deny : [];
  const allowNorm = allowList.map((x) => String(x || '').trim().toLowerCase());
  const denyNorm = denyList.map((x) => String(x || '').trim().toLowerCase());
  for (const cap of allowNorm) {
    const c = String(cap || '').trim().toLowerCase();
    ensure(ALLOWED_CAPABILITIES.has(c), `Preset #${idx}: permissions.allow capability '${c}' is not allowed`);
  }
  for (const cap of denyNorm) {
    const c = String(cap || '').trim().toLowerCase();
    ensure(ALLOWED_CAPABILITIES.has(c), `Preset #${idx}: permissions.deny capability '${c}' is not allowed`);
  }
  for (const forbidden of FORBIDDEN_ALLOW_CAPABILITIES) {
    ensure(!allowNorm.includes(forbidden), `Preset #${idx}: unsafe capability cannot be allowed (${forbidden})`);
  }

  const tasks = Array.isArray(preset.tasks) ? preset.tasks : [];
  ensure(tasks.length <= COMPLEXITY_LIMITS.maxTasksPerPreset, `Preset #${idx}: too many tasks (${tasks.length} > ${COMPLEXITY_LIMITS.maxTasksPerPreset})`);
  for (let ti = 0; ti < tasks.length; ti += 1) {
    const task = tasks[ti] || {};
    const tLabel = `Preset #${idx} task #${ti + 1}`;
    const taskName = String(task.name || '').trim();
    ensure(taskName.length > 0, `${tLabel}: task name is required`);
    ensure(taskName.length <= COMPLEXITY_LIMITS.maxIdentifierLength, `${tLabel}: task name too long`);
    const provider = literalToText(task?.source?.provider);
    const mode = literalToText(task?.source?.mode);
    const sourceUrl = String(task?.source?.url?.value || '').trim();
    ensure(ALLOWED_TASK_PROVIDERS.has(provider), `${tLabel}: provider '${provider}' is not allowed`);
    ensure(ALLOWED_TASK_MODES.has(mode), `${tLabel}: mode '${mode}' is not allowed`);
    if (sourceUrl) {
      ensure(/^https:\/\//i.test(sourceUrl), `${tLabel}: source.url must be https`);
      ensure(sourceUrl.length <= 2048, `${tLabel}: source.url too long`);
    }
    const taskEffects = Array.isArray(task.process) ? task.process : [];
    ensure(taskEffects.length <= COMPLEXITY_LIMITS.maxEffectsPerPreset, `${tLabel}: too many process effects`);
    for (let ei = 0; ei < taskEffects.length; ei += 1) {
      const fx = taskEffects[ei];
      const effectName = String(fx?.effect || '').trim().toLowerCase();
      ensure(ALLOWED_EFFECT_PARAMS[effectName], `${tLabel}: process effect '${effectName}' is not allowed`);
      const params = fx?.params && typeof fx.params === 'object' ? fx.params : {};
      for (const key of Object.keys(params)) {
        ensure(ALLOWED_EFFECT_PARAMS[effectName].has(key), `${tLabel}: effect '${effectName}' param '${key}' is not allowed`);
        validateLiteralSafety(`${tLabel}: effect '${effectName}.${key}'`, params[key]);
        validateEffectParamValue(effectName, key, params[key], idx, ei + 1, fx?.paramLocs?.[key]);
      }
    }
    validateLiteralSafety(`${tLabel}: output.max_latency_ms`, task?.output?.max_latency_ms);
  }

  if (mode === 'hardened') {
    const safety = literalToText(quality.safety || { type: 'ident', value: '' });
    ensure(safety === 'strict', `Preset #${idx}: hardened mode requires quality.safety: strict`);
    if (tasks.length > 0) {
      ensure(allowNorm.length > 0, `Preset #${idx}: hardened mode requires explicit permissions.allow for task capabilities`);
      for (const task of tasks) {
        const provider = literalToText(task?.source?.provider);
        const modeText = literalToText(task?.source?.mode);
        const needsAnalyze = true;
        const needsTranscode = provider === 'local' && modeText === 'analyze_only';
        ensure(!needsAnalyze || allowNorm.includes('media.analyze'), `Preset #${idx}: hardened mode requires permissions.allow: media.analyze`);
        ensure(!needsTranscode || allowNorm.includes('media.transcode'), `Preset #${idx}: hardened mode requires permissions.allow: media.transcode`);
      }
    }
    const latency = Number(quality?.max_latency_ms?.value);
    if (Number.isFinite(latency)) {
      ensure(latency <= 80, `Preset #${idx}: hardened mode requires max_latency_ms <= 80`);
    }
  }
}

function validateProgramSecurity(ast, options = {}) {
  const mode = String(options.mode || 'strict').trim().toLowerCase();
  ensure(mode === 'strict' || mode === 'hardened', `Unknown security mode '${mode}'`);
  ensure(ast && typeof ast === 'object', 'AST must be an object');
  ensure(Array.isArray(ast.presets), 'AST presets must be an array');
  ensure(ast.presets.length > 0, 'At least one preset is required');
  ensure(ast.presets.length <= COMPLEXITY_LIMITS.maxPresets, `Too many presets (${ast.presets.length} > ${COMPLEXITY_LIMITS.maxPresets})`);
  const totalEffects = ast.presets.reduce((acc, preset) => acc + (Array.isArray(preset?.chain) ? preset.chain.length : 0), 0);
  ensure(totalEffects <= COMPLEXITY_LIMITS.maxTotalEffects, `Too many total effects (${totalEffects} > ${COMPLEXITY_LIMITS.maxTotalEffects})`);
  ast.presets.forEach((preset, index) => validatePreset(preset, index, mode));
  return true;
}

module.exports = {
  validateSourceLimits,
  validateProgramSecurity,
  CAPABILITY_POLICY,
  ALLOWED_EFFECT_PARAMS,
  ALLOWED_QUALITY_KEYS,
  NUMERIC_RULES,
  ALLOWED_UNITS,
  COMPLEXITY_LIMITS
};
