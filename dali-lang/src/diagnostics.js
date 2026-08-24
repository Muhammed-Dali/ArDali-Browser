'use strict';

function extractLineCol(message) {
  const text = String(message || '');
  const patterns = [
    /\bat\s+(\d+):(\d+)\b/i,
    /\bline\s+(\d+):(\d+)\b/i
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) {
      return { line: Number(m[1]), col: Number(m[2]) };
    }
  }
  return null;
}

function makeCodeFrame(sourceText, line, col, context = 2) {
  const src = String(sourceText || '');
  const lines = src.split(/\r?\n/);
  const targetLine = Math.max(1, Number(line) || 1);
  const targetCol = Math.max(1, Number(col) || 1);
  const from = Math.max(1, targetLine - context);
  const to = Math.min(lines.length, targetLine + context);
  const width = String(to).length;
  const out = [];
  for (let ln = from; ln <= to; ln += 1) {
    const marker = ln === targetLine ? '>' : ' ';
    const code = lines[ln - 1] || '';
    out.push(`${marker} ${String(ln).padStart(width, ' ')} | ${code}`);
    if (ln === targetLine) {
      out.push(`  ${' '.repeat(width)} | ${' '.repeat(Math.max(0, targetCol - 1))}^`);
    }
  }
  return out.join('\n');
}

function formatDiagnosticWithSource(sourceText, message, fileLabel = '') {
  const base = fileLabel ? `${fileLabel}: ${message}` : String(message || '');
  const lc = extractLineCol(message);
  if (!lc) return base;
  return `${base}\n${makeCodeFrame(sourceText, lc.line, lc.col)}`;
}

function classifyDiagnostic(message) {
  const m = String(message || '');
  if (m.includes('[DALI SECURITY]')) return 'SECURITY';
  if (m.includes('[DALI SIGNATURE]')) return 'SIGNATURE';
  if (m.includes('[DALI SANDBOX]')) return 'SANDBOX';
  if (m.includes('Expected ') || m.includes('Unexpected character')) return 'PARSER';
  return 'GENERAL';
}

function inferDiagnosticCode(message) {
  const m = String(message || '');
  if (m.includes('must be <=')) return 'DALI_RANGE_MAX';
  if (m.includes('must be >=')) return 'DALI_RANGE_MIN';
  if (m.includes("unit '")) return 'DALI_UNIT_INVALID';
  if (m.includes('param') && m.includes('not allowed')) return 'DALI_PARAM_NOT_ALLOWED';
  if (m.includes('quality key') && m.includes('not allowed')) return 'DALI_QUALITY_KEY_NOT_ALLOWED';
  if (m.includes('unsupported input')) return 'DALI_UNSUPPORTED_INPUT';
  if (m.includes('unsupported output')) return 'DALI_UNSUPPORTED_OUTPUT';
  if (m.includes('too many effects')) return 'DALI_COMPLEXITY_EFFECTS';
  if (m.includes('too large')) return 'DALI_SOURCE_TOO_LARGE';
  if (m.includes('too many lines')) return 'DALI_SOURCE_TOO_MANY_LINES';
  if (m.includes('signature verification failed')) return 'DALI_SIGNATURE_INVALID';
  if (m.includes('signature file required but missing')) return 'DALI_SIGNATURE_REQUIRED_MISSING';
  if (m.includes('key file not found')) return 'DALI_SIGNATURE_KEY_NOT_FOUND';
  if (m.includes('cross-context AudioNode')) return 'DALI_SANDBOX_CROSS_CONTEXT_BLOCKED';
  if (m.includes('connect operation limit exceeded')) return 'DALI_SANDBOX_CONNECT_LIMIT';
  if (m.includes('disconnect operation limit exceeded')) return 'DALI_SANDBOX_DISCONNECT_LIMIT';
  if (m.includes('Unexpected character')) return 'DALI_PARSER_UNEXPECTED_CHARACTER';
  if (m.includes('Expected section keyword')) return 'DALI_PARSER_SECTION_KEYWORD_EXPECTED';
  if (m.includes('Expected ') && m.includes(' but got ')) return 'DALI_PARSER_EXPECTED_TOKEN';
  if (m.includes('file not found')) return 'DALI_FILE_NOT_FOUND';
  if (m.includes('Missing --public-key')) return 'DALI_PUBLIC_KEY_REQUIRED';
  return 'DALI_ERROR';
}

function createDiagnostic({ message, fileLabel = '', sourceText = '', context = {} }) {
  const msg = String(message || '');
  const lc = extractLineCol(msg);
  return {
    ok: false,
    class: classifyDiagnostic(msg),
    code: inferDiagnosticCode(msg),
    message: msg,
    file: fileLabel || '',
    line: lc ? lc.line : null,
    col: lc ? lc.col : null,
    frame: lc && sourceText ? makeCodeFrame(sourceText, lc.line, lc.col) : '',
    timestamp: new Date().toISOString(),
    context: context && typeof context === 'object' ? context : {}
  };
}

module.exports = {
  extractLineCol,
  makeCodeFrame,
  formatDiagnosticWithSource,
  classifyDiagnostic,
  inferDiagnosticCode,
  createDiagnostic
};
