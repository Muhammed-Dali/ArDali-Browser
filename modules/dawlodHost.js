// modules/dawlodHost.js
// Opens the bundled Aurivo-Dawlod app (HTML/JS) in a separate BrowserWindow.
//
// We intentionally keep Dawlod source unmodified. To avoid IPC collisions,
// handlers are routed only when the sender belongs to the Dawlod window.

const path = require('path');
const fs = require('fs');
const { clipboard, nativeImage, shell } = require('electron');

let dawlodWindow = null;
let desiredDawlodLocale = null;
let lastAutoPasted = null;
let dawlodReadyForLinks = false;
let pendingLinkToPaste = null;
let dawlodWindowIsOpen = false;

function parseHttpUrl(raw) {
    try {
        const u = new URL(String(raw || '').trim());
        if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
        return u;
    } catch {
        return null;
    }
}

function readClipboardUrl() {
    try {
        const txt = String(clipboard.readText() || '').trim();
        const u = parseHttpUrl(txt);
        return u ? u.toString() : null;
    } catch {
        return null;
    }
}

function getDawlodRoot(app) {
    // Dev: repo root. Prod: app.asar root (app.getAppPath()).
    return path.join(app.getAppPath(), 'Aurivo-Dawlod');
}

function getDawlodHtmlPath(app, name) {
    return path.join(getDawlodRoot(app), 'html', name);
}

function exists(p) {
    try { return fs.existsSync(p); } catch { return false; }
}

function resolveDawlodIconPath(app) {
    const candidates = [
        // Always prefer Aurivo app icon so Linux/Wayland titlebar/task entries stay consistent.
        path.join(app.getAppPath(), 'icons', 'aurivo_512.png'),
        path.join(app.getAppPath(), 'icons', 'aurivo.png'),
        process.resourcesPath ? path.join(process.resourcesPath, 'icons', 'aurivo_512.png') : null,
        process.resourcesPath ? path.join(process.resourcesPath, 'icons', 'aurivo.png') : null,
        // Fallbacks (legacy Dawlod resources)
        path.join(getDawlodRoot(app), 'resources', 'icon.png'),
        path.join(getDawlodRoot(app), 'resources', 'icon.ico')
    ].filter(Boolean);

    for (const p of candidates) {
        if (exists(p)) return p;
    }
    return undefined;
}

function isFromDawlod(event) {
    try {
        const sender = event?.sender;
        if (!sender) return false;
        if (dawlodWindow && !dawlodWindow.isDestroyed()) {
            return sender.id === dawlodWindow.webContents.id;
        }
    } catch { }
    return false;
}

function revealDawlodWindow(win, activate = true) {
    if (!win || win.isDestroyed()) return;
    const shouldActivate = !!activate;
    if (shouldActivate) {
        win.show();
        win.focus();
        return;
    }
    if (typeof win.showInactive === 'function') {
        win.showInactive();
    } else {
        win.show();
    }
}

