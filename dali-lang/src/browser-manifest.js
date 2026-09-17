'use strict';

const ALLOWED_ENGINES = new Set(['chromium', 'gecko']);
const ALLOWED_EMBEDDERS = new Set(['cef', 'qt_webengine']);
const REQUIRED_CAPABILITIES = new Set([
  'window.create',
  'window.reparent_live_page',
  'navigation.http_https'
]);
const REQUIRED_DENIALS = new Set(['filesystem.unscoped', 'process.spawn']);

function tokenizeBrowserManifest(source) {
  const tokens = [];
  const input = String(source || '');
  let index = 0;
  while (index < input.length) {
    if (/\s/.test(input[index])) { index += 1; continue; }
    if (input[index] === '/' && input[index + 1] === '/') {
      while (index < input.length && input[index] !== '\n') index += 1;
      continue;
    }
    if ('{};'.includes(input[index])) { tokens.push({ type: input[index], value: input[index] }); index += 1; continue; }
    if (input[index] === '"') {
      const end = input.indexOf('"', index + 1);
      if (end < 0) throw new Error('Unterminated browser manifest string');
      tokens.push({ type: 'string', value: input.slice(index + 1, end) }); index = end + 1; continue;
    }
    const match = /^[A-Za-z_][A-Za-z0-9_.-]*/.exec(input.slice(index));
    if (!match) throw new Error(`Unexpected browser manifest character '${input[index]}'`);
    tokens.push({ type: 'ident', value: match[0] }); index += match[0].length;
  }
  tokens.push({ type: 'eof', value: '' });
  return tokens;
}

function parseBrowserManifest(source) {
  const tokens = tokenizeBrowserManifest(source);
  let cursor = 0;
  const current = () => tokens[cursor];
  const expect = (type, value) => {
    const token = current();
    if (token.type !== type || (value !== undefined && token.value !== value)) {
      throw new Error(`Expected ${value || type}, got ${token.value || token.type}`);
    }
    cursor += 1;
    return token;
  };
  const readStatement = () => {
    const key = expect('ident').value;
    const value = expect('ident').value;
    expect(';');
    return [key, value];
  };
  expect('ident', 'browser');
  const name = expect('string').value;
  expect('{');
  const manifest = { type: 'BrowserManifest', name, engine: {}, tabs: {}, capabilities: { allow: [], deny: [] }, platforms: {} };
  while (current().type !== '}') {
    const section = expect('ident').value;
    if (section === 'platform') {
      const platform = expect('ident').value;
      expect('{');
      const values = {};
      while (current().type !== '}') {
        const [key, value] = readStatement(); values[key] = value;
      }
      expect('}'); manifest.platforms[platform] = values; continue;
    }
    expect('{');
    if (section === 'capabilities') {
      while (current().type !== '}') {
        const mode = expect('ident').value;
        if (mode !== 'allow' && mode !== 'deny') throw new Error(`Unknown capability mode '${mode}'`);
        manifest.capabilities[mode].push(expect('ident').value); expect(';');
      }
    } else if (section === 'engine' || section === 'tabs') {
      const values = {};
      while (current().type !== '}') {
        const [key, value] = readStatement(); values[key] = value;
      }
      manifest[section] = values;
    } else {
      throw new Error(`Unknown browser manifest section '${section}'`);
    }
    expect('}');
  }
  expect('}'); expect('eof');
  return manifest;
}

function validateBrowserManifest(manifest) {
  if (!manifest || manifest.type !== 'BrowserManifest') throw new Error('Invalid browser manifest');
  if (!manifest.name.trim()) throw new Error('Browser manifest requires a name');
  const engineName = manifest.engineName;
  if (!ALLOWED_ENGINES.has(engineName)) throw new Error(`Unsupported engine '${engineName || ''}'`);
  if (!ALLOWED_EMBEDDERS.has(manifest.engine.embedder)) throw new Error(`Unsupported embedder '${manifest.engine.embedder || ''}'`);
  if (engineName !== 'chromium') throw new Error('Milestone 0 requires a Chromium embedder');
  if (manifest.engine.sandbox !== 'strict' || manifest.engine.process_model !== 'multi_process') throw new Error('Browser engine must use strict multi-process sandboxing');
  if (manifest.tabs.ownership !== 'single_live_page' || manifest.tabs.detach !== 'preserve_context' || manifest.tabs.attach !== 'preserve_context') throw new Error('Tab transfers must preserve one live page context');
  const allowed = new Set(manifest.capabilities.allow);
  const denied = new Set(manifest.capabilities.deny);
  for (const capability of REQUIRED_CAPABILITIES) if (!allowed.has(capability)) throw new Error(`Missing required capability '${capability}'`);
  for (const capability of REQUIRED_DENIALS) if (!denied.has(capability)) throw new Error(`Missing required denial '${capability}'`);
  if (manifest.platforms.wayland?.attach !== 'require_verified_global_coordinates') throw new Error('Wayland attach must require verified global coordinates');
  return true;
}

// The engine's name appears between `engine` and its block, unlike the other
// sections. Keep the public parser strict while supporting that concise DALI
// declaration form.
function parseArDaliBrowserManifest(source) {
  const normalized = String(source || '').replace(/\bengine\s+(chromium|gecko)\s*\{/g, 'engine { engine_name $1;');
  const manifest = parseBrowserManifest(normalized);
  manifest.engineName = manifest.engine.engine_name;
  delete manifest.engine.engine_name;
  return manifest;
}

module.exports = { tokenizeBrowserManifest, parseArDaliBrowserManifest, validateBrowserManifest };
