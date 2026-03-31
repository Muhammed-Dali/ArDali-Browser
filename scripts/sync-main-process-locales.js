const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const MAIN_PATH = path.join(ROOT, 'main.js');
const I18N_PATH = path.join(ROOT, 'modules', 'i18n.js');
const LOCALES_DIR = path.join(ROOT, 'locales');

const FALLBACKS = {
  'appMenu.close': 'Close',
  'appMenu.copy': 'Copy',
  'appMenu.cut': 'Cut',
  'appMenu.edit': 'Edit',
  'appMenu.file': 'File',
  'appMenu.help': 'Help',
  'appMenu.minimize': 'Minimize',
  'appMenu.paste': 'Paste',
  'appMenu.quit': 'Quit',
  'appMenu.redo': 'Redo',
  'appMenu.reload': 'Reload',
  'appMenu.resetZoom': 'Reset Zoom',
  'appMenu.selectAll': 'Select All',
  'appMenu.toggleDevTools': 'Toggle Developer Tools',
  'appMenu.toggleFullscreen': 'Toggle Full Screen',
  'appMenu.undo': 'Undo',
  'appMenu.view': 'View',
  'appMenu.window': 'Window',
  'appMenu.zoomIn': 'Zoom In',
  'appMenu.zoomOut': 'Zoom Out',
  'dialog.filters.allFiles': 'All Files',
  'dialog.filters.audioFiles': 'Audio Files',
  'dialog.filters.musicFiles': 'Music Files',
  'dialog.filters.videoFiles': 'Video Files',
  'dialog.selectMusicFiles': 'Select music files',
  'dialog.selectMusicFolder': 'Select music folder',
  'trayMedia.exit': 'Exit',
  'trayMedia.like': 'Like',
  'trayMedia.mute': 'Mute',
  'trayMedia.next': 'Next track',
  'trayMedia.pause': 'Pause',
  'trayMedia.play': 'Play',
  'trayMedia.previous': 'Previous track',
  'trayMedia.show': 'Show',
  'trayMedia.stop': 'Stop',
  'trayMedia.stopAfterCurrent': 'Stop after current track',
  'trayMedia.unmute': 'Unmute',
  'visualizer.notFoundBody': 'Visualizer component is missing. Path: {path}',
  'visualizer.notFoundTitle': 'Visualizer components are missing'
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

function extractObjectLiteral(source, constName) {
  const marker = `const ${constName} =`;
  const idx = source.indexOf(marker);
  if (idx < 0) throw new Error(`Missing ${constName}`);

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

    if (ch === '"' || ch === '\'' || ch === '`') {
      inString = true;
      quote = ch;
      continue;
    }

    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }

  throw new Error(`Could not find object end for ${constName}`);
}

function getMainKeys() {
  const source = read(MAIN_PATH);
  const keys = [...source.matchAll(/tMainSync\('([^']+)'/g)].map((m) => m[1]);
  return [...new Set(keys)].sort();
}

function main() {
  const i18nSource = read(I18N_PATH);
  const localeOverrides = vm.runInNewContext(`(${extractObjectLiteral(i18nSource, 'LOCALE_OVERRIDES')})`);

  const keys = getMainKeys();
  const missingFallback = keys.filter((key) => !(key in FALLBACKS));
  if (missingFallback.length) {
    throw new Error(`Missing FALLBACKS for keys: ${missingFallback.join(', ')}`);
  }

  const localeFiles = fs.readdirSync(LOCALES_DIR).filter((name) => name.endsWith('.json')).sort();
  let updatedFiles = 0;
  let updatedKeys = 0;

  for (const fileName of localeFiles) {
    const locale = fileName.replace(/\.json$/i, '');
    const filePath = path.join(LOCALES_DIR, fileName);
    const json = readJson(filePath);
    const overrides = localeOverrides[locale] || {};
    let touched = false;

    for (const key of keys) {
      const cur = json[key];
      const next = (typeof overrides[key] === 'string' && overrides[key].trim())
        ? overrides[key]
        : (typeof cur === 'string' && cur.trim())
          ? cur
          : FALLBACKS[key];

      if (json[key] !== next) {
        json[key] = next;
        touched = true;
        updatedKeys += 1;
      }
    }

    if (touched) {
      writeJson(filePath, json);
      updatedFiles += 1;
    }
  }

  console.log(`Main-process locale sync complete. Updated files: ${updatedFiles}, updated keys: ${updatedKeys}`);
}

main();