function openDawlodWindow({ app, BrowserWindow, activate = true, emitState }) {
    if (dawlodWindow && !dawlodWindow.isDestroyed()) {
        revealDawlodWindow(dawlodWindow, activate);
        dawlodWindowIsOpen = true;
        try { emitState?.(true); } catch { }
        return dawlodWindow;
    }

    // New window lifecycle: reset per-window state.
    lastAutoPasted = null;
    dawlodReadyForLinks = false;
    pendingLinkToPaste = null;

    const root = getDawlodRoot(app);
    const html = getDawlodHtmlPath(app, 'index.html');
    const preload = path.join(root, 'preload.js');
    if (!exists(html)) {
        throw new Error(`Aurivo-Dawlod not found at ${html}`);
    }
    if (!exists(preload)) {
        throw new Error(`Aurivo-Dawlod preload not found at ${preload}`);
    }

    const iconPath = resolveDawlodIconPath(app);
    const icon = iconPath ? nativeImage.createFromPath(iconPath) : undefined;

    dawlodWindow = new BrowserWindow({
        width: 1000,
        height: 780,
        minWidth: 800,
        minHeight: 600,
        autoHideMenuBar: true,
        show: false,
        title: 'Aurivo-Dawlod',
        icon,
        webPreferences: {
            preload,
            nodeIntegration: false,
            contextIsolation: true,
            spellcheck: false,
            // Keep renderer responsive when main app window is focused/occluded.
            backgroundThrottling: false,
            enableRemoteModule: false,
            // sandbox: false gerekli — preload.js require() kullaniyor (Node.js modülleri için)
            sandbox: false,
            webSecurity: true,
            allowRunningInsecureContent: false
        }
    });

    if (process.platform === 'linux' && icon && !icon.isEmpty() && typeof dawlodWindow.setIcon === 'function') {
        dawlodWindow.setIcon(icon);
    }
    dawlodWindowIsOpen = true;
    try { emitState?.(true); } catch { }

    dawlodWindow.loadFile(html);

    if (typeof dawlodWindow.webContents.setWindowOpenHandler === 'function') {
        dawlodWindow.webContents.setWindowOpenHandler(({ url }) => {
            const targetUrl = String(url || '').trim();
            if (!targetUrl || targetUrl === 'about:blank') {
                return {
                    action: 'allow',
                    overrideBrowserWindowOptions: {
                        icon,
                        title: 'Aurivo-Dawlod',
                        autoHideMenuBar: true
                    }
                };
            }
            if (/^https?:\/\//i.test(targetUrl)) {
                shell.openExternal(targetUrl).catch(() => {});
            }
            return { action: 'deny' };
        });
    }

    dawlodWindow.webContents.on('will-navigate', (event, url) => {
        const targetUrl = String(url || '').trim();
        if (targetUrl && !targetUrl.startsWith('file:') && targetUrl !== 'about:blank') {
            event.preventDefault();
        }
    });

    dawlodWindow.webContents.on('will-attach-webview', (event, webPreferences) => {
        try {
            webPreferences.nodeIntegration = false;
            webPreferences.contextIsolation = true;
            webPreferences.sandbox = true;
            webPreferences.enableRemoteModule = false;
            webPreferences.allowRunningInsecureContent = false;
            webPreferences.webSecurity = true;
            delete webPreferences.preload;
        } catch (e) {
            console.warn('[SECURITY] Dawlod webview hardening error:', e?.message || e);
        }
    });

    // Apply desired locale as soon as the page is ready (and on subsequent navigations).
    const applyLocale = (locale) => {
        if (!locale) return;
        if (!dawlodWindow || dawlodWindow.isDestroyed()) return;
        const js = `
            try {
              const loc = ${JSON.stringify(String(locale))};
              localStorage.setItem("locale", loc);
              localStorage.setItem("localeUserSelected", "false");
              if (window.i18n && typeof window.i18n.setLocale === "function") {
                window.i18n.setLocale(loc);
              } else {
                // Fallback: reload once translations load
                try { document.dispatchEvent(new Event("translations-loaded")); } catch {}
              }
            } catch (e) {}
        `;
        dawlodWindow.webContents.executeJavaScript(js, true).catch(() => { });
    };

    const autoPasteClipboardLink = () => {
        if (!dawlodWindow || dawlodWindow.isDestroyed()) return;
        const url = readClipboardUrl();
        if (!url) return;
        // Avoid spamming on reloads if clipboard didn't change.
        if (lastAutoPasted === url) return;
        if (!dawlodReadyForLinks) {
            pendingLinkToPaste = url;
            return;
        }
        try { dawlodWindow.webContents.send('link', url); } catch { return; }
        lastAutoPasted = url;
    };

    dawlodWindow.webContents.on('did-finish-load', () => {
        applyLocale(desiredDawlodLocale);
        autoPasteClipboardLink();
    });

    dawlodWindow.once('ready-to-show', () => {
        if (!dawlodWindow || dawlodWindow.isDestroyed()) return;
        revealDawlodWindow(dawlodWindow, activate);
    });

    dawlodWindow.on('closed', () => {
        dawlodWindow = null;
        lastAutoPasted = null;
        dawlodReadyForLinks = false;
        pendingLinkToPaste = null;
        dawlodWindowIsOpen = false;
        try { emitState?.(false); } catch { }
    });

    return dawlodWindow;
}

