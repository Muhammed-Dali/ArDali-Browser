'use strict';

const { validateProgramSecurity, COMPLEXITY_LIMITS } = require('./security-validator');

function sanitizeName(name) {
  return name.replace(/[^A-Za-z0-9_]/g, '_').toLowerCase();
}

function getLiteralNumber(literal, fallback, expectedUnit = null) {
  if (!literal || literal.type !== 'number') return fallback;
  if (expectedUnit && literal.unit && literal.unit !== expectedUnit) return fallback;
  return literal.value;
}

function getLiteralText(literal, fallback = '') {
  if (!literal || typeof literal !== 'object') return fallback;
  if (literal.type === 'ident' || literal.type === 'string') return String(literal.value || '').trim().toLowerCase();
  if (literal.type === 'number') return `${literal.value}${literal.unit || ''}`.trim().toLowerCase();
  return fallback;
}

function dbToGain(db) {
  return Math.pow(10, db / 20);
}

function compileEffect(effect, index) {
  const nodeName = `n${index}`;
  const { params } = effect;

  if (effect.effect === 'preamp') {
    const gainDb = getLiteralNumber(params.gain, 0);
    const gain = dbToGain(gainDb);
    return {
      create: `const ${nodeName} = new GainNode(audioContext, { gain: ${gain.toFixed(8)} });`
    };
  }

  if (effect.effect === 'low_shelf') {
    const freq = getLiteralNumber(params.freq, 80, 'hz');
    const gain = getLiteralNumber(params.gain, 0, 'db');
    const q = getLiteralNumber(params.q, 0.707);
    return {
      create: `const ${nodeName} = new BiquadFilterNode(audioContext, { type: 'lowshelf', frequency: ${freq}, gain: ${gain}, Q: ${q} });`
    };
  }

  if (effect.effect === 'peaking') {
    const freq = getLiteralNumber(params.freq, 1200, 'hz');
    const gain = getLiteralNumber(params.gain, 0, 'db');
    const q = getLiteralNumber(params.q, 1.0);
    return {
      create: `const ${nodeName} = new BiquadFilterNode(audioContext, { type: 'peaking', frequency: ${freq}, gain: ${gain}, Q: ${q} });`
    };
  }

  if (effect.effect === 'high_shelf') {
    const freq = getLiteralNumber(params.freq, 8000, 'hz');
    const gain = getLiteralNumber(params.gain, 0, 'db');
    const q = getLiteralNumber(params.q, 0.707);
    return {
      create: `const ${nodeName} = new BiquadFilterNode(audioContext, { type: 'highshelf', frequency: ${freq}, gain: ${gain}, Q: ${q} });`
    };
  }

  if (effect.effect === 'compressor') {
    const threshold = getLiteralNumber(params.threshold, -20, 'db');
    const ratio = getLiteralNumber(params.ratio, 2.0);
    const attackMs = getLiteralNumber(params.attack, 10, 'ms');
    const releaseMs = getLiteralNumber(params.release, 120, 'ms');
    const knee = getLiteralNumber(params.knee, 6, 'db');
    const makeupDb = getLiteralNumber(params.makeup, 0, 'db');
    const makeupGain = dbToGain(makeupDb);
    return {
      create: [
        `const ${nodeName}_comp = new DynamicsCompressorNode(audioContext, { threshold: ${threshold}, ratio: ${ratio}, attack: ${(attackMs / 1000).toFixed(6)}, release: ${(releaseMs / 1000).toFixed(6)}, knee: ${knee} });`,
        `const ${nodeName}_makeup = new GainNode(audioContext, { gain: ${makeupGain.toFixed(8)} });`,
        `${nodeName}_comp.connect(${nodeName}_makeup);`,
        `const ${nodeName} = { input: ${nodeName}_comp, output: ${nodeName}_makeup };`
      ].join('\n')
    };
  }

  if (effect.effect === 'limiter') {
    const ceiling = getLiteralNumber(params.ceiling, -0.8, 'db');
    const attackMs = getLiteralNumber(params.attack, 2, 'ms');
    const releaseMs = getLiteralNumber(params.release, 60, 'ms');
    return {
      create: `const ${nodeName} = new DynamicsCompressorNode(audioContext, { threshold: ${ceiling}, ratio: 20, attack: ${(attackMs / 1000).toFixed(6)}, release: ${(releaseMs / 1000).toFixed(6)}, knee: 0 });`
    };
  }

  throw new Error(`Unsupported effect '${effect.effect}'`);
}

