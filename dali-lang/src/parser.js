'use strict';

const { tokenize } = require('./tokenizer');

class Parser {
  constructor(tokens) {
    this.tokens = tokens;
    this.i = 0;
  }

  current() {
    return this.tokens[this.i];
  }

  consume() {
    const t = this.current();
    this.i += 1;
    return t;
  }

  expect(type, value) {
    const t = this.current();
    if (!t || t.type !== type || (value !== undefined && t.value !== value)) {
      const got = t ? `${t.type}:${typeof t.value === 'string' ? t.value : JSON.stringify(t.value)}` : 'EOF';
      throw new Error(`Expected ${type}${value !== undefined ? ` '${value}'` : ''} but got ${got} at ${t?.line}:${t?.col}`);
    }
    return this.consume();
  }

  match(type, value) {
    const t = this.current();
    if (!t) return false;
    if (t.type !== type) return false;
    if (value !== undefined && t.value !== value) return false;
    this.consume();
    return true;
  }

  parseProgram() {
    const presets = [];
    while (this.current().type !== 'eof') {
      presets.push(this.parsePreset());
    }
    return { type: 'Program', presets };
  }

  parsePreset() {
    const presetToken = this.expect('keyword', 'preset');
    const name = this.expect('string').value;
    this.expect('{', '{');

    const preset = {
      type: 'Preset',
      name,
      loc: { line: presetToken.line, col: presetToken.col },
      input: null,
      output: null,
      chain: [],
      quality: {},
      qualityLocs: {}
    };

    while (!this.match('}', '}')) {
      const t = this.current();
      if (t.type !== 'keyword') {
        throw new Error(`Expected section keyword in preset at ${t.line}:${t.col}`);
      }
      if (t.value === 'input') {
        this.consume();
        preset.input = this.expect('ident').value;
        this.expect(';', ';');
      } else if (t.value === 'output') {
        this.consume();
        preset.output = this.expect('ident').value;
        this.expect(';', ';');
      } else if (t.value === 'chain') {
        this.consume();
        preset.chain = this.parseChain();
      } else if (t.value === 'quality') {
        this.consume();
        const parsedQuality = this.parseQuality();
        preset.quality = parsedQuality.quality;
        preset.qualityLocs = parsedQuality.qualityLocs;
      } else {
        throw new Error(`Unknown section '${t.value}' at ${t.line}:${t.col}`);
      }
    }

    return preset;
  }

  parseChain() {
    const chain = [];
    this.expect('{', '{');
    while (!this.match('}', '}')) {
      const effectToken = this.expect('ident');
      const effectName = effectToken.value;
      const params = {};
      const paramLocs = {};
      while (!this.match(';', ';')) {
        const keyToken = this.expect('ident');
        const key = keyToken.value;
        this.expect('=', '=');
        const value = this.parseLiteral();
        params[key] = value;
        paramLocs[key] = { line: keyToken.line, col: keyToken.col };
      }
      chain.push({
        effect: effectName,
        params,
        loc: { line: effectToken.line, col: effectToken.col },
        paramLocs
      });
    }
    return chain;
  }

  parseQuality() {
    const quality = {};
    const qualityLocs = {};
    this.expect('{', '{');
    while (!this.match('}', '}')) {
      const keyToken = this.expect('ident');
      const key = keyToken.value;
      quality[key] = this.parseLiteral();
      qualityLocs[key] = { line: keyToken.line, col: keyToken.col };
      this.expect(';', ';');
    }
    return { quality, qualityLocs };
  }

  parseLiteral() {
    const t = this.current();
    if (t.type === 'number') {
      this.consume();
      return { type: 'number', value: t.value.value, unit: t.value.unit, raw: t.value.raw };
    }
    if (t.type === 'string') {
      this.consume();
      return { type: 'string', value: t.value };
    }
    if (t.type === 'ident') {
      this.consume();
      return { type: 'ident', value: t.value };
    }
    throw new Error(`Expected literal at ${t.line}:${t.col}`);
  }
}