function registerDawlodIpc({ ipcMain, app, dialog, shell, BrowserWindow, getMainWindow }) {
    const DownloadHistory = require(path.join(getDawlodRoot(app), 'src', 'history.js'));
    const history = new DownloadHistory();

    const sendToDawlod = (channel, payload) => {
        if (!dawlodWindow || dawlodWindow.isDestroyed()) return;
        dawlodWindow.webContents.send(channel, payload);
    };
    const emitDawlodWindowState = (open) => {
        dawlodWindowIsOpen = !!open;
        const main = typeof getMainWindow === 'function' ? getMainWindow() : null;
        if (!main || main.isDestroyed()) return;
        try {
            main.webContents.send('dawlod:window-state', { open: dawlodWindowIsOpen });
        } catch {
            // best-effort
        }
    };

    // window management (called from Aurivo proper via preload)
    ipcMain.handle('dawlod:openWindow', async (_event, options) => {
        const shouldActivate = !(options && typeof options === 'object' && options.activate === false);
        const win = openDawlodWindow({ app, BrowserWindow, activate: shouldActivate, emitState: emitDawlodWindowState });
        // Always try to paste the current clipboard URL when user explicitly opens Dawlod.
        try {
            const preferred = options && typeof options === 'object' ? options.url : null;
            const preferredUrl = preferred ? parseHttpUrl(preferred)?.toString() : null;
            const url = preferredUrl || readClipboardUrl();
            if (!url) return true;
            if (win && !win.isDestroyed()) {
                pendingLinkToPaste = url;
                if (dawlodReadyForLinks) {
                    try { win.webContents.send('link', url); lastAutoPasted = url; } catch { /* ignore */ }
                }
            }
        } catch {
            // ignore
        }
        return true;
    });
    ipcMain.handle('dawlod:getWindowState', async () => {
        return { open: !!(dawlodWindowIsOpen && dawlodWindow && !dawlodWindow.isDestroyed()) };
    });

    ipcMain.handle('dawlod:setLocale', async (_event, lang) => {
        desiredDawlodLocale = String(lang || '').trim() || null;
        if (desiredDawlodLocale && dawlodWindow && !dawlodWindow.isDestroyed()) {
            try {
                const js = `
                    try {
                      const loc = ${JSON.stringify(String(desiredDawlodLocale))};
                      localStorage.setItem("locale", loc);
                      localStorage.setItem("localeUserSelected", "false");
                      if (window.i18n && typeof window.i18n.setLocale === "function") {
                        window.i18n.setLocale(loc);
                      }
                    } catch (e) {}
                `;
                await dawlodWindow.webContents.executeJavaScript(js, true);
            } catch {
                // ignore
            }
        }
        return true;
    });

    // ---- Dawlod expected IPC channels (unprefixed) ----
    ipcMain.on('reload', (event) => {
        if (!isFromDawlod(event)) return;
        dawlodWindow?.reload();
    });

    // Dawlod preferences language change (if UI present). We keep it synced to the single global setting,
    // so just apply within Dawlod without persisting as "user selected".
    ipcMain.on('set-locale', (event, lang) => {
        if (!isFromDawlod(event)) return;
        desiredDawlodLocale = String(lang || '').trim() || desiredDawlodLocale;
        try { dawlodWindow?.webContents.send('__aurivo_locale_changed__', desiredDawlodLocale); } catch { }
    });

    ipcMain.on('quit', (event) => {
        if (!isFromDawlod(event)) return;
        dawlodWindow?.close();
    });

    ipcMain.on('progress', (event, percentage) => {
        if (!isFromDawlod(event)) return;
        try {
            if (!dawlodWindow || dawlodWindow.isDestroyed()) return;
            dawlodWindow.setProgressBar(Number(percentage) || 0);
        } catch { }
    });

    // Renderer signals it has registered its IPC handlers and can accept 'link' events.
    ipcMain.on('ready-for-links', (event) => {
        if (!isFromDawlod(event)) return;
        dawlodReadyForLinks = true;
        if (!pendingLinkToPaste) return;
        const url = pendingLinkToPaste;
        pendingLinkToPaste = null;
        if (lastAutoPasted === url) return;
        try { dawlodWindow?.webContents.send('link', url); lastAutoPasted = url; } catch { }
    });

    ipcMain.on('get-version', (event) => {
        if (!isFromDawlod(event)) return;
        try {
            event.sender.send('version', app.getVersion());
        } catch { }
    });

    ipcMain.on('show-file', async (event, fullPath) => {
        if (!isFromDawlod(event)) return;
        try { shell.showItemInFolder(String(fullPath || '')); } catch { }
    });

    ipcMain.handle('show-file', async (event, fullPath) => {
        if (!isFromDawlod(event)) return { success: false, error: 'not-dawlod' };
        try {
            shell.showItemInFolder(String(fullPath || ''));
            return { success: true };
        } catch (e) {
            return { success: false, error: String(e?.message || e) };
        }
    });

    ipcMain.handle('open-folder', async (event, folderPath) => {
        if (!isFromDawlod(event)) return { success: false, error: 'not-dawlod' };
        try {
            const result = await shell.openPath(String(folderPath || ''));
            if (result) return { success: false, error: result };
            return { success: true };
        } catch (e) {
            return { success: false, error: String(e?.message || e) };
        }
    });

    ipcMain.on('load-win', async (event, file) => {
        if (!isFromDawlod(event)) return;
        try {
            if (!dawlodWindow || dawlodWindow.isDestroyed()) return;
            await dawlodWindow.loadFile(String(file || ''));
        } catch (e) {
            console.error('[Dawlod] load-win failed:', e?.message || e);
        }
    });

    ipcMain.on('load-page', async (event, file) => {
        if (!isFromDawlod(event)) return;
        try {
            if (!dawlodWindow || dawlodWindow.isDestroyed()) return;
            await dawlodWindow.loadFile(String(file || ''));
        } catch (e) {
            console.error('[Dawlod] load-page failed:', e?.message || e);
        }
    });

    ipcMain.on('select-location-main', async (event) => {
        if (!isFromDawlod(event)) return;
        if (!dawlodWindow || dawlodWindow.isDestroyed()) return;
        const { canceled, filePaths } = await dialog.showOpenDialog(dawlodWindow, { properties: ['openDirectory'] });
        if (!canceled && filePaths.length > 0) sendToDawlod('downloadPath', filePaths);
    });

    ipcMain.on('select-location-secondary', async (event) => {
        if (!isFromDawlod(event)) return;
        if (!dawlodWindow || dawlodWindow.isDestroyed()) return;
        const { canceled, filePaths } = await dialog.showOpenDialog(dawlodWindow, { properties: ['openDirectory'] });
        if (!canceled && filePaths.length > 0) sendToDawlod('downloadPath', filePaths);
    });

    ipcMain.on('select-config', async (event) => {
        if (!isFromDawlod(event)) return;
        if (!dawlodWindow || dawlodWindow.isDestroyed()) return;
        const { canceled, filePaths } = await dialog.showOpenDialog(dawlodWindow, { properties: ['openFile'] });
        if (!canceled && filePaths.length > 0) sendToDawlod('configPath', filePaths);
    });

    ipcMain.on('get-directory', async (event) => {
        if (!isFromDawlod(event)) return;
        if (!dawlodWindow || dawlodWindow.isDestroyed()) return;
        const { canceled, filePaths } = await dialog.showOpenDialog(dawlodWindow, { properties: ['openDirectory'] });
        if (!canceled && filePaths.length > 0) sendToDawlod('directory-path', filePaths);
    });

    ipcMain.on('error_dialog', async (event, message) => {
        if (!isFromDawlod(event)) return;
        if (!dawlodWindow || dawlodWindow.isDestroyed()) return;
        try {
            await dialog.showMessageBox(dawlodWindow, {
                type: 'error',
                title: 'Aurivo-Dawlod',
                message: String(message || 'Error'),
                buttons: ['OK']
            });
        } catch { }
    });

    ipcMain.handle('get-translation', async (event, locale) => {
        if (!isFromDawlod(event)) return {};
        const loc = String(locale || '').trim() || 'en';
        const root = getDawlodRoot(app);
        const fallback = path.join(root, 'translations', 'en.json');
        const target = path.join(root, 'translations', `${loc}.json`);
        const read = (p) => {
            try { return JSON.parse(fs.readFileSync(p, 'utf8')) || {}; } catch { return {}; }
        };
        const a = read(fallback);
        const b = exists(target) ? read(target) : {};
        return { ...a, ...b };
    });

    // Auto-update / tray toggles: not supported inside the host app (no-op)
    ipcMain.on('autoUpdate', (event) => { if (isFromDawlod(event)) { } });
    ipcMain.on('useTray', (event) => { if (isFromDawlod(event)) { } });

    // Linux-only in Dawlod: return informative errors on Windows/macOS
    ipcMain.handle('install-ffmpeg-linux', async (event) => {
        if (!isFromDawlod(event)) return { success: false, message: 'not-dawlod' };
        return { success: false, message: 'Only available on Linux.' };
    });
    ipcMain.handle('install-ffmpeg-linux-yay', async (event) => {
        if (!isFromDawlod(event)) return { success: false, message: 'not-dawlod' };
        return { success: false, message: 'Only available on Linux.' };
    });

    // Download History API
    ipcMain.handle('get-download-history', async (event) => {
        if (!isFromDawlod(event)) return [];
        return await history.getHistory();
    });
    ipcMain.handle('add-to-history', async (event, info) => {
        if (!isFromDawlod(event)) return false;
        await history.addDownload(info || {});
        return true;
    });
    ipcMain.handle('get-download-stats', async (event) => {
        if (!isFromDawlod(event)) return { totalDownloads: 0, totalSize: 0, byFormat: {} };
        return await history.getStats();
    });
    ipcMain.handle('delete-history-item', async (event, id) => {
        if (!isFromDawlod(event)) return false;
        return await history.removeHistoryItem(String(id || ''));
    });
    ipcMain.handle('clear-all-history', async (event) => {
        if (!isFromDawlod(event)) return true;
        await history.clearHistory();
        return true;
    });
    ipcMain.handle('export-history-json', async (event) => {
        if (!isFromDawlod(event)) return '[]';
        return await history.exportAsJSON();
    });
    ipcMain.handle('export-history-csv', async (event) => {
        if (!isFromDawlod(event)) return '';
        return await history.exportAsCSV();
    });
}

module.exports = { openDawlodWindow, registerDawlodIpc };
