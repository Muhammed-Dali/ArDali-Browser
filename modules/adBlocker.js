'use strict';

const path = require('path');
const fs = require('fs');

const UBOL_RELATIVE_PATH = path.join('uDALİ-weman-home', 'chromium');

const DEFAULT_CONFIG = {
    mode: 'ideal', // basic | ideal | aggressive
    strictBlock: false,
    developerMode: false,
};

let runtimeConfig = { ...DEFAULT_CONFIG };
let stats = {
    blocked: 0,
    allowed: 0,
    startTime: Date.now(),
};

let blockerProvider = {
    active: 'uBOL',
    ubol: {
        enabled: false,
        extensionPath: '',
        sessions: [],
        error: '',
    },
};

const loadedSessionKeys = new Set();
const statsBoundSessions = new WeakSet();

function normalizeMode(mode) {
    const value = String(mode || '').trim().toLowerCase();
    if (value === 'basic' || value === 'aggressive') return value;
    return 'ideal';
}

function hasFile(p) {
    try {
        return !!(p && fs.existsSync(p));
    } catch {
        return false;
    }
}

function resolveUbolExtensionPath() {
    const discovered = [];
    const scanRoots = [
        path.join(__dirname, '..'),
        process.resourcesPath || '',
        path.join(process.resourcesPath || '', 'app.asar.unpacked'),
    ].filter(Boolean);
    for (const root of scanRoots) {
        try {
            const entries = fs.readdirSync(root, { withFileTypes: true });
            for (const entry of entries) {
                if (!entry?.isDirectory?.()) continue;
                const name = String(entry.name || '').toLowerCase();
                if (!name.includes('weman-home')) continue;
                discovered.push(path.join(root, entry.name, 'chromium'));
            }
        } catch {
            // yoksay
        }
    }

    const candidates = [
        path.join(__dirname, '..', UBOL_RELATIVE_PATH),
        path.join(process.resourcesPath || '', UBOL_RELATIVE_PATH),
        path.join(process.resourcesPath || '', 'app.asar.unpacked', UBOL_RELATIVE_PATH),
        ...discovered,
    ];

    for (const candidate of candidates) {
        if (hasFile(path.join(candidate, 'manifest.json'))) {
            return candidate;
        }
    }
    return '';
}

function parseManifestStats(extensionPath) {
    try {
        const manifestPath = path.join(extensionPath, 'manifest.json');
        const raw = fs.readFileSync(manifestPath, 'utf8');
        const manifest = JSON.parse(raw);
        const resources = manifest?.declarative_net_request?.rule_resources;
        const enabledRulesets = Array.isArray(resources)
            ? resources.filter((r) => r && r.enabled === true).length
            : 0;

        return {
            loadedRulesets: enabledRulesets,
            scannedRules: 0,
            allowDomains: 0,
            blockDomains: 0,
            allowRegexes: 0,
            blockRegexes: 0,
        };
    } catch {
        return {
            loadedRulesets: 0,
            scannedRules: 0,
            allowDomains: 0,
            blockDomains: 0,
            allowRegexes: 0,
            blockRegexes: 0,
        };
    }
}

function getSessionKey(ses, fallbackLabel = '') {
    return String(ses?.partition || ses?.id || fallbackLabel || Math.random());
}

function getExistingExtensionMeta(extensions, extensionPath) {
    if (!extensions) return null;
    const list = Array.isArray(extensions)
        ? extensions.map((ext, idx) => [String(idx), ext])
        : Object.entries(extensions);
    for (const [fallbackId, ext] of list) {
        if (!ext) continue;
        if (ext.path === extensionPath || /uBlock Origin Lite|uBO Lite/i.test(String(ext.name || ''))) {
            const extId = String(ext.id || fallbackId || '').trim();
            return {
                id: extId,
                name: ext.name || 'uBO Lite',
                version: ext.version || '',
            };
        }
    }
    return null;
}