function parseDali(source) {
  if (looksLikeV2Dali(source)) {
    return parseDaliV2(source);
  }
  const tokens = tokenize(source);
  const parser = new Parser(tokens);
  return parser.parseProgram();
}

function stripLineComments(source) {
  const src = String(source || '');
  let out = '';
  let inString = false;
  let escape = false;
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    const next = src[i + 1];
    if (inString) {
      out += ch;
      if (escape) {
        escape = false;
      } else if (ch === '\\') {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === '/' && next === '/') {
      while (i < src.length && src[i] !== '\n') i += 1;
      if (i < src.length && src[i] === '\n') out += '\n';
      continue;
    }
    out += ch;
  }
  return out;
}

function looksLikeV2Dali(source) {
  const src = stripLineComments(source);
  return /\bengine\s*\{[\s\S]*?\binput\s*:/i.test(src) || /\bband\s*\(\s*[^)]+\s*\)\s*=/i.test(src);
}

function skipWs(source, i) {
  let p = i;
  while (p < source.length && /\s/.test(source[p])) p += 1;
  return p;
}

function readIdent(source, i) {
  const s = skipWs(source, i);
  const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(s));
  if (!m) return null;
  return { value: m[0], start: s, end: s + m[0].length };
}

function readBalancedBlock(source, openBraceIndex) {
  if (source[openBraceIndex] !== '{') {
    throw new Error(`Expected '{' at ${openBraceIndex}`);
  }
  let depth = 0;
  for (let i = openBraceIndex; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        return {
          body: source.slice(openBraceIndex + 1, i),
          endIndex: i + 1
        };
      }
    }
  }
  throw new Error('Unterminated block in .dl v2 source');
}

function parseLiteralRaw(raw) {
  const text = String(raw || '').trim();
  if (!text) return { type: 'ident', value: '' };
  if (text.startsWith('"') && text.endsWith('"') && text.length >= 2) {
    return { type: 'string', value: text.slice(1, -1) };
  }
  const num = /^(-?\d+(?:\.\d+)?)([A-Za-z]+)?$/.exec(text);
  if (num) {
    return {
      type: 'number',
      value: Number(num[1]),
      unit: (num[2] || '').toLowerCase(),
      raw: text
    };
  }
  return { type: 'ident', value: text.toLowerCase() };
}

function getLineColFromOffset(source, offset) {
  const safeOffset = Math.max(0, Math.min(Number(offset) || 0, source.length));
  let line = 1;
  let col = 1;
  for (let i = 0; i < safeOffset; i += 1) {
    if (source[i] === '\n') {
      line += 1;
      col = 1;
    } else {
      col += 1;
    }
  }
  return { line, col };
}

function parseAssignments(body, baseOffset = 0, fullSource = '') {
  const out = {};
  const locs = {};
  const re = /([A-Za-z_][A-Za-z0-9_]*)\s*[:=]\s*([^;]+);/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    out[m[1]] = parseLiteralRaw(m[2]);
    const relIndex = Number(m.index) || 0;
    locs[m[1]] = getLineColFromOffset(fullSource, baseOffset + relIndex);
  }
  return { values: out, locs };
}

function computeEq32BandQ(freqs, index) {
  const current = Number(freqs[index]) || 1000;
  const prev = Number(freqs[Math.max(0, index - 1)]) || (current / Math.pow(2, 1 / 3));
  const next = Number(freqs[Math.min(freqs.length - 1, index + 1)]) || (current * Math.pow(2, 1 / 3));
  const lowerEdge = Math.sqrt(prev * current);
  const upperEdge = Math.sqrt(current * next);
  const bandwidth = Math.max(1, upperEdge - lowerEdge);
  const q = current / bandwidth;
  return Math.max(0.8, Math.min(6.0, Number(q.toFixed(4))));
}

