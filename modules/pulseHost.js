'use strict';

const path = require('path');
const { PulseService } = require('./pulse/pulseService');

function createBroadcaster({ BrowserWindow, getMainWindow }) {
    return function broadcast(channel, payload) {
        const targets = BrowserWindow.getAllWindows()
            .filter((win) => win && !win.isDestroyed());
        const mainWindow = typeof getMainWindow === 'function' ? getMainWindow() : null;
        if (mainWindow && !mainWindow.isDestroyed() && !targets.includes(mainWindow)) {
            targets.push(mainWindow);
        }
        for (const win of targets) {
            try {
                win.webContents.send(channel, payload);
            } catch {
                // best effort
            }
        }
    };
}

function registerPulseIpc({ ipcMain, app, BrowserWindow, getMainWindow, shell }) {
    const service = new PulseService({ app });
    service.loadPreferences();
    const broadcast = createBroadcaster({ BrowserWindow, getMainWindow });
    let pulseWindow = null;

    const sendWindowState = () => {
        broadcast('pulse:window-state', { open: !!(pulseWindow && !pulseWindow.isDestroyed()) });
    };

    service.on('state', (payload) => broadcast('pulse:state', payload));
    service.on('volume', (payload) => broadcast('pulse:volume', payload));
    service.on('result', (payload) => broadcast('pulse:result', payload));
    service.on('uncertain', (payload) => broadcast('pulse:uncertain', payload));

    function createPulseWindow() {
        if (pulseWindow && !pulseWindow.isDestroyed()) {
            pulseWindow.show();
            pulseWindow.focus();
            sendWindowState();
            return pulseWindow;
        }

        const parent = typeof getMainWindow === 'function' ? getMainWindow() : null;
        pulseWindow = new BrowserWindow({
            width: 1100,
            height: 866,
            minWidth: 780,
            minHeight: 560,
            backgroundColor: '#10151d',
            icon: path.join(__dirname, '..', 'icons', 'aurivo.png'),
            parent: parent && !parent.isDestroyed() ? parent : undefined,
            modal: false,
            autoHideMenuBar: true,
            show: false,
            title: 'Aurivo Dinle',
            webPreferences: {
                preload: path.join(__dirname, '..', 'preload.js'),
                additionalArguments: ['--aurivo-view=pulse'],
                nodeIntegration: false,
                contextIsolation: true,
                sandbox: false,
                webSecurity: true,
                allowRunningInsecureContent: false,
                spellcheck: false
            }
        });

        pulseWindow.loadFile(path.join(__dirname, '..', 'pulse.html'));
        pulseWindow.once('ready-to-show', () => {
            if (!pulseWindow || pulseWindow.isDestroyed()) return;
            pulseWindow.show();
            pulseWindow.focus();
            service.emitState();
            sendWindowState();
        });
        pulseWindow.on('closed', () => {
            pulseWindow = null;
            sendWindowState();
        });
        sendWindowState();
        return pulseWindow;
    }

    ipcMain.handle('pulse:openWindow', () => {
        createPulseWindow();
        return true;
    });
    ipcMain.handle('pulse:closeWindow', () => {
        if (pulseWindow && !pulseWindow.isDestroyed()) pulseWindow.close();
        return true;
    });
    ipcMain.handle('pulse:getWindowState', () => ({ open: !!(pulseWindow && !pulseWindow.isDestroyed()) }));
    ipcMain.handle('pulse:listDevices', () => service.listDevices());
    ipcMain.handle('pulse:getPreferences', () => ({ success: true, preferences: service.preferences }));
    ipcMain.handle('pulse:savePreferences', (_event, preferences) => ({ success: true, preferences: service.savePreferences(preferences) }));
    ipcMain.handle('pulse:getPreferredDevice', () => ({ success: true, audioDevice: service.preferences.current_device_name || '' }));
    ipcMain.handle('pulse:getStatus', () => ({ success: true, status: service.getStatus() }));
    ipcMain.handle('pulse:startListening', (_event, options) => service.startListening(options || {}));
    ipcMain.handle('pulse:stopListening', () => service.stopListening());
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
        broadcast('pulse:open-query', {
            query: String(payload.query || '').trim(),
            platform: String(payload.platform || 'youtube').trim().toLowerCase(),
            source: 'aurivo-pulse-gui'
        });
        return { success: true };
    });

    return service;
}

module.exports = {
    registerPulseIpc
};
