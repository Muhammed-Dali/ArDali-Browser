'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('ardali', Object.freeze({
    loadSettings: () => ipcRenderer.invoke('settings:load'),
    i18n: Object.freeze({
        loadLocale: (lang) => ipcRenderer.invoke('i18n:loadLocale', String(lang || '')),
        getSystemLocale: () => ipcRenderer.invoke('get-system-locale')
    }),
    onSettingsReload: (callback) => {
        if (typeof callback !== 'function') return () => {};
        const handler = (_event, settings) => callback(settings || {});
        ipcRenderer.on('settings:reloaded', handler);
        return () => ipcRenderer.removeListener('settings:reloaded', handler);
    }
}));
contextBridge.exposeInMainWorld('vaultAPI', Object.freeze({
    status: () => ipcRenderer.invoke('vault:status'),
    setEnabled: (enabled, acceptance = null) => ipcRenderer.invoke('vault:setEnabled', enabled === true, acceptance),
    create: (masterPassword) => ipcRenderer.invoke('vault:create', String(masterPassword || '')),
    unlock: (masterPassword) => ipcRenderer.invoke('vault:unlock', String(masterPassword || '')),
    lock: () => ipcRenderer.invoke('vault:lock'),
    setLockTimeout: (timeoutMs) => ipcRenderer.invoke('vault:setLockTimeout', Number(timeoutMs)),
    list: () => ipcRenderer.invoke('vault:listMetadata'),
    authorize: (masterPassword) => ipcRenderer.invoke('vault:authorize', String(masterPassword || '')),
    reveal: (id, token) => ipcRenderer.invoke('vault:reveal', String(id || ''), String(token || '')),
    save: (record) => ipcRenderer.invoke('vault:manualSave', record || {}),
    update: (id, values, token) => ipcRenderer.invoke('vault:update', String(id || ''), values || {}, String(token || '')),
    remove: (id, token) => ipcRenderer.invoke('vault:delete', String(id || ''), String(token || '')),
    changeMaster: (oldPassword, newPassword, token) => ipcRenderer.invoke('vault:changeMasterPassword', String(oldPassword || ''), String(newPassword || ''), String(token || '')),
    reset: (token) => ipcRenderer.invoke('vault:reset', String(token || ''))
}));
