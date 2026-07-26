'use strict';

const { PulseService } = require('./pulse/pulseService');

function createBroadcaster({ BrowserWindow, webContents, getMainWindow }) {
    return function broadcast(channel, payload) {
        const targets = BrowserWindow.getAllWindows()
            .filter((win) => win && !win.isDestroyed())
            .map((win) => win.webContents);
        const mainWindow = typeof getMainWindow === 'function' ? getMainWindow() : null;
        if (mainWindow && !mainWindow.isDestroyed() && !targets.includes(mainWindow.webContents)) {
            targets.push(mainWindow.webContents);
        }
        const pulseViews = webContents?.getAllWebContents?.().filter((contents) => {
            if (!contents || contents.isDestroyed?.()) return false;
            try {
                const parsed = new URL(String(contents.getURL?.() || ''));
                return parsed.protocol === 'file:' && /\/pulse\.html$/i.test(decodeURIComponent(parsed.pathname || ''));
            } catch {
                return false;
            }
        }) || [];
        for (const contents of pulseViews) {
            if (!targets.includes(contents)) targets.push(contents);
        }
        for (const contents of targets) {
            try {
                contents.send(channel, payload);
            } catch {
                // best effort
            }
        }
    };
}

function registerPulseIpc({
    ipcMain,
    app,
    BrowserWindow,
    webContents,
    getMainWindow,
    shell,
    openApplicationTab,
    getAuxiliaryWindowDefaults,
    configureWindowForTaskbar
}) {
    const service = new PulseService({ app });
    service.loadPreferences();
    const broadcast = createBroadcaster({ BrowserWindow, webContents, getMainWindow });
    let pulseWindow = null;

    const sendWindowState = () => {
        broadcast('pulse:window-state', { open: !!(pulseWindow && !pulseWindow.isDestroyed()) });
    };

    service.on('state', (payload) => broadcast('pulse:state', payload));
    service.on('volume', (payload) => broadcast('pulse:volume', payload));
    service.on('preview-volume', (payload) => broadcast('pulse:preview-volume', payload));
    service.on('result', (payload) => broadcast('pulse:result', payload));
    service.on('uncertain', (payload) => broadcast('pulse:uncertain', payload));

    function createPulseWindow() {
        if (typeof openApplicationTab === 'function') openApplicationTab('pulse');
        return typeof getMainWindow === 'function' ? getMainWindow() : null;
    }

    ipcMain.handle('pulse:openWindow', () => {
        return typeof openApplicationTab === 'function'
            ? openApplicationTab('pulse')
            : false;
    });
    ipcMain.handle('pulse:closeWindow', () => {
        const mainWindow = typeof getMainWindow === 'function' ? getMainWindow() : null;
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('workspace:close-application-tab', { appKey: 'pulse' });
        }
        return true;
    });
    ipcMain.handle('pulse:getWindowState', () => ({ open: !!(pulseWindow && !pulseWindow.isDestroyed()) }));
    ipcMain.handle('pulse:listDevices', () => service.listDevices());
    ipcMain.handle('pulse:getPreferences', () => ({ success: true, preferences: service.preferences }));
    ipcMain.handle('pulse:savePreferences', (_event, preferences) => ({ success: true, preferences: service.savePreferences(preferences) }));
    ipcMain.handle('pulse:getPreferredDevice', () => ({ success: true, audioDevice: service.preferences.current_device_name || '' }));
    ipcMain.handle('pulse:getStatus', () => ({ success: true, status: service.getStatus() }));
    ipcMain.handle('pulse:setContextMetadata', (_event, metadata) => service.setContextMetadata(metadata || {}));
    ipcMain.handle('pulse:startListening', (_event, options) => service.startListening(options || {}));
    ipcMain.handle('pulse:stopListening', () => service.stopListening());
    ipcMain.handle('pulse:startLevelPreview', (_event, options) => service.startLevelPreview(options || {}));
    ipcMain.handle('pulse:stopLevelPreview', () => service.stopLevelPreview());
    ipcMain.handle('pulse:recognizeSample', (_event, options) => service.recognizeSample(options || {}));
    ipcMain.handle('pulse:openExternalSearch', async (_event, payload = {}) => {
        const query = String(payload.query || '').trim();
        if (!query) return { success: false, error: 'missing-query' };
        const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
        try {
            if (shell?.openExternal) await shell.openExternal(url);
            return { success: true, url };
        } catch (error) {
            return { success: false, error: error?.message || String(error) };
        }
    });
    ipcMain.handle('pulse:openQueryInApp', (_event, payload = {}) => {
        const queryPayload = {
            query: String(payload.query || '').trim(),
            platform: String(payload.platform || 'youtube').trim().toLowerCase(),
            source: 'ardali-pulse-gui'
        };
        const mainWindow = typeof getMainWindow === 'function' ? getMainWindow() : null;
        if (mainWindow && !mainWindow.isDestroyed()) {
            try {
                if (mainWindow.isMinimized()) mainWindow.restore();
                mainWindow.show();
                mainWindow.focus();
                mainWindow.webContents.send('pulse:open-query', queryPayload);
            } catch {
                broadcast('pulse:open-query', queryPayload);
            }
        } else {
            broadcast('pulse:open-query', queryPayload);
        }
        return { success: true };
    });

    return service;
}

module.exports = {
    registerPulseIpc
};