function emitSandboxPrelude(lines) {
  lines.push('  const __sandbox = Object.freeze({');
  lines.push("    policy: 'dali-runtime-sandbox-v1',");
  lines.push(`    maxConnectOps: ${Math.max(16, COMPLEXITY_LIMITS.maxTotalEffects * 2)},`);
  lines.push(`    maxDisconnectOps: ${Math.max(16, COMPLEXITY_LIMITS.maxTotalEffects * 2)},`);
  lines.push('    minSampleRate: 8000,');
  lines.push('    maxSampleRate: 384000');
  lines.push('  });');
  lines.push('  if (!audioContext || !inputNode || !outputNode) {');
  lines.push("    throw new Error('[DALI SANDBOX] audioContext, inputNode and outputNode are required');");
  lines.push('  }');
  lines.push("  const __isNodeLike = (n) => !!n && typeof n.connect === 'function' && typeof n.disconnect === 'function';");
  lines.push('  if (!__isNodeLike(inputNode) || !__isNodeLike(outputNode)) {');
  lines.push("    throw new Error('[DALI SANDBOX] inputNode/outputNode must be AudioNode-like');");
  lines.push('  }');
  lines.push('  if (inputNode === outputNode) {');
  lines.push("    throw new Error('[DALI SANDBOX] inputNode and outputNode cannot be the same node');");
  lines.push('  }');
  lines.push('  const __sr = Number(audioContext.sampleRate || 0);');
  lines.push('  if (!Number.isFinite(__sr) || __sr < __sandbox.minSampleRate || __sr > __sandbox.maxSampleRate) {');
  lines.push("    throw new Error('[DALI SANDBOX] unsupported audioContext.sampleRate');");
  lines.push('  }');
  lines.push('  const __ctxOf = (n) => n && (n.context || n.audioContext || null);');
  lines.push('  const __sameCtx = (n) => __ctxOf(n) === audioContext;');
  lines.push('  if (!__sameCtx(inputNode) || !__sameCtx(outputNode)) {');
  lines.push("    throw new Error('[DALI SANDBOX] cross-context AudioNode connection is blocked');");
  lines.push('  }');
  lines.push('  let __connectOps = 0;');
  lines.push('  let __disconnectOps = 0;');
  lines.push('  const __safeConnect = (fromNode, toNode) => {');
  lines.push("    if (!__isNodeLike(fromNode) || !__isNodeLike(toNode)) throw new Error('[DALI SANDBOX] connect target must be AudioNode-like');");
  lines.push("    if (!__sameCtx(fromNode) || !__sameCtx(toNode)) throw new Error('[DALI SANDBOX] connect across different contexts is blocked');");
  lines.push('    __connectOps += 1;');
  lines.push("    if (__connectOps > __sandbox.maxConnectOps) throw new Error('[DALI SANDBOX] connect operation limit exceeded');");
  lines.push('    fromNode.connect(toNode);');
  lines.push('  };');
  lines.push('  const __safeDisconnect = (node) => {');
  lines.push('    if (!__isNodeLike(node) || !__sameCtx(node)) return;');
  lines.push('    __disconnectOps += 1;');
  lines.push("    if (__disconnectOps > __sandbox.maxDisconnectOps) throw new Error('[DALI SANDBOX] disconnect operation limit exceeded');");
  lines.push('    try { node.disconnect(); } catch (_) {}');
  lines.push('  };');
  lines.push('  const __createdNodes = [];');
  lines.push('  const __registerNode = (node) => {');
  lines.push('    if (!__isNodeLike(node) || !__sameCtx(node)) return;');
  lines.push('    if (__createdNodes.indexOf(node) === -1) __createdNodes.push(node);');
  lines.push('  };');
  lines.push('');
}