async function loadUbolIntoSession(ses, label, extensionPath) {
    if (!ses || typeof ses.loadExtension !== 'function') return false;

    const key = getSessionKey(ses, label);
    if (loadedSessionKeys.has(key)) return true;

    const all = typeof ses.getAllExtensions === 'function' ? ses.getAllExtensions() : {};
    const existing = getExistingExtensionMeta(all, extensionPath);

    if (existing) {
        try {
            if (typeof ses.removeExtension === 'function' && existing.id) {
                ses.removeExtension(existing.id);
            }
        } catch {
            // En iyi çaba: kaldırma başarısız olursa alttaki existing kaydı kullan.
            loadedSessionKeys.add(key);
            blockerProvider.ubol.sessions.push({
                label,
                id: existing.id,
                name: existing.name,
                version: existing.version,
                partition: String(ses?.partition || ''),
                reused: true,
            });
            return true;
        }
    }

    const loaded = await ses.loadExtension(extensionPath, { allowFileAccess: true });
    loadedSessionKeys.add(key);
    blockerProvider.ubol.sessions.push({
        label,
        id: loaded?.id || '',
        name: loaded?.name || 'uBO Lite',
        version: loaded?.version || '',
        partition: String(ses?.partition || ''),
        reused: false,
    });
    return true;
}

function resetStats() {
    stats.blocked = 0;
    stats.allowed = 0;
    stats.startTime = Date.now();
}

