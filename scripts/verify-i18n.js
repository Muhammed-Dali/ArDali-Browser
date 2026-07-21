const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function readJson(file) {
  return JSON.parse(read(file));
}

function findDuplicateJsonKeys(source) {
  const duplicates = [];
  const stack = [];
  let index = 0;
  const markParentValueComplete = () => {
    const parent = stack[stack.length - 1];
    if (parent?.type === 'object') parent.expectingKey = false;
  };
  while (index < source.length) {
    const char = source[index];
    if (/\s/.test(char)) { index++; continue; }
    if (char === '"') {
      const start = index;
      index++;
      let escaped = false;
      while (index < source.length) {
        const current = source[index++];
        if (escaped) { escaped = false; continue; }
        if (current === '\\') { escaped = true; continue; }
        if (current === '"') break;
      }
      const token = source.slice(start, index);
      let lookahead = index;
      while (/\s/.test(source[lookahead] || '')) lookahead++;
      const container = stack[stack.length - 1];
      if (container?.type === 'object' && container.expectingKey && source[lookahead] === ':') {
        const key = JSON.parse(token);
        if (container.keys.has(key)) duplicates.push(key);
        container.keys.add(key);
      } else {
        markParentValueComplete();
      }
      continue;
    }
    if (char === '{') { stack.push({ type: 'object', keys: new Set(), expectingKey: true }); index++; continue; }
    if (char === '[') { stack.push({ type: 'array' }); index++; continue; }
    if (char === '}' || char === ']') { stack.pop(); markParentValueComplete(); index++; continue; }
    if (char === ',') {
      const container = stack[stack.length - 1];
      if (container?.type === 'object') container.expectingKey = true;
      index++;
      continue;
    }
    index++;
  }
  return duplicates;
}

function deepGet(obj, key) {
  if (!obj || typeof obj !== 'object') return undefined;
  if (Object.prototype.hasOwnProperty.call(obj, key)) return obj[key];
  let cur = obj;
  for (const part of String(key).split('.')) {
    if (!cur || typeof cur !== 'object' || !(part in cur)) return undefined;
    cur = cur[part];
  }
  return cur;
}

function getSupportedLocales(modulesI18nText) {
  const match = modulesI18nText.match(/const SUPPORTED = \[((?:.|\n)*?)\];/);
  if (!match) throw new Error('SUPPORTED locale list not found in modules/i18n.js');
  return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

function getOverrideLocales(modulesI18nText) {
  return new Set([...modulesI18nText.matchAll(/'([a-z]{2}-[A-Z]{2})': \{/g)].map((m) => m[1]));
}

function getUsedKeys() {
  const rootFiles = fs.readdirSync(ROOT, { withFileTypes: true });
  const html = rootFiles
    .filter((entry) => entry.isFile() && entry.name.endsWith('.html'))
    .map((entry) => read(path.join(ROOT, entry.name)))
    .join('\n');
  const rootJs = rootFiles
    .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
    .map((entry) => read(path.join(ROOT, entry.name)));
  const moduleJs = fs.readdirSync(path.join(ROOT, 'modules'), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
    .map((entry) => read(path.join(ROOT, 'modules', entry.name)));
  const js = [...rootJs, ...moduleJs].join('\n');

  const keys = new Set();
  const patterns = [
    /data-i18n="([^"]+)"/g,
    /data-i18n-title="([^"]+)"/g,
    /data-i18n-placeholder="([^"]+)"/g,
    /data-i18n-aria-label="([^"]+)"/g,
    /uiT\('([^']+)'/g,
    /fsT\('([^']+)'/g,
    /tSync\('([^']+)'/g,
    /tMainSync\('([^']+)'/g
  ];

  for (const src of [html, js]) {
    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(src))) {
        keys.add(match[1]);
      }
    }
  }

  return [...keys].sort();
}

function main() {
  const modulesI18nPath = path.join(ROOT, 'modules', 'i18n.js');
  const localesDir = path.join(ROOT, 'locales');
  const modulesI18nText = read(modulesI18nPath);
  const supported = getSupportedLocales(modulesI18nText);
  const overrideLocales = getOverrideLocales(modulesI18nText);
  const usedKeys = getUsedKeys();

  const enPath = path.join(localesDir, 'en-US.json');
  if (!fs.existsSync(enPath)) {
    throw new Error('locales/en-US.json is missing');
  }
  const en = readJson(enPath);
  const securityKeys = Object.keys(en).filter((key) =>
    key.startsWith('passwordManager.') ||
    key.startsWith('about.sections.passwordManager.') ||
    key.startsWith('about.whatsNew.') ||
    key === 'about.sections.security.item4' ||
    key === 'about.sections.security.item5'
  );

  const errors = [];

  for (const lang of supported) {
    const localePath = path.join(localesDir, `${lang}.json`);
    if (!fs.existsSync(localePath)) {
      errors.push(`Missing locale file: locales/${lang}.json`);
      continue;
    }

    let json;
    try {
      const source = read(localePath);
      const duplicateKeys = findDuplicateJsonKeys(source);
      if (duplicateKeys.length) {
        errors.push(`Duplicate keys in locales/${lang}.json: ${[...new Set(duplicateKeys)].join(', ')}`);
      }
      json = JSON.parse(source);
    } catch (err) {
      errors.push(`Invalid JSON in locales/${lang}.json: ${err.message}`);
      continue;
    }

    const missingSecurityKeys = securityKeys.filter((key) =>
      typeof deepGet(json, key) !== 'string' || !String(deepGet(json, key)).trim()
    );
    if (missingSecurityKeys.length) {
      errors.push(`Locale ${lang} is missing explicit Security window translations: ${missingSecurityKeys.join(', ')}`);
    }

    const effectiveMissing = [];
    for (const key of usedKeys) {
      const hasRaw = typeof deepGet(json, key) === 'string' && String(deepGet(json, key)).trim();
      const hasEn = typeof deepGet(en, key) === 'string' && String(deepGet(en, key)).trim();
      const coveredByOverride = overrideLocales.has(lang);
      if (!(hasRaw || hasEn || coveredByOverride)) {
        effectiveMissing.push(key);
      }
    }

    if (effectiveMissing.length) {
      errors.push(
        `Locale ${lang} has unresolved keys (${effectiveMissing.length}): ${effectiveMissing.slice(0, 12).join(', ')}`
      );
    }
  }

  if (errors.length) {
    console.error('i18n verification failed:\n');
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  console.log(`i18n verification passed for ${supported.length} locales and ${usedKeys.length} used keys.`);
}

main();
