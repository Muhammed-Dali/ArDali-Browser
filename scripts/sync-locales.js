const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const I18N_PATH = path.join(ROOT, 'modules', 'i18n.js');
const LOCALES_DIR = path.join(ROOT, 'locales');

// Yeni blok eklemek için buraya bir satır eklemek yeterli.
const GROUPS = {
  shortcuts: {
    prefix: 'playback.shortcuts.',
    overrideConst: 'SHORTCUTS_LOCALE_OVERRIDES'
  }
};

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function readJson(file) {
  return JSON.parse(read(file));
}

function writeJson(file, data) {
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function parseArgs(argv) {
  const out = {
    group: 'all'
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--group' && argv[i + 1]) {
      out.group = String(argv[i + 1]).trim();
      i += 1;
      continue;
    }
    if (token.startsWith('--group=')) {
      out.group = String(token.slice('--group='.length)).trim();
    }
  }
  return out;
}

function extractObjectLiteral(source, constName) {
  const marker = `const ${constName} =`;
  const idx = source.indexOf(marker);
  if (idx < 0) throw new Error(`Missing ${constName} in modules/i18n.js`);

  const start = source.indexOf('{', idx);
  if (start < 0) throw new Error(`Could not find object start for ${constName}`);

  let depth = 0;
  let inString = false;
  let quote = '';
  let escaped = false;

  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === quote) {
        inString = false;
        quote = '';
      }
      continue;
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      inString = true;
      quote = ch;
      continue;
    }

    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, i + 1);
      }
    }
  }

  throw new Error(`Could not find object end for ${constName}`);
}

function getLocaleFiles() {
  return fs
    .readdirSync(LOCALES_DIR)
    .filter((name) => name.endsWith('.json'))
    .sort();
}

function selectGroups(groupArg) {
  if (!groupArg || groupArg === 'all') {
    return Object.entries(GROUPS);
  }
  const picked = GROUPS[groupArg];
  if (!picked) {
    throw new Error(`Unknown --group value: ${groupArg}`);
  }
  return [[groupArg, picked]];
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const selectedGroups = selectGroups(options.group);

  const i18nSource = read(I18N_PATH);
  const enPath = path.join(LOCALES_DIR, 'en-US.json');
  if (!fs.existsSync(enPath)) {
    throw new Error('locales/en-US.json not found');
  }
  const enJson = readJson(enPath);

  const groupData = selectedGroups.map(([groupName, cfg]) => {
    const overrideLiteral = extractObjectLiteral(i18nSource, cfg.overrideConst);
    const overrideMap = vm.runInNewContext(`(${overrideLiteral})`);
    const keys = Object.keys(enJson).filter((key) => key.startsWith(cfg.prefix));
    if (!keys.length) {
      throw new Error(`No ${cfg.prefix}* keys found in locales/en-US.json for group ${groupName}`);
    }
    return { groupName, cfg, overrideMap, keys };
  });

  const files = getLocaleFiles();
  let changedFiles = 0;
  let changedKeys = 0;

  for (const fileName of files) {
    const locale = fileName.replace(/\.json$/i, '');
    const filePath = path.join(LOCALES_DIR, fileName);
    const json = readJson(filePath);
    let touched = false;

    for (const group of groupData) {
      const localeOverrides = group.overrideMap[locale] || {};
      for (const key of group.keys) {
        const overrideValue = localeOverrides[key];
        const currentValue = json[key];
        let nextValue;

        // Öncelik:
        // 1) locale override
        // 2) mevcut locale değeri (boş değilse)
        // 3) en-US fallback
        if (typeof overrideValue === 'string' && overrideValue.trim()) {
          nextValue = overrideValue;
        } else if (typeof currentValue === 'string' && currentValue.trim()) {
          nextValue = currentValue;
        } else {
          nextValue = enJson[key];
        }

        if (typeof nextValue === 'string' && json[key] !== nextValue) {
          json[key] = nextValue;
          touched = true;
          changedKeys += 1;
        }
      }
    }

    if (touched) {
      writeJson(filePath, json);
      changedFiles += 1;
    }
  }

  const groupNames = groupData.map((g) => g.groupName).join(', ');
  console.log(`Locale sync complete. Groups: ${groupNames}. Updated files: ${changedFiles}, updated keys: ${changedKeys}`);
}

main();
