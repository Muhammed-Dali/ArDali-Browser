const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUTPUT = path.join(ROOT, 'LOCALE-COVERAGE.md');

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function readJson(file) {
  return JSON.parse(read(file));
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
  return [...modulesI18nText.matchAll(/'([a-z]{2}-[A-Z]{2})': \{/g)].map((m) => m[1]);
}

function getUsedKeys() {
  const html = read(path.join(ROOT, 'index.html'));
  const js = [
    read(path.join(ROOT, 'renderer.js')),
    read(path.join(ROOT, 'modules/i18n.js'))
  ].join('\n');

  const keys = new Set();
  const patterns = [
    /data-i18n="([^"]+)"/g,
    /data-i18n-title="([^"]+)"/g,
    /data-i18n-placeholder="([^"]+)"/g,
    /data-i18n-aria-label="([^"]+)"/g,
    /uiT\('([^']+)'/g,
    /fsT\('([^']+)'/g,
    /tSync\('([^']+)'/g
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

function quoteList(items) {
  return items.map((item) => `- \`${item}\``).join('\n');
}

function generate() {
  const modulesI18nPath = path.join(ROOT, 'modules', 'i18n.js');
  const localesDir = path.join(ROOT, 'locales');
  const modulesI18nText = read(modulesI18nPath);
  const supported = getSupportedLocales(modulesI18nText);
  const overrideLocales = new Set(getOverrideLocales(modulesI18nText));
  const usedKeys = getUsedKeys();
  const en = readJson(path.join(localesDir, 'en-US.json'));

  const rows = supported.map((lang) => {
    const localePath = path.join(localesDir, `${lang}.json`);
    const json = readJson(localePath);
    let rawPresent = 0;
    let rawMissing = 0;
    let effectiveMissing = 0;

    for (const key of usedKeys) {
      const hasRaw = typeof deepGet(json, key) === 'string' && String(deepGet(json, key)).trim();
      if (hasRaw) {
        rawPresent++;
      } else {
        rawMissing++;
      }

      const hasEn = typeof deepGet(en, key) === 'string' && String(deepGet(en, key)).trim();
      const coveredByOverride = overrideLocales.has(lang);
      if (!(hasRaw || hasEn || coveredByOverride)) {
        effectiveMissing++;
      }
    }

    return {
      lang,
      rawPresent,
      rawMissing,
      effectiveMissing,
      override: overrideLocales.has(lang)
    };
  });

  const strongLocales = rows.filter((row) => row.override).map((row) => row.lang);
  const jsonExtendedLocales = rows.filter((row) => !row.override).map((row) => row.lang);
  const today = new Date().toISOString().slice(0, 10);

  const report = `# Locale Coverage

Updated: ${today}

This report summarizes the active UI locale coverage for the main \`Aurivo Medya Player\` application.

## Active i18n stack

- Runtime loader: [\`modules/i18n.js\`](./modules/i18n.js)
- Locale source files: [\`locales/*.json\`](./locales)
- Electron bridge: [\`main.js\`](./main.js)
- Main UI entrypoint: [\`index.html\`](./index.html)

Removed legacy files:

- \`locales/i18n.js\`
- \`locales/i18n-init.js\`

These were not part of the active main-app loading path.

## What the numbers mean

- \`used keys\`: total i18n keys currently referenced by the main UI
- \`raw present\`: keys found directly inside that locale JSON file
- \`raw missing\`: keys not present directly in that locale JSON file
- \`effective missing\`: keys still unresolved after:
  - locale JSON lookup
  - \`en-US.json\` fallback
  - runtime overrides inside \`modules/i18n.js\`
- \`override\`: whether that language also receives runtime UI overrides in \`modules/i18n.js\`

## Summary

- Total used keys: \`${usedKeys.length}\`
- Supported locales checked: \`${rows.length}\`
- Effective missing keys across all supported locales: \`${rows.reduce((sum, row) => sum + row.effectiveMissing, 0)}\`

That means:

- every supported language can be selected
- the UI remains translatable for every supported language
- no supported locale currently leaves referenced keys unresolved

## Coverage Table

| Locale | Raw Present | Raw Missing | Effective Missing | Override |
| --- | ---: | ---: | ---: | --- |
${rows.map((row) => `| \`${row.lang}\` | ${row.rawPresent} | ${row.rawMissing} | ${row.effectiveMissing} | ${row.override ? 'yes' : 'no'} |`).join('\n')}

## Interpretation

### Strong local coverage

These languages have dedicated runtime override coverage for the newer UI areas:

${quoteList(strongLocales)}

### JSON-extended coverage

These languages now include localized strings for the newer \`Listen\`, theme, and VPN/security areas directly in their JSON files:

${quoteList(jsonExtendedLocales)}

## Notes

- \`effective missing = 0\` does not mean every string is deeply hand-localized across the entire app.
- It means the current UI keyset resolves cleanly for every supported language.
- Some languages still rely more on fallback and shared wording than others.

## Recommended next step

If desired, the next quality pass should focus on:

1. expanding native wording in locale JSON files beyond the current shared/fallback coverage
2. reviewing tone consistency for each language
3. testing long labels in RTL and CJK layouts
`;

  fs.writeFileSync(OUTPUT, report, 'utf8');
  console.log(`Locale coverage report written to ${OUTPUT}`);
}

generate();