function emitChainBuildAndConnect(lines, preset, firstInputRef) {
  const nodeRefs = [];
  preset.chain.forEach((effect, idx) => {
    const compiled = compileEffect(effect, idx);
    compiled.create.split('\n').forEach((line) => lines.push(`  ${line}`));
    lines.push(`  __registerNode(n${idx}.input || n${idx});`);
    lines.push(`  __registerNode(n${idx}.output || n${idx});`);
    nodeRefs.push(`n${idx}`);
    lines.push('');
  });

  nodeRefs.forEach((ref) => {
    lines.push(`  const ${ref}_in = ${ref}.input || ${ref};`);
    lines.push(`  const ${ref}_out = ${ref}.output || ${ref};`);
  });
  if (nodeRefs.length > 0) {
    lines.push(`  __safeConnect(${firstInputRef}, ${nodeRefs[0]}_in);`);
    for (let i = 0; i < nodeRefs.length - 1; i += 1) {
      lines.push(`  __safeConnect(${nodeRefs[i]}_out, ${nodeRefs[i + 1]}_in);`);
    }
    lines.push(`  __safeConnect(${nodeRefs[nodeRefs.length - 1]}_out, outputNode);`);
  } else {
    lines.push(`  __safeConnect(${firstInputRef}, outputNode);`);
  }
  lines.push('');
  return nodeRefs;
}

function compilePresetWebAudio(preset) {
  const lines = [];
  lines.push(`function build_${sanitizeName(preset.name)}(audioContext, inputNode, outputNode) {`);
  emitSandboxPrelude(lines);
  const nodeRefs = emitChainBuildAndConnect(lines, preset, 'inputNode');

  const maxLatency = preset.quality.max_latency_ms?.value;
  if (typeof maxLatency === 'number') {
    lines.push(`  // Target latency requested by preset: ${maxLatency}ms (depends on hardware + browser scheduler).`);
  }

  lines.push('  return {');
  lines.push(`    presetName: ${JSON.stringify(preset.name)},`);
  lines.push("    backend: 'webaudio',");
  lines.push('    security: {');
  lines.push('      policy: __sandbox.policy,');
  lines.push('      maxConnectOps: __sandbox.maxConnectOps');
  lines.push('    },');
  lines.push('    disconnect() {');
  lines.push('      __safeDisconnect(inputNode);');
  lines.push('      for (let i = __createdNodes.length - 1; i >= 0; i -= 1) {');
  lines.push('        __safeDisconnect(__createdNodes[i]);');
  lines.push('      }');
  nodeRefs.forEach((ref) => {
    lines.push(`      __safeDisconnect(${ref}.output || ${ref});`);
  });
  lines.push('    }');
  lines.push('  };');
  lines.push('}');
  return lines.join('\n');
}

function getEffectStageConfig(effect) {
  const p = effect?.params || {};
  if (effect.effect === 'preamp') {
    const gainDb = getLiteralNumber(p.gain, 0, 'db');
    return { kind: 'gain', gain: dbToGain(gainDb) };
  }
  if (effect.effect === 'peaking') {
    return {
      kind: 'biquad',
      biquadType: 'peaking',
      freq: getLiteralNumber(p.freq, 1200, 'hz'),
      q: getLiteralNumber(p.q, 1.0),
      gainDb: getLiteralNumber(p.gain, 0, 'db')
    };
  }
  if (effect.effect === 'low_shelf') {
    return {
      kind: 'biquad',
      biquadType: 'lowshelf',
      freq: getLiteralNumber(p.freq, 80, 'hz'),
      q: getLiteralNumber(p.q, 0.707),
      gainDb: getLiteralNumber(p.gain, 0, 'db')
    };
  }
  if (effect.effect === 'high_shelf') {
    return {
      kind: 'biquad',
      biquadType: 'highshelf',
      freq: getLiteralNumber(p.freq, 8000, 'hz'),
      q: getLiteralNumber(p.q, 0.707),
      gainDb: getLiteralNumber(p.gain, 0, 'db')
    };
  }
  if (effect.effect === 'compressor') {
    const threshold = getLiteralNumber(p.threshold, -20, 'db');
    const ratio = getLiteralNumber(p.ratio, 2.0);
    const attackMs = getLiteralNumber(p.attack, 10, 'ms');
    const releaseMs = getLiteralNumber(p.release, 120, 'ms');
    const makeupDb = getLiteralNumber(p.makeup, 0, 'db');
    return {
      kind: 'compressor',
      threshold,
      ratio,
      attackMs,
      releaseMs,
      makeupGain: dbToGain(makeupDb)
    };
  }
  if (effect.effect === 'limiter') {
    const ceilingDb = getLiteralNumber(p.ceiling, -0.8, 'db');
    return {
      kind: 'limiter',
      ceilingDb,
      ceilingGain: dbToGain(ceilingDb)
    };
  }
  throw new Error(`Unsupported effect '${effect.effect}'`);
}