function parseEq32BlockToEffects(body, baseOffset = 0, fullSource = '') {
  const bandRows = [];
  const re = /band\s*\(\s*([^)]+)\s*\)\s*=\s*([^;]+);/gi;
  let m;
  while ((m = re.exec(body)) !== null) {
    const freqLit = parseLiteralRaw(m[1]);
    const gainLit = parseLiteralRaw(m[2]);
    if (freqLit.type !== 'number' || gainLit.type !== 'number') continue;
    const relIndex = Number(m.index) || 0;
    bandRows.push({
      freqLit,
      gainLit,
      loc: getLineColFromOffset(fullSource, baseOffset + relIndex)
    });
  }

  const freqs = bandRows.map((row) => Number(row.freqLit.value) || 1000);
  return bandRows.map((row, index) => {
      const q = computeEq32BandQ(freqs, index);
      return {
      effect: 'peaking',
      params: {
        freq: row.freqLit,
        gain: row.gainLit,
        q: {
          type: 'number',
          value: q,
          unit: '',
          raw: String(q)
        }
      },
      loc: row.loc
    };
  });
}

function parseChainV2(body, baseOffset = 0, fullSource = '') {
  const chain = [];
  let i = 0;
  while (i < body.length) {
    const ident = readIdent(body, i);
    if (!ident) break;
    i = skipWs(body, ident.end);
    if (body[i] !== '{') {
      i += 1;
      continue;
    }

    const block = readBalancedBlock(body, i);
    const effectName = ident.value.toLowerCase();
    const effectBody = block.body;
    const effectLoc = getLineColFromOffset(fullSource, baseOffset + ident.start);

    if (effectName === 'eq32') {
      chain.push(...parseEq32BlockToEffects(effectBody, baseOffset + i + 1, fullSource));
    } else {
      const parsedParams = parseAssignments(effectBody, baseOffset + i + 1, fullSource);
      chain.push({
        effect: effectName,
        params: parsedParams.values,
        paramLocs: parsedParams.locs,
        loc: effectLoc
      });
    }

    i = block.endIndex;
  }
  return chain;
}

function parseNamedBlock(parentBody, name) {
  const target = String(name || '').toLowerCase();
  let i = 0;
  while (i < parentBody.length) {
    const ident = readIdent(parentBody, i);
    if (!ident) break;
    i = skipWs(parentBody, ident.end);
    if (parentBody[i] !== '{') {
      i += 1;
      continue;
    }
    const block = readBalancedBlock(parentBody, i);
    if (ident.value.toLowerCase() === target) return block.body;
    i = block.endIndex;
  }
  return '';
}

function parsePermissionsV2(body, baseOffset = 0, fullSource = '') {
  const allow = [];
  const deny = [];
  const allowLocs = {};
  const denyLocs = {};
  const re = /\b(allow|deny)\s*:\s*([a-z_][a-z0-9_.-]*)\s*;/gi;
  let m;
  while ((m = re.exec(String(body || ''))) !== null) {
    const kind = String(m[1] || '').toLowerCase();
    const capability = String(m[2] || '').trim().toLowerCase();
    const relIndex = Number(m.index) || 0;
    const loc = getLineColFromOffset(fullSource, baseOffset + relIndex);
    if (kind === 'allow') {
      allow.push(capability);
      allowLocs[capability] = loc;
    } else if (kind === 'deny') {
      deny.push(capability);
      denyLocs[capability] = loc;
    }
  }
  return { allow, deny, allowLocs, denyLocs };
}

function parseTaskSourceBody(body, baseOffset = 0, fullSource = '') {
  const out = parseAssignments(body, baseOffset, fullSource);
  return {
    provider: out.values.provider || { type: 'ident', value: '' },
    url: out.values.url || { type: 'string', value: '' },
    mode: out.values.mode || { type: 'ident', value: '' },
    locs: out.locs
  };
}

function parseTaskOutputBody(body, baseOffset = 0, fullSource = '') {
  const out = parseAssignments(body, baseOffset, fullSource);
  return {
    profile: out.values.profile || { type: 'ident', value: '' },
    max_latency_ms: out.values.max_latency_ms || { type: 'number', value: 0, unit: '', raw: '0' },
    locs: out.locs
  };
}