function shouldCountRequest(details = {}) {
    const url = String(details?.url || '');
    if (!url) return false;
    if (!/^https?:\/\//i.test(url)) return false;
    return true;
}

function bindStatsTrackingForSession(ses) {
    if (!ses || statsBoundSessions.has(ses)) return;
    statsBoundSessions.add(ses);

    try {
        ses.webRequest.onErrorOccurred((details) => {
            try {
                if (!shouldCountRequest(details)) return;
                const err = String(details?.error || '').toUpperCase();
                if (err.includes('ERR_BLOCKED_BY_CLIENT')) {
                    stats.blocked += 1;
                }
            } catch {
                // no-op
            }
        });
    } catch {
        // no-op
    }

    try {
        ses.webRequest.onCompleted((details) => {
            try {
                if (!shouldCountRequest(details)) return;
                stats.allowed += 1;
            } catch {
                // no-op
            }
        });
    } catch {
        // no-op
    }
}

function getConfig() {
    return {
        mode: normalizeMode(runtimeConfig.mode),
        strictBlock: !!runtimeConfig.strictBlock,
        developerMode: !!runtimeConfig.developerMode,
        provider: blockerProvider.active,
    };
}

function setConfig(next = {}) {
    const patch = (next && typeof next === 'object') ? next : {};
    runtimeConfig = {
        mode: normalizeMode(patch.mode ?? runtimeConfig.mode ?? DEFAULT_CONFIG.mode),
        strictBlock: patch.strictBlock === undefined ? !!runtimeConfig.strictBlock : !!patch.strictBlock,
        developerMode: patch.developerMode === undefined ? !!runtimeConfig.developerMode : !!patch.developerMode,
    };
    return getConfig();
}

function getStats() {
    const matcher = parseManifestStats(blockerProvider.ubol.extensionPath);
    return {
        blocked: stats.blocked,
        allowed: stats.allowed,
        totalRequests: stats.blocked + stats.allowed,
        uptime: Math.floor((Date.now() - stats.startTime) / 1000),
        matcher,
        provider: blockerProvider,
        config: getConfig(),
    };
}

async function initAdBlocker(electronSession, options = {}) {
    const {
        app,
        webviewPartition = 'persist:aurivo-web',
        enabled = true,
    } = options;

    blockerProvider = {
        active: 'uBOL',
        ubol: {
            enabled: false,
            extensionPath: '',
            sessions: [],
            error: '',
        },
    };
    loadedSessionKeys.clear();
    resetStats();

    if (!enabled) {
        blockerProvider.active = 'disabled';
        blockerProvider.ubol.error = 'AdBlocker devre dışı';
        console.log('[AdBlocker] Devre dışı bırakıldı (settings)');
        return;
    }

    const extensionPath = resolveUbolExtensionPath();
    if (!extensionPath) {
        blockerProvider.active = 'error';
        blockerProvider.ubol.error = 'uBOL uzantı yolu bulunamadı (manifest.json yok)';
        console.error('[AdBlocker] uBOL başlatılamadı:', blockerProvider.ubol.error);
        return;
    }

    blockerProvider.ubol.extensionPath = extensionPath;

    const targets = [];
    try { targets.push({ ses: electronSession.fromPartition(webviewPartition), label: `partition:${webviewPartition}` }); } catch { }
    try { targets.push({ ses: electronSession.defaultSession, label: 'defaultSession' }); } catch { }

    for (const target of targets) {
        try {
            bindStatsTrackingForSession(target.ses);
            await loadUbolIntoSession(target.ses, target.label, extensionPath);
        } catch (e) {
            blockerProvider.ubol.error = e?.message || String(e);
            console.error(`[AdBlocker] uBOL yüklenemedi (${target.label}):`, blockerProvider.ubol.error);
        }
    }

    blockerProvider.ubol.enabled = blockerProvider.ubol.sessions.length > 0;
    blockerProvider.active = blockerProvider.ubol.enabled ? 'uBOL' : 'error';

    if (app && typeof app.on === 'function') {
        app.on('session-created', async (createdSession) => {
            try {
                bindStatsTrackingForSession(createdSession);
                await loadUbolIntoSession(createdSession, 'session-created', extensionPath);
                blockerProvider.ubol.enabled = blockerProvider.ubol.sessions.length > 0;
                blockerProvider.active = blockerProvider.ubol.enabled ? 'uBOL' : 'error';
            } catch (e) {
                blockerProvider.ubol.error = e?.message || String(e);
                console.error('[AdBlocker] uBOL session-created yükleme hatası:', blockerProvider.ubol.error);
            }
        });
    }

    if (blockerProvider.ubol.enabled) {
        console.log('[AdBlocker] ✓ uBlock Origin Lite aktif:', {
            path: blockerProvider.ubol.extensionPath,
            sessions: blockerProvider.ubol.sessions,
        });
    } else {
        console.error('[AdBlocker] uBOL hiçbir session için yüklenemedi');
    }
}

function allowDomain(_domain) {
    // uBOL tarafında host izinleri extension içinden yönetilir.
    // Uygulama API uyumluluğu için no-op tutuldu.
    return true;
}

function blockDomain(_domain) {
    return true;
}

function getDashboardUrl() {
    const sessions = blockerProvider?.ubol?.sessions;
    if (!Array.isArray(sessions) || sessions.length === 0) return '';

    const preferred =
        sessions.find((s) => String(s?.label || '').startsWith('partition:')) ||
        sessions[0];

    const extensionId = String(preferred?.id || '').trim();
    if (!extensionId) return '';
    return `chrome-extension://${extensionId}/dashboard.html`;
}

function getDashboardLaunchInfo() {
    const sessions = Array.isArray(blockerProvider?.ubol?.sessions) ? blockerProvider.ubol.sessions : [];
    if (!sessions.length) return { url: '', partition: '' };

    const preferred =
        sessions.find((s) => String(s?.label || '').startsWith('partition:') && String(s?.id || '').trim()) ||
        sessions.find((s) => String(s?.id || '').trim()) ||
        sessions[0];

    const extensionId = String(preferred?.id || '').trim();
    if (!extensionId) return { url: '', partition: '' };

    const sessionPartition = String(preferred?.partition || '').trim();
    return {
        url: `chrome-extension://${extensionId}/dashboard.html`,
        partition: sessionPartition,
    };
}

module.exports = {
    initAdBlocker,
    getStats,
    resetStats,
    allowDomain,
    blockDomain,
    getConfig,
    setConfig,
    getDashboardUrl,
    getDashboardLaunchInfo,
};
