'use strict';

const KEYWORDS = new Set(['preset', 'input', 'output', 'chain', 'quality']);

function isWhitespace(ch) {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';
}

function isIdentStart(ch) {
  return /[A-Za-z_]/.test(ch);
}

function isIdentChar(ch) {
  return /[A-Za-z0-9_]/.test(ch);
}

function isNumberStart(ch, next) {
  return /[0-9]/.test(ch) || (ch === '-' && /[0-9]/.test(next || ''));
}

function readWhile(source, start, predicate) {
  let i = start;
  while (i < source.length && predicate(source[i])) i += 1;
  return i;
}

function tokenize(source) {
  const tokens = [];
  let i = 0;
  let line = 1;
  let col = 1;

  function push(type, value, startLine, startCol) {
    tokens.push({ type, value, line: startLine, col: startCol });
  }

  function advance(count = 1) {
    for (let n = 0; n < count; n += 1) {
      if (source[i] === '\n') {
        line += 1;
        col = 1;
      } else {
        col += 1;
      }
      i += 1;
    }
  }

  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];

    if (isWhitespace(ch)) {
      advance(1);
      continue;
    }

    if (ch === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') advance(1);
      continue;
    }

    const startLine = line;
    const startCol = col;

    if ('{};='.includes(ch)) {
      push(ch, ch, startLine, startCol);
      advance(1);
      continue;
    }

    if (ch === '"') {
      advance(1);
      const stringStart = i;
      while (i < source.length && source[i] !== '"') advance(1);
      if (i >= source.length) {
        throw new Error(`Unterminated string at ${startLine}:${startCol}`);
      }
      const value = source.slice(stringStart, i);
      advance(1);
      push('string', value, startLine, startCol);
      continue;
    }

    if (isNumberStart(ch, next)) {
      const numberEnd = readWhile(source, i, (c) => /[0-9.-]/.test(c));
      const unitEnd = readWhile(source, numberEnd, (c) => /[A-Za-z]/.test(c));
      const raw = source.slice(i, unitEnd);
      const match = raw.match(/^(-?\d+(?:\.\d+)?)([A-Za-z]+)?$/);
      if (!match) {
        throw new Error(`Invalid number literal '${raw}' at ${startLine}:${startCol}`);
      }
      push('number', {
        value: Number(match[1]),
        unit: (match[2] || '').toLowerCase(),
        raw
      }, startLine, startCol);
      advance(unitEnd - i);
      continue;
    }

    if (isIdentStart(ch)) {
      const identEnd = readWhile(source, i, isIdentChar);
      const ident = source.slice(i, identEnd);
      const type = KEYWORDS.has(ident) ? 'keyword' : 'ident';
      push(type, ident, startLine, startCol);
      advance(identEnd - i);
      continue;
    }

    throw new Error(`Unexpected character '${ch}' at ${line}:${col}`);
  }

  push('eof', '', line, col);
  return tokens;
}

module.exports = {
  tokenize
};