function parseTaskV2(taskName, taskBody, taskStartOffset, fullSource = '') {
  const sourceBody = parseNamedBlock(taskBody, 'source');
  const processBody = parseNamedBlock(taskBody, 'process');
  const outputBody = parseNamedBlock(taskBody, 'output');
  const sourceOffset = sourceBody ? fullSource.indexOf(sourceBody, taskStartOffset) : -1;
  const processOffset = processBody ? fullSource.indexOf(processBody, taskStartOffset) : -1;
  const outputOffset = outputBody ? fullSource.indexOf(outputBody, taskStartOffset) : -1;

  return {
    type: 'Task',
    name: String(taskName || '').trim(),
    source: parseTaskSourceBody(sourceBody, Math.max(0, sourceOffset), fullSource),
    process: parseChainV2(processBody, Math.max(0, processOffset), fullSource),
    output: parseTaskOutputBody(outputBody, Math.max(0, outputOffset), fullSource),
    loc: getLineColFromOffset(fullSource, Math.max(0, taskStartOffset))
  };
}

function parseTasksV2(body, baseOffset = 0, fullSource = '') {
  const tasks = [];
  const src = String(body || '');
  let i = 0;
  while (i < src.length) {
    const token = readIdent(src, i);
    if (!token) {
      i += 1;
      continue;
    }
    const kw = String(token.value || '').toLowerCase();
    i = skipWs(src, token.end);
    if (kw !== 'task') {
      if (src[i] === '{') {
        const block = readBalancedBlock(src, i);
        i = block.endIndex;
        continue;
      }
      i += 1;
      continue;
    }
    const m = /^\s*"([^"]+)"/.exec(src.slice(i));
    if (!m) {
      i += 1;
      continue;
    }
    const name = String(m[1] || '').trim();
    i += m[0].length;
    i = skipWs(src, i);
    if (src[i] !== '{') {
      i += 1;
      continue;
    }
    const block = readBalancedBlock(src, i);
    const taskStartOffset = baseOffset + token.start;
    tasks.push(parseTaskV2(name, block.body, taskStartOffset, fullSource));
    i = block.endIndex;
  }
  return tasks;
}

function parseDaliV2(source) {
  const src = stripLineComments(source);
  const header = /preset\s+"([^"]+)"/i.exec(src);
  if (!header) throw new Error('No preset found in .dl v2 source');
  const presetName = header[1];

  const headerIndex = header.index + header[0].length;
  const openIndex = src.indexOf('{', headerIndex);
  if (openIndex < 0) throw new Error('Preset body block not found in .dl v2 source');
  const presetBlock = readBalancedBlock(src, openIndex);
  const presetBody = presetBlock.body;

  const engineBody = parseNamedBlock(presetBody, 'engine');
  const chainBody = parseNamedBlock(presetBody, 'chain');
  const qualityBody = parseNamedBlock(presetBody, 'quality');
  const permissionsBody = parseNamedBlock(presetBody, 'permissions');
  const engineOffset = src.indexOf(engineBody);
  const chainOffset = src.indexOf(chainBody);
  const qualityOffset = src.indexOf(qualityBody);
  const permissionsOffset = src.indexOf(permissionsBody);
  const engine = parseAssignments(engineBody, Math.max(0, engineOffset), src);
  const quality = parseAssignments(qualityBody, Math.max(0, qualityOffset), src);
  const permissions = parsePermissionsV2(permissionsBody, Math.max(0, permissionsOffset), src);
  const tasks = parseTasksV2(presetBody, openIndex + 1, src);

  const preset = {
    type: 'Preset',
    name: presetName,
    loc: getLineColFromOffset(src, header.index || 0),
    input: engine.values.input?.value || 'web',
    output: engine.values.output?.value || 'speakers',
    chain: parseChainV2(chainBody, Math.max(0, chainOffset), src),
    quality: {
      ...quality.values,
      ...(engine.values.safety ? { safety: engine.values.safety } : {}),
      ...(engine.values.profile ? { profile: engine.values.profile } : {})
    },
    qualityLocs: {
      ...quality.locs,
      ...(engine.locs.safety ? { safety: engine.locs.safety } : {}),
      ...(engine.locs.profile ? { profile: engine.locs.profile } : {})
    },
    permissions,
    tasks
  };

  return {
    type: 'Program',
    presets: [preset]
  };
}

module.exports = {
  parseDali
};
