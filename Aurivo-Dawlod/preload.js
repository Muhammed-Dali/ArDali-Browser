'use strict';

const { contextBridge, ipcRenderer, shell, clipboard } = require('electron');

const aurivoRoot = String(__dirname || '').replace(/\\/g, '/');
const htmlDir = `${aurivoRoot}/html`;

function normalizeWithinRoot(baseDir, request) {
  const baseParts = String(baseDir || '').replace(/\\/g, '/').split('/').filter(Boolean);
  const reqParts = String(request || '').replace(/\\/g, '/').split('/');
  const parts = baseParts.slice();

  for (const rawPart of reqParts) {
    const part = String(rawPart || '').trim();
    if (!part || part === '.') continue;
    if (part === '..') {
      if (parts.length <= 1) {
        throw new Error(`Blocked path traversal request: ${request}`);
      }
      parts.pop();
      continue;
    }
    parts.push(part);
  }

  const normalized = `/${parts.join('/')}`;
  const rootPrefix = `/${aurivoRoot.split('/').filter(Boolean).join('/')}`;
  if (!normalized.startsWith(rootPrefix)) {
    throw new Error(`Blocked out-of-root request: ${request}`);
  }
  return normalized;
}

function aurivoRequire(request) {
  const id = String(request || '').trim();
  if (!id) {
    throw new Error('Missing module id');
  }

  if (id === 'electron') {
    return { ipcRenderer, shell, clipboard };
  }
  if (id === 'path' || id === 'os' || id === 'fs' || id === 'fs/promises' || id === 'child_process' || id === 'https' || id === 'crypto' || id === 'systeminformation' || id === 'original-fs' || id === 'yt-dlp-wrap-plus') {
    return require(id);
  }

  if (id.startsWith('./') || id.startsWith('../')) {
    const resolved = normalizeWithinRoot(htmlDir, id);
    return require(resolved);
  }

  throw new Error(`Blocked module request in renderer: ${id}`);
}

contextBridge.exposeInMainWorld('require', aurivoRequire);
contextBridge.exposeInMainWorld('__dirname', htmlDir);
contextBridge.exposeInMainWorld('process', {
  platform: process.platform,
  windowsStore: !!process.windowsStore,
  env: { ...process.env }
});
