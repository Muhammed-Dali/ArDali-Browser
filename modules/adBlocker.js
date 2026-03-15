'use strict';

const path = require('path');
const fs = require('fs');

const UBOL_RELATIVE_PATH = path.join('uDALİ-weman-home', 'chromium');

const DEFAULT_CONFIG = {
    mode: 'ideal', // basic | ideal | aggressive
    autoReload: false,
    showBlockedCount: true,
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
const blockedRequestSeen = new Set();
const WEB_REQUEST_FILTER = { urls: ['*://*/*'] };
const pendingAdCandidates = new Map();
let pendingSweepTimer = null;
const PENDING_BLOCK_CONFIRM_MS = 900;
let builtinBlockingEnabled = false;
const AD_HOST_KEYWORDS = [
    'doubleclick.net',
    'googlesyndication.com',
    'googleadservices.com',
    'adservice.google.',
    'adsystem',
    'adnxs.com',
    'taboola.com',
    'outbrain.com',
    'criteo.com',
    'scorecardresearch.com',
    'zedo.com',
    'adform.net',
    'tracking',
    'analytics',
];
const AGGRESSIVE_EXTRA_KEYWORDS = [
    'pixel',
    '/beacon',
    'telemetry',
    'metrics',
    'collect?',
];

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

function getSessionExtensionsApi(ses) {
    return (ses && typeof ses === 'object' && ses.extensions && typeof ses.extensions === 'object')
        ? ses.extensions
        : null;
}

function getAllExtensionsFromSession(ses) {
    const extApi = getSessionExtensionsApi(ses);
    if (extApi && typeof extApi.getAllExtensions === 'function') {
        return extApi.getAllExtensions();
    }
    return {};
}

async function loadExtensionIntoSession(ses, extensionPath) {
    const extApi = getSessionExtensionsApi(ses);
    if (extApi && typeof extApi.loadExtension === 'function') {
        return await extApi.loadExtension(extensionPath, { allowFileAccess: true });
    }
    throw new Error('Session extension loader is unavailable');
}

function removeExtensionFromSession(ses, extensionId) {
    if (!extensionId) return;
    const extApi = getSessionExtensionsApi(ses);
    if (extApi && typeof extApi.removeExtension === 'function') {
        extApi.removeExtension(extensionId);
    }
}

async function loadUbolIntoSession(ses, label, extensionPath) {
    if (!ses) return false;
    const extApi = getSessionExtensionsApi(ses);
    if (!extApi && typeof ses.loadExtension !== 'function') return false;

    const key = getSessionKey(ses, label);
    if (loadedSessionKeys.has(key)) return true;

    const all = getAllExtensionsFromSession(ses);
    const existing = getExistingExtensionMeta(all, extensionPath);

    if (existing) {
        try {
            removeExtensionFromSession(ses, existing.id);
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

    const loaded = await loadExtensionIntoSession(ses, extensionPath);
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

function unloadUbolFromSession(ses, extensionPath) {
    try {
        if (!ses) return;
        const all = getAllExtensionsFromSession(ses);
        const existing = getExistingExtensionMeta(all, extensionPath);
        removeExtensionFromSession(ses, existing?.id);
    } catch {
        // yoksay
    }
}

function resetStats() {
    stats.blocked = 0;
    stats.allowed = 0;
    stats.startTime = Date.now();
    blockedRequestSeen.clear();
    pendingAdCandidates.clear();
}

function shouldCountRequest(details = {}) {
    const url = String(details?.url || '');
    if (!url) return false;
    if (!/^https?:\/\//i.test(url)) return false;
    return true;
}

function getRequestFingerprint(details = {}) {
    const requestId = String(details?.id ?? '');
    const webContentsId = String(details?.webContentsId ?? '');
    if (!requestId && !webContentsId) return '';
    return `${webContentsId}:${requestId}`;
}

function markBlockedOnce(details = {}) {
    const key = getRequestFingerprint(details);
    if (!key) return;
    markBlockedByKey(key);
}

function markBlockedByKey(key = '') {
    if (!key) return;
    if (blockedRequestSeen.has(key)) return;
    blockedRequestSeen.add(key);
    stats.blocked += 1;
}

function isLikelyUbolRedirect(redirectUrl = '') {
    const url = String(redirectUrl || '');
    if (!url) return false;
    if (!/^chrome-extension:\/\//i.test(url)) return false;
    if (url.includes('/web_accessible_resources/')) return true;
    if (url.includes('/strictblock.html')) return true;
    return false;
}

function isLikelyAdOrTrackerURL(rawUrl = '') {
    const url = String(rawUrl || '').toLowerCase();
    if (!url.startsWith('http://') && !url.startsWith('https://')) return false;
    return (
        url.includes('doubleclick.net') ||
        url.includes('googlesyndication.com') ||
        url.includes('googleadservices.com') ||
        url.includes('adservice.google.') ||
        url.includes('adsystem') ||
        url.includes('/ads?') ||
        url.includes('/adserver') ||
        url.includes('/adservice') ||
        url.includes('/pagead/') ||
        url.includes('/ptracking') ||
        url.includes('taboola.com') ||
        url.includes('outbrain.com')
    );
}

function shouldBlockRequestByMode(details = {}) {
    const mode = normalizeMode(runtimeConfig.mode);
    if (mode === 'basic') return false;
    const url = String(details?.url || '').toLowerCase();
    if (!url.startsWith('http://') && !url.startsWith('https://')) return false;
    const rtype = String(details?.resourceType || '').toLowerCase();
    if (rtype === 'mainframe') return false;

    const hitsBase = AD_HOST_KEYWORDS.some((key) => url.includes(key));
    if (hitsBase) return true;

    if (mode === 'aggressive') {
        if (AGGRESSIVE_EXTRA_KEYWORDS.some((key) => url.includes(key))) return true;
        if (rtype === 'xhr' || rtype === 'fetch' || rtype === 'ping' || rtype === 'image') {
            if (url.includes('/ads') || url.includes('ad_') || url.includes('utm_')) return true;
        }
    }
    return false;
}

function rememberPendingAdCandidate(details = {}) {
    const key = getRequestFingerprint(details);
    if (!key) return;
    const rtype = String(details?.resourceType || '').toLowerCase();
    if (rtype === 'mainframe') return;
    if (!isLikelyAdOrTrackerURL(details?.url)) return;
    pendingAdCandidates.set(key, { createdAt: Date.now() });
}

function clearPendingAdCandidate(details = {}) {
    const key = getRequestFingerprint(details);
    if (!key) return;
    pendingAdCandidates.delete(key);
}

function startPendingSweepLoop() {
    if (pendingSweepTimer) return;
    pendingSweepTimer = setInterval(() => {
        const now = Date.now();
        for (const [key, meta] of pendingAdCandidates.entries()) {
            if ((now - Number(meta?.createdAt || 0)) < PENDING_BLOCK_CONFIRM_MS) continue;
            markBlockedByKey(key);
            pendingAdCandidates.delete(key);
        }
    }, 250);
}

function bindStatsTrackingForSession(ses) {
    if (!ses || statsBoundSessions.has(ses)) return;
    statsBoundSessions.add(ses);
    startPendingSweepLoop();

    try {
        ses.webRequest.onBeforeRequest(WEB_REQUEST_FILTER, (details, callback) => {
            try {
                if (!shouldCountRequest(details)) {
                    callback?.({});
                    return;
                }
                rememberPendingAdCandidate(details);
                if (builtinBlockingEnabled && shouldBlockRequestByMode(details)) {
                    markBlockedOnce(details);
                    clearPendingAdCandidate(details);
                    callback?.({ cancel: true });
                    return;
                }
            } catch {
                // no-op
            }
            callback?.({});
        });
    } catch {
        // no-op
    }

    try {
        ses.webRequest.onErrorOccurred(WEB_REQUEST_FILTER, (details) => {
            try {
                if (!shouldCountRequest(details)) return;
                const err = String(details?.error || '').toUpperCase();
                const rtype = String(details?.resourceType || '').toLowerCase();
                if (err.includes('ERR_BLOCKED_BY_CLIENT')) {
                    markBlockedOnce(details);
                    clearPendingAdCandidate(details);
                    return;
                }
                // Electron'da DNR/uBOL engellemeleri bazı isteklerde ERR_ABORTED olarak görülebiliyor.
                // Ana sayfa gezinmesini saymamak için main_frame haricini dikkate al.
                if (err.includes('ERR_ABORTED') && rtype !== 'mainframe') {
                    markBlockedOnce(details);
                    clearPendingAdCandidate(details);
                    return;
                }
                // Bazı ortamlarda reklam/tracker engellemeleri ERR_FAILED koduna düşebiliyor.
                // Yanlış sayımı azaltmak için yalnızca tipik ad/tracker URL'lerinde say.
                if (err.includes('ERR_FAILED') && isLikelyAdOrTrackerURL(details?.url)) {
                    markBlockedOnce(details);
                    clearPendingAdCandidate(details);
                }
            } catch {
                // no-op
            }
        });
    } catch {
        // no-op
    }

    try {
        ses.webRequest.onBeforeRedirect(WEB_REQUEST_FILTER, (details) => {
            try {
                if (!shouldCountRequest(details)) return;
                const redirectURL = String(details?.redirectURL || '');
                if (isLikelyUbolRedirect(redirectURL)) {
                    markBlockedOnce(details);
                    clearPendingAdCandidate(details);
                }
            } catch {
                // no-op
            }
        });
    } catch {
        // no-op
    }

    try {
        ses.webRequest.onCompleted(WEB_REQUEST_FILTER, (details) => {
            try {
                if (!shouldCountRequest(details)) return;
                clearPendingAdCandidate(details);
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
        autoReload: !!runtimeConfig.autoReload,
        showBlockedCount: !!runtimeConfig.showBlockedCount,
        strictBlock: !!runtimeConfig.strictBlock,
        developerMode: !!runtimeConfig.developerMode,
        provider: blockerProvider.active,
    };
}

function setConfig(next = {}) {
    const patch = (next && typeof next === 'object') ? next : {};
    runtimeConfig = {
        mode: normalizeMode(patch.mode ?? runtimeConfig.mode ?? DEFAULT_CONFIG.mode),
        autoReload: patch.autoReload === undefined ? !!runtimeConfig.autoReload : !!patch.autoReload,
        showBlockedCount: patch.showBlockedCount === undefined ? !!runtimeConfig.showBlockedCount : !!patch.showBlockedCount,
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
        includeDefaultSession = false,
        enabled = true,
        useExtension = true,
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
    builtinBlockingEnabled = false;

    const targets = [];
    try { targets.push({ ses: electronSession.fromPartition(webviewPartition), label: `partition:${webviewPartition}` }); } catch { }
    if (includeDefaultSession) {
        try { targets.push({ ses: electronSession.defaultSession, label: 'defaultSession' }); } catch { }
    }

    const bindTargets = () => {
        for (const target of targets) {
            try { bindStatsTrackingForSession(target.ses); } catch { }
        }
    };

    if (!enabled) {
        bindTargets();
        blockerProvider.active = 'disabled';
        blockerProvider.ubol.error = 'AdBlocker devre dışı';
        console.log('[AdBlocker] Devre dışı bırakıldı (settings)');
        return;
    }

    if (!useExtension) {
        builtinBlockingEnabled = true;
        bindTargets();
        blockerProvider.active = 'builtin';
        blockerProvider.ubol.enabled = false;
        blockerProvider.ubol.error = 'Built-in mode (extension disabled)';
        console.log('[AdBlocker] Built-in engelleyici aktif (uBOL uzantısı kapalı)');
        return;
    }

    const extensionPath = resolveUbolExtensionPath();
    if (!extensionPath) {
        bindTargets();
        blockerProvider.active = 'builtin';
        blockerProvider.ubol.error = 'uBOL uzantı yolu bulunamadı, built-in moda düşüldü';
        console.warn('[AdBlocker] uBOL bulunamadı, built-in engelleyiciye düşüldü');
        return;
    }

    blockerProvider.ubol.extensionPath = extensionPath;
    if (!includeDefaultSession) {
        try { unloadUbolFromSession(electronSession.defaultSession, extensionPath); } catch { }
    }

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