function compilePresetAudioWorklet(preset) {
  const fnName = `build_${sanitizeName(preset.name)}`;
  const workletName = `dali_${sanitizeName(preset.name)}_bridge_v1`;
  const stages = preset.chain.map((effect) => getEffectStageConfig(effect));
  const workletCode = [
    "'use strict';",
    `const DALI_STAGES = ${JSON.stringify(stages)};`,
    'function dbToGain(db) { return Math.pow(10, db / 20); }',
    'function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }',
    'function coeffBiquad(type, freqHz, q, gainDb) {',
    '  const f = clamp(Number(freqHz) || 1000, 20, Math.min(22000, sampleRate * 0.49));',
    '  const Q = Math.max(0.0001, Number(q) || 1.0);',
    '  const A = Math.pow(10, (Number(gainDb) || 0) / 40);',
    '  const w0 = 2 * Math.PI * f / sampleRate;',
    '  const cosW0 = Math.cos(w0);',
    '  const sinW0 = Math.sin(w0);',
    '  const alpha = sinW0 / (2 * Q);',
    '  let b0; let b1; let b2; let a0; let a1; let a2;',
    "  if (type === 'peaking') {",
    '    b0 = 1 + alpha * A;',
    '    b1 = -2 * cosW0;',
    '    b2 = 1 - alpha * A;',
    '    a0 = 1 + alpha / A;',
    '    a1 = -2 * cosW0;',
    '    a2 = 1 - alpha / A;',
    "  } else if (type === 'lowshelf') {",
    '    const sqrtA = Math.sqrt(A);',
    '    const twoSqrtAAlpha = 2 * sqrtA * alpha;',
    '    b0 = A * ((A + 1) - (A - 1) * cosW0 + twoSqrtAAlpha);',
    '    b1 = 2 * A * ((A - 1) - (A + 1) * cosW0);',
    '    b2 = A * ((A + 1) - (A - 1) * cosW0 - twoSqrtAAlpha);',
    '    a0 = (A + 1) + (A - 1) * cosW0 + twoSqrtAAlpha;',
    '    a1 = -2 * ((A - 1) + (A + 1) * cosW0);',
    '    a2 = (A + 1) + (A - 1) * cosW0 - twoSqrtAAlpha;',
    "  } else if (type === 'highshelf') {",
    '    const sqrtA = Math.sqrt(A);',
    '    const twoSqrtAAlpha = 2 * sqrtA * alpha;',
    '    b0 = A * ((A + 1) + (A - 1) * cosW0 + twoSqrtAAlpha);',
    '    b1 = -2 * A * ((A - 1) + (A + 1) * cosW0);',
    '    b2 = A * ((A + 1) + (A - 1) * cosW0 - twoSqrtAAlpha);',
    '    a0 = (A + 1) - (A - 1) * cosW0 + twoSqrtAAlpha;',
    '    a1 = 2 * ((A - 1) - (A + 1) * cosW0);',
    '    a2 = (A + 1) - (A - 1) * cosW0 - twoSqrtAAlpha;',
    '  } else {',
    '    b0 = 1; b1 = 0; b2 = 0; a0 = 1; a1 = 0; a2 = 0;',
    '  }',
    '  return {',
    '    b0: b0 / a0, b1: b1 / a0, b2: b2 / a0,',
    '    a1: a1 / a0, a2: a2 / a0',
    '  };',
    '}',
    'class DaliBridgeProcessor extends AudioWorkletProcessor {',
    '  constructor() {',
    '    super();',
    '    this.stages = DALI_STAGES.map((s) => ({ ...s }));',
    '    for (let i = 0; i < this.stages.length; i += 1) {',
    '      const st = this.stages[i];',
    "      if (st.kind === 'biquad') {",
    '        st.coeff = coeffBiquad(st.biquadType, st.freq, st.q, st.gainDb);',
    '      }',
    "      if (st.kind === 'compressor') {",
    '        const attackSec = Math.max(0.00001, (Number(st.attackMs) || 10) / 1000);',
    '        const releaseSec = Math.max(0.00001, (Number(st.releaseMs) || 120) / 1000);',
    '        st.attackCoeff = Math.exp(-1 / (attackSec * sampleRate));',
    '        st.releaseCoeff = Math.exp(-1 / (releaseSec * sampleRate));',
    '      }',
    '    }',
    '    this.stageState = this.stages.map(() => []);',
    '  }',
    '  getChannelState(stageIdx, ch) {',
    '    const stage = this.stages[stageIdx];',
    '    const arr = this.stageState[stageIdx];',
    '    if (arr[ch]) return arr[ch];',
    "    if (stage.kind === 'biquad') { arr[ch] = { x1: 0, x2: 0, y1: 0, y2: 0 }; return arr[ch]; }",
    "    if (stage.kind === 'compressor') { arr[ch] = { env: 0 }; return arr[ch]; }",
    '    arr[ch] = {};',
    '    return arr[ch];',
    '  }',
    '  processSample(x, stage, state) {',
    "    if (stage.kind === 'gain') return x * stage.gain;",
    "    if (stage.kind === 'biquad') {",
    '      const c = stage.coeff;',
    '      const y = c.b0 * x + c.b1 * state.x1 + c.b2 * state.x2 - c.a1 * state.y1 - c.a2 * state.y2;',
    '      state.x2 = state.x1; state.x1 = x; state.y2 = state.y1; state.y1 = y;',
    '      return y;',
    '    }',
    "    if (stage.kind === 'compressor') {",
    '      const absX = Math.abs(x);',
    '      const coeff = absX > state.env ? stage.attackCoeff : stage.releaseCoeff;',
    '      state.env = coeff * state.env + (1 - coeff) * absX;',
    '      const envDb = 20 * Math.log10(state.env + 1e-12);',
    '      const overDb = envDb - stage.threshold;',
    '      let gainDb = 0;',
    '      if (overDb > 0) gainDb = -overDb * (1 - 1 / Math.max(1, stage.ratio));',
    '      return x * dbToGain(gainDb) * stage.makeupGain;',
    '    }',
    "    if (stage.kind === 'limiter') {",
    '      const c = Math.max(0.00001, stage.ceilingGain || 1);',
    '      if (x > c) return c;',
    '      if (x < -c) return -c;',
    '      return x;',
    '    }',
    '    return x;',
    '  }',
    '  process(inputs, outputs) {',
    '    const input = inputs[0] || [];',
    '    const output = outputs[0] || [];',
    '    const channels = Math.min(input.length, output.length);',
    '    for (let ch = 0; ch < channels; ch += 1) {',
    '      const inCh = input[ch] || output[ch];',
    '      const outCh = output[ch];',
    '      const frames = Math.min(inCh.length, outCh.length);',
    '      for (let i = 0; i < frames; i += 1) {',
    '        let s = Number.isFinite(inCh[i]) ? inCh[i] : 0;',
    '        for (let st = 0; st < this.stages.length; st += 1) {',
    '          const stage = this.stages[st];',
    '          const state = this.getChannelState(st, ch);',
    '          s = this.processSample(s, stage, state);',
    '        }',
    '        outCh[i] = clamp(s, -1, 1);',
    '      }',
    '    }',
    '    return true;',
    '  }',
    '}',
    `registerProcessor(${JSON.stringify(workletName)}, DaliBridgeProcessor);`
  ].join('\n');

  const lines = [];
  lines.push(`async function ${fnName}(audioContext, inputNode, outputNode) {`);
  emitSandboxPrelude(lines);
  lines.push("  if (!audioContext.audioWorklet || typeof audioContext.audioWorklet.addModule !== 'function') {");
  lines.push("    throw new Error('[DALI SANDBOX] AudioWorklet is unavailable in this context');");
  lines.push('  }');
  lines.push("  const __registryKey = '__daliWorkletRegistryV1';");
  lines.push('  if (!audioContext[__registryKey]) audioContext[__registryKey] = Object.create(null);');
  lines.push(`  if (!audioContext[__registryKey][${JSON.stringify(workletName)}]) {`);
  lines.push(`    const __blob = new Blob([${JSON.stringify(workletCode)}], { type: 'application/javascript' });`);
  lines.push('    const __url = URL.createObjectURL(__blob);');
  lines.push('    try {');
  lines.push('      await audioContext.audioWorklet.addModule(__url);');
  lines.push(`      audioContext[__registryKey][${JSON.stringify(workletName)}] = true;`);
  lines.push('    } finally {');
  lines.push('      URL.revokeObjectURL(__url);');
  lines.push('    }');
  lines.push('  }');
  lines.push(`  const __daliWorkletNode = new AudioWorkletNode(audioContext, ${JSON.stringify(workletName)}, {`);
  lines.push('    numberOfInputs: 1,');
  lines.push('    numberOfOutputs: 1,');
  lines.push('    outputChannelCount: [2],');
  lines.push("    channelCountMode: 'max',");
  lines.push("    channelInterpretation: 'speakers'");
  lines.push('  });');
  lines.push('  __registerNode(__daliWorkletNode);');
  lines.push('');
  lines.push('  __safeConnect(inputNode, __daliWorkletNode);');
  lines.push('  __safeConnect(__daliWorkletNode, outputNode);');
  lines.push('');

  lines.push('  return {');
  lines.push(`    presetName: ${JSON.stringify(preset.name)},`);
  lines.push("    backend: 'audioworklet',");
  lines.push(`    worklet: { name: ${JSON.stringify(workletName)} },`);
  lines.push('    security: {');
  lines.push('      policy: __sandbox.policy,');
  lines.push('      maxConnectOps: __sandbox.maxConnectOps');
  lines.push('    },');
  lines.push('    disconnect() {');
  lines.push('      __safeDisconnect(inputNode);');
  lines.push('      for (let i = __createdNodes.length - 1; i >= 0; i -= 1) {');
  lines.push('        __safeDisconnect(__createdNodes[i]);');
  lines.push('      }');
  lines.push('      __safeDisconnect(__daliWorkletNode);');
  lines.push('    }');
  lines.push('  };');
  lines.push('}');
  return { fnName, code: lines.join('\n') };
}

function normalizeBackendName(name) {
  const value = String(name || '').trim().toLowerCase();
  if (!value) return '';
  if (value === 'worklet') return 'audioworklet';
  return value;
}

function resolveBackend(preset, options = {}) {
  const fromOption = normalizeBackendName(options.backend);
  if (fromOption) return fromOption;
  const fromPreset = normalizeBackendName(getLiteralText(preset?.quality?.backend, ''));
  return fromPreset || 'webaudio';
}

function compileToWebAudioModule(ast, options = {}) {
  validateProgramSecurity(ast, { mode: String(options.securityMode || 'strict').toLowerCase() });
  if (!ast.presets.length) throw new Error('No preset found in .dali source');

  const preset = ast.presets[0];
  const backend = resolveBackend(preset, options);
  let functionName = `build_${sanitizeName(preset.name)}`;
  let functionCode = '';

  if (backend === 'webaudio') {
    functionCode = compilePresetWebAudio(preset);
  } else if (backend === 'audioworklet') {
    const workletCompiled = compilePresetAudioWorklet(preset);
    functionName = workletCompiled.fnName;
    functionCode = workletCompiled.code;
  } else {
    throw new Error(`[DALI SECURITY] unsupported backend '${backend}'. Allowed: webaudio, audioworklet`);
  }

  return [
    "'use strict';",
    '',
    '// Generated by dali-lang compiler (v0).',
    '// This module targets Web Audio API graph creation in Electron/Web.',
    functionCode,
    '',
    'async function __dali_build_graph_safe(audioContext, inputNode, outputNode) {',
    `  return await Promise.resolve(${functionName}(audioContext, inputNode, outputNode));`,
    '}',
    '',
    'module.exports = {',
    `  presetName: ${JSON.stringify(preset.name)},`,
    `  backend: ${JSON.stringify(backend)},`,
    `  isAsyncBuildGraph: ${backend === 'audioworklet' ? 'true' : 'false'},`,
    `  inputTarget: ${JSON.stringify(preset.input || 'web')},`,
    `  outputTarget: ${JSON.stringify(preset.output || 'speakers')},`,
    `  quality: ${JSON.stringify(preset.quality, null, 2)},`,
    `  buildGraph: ${functionName},`,
    '  buildGraphSafe: __dali_build_graph_safe',
    '};',
    ''
  ].join('\n');
}

module.exports = {
  compileToWebAudioModule
};
