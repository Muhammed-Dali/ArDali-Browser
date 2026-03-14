// ============================================
// AURIVO MEDIA PLAYER - Renderer Süreci
// Qt MainWindow.cpp portlu JavaScript
// C++ BASS Ses Motoru Entegrasyonu
// ============================================

// Terminal gürültüsünü azalt: sadece gerektiğinde detaylı log aç.
const AURIVO_VERBOSE_LOGS =
    typeof process !== 'undefined' &&
    process?.env &&
    process.env.AURIVO_VERBOSE_LOGS === '1';
const STARTUP_QUERY = new URLSearchParams(window.location.search);
const PRELOAD_LAUNCH_CONTEXT = window.aurivo?.launchContext || {};
const AURIVO_PERF_MONITOR_ENABLED =
    (
        (typeof process !== 'undefined' &&
            process?.env &&
            process.env.AURIVO_PERF_MONITOR === '1')
        ||
        PRELOAD_LAUNCH_CONTEXT?.perfMonitor === true
    );
const PULSE_SEARCH_DEBUG =
    typeof process !== 'undefined' &&
    process?.env &&
    process.env.PULSE_SEARCH_DEBUG === '1';
const PULSE_HIDE_AUTO_STOP_NOTICE = true;
const PULSE_NO_SIGNAL_HINT_DELAY_MS = 16000;
const PULSE_NO_SIGNAL_HINT_TOAST_DEFAULT_SEC = 6;
const PULSE_QUICK_MODE_DEFAULT = 'background';
const IS_SETTINGS_DOCUMENT = /\/settings\.html$/i.test(window.location.pathname);
const STANDALONE_VIEW = String(STARTUP_QUERY.get('view') || '').trim().toLowerCase();
const STANDALONE_SETTINGS_DEFAULT_TAB = String(STARTUP_QUERY.get('tab') || 'playback').trim().toLowerCase();
const STANDALONE_ARG_VIEW = String(PRELOAD_LAUNCH_CONTEXT.view || '').trim().toLowerCase();
const STANDALONE_ARG_TAB = String(PRELOAD_LAUNCH_CONTEXT.tab || '').trim().toLowerCase();
let forcedStandaloneSettingsMode = IS_SETTINGS_DOCUMENT || STANDALONE_VIEW === 'settings' || STANDALONE_ARG_VIEW === 'settings';
let fileTreeRenderGeneration = 0;
let systemThemeMediaQuery = null;
let systemThemeChangeListenerBound = false;

function isStandaloneSettingsMode() {
    return forcedStandaloneSettingsMode;
}

function getActiveSettingsTabName() {
    return document.querySelector('.settings-tab.active')?.dataset?.tab || '';
}

function getSystemPrefersDark() {
    try {
        if (typeof window.matchMedia !== 'function') return true;
        return !!window.matchMedia('(prefers-color-scheme: dark)').matches;
    } catch {
        return true;
    }
}

function handleSystemThemePreferenceChange() {
    if (state.settings?.appearance?.followSystemTheme === true) {
        applyAppearanceSettingsToRuntime();
    }
}

function setupSystemThemePreferenceListener() {
    if (systemThemeChangeListenerBound) return;
    if (typeof window.matchMedia !== 'function') return;
    try {
        systemThemeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
        if (typeof systemThemeMediaQuery.addEventListener === 'function') {
            systemThemeMediaQuery.addEventListener('change', handleSystemThemePreferenceChange);
        } else if (typeof systemThemeMediaQuery.addListener === 'function') {
            systemThemeMediaQuery.addListener(handleSystemThemePreferenceChange);
        }
        systemThemeChangeListenerBound = true;
    } catch {
        systemThemeMediaQuery = null;
    }
}

async function enterStandaloneSettingsMode(defaultTab = 'playback') {
    forcedStandaloneSettingsMode = true;
    document.body.classList.add('settings-window-mode');
    try {
        document.title = await window.i18n?.t?.('settings.title') || document.title;
    } catch {
        // yoksay
    }
    await loadSettings();
    try {
        await loadPlaylist();
    } catch (error) {
        console.warn('[SETTINGS] playlist load failed:', error?.message || error);
        state.playlist = [];
    }
    loadSettingsToUI();
    openSettings(defaultTab || 'playback');
}

function normalizePulsePreferenceState(input) {
    const prefs = (input && typeof input === 'object') ? { ...input } : {};
    const engine = String(prefs.recognition_engine || '').trim().toLowerCase();
    const recognitionEngine = ['hybrid', 'songrec_only', 'acoustid_only'].includes(engine)
        ? engine
        : 'hybrid';
    return {
        enable_notifications: typeof prefs.enable_notifications === 'boolean' ? prefs.enable_notifications : true,
        enable_mpris: typeof prefs.enable_mpris === 'boolean' ? prefs.enable_mpris : false,
        enable_systray: typeof prefs.enable_systray === 'boolean' ? prefs.enable_systray : false,
        no_duplicates: typeof prefs.no_duplicates === 'boolean' ? prefs.no_duplicates : false,
        request_interval_secs_v3: Math.max(1, Math.min(120, Number(prefs.request_interval_secs_v3) || 2)),
        buffer_size_secs: Math.max(4, Math.min(30, Number(prefs.buffer_size_secs) || 5)),
        current_device_name: typeof prefs.current_device_name === 'string' ? prefs.current_device_name : '',
        recognition_engine: recognitionEngine,
        acoustid_api_key: typeof prefs.acoustid_api_key === 'string' ? prefs.acoustid_api_key : ''
    };
}

function normalizeLibraryFolderEntry(entry) {
    if (!entry || typeof entry !== 'object') return null;
    const path = String(entry.path || '').trim();
    if (!path) return null;
    const fallbackName = window.aurivo?.path?.basename?.(path) || path.split(/[\\/]/).pop() || 'Klasör';
    return {
        path,
        name: String(entry.name || fallbackName).trim() || fallbackName
    };
}

function dedupeLibraryFolders(folders) {
    const result = [];
    const seen = new Set();
    for (const folder of Array.isArray(folders) ? folders : []) {
        const normalized = normalizeLibraryFolderEntry(folder);
        if (!normalized) continue;
        if (seen.has(normalized.path)) continue;
        seen.add(normalized.path);
        result.push(normalized);
    }
    return result;
}

function ensureLibrarySettings() {
    if (!state.settings || typeof state.settings !== 'object') state.settings = {};
    if (!state.settings.library || typeof state.settings.library !== 'object') {
        state.settings.library = {};
    }

    const fallbackAudio = (() => {
        try {
            const raw = localStorage.getItem(getUserFoldersStorageKey('audio'));
            return raw ? JSON.parse(raw) : [];
        } catch {
            return [];
        }
    })();
    const fallbackVideo = (() => {
        try {
            const raw = localStorage.getItem(getUserFoldersStorageKey('video'));
            return raw ? JSON.parse(raw) : [];
        } catch {
            return [];
        }
    })();

    state.settings.library.audioFolders = dedupeLibraryFolders(
        Array.isArray(state.settings.library.audioFolders) && state.settings.library.audioFolders.length
            ? state.settings.library.audioFolders
            : fallbackAudio
    );
    state.settings.library.videoFolders = dedupeLibraryFolders(
        Array.isArray(state.settings.library.videoFolders) && state.settings.library.videoFolders.length
            ? state.settings.library.videoFolders
            : fallbackVideo
    );
    state.settings.library.excludedFolders = dedupeLibraryFolders(
        Array.isArray(state.settings.library.excludedFolders)
            ? state.settings.library.excludedFolders
            : []
    );
    if (typeof state.settings.library.scanOnStartup !== 'boolean') {
        state.settings.library.scanOnStartup = true;
    }
    if (typeof state.settings.library.autoRescanOnFolderChange !== 'boolean') {
        state.settings.library.autoRescanOnFolderChange = true;
    }
    if (typeof state.settings.library.watchFolders !== 'boolean') {
        state.settings.library.watchFolders = true;
    }
    if (typeof state.settings.library.restoreLastFolder !== 'boolean') {
        state.settings.library.restoreLastFolder = true;
    }
    if (typeof state.settings.library.restoreLastPlaylist !== 'boolean') {
        state.settings.library.restoreLastPlaylist = true;
    }
    if (typeof state.settings.library.rememberTreeSelection !== 'boolean') {
        state.settings.library.rememberTreeSelection = true;
    }
    if (!state.settings.library.startupState || typeof state.settings.library.startupState !== 'object') {
        state.settings.library.startupState = {};
    }
    if (typeof state.settings.library.startupState.lastAudioPath !== 'string') {
        state.settings.library.startupState.lastAudioPath = '';
    }
    if (typeof state.settings.library.startupState.lastVideoPath !== 'string') {
        state.settings.library.startupState.lastVideoPath = '';
    }
    if (typeof state.settings.library.startupState.lastSelectedTreePath !== 'string') {
        state.settings.library.startupState.lastSelectedTreePath = '';
    }
    if (!state.settings.library.trackActivity || typeof state.settings.library.trackActivity !== 'object' || Array.isArray(state.settings.library.trackActivity)) {
        state.settings.library.trackActivity = {};
    }
    if (!state.settings.library.performance || typeof state.settings.library.performance !== 'object') {
        state.settings.library.performance = {};
    }
    if (typeof state.settings.library.performance.fastScan !== 'boolean') {
        state.settings.library.performance.fastScan = true;
    }
    if (typeof state.settings.library.performance.lightweightMode !== 'boolean') {
        state.settings.library.performance.lightweightMode = false;
    }
    if (![32, 64, 128, 256].includes(Number(state.settings.library.performance.coverCacheLimitMb))) {
        state.settings.library.performance.coverCacheLimitMb = 64;
    }
    if (!state.settings.library.smartFlows || typeof state.settings.library.smartFlows !== 'object') {
        state.settings.library.smartFlows = {};
    }
    if (typeof state.settings.library.smartFlows.favoritesEnabled !== 'boolean') {
        state.settings.library.smartFlows.favoritesEnabled = true;
    }
    if (typeof state.settings.library.smartFlows.recentEnabled !== 'boolean') {
        state.settings.library.smartFlows.recentEnabled = true;
    }
    if (typeof state.settings.library.smartFlows.mostPlayedEnabled !== 'boolean') {
        state.settings.library.smartFlows.mostPlayedEnabled = true;
    }
    if (![10, 25, 50].includes(Number(state.settings.library.smartFlows.recentLimit))) {
        state.settings.library.smartFlows.recentLimit = 25;
    }
    if (![10, 25, 50].includes(Number(state.settings.library.smartFlows.mostPlayedLimit))) {
        state.settings.library.smartFlows.mostPlayedLimit = 25;
    }
    state.settings.library.audioExtensions = Array.isArray(state.settings.library.audioExtensions)
        ? Array.from(new Set(state.settings.library.audioExtensions.map((value) => String(value || '').trim().replace(/^\./, '').toLowerCase()).filter(Boolean)))
        : [...DEFAULT_AUDIO_EXTENSIONS];
    if (!state.settings.library.audioExtensions.length) {
        state.settings.library.audioExtensions = [...DEFAULT_AUDIO_EXTENSIONS];
    }
    state.settings.library.videoExtensions = Array.isArray(state.settings.library.videoExtensions)
        ? Array.from(new Set(state.settings.library.videoExtensions.map((value) => String(value || '').trim().replace(/^\./, '').toLowerCase()).filter(Boolean)))
        : [...DEFAULT_VIDEO_EXTENSIONS];
    if (!state.settings.library.videoExtensions.length) {
        state.settings.library.videoExtensions = [...DEFAULT_VIDEO_EXTENSIONS];
    }
    if (!Number.isFinite(Number(state.settings.library.lastScanAt))) {
        state.settings.library.lastScanAt = 0;
    }
    if (!state.settings.library.metadataCache || typeof state.settings.library.metadataCache !== 'object' || Array.isArray(state.settings.library.metadataCache)) {
        state.settings.library.metadataCache = {};
    }
    if (!state.settings.library.metadataSummary || typeof state.settings.library.metadataSummary !== 'object') {
        state.settings.library.metadataSummary = {
            refreshedCount: 0,
            inferredCount: 0,
            cleanedCount: 0,
            generatedAt: 0
        };
    }
    if (!state.settings.library.diagnostics || typeof state.settings.library.diagnostics !== 'object') {
        state.settings.library.diagnostics = {
            lastScanDurationMs: 0,
            lastScanReason: 'manual',
            scanErrors: [],
            unreadableFiles: []
        };
    }
    if (!Number.isFinite(Number(state.settings.library.diagnostics.lastScanDurationMs))) {
        state.settings.library.diagnostics.lastScanDurationMs = 0;
    }
    if (!Array.isArray(state.settings.library.diagnostics.scanErrors)) {
        state.settings.library.diagnostics.scanErrors = [];
    }
    if (!Array.isArray(state.settings.library.diagnostics.unreadableFiles)) {
        state.settings.library.diagnostics.unreadableFiles = [];
    }
    if (typeof state.settings.library.preferEmbeddedCover !== 'boolean') {
        state.settings.library.preferEmbeddedCover = true;
    }
    if (typeof state.settings.library.scanFolderCover !== 'boolean') {
        state.settings.library.scanFolderCover = true;
    }
    if (typeof state.settings.library.markMissingCovers !== 'boolean') {
        state.settings.library.markMissingCovers = true;
    }
    if (!['title', 'artist', 'album', 'added'].includes(String(state.settings.library.viewSort || '').toLowerCase())) {
        state.settings.library.viewSort = 'title';
    }
    if (!['none', 'artist', 'album'].includes(String(state.settings.library.viewGroup || '').toLowerCase())) {
        state.settings.library.viewGroup = 'none';
    }
    if (!['list', 'compact', 'comfortable', 'cards'].includes(String(state.settings.library.viewMode || '').toLowerCase())) {
        state.settings.library.viewMode = 'list';
    }

    return state.settings.library;
}

function escapeAttribute(value) {
    return String(value ?? '').replace(/"/g, '&quot;');
}

const __origLog = console.log.bind(console);
console.log = (...args) => {
    if (!AURIVO_VERBOSE_LOGS) {
        const first = String(args?.[0] ?? '');
        if (
            first.includes('[DEBUG]') ||
            first.includes('Capture-phase handler tetiklendi') ||
            first.includes('Click-outside: Menüleri kapatıyor') ||
            first.includes('Click-outside: Settings butonuna tıklandı, skip') ||
            first.includes('setFsMenuVisible çağrıldı') ||
            first.includes('Menü kapatıldı')
        ) {
            return;
        }
    }
    __origLog(...args);
};

function pulseSearchDebug(...args) {
    if (!PULSE_SEARCH_DEBUG) return;
    try {
        __origLog('[PULSE_SEARCH_DEBUG]', ...args);
    } catch {
        // yoksay
    }
}

const PerfMonitor = {
    running: false,
    intervalMs: 5000,
    sampleTimer: null,
    rafId: 0,
    frames: 0,
    jankCount: 0,
    maxFrameMs: 0,
    frameTimes: [],
    longTasks: [],
    observer: null,
    lastFrameTs: 0,

    start(intervalMs = 5000) {
        this.stop();
        this.running = true;
        this.intervalMs = Math.max(1000, Number(intervalMs) || 5000);
        this.resetWindow();
        this.installLongTaskObserver();
        this.rafId = requestAnimationFrame((ts) => this.onFrame(ts));
        this.sampleTimer = setInterval(() => {
            this.logSnapshot().catch((error) => {
                console.warn('[PERF] snapshot failed:', error?.message || error);
            });
        }, this.intervalMs);
        console.log(`[PERF] monitor started (${this.intervalMs}ms)`);
    },

    stop() {
        this.running = false;
        if (this.sampleTimer) {
            clearInterval(this.sampleTimer);
            this.sampleTimer = null;
        }
        if (this.rafId) {
            cancelAnimationFrame(this.rafId);
            this.rafId = 0;
        }
        if (this.observer) {
            try { this.observer.disconnect(); } catch { }
            this.observer = null;
        }
    },

    resetWindow() {
        this.frames = 0;
        this.jankCount = 0;
        this.maxFrameMs = 0;
        this.frameTimes = [];
        this.longTasks = [];
        this.lastFrameTs = 0;
    },

    installLongTaskObserver() {
        if (typeof PerformanceObserver !== 'function') return;
        try {
            this.observer = new PerformanceObserver((list) => {
                for (const entry of list.getEntries()) {
                    this.longTasks.push({
                        duration: Number(entry.duration || 0),
                        startTime: Number(entry.startTime || 0)
                    });
                    if (this.longTasks.length > 20) this.longTasks.shift();
                }
            });
            this.observer.observe({ entryTypes: ['longtask'] });
        } catch {
            this.observer = null;
        }
    },

    onFrame(timestamp) {
        if (!this.running) return;
        if (this.lastFrameTs) {
            const frameMs = timestamp - this.lastFrameTs;
            this.frameTimes.push(frameMs);
            if (this.frameTimes.length > 240) this.frameTimes.shift();
            if (frameMs > 34) this.jankCount++;
            if (frameMs > this.maxFrameMs) this.maxFrameMs = frameMs;
        }
        this.lastFrameTs = timestamp;
        this.frames++;
        this.rafId = requestAnimationFrame((ts) => this.onFrame(ts));
    },

    getRendererSnapshot() {
        const frameCount = this.frameTimes.length;
        const avgFrameMs = frameCount
            ? this.frameTimes.reduce((sum, value) => sum + value, 0) / frameCount
            : 0;
        const fps = avgFrameMs > 0 ? 1000 / avgFrameMs : 0;
        const longTaskCount = this.longTasks.length;
        const longTaskTotalMs = this.longTasks.reduce((sum, task) => sum + task.duration, 0);
        const memory = performance?.memory
            ? {
                usedJsHeapMb: Math.round((performance.memory.usedJSHeapSize / 1048576) * 10) / 10,
                totalJsHeapMb: Math.round((performance.memory.totalJSHeapSize / 1048576) * 10) / 10,
                heapLimitMb: Math.round((performance.memory.jsHeapSizeLimit / 1048576) * 10) / 10
            }
            : null;

        return {
            fps: Math.round(fps * 10) / 10,
            avgFrameMs: Math.round(avgFrameMs * 10) / 10,
            maxFrameMs: Math.round(this.maxFrameMs * 10) / 10,
            jankCount: this.jankCount,
            frameSamples: frameCount,
            longTaskCount,
            longTaskTotalMs: Math.round(longTaskTotalMs * 10) / 10,
            memory,
            hidden: document.hidden,
            focused: document.hasFocus(),
            activePage: state?.currentPage || '',
            activeMedia: state?.activeMedia || '',
            isPlaying: !!state?.isPlaying,
            visualizer: {
                analyzer: VisualizerSettings?.currentAnalyzer || '',
                configuredFps: Number(VisualizerSettings?.currentFramerate || 0),
                effectiveFps: typeof getEffectiveVisualizerFps === 'function' ? getEffectiveVisualizerFps() : 0
            }
        };
    },

    async captureSnapshot() {
        const renderer = this.getRendererSnapshot();
        const main = await window.aurivo?.diagnostics?.getPerformanceSnapshot?.();
        return {
            timestamp: Date.now(),
            renderer,
            main: main || null
        };
    },

    summarize(snapshot) {
        const renderer = snapshot?.renderer || {};
        const metrics = Array.isArray(snapshot?.main?.metrics) ? snapshot.main.metrics : [];
        const rendererPid = snapshot?.main?.windows?.main?.osPid;
        const mainProc = metrics.find((item) => item.type === 'Browser') || null;
        const rendererProc = metrics.find((item) => item.pid === rendererPid) || metrics.find((item) => item.type === 'Tab') || null;
        const gpuProc = metrics.find((item) => item.type === 'GPU') || null;

        return {
            rendererFps: renderer.fps,
            rendererAvgFrameMs: renderer.avgFrameMs,
            rendererMaxFrameMs: renderer.maxFrameMs,
            rendererJank: renderer.jankCount,
            rendererLongTasks: renderer.longTaskCount,
            rendererHeapMb: renderer.memory?.usedJsHeapMb ?? null,
            browserCpu: mainProc ? Math.round(mainProc.cpu * 10) / 10 : null,
            browserMemMb: mainProc ? Math.round((mainProc.memoryWorkingSetKb / 1024) * 10) / 10 : null,
            rendererCpu: rendererProc ? Math.round(rendererProc.cpu * 10) / 10 : null,
            rendererMemMb: rendererProc ? Math.round((rendererProc.memoryWorkingSetKb / 1024) * 10) / 10 : null,
            gpuCpu: gpuProc ? Math.round(gpuProc.cpu * 10) / 10 : null,
            gpuMemMb: gpuProc ? Math.round((gpuProc.memoryWorkingSetKb / 1024) * 10) / 10 : null,
            analyzer: renderer.visualizer?.analyzer || '',
            visualizerFps: renderer.visualizer?.effectiveFps || 0,
            activePage: renderer.activePage || '',
            activeMedia: renderer.activeMedia || '',
            isPlaying: renderer.isPlaying ? 'yes' : 'no'
        };
    },

    async logSnapshot() {
        const snapshot = await this.captureSnapshot();
        console.log('[PERF] ' + JSON.stringify(this.summarize(snapshot)));
        this.resetWindow();
        return snapshot;
    }
};

try {
    window.AurivoPerf = {
        start: (intervalMs) => PerfMonitor.start(intervalMs),
        stop: () => PerfMonitor.stop(),
        snapshot: () => PerfMonitor.captureSnapshot(),
        logSnapshot: () => PerfMonitor.logSnapshot(),
        state: PerfMonitor
    };
} catch {
    // yoksay
}

// Hata ayıklama: window.aurivo kontrolü
console.log('[RENDERER] Script başlıyor...');
console.log('[RENDERER] window.aurivo:', typeof window.aurivo);
if (window.aurivo) {
    console.log('[RENDERER] aurivo anahtarları:', Object.keys(window.aurivo));
} else {
    console.error('[RENDERER] ⚠ window.aurivo undefined!');
}

// C++ Native Ses Motoru kullanılabilir mi?
let useNativeAudio = false;

// Durum
const state = {
    currentPage: 'files',
    currentPanel: 'library',
    webDrawerCollapsed: false,
    playlist: [],
    currentIndex: -1,
    isPlaying: false,
    isShuffle: false,
    isRepeat: false,
    stopAfterCurrent: false, // Sistem tepsisi "Geçerli parçadan sonra durdur" özelliği
    volume: 40,
    isMuted: false,
    savedVolume: 40,
    currentPath: '',
    pathHistory: [],
    pathForward: [],
    settings: null,
    mediaFilter: 'audio', // 'audio' - sadece ses dosyaları
    activeMedia: 'none', // 'audio', 'video', 'web', 'none'
    currentCover: null,
    // Çapraz geçiş durumu
    crossfadeInProgress: false,
    autoCrossfadeTriggered: false,
    trackAboutToEnd: false,
    trackAboutToEndTriggered: false,
    playbackEndWarnedTrackKey: '',
    playbackStatePersistSecond: -1,
    activePlayer: 'A', // 'A' veya 'B'
    // Native ses durumu
    nativePositionTimer: null,
    nativePositionGeneration: 0,
    // MPRIS takibi
    lastMPRISPosition: -1,
    // Sekme bazlı konum hafızası
    lastAudioPath: null, // Müzik sekmesi son konum
    lastVideoPath: null, // Video sekmesi son konum
    pendingLibraryStartupPath: '',
    // Video durumu (müzikten tamamen ayrı)
    videoFiles: [], // Mevcut klasördeki video dosyaları
    currentVideoIndex: -1, // Oynatılan video indeksi
    currentVideoPath: null, // Oynatılan video yolu
    webTrackId: 0, // Web/YouTube için benzersiz parça ID sayacı
    webDuration: 0,
    webPosition: 0,
    webTitle: '',
    webArtist: '',
    webAlbum: '',
    specialPaths: null,
    libraryStats: null,
    libraryIndex: {
        audio: null
    },
    systemAudio: {
        supported: false,
        platform: window.aurivo?.platform || '',
        volumePercent: null,
        currentOutputName: '-',
        currentOutputBadge: '-',
        currentOutputKind: 'unknown',
        currentOutputPort: '',
        isHeadphones: false,
        sampleSpec: '',
        sampleRateHz: 0,
        channelCount: 0,
        sampleFormat: '',
        hasRelatedInput: false,
        relatedInputName: '',
        outputs: [],
        canBoostOver100: false,
        maxVolumePercent: 100
    }
};

// Web player <-> uygulama ses senkronu (sonsuz döngü/jitter önleme)
const webVolumeSync = {
    ignoreIncomingUntil: 0
};
const securityRuntime = {
    vpnWarned: false
};
const webLoadRuntime = {
    retryMap: new Map(), // key=url, value=retry count
    overlayTimer: null,
    navToken: 0
};
const adblockRuntime = {
    pollTimer: null,
    lastBlocked: 0,
    pendingModeChange: false
};
const audioOutputRuntime = {
    pollTimer: null,
    levelMeterTimer: null,
    quickOutputSignature: '',
    applyingSlider: false,
    systemUiSignature: '',
    lastHeadphonesState: null,
    crossfeedForcedByAuto: false,
    lastOutputId: '',
    lastOutputChangeAt: 0,
    lastResumeAfterRouteChangeAt: 0,
    lastHardRecoverAt: 0
};
let playbackStatePersistTimer = null;
const settingsWindowRuntime = {
    dirty: false,
    saving: false,
    closing: false
};
const libraryStatsRuntime = {
    refreshTimer: null,
    inFlight: false,
    lastComputedAt: 0,
    lastSignature: ''
};

let appVolumePersistTimer = null;
let suppressSettingsReloadUiUntil = 0;
const webPlatformRuntime = {
    lastSwitchAt: 0,
    lastSwitchKey: '',
    switching: false,
    queuedBtn: null,
    switchTimer: null
};
const pulseQuickRuntime = {
    running: false,
    searching: false,
    stoppingAfterResult: false,
    autoStopOnFirstResult: true,
    startedAt: 0,
    lastResultAt: 0,
    noSignalHintTimer: null,
    noSignalHintShown: false,
    lastFingerprint: '',
    lastAt: 0,
    lastUncertainAt: 0,
    lastWarningAt: 0,
    sampleRetryRunning: false,
    unsubState: null,
    unsubResult: null,
    unsubUncertain: null,
    unsubOpenQuery: null
};

const ADBLOCK_DEFAULT_SETTINGS = {
    mode: 'ideal',
    showBlockedCount: true,
    autoRefreshOnModeChange: false
};

function normalizeAdblockMode(mode) {
    const value = String(mode || '').trim().toLowerCase();
    if (value === 'basic' || value === 'aggressive') return value;
    return 'ideal';
}

function ensureAdblockSettings() {
    if (!state.settings || typeof state.settings !== 'object') state.settings = {};
    if (!state.settings.adblock || typeof state.settings.adblock !== 'object') {
        state.settings.adblock = { ...ADBLOCK_DEFAULT_SETTINGS };
        return state.settings.adblock;
    }

    state.settings.adblock.mode = normalizeAdblockMode(
        state.settings.adblock.mode || ADBLOCK_DEFAULT_SETTINGS.mode
    );
    if (typeof state.settings.adblock.showBlockedCount !== 'boolean') {
        state.settings.adblock.showBlockedCount = ADBLOCK_DEFAULT_SETTINGS.showBlockedCount;
    }
    if (typeof state.settings.adblock.autoRefreshOnModeChange !== 'boolean') {
        state.settings.adblock.autoRefreshOnModeChange = ADBLOCK_DEFAULT_SETTINGS.autoRefreshOnModeChange;
    }

    return state.settings.adblock;
}

function getAdblockBridgeConfig() {
    const adblock = ensureAdblockSettings();
    return {
        mode: normalizeAdblockMode(adblock.mode)
    };
}

function getAdblockWebModeProfile() {
    const mode = normalizeAdblockMode(ensureAdblockSettings().mode);
    if (mode === 'basic') {
        return {
            tickIntervalMs: 350,
            uiScrubLevel: 0,
            deepSponsoredScan: false
        };
    }
    if (mode === 'aggressive') {
        return {
            tickIntervalMs: 80,
            uiScrubLevel: 2,
            deepSponsoredScan: true
        };
    }
    return {
        tickIntervalMs: 150,
        uiScrubLevel: 1,
        deepSponsoredScan: true
    };
}

async function applyAdblockRuntimeConfig() {
    try {
        await window.aurivo?.adblock?.setConfig?.(getAdblockBridgeConfig());
    } catch (e) {
        console.warn('[ADBLOCK] setConfig error:', e?.message || e);
    }
}

// Desteklenen ses formatları (kütüphane tarama filtresi)
// Not: uzantı kontrolü her yerde `toLowerCase()` ile yapılır.
const DEFAULT_AUDIO_EXTENSIONS = [
    'mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac', 'opus', 'wma', 'aiff', 'ape', 'wv'
];

// Video formatları (ileride kullanılabilir)
const DEFAULT_VIDEO_EXTENSIONS = ['mp4', 'mkv', 'webm', 'avi', 'mov', 'wmv', 'm4v', 'flv', 'mpg', 'mpeg'];
const LIBRARY_ROOT_MARKER = '__LIBRARY_ROOT__';

function toLocalFileUrl(p) {
    try {
        const viaBridge = window.aurivo?.path?.toFileUrl?.(p);
        if (viaBridge) return viaBridge;
    } catch {
        // yoksay
    }

    const raw = String(p || '').trim();
    if (!raw) return '';

    // Preload köprüsü yoksa en iyi çaba yedeği.
    // Windows yolu: C:\foo\bar.mp4 -> file:///C:/foo/bar.mp4
    const normalized = raw.replace(/\\/g, '/');
    const needsLeadingSlash = /^[a-zA-Z]:\//.test(normalized);
    const urlPath = needsLeadingSlash ? `/${normalized}` : normalized;
    return encodeURI(`file://${urlPath}`).replace(/#/g, '%23');
}

// DOM Öğeleri
const elements = {};

// Dosya ağacı fare sürükleme seçim durumu
let fileTreeDragTrack = null; // { startItem, startX, startY, selecting }
let suppressFileItemClickOnce = false;
let blockFileTreeDragStart = false;
let libraryWatchUnsubscribe = null;
let libraryWatchRescanTimer = null;
const albumArtCache = new Map();

function getLibrarySettingsSyncSignature(settings = state.settings) {
    const library = settings?.library || {};
    const ui = settings?.ui || {};
    return JSON.stringify({
        audioFolders: dedupeLibraryFolders(Array.isArray(library.audioFolders) ? library.audioFolders : []),
        videoFolders: dedupeLibraryFolders(Array.isArray(library.videoFolders) ? library.videoFolders : []),
        excludedFolders: dedupeLibraryFolders(Array.isArray(library.excludedFolders) ? library.excludedFolders : []),
        audioExtensions: Array.isArray(library.audioExtensions) ? library.audioExtensions : [],
        videoExtensions: Array.isArray(library.videoExtensions) ? library.videoExtensions : [],
        restoreLastFolder: library.restoreLastFolder !== false,
        restoreLastPlaylist: library.restoreLastPlaylist !== false,
        rememberTreeSelection: library.rememberTreeSelection !== false,
        startupPage: String(ui.startupPage || 'music').toLowerCase(),
        rememberLastSection: ui.rememberLastSection !== false,
        viewSort: String(library.viewSort || 'title').toLowerCase(),
        viewGroup: String(library.viewGroup || 'none').toLowerCase(),
        viewMode: String(library.viewMode || 'list').toLowerCase(),
        preferEmbeddedCover: library.preferEmbeddedCover !== false,
        scanFolderCover: library.scanFolderCover !== false,
        markMissingCovers: library.markMissingCovers !== false,
        watchFolders: library.watchFolders !== false
    });
}

async function refreshMainLibraryFromSettingsReload() {
    try {
        renderPlaylist();
    } catch {
        // yoksay
    }

    try {
        renderLibraryFolderSettings();
        updateLibraryMetadataStatusUi();
        updateLibraryCleanupStatus();
        updateLibraryFlowsStatusUi();
        updateLibraryTransferStatus();
        updateLibraryPerformanceStatusUi();
        updateLibraryDiagnosticsUi();
        if (shouldRefreshLibraryStatsUi()) {
            scheduleLibraryStatsRefresh();
        }
    } catch {
        // yoksay
    }

    try {
        if (state.currentPage === 'music' && state.currentPanel === 'library') {
            await initializeFileTree();
        } else if (state.currentPage === 'video') {
            renderVideoLibraryTree();
        }
    } catch {
        // yoksay
    }
}

// ============================================
// BAŞLATMA
// ============================================
document.addEventListener('DOMContentLoaded', async () => {
    cacheElements();
    if (AURIVO_PERF_MONITOR_ENABLED) {
        PerfMonitor.start(5000);
    }
    bindStandaloneSettingsDirtyTracking();
    installStandaloneSettingsLifecycleHooks();
    window.aurivo?.onSettingsReload?.(async (nextSettings) => {
        if (!nextSettings || typeof nextSettings !== 'object') return;
        const prevLibrarySignature = getLibrarySettingsSyncSignature(state.settings);
        state.settings = nextSettings;
        if (Date.now() < suppressSettingsReloadUiUntil) {
            return;
        }
        const activeSettingsTab = getActiveSettingsTabName() || STANDALONE_SETTINGS_DEFAULT_TAB || 'playback';
        await loadSettings();
        // Ayarlar farklı pencereden kaydedildiğinde ana pencerede görünümü anında uygula.
        applyAppearanceSettingsToRuntime();
        applySecuritySettingsToRuntime();
        await syncLibraryWatchState();
        const nextLibrarySignature = getLibrarySettingsSyncSignature(state.settings);
        if (prevLibrarySignature !== nextLibrarySignature) {
            await refreshMainLibraryFromSettingsReload();
        }
        if (isStandaloneSettingsMode() || isPageVisible(elements.settingsPage)) {
            loadSettingsToUI();
            activateSettingsTab(activeSettingsTab);
        }
    });
    window.aurivo?.onSettingsNavigate?.(({ tab }) => {
        if (!isStandaloneSettingsMode()) return;
        const nextTab = String(tab || '').trim().toLowerCase() || 'playback';
        loadSettingsToUI();
        activateSettingsTab(nextTab);
    });
    window.aurivo?.onSettingsStandaloneMode?.(({ tab }) => {
        enterStandaloneSettingsMode(String(tab || 'playback').trim().toLowerCase() || 'playback').catch((e) => {
            console.error('[SETTINGS] standalone enter error:', e);
        });
    });
    // "Dosyalar" sekmesini kaldır: sadece Video / Müzik / Web kalsın.
    try {
        const filesTabBtn = document.querySelector('.sidebar-btn[data-page="files"]');
        if (filesTabBtn) filesTabBtn.remove();
    } catch {
        // yoksay
    }
    await initializeI18n();

    if (isStandaloneSettingsMode()) {
        try {
            state.specialPaths = await window.aurivo?.getSpecialPaths?.();
        } catch {
            state.specialPaths = null;
        }
        setupStandaloneSettingsEventListeners();
        await enterStandaloneSettingsMode(STANDALONE_ARG_TAB || STANDALONE_SETTINGS_DEFAULT_TAB || 'playback');
        resumeSettingsBackgroundWork();
        return;
    }

    // Oynatıcı çubuğu görünürlüğünü kontrol et
    const playerBar = document.getElementById('playerBar');
    if (playerBar) {
        playerBar.classList.remove('hidden');
        playerBar.style.display = 'flex';
        console.log('Player bar görünürlük kontrolü yapıldı');
    }

    // C++ Ses Motoru kontrolü
    await checkNativeAudio();

    try {
        state.specialPaths = await window.aurivo?.getSpecialPaths?.();
        console.log('[PATHS] special paths:', state.specialPaths);
    } catch (e) {
        console.warn('[PATHS] getSpecialPaths failed:', e?.message || e);
        state.specialPaths = null;
    }

    await loadSettings();
    if (getLibraryStartupBehavior().restoreLastPlaylist) {
        await loadPlaylist();
    } else {
        state.playlist = [];
        renderPlaylist();
    }
    setupEventListeners();
    setupPulseQuickListeners();
    window.addEventListener('beforeunload', () => {
        try {
            rememberPlaybackStartupState({ persist: true });
        } catch {
            // yoksay
        }
    });
    restoreLastMainSection();
    await restoreLibraryStartupState();
    await restorePlaybackStartupState();
    runStartupLibraryScanIfNeeded().catch((error) => {
        console.error('[LIBRARY] startup scan error:', error);
    });
    await syncLibraryWatchState();
    applyWebUiClasses();
    setupVisualizer();
    initializeRainbowSliders();

    try {
        if (elements.libraryActionsAudio) elements.libraryActionsAudio.classList.toggle('hidden', state.mediaFilter !== 'audio');
        if (elements.libraryActionsVideo) elements.libraryActionsVideo.classList.toggle('hidden', state.mediaFilter !== 'video');
    } catch {
        // yoksay
    }

    console.log('Aurivo Player başlatıldı');
    if (useNativeAudio) {
        console.log('🎵 C++ BASS Audio Engine aktif');
    } else {
        console.log('🎵 HTML5 Audio kullanılıyor');
    }
});

async function initializeI18n() {
    try {
        if (window.i18n && typeof window.i18n.init === 'function') {
            const lang = await window.i18n.init();
            try {
                document.title = await window.i18n.t('app.title');
            } catch {
                // yoksay
            }

            if (elements.languageSelect) {
                elements.languageSelect.value = lang || elements.languageSelect.value;
                hideRestartHint();
                if (!elements.languageSelect.dataset.listenerAttached) {
                    elements.languageSelect.dataset.listenerAttached = 'true';
                    elements.languageSelect.addEventListener('change', (e) => {
                        const next = String(e?.target?.value || '').trim();
                        if (!next) return;
            const currentLang = String(
                window.i18n?.getLanguage?.()
                || state.settings?.ui?.language
                || state.settings?.lang
                || ''
            ).trim();
                        if (next && currentLang && next !== currentLang) {
                            showRestartHint();
                        } else {
                            hideRestartHint();
                        }
                    });
                }
            }
            updatePulseQuickModeUi();
        }
    } catch (e) {
        console.warn('[I18N] init failed:', e?.message || e);
    }
}

function showRestartHint() {
    const el = document.getElementById('languageRestartHint');
    if (el) el.classList.remove('hidden');
}

function hideRestartHint() {
    const el = document.getElementById('languageRestartHint');
    if (el) el.classList.add('hidden');
}

function openRestartModal() {
    const overlay = document.getElementById('restartModalOverlay');
    if (!overlay) return;
    overlay.classList.remove('hidden');
    overlay.classList.add('active');
}

function closeRestartModal() {
    const overlay = document.getElementById('restartModalOverlay');
    if (!overlay) return;
    overlay.classList.add('hidden');
    overlay.classList.remove('active');
}

function hasPendingLanguageChange() {
    const activeLanguage = String(
        window.i18n?.getLanguage?.()
        || state.settings?.ui?.language
        || state.settings?.lang
        || ''
    ).trim();
    const selectedLanguage = String(
        elements.languageSelect?.value
        || state.settings?.ui?.language
        || state.settings?.lang
        || ''
    ).trim();
    return !!(selectedLanguage && activeLanguage && selectedLanguage !== activeLanguage);
}

async function confirmAndRelaunchApp() {
    try {
        await saveSettings();
    } catch (error) {
        console.error('[APP] save before relaunch failed:', error);
    }

    try {
        const ok = await window.aurivo?.app?.relaunch?.();
        if (!ok) {
            closeRestartModal();
            safeNotify(uiT('restart.failed', 'Uygulama yeniden başlatılamadı.'), 'error', 2200);
        }
    } catch (error) {
        console.error('[APP] relaunch request failed:', error);
        closeRestartModal();
        safeNotify(uiT('restart.failed', 'Uygulama yeniden başlatılamadı.'), 'error', 2200);
    }
}

// C++ Ses Motoru mevcut mu kontrol et ve başlat
async function checkNativeAudio() {
    try {
        if (window.aurivo && window.aurivo.audio) {
            const isAvailable = window.aurivo.audio.isNativeAvailable();
            console.log('Native Audio mevcut:', isAvailable);

            if (isAvailable) {
                // Ses Motoru'nu başlat
                const initResult = await window.aurivo.audio.init();
                console.log('Audio Engine init sonucu:', initResult);

                if (initResult && initResult.success) {
                    useNativeAudio = true;
                    console.log('✓ C++ Audio Engine başarıyla başlatıldı');

                    // AGC'yi kapat - ses bozukluğunu önlemek için
                    if (window.aurivo.audio.autoGain) {
                        window.aurivo.audio.autoGain.setEnabled(false);
                        console.log('AGC devre dışı bırakıldı');
                        try {
                            const currentVol = Math.max(0, Math.min(100, Number(state.volume) || 40));
                            window.aurivo.audio.setVolume(currentVol / 100);
                        } catch {
                            // yoksay
                        }
                    }

                    // ✨ EQ ayarlarını yükle ve uygula
                    await loadAndApplyEQSettings();
                } else {
                    useNativeAudio = false;
                    console.warn('C++ Audio Engine başlatılamadı:', initResult?.error);
                }
            } else {
                useNativeAudio = false;
            }
        }
    } catch (e) {
        console.error('Native audio kontrol hatası:', e);
        useNativeAudio = false;
    }
}

// EQ ayarlarını yükle ve Ses Motoru'na uygula
async function loadAndApplyEQSettings() {
    try {
        if (!window.aurivo?.loadSettings || !window.aurivo?.ipcAudio?.eq) {
            console.warn('[MAIN WINDOW] EQ yükleme atlandı (API yok)');
            return;
        }

        console.log('[MAIN WINDOW] Kayıtlı EQ ayarları yükleniyor...');
        const settings = await window.aurivo.loadSettings();
        const eq32 = settings?.sfx?.eq32;

        if (!eq32 || !Array.isArray(eq32.bands)) {
            console.log('[MAIN WINDOW] Kayıtlı EQ yok, varsayılan kullanılıyor');
            return;
        }

        console.log('[MAIN WINDOW] EQ ayarları bulundu:', {
            preset: eq32.lastPreset?.name || 'Düz',
            bantSayısı: eq32.bands.length
        });

        // EQ bantlarını Ses Motoru'na uygula
        eq32.bands.forEach((gain, index) => {
            window.aurivo.ipcAudio.eq.setBand(index, gain);
        });

        // Aurivo Modülü (Bass, Mid, Treble, Stereo)
        if (window.aurivo.ipcAudio.module) {
            if (typeof eq32.bass === 'number') {
                window.aurivo.ipcAudio.module.setBass(eq32.bass);
            }
            if (typeof eq32.mid === 'number') {
                window.aurivo.ipcAudio.module.setMid(eq32.mid);
            }
            if (typeof eq32.treble === 'number') {
                window.aurivo.ipcAudio.module.setTreble(eq32.treble);
            }
            if (typeof eq32.stereoExpander === 'number') {
                window.aurivo.ipcAudio.module.setStereoExpander(eq32.stereoExpander);
            }
        }

        // Denge
        if (window.aurivo.ipcAudio.balance && typeof eq32.balance === 'number') {
            window.aurivo.ipcAudio.balance.set(eq32.balance);
        }

        console.log('[MAIN WINDOW] ✓ EQ ayarları uygulandı:', eq32.lastPreset?.name || 'Düz');
    } catch (err) {
        console.error('[MAIN WINDOW] EQ yükleme hatası:', err);
    }
}

function cacheElements() {
    // Kenar çubuğu
    elements.sidebarBtns = document.querySelectorAll('.sidebar-btn[data-page]');
    elements.settingsBtn = document.getElementById('settingsBtn');
    elements.infoBtn = document.getElementById('infoBtn');
    elements.aboutModalOverlay = document.getElementById('aboutModalOverlay');
    elements.aboutCloseBtn = document.getElementById('aboutCloseBtn');
    elements.aboutGithubBtn = document.getElementById('aboutGithubBtn');

    // Paneller
    elements.leftPanel = document.getElementById('leftPanel');
    elements.libraryPanel = document.getElementById('libraryPanel');
    elements.webPanel = document.getElementById('webPanel');

    // Dosya Ağacı
    elements.fileTree = document.getElementById('fileTree');
    elements.libraryActionsAudio = document.getElementById('libraryActionsAudio');
    elements.libraryActionsVideo = document.getElementById('libraryActionsVideo');

    // Kapak
    elements.coverArt = document.getElementById('coverArt');

    // Web Platformları
    elements.platformBtns = document.querySelectorAll('.platform-btn');

    // Gezinti
    elements.backBtn = document.getElementById('backBtn');
    elements.forwardBtn = document.getElementById('forwardBtn');
    elements.refreshBtn = document.getElementById('refreshBtn');
    elements.pulseQuickListenBtn = document.getElementById('pulseQuickListenBtn');
    elements.webDrawerToggleBtn = document.getElementById('webDrawerToggleBtn');
    elements.adblockBtn = document.getElementById('adblockBtn');
    elements.adblockBlockedBadge = document.getElementById('adblockBlockedBadge');
    elements.adblockStatusText = document.getElementById('adblockStatusText');

    // Şimdi Çalıyor
    elements.nowPlayingLabel = document.getElementById('nowPlayingLabel');

    // Sayfalar
    elements.musicPage = document.getElementById('musicPage');
    elements.videoPage = document.getElementById('videoPage');
    elements.webPage = document.getElementById('webPage');
    elements.settingsPage = document.getElementById('settingsPage');
    elements.pages = document.querySelectorAll('.page');

    // Çalma Listesi
    elements.playlist = document.getElementById('playlist');
    elements.musicAddFolderBtn = document.getElementById('musicAddFolderBtn');
    elements.musicAddFilesBtn = document.getElementById('musicAddFilesBtn');
    elements.musicAddFilesBtnContext = document.getElementById('musicAddFilesBtnContext');
    elements.videoAddFolderBtn = document.getElementById('videoAddFolderBtn');
    elements.videoAddFilesBtn = document.getElementById('videoAddFilesBtn');

    // Video ve Web
    elements.videoPlayer = document.getElementById('videoPlayer');
    elements.webView = document.getElementById('webView');
    elements.webLoadingOverlay = document.getElementById('webLoadingOverlay');

    // Oynatıcı Kontrolleri
    elements.seekSlider = document.getElementById('seekSlider');
    elements.currentTime = document.getElementById('currentTime');
    elements.durationTime = document.getElementById('durationTime');
    elements.playPauseBtn = document.getElementById('playPauseBtn');
    elements.playIcon = document.getElementById('playIcon');
    elements.pauseIcon = document.getElementById('pauseIcon');
    elements.prevBtn = document.getElementById('prevBtn');
    elements.nextBtn = document.getElementById('nextBtn');
    elements.shuffleBtn = document.getElementById('shuffleBtn');
    elements.repeatBtn = document.getElementById('repeatBtn');
    elements.rewindBtn = document.getElementById('rewindBtn');
    elements.forwardSeekBtn = document.getElementById('forwardSeekBtn');
    elements.volumeBtn = document.getElementById('volumeBtn');
    elements.volumeSlider = document.getElementById('volumeSlider');
    elements.volumeLabel = document.getElementById('volumeLabel');
    elements.clearPlaylistBtn = document.getElementById('clearPlaylistBtn');

    // Görselleştirici
    elements.visualizerCanvas = document.getElementById('visualizerCanvas');

    // Ayarlar (uygulama içi sayfa)
    elements.closeSettings = document.getElementById('closeSettings');
    elements.settingsTabs = document.querySelectorAll('.settings-tab');
    elements.settingsPages = document.querySelectorAll('.settings-page');
    elements.settingsOk = document.getElementById('settingsOk');
    elements.settingsCancel = document.getElementById('settingsCancel');
    elements.settingsResetCurrentTab = document.getElementById('settingsResetCurrentTab');
    elements.resetPlayback = document.getElementById('resetPlayback');
    elements.resetListen = document.getElementById('resetListen');
    elements.pulseNoSignalHintSec = document.getElementById('pulseNoSignalHintSec');
    elements.pulseQuickMode = document.getElementById('pulseQuickMode');
    elements.pulseQuickModeGrid = document.getElementById('pulseQuickModeGrid');
    elements.pulseQuickModeCards = document.querySelectorAll('[data-pulse-quick-mode]');
    elements.pulseQuickModeDetails = document.getElementById('pulseQuickModeDetails');
    elements.pulseEnableNotifications = document.getElementById('pulseEnableNotifications');
    elements.pulseEnableMpris = document.getElementById('pulseEnableMpris');
    elements.pulseEnableSystray = document.getElementById('pulseEnableSystray');
    elements.pulseNoDuplicates = document.getElementById('pulseNoDuplicates');
    elements.pulseRequestInterval = document.getElementById('pulseRequestInterval');
    elements.pulseBufferSize = document.getElementById('pulseBufferSize');
    elements.pulseRecognitionEngine = document.getElementById('pulseRecognitionEngine');
    elements.pulseAcoustidApiKey = document.getElementById('pulseAcoustidApiKey');
    elements.pulseAcoustidHint = document.getElementById('pulseAcoustidHint');
    elements.pulseAcoustidWarning = document.getElementById('pulseAcoustidWarning');
    elements.libraryRememberSection = document.getElementById('libraryRememberSection');
    elements.libraryRestoreLastFolder = document.getElementById('libraryRestoreLastFolder');
    elements.libraryRestoreLastPlaylist = document.getElementById('libraryRestoreLastPlaylist');
    elements.libraryRememberTreeSelection = document.getElementById('libraryRememberTreeSelection');
    elements.libraryStartupPage = document.getElementById('libraryStartupPage');
    elements.libraryHeroRescanBtn = document.getElementById('libraryHeroRescanBtn');
    elements.libraryHeroAddFolderBtn = document.getElementById('libraryHeroAddFolderBtn');
    elements.libraryHeroTotalSongs = document.getElementById('libraryHeroTotalSongs');
    elements.libraryHeroTotalDuration = document.getElementById('libraryHeroTotalDuration');
    elements.libraryHeroFolderCount = document.getElementById('libraryHeroFolderCount');
    elements.libraryHeroLastScan = document.getElementById('libraryHeroLastScan');
    elements.libraryVideoCount = document.getElementById('libraryVideoCount');
    elements.libraryMusicPathInfo = document.getElementById('libraryMusicPathInfo');
    elements.libraryVideoPathInfo = document.getElementById('libraryVideoPathInfo');
    elements.libraryManagedFoldersSummary = document.getElementById('libraryManagedFoldersSummary');
    elements.libraryManagedFoldersList = document.getElementById('libraryManagedFoldersList');
    elements.libraryExcludedFoldersList = document.getElementById('libraryExcludedFoldersList');
    elements.libraryAddMusicFolder = document.getElementById('libraryAddMusicFolder');
    elements.libraryAddExcludedFolder = document.getElementById('libraryAddExcludedFolder');
    elements.libraryRescanMusicFolders = document.getElementById('libraryRescanMusicFolders');
    elements.libraryScanOnStartup = document.getElementById('libraryScanOnStartup');
    elements.libraryAutoRescanOnFolderChange = document.getElementById('libraryAutoRescanOnFolderChange');
    elements.libraryWatchFolders = document.getElementById('libraryWatchFolders');
    elements.libraryWatchStatus = document.getElementById('libraryWatchStatus');
    elements.libraryStatsTotalSongs = document.getElementById('libraryStatsTotalSongs');
    elements.libraryStatsTotalArtists = document.getElementById('libraryStatsTotalArtists');
    elements.libraryStatsTotalAlbums = document.getElementById('libraryStatsTotalAlbums');
    elements.libraryStatsTotalDuration = document.getElementById('libraryStatsTotalDuration');
    elements.libraryStatsMissingMetadata = document.getElementById('libraryStatsMissingMetadata');
    elements.libraryStatsMissingCover = document.getElementById('libraryStatsMissingCover');
    elements.libraryRefreshMetadataBtn = document.getElementById('libraryRefreshMetadataBtn');
    elements.libraryCleanMetadataBtn = document.getElementById('libraryCleanMetadataBtn');
    elements.libraryInferMetadataBtn = document.getElementById('libraryInferMetadataBtn');
    elements.libraryMetadataStatus = document.getElementById('libraryMetadataStatus');
    elements.libraryPreferEmbeddedCover = document.getElementById('libraryPreferEmbeddedCover');
    elements.libraryScanFolderCover = document.getElementById('libraryScanFolderCover');
    elements.libraryMarkMissingCovers = document.getElementById('libraryMarkMissingCovers');
    elements.libraryViewSort = document.getElementById('libraryViewSort');
    elements.libraryViewGroup = document.getElementById('libraryViewGroup');
    elements.libraryViewMode = document.getElementById('libraryViewMode');
    elements.libraryAudioExtensions = document.getElementById('libraryAudioExtensions');
    elements.libraryVideoExtensions = document.getElementById('libraryVideoExtensions');
    elements.libraryResetExtensions = document.getElementById('libraryResetExtensions');
    elements.libraryCleanupMissingBtn = document.getElementById('libraryCleanupMissingBtn');
    elements.libraryCleanupDuplicatesBtn = document.getElementById('libraryCleanupDuplicatesBtn');
    elements.libraryCleanupEmptyFoldersBtn = document.getElementById('libraryCleanupEmptyFoldersBtn');
    elements.libraryCleanupStatus = document.getElementById('libraryCleanupStatus');
    elements.libraryFlowFavoritesEnabled = document.getElementById('libraryFlowFavoritesEnabled');
    elements.libraryFlowRecentEnabled = document.getElementById('libraryFlowRecentEnabled');
    elements.libraryFlowMostPlayedEnabled = document.getElementById('libraryFlowMostPlayedEnabled');
    elements.libraryFlowRecentLimit = document.getElementById('libraryFlowRecentLimit');
    elements.libraryFlowMostPlayedLimit = document.getElementById('libraryFlowMostPlayedLimit');
    elements.libraryFlowsStatus = document.getElementById('libraryFlowsStatus');
    elements.libraryFastScan = document.getElementById('libraryFastScan');
    elements.libraryLightweightMode = document.getElementById('libraryLightweightMode');
    elements.libraryCoverCacheLimitMb = document.getElementById('libraryCoverCacheLimitMb');
    elements.libraryPerformanceStatus = document.getElementById('libraryPerformanceStatus');
    elements.libraryDiagnosticsLastScan = document.getElementById('libraryDiagnosticsLastScan');
    elements.libraryDiagnosticsLastDuration = document.getElementById('libraryDiagnosticsLastDuration');
    elements.libraryDiagnosticsErrors = document.getElementById('libraryDiagnosticsErrors');
    elements.libraryDiagnosticsUnreadable = document.getElementById('libraryDiagnosticsUnreadable');
    elements.libraryExportBundleBtn = document.getElementById('libraryExportBundleBtn');
    elements.libraryImportBundleBtn = document.getElementById('libraryImportBundleBtn');
    elements.libraryTransferStatus = document.getElementById('libraryTransferStatus');
    elements.libraryClearVideoLibrary = document.getElementById('libraryClearVideoLibrary');
    elements.audioDefaultVolume = document.getElementById('audioDefaultVolume');
    elements.audioDefaultVolumeValue = document.getElementById('audioDefaultVolumeValue');
    elements.audioAppVolume = document.getElementById('audioAppVolume');
    elements.audioAppVolumeValue = document.getElementById('audioAppVolumeValue');
    elements.audioCurrentOutputName = document.getElementById('audioCurrentOutputName');
    elements.audioCurrentOutputBadge = document.getElementById('audioCurrentOutputBadge');
    elements.audioOutputMeterCard = document.getElementById('audioOutputMeterCard');
    elements.audioOutputMeterState = document.getElementById('audioOutputMeterState');
    elements.audioOutputClipLed = document.getElementById('audioOutputClipLed');
    elements.audioOutputLevelLeft = document.getElementById('audioOutputLevelLeft');
    elements.audioOutputLevelRight = document.getElementById('audioOutputLevelRight');
    elements.audioOutputLevelLeftValue = document.getElementById('audioOutputLevelLeftValue');
    elements.audioOutputLevelRightValue = document.getElementById('audioOutputLevelRightValue');
    elements.audioDeviceInsightCard = document.getElementById('audioDeviceInsightCard');
    elements.audioDeviceInsightIcon = document.getElementById('audioDeviceInsightIcon');
    elements.audioDeviceInsightTitle = document.getElementById('audioDeviceInsightTitle');
    elements.audioDeviceInsightSubtitle = document.getElementById('audioDeviceInsightSubtitle');
    elements.audioDeviceInsightMeta = document.getElementById('audioDeviceInsightMeta');
    elements.audioRefreshState = document.getElementById('audioRefreshState');
    elements.audioOutputSelect = document.getElementById('audioOutputSelect');
    elements.audioOutputSelectHint = document.getElementById('audioOutputSelectHint');
    elements.audioQuickOutputGrid = document.getElementById('audioQuickOutputGrid');
    elements.audioLoudnessEnabled = document.getElementById('audioLoudnessEnabled');
    elements.audioLoudnessMode = document.getElementById('audioLoudnessMode');
    elements.audioLoudnessHint = document.getElementById('audioLoudnessHint');
    elements.audioLimiterEnabled = document.getElementById('audioLimiterEnabled');
    elements.audioLimiterMode = document.getElementById('audioLimiterMode');
    elements.audioLimiterHint = document.getElementById('audioLimiterHint');
    elements.audioNightModeEnabled = document.getElementById('audioNightModeEnabled');
    elements.audioNightModeLevel = document.getElementById('audioNightModeLevel');
    elements.audioNightModeHint = document.getElementById('audioNightModeHint');
    elements.audioProfileGrid = document.getElementById('audioProfileGrid');
    elements.audioProfileCards = document.querySelectorAll('[data-audio-profile]');
    elements.audioProfileHint = document.getElementById('audioProfileHint');
    elements.audioSpatialGrid = document.getElementById('audioSpatialGrid');
    elements.audioSpatialCards = document.querySelectorAll('[data-audio-spatial]');
    elements.audioSpatialHint = document.getElementById('audioSpatialHint');
    elements.audioFollowSystemVolume = document.getElementById('audioFollowSystemVolume');
    elements.audioAllowOverdrive150 = document.getElementById('audioAllowOverdrive150');
    elements.audioSystemAudioHint = document.getElementById('audioSystemAudioHint');
    elements.audioStableVolume = document.getElementById('audioStableVolume');
    elements.audioVolumeBoost = document.getElementById('audioVolumeBoost');
    elements.audioVideoDelay = document.getElementById('audioVideoDelay');
    elements.audioVideoDelayValue = document.getElementById('audioVideoDelayValue');
    elements.audioVideoDelayReset = document.getElementById('audioVideoDelayReset');
    elements.adblockBlockedCount = document.getElementById('adblockBlockedCount');
    elements.adblockTotalCount = document.getElementById('adblockTotalCount');
    elements.adblockRulesetCount = document.getElementById('adblockRulesetCount');
    elements.adblockDomainRuleCount = document.getElementById('adblockDomainRuleCount');
    elements.adblockOpenDashboardBtn = document.getElementById('adblockOpenDashboardBtn');
    elements.adblockModeGrid = document.getElementById('adblockModeGrid');
    elements.adblockModeCards = document.querySelectorAll('.adblock-mode-card[data-adblock-mode]');
    elements.adblockShowBlockedCount = document.getElementById('adblockShowBlockedCount');
    elements.adblockAutoRefreshOnModeChange = document.getElementById('adblockAutoRefreshOnModeChange');
    elements.languageSelect = document.getElementById('languageSelect');
    elements.themeSelect = document.getElementById('themeSelect');
    elements.themeSystemHint = document.getElementById('themeSystemHint');
    elements.uiFollowSystemThemeToggle = document.getElementById('uiFollowSystemThemeToggle');
    elements.behaviorRememberLastSection = document.getElementById('behaviorRememberLastSection');
    elements.behaviorStartupPage = document.getElementById('behaviorStartupPage');
    elements.behaviorCloseToTray = document.getElementById('behaviorCloseToTray');
    elements.uiVisualModeSelect = document.getElementById('uiVisualModeSelect');
    elements.uiVisualModeHint = document.getElementById('uiVisualModeHint');
    elements.uiVisualModePerfBadge = document.getElementById('uiVisualModePerfBadge');
    elements.uiFxEnabledToggle = document.getElementById('uiFxEnabledToggle');
    elements.uiReduceMotionToggle = document.getElementById('uiReduceMotionToggle');
    elements.sliderFxToggle = document.getElementById('sliderFxToggle');
    elements.sliderFxToggleState = document.getElementById('sliderFxToggleState');
    elements.sfxLightsToggle = document.getElementById('sfxLightsToggle');
    elements.sfxLightsToggleState = document.getElementById('sfxLightsToggleState');
    elements.restartModalOverlay = document.getElementById('restartModalOverlay');
    elements.restartModalClose = document.getElementById('restartModalClose');
    elements.restartModalYes = document.getElementById('restartModalYes');
    elements.restartModalNo = document.getElementById('restartModalNo');

    elements.securityConnStatus = document.getElementById('securityConnStatus');
    elements.securityCurrentUrl = document.getElementById('securityCurrentUrl');
    elements.securityAllowPopups = document.getElementById('securityAllowPopups');
    elements.securityStrictVpnBlock = document.getElementById('securityStrictVpnBlock');
    elements.securityCopyUrlBtn = document.getElementById('securityCopyUrlBtn');
    elements.securityOpenInBrowserBtn = document.getElementById('securityOpenInBrowserBtn');
    elements.securityClearCookiesBtn = document.getElementById('securityClearCookiesBtn');
    elements.securityClearCacheBtn = document.getElementById('securityClearCacheBtn');
    elements.securityClearAllBtn = document.getElementById('securityClearAllBtn');
    elements.securityResetWebBtn = document.getElementById('securityResetWebBtn');

    // Ses Öğeleri (iki adet - çapraz geçiş için)
    elements.audioA = new Audio();
    elements.audioA.preload = 'metadata';
    elements.audioB = new Audio();
    elements.audioB.preload = 'metadata';
    // Aktif oynatıcı referansı
    elements.audio = elements.audioA;
}

function isPageVisible(pageEl) {
    return Boolean(pageEl && !pageEl.classList.contains('hidden'));
}

function showUtilityPage(pageEl, btnEl) {
    if (!pageEl) return;
    pageEl.classList.remove('hidden');
    pageEl.classList.add('active');
    if (btnEl) btnEl.classList.add('active');
}

function hideUtilityPage(pageEl, btnEl) {
    if (!pageEl) return;
    pageEl.classList.add('hidden');
    pageEl.classList.remove('active');
    if (btnEl) btnEl.classList.remove('active');
}

function closeAllUtilityPages() {
    hideUtilityPage(elements.settingsPage, elements.settingsBtn);
}

// ============================================
// AYARLAR
// ============================================
async function loadSettings() {
    if (window.aurivo) {
        state.settings = await window.aurivo.loadSettings();
        if (!state.settings) state.settings = {};
        state.volume = state.settings.volume || 40;
        state.isShuffle = state.settings.shuffle || false;
        state.isRepeat = state.settings.repeat || false;

        // Web UI (çekmece)
        if (!state.settings.webUi || typeof state.settings.webUi !== 'object') {
            state.settings.webUi = {
                drawerCollapsed: false,
                autoCollapseOnPlatformOpen: false
            };
        }
        state.webDrawerCollapsed = !!state.settings.webUi.drawerCollapsed;

        // Çalma ayarları için varsayılanlar (eksikse)
        if (!state.settings.playback) {
            state.settings.playback = {
                crossfadeStopEnabled: true,
                crossfadeManualEnabled: true,
                crossfadeAutoEnabled: false,
                sameAlbumNoCrossfade: true,
                crossfadeMs: 2000,
                fadeOnPauseResume: false,
                pauseFadeMs: 250,
                crossfadeSkipShortTracks: true,
                crossfadeSafetyPaddingMs: 300,
                seekStepSeconds: 10,
                restoreLastTrackOnStartup: true,
                autoplayLastTrackOnStartup: false,
                resumePositionOnStartup: true,
                endWarningEnabled: false,
                endWarningSeconds: 10,
                smartVolumeLevelingEnabled: false,
                smartVolumeLevelingMode: 'balanced',
                startupState: {
                    lastTrackPath: '',
                    lastTrackIndex: -1,
                    lastPositionMs: 0,
                    lastWasPlaying: false,
                    updatedAt: 0
                }
            };
        } else {
            const playback = state.settings.playback;
            playback.crossfadeStopEnabled = playback.crossfadeStopEnabled !== false;
            playback.crossfadeManualEnabled = playback.crossfadeManualEnabled !== false;
            playback.crossfadeAutoEnabled = !!playback.crossfadeAutoEnabled;
            playback.sameAlbumNoCrossfade = playback.sameAlbumNoCrossfade !== false;
            playback.crossfadeMs = Math.max(0, Math.min(15000, Number(playback.crossfadeMs) || 2000));
            playback.fadeOnPauseResume = !!playback.fadeOnPauseResume;
            playback.pauseFadeMs = Math.max(0, Math.min(5000, Number(playback.pauseFadeMs) || 250));
            playback.crossfadeSkipShortTracks = playback.crossfadeSkipShortTracks !== false;
            playback.crossfadeSafetyPaddingMs = Math.max(0, Math.min(5000, Number(playback.crossfadeSafetyPaddingMs) || 300));
            playback.seekStepSeconds = Math.max(1, Math.min(60, Number(playback.seekStepSeconds) || 10));
            playback.restoreLastTrackOnStartup = playback.restoreLastTrackOnStartup !== false;
            playback.autoplayLastTrackOnStartup = !!playback.autoplayLastTrackOnStartup;
            playback.resumePositionOnStartup = playback.resumePositionOnStartup !== false;
            playback.endWarningEnabled = !!playback.endWarningEnabled;
            playback.endWarningSeconds = Math.max(3, Math.min(60, Number(playback.endWarningSeconds) || 10));
            playback.smartVolumeLevelingEnabled = !!playback.smartVolumeLevelingEnabled;
            playback.smartVolumeLevelingMode = ['gentle', 'balanced', 'strong'].includes(String(playback.smartVolumeLevelingMode || '').toLowerCase())
                ? String(playback.smartVolumeLevelingMode).toLowerCase()
                : 'balanced';
            if (!playback.startupState || typeof playback.startupState !== 'object') {
                playback.startupState = {};
            }
            if (typeof playback.startupState.lastTrackPath !== 'string') playback.startupState.lastTrackPath = '';
            if (!Number.isFinite(Number(playback.startupState.lastTrackIndex))) playback.startupState.lastTrackIndex = -1;
            if (!Number.isFinite(Number(playback.startupState.lastPositionMs))) playback.startupState.lastPositionMs = 0;
            if (typeof playback.startupState.lastWasPlaying !== 'boolean') playback.startupState.lastWasPlaying = false;
            if (!Number.isFinite(Number(playback.startupState.updatedAt))) playback.startupState.updatedAt = 0;
        }
        if (!state.settings.pulseQuick || typeof state.settings.pulseQuick !== 'object') {
            state.settings.pulseQuick = {
                noSignalHintSec: PULSE_NO_SIGNAL_HINT_TOAST_DEFAULT_SEC,
                preferredAudioDevice: '',
                mode: PULSE_QUICK_MODE_DEFAULT
            };
        } else {
            const sec = Number(state.settings.pulseQuick.noSignalHintSec);
            if (![4, 6, 8].includes(sec)) {
                state.settings.pulseQuick.noSignalHintSec = PULSE_NO_SIGNAL_HINT_TOAST_DEFAULT_SEC;
            }
            if (typeof state.settings.pulseQuick.preferredAudioDevice !== 'string') {
                state.settings.pulseQuick.preferredAudioDevice = '';
            }
            if (!['normal', 'background', 'max'].includes(String(state.settings.pulseQuick.mode || '').toLowerCase())) {
                state.settings.pulseQuick.mode = PULSE_QUICK_MODE_DEFAULT;
            }
        }
        try {
            const pulsePrefRes = await window.aurivo?.pulse?.getPreferences?.();
            state.settings.pulsePreferences = normalizePulsePreferenceState(pulsePrefRes?.preferences);
        } catch {
            state.settings.pulsePreferences = normalizePulsePreferenceState(null);
        }

        // Tam ekran video ayarları için varsayılanlar
        if (!state.settings.videoFullscreen) {
            state.settings.videoFullscreen = {
                stableVolume: false,
                volumeBoost: false,
                audioDelayMs: 0,
                cinematicLighting: true,
                annotations: true,
                sleepTimerMinutes: 0,
                subtitles: 'off'
            };
        }
        if (!Number.isFinite(Number(state.settings.videoFullscreen.audioDelayMs))) {
            state.settings.videoFullscreen.audioDelayMs = 0;
        }
        if (!state.settings.security || typeof state.settings.security !== 'object') {
            state.settings.security = {
                strictVpnBlock: false,
                allowPopups: true
            };
        }
        if (typeof state.settings.security.allowPopups !== 'boolean') {
            state.settings.security.allowPopups = true;
        }
        if (!state.settings.appearance || typeof state.settings.appearance !== 'object') {
            state.settings.appearance = {
                theme: 'aur-renk-efektleri',
                followSystemTheme: false,
                visualMode: 'full',
                uiFxEnabled: true,
                sliderFxEnabled: true,
                reduceMotion: false,
                sfxLights: true
            };
        }
        if (typeof state.settings.appearance.theme !== 'string' || !state.settings.appearance.theme.trim()) {
            state.settings.appearance.theme = 'aur-renk-efektleri';
        }
        if (typeof state.settings.appearance.followSystemTheme !== 'boolean') {
            state.settings.appearance.followSystemTheme = false;
        }
        if (!['full', 'balanced', 'minimal'].includes(String(state.settings.appearance.visualMode || '').toLowerCase())) {
            const legacyFxEnabled = state.settings.appearance.uiFxEnabled !== false;
            const legacyReduceMotion = state.settings.appearance.reduceMotion === true;
            if (!legacyFxEnabled) {
                state.settings.appearance.visualMode = 'minimal';
            } else if (legacyReduceMotion) {
                state.settings.appearance.visualMode = 'balanced';
            } else {
                state.settings.appearance.visualMode = 'full';
            }
        }
        if (typeof state.settings.appearance.uiFxEnabled !== 'boolean') {
            state.settings.appearance.uiFxEnabled = true;
        }
        if (typeof state.settings.appearance.sliderFxEnabled !== 'boolean') {
            state.settings.appearance.sliderFxEnabled = true;
        }
        if (typeof state.settings.appearance.reduceMotion !== 'boolean') {
            state.settings.appearance.reduceMotion = false;
        }
        if (typeof state.settings.appearance.sfxLights !== 'boolean') {
            state.settings.appearance.sfxLights = true;
        }
        syncSfxLightsShadowStorage(state.settings.appearance.sfxLights !== false);
        ensureAdblockSettings();
        if (!state.settings.ui || typeof state.settings.ui !== 'object') {
            state.settings.ui = {
                lastPage: 'music',
                lastPanel: 'library',
                rememberLastSection: true,
                startupPage: 'music',
                closeToTray: true,
                language: ''
            };
        }
        if (typeof state.settings.ui.language !== 'string' || !state.settings.ui.language.trim()) {
            state.settings.ui.language = String(state.settings.lang || '').trim();
        }
        if ((!state.settings.lang || !String(state.settings.lang).trim()) && state.settings.ui.language) {
            state.settings.lang = state.settings.ui.language;
        }
        ensureLibrarySettings();
        if (typeof state.settings.ui.rememberLastSection !== 'boolean') {
            state.settings.ui.rememberLastSection = true;
        }
        if (typeof state.settings.ui.closeToTray !== 'boolean') {
            state.settings.ui.closeToTray = true;
        }
        if (!['music', 'video', 'web'].includes(String(state.settings.ui.startupPage || '').toLowerCase())) {
            state.settings.ui.startupPage = 'music';
        }
        if (!state.settings.videoLibrary || typeof state.settings.videoLibrary !== 'object') {
            state.settings.videoLibrary = {
                items: []
            };
        }
        getAudioOutputSettings();

        state.videoFiles = sanitizeVideoLibraryItems(state.settings.videoLibrary.items);

        const savedPage = String(state.settings.ui.lastPage || 'music').toLowerCase();
        const savedPanel = String(state.settings.ui.lastPanel || (savedPage === 'web' ? 'web' : 'library')).toLowerCase();
        state.currentPage = ['music', 'video', 'web'].includes(savedPage) ? savedPage : 'music';
        state.currentPanel = savedPanel === 'web' ? 'web' : 'library';

        // UI'yi güncelle
        if (elements.volumeSlider) elements.volumeSlider.value = state.volume;
        if (elements.volumeLabel) elements.volumeLabel.textContent = state.volume + '%';
        if (elements.audio) elements.audio.volume = state.volume / 100;
        updateAudioAppVolumeUi(state.volume);
        updateAudioVideoDelayUi();

        if (state.isShuffle && elements.shuffleBtn) elements.shuffleBtn.classList.add('active');
        if (state.isRepeat && elements.repeatBtn) elements.repeatBtn.classList.add('active');
        updateAdblockBadge(adblockRuntime.lastBlocked);
        applyAdblockRuntimeConfig();
        await refreshSystemAudioState();
        await applyLoudnessNormalizationToEngine();
        await applyLimiterProtectionToEngine();
        await applyNightModeToEngine();
        await applyPlaybackVolumeLevelingToEngine();
        await applySpatialAudioMode(getAudioOutputSettings().spatialMode, { persist: false });
        applyFsAudioDelay();
        setupSystemThemePreferenceListener();
    }
}

async function saveSettings() {
    if (window.aurivo && state.settings) {
        state.settings.volume = state.volume;
        state.settings.shuffle = state.isShuffle;
        state.settings.repeat = state.isRepeat;
        syncSfxLightsShadowStorage(state.settings?.appearance?.sfxLights !== false);
        suppressSettingsReloadUiUntil = Date.now() + 700;
        await window.aurivo.saveSettings(state.settings);
    }
}

function scheduleAppVolumePersist(delay = 220) {
    if (appVolumePersistTimer) {
        clearTimeout(appVolumePersistTimer);
    }
    appVolumePersistTimer = setTimeout(() => {
        appVolumePersistTimer = null;
        saveSettings().catch(() => { });
    }, delay);
}

function sanitizeVideoLibraryItems(items) {
    if (!Array.isArray(items)) return [];
    const out = [];
    for (const raw of items) {
        if (!raw || typeof raw !== 'object') continue;
        const path = String(raw.path || '').trim();
        if (!path) continue;
        const name = String(raw.name || (window.aurivo?.path?.basename?.(path) || path.split('/').pop() || 'video')).trim();
        out.push({ path, name: name || 'video' });
        if (out.length >= 3000) break;
    }
    return out;
}

function persistVideoLibrary() {
    if (!state.settings || typeof state.settings !== 'object') return;
    if (!state.settings.videoLibrary || typeof state.settings.videoLibrary !== 'object') {
        state.settings.videoLibrary = {};
    }
    state.settings.videoLibrary.items = sanitizeVideoLibraryItems(state.videoFiles);
    saveSettings().catch(() => { });
}

function getAudioOutputSettings() {
    if (!state.settings || typeof state.settings !== 'object') state.settings = {};
    if (!state.settings.audioOutput || typeof state.settings.audioOutput !== 'object') {
        state.settings.audioOutput = {
            followSystemVolume: true,
            allowOverdrive150: false,
            defaultVolume: 40,
            profile: 'music'
        };
    }
    if (typeof state.settings.audioOutput.followSystemVolume !== 'boolean') {
        state.settings.audioOutput.followSystemVolume = true;
    }
    if (typeof state.settings.audioOutput.allowOverdrive150 !== 'boolean') {
        state.settings.audioOutput.allowOverdrive150 = false;
    }
    if (!Number.isFinite(Number(state.settings.audioOutput.defaultVolume))) {
        state.settings.audioOutput.defaultVolume = 40;
    }
    state.settings.audioOutput.defaultVolume = Math.max(
        0,
        Math.min(150, Number(state.settings.audioOutput.defaultVolume) || 40)
    );
    if (typeof state.settings.audioOutput.loudnessEnabled !== 'boolean') {
        state.settings.audioOutput.loudnessEnabled = false;
    }
    if (!['gentle', 'balanced', 'strong'].includes(String(state.settings.audioOutput.loudnessMode || '').toLowerCase())) {
        state.settings.audioOutput.loudnessMode = 'balanced';
    }
    if (typeof state.settings.audioOutput.limiterEnabled !== 'boolean') {
        state.settings.audioOutput.limiterEnabled = false;
    }
    if (!['soft', 'balanced', 'strict'].includes(String(state.settings.audioOutput.limiterMode || '').toLowerCase())) {
        state.settings.audioOutput.limiterMode = 'balanced';
    }
    if (typeof state.settings.audioOutput.nightModeEnabled !== 'boolean') {
        state.settings.audioOutput.nightModeEnabled = false;
    }
    if (!['light', 'balanced', 'strong'].includes(String(state.settings.audioOutput.nightModeLevel || '').toLowerCase())) {
        state.settings.audioOutput.nightModeLevel = 'balanced';
    }
    if (!['music', 'movie', 'headphones', 'night', 'loud'].includes(String(state.settings.audioOutput.profile || '').toLowerCase())) {
        state.settings.audioOutput.profile = 'music';
    }
    if (!['mono', 'stereo', 'spatial'].includes(String(state.settings.audioOutput.spatialMode || '').toLowerCase())) {
        state.settings.audioOutput.spatialMode = 'stereo';
    }
    if (typeof state.settings.audioOutput.autoCrossfeedOnHeadphones !== 'boolean') {
        state.settings.audioOutput.autoCrossfeedOnHeadphones = true;
    }
    return state.settings.audioOutput;
}

async function applyHeadphoneCrossfeedAutoMode() {
    const prefs = getAudioOutputSettings();
    if (!prefs.autoCrossfeedOnHeadphones) return;
    if (!state.systemAudio?.supported) return;

    const isHeadphones = !!state.systemAudio?.isHeadphones;
    const channelCount = Number(state.systemAudio?.channelCount || 0);
    const isStereoLike = !Number.isFinite(channelCount) || channelCount <= 2;
    const shouldEnableAutoCrossfeed = isHeadphones && isStereoLike;
    if (audioOutputRuntime.lastHeadphonesState === shouldEnableAutoCrossfeed) return;
    audioOutputRuntime.lastHeadphonesState = shouldEnableAutoCrossfeed;

    const crossfeed = window.aurivo?.ipcAudio?.crossfeed;
    if (!crossfeed?.enable) return;

    try {
        const params = typeof crossfeed.getParams === 'function'
            ? await crossfeed.getParams()
            : null;
        const currentlyEnabled = !!params?.enabled;

        if (shouldEnableAutoCrossfeed) {
            if (!currentlyEnabled) {
                await crossfeed.enable(true);
                audioOutputRuntime.crossfeedForcedByAuto = true;
            } else {
                audioOutputRuntime.crossfeedForcedByAuto = false;
            }
            return;
        }

        if (audioOutputRuntime.crossfeedForcedByAuto) {
            await crossfeed.enable(false);
            audioOutputRuntime.crossfeedForcedByAuto = false;
        }
    } catch {
        // yoksay
    }
}

function getAudioSettingsSliderMax() {
    const prefs = getAudioOutputSettings();
    const systemVolume = Number(state.systemAudio?.volumePercent);
    const runtimeAllow150 =
        !!prefs.allowOverdrive150 ||
        !!state.systemAudio?.raiseMaximumVolumeEnabled ||
        (Number.isFinite(systemVolume) && systemVolume > 100);
    const baseMax = (runtimeAllow150 && state.systemAudio?.canBoostOver100) ? 150 : 100;
    if (Number.isFinite(systemVolume) && systemVolume > baseMax) {
        return Math.min(Number(state.systemAudio?.maxVolumePercent) || 150, Math.ceil(systemVolume));
    }
    return baseMax;
}

function updateAudioSettingsSliderUi(value) {
    if (!elements.audioDefaultVolume) return;
    const max = getAudioSettingsSliderMax();
    const safeValue = Math.max(0, Math.min(max, Number(value) || 0));
    elements.audioDefaultVolume.max = String(max);
    elements.audioDefaultVolume.value = String(safeValue);
    if (elements.audioDefaultVolumeValue) elements.audioDefaultVolumeValue.textContent = `${safeValue}%`;
}

function updateAudioAppVolumeUi(value) {
    if (!elements.audioAppVolume) return;
    const safeValue = Math.max(0, Math.min(100, Number(value) || 0));
    elements.audioAppVolume.value = String(safeValue);
    if (elements.audioAppVolumeValue) elements.audioAppVolumeValue.textContent = `${safeValue}%`;
}

function setAppMasterVolume(value, options = {}) {
    const { persist = true, syncSettingsSlider = true, syncMainSlider = true } = options;
    const safeValue = Math.max(0, Math.min(100, Number(value) || 0));

    state.volume = safeValue;
    state.isMuted = safeValue === 0;
    if (!state.isMuted) state.savedVolume = safeValue;

    if (useNativeAudio && state.activeMedia === 'audio') {
        window.aurivo.audio.setVolume(safeValue / 100);
    }

    const useWebAudioGainPath = !useNativeAudio && state.activeMedia === 'audio' && !!webAudioOutputGainNode;
    const activePlayer = getActiveAudioPlayer();
    if (!state.crossfadeInProgress && activePlayer) {
        activePlayer.volume = useWebAudioGainPath ? 1 : (safeValue / 100);
        activePlayer.muted = useWebAudioGainPath ? false : state.isMuted;
    }
    if (elements.videoPlayer) {
        elements.videoPlayer.volume = safeValue / 100;
        elements.videoPlayer.muted = state.isMuted;
    }
    if (elements.audio) {
        elements.audio.volume = useWebAudioGainPath ? 1 : (safeValue / 100);
        elements.audio.muted = useWebAudioGainPath ? false : state.isMuted;
    }
    setWebAudioOutputGainFromState();

    if (syncMainSlider && elements.volumeSlider) {
        elements.volumeSlider.value = safeValue;
        updateRainbowSlider(elements.volumeSlider, safeValue);
    }
    if (elements.volumeLabel) elements.volumeLabel.textContent = `${safeValue}%`;

    const fsVolumeSlider = document.getElementById('fsVolumeSlider');
    const fsVolumeLabel = document.getElementById('fsVolumeLabel');
    if (fsVolumeSlider) {
        fsVolumeSlider.value = safeValue;
        updateRainbowSlider(fsVolumeSlider, safeValue);
    }
    if (fsVolumeLabel) fsVolumeLabel.textContent = `${safeValue}%`;

    if (syncSettingsSlider) updateAudioAppVolumeUi(safeValue);

    updateVolumeIcon();
    updateFsVolumeIcon();
    pushAppVolumeToWeb();
    if (persist) scheduleAppVolumePersist();
}

function setAudioRefreshBusy(isBusy) {
    if (!elements.audioRefreshState) return;
    elements.audioRefreshState.classList.toggle('loading', !!isBusy);
    elements.audioRefreshState.disabled = !!isBusy;
    elements.audioRefreshState.textContent = isBusy
        ? uiT('settings.audio.refreshing', 'Refreshing...')
        : uiT('settings.audio.refresh', 'Refresh from system');
}

function setAudioOverdriveButtonState(active) {
    window.AurivoSettingsShared?.setButtonToggleState?.(elements.audioAllowOverdrive150, !!active);
}

function getAudioOverdriveButtonState() {
    return !!window.AurivoSettingsShared?.getButtonToggleState?.(elements.audioAllowOverdrive150);
}

function setTextIfChanged(element, nextValue) {
    if (!element) return;
    const safe = String(nextValue ?? '');
    if (element.textContent !== safe) {
        element.textContent = safe;
    }
}

function setCheckboxIfChanged(element, nextValue) {
    if (!element) return;
    const safe = !!nextValue;
    if (element.checked !== safe) {
        element.checked = safe;
    }
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function renderAudioOutputOptions() {
    if (!elements.audioOutputSelect) return;
    const outputs = Array.isArray(state.systemAudio?.outputs) ? state.systemAudio.outputs : [];
    const currentId = String(state.systemAudio?.currentOutputId || '').trim();
    elements.audioOutputSelect.innerHTML = '';

    if (!state.systemAudio?.supported) {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = uiT('settings.audio.outputSelect.unsupported', 'Output switching is currently available on Linux/PipeWire/PulseAudio.');
        elements.audioOutputSelect.appendChild(option);
        elements.audioOutputSelect.disabled = true;
        return;
    }

    if (!outputs.length) {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = uiT('settings.audio.outputSelect.loading', 'Loading system outputs...');
        elements.audioOutputSelect.appendChild(option);
        elements.audioOutputSelect.disabled = true;
        return;
    }

    outputs.forEach((output) => {
        const option = document.createElement('option');
        option.value = String(output.id || '');
        option.textContent = output.badge ? `${output.label} • ${output.badge}` : String(output.label || output.id || '');
        if (option.value === currentId) option.selected = true;
        elements.audioOutputSelect.appendChild(option);
    });
    elements.audioOutputSelect.disabled = false;
}

function getAudioQuickOutputPriority(output) {
    const kind = String(output?.kind || '').toLowerCase();
    if (kind === 'headphones') return 0;
    if (kind === 'bluetooth') return 1;
    if (kind === 'usb') return 2;
    if (kind === 'display') return 3;
    if (kind === 'speakers') return 4;
    return 5;
}

function getAudioQuickOutputIcon(output) {
    const kind = String(output?.kind || '').toLowerCase();
    if (kind === 'headphones') return '🎧';
    if (kind === 'bluetooth') return '📶';
    if (kind === 'usb') return '🔊';
    if (kind === 'display') return '🖥️';
    return '🔉';
}

function formatAudioPortLabel(port) {
    const raw = String(port || '').trim();
    if (!raw) return '';
    const normalized = raw
        .replace(/^analog-output-/, '')
        .replace(/^analog-input-/, '')
        .replace(/^digital-output-/, '')
        .replace(/^digital-input-/, '')
        .replace(/^hdmi-output-/, 'hdmi-')
        .replace(/[-_]+/g, ' ')
        .trim();
    if (!normalized) return '';
    return normalized
        .split(' ')
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');
}

function formatSampleRateLabel(rateHz) {
    const rate = Number(rateHz);
    if (!Number.isFinite(rate) || rate <= 0) return '';
    const khz = rate / 1000;
    return Number.isInteger(khz) ? `${khz} kHz` : `${khz.toFixed(1)} kHz`;
}

function formatChannelCountLabel(channels) {
    const count = Number(channels);
    if (!Number.isFinite(count) || count <= 0) return '';
    if (count === 1) return uiT('settings.audio.deviceCard.channel.mono', 'Mono');
    if (count === 2) return uiT('settings.audio.deviceCard.channel.stereo', 'Stereo');
    return uiT('settings.audio.deviceCard.channel.multi', '{count} ch', { count });
}

function formatSampleFormatLabel(sampleFormat) {
    const raw = String(sampleFormat || '').trim().toLowerCase();
    if (!raw) return '';
    const floatMatch = raw.match(/^f(\d+)/);
    if (floatMatch) {
        return uiT('settings.audio.deviceCard.bitDepthFloat', '{bits}-bit float', { bits: floatMatch[1] });
    }
    const intMatch = raw.match(/^[us](\d+)/);
    if (intMatch) {
        return uiT('settings.audio.deviceCard.bitDepth', '{bits}-bit', { bits: intMatch[1] });
    }
    return raw.toUpperCase();
}

function getAudioDeviceStatusLabel(system) {
    const kind = String(system?.currentOutputKind || '').toLowerCase();
    if (kind === 'headphones') {
        return uiT('settings.audio.deviceCard.status.headphones', 'Headphones connected');
    }
    if (kind === 'bluetooth') {
        return uiT('settings.audio.deviceCard.status.bluetooth', 'Bluetooth output active');
    }
    if (kind === 'display') {
        return uiT('settings.audio.deviceCard.status.display', 'Display audio active');
    }
    if (kind === 'usb') {
        return uiT('settings.audio.deviceCard.status.usb', 'USB audio output active');
    }
    if (system?.supported) {
        return uiT('settings.audio.deviceCard.status.speakers', 'Speaker output active');
    }
    return uiT('settings.audio.deviceCard.status.unknown', 'System output detected');
}

function renderAudioDeviceInsightCard() {
    if (!elements.audioDeviceInsightCard) return;
    const system = state.systemAudio || {};
    if (elements.audioDeviceInsightIcon) {
        elements.audioDeviceInsightIcon.textContent = getAudioQuickOutputIcon({
            kind: system.currentOutputKind,
            isHeadphones: system.isHeadphones
        });
    }
    if (elements.audioDeviceInsightTitle) {
        elements.audioDeviceInsightTitle.textContent = system.currentOutputName || '-';
    }
    if (elements.audioDeviceInsightSubtitle) {
        const portLabel = formatAudioPortLabel(system.currentOutputPort);
        elements.audioDeviceInsightSubtitle.textContent = portLabel || getAudioDeviceStatusLabel(system);
    }
    if (elements.audioDeviceInsightMeta) {
        const chips = [];
        chips.push({
            variant: 'accent',
            text: getAudioDeviceStatusLabel(system)
        });
        if (system.currentOutputBadge) {
            chips.push({
                variant: 'neutral',
                text: system.currentOutputBadge
            });
        }
        const sampleRateLabel = formatSampleRateLabel(system.sampleRateHz);
        if (sampleRateLabel) {
            chips.push({
                variant: 'neutral',
                text: sampleRateLabel
            });
        }
        const formatLabel = formatSampleFormatLabel(system.sampleFormat);
        if (formatLabel) {
            chips.push({
                variant: 'neutral',
                text: formatLabel
            });
        }
        const channelLabel = formatChannelCountLabel(system.channelCount);
        if (channelLabel) {
            chips.push({
                variant: 'neutral',
                text: channelLabel
            });
        }
        if (system.hasRelatedInput) {
            chips.push({
                variant: 'success',
                text: uiT('settings.audio.deviceCard.hasMic', 'Related microphone available')
            });
            if (system.relatedInputName) {
                chips.push({
                    variant: 'neutral',
                    text: uiT('settings.audio.deviceCard.micName', 'Mic: {name}', { name: system.relatedInputName })
                });
            }
        }
        if (system.raiseMaximumVolumeEnabled) {
            chips.push({
                variant: 'success',
                text: uiT('settings.audio.deviceCard.allow150', '150% enabled')
            });
        }
        if (getAudioOutputSettings().followSystemVolume && system.supported) {
            chips.push({
                variant: 'neutral',
                text: uiT('settings.audio.deviceCard.sync', 'System sync on')
            });
        }
        elements.audioDeviceInsightMeta.innerHTML = chips.map((chip) => (
            `<span class="settings-chip settings-chip-${chip.variant}">${escapeHtml(chip.text)}</span>`
        )).join('');
    }
}

function renderAudioQuickOutputCards() {
    if (!elements.audioQuickOutputGrid) return;
    const outputs = Array.isArray(state.systemAudio?.outputs) ? state.systemAudio.outputs.slice() : [];
    const currentId = String(state.systemAudio?.currentOutputId || '').trim();

    const visible = outputs
        .filter((output) => String(output?.id || '').trim())
        .sort((a, b) => {
            const score = getAudioQuickOutputPriority(a) - getAudioQuickOutputPriority(b);
            if (score !== 0) return score;
            return String(a?.label || '').localeCompare(String(b?.label || ''), 'tr');
        })
        .slice(0, 5);

    const signature = JSON.stringify({
        currentId,
        outputs: visible.map((output) => ({
            id: String(output?.id || ''),
            label: String(output?.label || ''),
            badge: String(output?.badge || ''),
            kind: String(output?.kind || '')
        }))
    });

    if (audioOutputRuntime.quickOutputSignature === signature) {
        return;
    }
    audioOutputRuntime.quickOutputSignature = signature;
    elements.audioQuickOutputGrid.innerHTML = '';

    if (!visible.length) {
        const empty = document.createElement('div');
        empty.className = 'settings-sub';
        empty.textContent = uiT(
            'settings.audio.quickOutputs.empty',
            'Connect headphones, Bluetooth audio, HDMI, or USB output devices to show quick choices here.'
        );
        elements.audioQuickOutputGrid.appendChild(empty);
        return;
    }

    visible.forEach((output) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'settings-audio-quick-card';
        if (String(output.id || '') === currentId) btn.classList.add('is-active');
        btn.dataset.outputId = String(output.id || '');
        btn.innerHTML = `
            <span class="settings-audio-quick-icon">${getAudioQuickOutputIcon(output)}</span>
            <span class="settings-audio-quick-meta">
                <span class="settings-audio-quick-title">${escapeHtml(output.label || output.id || '-')}</span>
                <span class="settings-audio-quick-sub">${escapeHtml(output.badge || '-')}</span>
            </span>
        `;
        btn.addEventListener('click', async () => {
            if (!window.aurivo?.systemAudio?.setOutput) return;
            const outputId = String(output.id || '').trim();
            if (!outputId) return;
            btn.disabled = true;
            try {
                const result = await window.aurivo.systemAudio.setOutput(outputId);
                if (result?.success && result?.state) {
                    state.systemAudio = {
                        ...state.systemAudio,
                        ...result.state
                    };
                }
                await refreshSystemAudioState();
                applySystemAudioStateToUi();
            } catch {
                // yoksay
            } finally {
                btn.disabled = false;
            }
        });
        elements.audioQuickOutputGrid.appendChild(btn);
    });
}

function getAudioProfilePresets() {
    return {
        music: {
            followSystemVolume: true,
            allowOverdrive150: false,
            loudnessEnabled: false,
            loudnessMode: 'balanced',
            limiterEnabled: false,
            limiterMode: 'balanced',
            nightModeEnabled: false,
            nightModeLevel: 'balanced',
            stableVolume: false,
            volumeBoost: false
        },
        movie: {
            followSystemVolume: true,
            allowOverdrive150: false,
            loudnessEnabled: true,
            loudnessMode: 'balanced',
            limiterEnabled: true,
            limiterMode: 'balanced',
            nightModeEnabled: false,
            nightModeLevel: 'balanced',
            stableVolume: true,
            volumeBoost: false
        },
        headphones: {
            followSystemVolume: true,
            allowOverdrive150: false,
            loudnessEnabled: true,
            loudnessMode: 'gentle',
            limiterEnabled: true,
            limiterMode: 'soft',
            nightModeEnabled: false,
            nightModeLevel: 'balanced',
            stableVolume: false,
            volumeBoost: true
        },
        night: {
            followSystemVolume: true,
            allowOverdrive150: false,
            loudnessEnabled: true,
            loudnessMode: 'strong',
            limiterEnabled: true,
            limiterMode: 'strict',
            nightModeEnabled: true,
            nightModeLevel: 'balanced',
            stableVolume: true,
            volumeBoost: false,
            appVolume: 55
        },
        loud: {
            followSystemVolume: true,
            allowOverdrive150: true,
            loudnessEnabled: true,
            loudnessMode: 'gentle',
            limiterEnabled: true,
            limiterMode: 'strict',
            nightModeEnabled: false,
            nightModeLevel: 'balanced',
            stableVolume: true,
            volumeBoost: true,
            appVolume: 90
        }
    };
}

function getLoudnessPreset(mode) {
    const key = String(mode || 'balanced').toLowerCase();
    if (key === 'gentle') return { target: -17, maxGain: 4, attack: 120 };
    if (key === 'strong') return { target: -13, maxGain: 8, attack: 55 };
    return { target: -15, maxGain: 6, attack: 80 };
}

async function applyLoudnessNormalizationToEngine() {
    const prefs = getAudioOutputSettings();
    const api = window.aurivo?.audio?.autoGain;
    if (!api) return false;
    try {
        const enabled = !!prefs.loudnessEnabled;
        await api.setEnabled(enabled);
        if (enabled) {
            const preset = getLoudnessPreset(prefs.loudnessMode);
            await api.setTarget(preset.target);
            await api.setMaxGain(preset.maxGain);
            await api.setAttack(preset.attack);
        }
        return true;
    } catch {
        return false;
    }
}

function getLimiterPreset(mode) {
    const key = String(mode || 'balanced').toLowerCase();
    if (key === 'soft') return { ceiling: -0.5, release: 140, lookahead: 3 };
    if (key === 'strict') return { ceiling: -1.5, release: 70, lookahead: 6 };
    return { ceiling: -1.0, release: 95, lookahead: 4 };
}

function getNightModePreset(mode) {
    const key = String(mode || 'balanced').toLowerCase();
    if (key === 'light') {
        return { threshold: -19, ratio: 2.1, attack: 16, release: 180, makeup: 1.5, knee: 5 };
    }
    if (key === 'strong') {
        return { threshold: -28, ratio: 4.6, attack: 6, release: 240, makeup: 4.5, knee: 8 };
    }
    return { threshold: -23, ratio: 3.2, attack: 10, release: 210, makeup: 3, knee: 6 };
}

async function applyNightModeToEngine() {
    const prefs = getAudioOutputSettings();
    const compressor = window.aurivo?.ipcAudio?.compressor;
    if (!compressor) return false;
    try {
        const enabled = !!prefs.nightModeEnabled;
        await compressor.enable(enabled);
        if (enabled) {
            const preset = getNightModePreset(prefs.nightModeLevel);
            await compressor.setThreshold(preset.threshold);
            await compressor.setRatio(preset.ratio);
            await compressor.setAttack(preset.attack);
            await compressor.setRelease(preset.release);
            await compressor.setMakeupGain(preset.makeup);
            await compressor.setKnee(preset.knee);
        }
        if (elements.audioNightModeHint) {
            const detailKey = `settings.audio.night.mode.${String(prefs.nightModeLevel || 'balanced').toLowerCase()}.detail`;
            const fallbackMap = {
                light: 'Light mode gently softens sudden peaks without changing the overall feel too much.',
                balanced: 'Balanced mode is best for film, web video and quiet home listening.',
                strong: 'Strong mode suppresses peaks harder and keeps the room calmer late at night.'
            };
            elements.audioNightModeHint.textContent = uiT(detailKey, fallbackMap[String(prefs.nightModeLevel || 'balanced').toLowerCase()] || fallbackMap.balanced);
        }
        return true;
    } catch {
        return false;
    }
}

async function applyLimiterProtectionToEngine() {
    const prefs = getAudioOutputSettings();
    const limiter = window.aurivo?.audio?.limiter;
    if (!limiter) return false;
    try {
        const enabled = !!prefs.limiterEnabled;
        await limiter.enable(enabled);
        if (enabled) {
            const preset = getLimiterPreset(prefs.limiterMode);
            await limiter.setCeiling(preset.ceiling);
            await limiter.setRelease(preset.release);
            await limiter.setLookahead(preset.lookahead);
            await limiter.setGain(0);
        }
        return true;
    } catch {
        return false;
    }
}

function setAudioProfileCardState(profile) {
    if (!elements.audioProfileCards?.length) return;
    const activeProfile = String(profile || 'music').toLowerCase();
    elements.audioProfileCards.forEach((card) => {
        card.classList.toggle('is-active', String(card.dataset.audioProfile || '').toLowerCase() === activeProfile);
    });
}

function setAudioSpatialCardState(mode) {
    if (!elements.audioSpatialCards?.length) return;
    const activeMode = String(mode || 'stereo').toLowerCase();
    elements.audioSpatialCards.forEach((card) => {
        card.classList.toggle('is-active', String(card.dataset.audioSpatial || '').toLowerCase() === activeMode);
    });
}

function getSpatialAudioPresets() {
    return {
        mono: {
            stereoExpander: 0,
            stereoWidener: { enabled: false, width: 0, bassCutoff: 220, delay: 0, balance: 0, monoLow: true },
            crossfeed: { enabled: false, level: 0, delay: 0.22, lowCut: 650, highCut: 4500 },
            bassMono: { enabled: true, cutoff: 220, slope: 12, stereoWidth: 0 }
        },
        stereo: {
            stereoExpander: 100,
            stereoWidener: { enabled: false, width: 100, bassCutoff: 180, delay: 0, balance: 0, monoLow: false },
            crossfeed: { enabled: false, level: 0, delay: 0.22, lowCut: 650, highCut: 4500 },
            bassMono: { enabled: false, cutoff: 180, slope: 12, stereoWidth: 100 }
        },
        spatial: {
            stereoExpander: 118,
            stereoWidener: { enabled: true, width: 122, bassCutoff: 220, delay: 11, balance: 0, monoLow: true },
            crossfeed: { enabled: true, level: 34, delay: 0.28, lowCut: 700, highCut: 4200 },
            bassMono: { enabled: true, cutoff: 180, slope: 12, stereoWidth: 88 }
        }
    };
}

async function applySpatialAudioMode(mode, options = {}) {
    const { persist = true } = options;
    const presets = getSpatialAudioPresets();
    const key = ['mono', 'stereo', 'spatial'].includes(String(mode || '').toLowerCase())
        ? String(mode).toLowerCase()
        : 'stereo';
    const preset = presets[key];
    const prefs = getAudioOutputSettings();
    prefs.spatialMode = key;
    setAudioSpatialCardState(key);

    if (elements.audioSpatialHint) {
        const fallbackMap = {
            mono: 'Mono mode narrows the stage and reduces problematic hard left/right separation.',
            stereo: 'Stereo mode keeps the original channel image without extra widening or headphone processing.',
            spatial: 'Spatial mode combines widening and headphone crossfeed for a larger, more immersive stage.'
        };
        elements.audioSpatialHint.textContent = uiT(`settings.audio.spatial.${key}.detail`, fallbackMap[key]);
    }

    try {
        if (window.aurivo?.ipcAudio?.module?.setStereoExpander && Number.isFinite(preset.stereoExpander)) {
            await window.aurivo.ipcAudio.module.setStereoExpander(preset.stereoExpander);
        }
    } catch {
        // yoksay
    }

    try {
        const stereoWidener = window.aurivo?.ipcAudio?.stereoWidener;
        if (stereoWidener) {
            await stereoWidener.enable(!!preset.stereoWidener.enabled);
            if (preset.stereoWidener.enabled) {
                await stereoWidener.setWidth(preset.stereoWidener.width);
                await stereoWidener.setBassCutoff(preset.stereoWidener.bassCutoff);
                await stereoWidener.setDelay(preset.stereoWidener.delay);
                await stereoWidener.setBalance(preset.stereoWidener.balance);
                await stereoWidener.setMonoLow(!!preset.stereoWidener.monoLow);
            } else if (typeof stereoWidener.reset === 'function') {
                await stereoWidener.reset();
            }
        }
    } catch {
        // yoksay
    }

    try {
        const crossfeed = window.aurivo?.ipcAudio?.crossfeed;
        if (crossfeed) {
            await crossfeed.enable(!!preset.crossfeed.enabled);
            if (preset.crossfeed.enabled) {
                await crossfeed.setLevel(preset.crossfeed.level);
                await crossfeed.setDelay(preset.crossfeed.delay);
                await crossfeed.setLowCut(preset.crossfeed.lowCut);
                await crossfeed.setHighCut(preset.crossfeed.highCut);
            } else if (typeof crossfeed.reset === 'function') {
                await crossfeed.reset();
            }
        }
    } catch {
        // yoksay
    }

    try {
        const bassMono = window.aurivo?.ipcAudio?.bassMono;
        if (bassMono) {
            await bassMono.enable(!!preset.bassMono.enabled);
            if (preset.bassMono.enabled) {
                await bassMono.setCutoff(preset.bassMono.cutoff);
                await bassMono.setSlope(preset.bassMono.slope);
                await bassMono.setStereoWidth(preset.bassMono.stereoWidth);
            } else if (typeof bassMono.reset === 'function') {
                await bassMono.reset();
            }
        }
    } catch {
        // yoksay
    }

    if (persist) saveSettings().catch(() => { });
}

async function applyAudioProfile(profile, options = {}) {
    const { persist = true } = options;
    const presets = getAudioProfilePresets();
    const key = String(profile || 'music').toLowerCase();
    const preset = presets[key] || presets.music;
    const prefs = getAudioOutputSettings();

    prefs.profile = key;
    prefs.followSystemVolume = !!preset.followSystemVolume;
    prefs.allowOverdrive150 = !!preset.allowOverdrive150;
    prefs.loudnessEnabled = !!preset.loudnessEnabled;
    prefs.loudnessMode = String(preset.loudnessMode || 'balanced').toLowerCase();
    prefs.limiterEnabled = !!preset.limiterEnabled;
    prefs.limiterMode = String(preset.limiterMode || 'balanced').toLowerCase();
    prefs.nightModeEnabled = !!preset.nightModeEnabled;
    prefs.nightModeLevel = String(preset.nightModeLevel || 'balanced').toLowerCase();
    if (!state.settings.videoFullscreen || typeof state.settings.videoFullscreen !== 'object') {
        state.settings.videoFullscreen = {};
    }
    state.settings.videoFullscreen.stableVolume = !!preset.stableVolume;
    state.settings.videoFullscreen.volumeBoost = !!preset.volumeBoost;

    if (elements.audioFollowSystemVolume) elements.audioFollowSystemVolume.checked = !!preset.followSystemVolume;
    setAudioOverdriveButtonState(!!preset.allowOverdrive150);
    if (elements.audioLoudnessEnabled) elements.audioLoudnessEnabled.checked = !!preset.loudnessEnabled;
    if (elements.audioLoudnessMode) elements.audioLoudnessMode.value = String(preset.loudnessMode || 'balanced');
    if (elements.audioLimiterEnabled) elements.audioLimiterEnabled.checked = !!preset.limiterEnabled;
    if (elements.audioLimiterMode) elements.audioLimiterMode.value = String(preset.limiterMode || 'balanced');
    if (elements.audioNightModeEnabled) elements.audioNightModeEnabled.checked = !!preset.nightModeEnabled;
    if (elements.audioNightModeLevel) elements.audioNightModeLevel.value = String(preset.nightModeLevel || 'balanced');
    if (elements.audioStableVolume) elements.audioStableVolume.checked = !!preset.stableVolume;
    if (elements.audioVolumeBoost) elements.audioVolumeBoost.checked = !!preset.volumeBoost;
    setAudioProfileCardState(key);

    if (Number.isFinite(preset.appVolume)) {
        updateAudioAppVolumeUi(preset.appVolume);
        setAppMasterVolume(preset.appVolume, { persist: false, syncSettingsSlider: true, syncMainSlider: true });
    }

    if (window.aurivo?.systemAudio?.setAllowOverdrive && state.systemAudio?.supported) {
        try {
            const result = await window.aurivo.systemAudio.setAllowOverdrive(!!preset.allowOverdrive150);
            if (result?.success && result?.state) {
                state.systemAudio = {
                    ...state.systemAudio,
                    ...result.state
                };
            }
        } catch {
            // yoksay
        }
    }

    await applyLoudnessNormalizationToEngine();
    await applyLimiterProtectionToEngine();
    await applyNightModeToEngine();
    applySystemAudioStateToUi();
    if (persist) saveSettings();
}

function applySystemAudioStateToUi() {
    applyHeadphoneCrossfeedAutoMode().catch(() => { });

    const prefs = getAudioOutputSettings();
    const system = state.systemAudio || {};
    const systemVolume = Number(system.volumePercent);
    const runtimeAllow150 = !!system.raiseMaximumVolumeEnabled || (Number.isFinite(systemVolume) && systemVolume > 100);
    prefs.allowOverdrive150 = runtimeAllow150;

    const outputSelectHint = system.supported
        ? uiT('settings.audio.outputSelect.hint', 'The selected device becomes the system default output.')
        : uiT('settings.audio.outputSelect.unsupported', 'Output switching is currently available on Linux/PipeWire/PulseAudio.');
    const systemHint = system.supported
        ? `${prefs.followSystemVolume
            ? uiT('settings.audio.followSystem.active', 'System output sync is active.')
            : uiT('settings.audio.followSystem.inactive', 'System output sync is off. Slider stays local until you save.')
        } ${system.isHeadphones
            ? uiT('settings.audio.deviceKind.headphones', 'Headphones detected.')
            : uiT('settings.audio.deviceKind.other', 'Current output device detected.')
        }`
        : uiT(
            'settings.audio.followSystem.unsupported',
            'Real-time system output sync is currently available on Linux/PipeWire/PulseAudio.'
        );

    const systemUiSignature = JSON.stringify({
        outputName: system.currentOutputName || '-',
        outputBadge: system.currentOutputBadge || '-',
        outputHint: outputSelectHint,
        systemHint,
        followSystem: !!prefs.followSystemVolume,
        followDisabled: !system.supported,
        allow150: runtimeAllow150,
        allow150Disabled: !system.canBoostOver100,
        sliderValue: prefs.followSystemVolume && system.supported && Number.isFinite(system.volumePercent)
            ? Number(system.volumePercent)
            : Number(prefs.defaultVolume ?? 40),
        outputId: String(system.currentOutputId || ''),
        outputs: Array.isArray(system.outputs)
            ? system.outputs.map((output) => ({
                id: String(output?.id || ''),
                label: String(output?.label || ''),
                badge: String(output?.badge || ''),
                kind: String(output?.kind || '')
            }))
            : [],
        kind: system.currentOutputKind || '',
        port: system.currentOutputPort || '',
        sampleRateHz: Number(system.sampleRateHz || 0),
        channelCount: Number(system.channelCount || 0),
        sampleFormat: system.sampleFormat || '',
        relatedInputName: system.relatedInputName || '',
        hasRelatedInput: !!system.hasRelatedInput,
        canBoostOver100: !!system.canBoostOver100,
        raiseMaximumVolumeEnabled: !!system.raiseMaximumVolumeEnabled
    });

    if (audioOutputRuntime.systemUiSignature === systemUiSignature) {
        return;
    }
    audioOutputRuntime.systemUiSignature = systemUiSignature;

    setTextIfChanged(elements.audioCurrentOutputName, system.currentOutputName || '-');
    setTextIfChanged(elements.audioCurrentOutputBadge, system.currentOutputBadge || '-');
    renderAudioDeviceInsightCard();
    renderAudioOutputOptions();
    renderAudioQuickOutputCards();
    setTextIfChanged(elements.audioOutputSelectHint, outputSelectHint);
    setTextIfChanged(elements.audioSystemAudioHint, systemHint);
    if (elements.audioFollowSystemVolume) {
        setCheckboxIfChanged(elements.audioFollowSystemVolume, !!prefs.followSystemVolume);
        elements.audioFollowSystemVolume.disabled = !system.supported;
    }
    if (elements.audioAllowOverdrive150) {
        setAudioOverdriveButtonState(runtimeAllow150);
        elements.audioAllowOverdrive150.disabled = !system.canBoostOver100;
    }
    setAudioProfileCardState(prefs.profile || 'music');
    const sliderValue = (prefs.followSystemVolume && system.supported && Number.isFinite(system.volumePercent))
        ? system.volumePercent
        : (prefs.defaultVolume ?? 40);
    updateAudioSettingsSliderUi(sliderValue);
}

async function refreshSystemAudioState(options = {}) {
    if (!window.aurivo?.systemAudio?.getState) return null;
    try {
        const previousOutputId = String(state.systemAudio?.currentOutputId || '').trim();
        const response = await window.aurivo.systemAudio.getState();
        if (response && typeof response === 'object') {
            state.systemAudio = {
                ...state.systemAudio,
                ...response
            };
            const nextOutputId = String(state.systemAudio?.currentOutputId || '').trim();
            const outputChanged = !!nextOutputId && !!previousOutputId && nextOutputId !== previousOutputId;
            if (outputChanged) {
                audioOutputRuntime.lastOutputId = nextOutputId;
                audioOutputRuntime.lastOutputChangeAt = Date.now();
                keepNativePlaybackAliveAfterRouteChange().catch(() => { });
            }
            if (!options.skipUi) applySystemAudioStateToUi();
            return state.systemAudio;
        }
    } catch {
        // yoksay
    }
    return null;
}

async function keepNativePlaybackAliveAfterRouteChange() {
    if (!useNativeAudio) return;
    if (state.activeMedia !== 'audio') return;
    if (!state.isPlaying) return;
    if (!window.aurivo?.audio?.isPlaying || !window.aurivo?.audio?.play) return;

    const now = Date.now();
    if (now - Number(audioOutputRuntime.lastResumeAfterRouteChangeAt || 0) < 1000) return;
    audioOutputRuntime.lastResumeAfterRouteChangeAt = now;

    await new Promise((r) => setTimeout(r, 140));
    if (!state.isPlaying || state.activeMedia !== 'audio') return;

    const playingNow = await window.aurivo.audio.isPlaying();
    if (playingNow) return;

    await window.aurivo.audio.play();
    await new Promise((r) => setTimeout(r, 90));
    let resumed = await window.aurivo.audio.isPlaying();
    if (!resumed) {
        const posHint = Number(state.nativePositionMs || 0);
        resumed = await hardRecoverCurrentTrackAfterRouteChange(posHint);
    }
    if (resumed) {
        updatePlayPauseIcon(true);
        updateTrayState();
        updateMPRISMetadata();
        startNativePositionUpdates();
    }
}

async function hardRecoverCurrentTrackAfterRouteChange(positionHintMs = 0) {
    if (!useNativeAudio) return false;
    if (!state.isPlaying || state.activeMedia !== 'audio') return false;
    if (!window.aurivo?.audio?.loadFile || !window.aurivo?.audio?.play) return false;
    if (!Array.isArray(state.playlist) || state.currentIndex < 0 || state.currentIndex >= state.playlist.length) return false;

    const now = Date.now();
    if (now - Number(audioOutputRuntime.lastHardRecoverAt || 0) < 1800) return false;
    audioOutputRuntime.lastHardRecoverAt = now;

    const item = state.playlist[state.currentIndex];
    const path = String(item?.path || '').trim();
    if (!path) return false;

    try {
        const loadRes = await window.aurivo.audio.loadFile(path);
        const loaded = loadRes === true || (loadRes && loadRes.success);
        if (!loaded) return false;

        const safePos = Math.max(0, Number(positionHintMs || 0));
        if (safePos > 350 && window.aurivo.audio.seek) {
            try { await window.aurivo.audio.seek(safePos); } catch { }
        }

        await window.aurivo.audio.setVolume?.((state.volume || 0) / 100);
        await window.aurivo.audio.play();
        await new Promise((r) => setTimeout(r, 100));
        const resumed = await window.aurivo.audio.isPlaying?.();
        return !!resumed;
    } catch {
        return false;
    }
}

function startAudioOutputMonitor() {
    if (audioOutputRuntime.pollTimer) return;
    audioOutputRuntime.pollTimer = setInterval(() => {
        refreshSystemAudioState();
    }, 300);
}

function stopAudioOutputMonitor() {
    if (!audioOutputRuntime.pollTimer) return;
    clearInterval(audioOutputRuntime.pollTimer);
    audioOutputRuntime.pollTimer = null;
}

function setAudioOutputMeterIdle() {
    if (elements.audioOutputLevelLeft) {
        elements.audioOutputLevelLeft.style.setProperty('--meter-level', '0%');
    }
    if (elements.audioOutputLevelRight) {
        elements.audioOutputLevelRight.style.setProperty('--meter-level', '0%');
    }
    if (elements.audioOutputLevelLeftValue) {
        elements.audioOutputLevelLeftValue.textContent = '0%';
    }
    if (elements.audioOutputLevelRightValue) {
        elements.audioOutputLevelRightValue.textContent = '0%';
    }
    if (elements.audioOutputClipLed) {
        elements.audioOutputClipLed.classList.remove('active');
    }
    if (elements.audioOutputMeterState) {
        elements.audioOutputMeterState.textContent = uiT('settings.audio.meter.waiting', 'Bekliyor');
        elements.audioOutputMeterState.classList.remove('settings-chip-alert', 'settings-chip-success');
        elements.audioOutputMeterState.classList.add('settings-chip-neutral');
    }
}

function renderAudioOutputMeter(levels) {
    const left = Math.max(0, Math.min(1, Number(levels?.left) || 0));
    const right = Math.max(0, Math.min(1, Number(levels?.right) || 0));
    const leftPct = Math.round(left * 100);
    const rightPct = Math.round(right * 100);
    const clipping = left >= 0.965 || right >= 0.965;
    const hasSignal = left > 0.01 || right > 0.01;

    if (elements.audioOutputLevelLeft) {
        elements.audioOutputLevelLeft.style.setProperty('--meter-level', `${leftPct}%`);
    }
    if (elements.audioOutputLevelRight) {
        elements.audioOutputLevelRight.style.setProperty('--meter-level', `${rightPct}%`);
    }
    if (elements.audioOutputLevelLeftValue) {
        elements.audioOutputLevelLeftValue.textContent = `${leftPct}%`;
    }
    if (elements.audioOutputLevelRightValue) {
        elements.audioOutputLevelRightValue.textContent = `${rightPct}%`;
    }
    if (elements.audioOutputClipLed) {
        elements.audioOutputClipLed.classList.toggle('active', clipping);
    }
    if (elements.audioOutputMeterState) {
        const nextLabel = clipping
            ? uiT('settings.audio.meter.clip', 'Clip riski')
            : hasSignal
                ? uiT('settings.audio.meter.active', 'Canlı')
                : uiT('settings.audio.meter.silent', 'Sessiz');
        elements.audioOutputMeterState.textContent = nextLabel;
        elements.audioOutputMeterState.classList.remove('settings-chip-neutral', 'settings-chip-alert', 'settings-chip-success');
        elements.audioOutputMeterState.classList.add(clipping ? 'settings-chip-alert' : hasSignal ? 'settings-chip-success' : 'settings-chip-neutral');
    }
}

async function refreshAudioOutputLevels() {
    const getLevels = window.aurivo?.ipcAudio?.spectrum?.getLevels;
    try {
        let levels = null;
        if (typeof getLevels === 'function') {
            levels = await getLevels();
        }

        const left = Math.max(0, Math.min(1, Number(levels?.left) || 0));
        const right = Math.max(0, Math.min(1, Number(levels?.right) || 0));

        if (left > 0.001 || right > 0.001) {
            renderAudioOutputMeter({ left, right });
            return;
        }

        const truePeakMeter = window.aurivo?.ipcAudio?.truePeakLimiter?.getMeter;
        if (typeof truePeakMeter === 'function') {
            const meter = await truePeakMeter();
            const peakLDb = Number(meter?.peakL);
            const peakRDb = Number(meter?.peakR);
            const fallbackLeft = Number.isFinite(peakLDb) ? Math.max(0, Math.min(1, Math.pow(10, peakLDb / 20))) : 0;
            const fallbackRight = Number.isFinite(peakRDb) ? Math.max(0, Math.min(1, Math.pow(10, peakRDb / 20))) : 0;
            renderAudioOutputMeter({ left: fallbackLeft, right: fallbackRight });
            return;
        }

        setAudioOutputMeterIdle();
    } catch {
        setAudioOutputMeterIdle();
    }
}

function startAudioOutputLevelMeter() {
    if (audioOutputRuntime.levelMeterTimer) return;
    refreshAudioOutputLevels();
    audioOutputRuntime.levelMeterTimer = setInterval(() => {
        refreshAudioOutputLevels();
    }, 140);
}

function stopAudioOutputLevelMeter() {
    if (audioOutputRuntime.levelMeterTimer) {
        clearInterval(audioOutputRuntime.levelMeterTimer);
        audioOutputRuntime.levelMeterTimer = null;
    }
    setAudioOutputMeterIdle();
}

async function applyAudioSettingsSliderToSystem(value) {
    if (!window.aurivo?.systemAudio?.setVolume) return false;
    const prefs = getAudioOutputSettings();
    if (!prefs.followSystemVolume || !state.systemAudio?.supported) return false;
    if (audioOutputRuntime.applyingSlider) return false;
    audioOutputRuntime.applyingSlider = true;
    try {
        const result = await window.aurivo.systemAudio.setVolume(value);
        if (result?.success && result?.state) {
            state.systemAudio = {
                ...state.systemAudio,
                ...result.state
            };
            applySystemAudioStateToUi();
            return true;
        }
    } catch {
        // yoksay
    } finally {
        audioOutputRuntime.applyingSlider = false;
    }
    return false;
}

function clearSavedVideoLibraryFromSettings() {
    state.videoFiles = [];
    state.currentPath = '';
    persistVideoLibrary();
    if (typeof renderVideoLibraryTree === 'function') {
        renderVideoLibraryTree();
    }
    if (elements.libraryVideoCount) {
        elements.libraryVideoCount.textContent = '0';
    }
    safeNotify(uiT('settings.library.notify.videoLibraryCleared', 'Saved video list cleared.'), 'success', 1800);
}

function persistCurrentMainSection() {
    if (!state.settings || typeof state.settings !== 'object') return;
    if (!state.settings.ui || typeof state.settings.ui !== 'object') state.settings.ui = {};

    const page = ['music', 'video', 'web'].includes(state.currentPage) ? state.currentPage : 'music';
    state.settings.ui.lastPage = page;
    state.settings.ui.lastPanel = page === 'web' ? 'web' : 'library';

    saveSettings().catch(() => { });
}

function restoreLastMainSection() {
    const remember = state.settings?.ui?.rememberLastSection !== false;
    const startup = String(state.settings?.ui?.startupPage || 'music').toLowerCase();
    const savedPage = String(state.settings?.ui?.lastPage || '').toLowerCase();
    const page = remember
        ? (['music', 'video', 'web'].includes(savedPage) ? savedPage : 'music')
        : (['music', 'video', 'web'].includes(startup) ? startup : 'music');
    const startupBehavior = getLibraryStartupBehavior();
    if (startupBehavior.restoreLastFolder) {
        if (page === 'music') {
            state.pendingLibraryStartupPath = String(startupBehavior.startupState?.lastAudioPath || '').trim();
        } else if (page === 'video') {
            state.pendingLibraryStartupPath = String(startupBehavior.startupState?.lastVideoPath || '').trim();
        } else {
            state.pendingLibraryStartupPath = '';
        }
    } else {
        state.pendingLibraryStartupPath = '';
    }
    const btn = document.querySelector(`.sidebar-btn[data-page="${page}"]`) ||
        document.querySelector('.sidebar-btn[data-page="music"]');
    if (!btn) return;
    handleSidebarClick(btn);
}

async function restoreLibraryStartupState() {
    const startup = getLibraryStartupBehavior();
    if (!startup.restoreLastFolder) {
        rememberSelectedTreePath('');
        return;
    }

    const page = String(state.currentPage || 'music').toLowerCase();
    if (page === 'music') {
        const targetPath = String(startup.startupState?.lastAudioPath || '').trim();
        if (targetPath) {
            const exists = await fileExistsSafe(targetPath);
            if (!exists) {
                state.lastAudioPath = null;
                state.currentPath = '';
                state.pendingLibraryStartupPath = '';
                if (state.settings?.library?.startupState) {
                    state.settings.library.startupState.lastAudioPath = '';
                    saveSettings().catch(() => {});
                }
                return;
            }
            state.mediaFilter = 'audio';
            state.currentPath = targetPath;
            await initializeFileTree();
            restoreTreeSelectionIfNeeded();
        }
        return;
    }

    if (page === 'video') {
        const targetPath = String(startup.startupState?.lastVideoPath || '').trim();
        if (targetPath) {
            const exists = await fileExistsSafe(targetPath);
            if (!exists) {
                state.lastVideoPath = null;
                state.currentPath = '';
                state.pendingLibraryStartupPath = '';
                if (state.settings?.library?.startupState) {
                    state.settings.library.startupState.lastVideoPath = '';
                    saveSettings().catch(() => {});
                }
                return;
            }
            state.mediaFilter = 'video';
            state.currentPath = targetPath;
            await initializeFileTree();
            restoreTreeSelectionIfNeeded();
        }
    }
}

async function resumePlaybackPositionOnStartup(positionMs) {
    const targetMsRaw = Math.max(0, Number(positionMs) || 0);
    if (targetMsRaw < 1200) return;

    if (useNativeAudio && state.activeMedia === 'audio' && window.aurivo?.audio?.seek) {
        try {
            const durationSec = await window.aurivo.audio.getDuration();
            const durationMs = Math.max(0, Number(durationSec) * 1000);
            const safeTarget = durationMs > 0
                ? Math.max(0, Math.min(targetMsRaw, Math.max(0, durationMs - 700)))
                : targetMsRaw;
            if (safeTarget >= 1200) {
                await window.aurivo.audio.seek(safeTarget);
            }
        } catch (error) {
            console.warn('[PLAYBACK] startup native seek failed:', error);
        }
        return;
    }

    const activePlayer = getActiveAudioPlayer();
    if (!activePlayer) return;
    const applySeek = () => {
        try {
            const durationMs = (Number(activePlayer.duration) || 0) * 1000;
            const safeTarget = durationMs > 0
                ? Math.max(0, Math.min(targetMsRaw, Math.max(0, durationMs - 700)))
                : targetMsRaw;
            if (safeTarget >= 1200) {
                activePlayer.currentTime = safeTarget / 1000;
            }
        } catch {
            // yoksay
        }
    };
    if (Number.isFinite(Number(activePlayer.duration)) && Number(activePlayer.duration) > 0) {
        applySeek();
    } else {
        activePlayer.addEventListener('loadedmetadata', applySeek, { once: true });
    }
}

async function restorePlaybackStartupState() {
    const playback = getPlaybackSettings();
    if (!playback.restoreLastTrackOnStartup) return;
    if (!Array.isArray(state.playlist) || state.playlist.length <= 0) return;

    const startup = playback.startupState && typeof playback.startupState === 'object'
        ? playback.startupState
        : {};

    const lastTrackPath = String(startup.lastTrackPath || '').trim();
    let targetIndex = -1;
    if (lastTrackPath) {
        targetIndex = state.playlist.findIndex((item) => String(item?.path || '') === lastTrackPath);
    }
    if (targetIndex < 0) {
        const fallbackIndex = Number(startup.lastTrackIndex);
        if (Number.isInteger(fallbackIndex) && fallbackIndex >= 0 && fallbackIndex < state.playlist.length) {
            targetIndex = fallbackIndex;
        }
    }
    if (targetIndex < 0 || targetIndex >= state.playlist.length) return;

    const item = state.playlist[targetIndex];
    state.currentIndex = targetIndex;
    state.activeMedia = 'audio';
    state.isPlaying = false;
    state.playbackEndWarnedTrackKey = '';
    state.playbackStatePersistSecond = -1;
    updatePlayPauseIcon(false);
    renderPlaylist();
    if (elements.nowPlayingLabel) {
        elements.nowPlayingLabel.textContent = `${uiT('nowPlaying.prefix', 'Now Playing')}: ${item?.name || 'Parça'}`;
    }
    if (item?.path) {
        extractAlbumArt(item.path).catch(() => {});
    }

    const shouldAutoPlay = !!playback.autoplayLastTrackOnStartup;
    if (!shouldAutoPlay) {
        // UI'da seçili görünen parçayı engine/player tarafına da hazırla.
        // Böylece ilk Play tıklamasında çift tıklama gerekmeksizin hemen başlar.
        try {
            if (item?.path) {
                if (useNativeAudio && window.aurivo?.audio?.loadFile) {
                    const res = await window.aurivo.audio.loadFile(item.path);
                    if (res === true || (res && res.success)) {
                        window.aurivo.audio.setVolume?.((state.volume || 0) / 100);
                    }
                } else {
                    const activePlayer = getActiveAudioPlayer();
                    if (activePlayer) {
                        activePlayer.src = toLocalFileUrl(item.path);
                        const useWebAudioGainPath = !useNativeAudio && !!webAudioOutputGainNode;
                        activePlayer.volume = useWebAudioGainPath ? 1 : ((state.volume || 0) / 100);
                        activePlayer.muted = useWebAudioGainPath ? false : state.isMuted;
                        setWebAudioOutputGainFromState();
                    }
                }
            }
        } catch (error) {
            console.warn('[PLAYBACK] startup pre-load failed:', error);
        }
        rememberPlaybackStartupState({ persist: false });
        return;
    }

    await playIndex(targetIndex);

    if (playback.resumePositionOnStartup !== false) {
        await resumePlaybackPositionOnStartup(Number(startup.lastPositionMs) || 0);
    }
}

function setupStandaloneSettingsEventListeners() {
    const api = window.AurivoSettingsWindow;
    if (!api?.setupStandaloneEventListeners) {
        console.warn('[SETTINGS] standalone helper missing');
        return;
    }
    api.setupStandaloneEventListeners({
        elements,
        closeRestartModal,
        confirmAndRelaunchApp,
        closeSettings,
        applySettings,
        resetPlaybackDefaults,
        resetListenDefaults,
        resetCurrentSettingsTab,
        getActiveSettingsTabName,
        getSettingsTabLabel,
        updatePulseQuickModeUi,
        openAdblockDashboardPanel,
        refreshAdblockStats,
        setAdblockMode,
        readAdblockSettingsFromUI,
        updateAdblockBadge,
        handleKeyboard,
        setupSecurityUI,
        startAdblockStatsPolling,
        switchSettingsTab,
        getBlockedCount: () => adblockRuntime.lastBlocked,
        clearVideoLibrary: clearSavedVideoLibraryFromSettings
    });

    bindLibrarySettingsEventListeners();
}

function bindLibrarySettingsEventListeners({ includeVideoClear = false } = {}) {
    if (state.__librarySettingsHandlersBound) {
        if (includeVideoClear && elements.libraryClearVideoLibrary && !elements.libraryClearVideoLibrary.dataset.boundLibraryClear) {
            elements.libraryClearVideoLibrary.addEventListener('click', clearSavedVideoLibraryFromSettings);
            elements.libraryClearVideoLibrary.dataset.boundLibraryClear = '1';
        }
        return;
    }

    state.__librarySettingsHandlersBound = true;

    if (elements.libraryAddMusicFolder) {
        elements.libraryAddMusicFolder.addEventListener('click', addMusicFolderFromSettings);
    }
    if (elements.libraryHeroAddFolderBtn) {
        elements.libraryHeroAddFolderBtn.addEventListener('click', (event) => {
            showLibraryAddMenu(event.currentTarget || event.target, 'audio');
        });
    }
    if (elements.libraryAddExcludedFolder) {
        elements.libraryAddExcludedFolder.addEventListener('click', () => {
            addExcludedFolderFromSettings().catch(() => {});
        });
    }
    if (elements.libraryResetExtensions) {
        elements.libraryResetExtensions.addEventListener('click', resetLibraryExtensionsToDefaults);
    }
    if (elements.libraryCleanupMissingBtn) {
        elements.libraryCleanupMissingBtn.addEventListener('click', () => {
            runLibraryCleanup('missing').catch(() => {});
        });
    }
    if (elements.libraryCleanupDuplicatesBtn) {
        elements.libraryCleanupDuplicatesBtn.addEventListener('click', () => {
            runLibraryCleanup('duplicates').catch(() => {});
        });
    }
    if (elements.libraryCleanupEmptyFoldersBtn) {
        elements.libraryCleanupEmptyFoldersBtn.addEventListener('click', () => {
            runLibraryCleanup('empty-folders').catch(() => {});
        });
    }
    if (elements.libraryExportBundleBtn) {
        elements.libraryExportBundleBtn.addEventListener('click', () => {
            exportLibraryBundle().catch(() => {});
        });
    }
    if (elements.libraryImportBundleBtn) {
        elements.libraryImportBundleBtn.addEventListener('click', () => {
            importLibraryBundle().catch(() => {});
        });
    }
    if (elements.libraryRescanMusicFolders) {
        elements.libraryRescanMusicFolders.addEventListener('click', () => {
            rescanMusicFolders().catch(() => {});
        });
    }
    if (elements.libraryHeroRescanBtn) {
        elements.libraryHeroRescanBtn.addEventListener('click', () => {
            rescanMusicFolders().catch(() => {});
        });
    }
    if (elements.libraryManagedFoldersList) {
        elements.libraryManagedFoldersList.addEventListener('click', (event) => {
            const button = event.target.closest('[data-library-action]');
            if (!button) return;
            const action = String(button.dataset.libraryAction || '');
            const folderPath = String(button.dataset.folderPath || '');
            if (!folderPath) return;
            if (action === 'remove') {
                removeMusicFolderFromSettings(folderPath);
                return;
            }
            if (action === 'rescan') {
                rescanMusicFolders(folderPath).catch(() => {});
            }
        });
    }
    if (elements.libraryExcludedFoldersList) {
        elements.libraryExcludedFoldersList.addEventListener('click', (event) => {
            const button = event.target.closest('[data-library-exclude-action]');
            if (!button) return;
            const action = String(button.dataset.libraryExcludeAction || '');
            const folderPath = String(button.dataset.folderPath || '');
            if (action === 'remove' && folderPath) {
                removeExcludedFolderFromSettings(folderPath);
            }
        });
    }
    if (elements.libraryRefreshMetadataBtn) {
        elements.libraryRefreshMetadataBtn.addEventListener('click', () => {
            refreshLibraryMetadataCache({
                cleanBrokenChars: false,
                inferFromFilename: false
            }).catch(() => {});
        });
    }
    if (elements.libraryCleanMetadataBtn) {
        elements.libraryCleanMetadataBtn.addEventListener('click', () => {
            refreshLibraryMetadataCache({
                cleanBrokenChars: true,
                inferFromFilename: false
            }).catch(() => {});
        });
    }
    if (elements.libraryInferMetadataBtn) {
        elements.libraryInferMetadataBtn.addEventListener('click', () => {
            refreshLibraryMetadataCache({
                cleanBrokenChars: true,
                inferFromFilename: true
            }).catch(() => {});
        });
    }
    if (includeVideoClear && elements.libraryClearVideoLibrary) {
        elements.libraryClearVideoLibrary.addEventListener('click', clearSavedVideoLibraryFromSettings);
        elements.libraryClearVideoLibrary.dataset.boundLibraryClear = '1';
    }
}

function updateLibraryHeroOverview() {
    const stats = state.libraryStats || {};
    const diagnostics = getLibraryDiagnosticsState();
    const folderCount = getAudioLibraryIndex()?.folderCount ?? loadSavedFolders('audio').length;

    if (elements.libraryHeroTotalSongs) {
        elements.libraryHeroTotalSongs.textContent = String(stats.totalSongs ?? '-');
    }
    if (elements.libraryHeroTotalDuration) {
        elements.libraryHeroTotalDuration.textContent = stats.totalDurationSec != null
            ? formatLibraryDuration(stats.totalDurationSec)
            : '-';
    }
    if (elements.libraryHeroFolderCount) {
        elements.libraryHeroFolderCount.textContent = String(folderCount);
    }
    if (elements.libraryHeroLastScan) {
        elements.libraryHeroLastScan.textContent = diagnostics.lastScanAt
            ? formatLibraryTimestamp(diagnostics.lastScanAt)
            : '-';
    }
}

function shouldRefreshLibraryStatsUi() {
    const settingsVisible = !!elements.settingsPage && !elements.settingsPage.classList.contains('hidden');
    const activeLibraryTab = document.querySelector('.settings-tab.active')?.dataset?.tab === 'library';
    return settingsVisible && activeLibraryTab;
}

function scheduleLibraryStatsRefresh(options = {}) {
    const { force = false, delayMs = 180 } = options;
    if (libraryStatsRuntime.refreshTimer) {
        clearTimeout(libraryStatsRuntime.refreshTimer);
        libraryStatsRuntime.refreshTimer = null;
    }
    libraryStatsRuntime.refreshTimer = setTimeout(() => {
        libraryStatsRuntime.refreshTimer = null;
        const run = () => {
            refreshLibraryStats({ force }).catch(() => {});
        };
        if (typeof window.requestIdleCallback === 'function') {
            window.requestIdleCallback(() => run(), { timeout: 900 });
            return;
        }
        setTimeout(run, 0);
    }, Math.max(0, Number(delayMs) || 0));
}

// ============================================
// OLAY DİNLEYİCİLERİ
// ============================================
function setupEventListeners() {
    // Kenar çubuğu Gezinti
    elements.sidebarBtns.forEach(btn => {
        btn.addEventListener('click', () => handleSidebarClick(btn));
    });

    if (elements.settingsBtn) elements.settingsBtn.addEventListener('click', () => openSettings('playback'));
    if (elements.infoBtn) elements.infoBtn.addEventListener('click', showAbout);
    if (elements.adblockBtn) {
        elements.adblockBtn.addEventListener('click', async () => {
            await openAdblockDashboardPanel();
        });
    }
    if (elements.adblockStatusText) {
        const openAdblockPanelFromStatus = async () => {
            await openAdblockDashboardPanel();
        };
        elements.adblockStatusText.addEventListener('click', openAdblockPanelFromStatus);
        elements.adblockStatusText.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                openAdblockPanelFromStatus();
            }
        });
    }
    if (elements.pulseQuickListenBtn) {
        elements.pulseQuickListenBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            await togglePulseQuickListen();
        });
    }
    if (elements.aboutCloseBtn) elements.aboutCloseBtn.addEventListener('click', closeAboutModal);
    if (elements.aboutGithubBtn) {
        elements.aboutGithubBtn.addEventListener('click', async () => {
            const url = 'https://github.com/muhammed-aurivo-dev/Aurivo-Medya-Player-Linux';
            try {
                if (window.aurivo?.webSecurity?.openExternal) {
                    await window.aurivo.webSecurity.openExternal(url);
                } else {
                    window.open(url, '_blank', 'noopener');
                }
            } catch (e) {
                console.error('[About] GitHub link açılamadı:', e);
            }
        });
    }
    if (elements.aboutModalOverlay) {
        elements.aboutModalOverlay.addEventListener('click', (e) => {
            if (e.target === elements.aboutModalOverlay) closeAboutModal();
        });
    }

    // Yeniden başlatma modalı (dil)
    if (elements.restartModalClose) elements.restartModalClose.addEventListener('click', closeRestartModal);
    if (elements.restartModalNo) elements.restartModalNo.addEventListener('click', closeRestartModal);
    if (elements.restartModalYes) {
        elements.restartModalYes.addEventListener('click', confirmAndRelaunchApp);
    }
    if (elements.restartModalOverlay) {
        elements.restartModalOverlay.addEventListener('click', (e) => {
            if (e.target === elements.restartModalOverlay) closeRestartModal();
        });
    }
    if (elements.uiVisualModeSelect) elements.uiVisualModeSelect.addEventListener('change', previewAppearanceSettingsFromUI);
    if (elements.uiFollowSystemThemeToggle) elements.uiFollowSystemThemeToggle.addEventListener('change', previewAppearanceSettingsFromUI);
    if (elements.themeSelect) {
        elements.themeSelect.addEventListener('change', () => {
            if (elements.uiFollowSystemThemeToggle?.checked) {
                // Sistem teması takibi açıkken manuel tema seçimini engelle.
                const lockedTheme = String(
                    state.settings?.appearance?.theme
                    || elements.themeSelect?.value
                    || 'aur-renk-efektleri'
                );
                elements.themeSelect.value = lockedTheme;
                updateThemeFollowSystemUi();
                return;
            }
            previewAppearanceSettingsFromUI();
        });
    }
    if (elements.uiFxEnabledToggle) elements.uiFxEnabledToggle.addEventListener('change', previewAppearanceSettingsFromUI);
    if (elements.uiReduceMotionToggle) elements.uiReduceMotionToggle.addEventListener('change', previewAppearanceSettingsFromUI);
    if (elements.sliderFxToggle) {
        const onSliderFxToggleChanged = () => {
            updateSliderFxToggleStateUi();
            previewAppearanceSettingsFromUI();
            markSettingsDirty();
        };
        elements.sliderFxToggle.addEventListener('change', onSliderFxToggleChanged);
        elements.sliderFxToggle.addEventListener('input', onSliderFxToggleChanged);
    }
    if (elements.sfxLightsToggle) {
        elements.sfxLightsToggle.addEventListener('change', () => {
            updateSfxLightsToggleStateUi();
            previewAppearanceSettingsFromUI();
            markSettingsDirty();
        });
    }
    if (elements.behaviorRememberLastSection && elements.libraryRememberSection) {
        elements.behaviorRememberLastSection.addEventListener('change', () => {
            elements.libraryRememberSection.checked = !!elements.behaviorRememberLastSection.checked;
        });
        elements.libraryRememberSection.addEventListener('change', () => {
            elements.behaviorRememberLastSection.checked = !!elements.libraryRememberSection.checked;
        });
    }
    if (elements.behaviorStartupPage && elements.libraryStartupPage) {
        elements.behaviorStartupPage.addEventListener('change', () => {
            elements.libraryStartupPage.value = String(elements.behaviorStartupPage.value || 'music');
        });
        elements.libraryStartupPage.addEventListener('change', () => {
            elements.behaviorStartupPage.value = String(elements.libraryStartupPage.value || 'music');
        });
    }

    // Web Platformları
    elements.platformBtns.forEach(btn => {
        btn.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            requestPlatformSwitch(btn);
        });
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            requestPlatformSwitch(btn);
        });
    });

    // DOSYA AĞACI - Olay Devri (ÖNEMLİ!)
    if (elements.fileTree) {
        elements.fileTree.addEventListener('click', handleFileTreeClick);
        elements.fileTree.addEventListener('dblclick', handleFileTreeDblClick);
        elements.fileTree.addEventListener('contextmenu', handleFileTreeContextMenu);
        // Fareyle sürükleyerek seçim yaparken HTML sürükle-bırak başlatma
        elements.fileTree.addEventListener('dragstart', (e) => {
            if (!blockFileTreeDragStart) return;
            e.preventDefault();
            e.stopPropagation();
        }, true);
    }

    // Global yedek: click'leri yakala (DOM değişiminde kaybolmasın)
    document.addEventListener('click', handleFileTreeClickGlobal, true);
    document.addEventListener('dblclick', handleFileTreeDblClickGlobal, true);
    document.addEventListener('contextmenu', handleNowPlayingContextMenu, true);

    // Klasör bağlam menüsü dışına tıklanınca kapat
    document.addEventListener('click', (e) => {
        const menu = document.getElementById('folderContextMenu');
        if (menu) menu.classList.add('hidden');
        const playlistMenu = document.getElementById('playlistContextMenu');
        if (playlistMenu && !playlistMenu.contains(e.target)) hidePlaylistContextMenu();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') hidePlaylistContextMenu();
    });

    // Gezinti
    elements.backBtn.addEventListener('click', navigateBack);
    elements.forwardBtn.addEventListener('click', navigateForward);
    elements.refreshBtn.addEventListener('click', refreshCurrentView);
    if (elements.webDrawerToggleBtn) {
        elements.webDrawerToggleBtn.addEventListener('click', () => {
            if (!isPageVisible(elements.webPage)) return;
            setWebDrawerCollapsed(!state.webDrawerCollapsed);
        });
    }

    // Oynatıcı Kontrolleri
    if (elements.clearPlaylistBtn) {
        elements.clearPlaylistBtn.addEventListener('click', clearPlaylistAll);
    }
    elements.playPauseBtn.addEventListener('click', togglePlayPause);
    elements.prevBtn.addEventListener('click', () => playPreviousWithCrossfade());
    elements.nextBtn.addEventListener('click', () => playNextWithCrossfade());
    elements.shuffleBtn.addEventListener('click', toggleShuffle);
    elements.repeatBtn.addEventListener('click', toggleRepeat);
    elements.rewindBtn.addEventListener('click', () => seekBy(-getPlaybackSeekStepSeconds()));
    elements.forwardSeekBtn.addEventListener('click', () => seekBy(getPlaybackSeekStepSeconds()));


    // Müzik/Video araç çubuğu düğmeleri (kullanıcı hızlı ekleme)
    if (elements.musicAddFolderBtn) {
        elements.musicAddFolderBtn.addEventListener('click', async () => {
            try {
                state.mediaFilter = 'audio';
                const res = await window.aurivo?.dialog?.openFolder?.({
                    title: 'Müzik klasörü seç',
                    defaultPath: state.specialPaths?.music || undefined
                });
                if (res?.path) await addUserFolder(res.path, res.name || window.aurivo?.path?.basename?.(res.path) || 'Klasör', 'audio');
            } catch (e) {
                safeNotify('Klasör seçilemedi: ' + (e?.message || e), 'error');
            }
        });
    }

    if (elements.musicAddFilesBtn) {
        elements.musicAddFilesBtn.addEventListener('click', (event) => {
            showLibraryAddMenu(event.currentTarget || event.target, 'audio');
        });
    }

    if (elements.videoAddFolderBtn) {
        elements.videoAddFolderBtn.addEventListener('click', async () => {
            try {
                state.mediaFilter = 'video';
                const res = await window.aurivo?.dialog?.openFolder?.({
                    title: 'Video klasörü seç',
                    defaultPath: state.specialPaths?.videos || undefined
                });
                if (res?.path) await addUserFolder(res.path, res.name || window.aurivo?.path?.basename?.(res.path) || 'Klasör', 'video');
            } catch (e) {
                safeNotify('Klasör seçilemedi: ' + (e?.message || e), 'error');
            }
        });
    }

    if (elements.videoAddFilesBtn) {
        elements.videoAddFilesBtn.addEventListener('click', async () => {
            try {
                state.mediaFilter = 'video';
                const files = await window.aurivo?.dialog?.openFiles?.({
                    title: 'Video dosyalarını seç',
                    filters: [
                        { name: 'Video Dosyaları', extensions: getConfiguredLibraryExtensions('video') },
                        { name: 'Tüm Dosyalar', extensions: ['*'] }
                    ]
                });
                if (!files || !files.length) return;

                state.videoFiles = files.map((f) => ({ name: f.name, path: f.path }));
                persistVideoLibrary();
                state.currentPath = '';
                renderVideoLibraryTree();
                playVideo(state.videoFiles[0].path);
            } catch (e) {
                safeNotify('Video seçilemedi: ' + (e?.message || e), 'error');
            }
        });
    }

    // Görselleştirici (projectM)
    const visualizerBtn = document.getElementById('visualizer-btn');
    if (visualizerBtn) {
        visualizerBtn.addEventListener('click', () => {
            if (window.app && window.app.visualizer && typeof window.app.visualizer.toggle === 'function') {
                window.app.visualizer.toggle();
            } else {
                console.warn('Visualizer API yok (window.app.visualizer.toggle)');
            }
        });
    }

    // Ses Seviyesi
    elements.volumeBtn.addEventListener('click', toggleMute);
    elements.volumeSlider.addEventListener('input', handleVolumeChange);

    // Atlama - tek tıkla pozisyon ayarlama
    elements.seekSlider.addEventListener('input', handleSeek);
    elements.seekSlider.addEventListener('click', handleSeekClick);
    elements.seekSlider.addEventListener('wheel', handleSeekWheel, { passive: false });

    // Ses Seviyesi kaydırıcısı - tekerlek ile ayarlama (5 kademeli)
    elements.volumeSlider.addEventListener('wheel', handleVolumeWheel);

    // Ses Olayları - Her iki oynatıcı için de olay dinleyici ekle
    setupAudioPlayerEvents(elements.audioA, 'A');
    setupAudioPlayerEvents(elements.audioB, 'B');

    // Video Oynatıcı Olayları
    setupVideoPlayerEvents();

    // Video kontrol düğmeleri
    const fullscreenBtn = document.getElementById('fullscreenBtn');
    const videoMenuBtn = document.getElementById('videoMenuBtn');

    if (fullscreenBtn) {
        fullscreenBtn.addEventListener('click', toggleVideoFullscreen);
    }

    if (videoMenuBtn) {
        videoMenuBtn.addEventListener('click', showVideoMenu);
    }

    // Video oynatıcı çift tıklama - tam ekran
    if (elements.videoPlayer) {
        elements.videoPlayer.addEventListener('dblclick', toggleVideoFullscreen);
    }

    // TAM EKRAN VIDEO KONTROL PANELİ - Olay Dinleyicileri
    setupFullscreenVideoControls();

    // Ayarlar (uygulama içi sayfa)
    if (elements.closeSettings) elements.closeSettings.addEventListener('click', closeSettings);
    if (elements.settingsCancel) elements.settingsCancel.addEventListener('click', closeSettings);
    if (elements.settingsResetCurrentTab) elements.settingsResetCurrentTab.addEventListener('click', resetCurrentSettingsTab);
    if (elements.settingsOk) {
        elements.settingsOk.addEventListener('click', async () => {
            try {
                const activeTab = getActiveSettingsTabName();
                const shouldPromptLanguageRestart = hasPendingLanguageChange();
                await applySettings();
                if (shouldPromptLanguageRestart) {
                    showRestartHint();
                    openRestartModal();
                    return;
                }
                hideRestartHint();
                const recMode = String(elements.pulseRecognitionEngine?.value || 'hybrid').trim().toLowerCase();
                const hasAcoustidKey = String(elements.pulseAcoustidApiKey?.value || '').trim().length > 0;
                if (recMode === 'acoustid_only' && !hasAcoustidKey) {
                    safeNotify('Sadece AcoustID secili ama API key bos. Anahtar eklenmezse tanima calismaz.', 'warning', 2600);
                    return;
                }
                safeNotify(
                    uiT('settings.notify.savedNamed', '{tab} ayarları kaydedildi.', {
                        tab: getSettingsTabLabel(activeTab)
                    }),
                    'success',
                    1800
                );
            } catch (error) {
                console.error('[SETTINGS] save failed:', error);
            }
        });
    }

    if (!state.__libraryAddMenuBindings) {
        state.__libraryAddMenuBindings = true;
        document.addEventListener('click', (event) => {
            const menu = document.getElementById('libraryAddMenu');
            if (!menu) return;
            const trigger = event.target?.closest?.('#musicAddFilesBtn, #libraryHeroAddFolderBtn');
            if (trigger) return;
            if (!menu.contains(event.target)) {
                hideLibraryAddMenu();
            }
        });
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                hideLibraryAddMenu();
            }
        });
        window.addEventListener('resize', hideLibraryAddMenu);
        window.addEventListener('blur', hideLibraryAddMenu);
    }

    if (elements.settingsTabs && elements.settingsTabs.length) {
        elements.settingsTabs.forEach(tab => {
            tab.addEventListener('click', () => switchSettingsTab(tab));
        });
    }

    if (elements.resetPlayback) elements.resetPlayback.addEventListener('click', resetPlaybackDefaults);
    if (elements.resetListen) elements.resetListen.addEventListener('click', resetListenDefaults);
    if (elements.pulseQuickMode) elements.pulseQuickMode.addEventListener('change', updatePulseQuickModeUi);
    if (elements.pulseRecognitionEngine) elements.pulseRecognitionEngine.addEventListener('change', updateRecognitionEngineUi);
    if (elements.pulseAcoustidApiKey) elements.pulseAcoustidApiKey.addEventListener('input', updateRecognitionEngineUi);
    if (elements.pulseQuickModeCards?.length) {
        elements.pulseQuickModeCards.forEach((card) => {
            card.addEventListener('click', () => {
                const mode = String(card.dataset.pulseQuickMode || '').trim().toLowerCase();
                if (!elements.pulseQuickMode || !['normal', 'background', 'max'].includes(mode)) return;
                elements.pulseQuickMode.value = mode;
                updatePulseQuickModeUi();
            });
        });
    }
    if (elements.audioDefaultVolume) {
        elements.audioDefaultVolume.addEventListener('input', async () => {
            window.AurivoSettingsShared?.updateAudioSettingsVolumeLabel?.(elements);
            const prefs = getAudioOutputSettings();
            if (prefs.followSystemVolume && state.systemAudio?.supported) {
                await applyAudioSettingsSliderToSystem(Number(elements.audioDefaultVolume.value));
            }
        });
    }
    if (elements.audioAppVolume) {
        elements.audioAppVolume.addEventListener('input', () => {
            window.AurivoSettingsShared?.updateAudioAppVolumeLabel?.(elements);
            setAppMasterVolume(Number(elements.audioAppVolume.value), { persist: true, syncSettingsSlider: false });
        });
    }
    if (elements.audioLoudnessEnabled) {
        elements.audioLoudnessEnabled.addEventListener('change', async () => {
            getAudioOutputSettings().loudnessEnabled = !!elements.audioLoudnessEnabled.checked;
            await applyLoudnessNormalizationToEngine();
            saveSettings().catch(() => { });
        });
    }
    if (elements.audioLoudnessMode) {
        elements.audioLoudnessMode.addEventListener('change', async () => {
            getAudioOutputSettings().loudnessMode = String(elements.audioLoudnessMode.value || 'balanced').toLowerCase();
            await applyLoudnessNormalizationToEngine();
            saveSettings().catch(() => { });
        });
    }
    if (elements.audioLimiterEnabled) {
        elements.audioLimiterEnabled.addEventListener('change', async () => {
            getAudioOutputSettings().limiterEnabled = !!elements.audioLimiterEnabled.checked;
            await applyLimiterProtectionToEngine();
            saveSettings().catch(() => { });
        });
    }
    if (elements.audioLimiterMode) {
        elements.audioLimiterMode.addEventListener('change', async () => {
            getAudioOutputSettings().limiterMode = String(elements.audioLimiterMode.value || 'balanced').toLowerCase();
            await applyLimiterProtectionToEngine();
            saveSettings().catch(() => { });
        });
    }
    if (elements.audioNightModeEnabled) {
        elements.audioNightModeEnabled.addEventListener('change', async () => {
            getAudioOutputSettings().nightModeEnabled = !!elements.audioNightModeEnabled.checked;
            await applyNightModeToEngine();
            saveSettings().catch(() => { });
        });
    }
    if (elements.audioNightModeLevel) {
        elements.audioNightModeLevel.addEventListener('change', async () => {
            getAudioOutputSettings().nightModeLevel = String(elements.audioNightModeLevel.value || 'balanced').toLowerCase();
            await applyNightModeToEngine();
            saveSettings().catch(() => { });
        });
    }
    if (elements.audioProfileCards?.length) {
        elements.audioProfileCards.forEach((card) => {
            card.addEventListener('click', async () => {
                await applyAudioProfile(card.dataset.audioProfile, { persist: true });
            });
        });
    }
    if (elements.audioSpatialCards?.length) {
        elements.audioSpatialCards.forEach((card) => {
            card.addEventListener('click', async () => {
                await applySpatialAudioMode(card.dataset.audioSpatial, { persist: true });
            });
        });
    }
    if (elements.audioVideoDelay) {
        elements.audioVideoDelay.addEventListener('input', () => {
            if (!state.settings) state.settings = {};
            if (!state.settings.videoFullscreen || typeof state.settings.videoFullscreen !== 'object') {
                state.settings.videoFullscreen = {};
            }
            state.settings.videoFullscreen.audioDelayMs = Math.max(0, Math.min(500, Number(elements.audioVideoDelay.value) || 0));
            updateAudioVideoDelayUi();
            applyFsAudioDelay(state.settings.videoFullscreen.audioDelayMs);
            saveSettings().catch(() => { });
        });
    }
    if (elements.audioVideoDelayReset) {
        elements.audioVideoDelayReset.addEventListener('click', () => {
            if (!state.settings) state.settings = {};
            if (!state.settings.videoFullscreen || typeof state.settings.videoFullscreen !== 'object') {
                state.settings.videoFullscreen = {};
            }
            state.settings.videoFullscreen.audioDelayMs = 0;
            updateAudioVideoDelayUi();
            applyFsAudioDelay(0);
            saveSettings().catch(() => { });
        });
    }
    if (elements.audioFollowSystemVolume) {
        elements.audioFollowSystemVolume.addEventListener('change', async () => {
            getAudioOutputSettings().followSystemVolume = !!elements.audioFollowSystemVolume.checked;
            await refreshSystemAudioState();
            applySystemAudioStateToUi();
            saveSettings().catch(() => { });
        });
    }
    if (elements.audioRefreshState) {
        elements.audioRefreshState.addEventListener('click', async () => {
            setAudioRefreshBusy(true);
            try {
                await refreshSystemAudioState();
                applySystemAudioStateToUi();
            } finally {
                setTimeout(() => setAudioRefreshBusy(false), 180);
            }
        });
    }
    if (elements.audioOutputSelect) {
        elements.audioOutputSelect.addEventListener('change', async () => {
            const outputId = String(elements.audioOutputSelect.value || '').trim();
            if (!outputId || !window.aurivo?.systemAudio?.setOutput) return;
            elements.audioOutputSelect.disabled = true;
            try {
                const result = await window.aurivo.systemAudio.setOutput(outputId);
                if (result?.success && result?.state) {
                    state.systemAudio = {
                        ...state.systemAudio,
                        ...result.state
                    };
                }
                await refreshSystemAudioState();
                applySystemAudioStateToUi();
            } catch {
                // yoksay
            } finally {
                elements.audioOutputSelect.disabled = false;
            }
        });
    }
    if (elements.audioAllowOverdrive150) {
        elements.audioAllowOverdrive150.addEventListener('click', async () => {
            const nextEnabled = !getAudioOverdriveButtonState();
            setAudioOverdriveButtonState(nextEnabled);
            getAudioOutputSettings().allowOverdrive150 = nextEnabled;
            if (window.aurivo?.systemAudio?.setAllowOverdrive && state.systemAudio?.supported) {
                try {
                    const result = await window.aurivo.systemAudio.setAllowOverdrive(nextEnabled);
                    if (result?.success && result?.state) {
                        state.systemAudio = {
                            ...state.systemAudio,
                            ...result.state
                        };
                    }
                } catch {
                    // yoksay
                }
            }
            applySystemAudioStateToUi();
            const prefs = getAudioOutputSettings();
            if (prefs.followSystemVolume && state.systemAudio?.supported && Number.isFinite(state.systemAudio?.volumePercent)) {
                updateAudioSettingsSliderUi(state.systemAudio.volumePercent);
            }
            saveSettings().catch(() => { });
        });
    }
    bindLibrarySettingsEventListeners({ includeVideoClear: true });
    if (elements.adblockModeCards && elements.adblockModeCards.length) {
        elements.adblockModeCards.forEach((card) => {
            card.addEventListener('click', () => setAdblockMode(card.dataset.adblockMode));
        });
    }
    if (elements.adblockShowBlockedCount) {
        elements.adblockShowBlockedCount.addEventListener('change', () => {
            readAdblockSettingsFromUI();
            updateAdblockBadge(adblockRuntime.lastBlocked);
        });
    }
    if (elements.adblockAutoRefreshOnModeChange) {
        elements.adblockAutoRefreshOnModeChange.addEventListener('change', () => {
            readAdblockSettingsFromUI();
        });
    }
    if (elements.adblockOpenDashboardBtn) {
        elements.adblockOpenDashboardBtn.addEventListener('click', () => {
            openAdblockDashboardPanel();
        });
    }

    // Çapraz Geçiş Otomatik onay kutusu bağımlılığı
    const crossfadeAuto = document.getElementById('crossfadeAuto');
    const sameAlbumNo = document.getElementById('sameAlbumNoCrossfade');
    if (crossfadeAuto && sameAlbumNo) {
        crossfadeAuto.addEventListener('change', () => {
            sameAlbumNo.disabled = !crossfadeAuto.checked;
        });
    }
    const restoreLastTrackOnStartup = document.getElementById('restoreLastTrackOnStartup');
    const autoplayLastTrackOnStartup = document.getElementById('autoplayLastTrackOnStartup');
    const resumePositionOnStartup = document.getElementById('resumePositionOnStartup');
    const syncStartupRestoreUi = () => {
        const enabled = !!restoreLastTrackOnStartup?.checked;
        if (autoplayLastTrackOnStartup) autoplayLastTrackOnStartup.disabled = !enabled;
        if (resumePositionOnStartup) resumePositionOnStartup.disabled = !enabled;
    };
    if (restoreLastTrackOnStartup) {
        restoreLastTrackOnStartup.addEventListener('change', syncStartupRestoreUi);
        syncStartupRestoreUi();
    }
    const endWarningEnabled = document.getElementById('endWarningEnabled');
    const endWarningSeconds = document.getElementById('endWarningSeconds');
    const syncEndWarningUi = () => {
        if (endWarningSeconds) endWarningSeconds.disabled = !endWarningEnabled?.checked;
    };
    if (endWarningEnabled) {
        endWarningEnabled.addEventListener('change', syncEndWarningUi);
        syncEndWarningUi();
    }
    const smartVolumeLevelingEnabled = document.getElementById('smartVolumeLevelingEnabled');
    const smartVolumeLevelingMode = document.getElementById('smartVolumeLevelingMode');
    const syncSmartLevelingUi = () => {
        if (smartVolumeLevelingMode) smartVolumeLevelingMode.disabled = !smartVolumeLevelingEnabled?.checked;
    };
    if (smartVolumeLevelingEnabled) {
        smartVolumeLevelingEnabled.addEventListener('change', syncSmartLevelingUi);
        syncSmartLevelingUi();
    }

    // Klavye Kısayolları
    document.addEventListener('keydown', handleKeyboard);

    // Sürükle & Bırak - geliştirilmiş
    setupDragAndDrop();

    // İndirme UI

    // Güvenlik UI
    setupSecurityUI();
    startAdblockStatsPolling();

    // WebView Gezinti Olayları (YouTube parça değişimi tespiti)
    if (elements.webView) {
        elements.webView.addEventListener('did-start-loading', () => {
            showWebLoadingOverlay('Sayfa yükleniyor...');
            // Yeni yükleme başladığında eski retry sayacını temizle
            const u = getWebViewUrlSafe();
            if (u && u !== 'about:blank') webLoadRuntime.retryMap.delete(u);
        });
        elements.webView.addEventListener('did-stop-loading', () => {
            hideWebLoadingOverlay();
        });
        elements.webView.addEventListener('did-finish-load', () => {
            hideWebLoadingOverlay();
        });

        elements.webView.addEventListener('did-navigate', handleWebNavigation);
        elements.webView.addEventListener('did-navigate-in-page', handleWebNavigation);
        elements.webView.addEventListener('did-fail-load', (e) => {
            try {
                const code = Number(e?.errorCode);
                const url = String(e?.validatedURL || '').trim();
                const desc = String(e?.errorDescription || '').trim();
                const isMainFrame = e?.isMainFrame !== false;

                // Boş veya iptal edilen navigasyonlarda gürültü yapma
                if (!isMainFrame || !url || url === 'about:blank') return;
                if (code === -3) return; // ERR_ABORTED

                const transientCodes = new Set([-2, -6, -7, -21, -105, -106, -118, -137, -202]);
                const retryCount = Number(webLoadRuntime.retryMap.get(url) || 0);

                console.warn('[WEBVIEW] did-fail-load:', { code, desc, url, retryCount });

                if (transientCodes.has(code) && retryCount < 1 && isAllowedWebUrl(url)) {
                    webLoadRuntime.retryMap.set(url, retryCount + 1);
                    setTimeout(() => {
                        safeNavigateWebView(url);
                    }, 700);
                    return;
                }

                safeNotify(`Web sayfası yüklenemedi (${code}).`, 'error', 2600);
                hideWebLoadingOverlay();
            } catch {
                // yoksay
            }
        });
        elements.webView.addEventListener('new-window', (e) => {
            const target = e?.url;
            const parsed = parseHttpUrl(target);
            if (!parsed) return;
            if (!isAllowedWebUrl(parsed.toString())) return;

            // OAuth/login akışları popup ile çalışır; popup izni açıksa pencereyi engelleme.
            const popupsEnabled = !!elements.webView?.hasAttribute?.('allowpopups');
            if (popupsEnabled) return;

            e.preventDefault();
            safeNavigateWebView(parsed.toString());
        });

        // Web Senkron Dinleyici (YouTube olaylarını yakala)
        elements.webView.addEventListener('console-message', (e) => {
            if (e.message.startsWith('AURIVO_SYNC:')) {
                try {
                    const data = JSON.parse(e.message.replace('AURIVO_SYNC:', ''));
                    handleWebSync(data);
                } catch (err) { console.error('Sync parse error', err); }
                return;
            }
        });

        // WebView Senkron: MediaSession/Video bilgilerini yakala (MPRIS + kapak + web şimdi-çalıyor için).
        // Not: Bazı Chromium sürümlerinde navigator.mediaSession override edilemez (non-configurable).
        // Bu yüzden "disable" yerine güvenli polling + event dinleme ile AURIVO_SYNC mesajları üretiyoruz.
        elements.webView.addEventListener('dom-ready', () => {
            try {
                elements.webView.setUserAgent(getEmbeddedDesktopUserAgent());
            } catch { }
            const currentUrl = getWebViewUrlSafe();
            if (!shouldInjectWebSync(currentUrl)) {
                return;
            }
            const webAdblockConfig = getAdblockWebModeProfile();
            elements.webView.executeJavaScript(`
                try {
                    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
                    if (!window.chrome) window.chrome = { runtime: {} };
                    (function() {
                        const DELIBLOCK = ${JSON.stringify(webAdblockConfig)};
                        const send = (payload) => {
                            try { console.log('AURIVO_SYNC:' + JSON.stringify(payload)); } catch(e) {}
                        };

                        let lastMetaKey = '';
                        let lastTimeKey = '';
                        let lastVolumeKey = '';
                        let lastMedia = null;
                        let ytAdStyleInjected = false;
                        let adShieldEl = null;

                        function isYouTubeHost() {
                            try {
                                const h = String(location.hostname || '').toLowerCase();
                                return h.endsWith('youtube.com') || h.endsWith('youtube-nocookie.com') || h === 'youtu.be';
                            } catch { return false; }
                        }

                        function ensureYouTubeAdCss() {
                            if (!isYouTubeHost() || ytAdStyleInjected) return;
                            const style = document.createElement('style');
                            style.id = 'aurivo-deliblock-yt-css';
                            style.textContent = [
                                '.ytp-ad-overlay-container, .ytp-ad-overlay-slot { display: none !important; }',
                                '.ytd-display-ad-renderer, ytd-promoted-sparkles-web-renderer, ytd-player-legacy-desktop-watch-ads-renderer { display: none !important; }',
                                'ytd-promoted-video-renderer, ytd-ad-slot-renderer, ytd-in-feed-ad-layout-renderer, ytd-video-masthead-ad-v3-renderer, ytd-banner-promo-renderer, ytd-companion-slot-renderer { display: none !important; }',
                                '#player-ads, .ytp-ad-player-overlay, .ytp-ad-module { display: none !important; }',
                                '#movie_player.ad-showing video.html5-main-video, #movie_player.ad-interrupting video.html5-main-video { visibility: hidden !important; }',
                                '#movie_player.ad-showing .ytp-chrome-bottom, #movie_player.ad-showing .ytp-progress-bar-container, #movie_player.ad-showing .ytp-scrubber-container, #movie_player.ad-showing .ytp-cued-thumbnail-overlay-image, #movie_player.ad-showing .ytp-ad-player-overlay-progress-bar, #movie_player.ad-showing .ytp-ad-progress { visibility: hidden !important; opacity: 0 !important; }',
                                '#aurivo-deliblock-adshield { position:absolute; inset:0; display:none; z-index:2147483646; align-items:center; justify-content:center; pointer-events:none; background:radial-gradient(circle at 50% 42%, rgba(7,24,38,.84), rgba(3,10,20,.94)); color:#dff4ff; font:600 13px sans-serif; }',
                                '#aurivo-deliblock-adshield .panel { min-width:220px; max-width:320px; border-radius:14px; border:1px solid rgba(108,200,255,.32); background:linear-gradient(140deg, rgba(8,25,40,.88), rgba(8,18,30,.9)); box-shadow:0 12px 28px rgba(0,0,0,.45), inset 0 0 0 1px rgba(31,102,160,.22); padding:12px 14px; display:flex; align-items:center; gap:10px; }',
                                '#aurivo-deliblock-adshield .spin { width:22px; height:22px; border:2px solid rgba(120,205,255,.35); border-top-color:rgba(120,205,255,.98); border-radius:50%; animation:aurivoShieldSpin .8s linear infinite; flex:0 0 auto; }',
                                '#aurivo-deliblock-adshield .title { font-weight:700; font-size:13px; color:#e7f6ff; }',
                                '#aurivo-deliblock-adshield .sub { font-size:11px; color:rgba(170,212,236,.92); margin-top:2px; }',
                                '@keyframes aurivoShieldSpin { to { transform: rotate(360deg);} }'
                            ].join('\\n');
                            (document.head || document.documentElement).appendChild(style);
                            ytAdStyleInjected = true;
                        }

                        function ensurePlayerShield(movie) {
                            if (!movie || adShieldEl) return;
                            adShieldEl = document.createElement('div');
                            adShieldEl.id = 'aurivo-deliblock-adshield';
                            adShieldEl.innerHTML = '<div class="panel"><div class="spin"></div><div><div class="title">uDaliBlock on kontrol</div><div class="sub">Reklam istekleri taraniyor, icerik hazirlaniyor...</div></div></div>';
                            movie.style.position = movie.style.position || 'relative';
                            movie.appendChild(adShieldEl);
                        }

                        function isPulseSearchBypassActive() {
                            try {
                                return Number(window.__aurivoPulseSearchBypassUntil || 0) > Date.now();
                            } catch { return false; }
                        }

                        function setPlayerShieldVisible(visible) {
                            if (!adShieldEl) return;
                            if (isPulseSearchBypassActive()) {
                                adShieldEl.style.display = 'none';
                                return;
                            }
                            adShieldEl.style.display = visible ? 'flex' : 'none';
                        }

                        function installYouTubePreflightClickGuard() {
                            if (!isYouTubeHost()) return;
                            if (window.__aurivoPreflightGuardInstalled) return;
                            window.__aurivoPreflightGuardInstalled = true;
                            document.addEventListener('click', (ev) => {
                                try {
                                    const target = ev && ev.target;
                                    if (!target || !target.closest) return;
                                    const link = target.closest('a[href*="/watch"], a[href^="/watch"], a[href*="youtu.be/"]');
                                    if (!link) return;
                                    if (isPulseSearchBypassActive()) return;
                                    const href = String(link.getAttribute('href') || '');
                                    if (!href) return;
                                    if (href.startsWith('#')) return;
                                    if (ev.ctrlKey || ev.metaKey || ev.shiftKey || ev.altKey) return;
                                    const movie = document.getElementById('movie_player');
                                    if (!movie) return;

                                    ensurePlayerShield(movie);
                                    if (adShieldEl) {
                                        const title = adShieldEl.querySelector('.title');
                                        const sub = adShieldEl.querySelector('.sub');
                                        if (title) title.textContent = 'uDaliBlock on kontrol';
                                        if (sub) sub.textContent = 'Video acilmadan reklam istekleri taraniyor...';
                                    }
                                    setPlayerShieldVisible(true);

                                    ev.preventDefault();
                                    ev.stopPropagation();
                                    const nextUrl = new URL(href, location.href).toString();
                                    setTimeout(() => {
                                        try { location.assign(nextUrl); } catch {}
                                    }, 140);
                                } catch {}
                            }, true);
                        }

                        function hideContainer(node) {
                            if (!node || !node.closest) return;
                            const container = node.closest(
                                'ytd-rich-item-renderer, ytd-video-renderer, ytd-grid-video-renderer, ytd-compact-video-renderer, ytd-item-section-renderer'
                            );
                            if (container && container.style) {
                                container.style.display = 'none';
                            }
                        }

                        function scrubYouTubePromotedUi() {
                            if (!isYouTubeHost()) return;
                            if (!DELIBLOCK || (DELIBLOCK.uiScrubLevel | 0) <= 0) return;

                            // Yapısal reklam render'ları
                            const structural = document.querySelectorAll(
                                'ytd-ad-slot-renderer, ytd-promoted-video-renderer, ytd-in-feed-ad-layout-renderer, ytd-display-ad-renderer, ytd-promoted-sparkles-web-renderer, ytd-video-masthead-ad-v3-renderer, ytd-banner-promo-renderer, ytd-companion-slot-renderer'
                            );
                            structural.forEach((node) => hideContainer(node));

                            // "Sponsored / Sponsorlu" etiketli kartlar (dil bağımsız fallback)
                            const candidates = document.querySelectorAll(
                                'ytd-rich-item-renderer, ytd-video-renderer, ytd-grid-video-renderer, ytd-compact-video-renderer, ytd-watch-next-secondary-results-renderer, ytd-companion-slot-renderer'
                            );
                            candidates.forEach((card) => {
                                const txt = String(card.innerText || '').toLowerCase();
                                if (!txt) return;
                                if (!DELIBLOCK.deepSponsoredScan) return;
                                const hasSponsoredWord =
                                    txt.includes('sponsored') ||
                                    txt.includes('sponsorlu') ||
                                    txt.includes('advertisement') ||
                                    txt.includes('reklam');
                                if (!hasSponsoredWord) return;
                                hideContainer(card);
                                if (card.style) card.style.display = 'none';
                            });
                        }

                        function tickYouTubeAdSkip() {
                            if (!isYouTubeHost()) return;
                            ensureYouTubeAdCss();
                            installYouTubePreflightClickGuard();
                            scrubYouTubePromotedUi();
                            try {
                                const movie = document.getElementById('movie_player');
                                if (movie) ensurePlayerShield(movie);
                                const adShowing = !!(
                                    document.querySelector('.ad-showing, .ad-interrupting') ||
                                    (movie && movie.classList && (movie.classList.contains('ad-showing') || movie.classList.contains('ad-interrupting')))
                                );
                                setPlayerShieldVisible(isPulseSearchBypassActive() ? false : adShowing);

                                const skipBtn = document.querySelector(
                                    '.ytp-ad-skip-button, .ytp-ad-skip-button-modern, button.ytp-ad-skip-button-modern, .videoAdUiSkipButton'
                                );
                                if (skipBtn && typeof skipBtn.click === 'function') skipBtn.click();
                                if (movie && typeof movie.skipAd === 'function') movie.skipAd();
                                if (movie && typeof movie.skipVideo === 'function') movie.skipVideo();

                                const closeBtn = document.querySelector('.ytp-ad-overlay-close-button, .ytp-ad-image-overlay-close-button');
                                if (closeBtn && typeof closeBtn.click === 'function') closeBtn.click();

                                if (adShowing) {
                                    const media = document.querySelector('video.html5-main-video, video');
                                    if (media && Number.isFinite(media.duration) && media.duration > 0) {
                                        media.currentTime = Math.max(0, media.duration - 0.05);
                                    }
                                }
                            } catch {}
                        }

                        function getArtworkUrl(md) {
                            try {
                                const art = md && md.artwork;
                                if (!Array.isArray(art) || art.length === 0) return '';
                                const last = art[art.length - 1];
                                return (last && last.src) ? String(last.src) : '';
                            } catch { return ''; }
                        }

                        function emitMetadata(force) {
                            try {
                                const ms = navigator.mediaSession;
                                const md = ms && ms.metadata;
                                const title = (md && md.title) ? String(md.title) : (document.title || '');
                                const artist = (md && md.artist) ? String(md.artist) : '';
                                const album = (md && md.album) ? String(md.album) : '';
                                const artwork = md ? getArtworkUrl(md) : '';
                                const key = [title, artist, album, artwork].join('|');
                                if (!force && key === lastMetaKey) return;
                                lastMetaKey = key;
                                if (!title && !artist && !album) return;
                                send({ type: 'metadata', title, artist, album, artwork });
                            } catch(e) {}
                        }

                        function emitTime(force) {
                            const media = document.querySelector('video, audio');
                            if (!media) return;
                            try {
                                const ct = Number(media.currentTime) || 0;
                                const dur = Number(media.duration) || 0;
                                const paused = !!media.paused;
                                // 0.5s çözünürlük spam'i azaltır
                                const key = [Math.floor(ct * 2) / 2, Math.floor(dur), paused].join('|');
                                if (!force && key === lastTimeKey) return;
                                lastTimeKey = key;
                                send({ type: 'timeupdate', currentTime: ct, duration: dur, paused });
                            } catch(e) {}
                        }

                        function emitVolume(force) {
                            try {
                                const yt = document.getElementById('movie_player');
                                if (yt && typeof yt.getVolume === 'function') {
                                    const vPct = Number(yt.getVolume());
                                    const v = isNaN(vPct) ? 0 : Math.max(0, Math.min(100, vPct)) / 100;
                                    const muted = !!(typeof yt.isMuted === 'function' ? yt.isMuted() : false);
                                    const key = [Math.round(v * 100), muted ? 1 : 0, 'yt'].join('|');
                                    if (!force && key === lastVolumeKey) return;
                                    lastVolumeKey = key;
                                    send({ type: 'volume', volume: v, muted });
                                    return;
                                }

                                const media = document.querySelector('video.html5-main-video, video, audio');
                                if (!media) return;
                                const v = Number(media.volume) || 0;
                                const muted = !!media.muted;
                                const key = [Math.round(v * 100), muted ? 1 : 0].join('|');
                                if (!force && key === lastVolumeKey) return;
                                lastVolumeKey = key;
                                send({ type: 'volume', volume: v, muted });
                            } catch(e) {}
                        }

                        function attachEvents(media) {
                            if (!media || lastMedia === media) return;
                            lastMedia = media;

                            const sendUpdate = (type) => {
                                try {
                                    send({ type, currentTime: media.currentTime, duration: media.duration, paused: media.paused });
                                } catch(e) {}
                            };

                            media.addEventListener('play', () => sendUpdate('play'));
                            media.addEventListener('pause', () => sendUpdate('pause'));
                            media.addEventListener('seeked', () => sendUpdate('seeked'));
                            media.addEventListener('durationchange', () => sendUpdate('durationchange'));
                            media.addEventListener('loadeddata', () => sendUpdate('loadeddata'));
                            media.addEventListener('volumechange', () => emitVolume(false));

                            emitMetadata(true);
                            emitTime(true);
                            emitVolume(true);
                        }

                        const observer = new MutationObserver(() => {
                            const media = document.querySelector('video, audio');
                            if (media) attachEvents(media);
                            emitMetadata(false);
                            tickYouTubeAdSkip();
                        });
                        observer.observe(document.documentElement || document.body, { childList: true, subtree: true });

                        const media = document.querySelector('video, audio');
                        if (media) attachEvents(media);

                        setInterval(() => {
                            emitMetadata(false);
                            emitTime(false);
                            emitVolume(false);
                            tickYouTubeAdSkip();
                        }, Math.max(80, Number(DELIBLOCK && DELIBLOCK.tickIntervalMs) || 150));

                        emitMetadata(true);
                        emitTime(true);
                        emitVolume(true);
                        tickYouTubeAdSkip();
                    })();
                } catch(e) { console.error("AURIVO_SYNC error:", e); }
            `);
            setTimeout(() => {
                pushAppVolumeToWeb();
            }, 120);
        });
    }

    // Sistem Tepsisi Medya Kontrol Dinleyicisi
    setupSystemTrayControl();
}

function getWebViewUrlSafe() {
    try {
        return String(elements.webView?.getURL?.() || '').trim() || 'about:blank';
    } catch {
        return 'about:blank';
    }
}

function updatePulseQuickBtnUi() {
    if (!elements.pulseQuickListenBtn) return;
    const pulseMode = getPulseQuickModeConfig();
    const modeLabel = getPulseQuickModeLabel(pulseMode.mode);
    document.body?.classList?.toggle('pulse-motion-force', !!pulseQuickRuntime.searching);
    elements.pulseQuickListenBtn.classList.toggle('active', !!pulseQuickRuntime.running);
    elements.pulseQuickListenBtn.classList.toggle('searching', !!pulseQuickRuntime.searching);
    elements.pulseQuickListenBtn.title = pulseQuickRuntime.running
        ? (pulseQuickRuntime.searching
            ? `Aurivo-Pulse ${modeLabel}: Dinliyor... (aramaya devam ediyor)`
            : `Aurivo-Pulse ${modeLabel}: Açık (durdurmak için tıkla)`)
        : `Aurivo-Pulse ${modeLabel}: Kapalı (başlatmak için tıkla)`;
}

function clearPulseNoSignalHintTimer() {
    if (pulseQuickRuntime.noSignalHintTimer) {
        clearTimeout(pulseQuickRuntime.noSignalHintTimer);
        pulseQuickRuntime.noSignalHintTimer = null;
    }
}

function schedulePulseNoSignalHint() {
    clearPulseNoSignalHintTimer();
    pulseQuickRuntime.noSignalHintShown = false;
    const delayMs = getPulseQuickModeConfig().noSignalDelayMs;
    pulseQuickRuntime.noSignalHintTimer = setTimeout(() => {
        if (!pulseQuickRuntime.running || pulseQuickRuntime.stoppingAfterResult) return;
        const lastResult = Number(pulseQuickRuntime.lastResultAt || 0);
        const noResultYet = !lastResult || (Date.now() - lastResult) > 12000;
        if (!noResultYet || pulseQuickRuntime.noSignalHintShown) return;
        pulseQuickRuntime.noSignalHintShown = true;
        const pulseMode = getPulseQuickModeConfig();
        safeNotify(
            uiT(
                'pulseQuick.noSignalHint',
                'Henuz net bir eslesme bulamadim. Dinlemeye devam ediyorum; bilgisayarda muzik/video oynatimi acik kalsin.'
            ),
            'info',
            getPulseNoSignalHintToastMs()
        );
        if (pulseMode.mode === 'max') {
            Promise.resolve(tryPulseQuickSampleFallback()).catch(() => { });
        }
        // Bu sadece bilgilendirme; dinleme devam etsin.
        pulseQuickRuntime.noSignalHintTimer = null;
    }, delayMs);
}

function getPulseNoSignalHintToastMs() {
    const sec = Number(state.settings?.pulseQuick?.noSignalHintSec);
    const safeSec = [4, 6, 8].includes(sec) ? sec : PULSE_NO_SIGNAL_HINT_TOAST_DEFAULT_SEC;
    return safeSec * 1000;
}

function getPulseQuickModeLabel(mode) {
    return window.AurivoListenSettings?.getPulseQuickModeLabel?.(mode, uiT)
        || uiT('listen.quick.mode.options.background', 'Fon Müzik Odakli');
}

function getPulseQuickModeDetail(mode) {
    return window.AurivoListenSettings?.getPulseQuickModeDetail?.(mode, uiT)
        || uiT('listen.quick.mode.detail.background', 'Fon Muzik Odakli: Konusma, ortam sesi veya efektlerin arkasinda kalan muzikleri bulmak icin daha uygundur.');
}

function updatePulseQuickModeUi() {
    window.AurivoSettingsShared?.updatePulseQuickModeUi?.({
        elements,
        mode: elements.pulseQuickMode?.value,
        defaultMode: PULSE_QUICK_MODE_DEFAULT,
        getLabel: getPulseQuickModeLabel,
        getDetail: getPulseQuickModeDetail
    });
}

function updateRecognitionEngineUi() {
    const mode = String(elements.pulseRecognitionEngine?.value || 'hybrid').trim().toLowerCase();
    const hasApiKey = String(elements.pulseAcoustidApiKey?.value || '').trim().length > 0;

    if (elements.pulseAcoustidHint) {
        if (mode === 'songrec_only') {
            elements.pulseAcoustidHint.textContent = 'Bu modda API key gerekmez. AcoustID hic cagrilmaz.';
        } else if (mode === 'acoustid_only' && hasApiKey) {
            elements.pulseAcoustidHint.textContent = 'Sadece AcoustID aktif. Tanima bu API key ile yapilir.';
        } else if (mode === 'hybrid' && hasApiKey) {
            elements.pulseAcoustidHint.textContent = 'Hibrit mod aktif. SongRec bulamazsa AcoustID yedek olarak kullanilir.';
        } else {
            elements.pulseAcoustidHint.textContent = 'Opsiyonel. Bos birakilirsa hibrit mod SongRec ile calisir.';
        }
    }

    if (elements.pulseAcoustidWarning) {
        const showWarning = mode === 'acoustid_only' && !hasApiKey;
        elements.pulseAcoustidWarning.classList.toggle('hidden', !showWarning);
    }
}

async function tryPulseQuickSampleFallback() {
    if (pulseQuickRuntime.sampleRetryRunning) return false;
    const pulseMode = getPulseQuickModeConfig();
    if (pulseMode.mode !== 'max') return false;
    const audioDevice = String(state.settings?.pulseQuick?.preferredAudioDevice || '').trim();
    if (!audioDevice || !window.aurivo?.pulse?.recognizeSample) return false;

    pulseQuickRuntime.sampleRetryRunning = true;
    try {
        safeNotify('Ek deneme: monitor sesinden kisa bir ornek aliniyor...', 'info', 2200);
        const fallbackDurationSec = Math.max(
            4,
            Math.min(
                30,
                Number(state.settings?.pulsePreferences?.buffer_size_secs) || 5
            )
        );
        const res = await window.aurivo.pulse.recognizeSample({
            audioDevice,
            durationSec: fallbackDurationSec
        });
        if (res?.success && res?.result?.title) {
            pulseQuickRuntime.lastResultAt = Date.now();
            safeNotify('Ek deneme ile bulundu.', 'success', 2200);
            await routePulseResultToInAppPlatform(res.result);
            await window.aurivo?.pulse?.stopListening?.().catch(() => { });
            pulseQuickRuntime.running = false;
            pulseQuickRuntime.searching = false;
            pulseQuickRuntime.startedAt = 0;
            clearPulseNoSignalHintTimer();
            updatePulseQuickBtnUi();
            return true;
        }
    } catch {
        // yoksay
    } finally {
        pulseQuickRuntime.sampleRetryRunning = false;
    }
    return false;
}

function getPulseQuickModeConfig() {
    const rawMode = String(state.settings?.pulseQuick?.mode || PULSE_QUICK_MODE_DEFAULT).trim().toLowerCase();
    const mode = ['normal', 'background', 'max'].includes(rawMode) ? rawMode : PULSE_QUICK_MODE_DEFAULT;
    const runtimeInterval = Math.max(
        1,
        Math.min(
            120,
            Number(state.settings?.pulsePreferences?.request_interval_secs_v3) || 2
        )
    );
    if (mode === 'normal') return { mode, backgroundMode: false, requestInterval: runtimeInterval, noSignalDelayMs: 22000 };
    if (mode === 'max') return { mode, backgroundMode: true, requestInterval: runtimeInterval, noSignalDelayMs: 28000 };
    return { mode: 'background', backgroundMode: true, requestInterval: runtimeInterval, noSignalDelayMs: 30000 };
}

async function getPreferredPulseDeviceForSpeakers() {
    try {
        const listRes = await window.aurivo?.pulse?.listDevices?.();
        const devices = Array.isArray(listRes?.devices) ? listRes.devices : [];
        const normalize = (value) => String(value || '').trim().toLowerCase();
        const findExistingDeviceId = (candidate) => {
            const wanted = normalize(candidate);
            if (!wanted) return '';
            const exact = devices.find((d) => normalize(d?.id) === wanted);
            return exact?.id ? String(exact.id) : '';
        };
        const remember = (deviceId) => {
            const next = String(deviceId || '').trim();
            if (!next) return;
            if (!state.settings || typeof state.settings !== 'object') state.settings = {};
            if (!state.settings.pulseQuick || typeof state.settings.pulseQuick !== 'object') {
                state.settings.pulseQuick = {};
            }
            if (state.settings.pulseQuick.preferredAudioDevice === next) return;
            state.settings.pulseQuick.preferredAudioDevice = next;
            saveSettings().catch(() => { });
        };

        const savedDevice = findExistingDeviceId(state.settings?.pulseQuick?.preferredAudioDevice);
        if (savedDevice) return savedDevice;

        const statusRes = await window.aurivo?.pulse?.getStatus?.().catch(() => null);
        const activeDevice = findExistingDeviceId(statusRes?.status?.audioDevice);
        if (activeDevice) {
            remember(activeDevice);
            return activeDevice;
        }

        const pulsePrefRes = await window.aurivo?.pulse?.getPreferredDevice?.().catch(() => null);
        const pulsePreferredDevice = findExistingDeviceId(pulsePrefRes?.audioDevice);
        if (pulsePreferredDevice) {
            remember(pulsePreferredDevice);
            return pulsePreferredDevice;
        }

        const toScore = (d) => {
            const id = String(d?.id || '').toLowerCase();
            const label = String(d?.label || '').toLowerCase();
            const text = `${id} ${label}`;
            let score = 0;
            if (/\.monitor\b|monitor of|monitor/.test(text)) score += 6;
            if (/loopback|stereo mix|what.?u.?hear|sink/.test(text)) score += 4;
            if (/mic|microphone|capture|input/.test(text)) score -= 5;
            return score;
        };
        const sorted = devices
            .map((d) => ({ d, s: toScore(d) }))
            .sort((a, b) => b.s - a.s);
        const best = sorted[0];
        if (best && best.s > 0 && best.d?.id) {
            remember(best.d.id);
            return String(best.d.id);
        }
    } catch {
        // yedek: otomatik
    }
    return '';
}

function getPreferredWebPlatformBtn() {
    const active = document.querySelector('.platform-btn.active');
    if (active) return active;
    return document.querySelector('.platform-btn[data-platform="ytmusic"]')
        || document.querySelector('.platform-btn[data-platform="youtube"]')
        || document.querySelector('.platform-btn');
}

function getWebPlatformBtnByName(platform) {
    const key = String(platform || '').trim().toLowerCase();
    if (!key) return null;
    if (!/^[a-z0-9_-]+$/.test(key)) return null;
    return document.querySelector(`.platform-btn[data-platform="${key}"]`);
}

function buildPulseSearchUrl(platform, query) {
    const q = encodeURIComponent(String(query || '').trim());
    const key = String(platform || '').toLowerCase();
    if (key === 'ytmusic') return `https://music.youtube.com/search?q=${q}`;
    if (key === 'youtube') return `https://www.youtube.com/results?search_query=${q}`;
    if (key === 'deezer') return `https://www.deezer.com/search/${q}`;
    if (key === 'soundcloud') return `https://soundcloud.com/search/sounds?q=${q}`;
    return `https://music.youtube.com/search?q=${q}`;
}

function forceSearchInsideWebView(query, platform) {
    if (!elements.webView) return Promise.resolve(false);
    const q = String(query || '').trim();
    if (!q) return Promise.resolve(false);
    const p = String(platform || '').toLowerCase();
    const code = `
        (function(){
            try {
                const q = ${JSON.stringify(q)};
                const p = ${JSON.stringify(p)};
                if (!q) return false;
                const encoded = encodeURIComponent(q);
                if (p === 'youtube') {
                    location.href = 'https://www.youtube.com/results?search_query=' + encoded;
                    return true;
                }
                if (p === 'ytmusic') {
                    location.href = 'https://music.youtube.com/search?q=' + encoded;
                    return true;
                }
                if (p === 'deezer') {
                    location.href = 'https://www.deezer.com/search/' + encoded;
                    return true;
                }
                if (p === 'soundcloud') {
                    location.href = 'https://soundcloud.com/search/sounds?q=' + encoded;
                    return true;
                }
                return false;
            } catch {
                return false;
            }
        })();
    `;
    try {
        const maybe = elements.webView.executeJavaScript(code, true);
        if (maybe && typeof maybe.then === 'function') return maybe.then((ok) => !!ok).catch(() => false);
    } catch {
        // yoksay
    }
    return Promise.resolve(false);
}

function forceSearchByTypingInWebView(query) {
    if (!elements.webView) return Promise.resolve(false);
    const q = String(query || '').trim();
    if (!q) return Promise.resolve(false);
    const code = `
        (function(){
            try {
                var q = ${JSON.stringify(q)};
                if (!q) return false;
                var input =
                    document.querySelector('input#search') ||
                    document.querySelector('input[name="search_query"]') ||
                    document.querySelector('input[type="search"]') ||
                    document.querySelector('ytmusic-search-box input') ||
                    document.querySelector('input[aria-label*="Ara"], input[aria-label*="Search"]');
                if (!input) return false;
                input.focus();
                input.value = q;
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));
                var form = input.closest('form');
                if (form) {
                    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
                    if (typeof form.submit === 'function') form.submit();
                }
                var btn =
                    document.querySelector('button#search-icon-legacy') ||
                    document.querySelector('yt-icon-button#search-icon-legacy') ||
                    document.querySelector('button[aria-label*="Ara"], button[aria-label*="Search"]') ||
                    document.querySelector('ytmusic-search-box yt-icon-button');
                if (btn && typeof btn.click === 'function') btn.click();
                input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
                input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
                return true;
            } catch {
                return false;
            }
        })();
    `;
    try {
        const maybe = elements.webView.executeJavaScript(code, true);
        if (maybe && typeof maybe.then === 'function') return maybe.then((ok) => !!ok).catch(() => false);
    } catch {
        // yoksay
    }
    return Promise.resolve(false);
}

function urlLooksLikePulseSearch(currentUrl, query, platform) {
    const u = parseHttpUrl(currentUrl);
    if (!u) return false;
    const host = String(u.hostname || '').toLowerCase();
    const q = String(query || '').trim().toLowerCase();
    const p = String(platform || '').toLowerCase();
    if (p === 'youtube') {
        if (!(host === 'youtube.com' || host === 'www.youtube.com' || host === 'm.youtube.com')) return false;
        if (!u.pathname.startsWith('/results')) return false;
        return String(u.searchParams.get('search_query') || '').toLowerCase().includes(q.slice(0, 8));
    }
    if (p === 'ytmusic') {
        if (host !== 'music.youtube.com') return false;
        return (u.pathname.startsWith('/search') || u.pathname.startsWith('/results')) &&
            String(u.searchParams.get('q') || '').toLowerCase().includes(q.slice(0, 8));
    }
    if (p === 'deezer') return host.endsWith('deezer.com') && u.pathname.toLowerCase().includes('/search');
    if (p === 'soundcloud') return host.endsWith('soundcloud.com') && u.pathname.toLowerCase().includes('/search');
    return false;
}

function setPulseSearchBypassInWebView(durationMs = 20000) {
    if (!elements.webView) return;
    const ms = Math.max(1000, Number(durationMs) || 20000);
    const code = `
        (function(){
            try {
                window.__aurivoPulseSearchBypassUntil = Date.now() + ${ms};
                var shield = document.getElementById('aurivo-deliblock-adshield');
                if (shield) shield.style.display = 'none';
                return true;
            } catch {
                return false;
            }
        })();
    `;
    try {
        const maybe = elements.webView.executeJavaScript(code, true);
        if (maybe && typeof maybe.catch === 'function') maybe.catch(() => { });
    } catch {
        // yoksay
    }
}

function isPulseTargetPlatformAlreadyOpen(platform) {
    if (state.activeMedia !== 'web' || !elements.webView) return false;
    const cur = getWebViewUrlSafe();
    if (!cur || cur === 'about:blank') return false;
    const detected = detectPlatformFromUrl(cur);
    return detected && String(detected).toLowerCase() === String(platform || '').toLowerCase();
}

function prepareWebUiForPulseSearch(btn) {
    // Pulse aramasında ağır platform-switch akışını bekletmeden
    // web görünümünü hızlıca hazırla.
    closeAllUtilityPages();
    stopAudio();
    stopVideo();
    state.activeMedia = 'web';
    state.currentPage = 'web';
    state.currentPanel = 'web';
    switchPage('web');
    applyWebUiClasses();
    persistCurrentMainSection();
    elements.platformBtns.forEach((b) => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    pulseSearchDebug('prepareWebUiForPulseSearch', {
        platform: String(btn?.dataset?.platform || ''),
        currentUrl: getWebViewUrlSafe()
    });
    try {
        elements.webView?.setUserAgent?.(getEmbeddedDesktopUserAgent());
    } catch {
        // yoksay
    }
}

async function navigatePulseSearchInWebView(searchUrl, query, platform, options = {}) {
    if (!elements.webView) return;
    if (!isAllowedWebUrl(searchUrl)) return;
    const startedAt = Date.now();
    const fastPath = !!options.fastPath;
    setPulseSearchBypassInWebView(25000);
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const go = () => {
        safeNavigateWebView(searchUrl);
    };
    pulseSearchDebug('navigate:start', {
        platform,
        query,
        searchUrl,
        fastPath,
        currentUrl: getWebViewUrlSafe()
    });

    if (fastPath) {
        await forceSearchInsideWebView(query, platform);
        await wait(350);
        let curFast = getWebViewUrlSafe();
        if (urlLooksLikePulseSearch(curFast, query, platform)) {
            pulseSearchDebug('navigate:done-fast-direct', { elapsedMs: Date.now() - startedAt, currentUrl: curFast });
            return;
        }

        await forceSearchByTypingInWebView(query);
        await wait(450);
        curFast = getWebViewUrlSafe();
        if (urlLooksLikePulseSearch(curFast, query, platform)) {
            pulseSearchDebug('navigate:done-fast-dom', { elapsedMs: Date.now() - startedAt, currentUrl: curFast });
            return;
        }

        safeNavigateWebView(searchUrl);
        pulseSearchDebug('navigate:done-fast-hard-url', { elapsedMs: Date.now() - startedAt, currentUrl: getWebViewUrlSafe() });
        return;
    }

    // Aşama 1: URL bazlı arama
    go();
    setTimeout(go, 320);
    setTimeout(go, 1100);
    setTimeout(go, 2200);

    await wait(2600);
    let cur = getWebViewUrlSafe();
    if (urlLooksLikePulseSearch(cur, query, platform)) {
        pulseSearchDebug('navigate:done-stage1', { elapsedMs: Date.now() - startedAt, currentUrl: cur });
        return;
    }

    // Aşama 2: doğrudan location.href zorlaması
    await forceSearchInsideWebView(query, platform);
    await wait(1200);
    cur = getWebViewUrlSafe();
    if (urlLooksLikePulseSearch(cur, query, platform)) {
        pulseSearchDebug('navigate:done-stage2', { elapsedMs: Date.now() - startedAt, currentUrl: cur });
        return;
    }

    // Aşama 3: DOM input + Enter/click fallback
    await forceSearchByTypingInWebView(query);
    await wait(1200);
    cur = getWebViewUrlSafe();
    if (urlLooksLikePulseSearch(cur, query, platform)) {
        pulseSearchDebug('navigate:done-stage3', { elapsedMs: Date.now() - startedAt, currentUrl: cur });
        return;
    }

    // Son hamle: hard reload ile URL tekrar uygula
    safeNavigateWebView(searchUrl);
    pulseSearchDebug('navigate:done-stage4-hard-url', { elapsedMs: Date.now() - startedAt, currentUrl: getWebViewUrlSafe() });
}

async function routePulseResultToInAppPlatform(result) {
    const title = String(result?.title || '').trim();
    const artist = String(result?.artist || '').trim();
    const query = [artist, title].filter(Boolean).join(' ').trim();
    if (!query) return;

    const fingerprint = `${artist.toLowerCase()}|${title.toLowerCase()}`;
    const now = Date.now();
    if (fingerprint && pulseQuickRuntime.lastFingerprint === fingerprint && (now - pulseQuickRuntime.lastAt) < 45000) return;
    pulseQuickRuntime.lastFingerprint = fingerprint;
    pulseQuickRuntime.lastAt = now;

    const btn = getWebPlatformBtnByName('youtube') || getPreferredWebPlatformBtn();
    if (!btn) return;

    const platform = String(btn.dataset.platform || '').toLowerCase();
    const searchUrl = buildPulseSearchUrl(platform, query);

    try {
        pulseSearchDebug('routeResult:start', { platform, query, searchUrl });
        const alreadyOpen = isPulseTargetPlatformAlreadyOpen(platform);
        if (!alreadyOpen) prepareWebUiForPulseSearch(btn);
        await navigatePulseSearchInWebView(searchUrl, query, platform, { fastPath: true });
        pulseSearchDebug('routeResult:end', { platform, query, currentUrl: getWebViewUrlSafe() });
    } catch (e) {
        console.warn('[PULSE] in-app route error:', e?.message || e);
        pulseSearchDebug('routeResult:error', String(e?.message || e));
    }
}

async function routePulseQueryToInAppPlatform(payload) {
    const query = String(payload?.query || '').trim();
    if (!query) return;
    const preferredPlatform = String(payload?.platform || '').trim().toLowerCase();
    const fromPulseWindow = String(payload?.source || '').toLowerCase() === 'aurivo-pulse-gui';
    // Bu akış kullanıcı tıklamasıyla tetiklenir; dedupe uygulanmamalı.
    pulseQuickRuntime.lastFingerprint = `${preferredPlatform}|manual|${query.toLowerCase()}`;
    pulseQuickRuntime.lastAt = Date.now();

    const forcedPlatform = fromPulseWindow ? 'youtube' : preferredPlatform;
    const btn = getWebPlatformBtnByName(forcedPlatform)
        || getWebPlatformBtnByName(preferredPlatform)
        || getPreferredWebPlatformBtn();
    if (!btn) return;
    const platform = String(btn.dataset.platform || '').toLowerCase();
    const searchUrl = buildPulseSearchUrl(platform, query);
    try {
        pulseSearchDebug('routeQuery:start', { platform, query, searchUrl, payloadPlatform: preferredPlatform });
        const alreadyOpen = isPulseTargetPlatformAlreadyOpen(platform);
        if (!alreadyOpen) prepareWebUiForPulseSearch(btn);
        await navigatePulseSearchInWebView(searchUrl, query, platform, { fastPath: true });
        pulseSearchDebug('routeQuery:end', { platform, query, currentUrl: getWebViewUrlSafe() });
    } catch (e) {
        console.warn('[PULSE] in-app query route error:', e?.message || e);
        pulseSearchDebug('routeQuery:error', String(e?.message || e));
    }
}

async function togglePulseQuickListen() {
    try {
        if (!window.aurivo?.pulse) return;

        if (pulseQuickRuntime.running) {
            await window.aurivo.pulse.stopListening();
            pulseQuickRuntime.running = false;
            pulseQuickRuntime.searching = false;
            pulseQuickRuntime.stoppingAfterResult = false;
            pulseQuickRuntime.startedAt = 0;
            clearPulseNoSignalHintTimer();
            updatePulseQuickBtnUi();
            safeNotify('Aurivo-Pulse dinleme durduruldu.', 'info', 1800);
            return;
        }

        const preferredDevice = await getPreferredPulseDeviceForSpeakers();
        if (!preferredDevice) {
            safeNotify('İç ses (Monitor) cihazı bulunamadı. Dinle penceresinden monitor cihazını seçin.', 'error', 3000);
            await window.aurivo?.pulse?.openWindow?.().catch(() => { });
            return;
        }
        const pulseQuickMode = getPulseQuickModeConfig();
        const started = await window.aurivo.pulse.startListening({
            audioDevice: preferredDevice,
            disableMpris: true,
            backgroundMode: pulseQuickMode.backgroundMode,
            profile: pulseQuickMode.mode,
            requestInterval: pulseQuickMode.requestInterval,
            forceRestart: true
        });
        pulseQuickRuntime.running = !!started?.running;
        pulseQuickRuntime.searching = !!started?.running;
        pulseQuickRuntime.stoppingAfterResult = false;
        pulseQuickRuntime.startedAt = Date.now();
        pulseQuickRuntime.lastResultAt = 0;
        if (pulseQuickRuntime.running && preferredDevice) {
            state.settings.pulseQuick.preferredAudioDevice = preferredDevice;
            saveSettings().catch(() => { });
        }
        updatePulseQuickBtnUi();
        if (pulseQuickRuntime.running) {
            const modeLabel = getPulseQuickModeLabel(pulseQuickMode.mode);
            safeNotify(`Dinleme modu: ${modeLabel}`, 'info', 1800);
        }
        if (pulseQuickRuntime.running) schedulePulseNoSignalHint();
        if (!pulseQuickRuntime.running) {
            pulseQuickRuntime.searching = false;
            safeNotify('Aurivo-Pulse başlatılamadı.', 'error', 2200);
        }
    } catch (e) {
        pulseQuickRuntime.running = false;
        pulseQuickRuntime.searching = false;
        pulseQuickRuntime.stoppingAfterResult = false;
        pulseQuickRuntime.startedAt = 0;
        clearPulseNoSignalHintTimer();
        updatePulseQuickBtnUi();
        safeNotify(`Dinleme başlatılamadı: ${e?.message || e}`, 'error', 2600);
    }
}

function setupPulseQuickListeners() {
    try {
        if (!window.aurivo?.pulse) return;
        if (typeof pulseQuickRuntime.unsubState === 'function') pulseQuickRuntime.unsubState();
        if (typeof pulseQuickRuntime.unsubResult === 'function') pulseQuickRuntime.unsubResult();
        if (typeof pulseQuickRuntime.unsubUncertain === 'function') pulseQuickRuntime.unsubUncertain();
        if (typeof pulseQuickRuntime.unsubOpenQuery === 'function') pulseQuickRuntime.unsubOpenQuery();

        pulseQuickRuntime.unsubState = window.aurivo.pulse.onState((pulseState) => {
            pulseQuickRuntime.running = !!pulseState?.running;
            const warningText = String(pulseState?.warning || pulseState?.lastError || '').trim();
            if (warningText) {
                const now = Date.now();
                const canNotify = (now - Number(pulseQuickRuntime.lastWarningAt || 0)) > 10000;
                if (canNotify) {
                    pulseQuickRuntime.lastWarningAt = now;
                    const lowered = warningText.toLowerCase();
                    if (lowered.includes('429') || lowered.includes('too many') || lowered.includes('rate')) {
                        safeNotify('Aurivo-Pulse: Shazam istek limiti. 1-2 dakika bekleyip tekrar deneyin.', 'warning', 3200);
                    } else if (lowered.includes('network') || lowered.includes('unreachable') || lowered.includes('timeout')) {
                        safeNotify('Aurivo-Pulse: ağ hatası. İnternet bağlantısını kontrol edin.', 'warning', 3200);
                    }
                }
            }
            if (pulseState?.running && pulseState?.audioDevice) {
                const nextDevice = String(pulseState.audioDevice || '').trim();
                if (
                    nextDevice &&
                    state.settings?.pulseQuick &&
                    state.settings.pulseQuick.preferredAudioDevice !== nextDevice
                ) {
                    state.settings.pulseQuick.preferredAudioDevice = nextDevice;
                    saveSettings().catch(() => { });
                }
            }
            if (!pulseQuickRuntime.running) {
                pulseQuickRuntime.searching = false;
                pulseQuickRuntime.stoppingAfterResult = false;
                pulseQuickRuntime.startedAt = 0;
                clearPulseNoSignalHintTimer();
            }
            updatePulseQuickBtnUi();
        });

        pulseQuickRuntime.unsubResult = window.aurivo.pulse.onResult((result) => {
            pulseQuickRuntime.lastResultAt = Date.now();
            clearPulseNoSignalHintTimer();
            const title = String(result?.title || '').trim();
            const artist = String(result?.artist || '').trim();
            const label = [artist, title].filter(Boolean).join(' - ') || 'Parça';
            safeNotify(`Bulundu: ${label}`, 'success', 2600);
            Promise.resolve(routePulseResultToInAppPlatform(result))
                .catch((e) => {
                    pulseSearchDebug('routeResult:error-from-onResult', String(e?.message || e));
                })
                .finally(() => {
                    // Arama tamamlandıktan sonra Shazam tarzı animasyonu kapat.
                    pulseQuickRuntime.searching = false;
                    updatePulseQuickBtnUi();
                });

            // Üstteki hızlı dinleme: ilk sonuçtan sonra tamamen kapanmalı.
            if (
                pulseQuickRuntime.autoStopOnFirstResult &&
                pulseQuickRuntime.running &&
                !pulseQuickRuntime.stoppingAfterResult
            ) {
                pulseQuickRuntime.stoppingAfterResult = true;
                Promise.resolve(window.aurivo?.pulse?.stopListening?.())
                    .then(() => {
                        pulseQuickRuntime.running = false;
                        pulseQuickRuntime.searching = false;
                        pulseQuickRuntime.startedAt = 0;
                        clearPulseNoSignalHintTimer();
                        updatePulseQuickBtnUi();
                        if (!PULSE_HIDE_AUTO_STOP_NOTICE) {
                            safeNotify('Bulundu. Dinleme otomatik durduruldu.', 'info', 1800);
                        }
                    })
                    .catch(() => {
                        pulseQuickRuntime.stoppingAfterResult = false;
                    });
            }
        });

        pulseQuickRuntime.unsubUncertain = window.aurivo.pulse.onUncertain((payload) => {
            const now = Date.now();
            if ((now - Number(pulseQuickRuntime.lastUncertainAt || 0)) < 12000) return;
            pulseQuickRuntime.lastUncertainAt = now;
            const candidates = Array.isArray(payload?.candidates) ? payload.candidates : [];
            if (!candidates.length) return;
            const lines = candidates
                .slice(0, 3)
                .map((entry, index) => {
                    const title = String(entry?.title || '').trim();
                    const artist = String(entry?.artist || '').trim();
                    return `${index + 1}. ${[artist, title].filter(Boolean).join(' - ') || 'Bilinmeyen aday'}`;
                });
            safeNotify(`Emin değilim, olası sonuçlar:\n${lines.join('\n')}`, 'info', 5200);
        });

        pulseQuickRuntime.unsubOpenQuery = window.aurivo.pulse.onOpenQuery((payload) => {
            const query = String(payload?.query || '').trim();
            if (!query) return;
            routePulseQueryToInAppPlatform(payload);
            safeNotify(`Aurivo-Pulse: uygulama içinde açılıyor (${query})`, 'info', 1800);
        });

        window.aurivo.pulse.getStatus().then((res) => {
            pulseQuickRuntime.running = !!res?.status?.running;
            pulseQuickRuntime.searching = !!res?.status?.running;
            pulseQuickRuntime.startedAt = pulseQuickRuntime.running ? Date.now() : 0;
            if (pulseQuickRuntime.running) schedulePulseNoSignalHint();
            updatePulseQuickBtnUi();
        }).catch(() => {
            pulseQuickRuntime.running = false;
            pulseQuickRuntime.searching = false;
            pulseQuickRuntime.startedAt = 0;
            clearPulseNoSignalHintTimer();
            updatePulseQuickBtnUi();
        });
    } catch {
        // yoksay
    }
}

function resolveWebPlatformPrimaryUrl(platform, requestedUrl) {
    const p = String(platform || '').toLowerCase();
    if (p === 'youtube') return 'https://www.youtube.com/';
    if (p === 'ytmusic') return 'https://music.youtube.com/';
    return requestedUrl;
}

function resolveWebPlatformFallbackUrl(platform, requestedUrl) {
    const p = String(platform || '').toLowerCase();
    if (p === 'youtube') return 'https://m.youtube.com/';
    if (p === 'ytmusic') return 'https://music.youtube.com/';
    return requestedUrl;
}

function webUrlLooksLikeTarget(currentUrl, targetUrl, platform = '') {
    const c = parseHttpUrl(currentUrl);
    const t = parseHttpUrl(targetUrl);
    if (!c || !t) return false;
    const ch = String(c.hostname || '').toLowerCase();
    const th = String(t.hostname || '').toLowerCase();
    const p = String(platform || '').toLowerCase();
    if (p === 'youtube') {
        // YouTube ve YouTube Music'i kesin ayır:
        // music.youtube.com, YouTube hedefi SAYILMAMALI.
        return ch === 'youtube.com' || ch === 'www.youtube.com' || ch === 'm.youtube.com';
    }
    if (p === 'ytmusic') {
        return ch === 'music.youtube.com';
    }
    return ch === th;
}

function safeNavigateWebView(url) {
    if (!elements.webView || !url) return false;
    try {
        elements.webView.setAttribute('src', String(url));
        return true;
    } catch {
        // yoksay
    }
    try {
        const maybe = elements.webView.loadURL(String(url));
        if (maybe && typeof maybe.catch === 'function') maybe.catch(() => { });
        return true;
    } catch {
        return false;
    }
}

function hardStopWebPlayback() {
    try {
        if (!elements.webView || typeof elements.webView.executeJavaScript !== 'function') return;
        elements.webView.executeJavaScript(`
            (function() {
                try {
                    const medias = document.querySelectorAll('video, audio');
                    medias.forEach((m) => {
                        try {
                            m.pause();
                            m.muted = true;
                            m.currentTime = 0;
                            if (typeof m.removeAttribute === 'function') {
                                m.removeAttribute('src');
                            }
                            if (typeof m.load === 'function') m.load();
                        } catch {}
                    });
                    return true;
                } catch {
                    return false;
                }
            })();
        `).catch(() => { });
    } catch {
        // yoksay
    }
}

function showWebLoadingOverlay(message = '') {
    if (!elements.webLoadingOverlay) return;
    const textEl = elements.webLoadingOverlay.querySelector('.web-loading-text');
    if (textEl) {
        textEl.textContent = message || 'uDaliBlock on kontrolden geciriyor...';
    }
    elements.webLoadingOverlay.classList.remove('hidden');
    if (webLoadRuntime.overlayTimer) {
        clearTimeout(webLoadRuntime.overlayTimer);
    }
    webLoadRuntime.overlayTimer = setTimeout(() => {
        hideWebLoadingOverlay();
    }, 12000);
}

function hideWebLoadingOverlay() {
    if (webLoadRuntime.overlayTimer) {
        clearTimeout(webLoadRuntime.overlayTimer);
        webLoadRuntime.overlayTimer = null;
    }
    if (!elements.webLoadingOverlay) return;
    elements.webLoadingOverlay.classList.add('hidden');
}

const WEB_ALLOWED_HOSTS = new Set([
    'google.com',
    'www.google.com',
    'youtube.com',
    'www.youtube.com',
    'm.youtube.com',
    'music.youtube.com',
    'youtu.be',
    'accounts.google.com',
    'www.deezer.com',
    'deezer.com',
    'soundcloud.com',
    'www.soundcloud.com',
    'mixcloud.com',
    'www.mixcloud.com',
    'facebook.com',
    'www.facebook.com',
    'm.facebook.com',
    'instagram.com',
    'www.instagram.com',
    'tiktok.com',
    'www.tiktok.com',
    'm.tiktok.com',
    'x.com',
    'www.x.com',
    'twitter.com',
    'www.twitter.com',
    'reddit.com',
    'www.reddit.com',
    'old.reddit.com',
    'twitch.tv',
    'www.twitch.tv'
]);

const WEB_ALLOWED_SUFFIXES = [
    '.youtube.com',
    '.google.com',
    '.googleusercontent.com',
    '.deezer.com',
    '.soundcloud.com',
    '.mixcloud.com',
    '.facebook.com',
    '.instagram.com',
    '.tiktok.com',
    '.x.com',
    '.twitter.com',
    '.reddit.com',
    '.twitch.tv'
];

const WEB_SYNC_ALLOWED_HOSTS = new Set([
    'youtube.com',
    'www.youtube.com',
    'm.youtube.com',
    'music.youtube.com',
    'youtu.be',
    'www.deezer.com',
    'deezer.com',
    'soundcloud.com',
    'www.soundcloud.com',
    'mixcloud.com',
    'www.mixcloud.com',
    'twitch.tv',
    'www.twitch.tv'
]);

function parseHttpUrl(raw) {
    try {
        const u = new URL(String(raw || '').trim());
        if (!/^https?:$/i.test(u.protocol)) return null;
        return u;
    } catch {
        return null;
    }
}

function isAllowedWebUrl(raw) {
    const parsed = parseHttpUrl(raw);
    if (!parsed) return false;
    const host = String(parsed.hostname || '').toLowerCase();
    if (WEB_ALLOWED_HOSTS.has(host)) return true;
    return WEB_ALLOWED_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

function detectPlatformFromUrl(raw) {
    const parsed = parseHttpUrl(raw);
    if (!parsed) return '';
    const host = String(parsed.hostname || '').toLowerCase();
    if (host === 'music.youtube.com') return 'ytmusic';
    if (host === 'youtu.be' || host === 'youtube.com' || host === 'www.youtube.com' || host === 'm.youtube.com' || host.endsWith('.youtube.com')) return 'youtube';
    if (host === 'deezer.com' || host === 'www.deezer.com' || host.endsWith('.deezer.com')) return 'deezer';
    if (host === 'soundcloud.com' || host === 'www.soundcloud.com' || host.endsWith('.soundcloud.com')) return 'soundcloud';
    if (host === 'facebook.com' || host === 'www.facebook.com' || host === 'm.facebook.com' || host.endsWith('.facebook.com')) return 'facebook';
    if (host === 'instagram.com' || host === 'www.instagram.com' || host.endsWith('.instagram.com')) return 'instagram';
    if (host === 'tiktok.com' || host === 'www.tiktok.com' || host === 'm.tiktok.com' || host.endsWith('.tiktok.com')) return 'tiktok';
    if (host === 'x.com' || host === 'www.x.com' || host === 'twitter.com' || host === 'www.twitter.com' || host.endsWith('.x.com') || host.endsWith('.twitter.com')) return 'x';
    if (host === 'reddit.com' || host === 'www.reddit.com' || host === 'old.reddit.com' || host.endsWith('.reddit.com')) return 'reddit';
    if (host === 'twitch.tv' || host === 'www.twitch.tv' || host.endsWith('.twitch.tv')) return 'twitch';
    if (host === 'mixcloud.com' || host === 'www.mixcloud.com' || host.endsWith('.mixcloud.com')) return 'mixcloud';
    return '';
}

function syncActivePlatformButtonByUrl(rawUrl) {
    if (!elements.platformBtns || !elements.platformBtns.length) return;
    const detected = detectPlatformFromUrl(rawUrl);
    if (!detected) return;
    let matchedBtn = null;
    elements.platformBtns.forEach((btn) => {
        const key = String(btn.dataset.platform || '').toLowerCase();
        const isMatch = key === detected;
        btn.classList.toggle('active', isMatch);
        if (isMatch) matchedBtn = btn;
    });
    if (matchedBtn) {
        const platformName = matchedBtn.querySelector('span')?.textContent?.trim();
        if (platformName && elements.nowPlayingLabel) {
            elements.nowPlayingLabel.textContent = `${uiT('nowPlaying.prefix', 'Now Playing')}: ${platformName}`;
        }
        updatePlatformCover(detected);
    }
}

function isYoutubeHost(raw) {
    const parsed = parseHttpUrl(raw);
    if (!parsed) return false;
    const host = String(parsed.hostname || '').toLowerCase();
    return host === 'youtube.com' ||
        host === 'www.youtube.com' ||
        host === 'm.youtube.com' ||
        host === 'music.youtube.com' ||
        host.endsWith('.youtube.com') ||
        host.endsWith('.googlevideo.com') ||
        host.endsWith('.ytimg.com');
}

function getEmbeddedDesktopUserAgent() {
    const nativeUa = String(navigator.userAgent || '');
    const stripped = nativeUa
        .replace(/\sElectron\/[^\s)]+/gi, '')
        .replace(/\sAurivo\/[^\s)]+/gi, '')
        .replace(/\s{2,}/g, ' ')
        .trim();
    // Daha güncel Chrome kimliği: bazı servisler eski UA'ları kısıtlayabiliyor.
    return stripped || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36';
}

function shouldInjectWebSync(url) {
    const parsed = parseHttpUrl(url);
    if (!parsed) return false;
    const host = String(parsed.hostname || '').toLowerCase();
    if (WEB_SYNC_ALLOWED_HOSTS.has(host)) return true;
    return host.endsWith('.youtube.com');
}

async function getSecurityStateSafe() {
    try {
        const data = await window.aurivo?.webSecurity?.getSecurityState?.();
        return {
            vpnDetected: !!data?.vpnDetected,
            vpnInterfaces: Array.isArray(data?.vpnInterfaces) ? data.vpnInterfaces : []
        };
    } catch {
        return { vpnDetected: false, vpnInterfaces: [] };
    }
}

function isStrictVpnBlockEnabled() {
    return !!state.settings?.security?.strictVpnBlock;
}

function updateAdblockModeUI() {
    const adblock = ensureAdblockSettings();
    window.AurivoAdblockSettings?.updateModeUI?.({
        elements,
        adblock,
        normalizeMode: normalizeAdblockMode
    });
}

function readAdblockSettingsFromUI() {
    const adblock = ensureAdblockSettings();
    adblock.mode = normalizeAdblockMode(adblock.mode);
    return window.AurivoAdblockSettings?.readSettingsFromUI?.({ elements, adblock }) || adblock;
}

function setAdblockMode(mode) {
    const nextMode = normalizeAdblockMode(mode);
    const adblock = ensureAdblockSettings();
    const prevMode = normalizeAdblockMode(adblock.mode);
    adblock.mode = nextMode;
    adblockRuntime.pendingModeChange = nextMode !== prevMode;
    updateAdblockModeUI();
    applyAdblockRuntimeConfig();

    if (nextMode !== prevMode && adblock.autoRefreshOnModeChange && elements.webView) {
        try {
            elements.webView.reload();
            adblockRuntime.pendingModeChange = false;
        } catch {
            // yoksay
        }
    }
}

function updateAdblockBadge(blockedCount) {
    window.AurivoAdblockSettings?.updateBadge?.({
        elements,
        blockedCount,
        showCount: !!ensureAdblockSettings().showBlockedCount
    });
}

async function refreshAdblockStats(showToast = false) {
    return window.AurivoAdblockSettings?.refreshStats?.({
        getStats: () => window.aurivo?.adblock?.getStats?.(),
        elements,
        updateBadge: updateAdblockBadge,
        setBlockedCount: (value) => { adblockRuntime.lastBlocked = value; },
        notify: safeNotify,
        showToast
    });
}

async function openAdblockDashboardPanel() {
    try {
        const ok = await window.aurivo?.adblock?.openDashboard?.();
        if (ok) return true;
    } catch (e) {
        console.warn('[ADBLOCK] openDashboard error:', e?.message || e);
    }
    safeNotify('uBO Lite paneli açılamadı', 'error', 2000);
    return false;
}

function startAdblockStatsPolling() {
    if (adblockRuntime.pollTimer) {
        clearInterval(adblockRuntime.pollTimer);
        adblockRuntime.pollTimer = null;
    }
    refreshAdblockStats(false);
    adblockRuntime.pollTimer = setInterval(() => {
        const inWeb = state.currentPage === 'web' || state.currentPanel === 'web' || state.activeMedia === 'web';
        const settingsOpen = isPageVisible(elements.settingsPage);
        if (inWeb || settingsOpen) {
            refreshAdblockStats(false);
        }
    }, 7000);
}

function stopAdblockStatsPolling() {
    if (!adblockRuntime.pollTimer) return;
    clearInterval(adblockRuntime.pollTimer);
    adblockRuntime.pollTimer = null;
}

function stopSettingsBackgroundWork() {
    stopAudioOutputMonitor();
    stopAudioOutputLevelMeter();
    stopAdblockStatsPolling();
}

function resumeSettingsBackgroundWork() {
    if (!isStandaloneSettingsMode()) return;
    if (document.hidden || !document.hasFocus()) {
        stopSettingsBackgroundWork();
        return;
    }

    const activeTab = getActiveSettingsTabName();
    if (activeTab === 'audio') {
        refreshSystemAudioState();
        startAudioOutputMonitor();
        startAudioOutputLevelMeter();
    } else if (activeTab === 'adblock') {
        startAdblockStatsPolling();
        refreshAdblockStats(false);
    } else if (activeTab === 'library') {
        refreshLibraryStats().catch(() => {});
    }
}

function updateSecurityUI() {
    updateSecurityUIAsync();
}

function isSecuritySettingsVisible() {
    return !!window.AurivoSecuritySettings?.isVisible?.({
        settingsPage: elements.settingsPage
    });
}

async function updateSecurityUIAsync() {
    return window.AurivoSecuritySettings?.updateUI?.({
        elements,
        getUrl: getWebViewUrlSafe,
        parseHttpUrl,
        getSecurityState: getSecurityStateSafe,
        translate: uiT,
        strictVpnBlock: !!state.settings?.security?.strictVpnBlock
    });
}

function setupSecurityUI() {
    if (!elements.securityConnStatus) return;

    if (elements.securityAllowPopups && elements.webView) {
        elements.securityAllowPopups.addEventListener('change', () => {
            if (!elements.webView) return;
            if (elements.securityAllowPopups.checked) {
                elements.webView.setAttribute('allowpopups', '');
            } else {
                elements.webView.removeAttribute('allowpopups');
            }
        });
    }

    if (elements.securityStrictVpnBlock) {
        elements.securityStrictVpnBlock.addEventListener('change', async () => {
            if (!state.settings) state.settings = {};
            if (!state.settings.security || typeof state.settings.security !== 'object') {
                state.settings.security = {};
            }
            state.settings.security.strictVpnBlock = !!elements.securityStrictVpnBlock.checked;
            await saveSettings();
            updateSecurityUI();
        });
    }

    if (elements.securityCopyUrlBtn) {
        elements.securityCopyUrlBtn.addEventListener('click', async () => {
            const url = getWebViewUrlSafe();
            try {
                window.aurivo?.clipboard?.setText?.(url);
                safeNotify(uiT('securityPage.notify.urlCopied', 'URL copied.'), 'success');
            } catch (e) {
                safeNotify(uiT('securityPage.notify.urlCopyFailed', "Couldn't copy URL: {error}", { error: e?.message || e }), 'error');
            }
        });
    }

    if (elements.securityOpenInBrowserBtn) {
        elements.securityOpenInBrowserBtn.addEventListener('click', async () => {
            const url = getWebViewUrlSafe();
            if (!parseHttpUrl(url)) {
                safeNotify(uiT('securityPage.notify.invalidExternalUrl', 'Önce geçerli bir web sayfası açın (http/https).'), 'info');
                return;
            }
            try {
                const ok = await window.aurivo?.webSecurity?.openExternal?.(url);
                if (!ok) safeNotify(uiT('securityPage.notify.openInBrowserFailed', "Couldn't open in browser."), 'error');
            } catch (e) {
                safeNotify(uiT('securityPage.notify.openInBrowserError', "Couldn't open in browser: {error}", { error: e?.message || e }), 'error');
            }
        });
    }

    const clear = async (opts, okMsg) => {
        try {
            const ok = await window.aurivo?.webSecurity?.clearData?.(opts);
            if (!ok) {
                safeNotify(uiT('securityPage.notify.clearFailed', 'Clearing failed.'), 'error');
                return;
            }
            safeNotify(okMsg, 'success');
            updateSecurityUI();
        } catch (e) {
            safeNotify(uiT('securityPage.notify.clearError', 'Clearing error: {error}', { error: e?.message || e }), 'error');
        }
    };

    if (elements.securityClearCookiesBtn) {
        elements.securityClearCookiesBtn.addEventListener('click', () =>
            clear({ cookies: true }, uiT('securityPage.notify.cookiesCleared', 'Cookies cleared.'))
        );
    }
    if (elements.securityClearCacheBtn) {
        elements.securityClearCacheBtn.addEventListener('click', () =>
            clear({ cache: true }, uiT('securityPage.notify.cacheCleared', 'Cache cleared.'))
        );
    }
    if (elements.securityClearAllBtn) {
        elements.securityClearAllBtn.addEventListener('click', () =>
            clear({ all: true }, uiT('securityPage.notify.allCleared', 'Web data cleared.'))
        );
    }
    if (elements.securityResetWebBtn) {
        elements.securityResetWebBtn.addEventListener('click', () => {
            try {
                safeNavigateWebView('about:blank');
                safeNotify(uiT('securityPage.notify.webResetOk', 'Web has been reset.'), 'success');
                updateSecurityUI();
            } catch (e) {
                safeNotify(uiT('securityPage.notify.webResetFailed', "Couldn't reset Web: {error}", { error: e?.message || e }), 'error');
            }
        });
    }
}

// ============================================
// SİSTEM TEPSİSİ MEDYA KONTROLÜ
// ============================================
function setupSystemTrayControl() {
    if (!window.aurivo || !window.aurivo.onMediaControl) {
        console.warn('System tray API yok');
        return;
    }

    // Ana süreçten gelen medya kontrol komutlarını dinle
    window.aurivo.onMediaControl((action) => {
        console.log('System tray media control:', action);

        switch (action) {
            case 'play':
                if (!state.isPlaying) togglePlayPause();
                break;
            case 'pause':
                if (state.isPlaying) togglePlayPause();
                break;
            case 'play-pause':
                togglePlayPause();
                break;
            case 'stop':
                if (state.activeMedia === 'video') {
                    stopVideo();
                } else if (state.activeMedia === 'web') {
                    stopWeb();
                } else {
                    stopAudioWithPlaybackFade();
                }
                state.isPlaying = false;
                updatePlayPauseIcon(false);
                break;
            case 'previous':
                if (state.activeMedia === 'video') {
                    if (state.videoFiles.length > 1 && state.currentVideoIndex > 0) {
                        playPreviousVideo();
                    }
                } else if (state.activeMedia === 'audio' || state.activeMedia === 'web') {
                    playPreviousWithCrossfade();
                }
                break;
            case 'next':
                if (state.activeMedia === 'video') {
                    if (state.videoFiles.length > 1 && state.currentVideoIndex >= 0 && state.currentVideoIndex < state.videoFiles.length - 1) {
                        playNextVideo();
                    }
                } else if (state.activeMedia === 'audio' || state.activeMedia === 'web') {
                    playNextWithCrossfade();
                }
                break;
            case 'mute-toggle':
                toggleMute();
                break;
            case 'stop-after-current':
                state.stopAfterCurrent = !state.stopAfterCurrent;
                console.log('Stop after current:', state.stopAfterCurrent);
                updateTrayState(); // Tepsi menüsünü güncelle
                break;
            case 'like':
                // TODO: Beğen özelliği (favorilere ekle/çıkar)
                console.log('Like feature not implemented yet');
                break;
        }

        // Her medya kontrolden sonra tepsi durumunu güncelle
        updateTrayState();
    });

    // MPRIS seek olayı (ortam oynatıcıdan süre çubuğu sürükleme)
    if (window.aurivo.onMPRISSeek) {
        window.aurivo.onMPRISSeek(async (offsetMicroseconds) => {
            console.log('MPRIS seek offset (relative):', offsetMicroseconds);
            const offsetSeconds = offsetMicroseconds / 1000000;

            // ÖNCE aktif medya tipine göre yönlendir (web oynuyorsa native motor'a düşmesin)
            if (state.activeMedia === 'web' && elements.webView) {
                // Web/YouTube Göreli Atlama
                try {
                    const delta = Number(offsetSeconds);
                    if (!isNaN(delta) && isFinite(delta)) {
                        await elements.webView.executeJavaScript(`
                            (function(){
                                var v = document.querySelector('video, audio');
                                if (v) v.currentTime = Math.max(0, (v.currentTime || 0) + (${delta}));
                            })();
                        `);
                    }
                } catch (e) {
                    console.warn('Web seek error:', e);
                }
                return;
            }

            // Mevcut pozisyonu al ve offset ekle (yalnızca ses sekmesinde)
            if (state.activeMedia === 'audio' && useNativeAudio && window.aurivo?.audio) {
                try {
                    const currentPos = await window.aurivo.audio.getPosition(); // ms
                    const newPos = currentPos + (offsetSeconds * 1000); // ms
                    await window.aurivo.audio.seek(Math.max(0, newPos));
                    console.log('Seeked to:', newPos / 1000, 'seconds');
                } catch (e) {
                    console.error('Seek error:', e);
                }
            } else {
                seekBy(offsetSeconds);
            }
        });
    }

    // MPRIS position olayı (ortam oynatıcıdan pozisyon değişikliği - MUTLAK pozisyon)
    if (window.aurivo.onMPRISPosition) {
        window.aurivo.onMPRISPosition(async (positionMicroseconds) => {
            const positionSeconds = positionMicroseconds / 1000000;
            console.log('MPRIS SetPosition (absolute):', positionSeconds, 'seconds');

            // ÖNCE aktif medya tipine göre yönlendir (web oynuyorsa native motor'a düşmesin)
            if (state.activeMedia === 'web' && elements.webView) {
                // Web/YouTube Mutlak Atlama
                try {
                    const pos = Number(positionSeconds);
                    if (!isNaN(pos) && isFinite(pos)) {
                        await elements.webView.executeJavaScript(`
                            (function(){
                                var v = document.querySelector('video, audio');
                                if (v) v.currentTime = Math.max(0, ${pos});
                            })();
                        `);
                        // Arayüzü anında güncelle (gecikmeyi önlemek için)
                        state.webPosition = pos;
                        updateMPRISMetadata();
                    }
                } catch (e) {
                    console.warn('Web position error:', e);
                }
                return;
            }

            if (state.activeMedia === 'audio' && useNativeAudio && window.aurivo?.audio) {
                try {
                    await window.aurivo.audio.seek(positionSeconds * 1000); // saniye -> milisaniye
                    console.log('Position set to:', positionSeconds, 'seconds');
                } catch (e) {
                    console.error('SetPosition error:', e);
                }
            } else if (state.activeMedia === 'video' && elements.videoPlayer) {
                try {
                    const video = elements.videoPlayer;
                    const d = Number(video.duration || 0);
                    const pos = Math.max(0, Number(positionSeconds) || 0);
                    const next = d > 0 ? Math.min(d, pos) : pos;
                    video.currentTime = next;
                    updateTimeDisplay();
                    updateMPRISMetadata();
                } catch (e) {
                    console.warn('Video position error:', e);
                }
            } else {
                const activePlayer = getActiveAudioPlayer();
                if (activePlayer) activePlayer.currentTime = positionSeconds;
            }
        });
    }

    console.log('System tray media control listener kuruldu');
}

// Sistem tepsisine güncel oynatma durumu gönder
function updateTrayState() {
    if (!window.aurivo || !window.aurivo.updateTrayState) return;

    let trackName = uiT('nowPlaying.none', 'No Track');
    if (state.activeMedia === 'video') {
        trackName = state.currentVideoPath
            ? (window.aurivo?.path?.basename?.(state.currentVideoPath) || String(state.currentVideoPath).split('/').pop() || 'Video')
            : 'Video';
    } else if (state.activeMedia === 'web') {
        trackName = state.webTitle || elements.nowPlayingLabel?.textContent?.replace(`${uiT('nowPlaying.prefix', 'Now Playing')}: `, '') || 'Web';
    } else {
        const currentTrack = state.playlist[state.currentIndex];
        trackName = currentTrack ? (currentTrack.title || currentTrack.name || uiT('nowPlaying.unknownTrack', 'Unknown Track')) : uiT('nowPlaying.none', 'No Track');
    }

    window.aurivo.updateTrayState({
        isPlaying: state.isPlaying,
        isMuted: state.isMuted,
        stopAfterCurrent: state.stopAfterCurrent,
        currentTrack: trackName
    });
}

// Web/YouTube gezintisinde MPRIS'i sıfırla
async function handleWebNavigation() {
    const currentUrl = getWebViewUrlSafe();
    if (state.activeMedia === 'web') {
        const sec = await getSecurityStateSafe();
        if (sec.vpnDetected) {
            if (isStrictVpnBlockEnabled() && !isYoutubeHost(currentUrl)) {
                safeNavigateWebView('about:blank');
                safeNotify(uiT('securityPage.notify.vpnBlocked', 'VPN algılandı. Güvenlik nedeniyle Web sekmesi geçici olarak engellendi.'), 'error');
                if (isSecuritySettingsVisible()) updateSecurityUI();
                return;
            }
            if (!securityRuntime.vpnWarned) {
                securityRuntime.vpnWarned = true;
                safeNotify(uiT('securityPage.notify.vpnWarning', 'VPN algılandı. Güvenlik için yalnızca izinli platformlar açılacaktır.'), 'info');
            }
        } else {
            securityRuntime.vpnWarned = false;
        }
        if (currentUrl !== 'about:blank' && !isAllowedWebUrl(currentUrl)) {
            safeNavigateWebView('about:blank');
            safeNotify(uiT('securityPage.notify.urlBlocked', 'Bu adres güvenlik politikası nedeniyle engellendi.'), 'error');
            if (isSecuritySettingsVisible()) updateSecurityUI();
            return;
        }
    }

    if (state.activeMedia === 'web') {
        syncActivePlatformButtonByUrl(currentUrl);
        console.log('[WEB] Navigation detected, resetting MPRIS position');
        state.webTrackId++; // Yeni bir ID atayarak sistemin "yeni parça" algılamasını sağla
        state.webPosition = 0;
        state.webDuration = 0;
        state.webTitle = '';
        state.webArtist = '';
        state.webAlbum = '';
        // Metadata güncellemesi ile süreyi 0'a çek
        updateMPRISMetadata();
    }

    // Güvenlik sayfası URL farkındadır
    if (isSecuritySettingsVisible()) {
        updateSecurityUI();
    }
}

// MPRIS'e metadata gönder (Linux ortam oynatıcısı)
async function updateMPRISMetadata() {
    if (!window.aurivo || !window.aurivo.updateMPRISMetadata) return;

    // Süre ve pozisyon al
    let duration = 0;
    let position = 0;
    let title = 'Bilinmeyen';
    let artist = uiT('nowPlaying.unknownArtist', 'Unknown Artist');
    let album = '';
    let trackId = state.currentIndex;
    let canGoNext = true;
    let canGoPrevious = true;
    let canSeek = true;

    if (state.activeMedia === 'video') {
        // Video için metadata
        const video = elements.videoPlayer;
        if (video && video.src) {
            duration = video.duration || 0; // saniye
            position = video.currentTime || 0; // saniye

            // Video dosya adından başlık çıkar
            const fileName = window.aurivo?.path?.basename?.(state.currentVideoPath || '') || video.src.split('/').pop().split('#')[0].split('?')[0];
            title = decodeURIComponent(String(fileName || '')).replace(/\.[^/.]+$/, '') || 'Video';
            artist = 'Video';
            // DÜZELTME: DBus objectPath için '-' gibi karakterler sorun çıkarabilir; güvenli parçaId üret.
            trackId = `video_${Math.max(0, Number(state.currentVideoIndex) || 0)}`;
            canGoNext = state.videoFiles.length > 1 && state.currentVideoIndex < state.videoFiles.length - 1;
            canGoPrevious = state.videoFiles.length > 1 && state.currentVideoIndex > 0;
        }
    } else if (state.activeMedia === 'audio') {
        // Ses için metadata
        const currentTrack = state.playlist[state.currentIndex];
        if (!currentTrack) return;

        // Dosya adından metadata çıkar
        const fileName = currentTrack.name || '';
        title = currentTrack.title || fileName.replace(/\.[^/.]+$/, ''); // Uzantıyı kaldır
        artist = currentTrack.artist || uiT('nowPlaying.unknownArtist', 'Unknown Artist');
        album = currentTrack.album || '';

        // Eğer title yoksa dosya adından parse et
        if (!currentTrack.title && fileName.includes(' - ')) {
            const parts = fileName.split(' - ');
            if (parts.length >= 2) {
                artist = parts[0].trim();
                title = parts[1].replace(/\.[^/.]+$/, '').trim();
            }
        }

        if (useNativeAudio && window.aurivo?.audio) {
            try {
                // getDuration saniye döndürür, getPosition milisaniye
                duration = await window.aurivo.audio.getDuration(); // saniye
                position = (await window.aurivo.audio.getPosition()) / 1000; // ms -> saniye
            } catch (e) {
                // yoksay
            }
        } else {
            const activePlayer = getActiveAudioPlayer();
            duration = activePlayer.duration || 0; // saniye
            position = activePlayer.currentTime || 0; // saniye
        }
        canGoNext = state.playlist.length > 0 && state.currentIndex < state.playlist.length - 1;
        canGoPrevious = state.playlist.length > 0 && state.currentIndex > 0;
    } else if (state.activeMedia === 'web') {
        title = state.webTitle || elements.nowPlayingLabel.textContent.replace(`${uiT('nowPlaying.prefix', 'Now Playing')}: `, '') || uiT('web.media', 'Web Media');
        artist = state.webArtist || 'Aurivo Web';
        album = state.webAlbum || 'Online';
        trackId = `web_${state.webTrackId}`; // DÜZELTME: Daha güvenli DBus yolu için tire alt çizgiyle değiştirildi
        duration = state.webDuration || 0;
        position = state.webPosition || 0;
        // Web platformlarında ileri/geri komutlarını JS ile yönlendirdiğimiz için etkin bırak.
        canGoNext = true;
        canGoPrevious = true;
        canSeek = true;
    }

    window.aurivo.updateMPRISMetadata({
        trackId: trackId,
        title: title,
        artist: artist,
        album: album,
        albumArt: state.currentCover || '',
        duration: duration,
        position: position,
        isPlaying: state.isPlaying,
        canGoNext,
        canGoPrevious,
        canSeek
    });
}

// Web/YouTube senkronizasyon işleyicisi
function handleWebSync(data) {
    if (state.activeMedia !== 'web') return;

    if (data.type === 'metadata') {
        state.webTitle = data.title || '';
        state.webArtist = data.artist || '';
        state.webAlbum = data.album || '';

        if (state.webTitle) elements.nowPlayingLabel.textContent = `${uiT('nowPlaying.prefix', 'Now Playing')}: ${state.webTitle}`;
        if (data.artwork) updateCoverArt(data.artwork, 'web');

        updateTrayState();
        updateMPRISMetadata();
        return;
    }

    if (data.type === 'volume') {
        applyWebVolumeToUi(data.volume, data.muted);
        return;
    }

    state.webPosition = data.currentTime || 0;
    state.webDuration = data.duration || 0;

    // timeupdate yükü duraklatma durumunu taşıyabilir (yoklama)
    if (data.type === 'timeupdate' && typeof data.paused === 'boolean') {
        const nextPlaying = !data.paused;
        if (state.isPlaying !== nextPlaying) {
            state.isPlaying = nextPlaying;
            updatePlayPauseIcon(nextPlaying);
            updateTrayState();
            updateMPRISMetadata();
        }
    }

    if (data.type === 'play') {
        state.isPlaying = true;
        updatePlayPauseIcon(true);
        updateTrayState();
        updateMPRISMetadata();
    } else if (data.type === 'pause') {
        state.isPlaying = false;
        updatePlayPauseIcon(false);
        updateTrayState();
        updateMPRISMetadata();
        scheduleRememberPlaybackStartupState(220);
    } else if (data.type === 'seeked' || data.type === 'durationchange' || data.type === 'loadeddata') {
        updateMPRISMetadata();
    }

    // UI Güncelleme (Süre ve Slider)
    if (elements.currentTime && elements.durationTime) {
        elements.currentTime.textContent = formatTime(state.webPosition);
        elements.durationTime.textContent = formatTime(state.webDuration);
    }
    if (elements.seekSlider && state.webDuration > 0) {
        const progress = (state.webPosition / state.webDuration) * 1000;
        elements.seekSlider.value = progress;
        updateRainbowSlider(elements.seekSlider, progress / 10);
    }

}

function pushAppVolumeToWeb() {
    if (state.activeMedia !== 'web' || !elements.webView) return;

    const vol = Math.max(0, Math.min(100, Number(state.volume) || 0));
    const muted = !!state.isMuted || vol === 0;
    const target = Math.max(0, Math.min(1, vol / 100));

    webVolumeSync.ignoreIncomingUntil = Date.now() + 250;
    elements.webView.executeJavaScript(`
        (function() {
            const volPct = ${vol};
            const wantMuted = ${muted ? 'true' : 'false'};

            // YouTube player API varsa onu tercih et (UI slider da güncellensin)
            const yt = document.getElementById('movie_player');
            if (yt && typeof yt.setVolume === 'function') {
                try { yt.setVolume(volPct); } catch (e) {}
                try {
                    if (wantMuted) {
                        if (typeof yt.mute === 'function') yt.mute();
                    } else {
                        if (typeof yt.unMute === 'function') yt.unMute();
                    }
                } catch (e) {}
            }

            const m = document.querySelector('video.html5-main-video, video, audio');
            if (!m) return false;
            m.volume = ${target};
            m.muted = wantMuted;
            return true;
        })();
    `).catch(() => {
        // yoksay
    });
}

function applyWebVolumeToUi(rawVolume, rawMuted) {
    if (Date.now() < webVolumeSync.ignoreIncomingUntil) return;

    const volume01 = Math.max(0, Math.min(1, Number(rawVolume) || 0));
    const percent = Math.round(volume01 * 100);
    const muted = !!rawMuted || percent === 0;

    state.volume = percent;
    state.isMuted = muted;
    if (!muted) state.savedVolume = percent;

    if (elements.volumeSlider) {
        elements.volumeSlider.value = percent;
        updateRainbowSlider(elements.volumeSlider, percent);
    }
    if (elements.volumeLabel) elements.volumeLabel.textContent = `${percent}%`;
    updateAudioAppVolumeUi(percent);

    const fsVolumeSlider = document.getElementById('fsVolumeSlider');
    const fsVolumeLabel = document.getElementById('fsVolumeLabel');
    if (fsVolumeSlider) {
        fsVolumeSlider.value = percent;
        updateRainbowSlider(fsVolumeSlider, percent);
    }
    if (fsVolumeLabel) fsVolumeLabel.textContent = `${percent}%`;

    updateVolumeIcon();
    updateFsVolumeIcon();
}

function setupDragAndDrop() {
    const dropZone = elements.playlist;
    const appDropZone = document.body;

    // Varsayılan sürükleme davranışlarını engelle
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, preventDefaults, false);
        appDropZone.addEventListener(eventName, preventDefaults, false);
    });

    // Öğe üzerine sürüklendiğinde bırakma alanını vurgula
    ['dragenter', 'dragover'].forEach(eventName => {
        dropZone.addEventListener(eventName, () => {
            dropZone.classList.add('drag-over');
        }, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, () => {
            dropZone.classList.remove('drag-over');
        }, false);
    });

    // Bırakılan dosyaları tek noktadan yakala; çift tetiklenmeyi önle
    appDropZone.addEventListener('drop', handleFileDrop, false);
}

// Ağaç öğesi sürükleme başlangıcı
function handleTreeItemDragStart(e) {
    // Seçili tüm dosyaları al
    const selectedItems = document.querySelectorAll('.tree-item.file.selected');

    // Eğer sürüklenen öğe seçili değilse, sadece onu seç
    if (!e.target.closest('.tree-item').classList.contains('selected')) {
        document.querySelectorAll('.tree-item.file').forEach(i => i.classList.remove('selected'));
        e.target.closest('.tree-item').classList.add('selected');
    }

    // Seçili dosya yollarını JSON olarak aktar
    const filePaths = [];
    document.querySelectorAll('.tree-item.file.selected').forEach(item => {
        filePaths.push({
            path: item.dataset.path,
            name: item.dataset.name
        });
    });

    e.dataTransfer.setData('text/aurivo-files', JSON.stringify(filePaths));
    e.dataTransfer.effectAllowed = 'copy';

    // Sürükleme görselini ayarla
    e.target.closest('.tree-item').classList.add('dragging');
}

// Ağaç öğesi sürükleme bitişi
function handleTreeItemDragEnd(e) {
    e.target.closest('.tree-item').classList.remove('dragging');
}

function preventDefaults(e) {
    e.preventDefault();
    e.stopPropagation();
    try {
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    } catch {
        // yoksay
    }
}

// ============================================
// SES OYNATICI OLAY KURULUMU
// ============================================
function setupAudioPlayerEvents(player, playerId) {
    // Zaman güncelleme
    player.addEventListener('timeupdate', () => {
        // Native ses kullanıyorken HTML5 audio event'lerini tamamen devre dışı bırak
        if (useNativeAudio) return;

        // Sadece aktif oynatıcı için güncelle
        if (getActiveAudioPlayer() === player) {
            updateTimeDisplay();
            // Otomatik çapraz geçiş kontrolü
            maybeStartAutoCrossfade();
            const sec = Math.floor(Number(player.currentTime) || 0);
            if (sec >= 0 && sec % 8 === 0 && sec !== state.playbackStatePersistSecond) {
                state.playbackStatePersistSecond = sec;
                scheduleRememberPlaybackStartupState(260);
            }
        }
    });

    // Metadata yüklendiğinde
    player.addEventListener('loadedmetadata', () => {
        // Native ses kullanıyorken HTML5 audio event'lerini tamamen devre dışı bırak
        if (useNativeAudio) return;

        if (getActiveAudioPlayer() === player) {
            handleMetadataLoaded();
        }
    });

    // Parça bittiğinde
    player.addEventListener('ended', () => {
        // Native ses kullanıyorken HTML5 audio event'lerini tamamen devre dışı bırak
        if (useNativeAudio) return;

        if (getActiveAudioPlayer() === player) {
            handleTrackEnded();
        }
    });

    // Play/Pause durumu
    player.addEventListener('play', () => {
        // Native ses kullanıyorken HTML5 audio event'lerini tamamen devre dışı bırak
        if (useNativeAudio) return;

        if (getActiveAudioPlayer() === player) {
            updatePlayPauseIcon(true);
        }
    });

    player.addEventListener('pause', () => {
        // Native ses kullanıyorken HTML5 audio event'lerini tamamen devre dışı bırak
        if (useNativeAudio) return;

        if (getActiveAudioPlayer() === player) {
            updatePlayPauseIcon(false);
        }
    });
}

// Video Oynatıcı Olay Dinleyicileri
function setupVideoPlayerEvents() {
    const video = elements.videoPlayer;
    if (!video) return;

    // Zaman güncelleme
    video.addEventListener('timeupdate', () => {
        if (state.activeMedia === 'video') {
            updateTimeDisplay();

            // MPRIS position'ını sınırla (her 2 saniyede bir)
            const currentSecInt = Math.floor(video.currentTime || 0);
            if (currentSecInt !== state.lastMPRISPosition && currentSecInt % 2 === 0) {
                state.lastMPRISPosition = currentSecInt;
                updateMPRISMetadata();
            }
        }
    });

    // Metadata yüklendiğinde
    video.addEventListener('loadedmetadata', () => {
        if (state.activeMedia === 'video') {
            updateTimeDisplay();
            updateMPRISMetadata();
        }
    });

    // Video bittiğinde
    video.addEventListener('ended', () => {
        if (state.activeMedia === 'video') {
            state.isPlaying = false;
            updatePlayPauseIcon(false);
            renderVideoLibraryTree();
            updateTrayState();
            updateMPRISMetadata();

            // Sıradaki videoyu çal (kütüphaneden)
            playNextVideo();
        }
    });

    // Play/Pause durumu
    video.addEventListener('play', () => {
        if (state.activeMedia === 'video') {
            state.isPlaying = true;
            updatePlayPauseIcon(true);
            renderVideoLibraryTree();
            updateTrayState();
            updateMPRISMetadata();
        }
    });

    video.addEventListener('pause', () => {
        if (state.activeMedia === 'video') {
            state.isPlaying = false;
            updatePlayPauseIcon(false);
            renderVideoLibraryTree();
            updateTrayState();
            updateMPRISMetadata();
        }
    });
}

// Video tam ekran geçişi
function toggleVideoFullscreen() {
    const videoPage = document.getElementById('videoPage');

    if (!document.fullscreenElement) {
        // Tam ekrana geç
        if (videoPage.requestFullscreen) {
            videoPage.requestFullscreen();
        } else if (videoPage.webkitRequestFullscreen) {
            videoPage.webkitRequestFullscreen();
        } else if (videoPage.mozRequestFullScreen) {
            videoPage.mozRequestFullScreen();
        }
    } else {
        // Tam ekrandan çık
        if (document.exitFullscreen) {
            document.exitFullscreen();
        } else if (document.webkitExitFullscreen) {
            document.webkitExitFullscreen();
        } else if (document.mozCancelFullScreen) {
            document.mozCancelFullScreen();
        }
    }
}

// ============================================
// TAM EKRAN VIDEO KONTROL PANELİ
// Python uygulamasından uyarlandı
// ============================================

// Tam ekran kontrol durumu
const fsControlState = {
    hideTimer: null,
    hideDelay: 3000, // 3 saniye
    isVisible: true,
    currentSpeed: 1.0,
    currentFps: 0, // 0 = Otomatik
    seeking: false,
    currentBrightness: 1.0,
    isMenuOpen: false,
    sleepTimerId: null,
    currentAutoQualityRes: '720p50'
};

const fsHudState = {
    volumeTimer: null,
    brightnessTimer: null
};

function fsT(key, fallback, vars) {
    try {
        const v = window.i18n?.tSync?.(key, vars);
        if (typeof v === 'string' && v && v !== key) return v;
    } catch {
        // yoksay
    }
    return fallback ?? String(key);
}

function uiT(key, fallback, vars) {
    try {
        const v = window.i18n?.tSync?.(key, vars);
        if (typeof v === 'string' && v && v !== key) return v;
    } catch {
        // yoksay
    }
    return fallback ?? String(key);
}

function refreshLanguageSensitiveLibraryUi() {
    try {
        renderPlaylist();
    } catch {}
    try {
        renderLibraryFolderSettings();
    } catch {}
    try {
        updateLibraryMetadataStatusUi();
    } catch {}
    try {
        updateLibraryCleanupStatus();
    } catch {}
    try {
        updateLibraryFlowsStatusUi();
    } catch {}
    try {
        updateLibraryTransferStatus();
    } catch {}
    try {
        updateLibraryPerformanceStatusUi();
    } catch {}
    try {
        updateLibraryDiagnosticsUi();
    } catch {}
    try {
        updateLibraryAddButtonUi();
    } catch {}
    try {
        syncAudioLibraryRootViewIfNeeded();
    } catch {}
}

window.addEventListener('aurivo:languageChanged', () => {
    refreshLanguageSensitiveLibraryUi();
});

function getFsOnOffLabel(enabled) {
    return enabled ? fsT('videoFs.state.on', 'On') : fsT('videoFs.state.off', 'Off');
}

function getFsSleepLabel(minutes) {
    const m = Number(minutes) || 0;
    if (m > 0) return `${m} ${fsT('videoFs.sleep.minutesShort', 'min')}`;
    return fsT('videoFs.state.off', 'Off');
}

function getFsSpeedLabel(speed) {
    const s = Number(speed);
    if (!Number.isFinite(s)) return fsT('videoFs.speed.normal', 'Normal');
    return s === 1 ? fsT('videoFs.speed.normal', 'Normal') : String(s);
}

function getFsQualityLabel(quality) {
    const q = String(quality || 'auto');
    if (q === 'auto') {
        return fsT('videoFs.quality.autoWith', `Auto (${fsControlState.currentAutoQualityRes})`, { res: fsControlState.currentAutoQualityRes });
    }
    return q;
}

let fsSettingsCaptureBound = false;

const fsMenuPortalMap = new WeakMap();

function portalizeFsMenu(menuEl) {
    // Portal devre dışı - menüler videoFsControls içinde kalacak
    // Bu video overlay düzlemi sorunlarını önler
    console.log('🔧 [DEBUG] portalizeFsMenu devre dışı - menü içeride kalıyor:', menuEl?.id);
    return;
}

function syncFsMenuOpenState() {
    const anyOpen =
        !document.getElementById('fsSettingsMenu')?.classList.contains('hidden') ||
        !document.getElementById('fsQualityMenu')?.classList.contains('hidden') ||
        !document.getElementById('fsSpeedMenu')?.classList.contains('hidden');
    fsControlState.isMenuOpen = !!anyOpen;
}

function isVideoFullscreenActive() {
    const videoPage = document.getElementById('videoPage');
    if (!videoPage) return false;

    const activeEl =
        document.fullscreenElement ||
        document.webkitFullscreenElement ||
        document.mozFullScreenElement;

    // Bazı sistemlerde tam ekran video elementinde/child node'da açılabiliyor.
    // Bu durumda da video sayfası tam ekran kabul edilsin.
    return !!activeEl && (activeEl === videoPage || videoPage.contains(activeEl));
}

function isFsSettingsButtonHit(e, pad = 10) {
    const btn = document.getElementById('fsSettingsBtn');
    if (!btn) return false;
    if (e?.target?.closest?.('#fsSettingsBtn')) return true;

    const rect = btn.getBoundingClientRect();
    if (typeof e?.clientX !== 'number' || typeof e?.clientY !== 'number') return false;
    return (
        e.clientX >= (rect.left - pad) && e.clientX <= (rect.right + pad) &&
        e.clientY >= (rect.top - pad) && e.clientY <= (rect.bottom + pad)
    );
}

function ensureFsWheelHud() {
    const videoPage = document.getElementById('videoPage');
    if (!videoPage) return;

    if (!document.getElementById('fsVolumeWheelHud')) {
        const el = document.createElement('div');
        el.id = 'fsVolumeWheelHud';
        el.className = 'fs-wheel-hud left hidden';
        el.innerHTML = `
            <span class="material-symbols-rounded fs-wheel-hud-icon" aria-hidden="true">volume_up</span>
            <span class="fs-wheel-hud-value" id="fsVolumeWheelHudValue">0%</span>
            <div class="fs-wheel-hud-bar" aria-hidden="true"><div class="fs-wheel-hud-bar-fill" id="fsVolumeWheelHudFill"></div></div>
        `;
        videoPage.appendChild(el);
    }

    if (!document.getElementById('fsBrightnessWheelHud')) {
        const el = document.createElement('div');
        el.id = 'fsBrightnessWheelHud';
        el.className = 'fs-wheel-hud right hidden';
        el.innerHTML = `
            <span class="material-symbols-rounded fs-wheel-hud-icon" aria-hidden="true">brightness_6</span>
            <span class="fs-wheel-hud-value" id="fsBrightnessWheelHudValue">100%</span>
            <div class="fs-wheel-hud-bar" aria-hidden="true"><div class="fs-wheel-hud-bar-fill" id="fsBrightnessWheelHudFill"></div></div>
        `;
        videoPage.appendChild(el);
    }
}

function showFsWheelHud(type, percent) {
    const safePercent = clampNumber(Math.round(percent), 0, 999);

    if (type === 'volume') {
        const hud = document.getElementById('fsVolumeWheelHud');
        const value = document.getElementById('fsVolumeWheelHudValue');
        const fill = document.getElementById('fsVolumeWheelHudFill');
        const icon = hud?.querySelector('.fs-wheel-hud-icon');
        if (!hud || !value) return;
        value.textContent = `${safePercent}%`;
        if (icon) icon.textContent = safePercent === 0 ? 'volume_off' : (safePercent <= 50 ? 'volume_down' : 'volume_up');
        if (fill) fill.style.height = `${clampNumber(safePercent, 0, 100)}%`;
        hud.classList.remove('hidden');
        if (fsHudState.volumeTimer) clearTimeout(fsHudState.volumeTimer);
        fsHudState.volumeTimer = setTimeout(() => hud.classList.add('hidden'), 900);
        return;
    }

    if (type === 'brightness') {
        const hud = document.getElementById('fsBrightnessWheelHud');
        const value = document.getElementById('fsBrightnessWheelHudValue');
        const fill = document.getElementById('fsBrightnessWheelHudFill');
        if (!hud || !value) return;
        value.textContent = `${safePercent}%`;
        // Parlaklık aralığı: 35% - 200% => fill'i 0-100 aralığına normalize et
        if (fill) {
            const normalized = ((safePercent - 35) / (200 - 35)) * 100;
            fill.style.height = `${clampNumber(normalized, 0, 100)}%`;
        }
        hud.classList.remove('hidden');
        if (fsHudState.brightnessTimer) clearTimeout(fsHudState.brightnessTimer);
        fsHudState.brightnessTimer = setTimeout(() => hud.classList.add('hidden'), 900);
    }
}

function setFsMenuVisible(menuEl, visible) {
    if (!menuEl) {
        console.error('❌ [DEBUG] setFsMenuVisible: menuEl null!');
        return;
    }

    console.log('🔧 [DEBUG] setFsMenuVisible çağrıldı:', menuEl.id, 'visible:', visible);

    if (visible) {
        // Sadece hidden class'ını kaldır - CSS halleder
        menuEl.classList.remove('hidden');

        // Kesinlikle göster
        menuEl.style.removeProperty('display');
        menuEl.style.removeProperty('visibility');
        menuEl.style.removeProperty('opacity');

        console.log('✅ [DEBUG] Menü açıldı:', {
            id: menuEl.id,
            hidden: menuEl.classList.contains('hidden'),
            parent: menuEl.parentElement?.id,
            rect: menuEl.getBoundingClientRect(),
            computedDisplay: window.getComputedStyle(menuEl).display,
            computedVisibility: window.getComputedStyle(menuEl).visibility,
            computedOpacity: window.getComputedStyle(menuEl).opacity,
            computedZIndex: window.getComputedStyle(menuEl).zIndex
        });
        syncFsMenuOpenState();
        return;
    }

    // Kapat
    menuEl.classList.add('hidden');
    console.log('🔧 [DEBUG] Menü kapatıldı:', menuEl.id);
    syncFsMenuOpenState();
}

function setupFullscreenVideoControls() {
    const videoPage = document.getElementById('videoPage');
    const fsControls = document.getElementById('videoFsControls');
    const video = elements.videoPlayer;

    if (!videoPage || !fsControls || !video) return;

    // HUD'ları hazırla (ses/parlaklık yüzdesi)
    ensureFsWheelHud();

    // Ayarlar butonunu capture-phase'de yakala (başka handler'lar yutmasın)
    if (!fsSettingsCaptureBound) {
        const handler = (e) => {
            console.log('🔧 [DEBUG] Capture-phase handler tetiklendi:', {
                type: e.type,
                target: e.target?.id || e.target?.className,
                fullscreen: isVideoFullscreenActive(),
                buttonHit: isFsSettingsButtonHit(e)
            });
            if (!isVideoFullscreenActive()) return;
            if (isFsSettingsButtonHit(e)) {
                console.log('✅ [DEBUG] Settings button HIT! handleFsSettingsClick çağrılıyor');
                // Bubble-phase click-outside handler menüyü anında kapatmasın
                e?.preventDefault?.();
                e?.stopPropagation?.();
                e?.stopImmediatePropagation?.();
                handleFsSettingsClick(e);
            }
        };

        // Sadece click kullan - pointerdown/mousedown kaldırıldı
        document.addEventListener('click', handler, true);
        fsSettingsCaptureBound = true;
    }

    // Fullscreen change event listener
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    document.addEventListener('mozfullscreenchange', handleFullscreenChange);

    // Mouse movement - SADECE VIDEO SAYFASINDA
    videoPage.addEventListener('mousemove', handleVideoMouseMove);

    // Sol/sağ kenarda mouse tekerleği ile ses/parlaklık
    // (passive:false gerekli, yoksa preventDefault çalışmaz)
    videoPage.addEventListener('wheel', handleFullscreenWheel, { passive: false });

    // MOUSE BAR ÜZERİNDE - Timer'ı durdur (kaybolmasın)
    fsControls.addEventListener('mouseenter', () => {
        if (isVideoFullscreenActive()) {
            stopFsHideTimer();
        }
    });

    // MOUSE BAR'DAN ÇIKTI - Timer'ı başlat (kaybolsun)
    fsControls.addEventListener('mouseleave', () => {
        if (isVideoFullscreenActive()) {
            startFsHideTimer();
        }
    });

    // Seek slider
    const fsSeekSlider = document.getElementById('fsSeekSlider');
    fsSeekSlider.addEventListener('input', handleFsSeekInput);
    fsSeekSlider.addEventListener('change', handleFsSeekChange);

    // Play/Pause
    document.getElementById('fsPlayBtn').addEventListener('click', handleFsPlayPause);

    // Prev/Next Video
    document.getElementById('fsPrevBtn').addEventListener('click', () => playPreviousVideo());
    document.getElementById('fsNextBtn').addEventListener('click', () => playNextVideo());

    // ±10 saniye
    document.getElementById('fsBack10Btn').addEventListener('click', () => seekVideoRelative(-10));
    document.getElementById('fsFwd10Btn').addEventListener('click', () => seekVideoRelative(10));

    // Ses kontrolü
    document.getElementById('fsMuteBtn').addEventListener('click', handleFsMute);
    document.getElementById('fsVolumeSlider').addEventListener('input', handleFsVolumeChange);

    // Hız
    document.getElementById('fsSpeedBtn').addEventListener('click', handleFsSpeedClick);

    // FPS
    document.getElementById('fsFpsBtn').addEventListener('click', handleFsFpsClick);

    // Ayarlar (event delegation: DOM değişse bile çalışsın)
    videoPage.addEventListener('click', (e) => {
        if (!isVideoFullscreenActive()) return;
        if (e.target?.closest('#fsSettingsBtn')) {
            handleFsSettingsClick(e);
        }
    });

    // Ayarlar menüsü item'ları (YouTube tarzı)
    document.querySelectorAll('#fsSettingsMenu .yt-settings-item.dropdown-item').forEach(item => {
        item.addEventListener('click', (e) => {
            const setting = e.currentTarget?.dataset?.setting;
            if (setting === 'quality') {
                setFsMenuVisible(document.getElementById('fsSettingsMenu'), false);
                const qm = document.getElementById('fsQualityMenu');
                setFsMenuVisible(qm, true);
                anchorFullscreenMenu(qm);
                showFsControls();
                stopFsHideTimer();
                syncFsMenuOpenState();
            } else if (setting === 'playback-speed') {
                setFsMenuVisible(document.getElementById('fsSettingsMenu'), false);
                const sm = document.getElementById('fsSpeedMenu');
                setFsMenuVisible(sm, true);
                anchorFullscreenMenu(sm);
                showFsControls();
                stopFsHideTimer();
                syncFsMenuOpenState();
            } else if (setting === 'subtitles') {
                setFsMenuVisible(document.getElementById('fsSettingsMenu'), false);
                const sub = document.getElementById('fsSubtitlesMenu');
                setFsMenuVisible(sub, true);
                anchorFullscreenMenu(sub);
                showFsControls();
                stopFsHideTimer();
                syncFsMenuOpenState();
            } else if (setting === 'sleep-timer') {
                setFsMenuVisible(document.getElementById('fsSettingsMenu'), false);
                const sl = document.getElementById('fsSleepMenu');
                setFsMenuVisible(sl, true);
                anchorFullscreenMenu(sl);
                showFsControls();
                stopFsHideTimer();
                syncFsMenuOpenState();
            }
        });
    });

    // Aç/Kapat switches (stable-volume, volume-boost, cinematic-lighting, annotations)
    document.querySelectorAll('#fsSettingsMenu .yt-toggle-switch').forEach(sw => {
        sw.addEventListener('click', (e) => {
            e.stopPropagation();
            const setting = e.currentTarget?.dataset?.setting;
            toggleFsSetting(setting);
        });
    });
    document.querySelectorAll('#fsSettingsMenu .yt-settings-item.toggle-item').forEach(row => {
        row.addEventListener('click', (e) => {
            // Allow clicking anywhere on the row to toggle
            const sw = e.currentTarget?.querySelector?.('.yt-toggle-switch');
            const setting = sw?.dataset?.setting;
            if (!setting) return;
            // Avoid double-toggle if the switch itself handled it
            if (e.target?.closest?.('.yt-toggle-switch')) return;
            toggleFsSetting(setting);
        });
    });

    // Geri butonları
    document.querySelectorAll('.yt-back-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const target = e.currentTarget.dataset.back;
            if (target === 'main') {
                setFsMenuVisible(document.getElementById('fsQualityMenu'), false);
                setFsMenuVisible(document.getElementById('fsSpeedMenu'), false);
                setFsMenuVisible(document.getElementById('fsSubtitlesMenu'), false);
                setFsMenuVisible(document.getElementById('fsSleepMenu'), false);
                const menu = document.getElementById('fsSettingsMenu');
                setFsMenuVisible(menu, true);
                anchorFullscreenMenu(menu);
                showFsControls();
                stopFsHideTimer();
                syncFsMenuOpenState();
            }
        });
    });

    // Kalite seçimi
    document.querySelectorAll('#fsQualityMenu [data-quality]').forEach(item => {
        item.addEventListener('click', (e) => {
            const quality = e.currentTarget.dataset.quality;
            document.querySelectorAll('#fsQualityMenu [data-quality]').forEach(i => i.classList.remove('active'));
            e.currentTarget.classList.add('active');
            if (quality === 'auto') fsControlState.currentAutoQualityRes = '1080p';
            const cq = document.getElementById('currentQuality');
            if (cq) cq.textContent = getFsQualityLabel(quality);
            // Menüyü kapat
            setFsMenuVisible(document.getElementById('fsQualityMenu'), false);
            syncFsMenuOpenState();
        });
    });

    // Oynatma hızı seçimi
    document.querySelectorAll('#fsSpeedMenu [data-speed]').forEach(item => {
        item.addEventListener('click', (e) => {
            const speed = parseFloat(e.currentTarget.dataset.speed);
            document.querySelectorAll('#fsSpeedMenu [data-speed]').forEach(i => i.classList.remove('active'));
            e.currentTarget.classList.add('active');
            elements.videoPlayer.playbackRate = speed;
            fsControlState.currentSpeed = speed;
            const cps = document.getElementById('currentPlaybackSpeed');
            if (cps) cps.textContent = getFsSpeedLabel(speed);

            const speedBtn = document.getElementById('fsSpeedBtn');
            if (speedBtn) speedBtn.textContent = speed.toFixed(1) + 'x';
            // Menüyü kapat
            setFsMenuVisible(document.getElementById('fsSpeedMenu'), false);
            syncFsMenuOpenState();
        });
    });

    // Subtitles (placeholder)
    document.querySelectorAll('#fsSubtitlesMenu [data-subtitles]').forEach(item => {
        item.addEventListener('click', (e) => {
            const value = String(e.currentTarget.dataset.subtitles || 'off');
            if (value === 'soon') {
                safeNotify(fsT('videoFs.notify.subtitlesSoon', 'Subtitles will be added soon.'), 'info', 2600);
                return;
            }

            document.querySelectorAll('#fsSubtitlesMenu [data-subtitles]').forEach(i => i.classList.remove('active'));
            e.currentTarget.classList.add('active');

            if (!state.settings?.videoFullscreen) state.settings.videoFullscreen = {};
            state.settings.videoFullscreen.subtitles = 'off';
            const label = document.getElementById('fsCurrentSubtitles');
            if (label) label.textContent = fsT('videoFs.state.off', 'Off');
            saveSettings();

            setFsMenuVisible(document.getElementById('fsSubtitlesMenu'), false);
            syncFsMenuOpenState();
        });
    });

    // Sleep timer
    document.querySelectorAll('#fsSleepMenu [data-sleep]').forEach(item => {
        item.addEventListener('click', (e) => {
            const value = String(e.currentTarget.dataset.sleep || 'off');
            let minutes = 0;
            if (value !== 'off') minutes = parseInt(value, 10) || 0;

            document.querySelectorAll('#fsSleepMenu [data-sleep]').forEach(i => i.classList.remove('active'));
            e.currentTarget.classList.add('active');

            setFsSleepTimer(minutes);

            setFsMenuVisible(document.getElementById('fsSleepMenu'), false);
            syncFsMenuOpenState();
        });
    });

    // Menü dışına tıklayınca kapat
    document.addEventListener('click', (e) => {
        // Settings butonuna tıklandıysa, o zaten toggle yapıyor - burada dokunma
        if (isFsSettingsButtonHit(e)) {
            console.log('🔧 [DEBUG] Click-outside: Settings butonuna tıklandı, skip');
            return;
        }

        const insideAnyMenu =
            !!e.target.closest('#fsSettingsMenu') ||
            !!e.target.closest('#fsQualityMenu') ||
            !!e.target.closest('#fsSpeedMenu') ||
            !!e.target.closest('#fsSubtitlesMenu') ||
            !!e.target.closest('#fsSleepMenu');

        if (!insideAnyMenu) {
            console.log('🔧 [DEBUG] Click-outside: Menüleri kapatıyor');
            setFsMenuVisible(document.getElementById('fsSettingsMenu'), false);
            setFsMenuVisible(document.getElementById('fsQualityMenu'), false);
            setFsMenuVisible(document.getElementById('fsSpeedMenu'), false);
            setFsMenuVisible(document.getElementById('fsSubtitlesMenu'), false);
            setFsMenuVisible(document.getElementById('fsSleepMenu'), false);
            syncFsMenuOpenState();
        }
    });

    // Tam ekrandan çık
    document.getElementById('fsExitBtn').addEventListener('click', exitVideoFullscreen);

    // Video timeupdate - progress bar güncelle
    video.addEventListener('timeupdate', updateFsProgressBar);

    // Video loadedmetadata - toplam süreyi güncelle
    video.addEventListener('loadedmetadata', updateFsTotalTime);
}

function handleFullscreenChange() {
    const videoPage = document.getElementById('videoPage');
    const fsControls = document.getElementById('videoFsControls');

    if (isVideoFullscreenActive()) {
        // Tam ekrana girdi
        videoPage?.classList.add('fs-active');
        fsControlState.isVisible = true;
        showFsControls();
        startFsHideTimer();

        // Linux/Wayland/X11'de bazı durumlarda video overlay düzlemi üstte kalabiliyor.
        // Video'ya sürekli filter uygulamak overlay kullanımını azaltır ve UI'ın görünmesini sağlar.
        if (elements.videoPlayer) {
            elements.videoPlayer.style.filter = `brightness(${fsControlState.currentBrightness.toFixed(3)})`;
        }

        // Menüleri kapat / state sıfırla
        setFsMenuVisible(document.getElementById('fsSettingsMenu'), false);
        setFsMenuVisible(document.getElementById('fsQualityMenu'), false);
        setFsMenuVisible(document.getElementById('fsSpeedMenu'), false);
        setFsMenuVisible(document.getElementById('fsSubtitlesMenu'), false);
        setFsMenuVisible(document.getElementById('fsSleepMenu'), false);
        syncFsMenuOpenState();

        // Sync initial state
        updateFsControlsState();
    } else {
        // Tam ekrandan çıktı
        videoPage?.classList.remove('fs-active');
        stopFsHideTimer();

        setFsMenuVisible(document.getElementById('fsSettingsMenu'), false);
        setFsMenuVisible(document.getElementById('fsQualityMenu'), false);
        setFsMenuVisible(document.getElementById('fsSpeedMenu'), false);
        setFsMenuVisible(document.getElementById('fsSubtitlesMenu'), false);
        setFsMenuVisible(document.getElementById('fsSleepMenu'), false);
        syncFsMenuOpenState();
    }
}

function handleVideoMouseMove(e) {
    if (!isVideoFullscreenActive()) return;

    // Menü açıkken auto-hide yapma
    if (fsControlState.isMenuOpen) {
        showFsControls();
        stopFsHideTimer();
        const videoPage = document.getElementById('videoPage');
        videoPage?.classList.remove('hide-cursor');
        return;
    }

    // Bar veya menü üzerindeyken: sabit kalsın, timer yeniden başlamasın
    const fsControls = document.getElementById('videoFsControls');
    if (fsControls && (fsControls.matches(':hover') || e.target?.closest('#videoFsControls'))) {
        showFsControls();
        stopFsHideTimer();
        const videoPage = document.getElementById('videoPage');
        videoPage?.classList.remove('hide-cursor');
        return;
    }

    // Mouse hareket edince kontrolleri göster
    showFsControls();
    startFsHideTimer();

    // Cursor'ı göster
    const videoPage = document.getElementById('videoPage');
    videoPage.classList.remove('hide-cursor');
}

function showFsControls() {
    const fsControls = document.getElementById('videoFsControls');
    if (!fsControls) return;

    fsControls.classList.remove('hidden');
    fsControlState.isVisible = true;

    const videoPage = document.getElementById('videoPage');
    videoPage?.classList.remove('hide-cursor');
}

function hideFsControls() {
    const fsControls = document.getElementById('videoFsControls');
    if (!fsControls) return;

    fsControls.classList.add('hidden');
    fsControlState.isVisible = false;

    // Cursor'ı da gizle
    const videoPage = document.getElementById('videoPage');
    if (videoPage) {
        videoPage.classList.add('hide-cursor');
    }
}

function startFsHideTimer() {
    stopFsHideTimer();
    if (fsControlState.isMenuOpen) return;
    // Bar veya menü üzerindeyken asla başlatma
    const fsControls = document.getElementById('videoFsControls');
    if (fsControls && fsControls.matches(':hover')) return;
    fsControlState.hideTimer = setTimeout(() => {
        hideFsControls();
    }, fsControlState.hideDelay);
}

function clampNumber(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function anchorFullscreenMenu(menuEl) {
    if (!menuEl) return;
    console.log('🔧 [DEBUG] anchorFullscreenMenu çağrıldı:', menuEl.id);

    // CSS'de zaten position: absolute; bottom: 60px; right: 20px; var
    // Inline override'ları temizle, CSS'e bırak
    menuEl.style.removeProperty('position');
    menuEl.style.removeProperty('bottom');
    menuEl.style.removeProperty('right');
    menuEl.style.removeProperty('top');
    menuEl.style.removeProperty('left');

    console.log('✅ [DEBUG] Menü anchor temizlendi, CSS yönetiyor:', {
        parent: menuEl.parentElement?.id,
        rect: menuEl.getBoundingClientRect()
    });
}

function handleFullscreenWheel(e) {
    if (!isVideoFullscreenActive()) return;
    // Trackpad pinch/zoom veya ctrl+wheel gibi durumları dokunma
    if (e.ctrlKey) return;

    const videoPage = document.getElementById('videoPage');
    if (!videoPage) return;

    const edgePx = 90; // Soldaki/kaydaki hassas bölge genişliği
    const x = e.clientX;
    const vw = document.documentElement.clientWidth;

    const inLeft = x <= edgePx;
    const inRight = x >= (vw - edgePx);

    if (!inLeft && !inRight) return;

    // Scroll'u engelle
    e.preventDefault();
    e.stopPropagation();

    // Bar görünür kalsın
    showFsControls();
    stopFsHideTimer();

    const direction = e.deltaY > 0 ? -1 : 1; // wheel up -> increase

    if (inLeft) {
        // Ses +/-
        const step = 5;
        const slider = elements.volumeSlider;
        if (!slider) return;
        const current = parseInt(slider.value || '0', 10);
        const next = clampNumber(current + direction * step, 0, 100);
        slider.value = String(next);
        handleVolumeChange();

        // 0'a inince mute gibi davran
        if (next === 0) {
            state.isMuted = true;
            if (elements.videoPlayer) elements.videoPlayer.muted = true;
            if (elements.audio) elements.audio.muted = true;
            updateVolumeIcon();
            updateFsVolumeIcon();
        }

        const fsVol = document.getElementById('fsVolumeSlider');
        const fsLbl = document.getElementById('fsVolumeLabel');
        if (fsVol) fsVol.value = String(next);
        if (fsLbl) fsLbl.textContent = `${next}%`;
        updateFsVolumeIcon();

        showFsWheelHud('volume', next);
    } else if (inRight) {
        // Parlaklık +/- (video filter)
        const step = 0.07;
        const next = clampNumber(fsControlState.currentBrightness + direction * step, 0.35, 2.0);
        fsControlState.currentBrightness = next;
        if (elements.videoPlayer) {
            elements.videoPlayer.style.filter = `brightness(${next.toFixed(3)})`;
        }

        showFsWheelHud('brightness', next * 100);
    }
}

function stopFsHideTimer() {
    if (fsControlState.hideTimer) {
        clearTimeout(fsControlState.hideTimer);
        fsControlState.hideTimer = null;
    }
}

function handleFsSeekInput(e) {
    fsControlState.seeking = true;
    const video = elements.videoPlayer;
    const value = parseInt(e.target.value);
    const duration = video.duration || 0;
    const time = (value / 1000) * duration;

    // Sadece label'ı güncelle, video pozisyonunu değil
    const label = document.getElementById('fsTimeCurrentLabel');
    if (label) {
        label.textContent = formatTime(time);
    }

    // Rainbow slider efektini güncelle
    const percent = (value / e.target.max) * 100;
    updateRainbowSlider(e.target, percent);
}

function handleFsSeekChange(e) {
    const video = elements.videoPlayer;
    const value = parseInt(e.target.value);
    const duration = video.duration || 0;
    const time = (value / 1000) * duration;

    video.currentTime = time;
    fsControlState.seeking = false;
}

function handleFsPlayPause() {
    const video = elements.videoPlayer;

    if (video.paused) {
        video.play();
    } else {
        video.pause();
    }
}

function seekVideoRelative(seconds) {
    const video = elements.videoPlayer;
    video.currentTime = Math.max(0, Math.min(video.duration, video.currentTime + seconds));
}

function handleFsMute() {
    // toggleMute fonksiyonunu kullan - tüm kontroller senkronize olur
    toggleMute();
    updateFsControlsState();
}

function handleFsVolumeChange(e) {
    const video = elements.videoPlayer;
    const value = parseInt(e.target.value);

    video.volume = value / 100;
    video.muted = false;

    // State güncelle
    state.volume = value;
    state.isMuted = false;

    // Ana arayüz kontrollerini senkronize et
    if (elements.volumeSlider) {
        elements.volumeSlider.value = value;
        updateRainbowSlider(elements.volumeSlider, value);
    }
    if (elements.volumeLabel) {
        elements.volumeLabel.textContent = value + '%';
    }

    // Tam ekran label güncelle
    const label = document.getElementById('fsVolumeLabel');
    if (label) {
        label.textContent = value + '%';
    }

    // Tam ekran slider rainbow efekti
    updateRainbowSlider(e.target, value);

    // Fullscreen ses ikonunu güncelle
    updateFsVolumeIcon();

    updateVolumeIcon();
    updateFsControlsState();
    pushAppVolumeToWeb();
    saveSettings();
}

// Fullscreen ses ikonu (YouTube tarzı Material Symbols)
function updateFsVolumeIcon() {
    const muteBtn = document.getElementById('fsMuteBtn');
    const iconSpan = document.getElementById('fsYouTubeVolumeIcon');
    if (!muteBtn || !iconSpan) return;

    const video = elements.videoPlayer;
    const volumePercent = Math.round((video?.volume || 0) * 100);
    const isMuted = !!video?.muted || state.isMuted || volumePercent === 0;

    // CSS değişkenini ayarla (akıcı animasyon için)
    const volumeRatio = isMuted ? 0 : (volumePercent / 100);
    muteBtn.style.setProperty('--fs-volume', volumeRatio.toString());
    muteBtn.classList.toggle('is-muted', isMuted);

    // İkon tipi (YouTube benzeri)
    if (isMuted || volumePercent === 0) {
        iconSpan.textContent = 'volume_off';
    } else if (volumePercent <= 50) {
        iconSpan.textContent = 'volume_down';
    } else {
        iconSpan.textContent = 'volume_up';
    }
}

function handleFsSpeedClick() {
    const speeds = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];
    const currentIndex = speeds.indexOf(fsControlState.currentSpeed);
    const nextIndex = (currentIndex + 1) % speeds.length;
    const newSpeed = speeds[nextIndex];

    fsControlState.currentSpeed = newSpeed;
    elements.videoPlayer.playbackRate = newSpeed;

    // Butonu güncelle
    const btn = document.getElementById('fsSpeedBtn');
    if (btn) {
        btn.textContent = newSpeed.toFixed(1) + 'x';
    }
}

function handleFsFpsClick() {
    const fpsOptions = [0, 24, 30, 60]; // 0 = Otomatik
    const currentIndex = fpsOptions.indexOf(fsControlState.currentFps);
    const nextIndex = (currentIndex + 1) % fpsOptions.length;
    const newFps = fpsOptions[nextIndex];

    fsControlState.currentFps = newFps;

    // Butonu güncelle
    const btn = document.getElementById('fsFpsBtn');
    if (btn) {
        btn.textContent = newFps === 0 ? 'Auto' : newFps.toString();
    }

    // FPS ayarını uygula (video rendering için - şimdilik sadece UI)
    console.log('FPS ayarlandı:', newFps === 0 ? 'Auto' : newFps);
}

function handleFsSettingsClick(e) {
    console.log('🔧 [DEBUG] handleFsSettingsClick ÇAĞRILDI', { target: e?.target, fullscreen: isVideoFullscreenActive() });

    // Bazı global click handler'lar menüyü anında kapatabiliyor; burada kesiyoruz.
    e?.preventDefault?.();
    e?.stopPropagation?.();

    // YouTube tarzı ayarlar menüsünü aç/kapat
    const menu = document.getElementById('fsSettingsMenu');
    console.log('🔧 [DEBUG] Menü elementi:', menu, 'Hidden:', menu?.classList.contains('hidden'));
    if (!menu) {
        console.error('❌ [DEBUG] fsSettingsMenu bulunamadı!');
        return;
    }

    const isHidden = menu.classList.contains('hidden');

    // Tüm menüleri kapat
    setFsMenuVisible(document.getElementById('fsSettingsMenu'), false);
    setFsMenuVisible(document.getElementById('fsQualityMenu'), false);
    setFsMenuVisible(document.getElementById('fsSpeedMenu'), false);

    if (isHidden) {
        setFsMenuVisible(menu, true);
        anchorFullscreenMenu(menu);
        showFsControls();
        stopFsHideTimer();
        syncFsMenuOpenState();
    }
}

function exitVideoFullscreen() {
    if (document.exitFullscreen) {
        document.exitFullscreen();
    } else if (document.webkitExitFullscreen) {
        document.webkitExitFullscreen();
    } else if (document.mozCancelFullScreen) {
        document.mozCancelFullScreen();
    }
}

function updateFsProgressBar() {
    if (fsControlState.seeking) return;

    const video = elements.videoPlayer;
    const slider = document.getElementById('fsSeekSlider');
    const currentLabel = document.getElementById('fsTimeCurrentLabel');

    if (!slider || !currentLabel) return;

    const duration = video.duration || 0;
    const currentTime = video.currentTime || 0;

    if (duration > 0) {
        const value = (currentTime / duration) * 1000;
        slider.value = value;
    }

    currentLabel.textContent = formatTime(currentTime);
}

function updateFsTotalTime() {
    const video = elements.videoPlayer;
    const totalLabel = document.getElementById('fsTimeTotalLabel');

    if (!totalLabel) return;

    const duration = video.duration || 0;
    totalLabel.textContent = formatTime(duration);
}

function updateFsControlsState() {
    const video = elements.videoPlayer;

    // Play/Pause ikon - hidden class kullan
    const playIcon = document.getElementById('fsPlayIcon');
    const pauseIcon = document.getElementById('fsPauseIcon');

    if (playIcon && pauseIcon) {
        if (video.paused) {
            playIcon.classList.remove('hidden');
            pauseIcon.classList.add('hidden');
        } else {
            playIcon.classList.add('hidden');
            pauseIcon.classList.remove('hidden');
        }
    }

    // Fullscreen ses ikonu (Material Icons Round)
    updateFsVolumeIcon();

    // Ses Seviyesi slider
    const volumeSlider = document.getElementById('fsVolumeSlider');
    const volumeLabel = document.getElementById('fsVolumeLabel');

    if (volumeSlider && volumeLabel && !video.muted) {
        const volume = Math.round(video.volume * 100);
        volumeSlider.value = volume;
        volumeLabel.textContent = volume + '%';
    }

    // Ayarlar menu toggles/labels
    hydrateFsSettingsUI();
}

let fsAudioCtx = null;
let fsVideoSourceNode = null;
let fsVideoDelayNode = null;
let fsVideoGainNode = null;

function getVideoAudioDelayMs() {
    const value = Number(state.settings?.videoFullscreen?.audioDelayMs);
    return Math.max(0, Math.min(500, Number.isFinite(value) ? value : 0));
}

function updateAudioVideoDelayUi() {
    if (!elements.audioVideoDelay || !elements.audioVideoDelayValue) return;
    const delayMs = getVideoAudioDelayMs();
    elements.audioVideoDelay.value = String(delayMs);
    elements.audioVideoDelayValue.textContent = `${delayMs} ms`;
}

function hydrateFsSettingsUI() {
    const prefs = state.settings?.videoFullscreen || {};
    const stable = !!prefs.stableVolume;
    const boost = !!prefs.volumeBoost;
    const cinematic = prefs.cinematicLighting !== false;
    const annotations = prefs.annotations !== false;

    const setSwitchActive = (key, enabled) => {
        const sw = document.querySelector(`#fsSettingsMenu .yt-toggle-switch[data-setting="${key}"]`);
        if (!sw) return;
        sw.classList.toggle('active', !!enabled);
    };

    setSwitchActive('stable-volume', stable);
    setSwitchActive('volume-boost', boost);
    setSwitchActive('cinematic-lighting', cinematic);
    setSwitchActive('annotations', annotations);

    const videoPage = document.getElementById('videoPage');
    if (videoPage) videoPage.classList.toggle('fs-cinematic', !!cinematic);

    const sleepLabel = document.getElementById('fsCurrentSleepTimer');
    const mins = Number(prefs.sleepTimerMinutes || 0);
    if (sleepLabel) sleepLabel.textContent = getFsSleepLabel(mins);

    const subLabel = document.getElementById('fsCurrentSubtitles');
    if (subLabel) subLabel.textContent = fsT('videoFs.state.off', 'Off');

    const quality = document.querySelector('#fsQualityMenu .yt-radio-item.active')?.dataset?.quality || 'auto';
    const qualityLabel = document.getElementById('currentQuality');
    if (qualityLabel) qualityLabel.textContent = getFsQualityLabel(quality);

    const speed = document.querySelector('#fsSpeedMenu .yt-radio-item.active')?.dataset?.speed || '1';
    const speedLabel = document.getElementById('currentPlaybackSpeed');
    if (speedLabel) speedLabel.textContent = getFsSpeedLabel(parseFloat(speed));
}

function toggleFsSetting(settingKey) {
    if (!settingKey) return;
    if (!state.settings) state.settings = {};
    if (!state.settings.videoFullscreen) state.settings.videoFullscreen = {};

    const prefs = state.settings.videoFullscreen;
    if (settingKey === 'stable-volume') {
        prefs.stableVolume = !prefs.stableVolume;
        hydrateFsSettingsUI();
        saveSettings();
        safeNotify(fsT('videoFs.notify.stableVolume', 'Stable volume: {state}', { state: getFsOnOffLabel(prefs.stableVolume) }), 'info', 1600);
        return;
    }

    if (settingKey === 'volume-boost') {
        prefs.volumeBoost = !prefs.volumeBoost;
        applyFsVolumeBoost(!!prefs.volumeBoost);
        hydrateFsSettingsUI();
        saveSettings();
        safeNotify(fsT('videoFs.notify.volumeBoost', 'Volume boost: {state}', { state: getFsOnOffLabel(prefs.volumeBoost) }), 'info', 1600);
        return;
    }

    if (settingKey === 'cinematic-lighting') {
        prefs.cinematicLighting = !prefs.cinematicLighting;
        hydrateFsSettingsUI();
        saveSettings();
        return;
    }

    if (settingKey === 'annotations') {
        prefs.annotations = !prefs.annotations;
        hydrateFsSettingsUI();
        saveSettings();
        safeNotify(fsT('videoFs.notify.annotationsSoon', 'Annotations: coming soon.'), 'info', 2200);
    }
}

function ensureFsAudioGraph() {
    if (fsAudioCtx && fsVideoGainNode) return true;
    try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return false;
        fsAudioCtx = fsAudioCtx || new Ctx();
        if (!fsVideoSourceNode) fsVideoSourceNode = fsAudioCtx.createMediaElementSource(elements.videoPlayer);
        if (!fsVideoDelayNode) fsVideoDelayNode = fsAudioCtx.createDelay(1.0);
        if (!fsVideoGainNode) fsVideoGainNode = fsAudioCtx.createGain();
        fsVideoSourceNode.connect(fsVideoDelayNode);
        fsVideoDelayNode.connect(fsVideoGainNode);
        fsVideoGainNode.connect(fsAudioCtx.destination);
        fsVideoDelayNode.delayTime.value = getVideoAudioDelayMs() / 1000;
        return true;
    } catch (e) {
        console.warn('[FS] audio graph failed:', e?.message || e);
        return false;
    }
}

function applyFsAudioDelay(delayMs = getVideoAudioDelayMs()) {
    if (!elements.videoPlayer) return;
    const ok = ensureFsAudioGraph();
    if (!ok || !fsVideoDelayNode) return;
    try {
        if (fsAudioCtx && fsAudioCtx.state === 'suspended') fsAudioCtx.resume().catch(() => { /* ignore */ });
    } catch { }
    const safeDelay = Math.max(0, Math.min(500, Number(delayMs) || 0));
    fsVideoDelayNode.delayTime.value = safeDelay / 1000;
}

function applyFsVolumeBoost(enabled) {
    if (!elements.videoPlayer) return;
    const ok = ensureFsAudioGraph();
    if (!ok || !fsVideoGainNode) return;
    try {
        if (fsAudioCtx && fsAudioCtx.state === 'suspended') fsAudioCtx.resume().catch(() => { /* ignore */ });
    } catch { }
    fsVideoGainNode.gain.value = enabled ? 1.8 : 1.0;
}

function setFsSleepTimer(minutes) {
    if (!state.settings) state.settings = {};
    if (!state.settings.videoFullscreen) state.settings.videoFullscreen = {};
    state.settings.videoFullscreen.sleepTimerMinutes = Number(minutes) || 0;
    saveSettings();

    const label = document.getElementById('fsCurrentSleepTimer');
    if (label) label.textContent = getFsSleepLabel(minutes);

    if (fsControlState.sleepTimerId) {
        clearTimeout(fsControlState.sleepTimerId);
        fsControlState.sleepTimerId = null;
    }

    if (!minutes || minutes <= 0) {
        safeNotify(fsT('videoFs.notify.sleepTimerOff', 'Sleep timer: Off'), 'info', 1600);
        return;
    }

    safeNotify(
        fsT('videoFs.notify.sleepTimerSet', 'Sleep timer: {minutes} {unit}', {
            minutes: Number(minutes) || 0,
            unit: fsT('videoFs.sleep.minutesShort', 'min')
        }),
        'info',
        1600
    );
    fsControlState.sleepTimerId = setTimeout(() => {
        try {
            if (elements.videoPlayer && !elements.videoPlayer.paused) {
                elements.videoPlayer.pause();
                safeNotify(fsT('videoFs.notify.sleepTimerPaused', 'Sleep timer: Video paused.'), 'info', 2500);
            }
        } catch {
            // yoksay
        }
        fsControlState.sleepTimerId = null;
    }, minutes * 60 * 1000);
}

function formatTime(seconds) {
    if (!isFinite(seconds) || seconds < 0) return '00:00';

    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

// Video menü göster
function showVideoMenu(e) {
    // Basit bir menü göster
    const menu = document.createElement('div');
    menu.className = 'context-menu video-menu';
    menu.style.position = 'fixed';
    menu.style.right = '60px';
    menu.style.bottom = '20px';
    menu.innerHTML = `
        <div class="context-menu-item" onclick="toggleVideoFullscreen()">
            <span>Tam Ekran</span>
        </div>
        <div class="context-menu-item" onclick="elements.videoPlayer.playbackRate = 0.5">
            <span>0.5x Hız</span>
        </div>
        <div class="context-menu-item" onclick="elements.videoPlayer.playbackRate = 1">
            <span>Normal Hız</span>
        </div>
        <div class="context-menu-item" onclick="elements.videoPlayer.playbackRate = 1.5">
            <span>1.5x Hız</span>
        </div>
        <div class="context-menu-item" onclick="elements.videoPlayer.playbackRate = 2">
            <span>2x Hız</span>
        </div>
    `;

    // Önceki menüyü kaldır
    const oldMenu = document.querySelector('.video-menu');
    if (oldMenu) oldMenu.remove();

    document.body.appendChild(menu);

    // Dışarı tıklanınca kapat
    setTimeout(() => {
        document.addEventListener('click', function closeMenu(evt) {
            if (!menu.contains(evt.target)) {
                menu.remove();
                document.removeEventListener('click', closeMenu);
            }
        });
    }, 250);
}

// Aktif audio player'ı getir
function getActiveAudioPlayer() {
    return state.activePlayer === 'A' ? elements.audioA : elements.audioB;
}

// Diğer audio player'ı getir
function getInactiveAudioPlayer() {
    return state.activePlayer === 'A' ? elements.audioB : elements.audioA;
}

// Player'ları değiştir
function switchActivePlayer() {
    state.activePlayer = state.activePlayer === 'A' ? 'B' : 'A';
    elements.audio = getActiveAudioPlayer();
}

// ============================================
// SIDEBAR & NAVIGATION
// ============================================
function applyWebUiClasses() {
    const isWeb = isPageVisible(elements.webPage) || state.currentPage === 'web' || state.currentPanel === 'web';
    document.body.classList.toggle('web-mode', !!isWeb);
    if (isWeb) {
        document.body.classList.toggle('web-drawer-collapsed', !!state.webDrawerCollapsed);
    } else {
        document.body.classList.remove('web-drawer-collapsed');
    }

    if (elements.webDrawerToggleBtn) {
        const pressed = isWeb && state.webDrawerCollapsed;
        elements.webDrawerToggleBtn.setAttribute('aria-pressed', pressed ? 'true' : 'false');
    }
    if (elements.adblockBtn) {
        elements.adblockBtn.classList.toggle('active', !!isWeb);
        elements.adblockBtn.setAttribute('aria-pressed', isWeb ? 'true' : 'false');
    }
}

function setWebDrawerCollapsed(collapsed) {
    const next = !!collapsed;
    state.webDrawerCollapsed = next;
    if (state.settings) {
        if (!state.settings.webUi || typeof state.settings.webUi !== 'object') state.settings.webUi = {};
        state.settings.webUi.drawerCollapsed = next;
        // Best-effort persist (volume/shuffle/repeat ile birlikte kaydedilir)
        saveSettings().catch(() => { });
    }
    applyWebUiClasses();
}

function requestPlatformSwitch(btn) {
    if (!btn) return;
    if (webPlatformRuntime.switching) {
        webPlatformRuntime.queuedBtn = btn;
        return;
    }
    const key = String(btn.dataset.platform || btn.dataset.url || '').trim();
    const now = Date.now();

    if (key && key === webPlatformRuntime.lastSwitchKey && (now - webPlatformRuntime.lastSwitchAt) < 350) {
        return;
    }

    webPlatformRuntime.lastSwitchKey = key;
    webPlatformRuntime.lastSwitchAt = now;

    try { elements.webView?.blur?.(); } catch { }
    try { document.activeElement?.blur?.(); } catch { }

    Promise.resolve(handlePlatformClick(btn)).catch((e) => {
        console.warn('[WEB] platform switch error:', e?.message || e);
    });
}

function restoreSidebarSelectionAfterUtilityAction(prevActiveBtn) {
    try {
        elements.sidebarBtns.forEach((b) => b.classList.remove('active'));
        if (prevActiveBtn) prevActiveBtn.classList.add('active');
    } catch {
        // yoksay
    }
}

function handleSidebarClick(btn) {
    const page = btn.dataset.page;
    const panel = btn.dataset.panel;

    // Yardımcı pages should not remain open when switching tabs
    closeAllUtilityPages();

    // "İndir" sekmesi: Aurivo-Dawlod penceresini aç, mevcut sekmeyi bozmadan geri dön.
    if (page === 'download') {
        const prevActive = document.querySelector('.sidebar-btn[data-page].active');
        const currentPage = state.currentPage;

        // Müzik/Video sekmesindeyken İndir penceresi açılmasın; sadece bilgilendir.
        if (currentPage === 'music' || currentPage === 'video') {
            safeNotify('Müzik veya Video sekmesindeyken İndir penceresi açılamaz.', 'info');
            try {
                elements.sidebarBtns.forEach(b => b.classList.remove('active'));
                if (prevActive) prevActive.classList.add('active');
            } catch { }
            return;
        }

        try {
            if (window.aurivo?.dawlod?.openWindow) {
                let url = '';
                if (currentPage === 'web' || state.activeMedia === 'web') {
                    const candidate = getWebViewUrlSafe();
                    if (candidate && candidate !== 'about:blank' && /^https?:\/\//i.test(candidate)) {
                        url = candidate;
                        try { window.aurivo?.clipboard?.setText?.(candidate); } catch { }
                    }
                }
                window.aurivo.dawlod.openWindow(url ? { url } : undefined);
            } else {
                safeNotify('İndirme modülü bulunamadı (Aurivo-Dawlod).', 'error');
            }
        } catch (e) {
            safeNotify('İndirme penceresi açılamadı: ' + (e?.message || e), 'error');
        }
        // Active state'i eski sekmeye geri al
        restoreSidebarSelectionAfterUtilityAction(prevActive);
        return;
    }

    // "Pulse" sekmesi: Dinleme modunu aç/kapat, aktif sekmeyi bozma.
    if (page === 'pulse') {
        const prevActive = document.querySelector('.sidebar-btn[data-page].active');
        Promise.resolve(window.aurivo?.pulse?.openWindow?.())
            .then((result) => {
                if (result?.success) {
                    safeNotify('Aurivo-Pulse penceresi açıldı.', 'info', 1400);
                }
            })
            .catch((e) => {
                safeNotify(`Aurivo-Pulse penceresi açılamadı: ${e?.message || e}`, 'error', 3200);
            })
            .finally(() => restoreSidebarSelectionAfterUtilityAction(prevActive));
        return;
    }

    // Kenar çubuğu butonlarını güncelle
    elements.sidebarBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    // Video sekmesine geçildiğinde müziği durdur
    if (page === 'video' && state.isPlaying && state.activeMedia === 'audio') {
        stopAudio();
        state.isPlaying = false;
        updatePlayPauseIcon(false);
        updateCoverArt(null, 'video'); // Video ikonunu göster
        updateTrayState();
        updateMPRISMetadata();
    }

    // Media filtresini ayarla
    if (page === 'music') {
        state.mediaFilter = 'audio';
    } else if (page === 'video') {
        state.mediaFilter = 'video';
    } else {
        state.mediaFilter = 'all';
    }

    // Library action buttons (KÜTÜPHANE altı) sekmeye göre
    try {
        if (elements.libraryActionsAudio) elements.libraryActionsAudio.classList.toggle('hidden', state.mediaFilter !== 'audio');
        if (elements.libraryActionsVideo) elements.libraryActionsVideo.classList.toggle('hidden', state.mediaFilter !== 'video');
    } catch {
        // yoksay
    }

    // *** SEKMELERİ İZOLE ET - DİĞER MEDYALARI KAPAT ***
    isolateMediaSection(page);

    // Panel değiştir
    if (panel === 'library') {
        elements.libraryPanel.classList.remove('hidden');
        elements.webPanel.classList.add('hidden');
    } else if (panel === 'web') {
        elements.libraryPanel.classList.add('hidden');
        elements.webPanel.classList.remove('hidden');
    }

    // Sayfa değiştir
    switchPage(page);
    state.currentPage = page;
    state.currentPanel = panel;
    applyWebUiClasses();
    persistCurrentMainSection();

    // Sol panelde: aktif klasör yoksa kayıtlı klasörleri, varsa klasör içeriğini göster.
    try {
        if (panel === 'library') {
            const startupPath = String(state.pendingLibraryStartupPath || '').trim();
            // Sekme değiştirince önceki sekmenin açık klasörü taşınmasın.
            state.currentPath = startupPath || '';
            state.pendingLibraryStartupPath = '';
            initializeFileTree();
        }
    } catch {
        // yoksay
    }
}

// Sekme izolasyonu - RAM tasarrufu için diğer medyaları tamamen kapat
function isolateMediaSection(targetPage) {
    // Müzik sekmesine geçiliyorsa
    if (targetPage === 'music') {
        // Video'yu tamamen kapat
        stopVideo();
        // Web'i tamamen kapat
        stopWeb();
        state.activeMedia = 'audio';
    }
    // Video sekmesine geçiliyorsa
    else if (targetPage === 'video') {
        // Müziği tamamen kapat
        stopAudio();
        // Web'i tamamen kapat
        stopWeb();
        state.activeMedia = 'video';
    }
    // Web sekmesine geçiliyorsa
    else if (targetPage === 'web') {
        // Müziği tamamen kapat
        stopAudio();
        // Video'yu tamamen kapat
        stopVideo();
        state.activeMedia = 'web';
    }
}

function stopAudio() {
    console.log('stopAudio çağrıldı, useNativeAudio:', useNativeAudio);

    // C++ Audio Engine durdur - HER ZAMAN dene (useNativeAudio değerine bakılmaksızın)
    if (window.aurivo && window.aurivo.audio) {
        console.log('C++ Audio Engine durduruluyor...');
        try {
            window.aurivo.audio.stop();
            console.log('C++ Audio Engine durduruldu');
        } catch (e) {
            console.error('C++ stop hatası:', e);
        }
    }
    stopNativePositionUpdates();

    // Her iki HTML5 player'ı da durdur
    if (elements.audioA) {
        elements.audioA.pause();
        elements.audioA.src = '';
        elements.audioA.load(); // Tamamen sıfırla
    }
    if (elements.audioB) {
        elements.audioB.pause();
        elements.audioB.src = '';
        elements.audioB.load(); // Tamamen sıfırla
    }

    // Çapraz geçiş durumu'lerini sıfırla
    state.crossfadeInProgress = false;
    state.autoCrossfadeTriggered = false;
    state.trackAboutToEnd = false;

    // Müzik için state'i sıfırla
    if (state.activeMedia === 'audio') {
        state.isPlaying = false;
        updatePlayPauseIcon(false);
        scheduleRememberPlaybackStartupState(220);
    }
    state.playbackEndWarnedTrackKey = '';
    state.playbackStatePersistSecond = -1;
}

function stopAudioWithPlaybackFade() {
    if (!state.settings?.playback?.crossfadeStopEnabled || !state.isPlaying || state.crossfadeInProgress) {
        stopAudio();
        return;
    }

    const fadeMs = Math.max(80, Math.min(8000, Number(state.settings?.playback?.crossfadeMs) || 2000));
    if (useNativeAudio && window.aurivo?.audio?.fadeVolumeTo) {
        Promise.resolve(window.aurivo.audio.fadeVolumeTo(0, fadeMs))
            .catch((e) => {
                console.warn('[STOP] Native fade stop fallback:', e);
            })
            .finally(() => {
                stopAudio();
            });
        return;
    }

    if (state.activeMedia === 'audio') {
        const activePlayer = getActiveAudioPlayer();
        if (activePlayer && !activePlayer.paused) {
            fadeOutAndPause(activePlayer, fadeMs);
            setTimeout(() => {
                stopAudio();
            }, fadeMs + 40);
            return;
        }
    }

    stopAudio();
}

function stopVideo() {
    if (elements.videoPlayer) {
        elements.videoPlayer.pause();
        elements.videoPlayer.src = '';
        elements.videoPlayer.load();
    }
}

function stopWeb() {
    if (elements.webView) {
        // WebView'ı durdur (RAM temizliği)
        try {
            hardStopWebPlayback();
            elements.webView.stop();
            // Sessiz sayfa yükle - about:blank kullan (data URL yerine)
            elements.webView.setAttribute('src', 'about:blank');
        } catch (e) {
            // WebView henüz yüklenmemiş olabilir - yoksay
        }
    }
    hideWebLoadingOverlay();
    // Platform butonlarından active kaldır
    elements.platformBtns.forEach(b => b.classList.remove('active'));
}

function switchPage(pageName) {
    // Yardımcı buttons should not stay active when switching main pages
    if (elements.settingsBtn) elements.settingsBtn.classList.remove('active');

    elements.pages.forEach(p => {
        p.classList.remove('active');
        p.classList.add('hidden');
    });

    let targetPage;
    switch (pageName) {
        case 'music':
            targetPage = elements.musicPage;
            break;
        case 'video':
            targetPage = elements.videoPage;
            break;
        case 'web':
            targetPage = elements.webPage;
            break;
        default:
            targetPage = elements.musicPage;
    }

    targetPage.classList.remove('hidden');
    targetPage.classList.add('active');
}

async function handlePlatformClick(btn) {
    webPlatformRuntime.switching = true;
    try {
        const url = btn.dataset.url;
        const platform = btn.dataset.platform || 'web';
        const parsed = parseHttpUrl(url);
        if (!parsed) {
            safeNotify(uiT('securityPage.notify.invalidExternalUrl', 'Önce geçerli bir web sayfası açın (http/https).'), 'error');
            return;
        }

        const sec = await getSecurityStateSafe();
        if (sec.vpnDetected) {
            if (isStrictVpnBlockEnabled() && !isYoutubeHost(url)) {
                safeNotify(uiT('securityPage.notify.vpnBlocked', 'VPN algılandı. Güvenlik nedeniyle Web sekmesi geçici olarak engellendi.'), 'error');
                return;
            }
            if (!securityRuntime.vpnWarned) {
                securityRuntime.vpnWarned = true;
                safeNotify(uiT('securityPage.notify.vpnWarning', 'VPN algılandı. Güvenlik için yalnızca izinli platformlar açılacaktır.'), 'info');
            }
        }
        if (!isAllowedWebUrl(url)) {
            safeNotify(uiT('securityPage.notify.urlBlocked', 'Bu adres güvenlik politikası nedeniyle engellendi.'), 'error');
            return;
        }

        // Yardımcı pages should not remain open when switching to a platform
        closeAllUtilityPages();

        // Önce diğer medyaları kapat (RAM tasarrufu)
        stopAudio();
        stopVideo();
        state.activeMedia = 'web';
        state.webTitle = '';
        state.webArtist = '';
        state.webAlbum = '';

        // Tüm platform butonlarından active kaldır
        elements.platformBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        // Web sayfasına geç
        state.currentPage = 'web';
        state.currentPanel = 'web';
        switchPage('web');
        applyWebUiClasses();
        persistCurrentMainSection();

        // Web sayfası aktif olduktan sonra URL yükle (race condition azaltır)
        if (elements.webView) {
            const requestedUrl = parsed.toString();
            const nextUrl = resolveWebPlatformPrimaryUrl(platform, requestedUrl);
            const fallbackUrl = resolveWebPlatformFallbackUrl(platform, requestedUrl);
            const navToken = ++webLoadRuntime.navToken;
            showWebLoadingOverlay('uDaliBlock on kontrolden geciriyor...');
            try {
                try {
                    elements.webView.setUserAgent(getEmbeddedDesktopUserAgent());
                } catch { }
                try {
                    hardStopWebPlayback();
                } catch { }

                if (webPlatformRuntime.switchTimer) {
                    clearTimeout(webPlatformRuntime.switchTimer);
                    webPlatformRuntime.switchTimer = null;
                }
                safeNavigateWebView('about:blank');
                webPlatformRuntime.switchTimer = setTimeout(() => {
                    if (navToken !== webLoadRuntime.navToken) return;
                    safeNavigateWebView(nextUrl);
                }, 120);

                // Doğrulama + fallback: bazı sistemlerde ilk geçiş iptal olabiliyor.
                setTimeout(() => {
                    try {
                        if (navToken !== webLoadRuntime.navToken) return;
                        const cur = getWebViewUrlSafe();
                        if (!cur || cur === 'about:blank' || !webUrlLooksLikeTarget(cur, nextUrl, platform)) {
                            safeNavigateWebView(fallbackUrl);
                        }
                    } catch { }
                }, 1200);
                setTimeout(() => {
                    try {
                        if (navToken !== webLoadRuntime.navToken) return;
                        const cur = getWebViewUrlSafe();
                        if (!cur || cur === 'about:blank' || !webUrlLooksLikeTarget(cur, nextUrl, platform)) {
                            safeNavigateWebView(fallbackUrl);
                        }
                    } catch { }
                }, 2300);
            } catch (e) {
                console.warn('WebView URL yükleme hatası:', e?.message || e);
                safeNavigateWebView(fallbackUrl);
            }
        }

        // Now playing güncelle
        const platformName = btn.querySelector('span').textContent;
        elements.nowPlayingLabel.textContent = `${uiT('nowPlaying.prefix', 'Now Playing')}: ${platformName}`;

        // Platform logosunu kapak olarak göster
        updatePlatformCover(platform);

        // Sistem entegrasyonunu güncelle (MPRIS/Tray)
        updateTrayState();
        updateMPRISMetadata();
    } finally {
        webPlatformRuntime.switching = false;
        if (webPlatformRuntime.queuedBtn) {
            const queued = webPlatformRuntime.queuedBtn;
            webPlatformRuntime.queuedBtn = null;
            requestPlatformSwitch(queued);
        }
    }
}

// Platform logosunu kapak olarak ayarla
function updatePlatformCover(platform) {
    const platformCovers = {
        'youtube': 'icons/youtube_modern.svg',
        'soundcloud': 'icons/soundcloud.svg',
        'deezer': 'icons/deezer.svg',
        'facebook': 'icons/facebook.svg',
        'instagram': 'icons/instagram.svg',
        'tiktok': 'icons/tiktok.svg',
        'x': 'icons/x.svg',
        'reddit': 'icons/reddit.svg',
        'twitch': 'icons/twitch.svg',
        'tidal': 'icons/nav_internet.svg',
        'mixcloud': 'icons/nav_internet.svg',
        'web': 'icons/nav_internet.svg'
    };

    const coverUrl = platformCovers[platform] || platformCovers['web'];

    if (elements.coverArt) {
        elements.coverArt.src = coverUrl;
        elements.coverArt.classList.add('default-cover');
    }
}

function navigateBack() {
    const isWeb = state.currentPage === 'web' || state.currentPanel === 'web' || state.activeMedia === 'web';
    if (isWeb && elements.webView) {
        try {
            if (typeof elements.webView.canGoBack === 'function' && elements.webView.canGoBack()) {
                elements.webView.goBack();
                return;
            }
            // Fallback: sayfa içi geçmiş için history.back dene.
            elements.webView.executeJavaScript('try { history.back(); } catch (e) {}');
            return;
        } catch (e) {
            console.warn('Web geri işlemi başarısız:', e?.message || e);
        }
    }

    console.log('navigateBack çağrıldı, history:', state.pathHistory.length, 'current:', state.currentPath);
    if (state.pathHistory.length > 0) {
        state.pathForward.push(state.currentPath || LIBRARY_ROOT_MARKER);
        const previousPath = state.pathHistory.pop();
        console.log('Geri gidiliyor:', previousPath);
        if (previousPath === LIBRARY_ROOT_MARKER) {
            state.currentPath = '';
            initializeFileTree();
        } else {
            loadDirectory(previousPath, false);
        }
    } else {
        console.log('History boş, geri gidilemiyor');
    }
}

function navigateForward() {
    const isWeb = state.currentPage === 'web' || state.currentPanel === 'web' || state.activeMedia === 'web';
    if (isWeb && elements.webView) {
        try {
            if (typeof elements.webView.canGoForward === 'function' && elements.webView.canGoForward()) {
                elements.webView.goForward();
                return;
            }
            // Fallback: sayfa içi geçmiş için history.forward dene.
            elements.webView.executeJavaScript('try { history.forward(); } catch (e) {}');
            return;
        } catch (e) {
            console.warn('Web ileri işlemi başarısız:', e?.message || e);
        }
    }

    console.log('navigateForward çağrıldı, forward:', state.pathForward.length);
    if (state.pathForward.length > 0) {
        state.pathHistory.push(state.currentPath || LIBRARY_ROOT_MARKER);
        const nextPath = state.pathForward.pop();
        console.log('İleri gidiliyor:', nextPath);
        if (nextPath === LIBRARY_ROOT_MARKER) {
            state.currentPath = '';
            initializeFileTree();
        } else {
            loadDirectory(nextPath, false);
        }
    } else {
        console.log('Forward boş, ileri gidilemiyor');
    }
}

function refreshCurrentView() {
    const isWeb = state.currentPage === 'web' || state.currentPanel === 'web' || state.activeMedia === 'web';
    if (isWeb && elements.webView) {
        try {
            if (typeof elements.webView.reload === 'function') {
                elements.webView.reload();
            } else {
                elements.webView.executeJavaScript('try { location.reload(); } catch (e) {}');
            }
        } catch (e) {
            console.warn('Web yenileme başarısız:', e?.message || e);
        }
        return;
    }

    if (state.currentPath) {
        loadDirectory(state.currentPath, false);
    } else {
        initializeFileTree();
    }
}

function beginFileTreeRender() {
    fileTreeRenderGeneration += 1;
    return fileTreeRenderGeneration;
}

function isActiveFileTreeRender(renderToken) {
    return Number(renderToken) === fileTreeRenderGeneration;
}

function resetFileTreeSurface(renderToken) {
    if (!elements.fileTree || !isActiveFileTreeRender(renderToken)) return false;
    elements.fileTree.replaceChildren();
    elements.fileTree.classList.remove('video-library-mode', 'has-playing-focus');
    return true;
}

// ============================================
// FILE TREE
// ============================================
async function initializeFileTree() {
    console.log('initializeFileTree başlatılıyor...');

    // fileTree elementini kontrol et
    if (!elements.fileTree) {
        elements.fileTree = document.getElementById('fileTree');
    }

    if (!elements.fileTree) {
        console.error('fileTree elementi bulunamadı!');
        return;
    }

    const renderToken = beginFileTreeRender();
    if (!resetFileTreeSurface(renderToken)) return;

    // Video sekmesinde manuel eklenen video listesi varsa doğrudan onu göster.
    if (state.mediaFilter === 'video' && !state.currentPath && Array.isArray(state.videoFiles) && state.videoFiles.length > 0) {
        renderVideoLibraryTree(renderToken);
        updateLibraryAddButtonUi();
        return;
    }

    const scope = getUserFoldersScope();
    const savedFolders = loadSavedFolders(scope);
    console.log('[LIBRARY] scope:', scope, 'savedFolders:', Array.isArray(savedFolders) ? savedFolders.length : 0, 'currentPath:', state.currentPath || '(root)');

    // Aktif klasör varsa onun içeriğini göster.
    if (state.currentPath) {
        const currentPathExists = await fileExistsSafe(state.currentPath);
        if (!isActiveFileTreeRender(renderToken)) return;
        if (!currentPathExists) {
            console.warn('[LIBRARY] currentPath missing, falling back to root:', state.currentPath);
            if (state.mediaFilter === 'audio') state.lastAudioPath = null;
            if (state.mediaFilter === 'video') state.lastVideoPath = null;
            state.currentPath = '';
            state.pendingLibraryStartupPath = '';
            if (state.settings?.library?.startupState) {
                if (state.mediaFilter === 'audio') state.settings.library.startupState.lastAudioPath = '';
                if (state.mediaFilter === 'video') state.settings.library.startupState.lastVideoPath = '';
                saveSettings().catch(() => {});
            }
        } else {
        await loadDirectory(state.currentPath, false, renderToken);
        if (!isActiveFileTreeRender(renderToken)) return;
        console.log('File Tree aktif klasör içeriğiyle yüklendi:', state.currentPath);
        restoreTreeSelectionIfNeeded();
        updateLibraryAddButtonUi();
        return;
        }
    }

    // Aktif klasör yoksa yalnızca kullanıcının eklediği klasörleri göster.
    if (scope === 'audio') {
        try {
            renderUnifiedAudioLibraryRoot(savedFolders, renderToken);
        } catch (error) {
            console.error('[LIBRARY] renderUnifiedAudioLibraryRoot failed:', error);
            if (resetFileTreeSurface(renderToken)) {
                elements.fileTree.innerHTML = `
                    <div class="library-folder-empty">
                        ${escapeHtml(uiT('settings.library.folders.empty', 'Henüz müzik klasörü eklenmedi.'))}
                    </div>
                `;
            }
        }
        if (!isActiveFileTreeRender(renderToken)) return;
        restoreTreeSelectionIfNeeded();
        updateLibraryAddButtonUi();
        return;
    }
    if (!resetFileTreeSurface(renderToken)) return;
    savedFolders.forEach((folder) => {
        const label = folder?.name || window.aurivo?.path?.basename?.(folder.path) || 'Klasör';
        const item = createTreeItem(label, folder.path, true, '📁');
        item.classList.add('user-folder');
        item.dataset.userFolder = 'true';
        item.dataset.folderScope = scope;
        elements.fileTree.appendChild(item);
    });
    restoreTreeSelectionIfNeeded();
    updateLibraryAddButtonUi();
}

function createLibrarySectionLabel(title) {
    const section = document.createElement('div');
    section.className = 'tree-section-label';
    section.textContent = String(title || '').trim();
    return section;
}

function updateLibraryAddButtonUi() {
    if (!elements.musicAddFilesBtn) return;

    const inAudioFolder = state.mediaFilter === 'audio' && !!state.currentPath;
    const currentFolderLabel = inAudioFolder
        ? (window.aurivo?.path?.basename?.(state.currentPath) || String(state.currentPath).split('/').filter(Boolean).pop() || uiT('libraryActions.currentFolderFallback', 'Açık klasör'))
        : uiT('libraryActions.libraryRoot', 'Kök kütüphane');

    elements.musicAddFilesBtn.classList.toggle('is-folder-context', inAudioFolder);
    elements.musicAddFilesBtn.classList.toggle('is-library-root', !inAudioFolder);
    elements.musicAddFilesBtn.setAttribute(
        'title',
        inAudioFolder
            ? uiT('libraryActions.currentFolderTitle', 'Açık klasör: {name}', { name: currentFolderLabel })
            : uiT('libraryActions.addToLibrary', 'Kütüphaneye ekle')
    );

    if (elements.musicAddFilesBtnContext) {
        elements.musicAddFilesBtnContext.textContent = currentFolderLabel;
    }
}

function normalizeLibraryPath(filePath) {
    const normalized = String(filePath || '').trim().replace(/\\/g, '/');
    return normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
}

function buildUnifiedAudioLibraryIndex(savedFolders = loadSavedFolders('audio')) {
    const folders = Array.isArray(savedFolders) ? savedFolders : [];
    const folderRoots = folders
        .map((folder) => String(folder?.path || '').trim().replace(/\\/g, '/'))
        .filter(Boolean)
        .map((folderPath) => folderPath.endsWith('/') ? folderPath : `${folderPath}/`);

    const manualTracks = (state.playlist || [])
        .filter((item) => item?.path && isAudioFile(item.path))
        .filter((item) => {
            const normalizedPath = normalizeLibraryPath(item.path);
            return !folderRoots.some((root) => normalizedPath === root.slice(0, -1) || normalizedPath.startsWith(root));
        })
        .map((item) => {
            const cached = getCachedMetadataForPath(item.path);
            const title = String(cached?.title || item.title || item.name || '').trim();
            const artist = String(cached?.artist || item.artist || '').trim();
            return {
                path: item.path,
                name: item.name || window.aurivo?.path?.basename?.(item.path) || 'Track',
                title,
                artist
            };
        });

    const allTracks = (state.playlist || [])
        .filter((item) => item?.path && isAudioFile(item.path))
        .map((item) => {
            const cached = getCachedMetadataForPath(item.path);
            const title = String(cached?.title || item.title || item.name || '').trim();
            const artist = String(cached?.artist || item.artist || '').trim();
            const normalizedPath = normalizeLibraryPath(item.path);
            const inSavedFolder = folderRoots.some((root) => normalizedPath === root.slice(0, -1) || normalizedPath.startsWith(root));
            return {
                path: item.path,
                normalizedPath,
                name: item.name || window.aurivo?.path?.basename?.(item.path) || 'Track',
                title,
                artist,
                source: inSavedFolder ? 'saved-folder' : 'playlist'
            };
        });

    return {
        folders,
        manualTracks,
        allTracks,
        folderCount: folders.length,
        manualTrackCount: manualTracks.length
    };
}

function getAudioLibraryIndex() {
    if (!state.libraryIndex) {
        state.libraryIndex = { audio: null };
    }
    if (!state.libraryIndex.audio) {
        state.libraryIndex.audio = buildUnifiedAudioLibraryIndex();
    }
    return state.libraryIndex.audio;
}

function invalidateAudioLibraryIndex() {
    if (!state.libraryIndex) {
        state.libraryIndex = { audio: null };
        return;
    }
    state.libraryIndex.audio = null;
}

function syncAudioLibraryRootViewIfNeeded() {
    if (!elements.fileTree) return;
    if (state.currentPage !== 'music') return;
    if (state.currentPanel !== 'library') return;
    if (state.mediaFilter !== 'audio') return;
    if (state.currentPath) return;

    const renderToken = beginFileTreeRender();
    if (!resetFileTreeSurface(renderToken)) return;
    renderUnifiedAudioLibraryRoot(loadSavedFolders('audio'), renderToken);
}

function getLibraryTrackDisplayInfo(filePath = '') {
    const normalizedPath = normalizeLibraryPath(filePath);
    const playlistHit = (state.playlist || []).find((item) => normalizeLibraryPath(item?.path) === normalizedPath);
    const cached = getCachedMetadataForPath(filePath);
    const title = String(cached?.title || playlistHit?.title || playlistHit?.name || window.aurivo?.path?.basename?.(filePath) || '').trim();
    const artist = String(cached?.artist || playlistHit?.artist || '').trim();
    return {
        title: title || uiT('nowPlaying.unknownTrack', 'Bilinmeyen Parça'),
        artist,
        path: filePath
    };
}

function renderLibraryRootTrackCard(track, badgeLabel = '') {
    const info = getLibraryTrackDisplayInfo(track?.path || '');
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'library-root-track-card';
    item.dataset.path = track?.path || '';
    item.innerHTML = `
        <span class="library-root-track-icon">🎵</span>
        <span class="library-root-track-text">
            <strong>${escapeHtml(info.title)}</strong>
            <span>${escapeHtml(info.artist || info.path || '')}</span>
        </span>
        ${badgeLabel ? `<span class="library-root-track-badge">${escapeHtml(badgeLabel)}</span>` : ''}
    `;
    item.addEventListener('click', async () => {
        const path = String(track?.path || '').trim();
        if (!path) return;
        const fileName = window.aurivo?.path?.basename?.(path) || path.split(/[\\/]/).pop() || 'Track';
        const { index } = addToPlaylist(path, fileName);
        if (typeof index === 'number' && index >= 0) {
            await playIndex(index);
        }
    });
    return item;
}

function renderUnifiedAudioLibraryRoot(savedFolders = loadSavedFolders('audio'), renderToken = fileTreeRenderGeneration) {
    if (!elements.fileTree || !resetFileTreeSurface(renderToken)) return;

    state.libraryIndex.audio = buildUnifiedAudioLibraryIndex(savedFolders);
    const libraryIndex = getAudioLibraryIndex();
    const folders = libraryIndex.folders;
    const playlistOnlyEntries = libraryIndex.manualTracks;
    const stats = state.libraryStats || {};
    const fallbackSongCount = Number.isFinite(Number(libraryIndex?.allTracks?.length))
        ? libraryIndex.allTracks.length
        : (state.playlist || []).filter((item) => item?.path && isAudioFile(item.path)).length;
    console.log('[LIBRARY] render root -> folders:', folders.length, 'manualTracks:', playlistOnlyEntries.length, 'recentFlow:', 0);

    if (!folders.length && !playlistOnlyEntries.length) {
        if (!isActiveFileTreeRender(renderToken)) return;
        elements.fileTree.innerHTML = `
            <div class="library-folder-empty">
                ${escapeHtml(uiT('settings.library.folders.empty', 'Henüz müzik klasörü eklenmedi.'))}
            </div>
        `;
        return;
    }

    const shell = document.createElement('div');
    shell.className = 'library-root-shell';

    const overview = document.createElement('div');
    overview.className = 'library-root-overview';
    overview.innerHTML = `
        <div class="library-root-overview-copy">
            <strong>${escapeHtml(uiT('settings.tabs.library', 'Müzik Kütüphanesi'))}</strong>
            <span>${escapeHtml(uiT('settings.library.hero.subtitle', 'Klasörlerini ayarlardan yönetebilir, burada sadece gezinme görünür.'))}</span>
        </div>
        <div class="library-root-overview-stats">
            <span class="library-root-stat-pill">${escapeHtml(uiT('settings.library.folders.summary.count', 'Ekli müzik klasörleri'))}: <strong>${escapeHtml(String(folders.length))}</strong></span>
            <span class="library-root-stat-pill">${escapeHtml(uiT('settings.library.stats.totalSongs', 'Toplam şarkı'))}: <strong>${escapeHtml(String(stats.totalSongs ?? fallbackSongCount ?? '-'))}</strong></span>
            ${playlistOnlyEntries.length ? `<span class="library-root-stat-pill">${escapeHtml(uiT('settings.library.root.manualTracks', 'Manuel eklenen parçalar'))}: <strong>${escapeHtml(String(playlistOnlyEntries.length))}</strong></span>` : ''}
        </div>
        <button type="button" class="library-root-settings-btn">${escapeHtml(uiT('settings.tabs.library', 'Müzik Kütüphanesi'))}</button>
    `;
    overview.querySelector('.library-root-settings-btn')?.addEventListener('click', () => openSettings('library'));
    if (!isActiveFileTreeRender(renderToken)) return;
    shell.appendChild(overview);

    if (playlistOnlyEntries.length) {
        const note = document.createElement('div');
        note.className = 'library-root-note';
        note.textContent = uiT('settings.library.root.manualTracksHint', 'Manuel eklenen parçalar çalma listesinde görünür. Ayrıntılı yönetim Ayarlar > Müzik Kütüphanesi bölümündedir.');
        shell.appendChild(note);
    }

    if (!isActiveFileTreeRender(renderToken)) return;
    elements.fileTree.appendChild(shell);

    if (folders.length) {
        elements.fileTree.appendChild(createLibrarySectionLabel(
            uiT('settings.library.root.savedFolders', 'Kayıtlı klasörler')
        ));
        folders.forEach((folder) => {
            const label = folder?.name || window.aurivo?.path?.basename?.(folder.path) || 'Klasör';
            const item = createTreeItem(label, folder.path, true, '📁');
            item.classList.add('user-folder');
            item.dataset.userFolder = 'true';
            item.dataset.folderScope = 'audio';
            elements.fileTree.appendChild(item);
        });
    }

}

function getUserFoldersScope() {
    // 'music' sekmesi audio kapsamındadır.
    return state.mediaFilter === 'video' ? 'video' : 'audio';
}

function getUserFoldersStorageKey(scope) {
    const s = scope === 'video' ? 'video' : 'audio';
    return `aurivo_user_folders_${s}`;
}

function loadSavedFolders(scope) {
    try {
        const librarySettings = ensureLibrarySettings();
        const saved = scope === 'video' ? librarySettings.videoFolders : librarySettings.audioFolders;
        return dedupeLibraryFolders(saved);
    } catch (e) {
        console.error('Klasörler yüklenemedi:', e);
        return [];
    }
}

function saveFolders(scope, folders) {
    try {
        const normalizedFolders = dedupeLibraryFolders(folders);
        const librarySettings = ensureLibrarySettings();
        if (scope === 'video') {
            librarySettings.videoFolders = normalizedFolders;
        } else {
            librarySettings.audioFolders = normalizedFolders;
            invalidateAudioLibraryIndex();
        }
        const key = getUserFoldersStorageKey(scope);
        localStorage.setItem(key, JSON.stringify(normalizedFolders));
        saveSettings().catch(() => {});
    } catch (e) {
        console.error('Klasörler kaydedilemedi:', e);
    }
}

function loadExcludedLibraryFolders() {
    try {
        return dedupeLibraryFolders(ensureLibrarySettings().excludedFolders);
    } catch (e) {
        console.error('Hariç tutulan klasörler yüklenemedi:', e);
        return [];
    }
}

function getExcludedLibraryFoldersForScan() {
    return loadExcludedLibraryFolders();
}

function getConfiguredLibraryExtensions(kind = 'audio') {
    const librarySettings = ensureLibrarySettings();
    const source = kind === 'video'
        ? librarySettings.videoExtensions
        : librarySettings.audioExtensions;
    const fallback = kind === 'video' ? DEFAULT_VIDEO_EXTENSIONS : DEFAULT_AUDIO_EXTENSIONS;
    const normalized = Array.isArray(source)
        ? Array.from(new Set(source.map((value) => String(value || '').trim().replace(/^\./, '').toLowerCase()).filter(Boolean)))
        : [];
    return normalized.length ? normalized : [...fallback];
}

function getLibraryTrackActivityMap() {
    return ensureLibrarySettings().trackActivity || {};
}

function getTrackActivityForPath(filePath) {
    if (!filePath) return null;
    const map = getLibraryTrackActivityMap();
    const hit = map[filePath];
    return hit && typeof hit === 'object' ? hit : null;
}

function updateTrackActivity(filePath, patch = {}) {
    if (!filePath) return null;
    const map = getLibraryTrackActivityMap();
    const prev = getTrackActivityForPath(filePath) || {};
    const next = {
        favorite: !!(patch.favorite ?? prev.favorite ?? false),
        addedAt: Number(patch.addedAt ?? prev.addedAt ?? Date.now()) || Date.now(),
        playCount: Math.max(0, Number(patch.playCount ?? prev.playCount ?? 0) || 0),
        lastPlayedAt: Math.max(0, Number(patch.lastPlayedAt ?? prev.lastPlayedAt ?? 0) || 0)
    };
    map[filePath] = next;
    ensureLibrarySettings().trackActivity = map;
    return next;
}

function getSmartFlowState() {
    const flows = ensureLibrarySettings().smartFlows || {};
    return {
        favoritesEnabled: flows.favoritesEnabled !== false,
        recentEnabled: flows.recentEnabled !== false,
        mostPlayedEnabled: flows.mostPlayedEnabled !== false,
        recentLimit: [10, 25, 50].includes(Number(flows.recentLimit)) ? Number(flows.recentLimit) : 25,
        mostPlayedLimit: [10, 25, 50].includes(Number(flows.mostPlayedLimit)) ? Number(flows.mostPlayedLimit) : 25
    };
}

function getLibraryStartupBehavior() {
    const library = ensureLibrarySettings();
    const startupState = library.startupState || {};
    return {
        restoreLastFolder: library.restoreLastFolder !== false,
        restoreLastPlaylist: library.restoreLastPlaylist !== false,
        rememberTreeSelection: library.rememberTreeSelection !== false,
        startupState
    };
}

function getLibraryPerformanceState() {
    const perf = ensureLibrarySettings().performance || {};
    return {
        fastScan: perf.fastScan !== false,
        lightweightMode: !!perf.lightweightMode,
        coverCacheLimitMb: [32, 64, 128, 256].includes(Number(perf.coverCacheLimitMb))
            ? Number(perf.coverCacheLimitMb)
            : 64
    };
}

function estimateDataUrlBytes(dataUrl = '') {
    const value = String(dataUrl || '');
    if (!value) return 0;
    return Math.ceil((value.length * 3) / 4);
}

function trimAlbumArtCache() {
    const limitBytes = getLibraryPerformanceState().coverCacheLimitMb * 1024 * 1024;
    let totalBytes = 0;
    for (const entry of albumArtCache.values()) {
        totalBytes += Number(entry?.bytes || 0);
    }
    while (totalBytes > limitBytes && albumArtCache.size > 0) {
        const oldestKey = albumArtCache.keys().next().value;
        const oldest = albumArtCache.get(oldestKey);
        totalBytes -= Number(oldest?.bytes || 0);
        albumArtCache.delete(oldestKey);
    }
}

function readCachedAlbumArt(filePath = '') {
    const key = String(filePath || '').trim();
    if (!key || !albumArtCache.has(key)) return null;
    const value = albumArtCache.get(key);
    albumArtCache.delete(key);
    albumArtCache.set(key, value);
    return value?.data || null;
}

function writeCachedAlbumArt(filePath = '', data = null) {
    const key = String(filePath || '').trim();
    if (!key || !data) return;
    albumArtCache.delete(key);
    albumArtCache.set(key, {
        data,
        bytes: estimateDataUrlBytes(data)
    });
    trimAlbumArtCache();
}

function updateLibraryPerformanceStatusUi() {
    if (!elements.libraryPerformanceStatus) return;
    const perf = getLibraryPerformanceState();
    elements.libraryPerformanceStatus.textContent = uiT(
        'settings.library.performance.status',
        'Hızlı tarama: {fast} | Hafif mod: {light} | Kapak önbelleği: {cache} MB',
        {
            fast: perf.fastScan ? uiT('settings.common.on', 'On') : uiT('settings.common.off', 'Off'),
            light: perf.lightweightMode ? uiT('settings.common.on', 'On') : uiT('settings.common.off', 'Off'),
            cache: perf.coverCacheLimitMb
        }
    );
}

function getLibraryDiagnosticsState() {
    const diagnostics = ensureLibrarySettings().diagnostics || {};
    return {
        lastScanAt: Number(ensureLibrarySettings().lastScanAt || 0),
        lastScanDurationMs: Math.max(0, Number(diagnostics.lastScanDurationMs || 0)),
        lastScanReason: String(diagnostics.lastScanReason || 'manual'),
        scanErrors: Array.isArray(diagnostics.scanErrors) ? diagnostics.scanErrors.slice(0, 20) : [],
        unreadableFiles: Array.isArray(diagnostics.unreadableFiles) ? diagnostics.unreadableFiles.slice(0, 20) : []
    };
}

function rememberLibraryDiagnosticsPatch(patch = {}) {
    const diagnostics = ensureLibrarySettings().diagnostics || {};
    ensureLibrarySettings().diagnostics = {
        ...diagnostics,
        ...patch,
        scanErrors: Array.isArray(patch.scanErrors) ? patch.scanErrors.slice(0, 20) : (Array.isArray(diagnostics.scanErrors) ? diagnostics.scanErrors.slice(0, 20) : []),
        unreadableFiles: Array.isArray(patch.unreadableFiles) ? patch.unreadableFiles.slice(0, 20) : (Array.isArray(diagnostics.unreadableFiles) ? diagnostics.unreadableFiles.slice(0, 20) : [])
    };
}

function pushLibraryDiagnosticError(error, context = 'scan', pathValue = '') {
    const diagnostics = getLibraryDiagnosticsState();
    const nextErrors = [
        {
            context: String(context || 'scan'),
            path: String(pathValue || ''),
            error: String(error || 'unknown'),
            at: Date.now()
        },
        ...diagnostics.scanErrors
    ].slice(0, 20);
    rememberLibraryDiagnosticsPatch({ scanErrors: nextErrors });
    updateLibraryDiagnosticsUi();
    saveSettings().catch(() => {});
}

function formatLibraryScanDuration(durationMs = 0) {
    const totalSec = Math.max(0, Math.round(Number(durationMs || 0) / 1000));
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    if (min > 0) return `${min} dk ${sec} sn`;
    return `${sec} sn`;
}

function summarizeLibraryDiagnosticEntries(entries = [], formatter) {
    if (!Array.isArray(entries) || !entries.length) return '-';
    return entries
        .slice(0, 3)
        .map((entry) => formatter(entry))
        .filter(Boolean)
        .join(' | ');
}

function updateLibraryDiagnosticsUi() {
    const diagnostics = getLibraryDiagnosticsState();
    if (elements.libraryDiagnosticsLastScan) {
        elements.libraryDiagnosticsLastScan.textContent = uiT(
            'settings.library.diagnostics.lastScan',
            'Son tarama: {time}',
            { time: diagnostics.lastScanAt ? formatLibraryTimestamp(diagnostics.lastScanAt) : '-' }
        );
    }
    if (elements.libraryDiagnosticsLastDuration) {
        elements.libraryDiagnosticsLastDuration.textContent = uiT(
            'settings.library.diagnostics.lastDuration',
            'Son tarama süresi: {duration}',
            { duration: diagnostics.lastScanDurationMs > 0 ? formatLibraryScanDuration(diagnostics.lastScanDurationMs) : '-' }
        );
    }
    if (elements.libraryDiagnosticsErrors) {
        elements.libraryDiagnosticsErrors.textContent = uiT(
            'settings.library.diagnostics.errors',
            'Tarama hataları ({count}): {items}',
            {
                count: diagnostics.scanErrors.length,
                items: diagnostics.scanErrors.length
                    ? summarizeLibraryDiagnosticEntries(diagnostics.scanErrors, (entry) => {
                        const target = String(entry?.path || '').trim();
                        const reason = String(entry?.error || '').trim() || 'unknown';
                        return target ? `${reason} @ ${target}` : reason;
                    })
                    : '-'
            }
        );
    }
    if (elements.libraryDiagnosticsUnreadable) {
        elements.libraryDiagnosticsUnreadable.textContent = uiT(
            'settings.library.diagnostics.unreadable',
            'Okunamayan dosyalar ({count}): {items}',
            {
                count: diagnostics.unreadableFiles.length,
                items: diagnostics.unreadableFiles.length
                    ? summarizeLibraryDiagnosticEntries(diagnostics.unreadableFiles, (entry) => {
                        const target = String(entry?.path || '').trim();
                        return target || String(entry?.error || 'unknown');
                    })
                    : '-'
            }
        );
    }
    updateLibraryHeroOverview();
}

function persistLibraryStartupState() {
    const library = ensureLibrarySettings();
    if (!library.startupState || typeof library.startupState !== 'object') {
        library.startupState = {};
    }
    library.startupState.lastAudioPath = String(state.lastAudioPath || '');
    library.startupState.lastVideoPath = String(state.lastVideoPath || '');
    library.startupState.lastSelectedTreePath = getLibraryStartupBehavior().rememberTreeSelection
        ? String(library.startupState.lastSelectedTreePath || '')
        : '';
    saveSettings().catch(() => {});
}

function rememberSelectedTreePath(pathValue = '') {
    const library = ensureLibrarySettings();
    if (!library.startupState || typeof library.startupState !== 'object') {
        library.startupState = {};
    }
    library.startupState.lastSelectedTreePath = getLibraryStartupBehavior().rememberTreeSelection
        ? String(pathValue || '')
        : '';
    saveSettings().catch(() => {});
}

function restoreTreeSelectionIfNeeded() {
    const startup = getLibraryStartupBehavior();
    if (!startup.rememberTreeSelection) return;
    const selectedPath = String(startup.startupState?.lastSelectedTreePath || '').trim();
    if (!selectedPath || !elements.fileTree) return;
    const item = elements.fileTree.querySelector(`.tree-item.file[data-path="${CSS.escape(selectedPath)}"]`);
    if (!item) return;
    document.querySelectorAll('.tree-item.file').forEach((node) => node.classList.remove('selected'));
    item.classList.add('selected');
    lastClickedFileItem = item;
}

function getSmartFlowCollections() {
    const flowState = getSmartFlowState();
    const trackEntries = Object.entries(getLibraryTrackActivityMap())
        .map(([filePath, value]) => ({
            filePath,
            favorite: !!value?.favorite,
            addedAt: Number(value?.addedAt || 0),
            playCount: Number(value?.playCount || 0),
            lastPlayedAt: Number(value?.lastPlayedAt || 0)
        }));

    return {
        favorites: flowState.favoritesEnabled
            ? trackEntries.filter((entry) => entry.favorite)
            : [],
        recent: flowState.recentEnabled
            ? trackEntries
                .filter((entry) => entry.addedAt > 0)
                .sort((a, b) => b.addedAt - a.addedAt)
                .slice(0, flowState.recentLimit)
            : [],
        mostPlayed: flowState.mostPlayedEnabled
            ? trackEntries
                .filter((entry) => entry.playCount > 0)
                .sort((a, b) => (b.playCount - a.playCount) || (b.lastPlayedAt - a.lastPlayedAt))
                .slice(0, flowState.mostPlayedLimit)
            : []
    };
}

function getTrackFlowBadges(filePath) {
    const activity = getTrackActivityForPath(filePath);
    const flows = getSmartFlowCollections();
    const badges = [];
    if (activity?.favorite && getSmartFlowState().favoritesEnabled) {
        badges.push(uiT('settings.library.flows.badge.favorite', 'Favori'));
    }
    if (flows.recent.some((entry) => entry.filePath === filePath)) {
        badges.push(uiT('settings.library.flows.badge.recent', 'Yeni'));
    }
    if (flows.mostPlayed.some((entry) => entry.filePath === filePath)) {
        badges.push(uiT('settings.library.flows.badge.mostPlayed', 'Popüler'));
    }
    return badges;
}

function updateLibraryFlowsStatusUi() {
    if (!elements.libraryFlowsStatus) return;
    const flows = getSmartFlowCollections();
    elements.libraryFlowsStatus.textContent = uiT(
        'settings.library.flows.status',
        'Favori: {favorites} | Son eklenen: {recent} | En çok çalınan: {mostPlayed}',
        {
            favorites: flows.favorites.length,
            recent: flows.recent.length,
            mostPlayed: flows.mostPlayed.length
        }
    );
}

function updateLibraryTransferStatus(kind = 'idle', payload = {}) {
    if (!elements.libraryTransferStatus) return;
    if (kind === 'exported') {
        elements.libraryTransferStatus.textContent = uiT(
            'settings.library.transfer.status.exported',
            'Dışa aktarıldı: {path}',
            { path: String(payload.path || '-') }
        );
        return;
    }
    if (kind === 'imported') {
        elements.libraryTransferStatus.textContent = uiT(
            'settings.library.transfer.status.imported',
            'İçe aktarıldı: {count} parça, {folders} klasör',
            {
                count: Number(payload.playlistCount || 0),
                folders: Number(payload.folderCount || 0)
            }
        );
        return;
    }
    if (kind === 'error') {
        elements.libraryTransferStatus.textContent = uiT(
            'settings.library.transfer.status.error',
            'İşlem hatası: {error}',
            { error: String(payload.error || 'unknown') }
        );
        return;
    }
    elements.libraryTransferStatus.textContent = uiT('settings.library.transfer.status.idle', 'Henüz içe/dışa aktar yapılmadı.');
}

function buildLibraryTransferBundle() {
    const librarySettings = ensureLibrarySettings();
    return {
        version: 1,
        exportedAt: new Date().toISOString(),
        app: 'Aurivo Media Player',
        library: {
            audioFolders: dedupeLibraryFolders(librarySettings.audioFolders || []),
            videoFolders: dedupeLibraryFolders(librarySettings.videoFolders || []),
            excludedFolders: dedupeLibraryFolders(librarySettings.excludedFolders || []),
            scanOnStartup: librarySettings.scanOnStartup !== false,
            autoRescanOnFolderChange: librarySettings.autoRescanOnFolderChange !== false,
            watchFolders: librarySettings.watchFolders !== false,
            preferEmbeddedCover: librarySettings.preferEmbeddedCover !== false,
            scanFolderCover: librarySettings.scanFolderCover !== false,
            markMissingCovers: librarySettings.markMissingCovers !== false,
            viewSort: librarySettings.viewSort || 'title',
            viewGroup: librarySettings.viewGroup || 'none',
            viewMode: librarySettings.viewMode || 'list',
            audioExtensions: getConfiguredLibraryExtensions('audio'),
            videoExtensions: getConfiguredLibraryExtensions('video'),
            smartFlows: {
                ...getSmartFlowState()
            },
            metadataCache: librarySettings.metadataCache || {},
            metadataSummary: librarySettings.metadataSummary || {},
            trackActivity: librarySettings.trackActivity || {},
            diagnostics: librarySettings.diagnostics || {},
            lastScanAt: Number(librarySettings.lastScanAt || 0)
        },
        playlist: state.playlist || [],
        videoLibrary: Array.isArray(state.videoFiles) ? state.videoFiles : []
    };
}

async function exportLibraryBundle() {
    try {
        const target = await window.aurivo?.saveFile?.({
            title: uiT('settings.library.transfer.exportTitle', 'Kütüphane paketini dışa aktar'),
            defaultPath: `aurivo-library-${new Date().toISOString().slice(0, 10)}.json`,
            filters: [
                { name: 'JSON', extensions: ['json'] }
            ]
        });
        if (!target?.path) return;

        const ok = await window.aurivo?.writeTextFile?.(target.path, JSON.stringify(buildLibraryTransferBundle(), null, 2));
        if (!ok) throw new Error('write failed');

        updateLibraryTransferStatus('exported', { path: target.path });
        safeNotify(uiT('settings.library.transfer.exportDone', 'Kütüphane paketi dışa aktarıldı.'), 'success', 1800);
    } catch (error) {
        console.error('[LIBRARY] export bundle error:', error);
        updateLibraryTransferStatus('error', { error: error?.message || error });
        safeNotify(uiT('settings.library.transfer.failed', 'Kütüphane paketi işlemi tamamlanamadı.'), 'error', 2200);
    }
}

async function importLibraryBundle() {
    try {
        const files = await window.aurivo?.dialog?.openFiles?.({
            title: uiT('settings.library.transfer.importTitle', 'Kütüphane paketini içe aktar'),
            filters: [
                { name: 'JSON', extensions: ['json'] }
            ]
        });
        if (!files?.length) return;

        const raw = await window.aurivo?.readTextFile?.(files[0].path);
        if (!raw) throw new Error('empty file');

        const parsed = JSON.parse(raw);
        const nextLibrary = (parsed && typeof parsed.library === 'object') ? parsed.library : {};
        const librarySettings = ensureLibrarySettings();

        librarySettings.audioFolders = dedupeLibraryFolders(nextLibrary.audioFolders || []);
        librarySettings.videoFolders = dedupeLibraryFolders(nextLibrary.videoFolders || []);
        librarySettings.excludedFolders = dedupeLibraryFolders(nextLibrary.excludedFolders || []);
        librarySettings.scanOnStartup = nextLibrary.scanOnStartup !== false;
        librarySettings.autoRescanOnFolderChange = nextLibrary.autoRescanOnFolderChange !== false;
        librarySettings.watchFolders = nextLibrary.watchFolders !== false;
        librarySettings.preferEmbeddedCover = nextLibrary.preferEmbeddedCover !== false;
        librarySettings.scanFolderCover = nextLibrary.scanFolderCover !== false;
        librarySettings.markMissingCovers = nextLibrary.markMissingCovers !== false;
        librarySettings.viewSort = String(nextLibrary.viewSort || 'title').toLowerCase();
        librarySettings.viewGroup = String(nextLibrary.viewGroup || 'none').toLowerCase();
        librarySettings.viewMode = String(nextLibrary.viewMode || 'list').toLowerCase();
        librarySettings.audioExtensions = Array.isArray(nextLibrary.audioExtensions) ? nextLibrary.audioExtensions : [...DEFAULT_AUDIO_EXTENSIONS];
        librarySettings.videoExtensions = Array.isArray(nextLibrary.videoExtensions) ? nextLibrary.videoExtensions : [...DEFAULT_VIDEO_EXTENSIONS];
        librarySettings.smartFlows = {
            ...getSmartFlowState(),
            ...(nextLibrary.smartFlows && typeof nextLibrary.smartFlows === 'object' ? nextLibrary.smartFlows : {})
        };
        librarySettings.metadataCache = nextLibrary.metadataCache && typeof nextLibrary.metadataCache === 'object' ? nextLibrary.metadataCache : {};
        librarySettings.metadataSummary = nextLibrary.metadataSummary && typeof nextLibrary.metadataSummary === 'object' ? nextLibrary.metadataSummary : {};
        librarySettings.trackActivity = nextLibrary.trackActivity && typeof nextLibrary.trackActivity === 'object' ? nextLibrary.trackActivity : {};
        librarySettings.diagnostics = nextLibrary.diagnostics && typeof nextLibrary.diagnostics === 'object'
            ? nextLibrary.diagnostics
            : { lastScanDurationMs: 0, lastScanReason: 'manual', scanErrors: [], unreadableFiles: [] };
        librarySettings.lastScanAt = Number(nextLibrary.lastScanAt || 0);

        state.playlist = Array.isArray(parsed.playlist) ? parsed.playlist : [];
        state.videoFiles = Array.isArray(parsed.videoLibrary) ? parsed.videoLibrary : [];

        await saveSettings();
        await savePlaylistToDisk();
        persistVideoLibrary();
        loadSettingsToUI();
        await refreshLibraryStats();
        await syncLibraryWatchState();
        updateLibraryTransferStatus('imported', {
            playlistCount: state.playlist.length,
            folderCount: loadSavedFolders('audio').length
        });
        safeNotify(uiT('settings.library.transfer.importDone', 'Kütüphane paketi içe aktarıldı.'), 'success', 1800);
    } catch (error) {
        console.error('[LIBRARY] import bundle error:', error);
        updateLibraryTransferStatus('error', { error: error?.message || error });
        safeNotify(uiT('settings.library.transfer.failed', 'Kütüphane paketi işlemi tamamlanamadı.'), 'error', 2200);
    }
}

function toggleTrackFavorite(index) {
    const item = state.playlist[index];
    if (!item?.path) return;
    const current = getTrackActivityForPath(item.path) || {};
    const next = updateTrackActivity(item.path, {
        ...current,
        favorite: !current.favorite,
        addedAt: current.addedAt || item.addedAt || Date.now(),
        playCount: current.playCount || item.playCount || 0,
        lastPlayedAt: current.lastPlayedAt || item.lastPlayedAt || 0
    });
    state.playlist[index] = {
        ...item,
        favorite: next.favorite,
        addedAt: next.addedAt,
        playCount: next.playCount,
        lastPlayedAt: next.lastPlayedAt
    };
    renderPlaylist();
    updateLibraryFlowsStatusUi();
    savePlaylistToDisk().catch(() => {});
    saveSettings().catch(() => {});
}

function saveExcludedLibraryFolders(folders) {
    try {
        ensureLibrarySettings().excludedFolders = dedupeLibraryFolders(folders);
        saveSettings().catch(() => {});
    } catch (e) {
        console.error('Hariç tutulan klasörler kaydedilemedi:', e);
    }
}

function renderLibraryFolderSettings() {
    if (!elements.libraryManagedFoldersList) return;

    const folders = loadSavedFolders('audio');
    if (elements.libraryManagedFoldersSummary) {
        if (!folders.length) {
            elements.libraryManagedFoldersSummary.innerHTML = `
                <span>${escapeHtml(uiT('settings.library.folders.summary.empty', 'Henüz müzik klasörü eklenmedi.'))}</span>
                <strong>0</strong>
            `;
        } else {
            const lastAddedPath = String(state.lastAddedLibraryFolderPath || '').trim();
            const lastAddedFolder = folders.find((folder) => folder.path === lastAddedPath) || folders[folders.length - 1];
            elements.libraryManagedFoldersSummary.innerHTML = `
                <span>${escapeHtml(uiT('settings.library.folders.summary.count', 'Ekli müzik klasörleri'))}</span>
                <strong>${folders.length}</strong>
                <span>${escapeHtml(uiT('settings.library.folders.summary.lastAdded', 'Son eklenen'))}: ${escapeHtml(lastAddedFolder?.name || '-')}</span>
            `;
        }
    }
    if (!folders.length) {
        elements.libraryManagedFoldersList.innerHTML = `
            <div class="library-folder-empty">
                ${escapeHtml(uiT('settings.library.folders.empty', 'Henüz müzik klasörü eklenmedi.'))}
            </div>
        `;
    } else {
        elements.libraryManagedFoldersList.innerHTML = folders.map((folder) => `
            <div class="library-folder-item ${String(state.lastAddedLibraryFolderPath || '') === folder.path ? 'is-new' : ''}">
                <div class="library-folder-meta">
                    <strong>${escapeHtml(folder.name)}</strong>
                    <span>${escapeHtml(folder.path)}</span>
                </div>
                <div class="library-folder-actions">
                    <button
                        class="btn btn-small library-folder-action"
                        type="button"
                        data-library-action="rescan"
                        data-folder-path="${escapeAttribute(folder.path)}"
                    >${escapeHtml(uiT('settings.library.folders.rescanOne', 'Yeniden tara'))}</button>
                    <button
                        class="reset-btn library-folder-action library-folder-remove"
                        type="button"
                        data-library-action="remove"
                        data-folder-path="${escapeAttribute(folder.path)}"
                    >${escapeHtml(uiT('settings.library.folders.remove', 'Kaldır'))}</button>
                </div>
            </div>
        `).join('');
    }

    if (!elements.libraryExcludedFoldersList) return;
    const excludedFolders = loadExcludedLibraryFolders();
    if (!excludedFolders.length) {
        elements.libraryExcludedFoldersList.innerHTML = `
            <div class="library-folder-empty">
                ${escapeHtml(uiT('settings.library.exclude.empty', 'Henüz hariç tutulan klasör eklenmedi.'))}
            </div>
        `;
        return;
    }

    elements.libraryExcludedFoldersList.innerHTML = excludedFolders.map((folder) => `
        <div class="library-folder-item">
            <div class="library-folder-meta">
                <strong>${escapeHtml(folder.name)}</strong>
                <span>${escapeHtml(folder.path)}</span>
            </div>
            <div class="library-folder-actions">
                <button
                    class="reset-btn library-folder-action library-folder-remove"
                    type="button"
                    data-library-exclude-action="remove"
                    data-folder-path="${escapeAttribute(folder.path)}"
                >${escapeHtml(uiT('settings.library.folders.remove', 'Kaldır'))}</button>
            </div>
        </div>
    `).join('');
}

async function addExcludedFolderFromSettings() {
    try {
        const result = await window.aurivo.dialog.openFolder({
            title: uiT('settings.library.exclude.pickTitle', 'Hariç tutulacak klasörü seç'),
            defaultPath: state.specialPaths?.downloads || state.specialPaths?.home || state.specialPaths?.music
        });
        if (!result?.path) return;
        const excluded = loadExcludedLibraryFolders();
        if (excluded.some((folder) => folder.path === result.path)) {
            renderLibraryFolderSettings();
            return;
        }
        excluded.push({
            path: result.path,
            name: result.name || window.aurivo?.path?.basename?.(result.path) || 'Klasör'
        });
        saveExcludedLibraryFolders(excluded);
        renderLibraryFolderSettings();
        maybeAutoRescanMusicLibrary('excluded-folder-added').catch(() => {});
        syncLibraryWatchState().catch(() => {});
        safeNotify(uiT('settings.library.exclude.added', 'Hariç tutulan klasör eklendi.'), 'success', 1800);
    } catch (e) {
        safeNotify(`${uiT('settings.library.notify.folderPickFailed', 'Klasör seçilemedi')}: ${e?.message || e}`, 'error', 2200);
    }
}

function removeExcludedFolderFromSettings(path) {
    const excluded = loadExcludedLibraryFolders().filter((folder) => folder.path !== path);
    saveExcludedLibraryFolders(excluded);
    renderLibraryFolderSettings();
    maybeAutoRescanMusicLibrary('excluded-folder-removed').catch(() => {});
    syncLibraryWatchState().catch(() => {});
    safeNotify(uiT('settings.library.exclude.removed', 'Hariç tutulan klasör kaldırıldı.'), 'success', 1800);
}

function resetLibraryExtensionsToDefaults() {
    const librarySettings = ensureLibrarySettings();
    librarySettings.audioExtensions = [...DEFAULT_AUDIO_EXTENSIONS];
    librarySettings.videoExtensions = [...DEFAULT_VIDEO_EXTENSIONS];
    if (elements.libraryAudioExtensions) {
        elements.libraryAudioExtensions.value = librarySettings.audioExtensions.join(', ');
    }
    if (elements.libraryVideoExtensions) {
        elements.libraryVideoExtensions.value = librarySettings.videoExtensions.join(', ');
    }
    renderPlaylist();
    safeNotify(uiT('settings.library.extensions.resetDone', 'Uzantılar varsayılana döndü. Kaydet ile kalıcı olur.'), 'info', 1800);
}

function formatLibraryDuration(totalSeconds) {
    const total = Math.max(0, Math.round(Number(totalSeconds) || 0));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    if (hours > 0) return `${hours} sa ${minutes} dk`;
    return `${minutes} dk`;
}

function formatLibraryTimestamp(ts) {
    const date = new Date(Number(ts) || 0);
    if (!Number.isFinite(date.getTime()) || date.getTime() <= 0) return '-';
    return date.toLocaleString('tr-TR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function getLibraryMetadataCache() {
    return ensureLibrarySettings().metadataCache || {};
}

function getCachedMetadataForPath(filePath) {
    if (!filePath) return null;
    const cache = getLibraryMetadataCache();
    const hit = cache[filePath];
    return hit && typeof hit === 'object' ? hit : null;
}

function getCoverPreferenceState() {
    const librarySettings = ensureLibrarySettings();
    return {
        preferEmbedded: librarySettings.preferEmbeddedCover !== false,
        allowFolderCover: librarySettings.scanFolderCover !== false,
        markMissing: librarySettings.markMissingCovers !== false
    };
}

function getLibraryViewPreferenceState() {
    const librarySettings = ensureLibrarySettings();
    return {
        sortBy: ['title', 'artist', 'album', 'added'].includes(String(librarySettings.viewSort || '').toLowerCase())
            ? String(librarySettings.viewSort).toLowerCase()
            : 'title',
        groupBy: ['none', 'artist', 'album'].includes(String(librarySettings.viewGroup || '').toLowerCase())
            ? String(librarySettings.viewGroup).toLowerCase()
            : 'none',
        mode: ['list', 'compact', 'comfortable', 'cards'].includes(String(librarySettings.viewMode || '').toLowerCase())
            ? String(librarySettings.viewMode).toLowerCase()
            : 'list'
    };
}

function getPlaylistPresentationEntries() {
    const prefs = getLibraryViewPreferenceState();
    const collator = new Intl.Collator('tr', { sensitivity: 'base', numeric: true });
    const normalizedItems = state.playlist.map((item, originalIndex) => ({
        originalIndex,
        item,
        title: String(item?.name || '').trim(),
        artist: String(item?.artist || '').trim(),
        album: String(item?.album || '').trim()
    }));

    normalizedItems.sort((left, right) => {
        const compareText = (a, b) => collator.compare(a || '', b || '');
        if (prefs.sortBy === 'artist') {
            return compareText(left.artist || left.title, right.artist || right.title) ||
                compareText(left.album, right.album) ||
                compareText(left.title, right.title) ||
                (left.originalIndex - right.originalIndex);
        }
        if (prefs.sortBy === 'album') {
            return compareText(left.album || left.title, right.album || right.title) ||
                compareText(left.artist, right.artist) ||
                compareText(left.title, right.title) ||
                (left.originalIndex - right.originalIndex);
        }
        if (prefs.sortBy === 'added') {
            return left.originalIndex - right.originalIndex;
        }
        return compareText(left.title, right.title) ||
            compareText(left.artist, right.artist) ||
            compareText(left.album, right.album) ||
            (left.originalIndex - right.originalIndex);
    });

    if (prefs.groupBy === 'none') {
        return normalizedItems.map((entry) => ({ type: 'item', ...entry }));
    }

    const unknownLabel = prefs.groupBy === 'artist'
        ? uiT('settings.library.view.group.unknownArtist', 'Bilinmeyen sanatçı')
        : uiT('settings.library.view.group.unknownAlbum', 'Bilinmeyen albüm');
    const entries = [];
    let currentHeader = '';

    normalizedItems.forEach((entry) => {
        const groupLabel = (prefs.groupBy === 'artist' ? entry.artist : entry.album) || unknownLabel;
        if (groupLabel !== currentHeader) {
            currentHeader = groupLabel;
            entries.push({
                type: 'header',
                key: `${prefs.groupBy}:${groupLabel}`,
                label: groupLabel
            });
        }
        entries.push({ type: 'item', ...entry });
    });

    return entries;
}

function applyLibraryStatsToUi(stats = undefined) {
    const data = arguments.length > 0
        ? (stats || {})
        : (state.libraryStats || {});
    if (elements.libraryStatsTotalSongs) {
        elements.libraryStatsTotalSongs.textContent = String(data.totalSongs ?? '-');
    }
    if (elements.libraryStatsTotalArtists) {
        elements.libraryStatsTotalArtists.textContent = String(data.totalArtists ?? '-');
    }
    if (elements.libraryStatsTotalAlbums) {
        elements.libraryStatsTotalAlbums.textContent = String(data.totalAlbums ?? '-');
    }
    if (elements.libraryStatsTotalDuration) {
        elements.libraryStatsTotalDuration.textContent = data.totalDurationSec != null
            ? formatLibraryDuration(data.totalDurationSec)
            : '-';
    }
    if (elements.libraryStatsMissingMetadata) {
        elements.libraryStatsMissingMetadata.textContent = String(data.missingMetadataCount ?? '-');
    }
    if (elements.libraryStatsMissingCover) {
        elements.libraryStatsMissingCover.textContent = String(data.missingCoverCount ?? '-');
    }
    updateLibraryHeroOverview();
}

function applyMetadataCacheToPlaylist() {
    let changed = false;
    state.playlist = (state.playlist || []).map((item) => {
        const cached = getCachedMetadataForPath(item?.path);
        if (!cached) return item;
        changed = true;
        return {
            ...item,
            title: cached.title || item.title || '',
            artist: cached.artist || item.artist || '',
            album: cached.album || item.album || '',
            hasCover: typeof cached.hasCover === 'boolean' ? cached.hasCover : item.hasCover
        };
    });
    if (changed) {
        renderPlaylist();
        savePlaylistToDisk();
    }
}

function updateLibraryMetadataStatusUi() {
    if (!elements.libraryMetadataStatus) return;
    const summary = ensureLibrarySettings().metadataSummary || {};
    const refreshed = Number(summary.refreshedCount || 0);
    const cleaned = Number(summary.cleanedCount || 0);
    const inferred = Number(summary.inferredCount || 0);
    const generatedAt = formatLibraryTimestamp(summary.generatedAt);
    elements.libraryMetadataStatus.textContent = uiT(
        'settings.library.metadata.status',
        'Son yenileme: {time} | Okunan: {refreshed} | Temizlenen: {cleaned} | Tahmin edilen: {inferred}',
        {
            time: generatedAt,
            refreshed,
            cleaned,
            inferred
        }
    );
}

function updateLibraryCleanupStatus(summary = null) {
    if (!elements.libraryCleanupStatus) return;
    if (!summary) {
        elements.libraryCleanupStatus.textContent = uiT('settings.library.cleanup.status.idle', 'Temizlik işlemi henüz çalıştırılmadı.');
        return;
    }

    elements.libraryCleanupStatus.textContent = uiT(
        'settings.library.cleanup.status.summary',
        'Eksik: {missing} | Kopya: {duplicates} | Klasör: {folders} | Zaman: {time}',
        {
            missing: Number(summary.missingRemoved || 0),
            duplicates: Number(summary.duplicatesRemoved || 0),
            folders: Number(summary.folderRefsRemoved || 0),
            time: formatLibraryTimestamp(summary.generatedAt || Date.now())
        }
    );
}

function dedupePlaylistByPath() {
    const seen = new Set();
    const nextPlaylist = [];
    let duplicatesRemoved = 0;
    let nextCurrentIndex = state.currentIndex;

    state.playlist.forEach((item, index) => {
        const key = String(item?.path || '').trim().toLowerCase();
        if (!key || !seen.has(key)) {
            if (key) seen.add(key);
            nextPlaylist.push(item);
            return;
        }
        duplicatesRemoved += 1;
        if (index === state.currentIndex) {
            nextCurrentIndex = -1;
        } else if (index < state.currentIndex) {
            nextCurrentIndex -= 1;
        }
    });

    if (duplicatesRemoved > 0) {
        state.playlist = nextPlaylist;
        state.currentIndex = Math.max(-1, nextCurrentIndex);
        renderPlaylist();
    }
    return duplicatesRemoved;
}

async function cleanupMissingLibraryEntries() {
    const removedPlaylist = await removeMissingPlaylistEntries();
    const librarySettings = ensureLibrarySettings();
    const metadataCache = getLibraryMetadataCache();
    const nextCache = {};
    let removedCache = 0;
    const cacheEntries = Object.entries(metadataCache);

    const existence = await Promise.all(cacheEntries.map(([filePath]) => window.aurivo?.fileExists?.(filePath)));
    cacheEntries.forEach(([filePath, value], index) => {
        if (existence[index]) {
            nextCache[filePath] = value;
        } else {
            removedCache += 1;
        }
    });

    const nextVideoFiles = [];
    let removedVideo = 0;
    if (Array.isArray(state.videoFiles) && state.videoFiles.length) {
        const videoExistence = await Promise.all(state.videoFiles.map((item) => window.aurivo?.fileExists?.(item.path)));
        state.videoFiles.forEach((item, index) => {
            if (videoExistence[index]) {
                nextVideoFiles.push(item);
            } else {
                removedVideo += 1;
            }
        });
    }

    librarySettings.metadataCache = nextCache;
    state.videoFiles = nextVideoFiles;
    await saveSettings();
    await savePlaylistToDisk();
    persistVideoLibrary();
    return removedPlaylist + removedCache + removedVideo;
}

function cleanupDuplicateLibraryEntries() {
    const removedPlaylist = dedupePlaylistByPath();
    const dedupedAudioFolders = dedupeLibraryFolders(loadSavedFolders('audio'));
    const dedupedVideoFolders = dedupeLibraryFolders(loadSavedFolders('video'));
    const dedupedExcludedFolders = dedupeLibraryFolders(loadExcludedLibraryFolders());
    const removedFolderRefs =
        (loadSavedFolders('audio').length - dedupedAudioFolders.length) +
        (loadSavedFolders('video').length - dedupedVideoFolders.length) +
        (loadExcludedLibraryFolders().length - dedupedExcludedFolders.length);

    saveFolders('audio', dedupedAudioFolders);
    saveFolders('video', dedupedVideoFolders);
    saveExcludedLibraryFolders(dedupedExcludedFolders);

    if (Array.isArray(state.videoFiles) && state.videoFiles.length) {
        const seen = new Set();
        state.videoFiles = state.videoFiles.filter((item) => {
            const key = String(item?.path || '').trim().toLowerCase();
            if (!key || seen.has(key)) return false;
            seen.add(key);
            return true;
        });
        persistVideoLibrary();
    }

    if (removedPlaylist > 0) {
        savePlaylistToDisk().catch(() => {});
    }

    return removedPlaylist + Math.max(0, removedFolderRefs);
}

async function cleanupEmptyLibraryFolderReferences() {
    const audioFolders = loadSavedFolders('audio');
    const excludedFolders = loadExcludedLibraryFolders();
    const audioExtensions = getConfiguredLibraryExtensions('audio');
    const nextAudioFolders = [];
    let removedCount = 0;

    for (const folder of audioFolders) {
        const exists = await window.aurivo?.fileExists?.(folder.path);
        if (!exists) {
            removedCount += 1;
            continue;
        }
        const stats = await window.aurivo?.library?.getStats?.([folder], {}, excludedFolders, audioExtensions);
        if (Number(stats?.totalSongs || 0) <= 0) {
            removedCount += 1;
            continue;
        }
        nextAudioFolders.push(folder);
    }

    const trimMissingRefs = async (folders) => {
        const next = [];
        let removed = 0;
        for (const folder of folders) {
            const exists = await window.aurivo?.fileExists?.(folder.path);
            if (exists) next.push(folder);
            else removed += 1;
        }
        return { next, removed };
    };

    const videoResult = await trimMissingRefs(loadSavedFolders('video'));
    const excludedResult = await trimMissingRefs(excludedFolders);

    saveFolders('audio', nextAudioFolders);
    saveFolders('video', videoResult.next);
    saveExcludedLibraryFolders(excludedResult.next);
    renderLibraryFolderSettings();

    return removedCount + videoResult.removed + excludedResult.removed;
}

async function runLibraryCleanup(kind) {
    const summary = {
        missingRemoved: 0,
        duplicatesRemoved: 0,
        folderRefsRemoved: 0,
        generatedAt: Date.now()
    };

    if (elements.libraryCleanupStatus) {
        elements.libraryCleanupStatus.textContent = uiT('settings.library.cleanup.running', 'Temizlik işlemi çalışıyor...');
    }

    try {
        if (kind === 'missing') {
            summary.missingRemoved = await cleanupMissingLibraryEntries();
        } else if (kind === 'duplicates') {
            summary.duplicatesRemoved = cleanupDuplicateLibraryEntries();
        } else if (kind === 'empty-folders') {
            summary.folderRefsRemoved = await cleanupEmptyLibraryFolderReferences();
        }

        await refreshLibraryStats();
        renderLibraryFolderSettings();
        updateLibraryCleanupStatus(summary);
        safeNotify(uiT('settings.library.cleanup.done', 'Kütüphane temizliği tamamlandı.'), 'success', 1800);
    } catch (error) {
        console.error('[LIBRARY] cleanup error:', error);
        updateLibraryCleanupStatus({
            ...summary,
            generatedAt: Date.now()
        });
        safeNotify(uiT('settings.library.cleanup.failed', 'Kütüphane temizliği tamamlanamadı.'), 'error', 2200);
    }
}

async function refreshLibraryStats(options = {}) {
    const force = options === true ? true : options?.force === true;
    if (libraryStatsRuntime.inFlight && !force) {
        return state.libraryStats;
    }

    const libraryIndex = buildUnifiedAudioLibraryIndex(loadSavedFolders('audio'));
    state.libraryIndex.audio = libraryIndex;
    const folders = libraryIndex.folders;
    const extraFiles = libraryIndex.manualTracks.map((item) => item.path);
    const signature = JSON.stringify({
        folders: folders.map((folder) => folder.path),
        manualTracks: extraFiles,
        audioExt: getConfiguredLibraryExtensions('audio'),
        excluded: getExcludedLibraryFoldersForScan(),
        perf: getLibraryPerformanceState()
    });

    if (
        !force &&
        state.libraryStats &&
        libraryStatsRuntime.lastSignature === signature &&
        Date.now() - libraryStatsRuntime.lastComputedAt < 120000
    ) {
        if (shouldRefreshLibraryStatsUi()) {
            applyLibraryStatsToUi(state.libraryStats);
            updateLibraryDiagnosticsUi();
        }
        return state.libraryStats;
    }

    if (!folders.length && !extraFiles.length) {
        state.libraryStats = {
            totalSongs: 0,
            totalArtists: 0,
            totalAlbums: 0,
            totalDurationSec: 0,
            missingMetadataCount: 0,
            missingCoverCount: 0
        };
        libraryStatsRuntime.lastComputedAt = Date.now();
        libraryStatsRuntime.lastSignature = signature;
        applyLibraryStatsToUi();
        return;
    }

    if (shouldRefreshLibraryStatsUi()) {
        if (elements.libraryStatsTotalSongs) elements.libraryStatsTotalSongs.textContent = '...';
        if (elements.libraryStatsTotalArtists) elements.libraryStatsTotalArtists.textContent = '...';
        if (elements.libraryStatsTotalAlbums) elements.libraryStatsTotalAlbums.textContent = '...';
        if (elements.libraryStatsTotalDuration) elements.libraryStatsTotalDuration.textContent = '...';
        if (elements.libraryStatsMissingMetadata) elements.libraryStatsMissingMetadata.textContent = '...';
        if (elements.libraryStatsMissingCover) elements.libraryStatsMissingCover.textContent = '...';
    }

    try {
        libraryStatsRuntime.inFlight = true;
        const stats = await window.aurivo?.library?.getStatsComposite?.(
            folders,
            extraFiles,
            getLibraryMetadataCache(),
            getExcludedLibraryFoldersForScan(),
            getConfiguredLibraryExtensions('audio'),
            getLibraryPerformanceState()
        );
        state.libraryStats = stats || null;
        state.libraryIndex.audio = {
            ...libraryIndex,
            stats: stats || null
        };
        rememberLibraryDiagnosticsPatch({
            scanErrors: Array.isArray(stats?.scanErrors) ? stats.scanErrors : [],
            unreadableFiles: Array.isArray(stats?.unreadableFiles) ? stats.unreadableFiles : []
        });
        libraryStatsRuntime.lastComputedAt = Date.now();
        libraryStatsRuntime.lastSignature = signature;
        if (shouldRefreshLibraryStatsUi()) {
            applyLibraryStatsToUi(stats || null);
        } else {
            updateLibraryHeroOverview();
        }
        syncAudioLibraryRootViewIfNeeded();
        updateLibraryDiagnosticsUi();
        return stats || null;
    } catch (error) {
        console.error('[LIBRARY] refresh stats error:', error);
        state.libraryStats = null;
        if (shouldRefreshLibraryStatsUi()) {
            applyLibraryStatsToUi(null);
        }
        pushLibraryDiagnosticError(error?.message || error, 'stats-refresh');
        return null;
    } finally {
        libraryStatsRuntime.inFlight = false;
    }
}

async function refreshLibraryMetadataCache(options = {}) {
    const folders = loadSavedFolders('audio');
    if (!folders.length) {
        safeNotify(uiT('settings.library.notify.noFolders', 'Önce en az bir müzik klasörü ekleyin.'), 'warning', 2000);
        return;
    }

    try {
        if (elements.libraryMetadataStatus) {
            elements.libraryMetadataStatus.textContent = uiT('settings.library.metadata.running', 'Metadata taranıyor...');
        }
        const result = await window.aurivo?.library?.refreshMetadata?.(
            folders,
            options,
            getExcludedLibraryFoldersForScan(),
            getConfiguredLibraryExtensions('audio'),
            getLibraryPerformanceState()
        );
        const librarySettings = ensureLibrarySettings();
        librarySettings.metadataCache = result?.items || {};
        librarySettings.metadataSummary = result?.summary || {
            refreshedCount: 0,
            inferredCount: 0,
            cleanedCount: 0,
            generatedAt: Date.now()
        };
        rememberLibraryDiagnosticsPatch({
            scanErrors: Array.isArray(result?.summary?.scanErrors) ? result.summary.scanErrors : getLibraryDiagnosticsState().scanErrors,
            unreadableFiles: Array.isArray(result?.summary?.unreadableFiles) ? result.summary.unreadableFiles : getLibraryDiagnosticsState().unreadableFiles
        });
        await saveSettings();
        updateLibraryMetadataStatusUi();
        updateLibraryDiagnosticsUi();
        applyMetadataCacheToPlaylist();
        await refreshLibraryStats();
        safeNotify(uiT('settings.library.metadata.done', 'Metadata önbelleği güncellendi.'), 'success', 1800);
    } catch (error) {
        console.error('[LIBRARY] metadata cache refresh error:', error);
        updateLibraryMetadataStatusUi();
        pushLibraryDiagnosticError(error?.message || error, 'metadata-refresh');
        safeNotify(uiT('settings.library.metadata.failed', 'Metadata işlemi tamamlanamadı.'), 'error', 2200);
    }
}

async function addMusicFolderFromSettings() {
    try {
        const result = await window.aurivo?.dialog?.openFolder?.({
            title: uiT('settings.library.folders.pickTitle', 'Müzik klasörü seç'),
            defaultPath: state.specialPaths?.music || undefined
        });
        if (!result?.path) return;

        await addUserFolder(
            result.path,
            result.name || window.aurivo?.path?.basename?.(result.path) || 'Klasör',
            'audio'
        );
        safeNotify(uiT('settings.library.notify.folderAdded', 'Müzik klasörü eklendi.'), 'success', 1800);
    } catch (e) {
        safeNotify(`${uiT('settings.library.notify.folderPickFailed', 'Klasör seçilemedi')}: ${e?.message || e}`, 'error', 2200);
    }
}

async function addMusicFilesToLibrary() {
    try {
        state.mediaFilter = 'audio';
        const files = await window.aurivo?.dialog?.openFiles?.({
            title: uiT('libraryActions.addFiles', 'Dosya Ekle'),
            filters: [
                { name: uiT('libraryActions.addFiles', 'Dosya Ekle'), extensions: getConfiguredLibraryExtensions('audio') },
                { name: uiT('common.allFiles', 'Tüm Dosyalar'), extensions: ['*'] }
            ]
        });
        if (!files || !files.length) return;

        const existingFolders = loadSavedFolders('audio');
        const existingFolderPaths = new Set(existingFolders.map((folder) => String(folder?.path || '').trim()));
        const derivedFolders = [];
        const derivedFolderPaths = new Set();
        for (const file of files) {
            const parentPath = String(window.aurivo?.path?.dirname?.(file.path) || '').trim();
            if (!parentPath) continue;
            if (existingFolderPaths.has(parentPath) || derivedFolderPaths.has(parentPath)) continue;
            derivedFolderPaths.add(parentPath);
            derivedFolders.push({
                path: parentPath,
                name: window.aurivo?.path?.basename?.(parentPath) || parentPath.split(/[\\/]/).filter(Boolean).pop() || 'Klasör'
            });
        }

        let firstIndex = null;
        let addedCount = 0;
        for (const f of files) {
            const { index, added } = addToPlaylist(f.path, f.name);
            if (added) addedCount++;
            if (firstIndex === null && typeof index === 'number' && index >= 0) firstIndex = index;
        }

        if (derivedFolders.length) {
            saveFolders('audio', [...existingFolders, ...derivedFolders]);
            state.lastAddedLibraryFolderPath = derivedFolders[0].path;
            renderLibraryFolderSettings();
            syncAudioLibraryRootViewIfNeeded();
            if (state.currentPage === 'music' && state.currentPanel === 'library' && !state.currentPath) {
                initializeFileTree().catch(() => {});
            }
        }

        if (addedCount) {
            safeNotify(
                uiT('settings.library.notify.filesAdded', '{count} dosya eklendi.', { count: addedCount }),
                'success',
                1800
            );
        }
        if (state.currentIndex === -1 && typeof firstIndex === 'number' && firstIndex >= 0) {
            playIndex(firstIndex);
        }
    } catch (e) {
        safeNotify(`${uiT('settings.library.notify.filePickFailed', 'Dosya seçilemedi')}: ${e?.message || e}`, 'error', 2200);
    }
}

function hideLibraryAddMenu() {
    document.getElementById('libraryAddMenu')?.remove();
}

function buildLibraryAddMenuItem(label, options = {}) {
    const item = document.createElement('div');
    item.className = 'context-menu-item';
    if (options.disabled) item.classList.add('disabled');
    item.innerHTML = `
        <span class="context-menu-icon">${options.icon || '•'}</span>
        <span>${label}</span>
    `;
    if (!options.disabled && typeof options.onClick === 'function') {
        item.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            hideLibraryAddMenu();
            await options.onClick();
        });
    }
    return item;
}

function showLibraryAddMenu(anchor, scope = 'audio') {
    if (!anchor) return;
    hideLibraryAddMenu();

    const menu = document.createElement('div');
    menu.id = 'libraryAddMenu';
    menu.className = 'context-menu library-add-menu';

    const items = scope === 'audio'
        ? [
            buildLibraryAddMenuItem(uiT('libraryActions.addFiles', 'Dosya Ekle'), {
                icon: '🎵',
                onClick: () => addMusicFilesToLibrary()
            }),
            buildLibraryAddMenuItem(uiT('libraryActions.addFolder', 'Klasör Ekle'), {
                icon: '📁',
                onClick: () => addMusicFolderFromSettings()
            })
        ]
        : [
            buildLibraryAddMenuItem(uiT('libraryActions.openVideo', 'Video Aç'), {
                icon: '🎬',
                onClick: async () => {
                    try {
                        state.mediaFilter = 'video';
                        const files = await window.aurivo?.dialog?.openFiles?.({
                            title: uiT('libraryActions.openVideo', 'Video Aç'),
                            filters: [
                                { name: uiT('libraryActions.openVideo', 'Video Aç'), extensions: getConfiguredLibraryExtensions('video') },
                                { name: uiT('common.allFiles', 'Tüm Dosyalar'), extensions: ['*'] }
                            ]
                        });
                        if (!files || !files.length) return;
                        state.videoFiles = files.map((f) => ({ name: f.name, path: f.path }));
                        persistVideoLibrary();
                        state.currentPath = '';
                        renderVideoLibraryTree();
                        playVideo(state.videoFiles[0].path);
                    } catch (e) {
                        safeNotify(`${uiT('libraryActions.openVideo', 'Video Aç')}: ${e?.message || e}`, 'error', 2200);
                    }
                }
            })
        ];

    items.forEach((item) => menu.appendChild(item));
    document.body.appendChild(menu);

    const rect = anchor.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    let left = rect.left;
    let top = rect.bottom + 8;

    if (left + menuRect.width > window.innerWidth - 12) {
        left = Math.max(12, window.innerWidth - menuRect.width - 12);
    }
    if (top + menuRect.height > window.innerHeight - 12) {
        top = Math.max(12, rect.top - menuRect.height - 8);
    }

    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
}

function removeMusicFolderFromSettings(path) {
    removeUserFolderWithScope(path, 'audio');
    safeNotify(uiT('settings.library.notify.folderRemoved', 'Müzik klasörü kaldırıldı.'), 'success', 1800);
}

async function pruneMissingManagedFolderReferences(notify = false) {
    if (!window.aurivo?.fileExists) return 0;

    const removeMissing = async (folders = []) => {
        const next = [];
        let removed = 0;
        for (const folder of folders) {
            const folderPath = String(folder?.path || '').trim();
            if (!folderPath) {
                removed += 1;
                continue;
            }
            const exists = await window.aurivo.fileExists(folderPath);
            if (exists) next.push(folder);
            else removed += 1;
        }
        return { next, removed };
    };

    const audio = await removeMissing(loadSavedFolders('audio'));
    const video = await removeMissing(loadSavedFolders('video'));
    const excluded = await removeMissing(loadExcludedLibraryFolders());
    const removedTotal = audio.removed + video.removed + excluded.removed;

    if (removedTotal > 0) {
        saveFolders('audio', audio.next);
        saveFolders('video', video.next);
        saveExcludedLibraryFolders(excluded.next);
        renderLibraryFolderSettings();
        if (notify) {
            safeNotify(
                uiT(
                    'settings.library.notify.missingFolderRefsRemoved',
                    'Bulunamayan klasör referansları temizlendi ({count}).',
                    { count: removedTotal }
                ),
                'warning',
                2600
            );
        }
    }

    return removedTotal;
}

async function rescanMusicFolders(targetPath = '', options = {}) {
    const { notify = true, reason = 'manual', preserveCurrentPath = false } = options || {};
    await pruneMissingManagedFolderReferences(notify);
    const folders = loadSavedFolders('audio');
    const startedAt = Date.now();
    if (!folders.length) {
        if (notify) {
            safeNotify(uiT('settings.library.notify.noFolders', 'Önce en az bir müzik klasörü ekleyin.'), 'warning', 2000);
        }
        state.libraryStats = {
            totalSongs: 0,
            totalArtists: 0,
            totalAlbums: 0,
            totalDurationSec: 0,
            missingMetadataCount: 0,
            missingCoverCount: 0
        };
        applyLibraryStatsToUi();
        rememberLibraryDiagnosticsPatch({
            lastScanReason: reason,
            lastScanDurationMs: Date.now() - startedAt
        });
        updateLibraryDiagnosticsUi();
        return;
    }

    state.mediaFilter = 'audio';
    state.currentPanel = 'library';
    if (!preserveCurrentPath && (!targetPath || state.currentPath === targetPath)) {
        state.currentPath = '';
    }
    if (state.currentPage === 'music' && state.currentPanel === 'library') {
        await initializeFileTree();
    }
    renderLibraryFolderSettings();
    try {
        await refreshLibraryStats();
        const librarySettings = ensureLibrarySettings();
        librarySettings.lastScanAt = Date.now();
        rememberLibraryDiagnosticsPatch({
            lastScanReason: reason,
            lastScanDurationMs: Date.now() - startedAt
        });
        await saveSettings();
        updateLibraryDiagnosticsUi();
        if (notify) {
            safeNotify(uiT('settings.library.notify.rescanned', 'Müzik klasörleri yenilendi.'), 'success', 1800);
        }
    } catch (error) {
        pushLibraryDiagnosticError(error?.message || error, `rescan-${reason}`);
        throw error;
    }
}

async function maybeAutoRescanMusicLibrary(reason = 'folder-change') {
    const librarySettings = ensureLibrarySettings();
    if (!librarySettings.autoRescanOnFolderChange) return;
    await rescanMusicFolders('', { notify: false, reason, preserveCurrentPath: true });
    safeNotify(uiT('settings.library.notify.autoRescanned', 'Kütüphane otomatik yenilendi.'), 'info', 1600);
    console.log('[LIBRARY] auto rescan triggered:', reason);
}

async function runStartupLibraryScanIfNeeded() {
    const librarySettings = ensureLibrarySettings();
    if (!librarySettings.scanOnStartup) return;
    if (!loadSavedFolders('audio').length) return;
    await rescanMusicFolders('', { notify: false, reason: 'startup', preserveCurrentPath: true });
    console.log('[LIBRARY] startup scan completed');
}

function updateLibraryWatchStatus(kind = 'idle', payload = {}) {
    if (!elements.libraryWatchStatus) return;
    if (kind === 'disabled') {
        elements.libraryWatchStatus.textContent = uiT('settings.library.watchStatus.disabled', 'İzleme kapalı.');
        updateLibraryHeroOverview();
        return;
    }
    if (kind === 'watching') {
        elements.libraryWatchStatus.textContent = uiT(
            'settings.library.watchStatus.watching',
            '{folders} klasör, {dirs} dizin izleniyor.',
            {
                folders: Number(payload.watchedFolders || 0),
                dirs: Number(payload.watchedDirectories || 0)
            }
        );
        updateLibraryHeroOverview();
        return;
    }
    if (kind === 'changed') {
        const changedPath = String(payload.changePath || '').trim() || '-';
        elements.libraryWatchStatus.textContent = uiT(
            'settings.library.watchStatus.changed',
            'Değişiklik algılandı: {path}',
            { path: changedPath }
        );
        updateLibraryHeroOverview();
        return;
    }
    if (kind === 'error') {
        pushLibraryDiagnosticError(payload.error || 'watch-error', 'watch', payload.changePath || '');
        elements.libraryWatchStatus.textContent = uiT(
            'settings.library.watchStatus.error',
            'İzleme hatası: {error}',
            { error: String(payload.error || 'unknown') }
        );
        updateLibraryHeroOverview();
        return;
    }
    elements.libraryWatchStatus.textContent = uiT('settings.library.watchStatus.idle', 'İzleme beklemede.');
    updateLibraryHeroOverview();
}

async function removeMissingPlaylistEntries() {
    if (!state.playlist.length || !window.aurivo?.fileExists) return 0;
    const existence = await Promise.all(state.playlist.map((item) => window.aurivo.fileExists(item.path)));
    let removed = 0;
    const nextPlaylist = [];
    let nextCurrentIndex = state.currentIndex;

    state.playlist.forEach((item, index) => {
        if (existence[index]) {
            nextPlaylist.push(item);
            return;
        }
        removed += 1;
        if (index === state.currentIndex) {
            nextCurrentIndex = -1;
        } else if (index < state.currentIndex) {
            nextCurrentIndex -= 1;
        }
    });

    if (!removed) return 0;
    state.playlist = nextPlaylist;
    state.currentIndex = Math.max(-1, nextCurrentIndex);
    renderPlaylist();
    await savePlaylistToDisk();
    return removed;
}

async function syncLibraryWatchState() {
    if (isStandaloneSettingsMode()) {
        updateLibraryWatchStatus('idle');
        return;
    }

    const librarySettings = ensureLibrarySettings();
    const folders = loadSavedFolders('audio');

    if (!libraryWatchUnsubscribe && window.aurivo?.library?.onWatchEvent) {
        libraryWatchUnsubscribe = window.aurivo.library.onWatchEvent((payload) => {
            if (payload?.type === 'error') {
                updateLibraryWatchStatus('error', payload);
                return;
            }

            updateLibraryWatchStatus('changed', payload || {});
            if (libraryWatchRescanTimer) clearTimeout(libraryWatchRescanTimer);
            libraryWatchRescanTimer = setTimeout(async () => {
                try {
                    const removedCount = await removeMissingPlaylistEntries();
                    await rescanMusicFolders('', { notify: false, preserveCurrentPath: true });
                    updateLibraryWatchStatus('watching', payload || {});
                    const messageKey = removedCount > 0
                        ? 'settings.library.notify.watchUpdatedRemoved'
                        : 'settings.library.notify.watchUpdated';
                    safeNotify(
                        uiT(
                            messageKey,
                            removedCount > 0
                                ? 'Kütüphane güncellendi, {count} eksik kayıt kaldırıldı.'
                                : 'Kütüphane dosya değişikliğine göre güncellendi.',
                            { count: removedCount }
                        ),
                        'info',
                        1800
                    );
                } catch (error) {
                    updateLibraryWatchStatus('error', { error: error?.message || error });
                }
            }, 1200);
        });
    }

    if (!librarySettings.watchFolders || !folders.length) {
        await window.aurivo?.library?.stopWatch?.();
        updateLibraryWatchStatus(librarySettings.watchFolders ? 'idle' : 'disabled');
        return;
    }

    const result = await window.aurivo?.library?.startWatch?.(folders, getExcludedLibraryFoldersForScan());
    if (result?.watching) {
        updateLibraryWatchStatus('watching', result);
    } else if (result?.error) {
        updateLibraryWatchStatus('error', result);
    } else {
        updateLibraryWatchStatus('idle');
    }
}

// Klasör ekleme dialog'u
async function openFolderDialog() {
    try {
        const scope = getUserFoldersScope();
        const defaultPath = scope === 'video' ? state.specialPaths?.videos : state.specialPaths?.music;
        const result = await window.aurivo.dialog.openFolder({
            title: scope === 'video' ? 'Video klasörü seç' : 'Müzik klasörü seç',
            defaultPath: defaultPath || undefined
        });
        if (result && result.path) {
            await addUserFolder(result.path, result.name);
        }
    } catch (e) {
        console.error('Klasör seçme hatası:', e);
    }
}

// Kullanıcı klasörü ekle
async function addUserFolder(path, name, scopeOverride = null) {
    const scope = scopeOverride || getUserFoldersScope();
    const folders = loadSavedFolders(scope);

    // Zaten ekli mi kontrol et
    if (folders.some(f => f.path === path)) {
        console.log('Bu klasör zaten ekli:', path);
        // Zaten kayıtlıysa sadece listeyi göster.
        state.currentPath = '';
        await initializeFileTree();
        return;
    }

    folders.push({ name, path });
    saveFolders(scope, folders);
    if (scope === 'audio') {
        state.lastAddedLibraryFolderPath = path;
    }
    renderLibraryFolderSettings();
    if (scope === 'audio') {
        syncAudioLibraryRootViewIfNeeded();
        refreshLibraryStats().catch(() => {});
        maybeAutoRescanMusicLibrary('folder-added').catch(() => {});
    }

    // Yeni eklenen klasörü doğrudan aç; böylece kullanıcı eklemenin başarılı olduğunu
    // anında görür. Geri ile kök kütüphane görünümüne dönebilir.
    state.currentPath = '';
    if (scope === 'audio' && state.currentPage === 'music' && state.currentPanel === 'library') {
        await loadDirectory(path, true);
    } else {
        await initializeFileTree();
    }
    elements.libraryManagedFoldersList?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });

    console.log('Klasör eklendi:', name, path);

}

// Kullanıcı klasörünü kaldır
function removeUserFolder(path) {
    const scope = getUserFoldersScope();
    let folders = loadSavedFolders(scope);
    folders = folders.filter(f => f.path !== path);
    saveFolders(scope, folders);
    if (scope === 'audio') {
        invalidateAudioLibraryIndex();
    }
    renderLibraryFolderSettings();
    if (scope === 'audio') {
        maybeAutoRescanMusicLibrary('folder-removed').catch(() => {});
    }

    // File tree'yi yeniden yükle
    initializeFileTree();

    console.log('Klasör kaldırıldı:', path);
}

// EVENT DELEGATION - File Tree Click İşleyici
function handleFileTreeClick(e) {
    const item = e.target.closest('.tree-item');
    if (!item) return;

    const path = item.dataset.path;
    const isDirectory = item.dataset.isDirectory === 'true' || item.classList.contains('folder');

    console.log('Tıklanan:', path, 'Klasör:', isDirectory);

    if (isDirectory) {
        loadDirectory(path);
    } else {
        // Dosya seçimi
        document.querySelectorAll('.tree-item.file').forEach(i => i.classList.remove('selected'));
        item.classList.add('selected');
    }
}

// EVENT DELEGATION - File Tree Double Click İşleyici
function handleFileTreeDblClick(e) {
    const item = e.target.closest('.tree-item');
    if (!item) return;

    const path = item.dataset.path;
    const isDirectory = item.dataset.isDirectory === 'true' || item.classList.contains('folder');
    const name = item.dataset.name || path.split('/').pop();

    if (isDirectory) {
        loadDirectory(path);
    } else {
        // Dosyayı türüne göre ilgili sekmede çalıştır
        handleTreeItemDoubleClick(path, false, name);
    }
}

// Global fallback handlers (capture phase)
function handleFileTreeClickGlobal(e) {
    if (!elements.fileTree || !elements.fileTree.contains(e.target)) return;
    handleFileTreeClick(e);
}

function handleFileTreeDblClickGlobal(e) {
    if (!elements.fileTree || !elements.fileTree.contains(e.target)) return;
    handleFileTreeDblClick(e);
}

// Kullanıcı klasörü sağ tık menüsü
function handleFileTreeContextMenu(e) {
    const item = e.target.closest('.tree-item.user-folder');
    if (!item) return;

    e.preventDefault();

    const path = item.dataset.path;
    const name = item.dataset.name;
    const scope = item.dataset.folderScope || getUserFoldersScope();

    showFolderContextMenu(e.clientX, e.clientY, path, name, scope);
}

function showFolderContextMenu(x, y, path, name, scope) {
    // Varolan menüyü kaldır
    let menu = document.getElementById('folderContextMenu');
    if (menu) menu.remove();

    // Yeni menü oluştur
    menu = document.createElement('div');
    menu.id = 'folderContextMenu';
    menu.className = 'context-menu folder-context-menu';
    menu.innerHTML = `
        <div class="context-menu-item" data-action="remove">
            <span class="context-menu-icon">🗑️</span>
            <span>${uiT('playlist.context.folder.remove', 'Remove from library')}</span>
        </div>
        <div class="context-menu-item" data-action="open">
            <span class="context-menu-icon">📂</span>
            <span>${uiT('playlist.context.folder.open', 'Open folder')}</span>
        </div>
    `;

    document.body.appendChild(menu);

    // Pozisyon ayarla
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';

    // Menü öğelerine tıklama
    menu.querySelector('[data-action="remove"]').addEventListener('click', () => {
        removeUserFolderWithScope(path, scope);
        menu.remove();
    });

    menu.querySelector('[data-action="open"]').addEventListener('click', () => {
        loadDirectory(path);
        menu.remove();
    });
}

function removeUserFolderWithScope(path, scope) {
    const s = scope === 'video' ? 'video' : 'audio';
    let folders = loadSavedFolders(s);
    folders = folders.filter(f => f.path !== path);
    saveFolders(s, folders);
    renderLibraryFolderSettings();
    if (s === 'audio') {
        maybeAutoRescanMusicLibrary('folder-removed').catch(() => {});
    }
    initializeFileTree();
}

function hidePlaylistContextMenu() {
    const menu = document.getElementById('playlistContextMenu');
    if (menu) menu.remove();
}

function positionFloatingContextMenu(menu, x, y) {
    if (!menu) return;
    const pad = 10;
    const rect = menu.getBoundingClientRect();
    const maxLeft = Math.max(pad, window.innerWidth - rect.width - pad);
    const maxTop = Math.max(pad, window.innerHeight - rect.height - pad);
    menu.style.left = Math.max(pad, Math.min(x, maxLeft)) + 'px';
    menu.style.top = Math.max(pad, Math.min(y, maxTop)) + 'px';
}

function sanitizePlaylistSearchQuery(item) {
    const raw = String(item?.name || '').trim();
    if (!raw) return '';
    return raw
        .replace(/\.[^.]+$/, '')
        .replace(/[_]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function buildPlaylistContextMenuItem(label, options = {}) {
    if (options.separator) {
        const sep = document.createElement('div');
        sep.className = 'context-menu-separator';
        return sep;
    }

    const item = document.createElement('div');
    item.className = 'context-menu-item';
    if (options.disabled) item.classList.add('disabled');
    item.innerHTML = `
        <span class="context-menu-icon">${options.icon || '•'}</span>
        <span>${label}</span>
    `;
    if (!options.disabled && typeof options.onClick === 'function') {
        item.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            hidePlaylistContextMenu();
            await options.onClick();
        });
    }
    return item;
}

function buildPlaylistContextSubmenuItem(label, options = {}) {
    const item = document.createElement('div');
    item.className = 'context-menu-item';
    if (options.disabled) item.classList.add('disabled');

    const caret = options.submenu ? '<span class="context-menu-submenu-caret">›</span>' : '';
    item.innerHTML = `
        <span class="context-menu-icon">${options.icon || '•'}</span>
        <span>${label}</span>
        ${caret}
    `;

    if (options.submenu) {
        item.classList.add('has-submenu');
        const submenu = document.createElement('div');
        submenu.className = 'context-submenu';
        options.submenu.forEach((entry) => {
            submenu.appendChild(buildPlaylistContextMenuItem(entry.label, entry));
        });
        item.appendChild(submenu);
        return item;
    }

    if (!options.disabled && typeof options.onClick === 'function') {
        item.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            hidePlaylistContextMenu();
            await options.onClick();
        });
    }
    return item;
}

async function searchPlaylistItemOnYouTube(index) {
    const item = state.playlist[index];
    const query = sanitizePlaylistSearchQuery(item);
    if (!item || !query) return;

    const btn = getWebPlatformBtnByName('youtube') || getPreferredWebPlatformBtn();
    if (!btn) {
        safeNotify(uiT('playlist.context.notify.youtubeUnavailable', 'YouTube platform button is unavailable.'), 'error', 2000);
        return;
    }

    const searchUrl = buildPulseSearchUrl('youtube', query);
    prepareWebUiForPulseSearch(btn);
    await navigatePulseSearchInWebView(searchUrl, query, 'youtube', { fastPath: true });
    safeNotify(uiT('playlist.context.notify.youtubeSearch', 'Opening in YouTube: {query}', { query }), 'info', 2200);
}

function getPlaylistItemYouTubeSearchUrl(index) {
    const item = state.playlist[index];
    const query = sanitizePlaylistSearchQuery(item);
    if (!query) return '';
    return buildPulseSearchUrl('youtube', query);
}

function copyPlaylistItemYouTubeLink(index) {
    const url = getPlaylistItemYouTubeSearchUrl(index);
    if (!url) return;
    const ok = !!window.aurivo?.clipboard?.setText?.(url);
    safeNotify(
        ok
            ? uiT('playlist.context.notify.youtubeLinkCopied', 'YouTube search link copied.')
            : uiT('playlist.context.notify.youtubeLinkCopyFailed', "Couldn't copy YouTube search link."),
        ok ? 'success' : 'error',
        1800
    );
}

async function openPlaylistItemOnYouTubeInBrowser(index) {
    const url = getPlaylistItemYouTubeSearchUrl(index);
    if (!url || !window.aurivo?.webSecurity?.openExternal) {
        safeNotify(uiT('playlist.context.notify.youtubeBrowserFailed', "Couldn't open YouTube in browser."), 'error', 2200);
        return;
    }
    try {
        const ok = await window.aurivo.webSecurity.openExternal(url);
        safeNotify(
            ok
                ? uiT('playlist.context.notify.youtubeBrowserOpened', 'YouTube search opened in browser.')
                : uiT('playlist.context.notify.youtubeBrowserFailed', "Couldn't open YouTube in browser."),
            ok ? 'success' : 'error',
            1800
        );
    } catch (e) {
        safeNotify(
            uiT('playlist.context.notify.youtubeBrowserError', "Couldn't open YouTube in browser: {error}", { error: e?.message || e }),
            'error',
            2200
        );
    }
}

function copyPlaylistItemName(index) {
    const item = state.playlist[index];
    if (!item?.name) return;
    const ok = !!window.aurivo?.clipboard?.setText?.(item.name);
    safeNotify(
        ok
            ? uiT('playlist.context.notify.nameCopied', 'Track name copied.')
            : uiT('playlist.context.notify.nameCopyFailed', "Couldn't copy track name."),
        ok ? 'success' : 'error',
        1800
    );
}

function copyPlaylistItemPath(index) {
    const item = state.playlist[index];
    if (!item?.path) return;
    const ok = !!window.aurivo?.clipboard?.setText?.(item.path);
    safeNotify(
        ok
            ? uiT('playlist.context.notify.pathCopied', 'File path copied.')
            : uiT('playlist.context.notify.pathCopyFailed', "Couldn't copy file path."),
        ok ? 'success' : 'error',
        1800
    );
}

async function openPlaylistItemFolder(index) {
    const item = state.playlist[index];
    const dir = item?.path && window.aurivo?.path?.dirname?.(item.path);
    const url = dir && window.aurivo?.path?.toFileUrl?.(dir);
    if (!dir || !url || !window.aurivo?.webSecurity?.openExternal) {
        safeNotify(uiT('playlist.context.notify.folderOpenFailed', "Couldn't open file location."), 'error', 2200);
        return;
    }

    try {
        const ok = await window.aurivo.webSecurity.openExternal(url);
        safeNotify(
            ok
                ? uiT('playlist.context.notify.folderOpened', 'File location opened.')
                : uiT('playlist.context.notify.folderOpenFailed', "Couldn't open file location."),
            ok ? 'success' : 'error',
            1800
        );
    } catch (e) {
        safeNotify(
            uiT('playlist.context.notify.folderOpenError', "Couldn't open file location: {error}", { error: e?.message || e }),
            'error',
            2200
        );
    }
}

function queuePlaylistItemNext(index) {
    if (index < 0 || index >= state.playlist.length || state.playlist.length < 2) return false;

    const originalCurrentIndex = state.currentIndex;
    if (originalCurrentIndex < 0) {
        if (index === 0) return false;
        const [item] = state.playlist.splice(index, 1);
        state.playlist.unshift(item);
        renderPlaylist();
        savePlaylistToDisk();
        return true;
    }

    if (index === originalCurrentIndex || index === originalCurrentIndex + 1) return false;

    const [movedItem] = state.playlist.splice(index, 1);
    let adjustedCurrentIndex = originalCurrentIndex;
    if (index < originalCurrentIndex) adjustedCurrentIndex -= 1;

    const insertIndex = Math.min(adjustedCurrentIndex + 1, state.playlist.length);
    state.playlist.splice(insertIndex, 0, movedItem);
    state.currentIndex = adjustedCurrentIndex;

    renderPlaylist();
    savePlaylistToDisk();
    return true;
}

async function triggerPlaylistPrimaryAction(index) {
    if (index < 0 || index >= state.playlist.length) return;
    const isCurrentAudio = index === state.currentIndex && state.activeMedia === 'audio';
    if (isCurrentAudio) {
        togglePlayPause();
        return;
    }
    await playIndex(index);
}

function showPlaylistContextMenu(x, y, index) {
    const item = state.playlist[index];
    if (!item) return;

    hidePlaylistContextMenu();
    selectPlaylistItem(index);

    const menu = document.createElement('div');
    menu.id = 'playlistContextMenu';
    menu.className = 'context-menu playlist-context-menu';

    const isCurrentAudio = index === state.currentIndex && state.activeMedia === 'audio';
    const isFavorite = !!(getTrackActivityForPath(item.path)?.favorite || item.favorite);
    const primaryLabel = isCurrentAudio
        ? (state.isPlaying
            ? uiT('playlist.context.pause', 'Pause')
            : uiT('playlist.context.resume', 'Resume'))
        : uiT('playlist.context.playNow', 'Play now');

    const items = [
        buildPlaylistContextMenuItem(primaryLabel, {
            icon: isCurrentAudio ? '⏯' : '▶',
            onClick: () => triggerPlaylistPrimaryAction(index)
        }),
        buildPlaylistContextMenuItem(
            isFavorite
                ? uiT('playlist.context.unfavorite', 'Favoriden çıkar')
                : uiT('playlist.context.favorite', 'Favoriye ekle'),
            {
                icon: isFavorite ? '★' : '☆',
                onClick: () => toggleTrackFavorite(index)
            }
        ),
        buildPlaylistContextMenuItem(uiT('playlist.context.playNext', 'Play next'), {
            icon: '⤴',
            disabled: !state.playlist.length || (state.currentIndex >= 0 && (index === state.currentIndex || index === state.currentIndex + 1)),
            onClick: () => {
                const ok = queuePlaylistItemNext(index);
                safeNotify(
                    ok
                        ? uiT('playlist.context.notify.queuedNext', 'Track queued to play next.')
                        : uiT('playlist.context.notify.queueNoChange', 'Track is already in the next position.'),
                    ok ? 'success' : 'info',
                    1800
                );
            }
        }),
        buildPlaylistContextMenuItem('', { separator: true }),
        buildPlaylistContextMenuItem(uiT('playlist.context.searchYoutube', 'Search on YouTube'), {
            icon: '📺',
            onClick: () => searchPlaylistItemOnYouTube(index)
        }),
        buildPlaylistContextSubmenuItem(uiT('playlist.context.share', 'Share'), {
            icon: '↗',
            submenu: [
                {
                    label: uiT('playlist.context.copyYoutubeLink', 'Copy YouTube search link'),
                    icon: '🔗',
                    onClick: () => copyPlaylistItemYouTubeLink(index)
                },
                {
                    label: uiT('playlist.context.openYoutubeBrowser', 'Open YouTube in browser'),
                    icon: '🌐',
                    onClick: () => openPlaylistItemOnYouTubeInBrowser(index)
                },
                {
                    label: uiT('playlist.context.copyName', 'Copy track name'),
                    icon: '⧉',
                    onClick: () => copyPlaylistItemName(index)
                },
                {
                    label: uiT('playlist.context.copyPath', 'Copy file path'),
                    icon: '📋',
                    onClick: () => copyPlaylistItemPath(index)
                },
                {
                    label: uiT('playlist.context.openFolder', 'Open file location'),
                    icon: '📂',
                    onClick: () => openPlaylistItemFolder(index)
                }
            ]
        }),
        buildPlaylistContextMenuItem('', { separator: true }),
        buildPlaylistContextMenuItem(uiT('playlist.context.remove', 'Remove from playlist'), {
            icon: '🗑',
            onClick: () => removeFromPlaylist(index)
        }),
        buildPlaylistContextMenuItem(uiT('playlist.context.clearAll', 'Clear playlist'), {
            icon: '✦',
            disabled: state.playlist.length === 0,
            onClick: () => clearPlaylistAll()
        })
    ];

    items.forEach((node) => menu.appendChild(node));
    document.body.appendChild(menu);
    positionFloatingContextMenu(menu, x, y);
}

function handlePlaylistItemContextMenu(e) {
    const item = e.target.closest('.playlist-item');
    if (!item) return;
    e.preventDefault();
    const index = Number(item.dataset.index);
    if (!Number.isFinite(index)) return;
    showPlaylistContextMenu(e.clientX, e.clientY, index);
}

function handleNowPlayingContextMenu(e) {
    if (!elements.nowPlayingLabel || !elements.nowPlayingLabel.contains(e.target)) return;
    if (state.currentIndex < 0 || state.activeMedia !== 'audio') return;
    e.preventDefault();
    showPlaylistContextMenu(e.clientX, e.clientY, state.currentIndex);
}

function createTreeItem(name, path, isDirectory, icon = null) {
    const item = document.createElement('div');
    item.className = 'tree-item' + (isDirectory ? ' folder' : ' file');
    item.dataset.path = path;
    item.dataset.isDirectory = isDirectory;
    item.dataset.name = name;
    item.tabIndex = 0; // Klavye fokus için

    const iconSpan = document.createElement('span');
    iconSpan.className = 'tree-icon';

    if (!icon) {
        if (isDirectory) {
            icon = '📁';
        } else {
            const ext = name.split('.').pop().toLowerCase();
            icon = getConfiguredLibraryExtensions('video').includes(ext) ? '🎬' : '🎵';
        }
    }
    iconSpan.textContent = icon;

    const nameSpan = document.createElement('span');
    nameSpan.className = 'tree-name';
    nameSpan.textContent = name;

    item.appendChild(iconSpan);
    item.appendChild(nameSpan);

    // Tek tıklama - seçim (CTRL ile çoklu seçim)
    item.addEventListener('click', (e) => {
        e.stopPropagation();
        handleTreeItemClick(item, path, isDirectory, e);
    });

    // Mouse drag-select (hold left mouse button and drag vertically to select a range)
    item.addEventListener('mousedown', (e) => {
        if (isDirectory) return;
        if (!e || e.button !== 0) return;
        if (e.ctrlKey || e.shiftKey) return;

        fileTreeDragTrack = {
            startItem: item,
            startX: e.clientX,
            startY: e.clientY,
            selecting: false
        };

        const onMove = (ev) => {
            if (!fileTreeDragTrack) return;
            if (!(ev.buttons & 1)) return;

            const dx = ev.clientX - fileTreeDragTrack.startX;
            const dy = ev.clientY - fileTreeDragTrack.startY;
            const dist = Math.hypot(dx, dy);

            if (!fileTreeDragTrack.selecting) {
                if (dist < 6) return;
                // Engage selection only when the gesture is mostly vertical.
                if (Math.abs(dy) <= Math.abs(dx) + 4) {
                    // Likely intent is drag&drop, don't interfere.
                    cleanup();
                    return;
                }
                fileTreeDragTrack.selecting = true;
                blockFileTreeDragStart = true;

                // Başlat selection from the first item.
                document.querySelectorAll('.tree-item.file').forEach(i => i.classList.remove('selected'));
                fileTreeDragTrack.startItem.classList.add('selected');
                lastClickedFileItem = fileTreeDragTrack.startItem;
            }

            const el = document.elementFromPoint(ev.clientX, ev.clientY);
            const hover = el?.closest?.('.tree-item.file');
            if (!hover) return;

            document.querySelectorAll('.tree-item.file').forEach(i => i.classList.remove('selected'));
            selectFileRange(fileTreeDragTrack.startItem, hover);
            lastClickedFileItem = hover;
        };

        const onUp = () => {
            if (fileTreeDragTrack?.selecting) {
                suppressFileItemClickOnce = true;
            }
            cleanup();
        };

        const cleanup = () => {
            document.removeEventListener('mousemove', onMove, true);
            document.removeEventListener('mouseup', onUp, true);
            fileTreeDragTrack = null;
            // Release dragstart block after click cycle settles.
            setTimeout(() => { blockFileTreeDragStart = false; }, 0);
        };

        document.addEventListener('mousemove', onMove, true);
        document.addEventListener('mouseup', onUp, true);
    });

    // Çift tıklama - aç/çal
    item.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        handleTreeItemDoubleClick(path, isDirectory, name);
    });

    // Klavye işlemleri - tree item üzerinde
    item.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            addSelectedFilesToPlaylist();
        }
    });

    // Draggable yap (dosyalar için)
    if (!isDirectory) {
        item.draggable = true;
        item.addEventListener('dragstart', handleTreeItemDragStart);
        item.addEventListener('dragend', handleTreeItemDragEnd);
    }

    return item;
}

// Son tıklanan dosya öğesi (SHIFT seçimi için)
let lastClickedFileItem = null;

// Çoklu seçim ile tree item tıklama
function handleTreeItemClick(item, path, isDirectory, e) {
    if (suppressFileItemClickOnce) {
        suppressFileItemClickOnce = false;
        return;
    }
    console.log('Tree item tıklandı:', path, 'Klasör:', isDirectory);

    // Klasörse sadece aç
    if (isDirectory) {
        console.log('Klasör açılıyor:', path);
        loadDirectory(path);
        return;
    }

    // SHIFT tuşu - aralık seçimi
    if (e && e.shiftKey && lastClickedFileItem && !isDirectory) {
        e.preventDefault();
        selectFileRange(lastClickedFileItem, item);
        return;
    }

    // CTRL tuşu basılıysa çoklu seçim (toggle)
    if (e && e.ctrlKey && !isDirectory) {
        item.classList.toggle('selected');
        if (item.classList.contains('selected')) {
            lastClickedFileItem = item;
            rememberSelectedTreePath(path);
        }
        return;
    }

    // Normal tıklama - sadece bu öğeyi seç
    document.querySelectorAll('.tree-item.file').forEach(i => i.classList.remove('selected'));
    item.classList.add('selected');
    lastClickedFileItem = item;
    rememberSelectedTreePath(path);
}

// SHIFT+Click için aralık seçimi
function selectFileRange(startItem, endItem) {
    const allFiles = Array.from(document.querySelectorAll('.tree-item.file'));
    const startIndex = allFiles.indexOf(startItem);
    const endIndex = allFiles.indexOf(endItem);

    if (startIndex === -1 || endIndex === -1) return;

    const minIndex = Math.min(startIndex, endIndex);
    const maxIndex = Math.max(startIndex, endIndex);

    // Aralıktaki tüm dosyaları seç
    for (let i = minIndex; i <= maxIndex; i++) {
        allFiles[i].classList.add('selected');
    }

    console.log('SHIFT+Click: ' + (maxIndex - minIndex + 1) + ' dosya seçildi');
}

async function playMediaFromFolder(filePath, kind = 'audio') {
    if (!filePath || !window.aurivo) return;
    const dirPath = window.aurivo.path.dirname(filePath);
    const targetIsVideo = kind === 'video';

    state.mediaFilter = targetIsVideo ? 'video' : 'audio';
    await loadDirectory(dirPath, false);

    if (targetIsVideo) {
        const videoItems = state.videoFiles || [];
        const picked = videoItems.find(v => v.path === filePath) || { path: filePath, name: window.aurivo.path.basename(filePath) };
        if (!videoItems.length) {
            state.videoFiles = [picked];
        }
        playVideo(picked.path);
        return;
    }

    // Müzik: klasördeki tüm ses dosyalarını listeye ekle, çift tıklananı başlat.
    let playIndexTarget = -1;
    const currentDirItems = await window.aurivo.readDirectory(dirPath);
    const audioItems = currentDirItems
        .filter(i => i.isFile && isAudioFile(i.name))
        .sort((a, b) => a.name.localeCompare(b.name, 'tr'));

    let playlistChanged = false;
    for (const item of audioItems) {
        const { index, added } = addToPlaylist(item.path, item.name, {
            deferRender: true,
            deferSave: true,
            deferStats: true,
            deferLibraryRootSync: true
        });
        if (added) playlistChanged = true;
        if (item.path === filePath) playIndexTarget = index;
    }

    if (playlistChanged) {
        renderPlaylist();
        savePlaylistToDisk().catch(() => {});
        refreshLibraryStats().catch(() => {});
        syncAudioLibraryRootViewIfNeeded();
    }

    if (playIndexTarget >= 0) {
        playIndex(playIndexTarget);
    } else {
        const fileName = window.aurivo.path.basename(filePath);
        const { index } = addToPlaylist(filePath, fileName);
        if (index >= 0) playIndex(index);
    }
}

function setActiveSidebarByPage(pageName) {
    const btn = document.querySelector(`.sidebar-btn[data-page="${pageName}"]`);
    if (!btn) return;
    elements.sidebarBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
}

async function handleTreeItemDoubleClick(path, isDirectory, name = null) {
    if (isDirectory) {
        await loadDirectory(path);
    } else {
        const fileName = name || path.split('/').pop();

        // Video mu, müzik mi kontrol et
        if (isVideoFile(fileName)) {
            setActiveSidebarByPage('video');
            state.currentPage = 'video';
            state.currentPanel = 'library';
            switchPage('video');
            await playMediaFromFolder(path, 'video');
        } else {
            setActiveSidebarByPage('music');
            state.currentPage = 'music';
            state.currentPanel = 'library';
            switchPage('music');
            await playMediaFromFolder(path, 'audio');
        }
    }
}

async function loadDirectory(dirPath, pushHistory = true, renderToken = beginFileTreeRender()) {
    if (!window.aurivo) {
        console.error('Aurivo API bulunamadı');
        return;
    }

    try {
        console.log('Klasör yükleniyor:', dirPath, 'pushHistory:', pushHistory);
        console.log('Önceki currentPath:', state.currentPath, 'History:', state.pathHistory.length);

        if (pushHistory && state.currentPath !== dirPath) {
            state.pathHistory.push(state.currentPath || LIBRARY_ROOT_MARKER);
            state.pathForward = [];
            console.log('History\'ye eklendi:', state.currentPath, 'Yeni history uzunluğu:', state.pathHistory.length);
        }
        state.currentPath = dirPath;
        console.log('Yeni currentPath:', state.currentPath);

        // Sekme bazlı konum hafızasını güncelle
        if (state.mediaFilter === 'audio') {
            state.lastAudioPath = dirPath;
        } else if (state.mediaFilter === 'video') {
            state.lastVideoPath = dirPath;
        }
        persistLibraryStartupState();

        const items = await window.aurivo.readDirectory(dirPath);
        if (!isActiveFileTreeRender(renderToken)) return;
        console.log('Okunan öğeler:', items.length);

        if (!resetFileTreeSurface(renderToken)) return;

        const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
        const directories = items
            .filter((i) => i.isDirectory && !i.name.startsWith('.'))
            .sort((a, b) => collator.compare(a.name, b.name));

        // Dosyaları filtrele - mediaFilter'a göre
        let files = items.filter(i => i.isFile);

        // mediaFilter'a göre filtreleme
        if (state.mediaFilter === 'audio') {
            // Sadece ses dosyalarını göster
            files = files.filter(i => {
                const ext = i.name.split('.').pop().toLowerCase();
                return getConfiguredLibraryExtensions('audio').includes(ext);
            });
        } else if (state.mediaFilter === 'video') {
            // Sadece video dosyalarını göster
            files = files.filter(i => {
                const ext = i.name.split('.').pop().toLowerCase();
                return getConfiguredLibraryExtensions('video').includes(ext);
            });
        } else if (state.mediaFilter === 'web') {
            // Web sekmesinde dosya ağacı gösterilmez
            files = [];
        }

        files = files
            .filter((i) => !i.name.startsWith('.'))
            .sort((a, b) => collator.compare(a.name, b.name));

        // Video sekmesinde klasördeki tüm videoları kaydet (sıralı çalma için)
        if (state.mediaFilter === 'video') {
            state.videoFiles = files.map(f => ({
                name: f.name,
                path: f.path
            }));
            console.log('Video dosyaları kaydedildi:', state.videoFiles.length);
            persistVideoLibrary();
            renderVideoLibraryTree(renderToken);
            updateLibraryAddButtonUi();
            return;
        }

        // Ses sekmesinde klasörleri de göster; böylece ana müzik klasörü altındaki
        // sanatçı/yıl/dil klasörleri doğrudan gezilebilir.
        if (state.mediaFilter === 'audio') {
            directories.forEach((item) => {
                const treeItem = createTreeItem(item.name, item.path, true, '📁');
                elements.fileTree.appendChild(treeItem);
            });
        }

        // Dosyaları ekle
        files.forEach(item => {
            const treeItem = createTreeItem(item.name, item.path, false);
            elements.fileTree.appendChild(treeItem);
        });

        console.log('Yüklendi:', directories.length, 'klasör ve', files.length, 'dosya');
        updateLibraryAddButtonUi();

    } catch (error) {
        console.error('Klasör yükleme hatası:', error);
    }
}

function isMediaFile(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    return getConfiguredLibraryExtensions('audio').includes(ext) || getConfiguredLibraryExtensions('video').includes(ext);
}

function isVideoFile(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    return getConfiguredLibraryExtensions('video').includes(ext);
}

function isAudioFile(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    return getConfiguredLibraryExtensions('audio').includes(ext);
}

// ============================================
// PLAYLIST
// ============================================
async function loadPlaylist() {
    if (window.aurivo) {
        state.playlist = await window.aurivo.loadPlaylist();
        state.playlist = (state.playlist || []).map((item) => {
            const activity = getTrackActivityForPath(item?.path) || updateTrackActivity(item?.path, {
                favorite: !!item?.favorite,
                addedAt: item?.addedAt || Date.now(),
                playCount: item?.playCount || 0,
                lastPlayedAt: item?.lastPlayedAt || 0
            }) || {};
            return {
                ...item,
                favorite: !!activity.favorite,
                addedAt: Number(activity.addedAt || item?.addedAt || Date.now()),
                playCount: Number(activity.playCount || item?.playCount || 0),
                lastPlayedAt: Number(activity.lastPlayedAt || item?.lastPlayedAt || 0)
            };
        });
        invalidateAudioLibraryIndex();
        renderPlaylist();
    }
}

async function savePlaylistToDisk() {
    if (window.aurivo) {
        await window.aurivo.savePlaylist(state.playlist);
    }
}

function renderPlaylist() {
    if (!elements.playlist) {
        return;
    }
    const hasNowPlayingFocus = state.activeMedia === 'audio' && state.isPlaying && state.currentIndex >= 0;
    const largePlaylistMode = state.playlist.length > 300;
    elements.playlist.classList.toggle('has-playing-focus', hasNowPlayingFocus);
    const viewPrefs = getLibraryViewPreferenceState();
    elements.playlist.classList.toggle('playlist-large-mode', largePlaylistMode);
    elements.playlist.classList.toggle('playlist-view-cards', viewPrefs.mode === 'cards' && !largePlaylistMode);
    elements.playlist.classList.toggle('playlist-view-compact', viewPrefs.mode === 'compact' && !largePlaylistMode);
    elements.playlist.classList.toggle('playlist-view-comfortable', viewPrefs.mode === 'comfortable' && !largePlaylistMode);
    elements.playlist.classList.toggle('playlist-view-list', viewPrefs.mode !== 'cards' || largePlaylistMode);
    elements.playlist.innerHTML = '';

    if (state.playlist.length === 0) {
        elements.playlist.innerHTML = `
            <div class="playlist-empty">
                <div class="empty-icon">🎵</div>
                <div class="empty-text">Müzik veya video dosyalarını buraya sürükleyin</div>
                <div class="empty-hint">veya sol taraftaki klasörlerden seçin</div>
            </div>
        `;
        return;
    }

    const fragment = document.createDocumentFragment();
    getPlaylistPresentationEntries().forEach((entry) => {
        if (entry.type === 'header') {
            const header = document.createElement('div');
            header.className = 'playlist-group-header';
            header.textContent = entry.label;
            fragment.appendChild(header);
            return;
        }

        const { item, originalIndex: index, artist, album } = entry;
        const div = document.createElement('div');
        div.className = 'playlist-item';
        const isCurrent = index === state.currentIndex;
        const isAudioCurrent = isCurrent && state.activeMedia === 'audio';
        const isTrackPlaying = isAudioCurrent && state.isPlaying;

        if (isCurrent) {
            div.classList.add('playing');
        }
        if (isAudioCurrent && !isTrackPlaying) {
            div.classList.add('is-paused');
        }
        div.dataset.index = index;

        const icon = isVideoFile(item.name) ? '🎬' : '🎵';
        const statusGlyph = isAudioCurrent ? (isTrackPlaying ? '❚❚' : '▶') : String(index + 1);
        const statusClass = isAudioCurrent ? 'item-index playback-state' : 'item-index';
        const showMissingCover = !largePlaylistMode && getCoverPreferenceState().markMissing && item.hasCover === false;
        const metaParts = [artist, album].filter(Boolean);
        const flowBadges = (getLibraryPerformanceState().lightweightMode || largePlaylistMode) ? [] : getTrackFlowBadges(item.path);
        div.innerHTML = `
            <span class="${statusClass}" aria-label="${isTrackPlaying ? 'playing' : 'paused'}">${statusGlyph}</span>
            <span class="item-icon">${icon}</span>
            <span class="item-text">
                <span class="item-name">${item.name}</span>
                ${metaParts.length ? `<span class="item-meta">${escapeHtml(metaParts.join(' • '))}</span>` : ''}
                ${flowBadges.length ? `<span class="item-flow-badges">${flowBadges.map((badge) => `<span class="playlist-flow-badge">${escapeHtml(badge)}</span>`).join('')}</span>` : ''}
            </span>
            ${(!getLibraryPerformanceState().lightweightMode && showMissingCover) ? `<span class="playlist-cover-badge">${escapeHtml(uiT('settings.library.cover.missingBadge', 'Kapak yok'))}</span>` : ''}
            <button class="item-remove" data-index="${index}">✕</button>
        `;

        div.addEventListener('click', () => selectPlaylistItem(index));
        div.addEventListener('dblclick', () => {
            console.log('[PLAYLIST] Double-click on item', index, ':', item.name);
            playIndex(index);
        });
        div.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            showPlaylistContextMenu(e.clientX, e.clientY, index);
        });

        // Kaldır butonu
        const removeBtn = div.querySelector('.item-remove');
        removeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            removeFromPlaylist(index);
        });

        fragment.appendChild(div);
    });

    elements.playlist.appendChild(fragment);
}

function selectPlaylistItem(index) {
    document.querySelectorAll('.playlist-item').forEach(i => i.classList.remove('selected'));
    const item = elements.playlist.querySelector(`.playlist-item[data-index="${index}"]`);
    if (item) item.classList.add('selected');
}

function addToPlaylist(filePath, fileName = null, options = {}) {
    const name = fileName || filePath.split('/').pop();
    const cached = getCachedMetadataForPath(filePath);
    const activity = getTrackActivityForPath(filePath) || updateTrackActivity(filePath, {
        favorite: false,
        addedAt: Date.now(),
        playCount: 0,
        lastPlayedAt: 0
    }) || {};

    // Video dosyalarını playlist'e ekleme - sadece ses dosyaları!
    if (isVideoFile(name)) {
        console.log('[PLAYLIST] Video dosyası reddedildi:', name);
        return { index: -1, added: false };
    }

    // Zaten listede var mı kontrol et
    const existingIndex = state.playlist.findIndex(item => item.path === filePath);
    if (existingIndex !== -1) {
        return { index: existingIndex, added: false };
    }

    state.playlist.push({
        path: filePath,
        name: name,
        title: cached?.title || '',
        artist: cached?.artist || '',
        album: cached?.album || '',
        hasCover: typeof cached?.hasCover === 'boolean' ? cached.hasCover : undefined,
        favorite: !!activity.favorite,
        addedAt: Number(activity.addedAt || Date.now()),
        playCount: Number(activity.playCount || 0),
        lastPlayedAt: Number(activity.lastPlayedAt || 0)
    });
    invalidateAudioLibraryIndex();
    if (!options.deferRender) {
        renderPlaylist();
    }
    if (!options.deferSave) {
        savePlaylistToDisk();
    }
    if (!options.deferStats) {
        refreshLibraryStats().catch(() => {});
    }
    if (!options.deferLibraryRootSync) {
        syncAudioLibraryRootViewIfNeeded();
    }
    return { index: state.playlist.length - 1, added: true };
}

function removeFromPlaylist(index) {
    state.playlist.splice(index, 1);

    // Çalan parça kaldırıldıysa
    if (index === state.currentIndex) {
        elements.audio.pause();
        state.currentIndex = -1;
        state.isPlaying = false;
        updatePlayPauseIcon(false);
    } else if (index < state.currentIndex) {
        state.currentIndex--;
    }

    invalidateAudioLibraryIndex();
    renderPlaylist();
    savePlaylistToDisk();
    refreshLibraryStats().catch(() => {});
    syncAudioLibraryRootViewIfNeeded();
}

function clearPlaylistAll() {
    // Only stop audio if it was coming from the playlist
    if (state.activeMedia === 'audio' && state.currentIndex !== -1) {
        try {
            stopAudio();
        } catch {
            // yoksay
        }
    }

    state.playlist = [];
    state.currentIndex = -1;
    invalidateAudioLibraryIndex();

    // Sol panel listesini de temizle (müzik/video fark etmez).
    state.currentPath = '';
    if (elements.fileTree) elements.fileTree.innerHTML = '';

    // Sekme değişiminde geri gelmemesi için kayıtlı klasörleri de temizle.
    saveFolders('audio', []);
    saveFolders('video', []);
    state.lastAudioPath = null;
    state.lastVideoPath = null;
    rememberSelectedTreePath('');
    persistLibraryStartupState();

    // Video listesini her durumda sıfırla (drag-drop ile eklenenler dahil).
    if (state.activeMedia === 'video') {
        try {
            stopVideo();
        } catch {
            // yoksay
        }
    }
    state.videoFiles = [];
    state.currentVideoIndex = -1;
    state.currentVideoPath = null;
    persistVideoLibrary();

    state.isPlaying = false;
    updatePlayPauseIcon(false);

    if (elements.nowPlayingLabel) {
        elements.nowPlayingLabel.textContent = uiT('nowPlaying.ready', 'Now Playing: Aurivo Player - Ready');
    }

    renderPlaylist();
    savePlaylistToDisk();
    refreshLibraryStats().catch(() => {});
    syncAudioLibraryRootViewIfNeeded();
    updateTrayState();
    updateMPRISMetadata();
}

async function handleFileDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    const dropped = [];

    // Önce Aurivo internal sürüklemesini kontrol et (file tree'den)
    const aurivoData = e.dataTransfer.getData('text/aurivo-files');
    if (aurivoData) {
        try {
            const files = JSON.parse(aurivoData);
            files.forEach(file => dropped.push({ path: file.path, name: file.name }));
        } catch (err) {
            console.error('Aurivo dosya verisi işlenemedi:', err);
        }
    } else {
        // Harici dosya sürüklemesi (dosya yöneticisinden)
        const files = e.dataTransfer.files;
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            dropped.push({ path: file.path, name: file.name });
        }
    }

    const firstMedia = dropped.find(f => isAudioFile(f.name) || isVideoFile(f.name));
    if (!firstMedia) return;

    // İmleçte "kopyala" yerine "taşı" davranışı gösterelim (gerçekte dosya kopyalanmaz).
    try {
        e.dataTransfer.dropEffect = 'move';
        e.dataTransfer.effectAllowed = 'move';
    } catch {
        // yoksay
    }

    if (isVideoFile(firstMedia.name)) {
        setActiveSidebarByPage('video');
        state.currentPage = 'video';
        state.currentPanel = 'library';
        switchPage('video');
        await playMediaFromFolder(firstMedia.path, 'video');
    } else {
        setActiveSidebarByPage('music');
        state.currentPage = 'music';
        state.currentPanel = 'library';
        switchPage('music');
        await playMediaFromFolder(firstMedia.path, 'audio');
    }

    // Seçimleri temizle
    document.querySelectorAll('.tree-item.file').forEach(i => i.classList.remove('selected'));
}

// Seçili dosyaları playlist'e ekle (ENTER tuşu için)
function addSelectedFilesToPlaylist() {
    const selectedItems = document.querySelectorAll('.tree-item.file.selected');
    let addedCount = 0;
    let firstPlayableIndex = null;

    selectedItems.forEach(item => {
        const path = item.dataset.path;
        const name = item.dataset.name;
        // Video dosyalarını playlist'e ekleme (sadece ses dosyaları)
        if (path && name && isAudioFile(name)) {
            const { index, added } = addToPlaylist(path, name);
            if (typeof index === 'number' && index >= 0) {
                if (firstPlayableIndex === null) firstPlayableIndex = index;
                if (added) addedCount++;
            }
        }
    });

    // İlk dosyayı çal (eğer hiçbir şey çalmıyorsa)
    if (state.currentIndex === -1 && typeof firstPlayableIndex === 'number' && firstPlayableIndex >= 0) {
        playIndex(firstPlayableIndex);
    }

    console.log(`ENTER: ${addedCount} dosya eklendi`);
}

// ============================================
// VIDEO PLAYBACK (Playlist'siz, direkt kütüphaneden)
// ============================================
function playVideo(videoPath) {
    console.log('[PLAY VIDEO] Video oynatılıyor:', videoPath);

    // Müziği tamamen durdur
    stopAudio();
    stopWeb();

    // Videolar listesinde bu videonun indeksini bul (tek dosya açma senaryosu için fallback)
    let videoIndex = state.videoFiles.findIndex(v => v.path === videoPath);
    if (videoIndex === -1) {
        const fileName = window.aurivo?.path?.basename?.(videoPath) || String(videoPath || '').split('/').pop() || 'video';
        state.videoFiles = [{ name: fileName, path: videoPath }];
        videoIndex = 0;
        persistVideoLibrary();
    }

    state.currentVideoIndex = videoIndex;
    state.currentVideoPath = videoPath;
    state.activeMedia = 'video';

    // Video sayfasına geç
    switchPage('video');

    // Video player'ı ayarla ve oynat
    elements.videoPlayer.src = toLocalFileUrl(videoPath);

    // Video ses seviyesini ayarla (kaydedilen seviye)
    elements.videoPlayer.volume = state.volume / 100;
    applyFsAudioDelay();
    applyFsVolumeBoost(!!state.settings?.videoFullscreen?.volumeBoost);

    // Tam ekran ses kontrollerini başlat
    const fsVolumeSlider = document.getElementById('fsVolumeSlider');
    const fsVolumeLabel = document.getElementById('fsVolumeLabel');
    if (fsVolumeSlider) {
        fsVolumeSlider.value = state.volume;
    }
    if (fsVolumeLabel) {
        fsVolumeLabel.textContent = state.volume + '%';
    }

    elements.videoPlayer.play();

    // Video kapağı (thumbnail) göster
    extractVideoCover(videoPath);

    state.isPlaying = true;
    updatePlayPauseIcon(true);

    const fileName = videoPath.split('/').pop();
    elements.nowPlayingLabel.textContent = `${uiT('nowPlaying.prefix', 'Now Playing')}: ${fileName}`;
    renderVideoLibraryTree();

    // Tray ve MPRIS'i güncelle
    updateTrayState();
    updateMPRISMetadata();

    console.log('[PLAY VIDEO] Video başlatıldı, index:', videoIndex, 'toplam:', state.videoFiles.length);
}

// Sıradaki videoyu oynat
function playNextVideo() {
    if (state.videoFiles.length === 0) {
        console.log('[NEXT VIDEO] Video listesi boş');
        return;
    }

    const nextIndex = state.currentVideoIndex + 1;

    if (nextIndex < state.videoFiles.length) {
        // Sıradaki video var
        console.log('[NEXT VIDEO] Sıradaki video oynatılıyor:', nextIndex);
        playVideo(state.videoFiles[nextIndex].path);
    } else {
        // Liste bitti
        console.log('[NEXT VIDEO] Video listesi bitti');
        state.isPlaying = false;
        updatePlayPauseIcon(false);
        updateTrayState();
    }
}

// Önceki videoyu oynat
function playPreviousVideo() {
    if (state.videoFiles.length === 0) {
        console.log('[PREV VIDEO] Video listesi boş');
        return;
    }

    const prevIndex = state.currentVideoIndex - 1;

    if (prevIndex >= 0) {
        // Önceki video var
        console.log('[PREV VIDEO] Önceki video oynatılıyor:', prevIndex);
        playVideo(state.videoFiles[prevIndex].path);
    } else {
        // Liste başı
        console.log('[PREV VIDEO] Liste başında');
    }
}

// ============================================
// PLAYBACK
// ============================================
function playFile(filePath) {
    const index = state.playlist.findIndex(item => item.path === filePath);
    if (index !== -1) {
        playIndex(index);
    }
}

async function playIndex(index) {
    console.log('[PLAYINDEX] çağrıldı, index:', index, 'playlist length:', state.playlist.length);

    if (index < 0 || index >= state.playlist.length) {
        console.log('[PLAYINDEX] Geçersiz index, iptal ediliyor');
        return;
    }

    const item = state.playlist[index];
    console.log('[PLAYINDEX] Çalınacak dosya:', item.path);
    console.log('[PLAYINDEX] Current index before:', state.currentIndex, '-> after:', index);
    const activity = updateTrackActivity(item.path, {
        favorite: !!(item.favorite || getTrackActivityForPath(item.path)?.favorite),
        addedAt: item.addedAt || getTrackActivityForPath(item.path)?.addedAt || Date.now(),
        playCount: Number(item.playCount || getTrackActivityForPath(item.path)?.playCount || 0) + 1,
        lastPlayedAt: Date.now()
    });
    state.playlist[index] = {
        ...item,
        favorite: !!activity?.favorite,
        addedAt: Number(activity?.addedAt || item.addedAt || Date.now()),
        playCount: Number(activity?.playCount || 0),
        lastPlayedAt: Number(activity?.lastPlayedAt || 0)
    };

    state.currentIndex = index;

    // NOT: Video artık playlist'e eklenmiyor, direkt playVideo() ile çalıştırılıyor
    // Bu fonksiyon sadece müzik için kullanılıyor

    // Önce TÜM medyaları kapat (önceki şarkı dahil)
    console.log('Audio: Önce tüm medyalar durduruluyor...');
    stopAudio();
    stopVideo();
    stopWeb();
    console.log('Audio: Medyalar durduruldu, yeni şarkı yükleniyor...');

    // Audio oynat
    state.activeMedia = 'audio';
    if (state.currentPage === 'video' || state.currentPage === 'web') {
        switchPage('music');
    }

    // C++ Audio Engine veya HTML5 Audio kullan
    if (useNativeAudio) {
        console.log('C++ BASS Engine ile oynatılıyor...');
        // C++ BASS Engine ile oynat
        const result = await window.aurivo.audio.loadFile(item.path);
        console.log('loadFile sonucu:', result);
        console.log('loadFile sonucu type:', typeof result, 'success check:', result === true, 'object success:', result && result.success);
        if (result && result.error) {
            console.log('🔥 BASS Audio Engine hatası:', result.error);
        }
        if (result === true || (result && result.success)) {
            window.aurivo.audio.setVolume((state.volume || 0) / 100);
            console.log('🎵 window.aurivo.audio.play() çağrılıyor...');
            window.aurivo.audio.play();
            console.log('🎵 play() çağrıldı, ses çıkması gerekiyor');
            startNativePositionUpdates();
        } else {
            console.error('C++ Audio Engine dosya yükleyemedi', result);
            showNotification('Native audio ile dosya yüklenemedi. Efektler için native audio gerekli.', 'error');
            return;
        }
    } else {
        console.log('HTML5 Audio ile oynatılıyor...');
        // HTML5 Audio ile oynat
        playWithHTML5Audio(item);
    }

    // Albüm kapağını çıkar
    console.log('playIndex: extractAlbumArt çağrılıyor, path:', item.path);
    extractAlbumArt(item.path);

    // Çapraz geçiş durumu'lerini sıfırla
    state.autoCrossfadeTriggered = false;
    state.trackAboutToEnd = false;
    state.trackAboutToEndTriggered = false;
    state.playbackEndWarnedTrackKey = '';
    state.playbackStatePersistSecond = -1;

    state.isPlaying = true;
    updatePlayPauseIcon(true);
    elements.nowPlayingLabel.textContent = `${uiT('nowPlaying.prefix', 'Now Playing')}: ${item.name}`;
    updateLibraryFlowsStatusUi();
    renderPlaylist();
    applyPlaybackVolumeLevelingToEngine().catch(() => {});
    rememberPlaybackStartupState({ persist: false });
    saveSettings().catch(() => {});
    savePlaylistToDisk().catch(() => {});

    // System tray'i güncelle
    updateTrayState();

    // MPRIS metadata güncelle (Linux ortam oynatıcısı)
    updateMPRISMetadata();
}

// HTML5 Audio ile oynat (fallback)
function playWithHTML5Audio(item) {
    const activePlayer = getActiveAudioPlayer();
    const encodedPath = toLocalFileUrl(item.path);
    activePlayer.src = encodedPath;
    const useWebAudioGainPath = !useNativeAudio && !!webAudioOutputGainNode;
    activePlayer.volume = useWebAudioGainPath ? 1 : (state.volume / 100);
    activePlayer.muted = useWebAudioGainPath ? false : state.isMuted;
    setWebAudioOutputGainFromState();
    activePlayer.play();
}

// Native engine ile "yumuşak/çapraz" geçiş (overlap yok: fade-out -> track switch -> fade-in)
async function startNativeTransitionToIndex(index, ms) {
    if (state.crossfadeInProgress) return;

    if (state.crossfadeInProgress) return;
    if (index < 0 || index >= state.playlist.length) return;
    if (!window.aurivo?.audio) {
        playIndex(index);
        return;
    }

    const fromIndex = state.currentIndex;
    const fromItem = fromIndex >= 0 ? state.playlist[fromIndex] : null;
    const toItem = state.playlist[index];

    state.crossfadeInProgress = true;
    state.autoCrossfadeTriggered = false;
    state.trackAboutToEnd = false;

    const totalMs = Math.max(0, Number(ms) || 0);
    const outMs = Math.max(80, Math.floor(totalMs * 0.5));
    const inMs = Math.max(80, totalMs - outMs);
    const targetVol = Math.max(0, Math.min(1, (state.volume || 0) / 100));

    // Native true overlap crossfade (iki parça üst üste)
    if (totalMs > 0 && typeof window.aurivo.audio.crossfadeTo === 'function') {
        state.crossfadeInProgress = true;
        state.autoCrossfadeTriggered = false;
        state.trackAboutToEnd = false;

        try {
            console.log('[CROSSFADE] Native overlap crossfade ->', toItem?.name, 'ms:', totalMs);

            // UI/medya state
            state.activeMedia = 'audio';
            if (state.currentPage === 'video' || state.currentPage === 'web') {
                switchPage('music');
            }

            // Crossfade'i başlat (native tarafında: prev fade-out, new fade-in)
            const result = await window.aurivo.audio.crossfadeTo(toItem.path, totalMs);
            const ok = (result === true) || (result && result.success);
            if (!ok) {
                console.warn('[CROSSFADE] Native overlap crossfade failed, fallback to non-overlap', result);
                throw new Error('native overlap crossfade failed');
            }

            // UI update: yeni parça ana parça gibi görünsün
            state.currentIndex = index;
            state.isPlaying = true;
            state.playbackEndWarnedTrackKey = '';
            state.playbackStatePersistSecond = -1;
            updatePlayPauseIcon(true);
            elements.nowPlayingLabel.textContent = `${uiT('nowPlaying.prefix', 'Now Playing')}: ${toItem.name}`;
            renderPlaylist();
            extractAlbumArt(toItem.path);
            rememberPlaybackStartupState({ persist: false });

            if (state._nativeOverlapCrossfadeTimer) {
                clearTimeout(state._nativeOverlapCrossfadeTimer);
            }
            state._nativeOverlapCrossfadeTimer = setTimeout(() => {
                state.crossfadeInProgress = false;
            }, totalMs + 120);

            console.log('[CROSSFADE] Native overlap crossfade started');
            return;
        } catch (e) {
            console.error('[CROSSFADE] Native overlap crossfade error:', e);
            // fallback aşağıdaki non-overlap path'e devam etsin
            state.crossfadeInProgress = false;
        }
    }

    const recoverOldTrack = async () => {
        try {
            if (!fromItem?.path) {
                await window.aurivo.audio.setVolume?.(targetVol);
                await window.aurivo.audio.play?.();
                startNativePositionUpdates();
                state.isPlaying = true;
                updatePlayPauseIcon(true);
                return;
            }
            const res = await window.aurivo.audio.loadFile(fromItem.path);
            if (res === true || (res && res.success)) {
                await window.aurivo.audio.setVolume?.(0);
                await window.aurivo.audio.play?.();
                startNativePositionUpdates();
                state.isPlaying = true;
                updatePlayPauseIcon(true);
                if (typeof window.aurivo.audio.fadeVolumeTo === 'function' && totalMs > 0) {
                    await window.aurivo.audio.fadeVolumeTo(targetVol, Math.min(inMs, 300));
                } else {
                    await window.aurivo.audio.setVolume?.(targetVol);
                }
            }
        } catch (e) {
            console.error('[CROSSFADE] recoverOldTrack error:', e);
        }
    };

    try {
        console.log('[CROSSFADE] Native transition ->', toItem?.name, 'ms:', totalMs);

        // Fade out
        if (totalMs > 0 && typeof window.aurivo.audio.fadeVolumeTo === 'function') {
            await window.aurivo.audio.fadeVolumeTo(0, outMs);
        } else {
            await window.aurivo.audio.setVolume?.(0);
        }

        stopNativePositionUpdates();

        // Stop + kısa bekle (bazı sürücülerde/codec'lerde hemen load sorun çıkarabiliyor)
        try { await window.aurivo.audio.stop?.(); } catch (e) { console.warn('[CROSSFADE] native stop warn:', e); }
        await new Promise(r => setTimeout(r, 60));

        // Sayfayı/medyayı ayarla
        state.activeMedia = 'audio';
        if (state.currentPage === 'video' || state.currentPage === 'web') {
            switchPage('music');
        }

        // Yeni dosyayı yükle
        const result = await window.aurivo.audio.loadFile(toItem.path);
        console.log('[CROSSFADE] native loadFile result:', result);
        if (!(result === true || (result && result.success))) {
            console.error('[CROSSFADE] Native transition: loadFile failed', result);
            await recoverOldTrack();
            return;
        }

        // Başlat
        state.currentIndex = index;
        state.playbackEndWarnedTrackKey = '';
        state.playbackStatePersistSecond = -1;
        await window.aurivo.audio.setVolume?.(0);
        await window.aurivo.audio.play?.();
        // Bazı durumlarda play çağrısı ilk seferde başlamayabiliyor -> kısa kontrol + retry
        try {
            await new Promise(r => setTimeout(r, 80));
            if (typeof window.aurivo.audio.isPlaying === 'function') {
                const playing = await window.aurivo.audio.isPlaying();
                if (!playing) {
                    console.warn('[CROSSFADE] play did not start, retrying...');
                    await window.aurivo.audio.play?.();
                }
            }
        } catch (e) {
            console.warn('[CROSSFADE] isPlaying check warn:', e);
        }
        startNativePositionUpdates();

        // UI update
        state.isPlaying = true;
        updatePlayPauseIcon(true);
        elements.nowPlayingLabel.textContent = `${uiT('nowPlaying.prefix', 'Now Playing')}: ${toItem.name}`;
        renderPlaylist();
        extractAlbumArt(toItem.path);
        rememberPlaybackStartupState({ persist: false });

        // Fade in
        if (totalMs > 0 && typeof window.aurivo.audio.fadeVolumeTo === 'function') {
            await window.aurivo.audio.fadeVolumeTo(targetVol, inMs);
        } else {
            await window.aurivo.audio.setVolume?.(targetVol);
        }

        console.log('[CROSSFADE] Native transition completed');
    } catch (e) {
        console.error('[CROSSFADE] Native transition error:', e);
        await recoverOldTrack();
    } finally {
        state.crossfadeInProgress = false;
    }
}

// C++ Engine pozisyon güncelleme
function startNativePositionUpdates() {
    stopNativePositionUpdates();

    console.log('Position update başlatıldı');

    const myGen = ++state.nativePositionGeneration;

    state.nativePositionTimer = setInterval(async () => {
        if (myGen !== state.nativePositionGeneration) return;
        if (!useNativeAudio) {
            console.log('Native audio kullanılmıyor');
            return;
        }
        if (!state.isPlaying) {
            return;
        }

        try {
            // IPC çağrıları async
            const positionMs = await window.aurivo.audio.getPosition(); // milisaniye
            const durationSec = await window.aurivo.audio.getDuration(); // saniye
            const isPlaying = await window.aurivo.audio.isPlaying();

            // Bu tick sırasında stop/restart olduysa hiçbir şey yapma
            if (myGen !== state.nativePositionGeneration) return;

            const positionSec = positionMs / 1000;
            const positionSecInt = Math.floor(positionSec);
            if (positionSecInt >= 0 && positionSecInt % 8 === 0 && positionSecInt !== state.playbackStatePersistSecond) {
                state.playbackStatePersistSecond = positionSecInt;
                scheduleRememberPlaybackStartupState(260);
            }

            // UI güncelle
            if (elements.currentTime) {
                elements.currentTime.textContent = formatTime(positionSec);
            }
            if (elements.durationTime) {
                elements.durationTime.textContent = formatTime(durationSec);
            }

            if (durationSec > 0 && elements.seekSlider) {
                const progress = (positionSec / durationSec) * 1000;
                elements.seekSlider.value = progress;
                updateRainbowSlider(elements.seekSlider, progress / 10);
            }

            // MPRIS position'ı güncelle (her tam saniyede bir)
            const currentSecInt = Math.floor(positionSec);
            if (currentSecInt !== state.lastMPRISPosition && currentSecInt % 2 === 0) {
                state.lastMPRISPosition = currentSecInt;
                updateMPRISMetadata();
            }

            // Şarkı bitti mi kontrol et
            const durationMs = durationSec * 1000;

            // Çıkış cihazı değişimi gibi durumlarda native engine geçici olarak "not playing" dönebilir.
            // Parça sonuna gelinmemişse kısa bir otomatik resume denemesi yap.
            if (!isPlaying && durationMs > 0) {
                const inOutputSwitchGrace = (Date.now() - Number(audioOutputRuntime.lastOutputChangeAt || 0)) < 2800;
                const nearEnd = positionMs >= (durationMs - 220);
                if (!nearEnd || inOutputSwitchGrace) {
                    const now = Date.now();
                    const lastTry = Number(state.nativeAutoResumeLastTryAt || 0);
                    if (now - lastTry > 1400) {
                        state.nativeAutoResumeLastTryAt = now;
                        try {
                            await window.aurivo.audio.play?.();
                            await new Promise((r) => setTimeout(r, 70));
                            const stillStopped = !(await window.aurivo.audio.isPlaying?.());
                            if (stillStopped && inOutputSwitchGrace) {
                                await hardRecoverCurrentTrackAfterRouteChange(positionMs);
                            }
                        } catch {
                            // yoksay
                        }
                    }
                }
            }

            // Native crossfade için cache
            state.nativePositionMs = positionMs;
            state.nativeDurationSec = durationSec;

            // Native TrackAboutToEnd logic (Clementine-inspired)
            const crossfadeMs = state.settings?.playback?.crossfadeMs || 2000;
            const fudgeMs = 100; // timing tolerance
            const gap = crossfadeMs + (state.settings?.playback?.crossfadeAutoEnabled ? 0 : 1000);
            const remaining = durationMs - positionMs;
            const minimumPlayTimeMs = 3000; // 3 saniye minimum oynatma
            maybeNotifyTrackEnding(remaining, durationMs);

            // TrackAboutToEnd early warning
            if (durationMs > 0 && !state.trackAboutToEndTriggered && remaining > 0) {
                if (remaining < gap + fudgeMs && positionMs >= minimumPlayTimeMs) {
                    state.trackAboutToEndTriggered = true;
                    console.log('[NATIVE] Track about to end, remaining:', remaining + 'ms');
                }
            }

            // Auto crossfade trigger
            if (state.settings?.playback?.crossfadeAutoEnabled && !state.autoCrossfadeTriggered && !state.crossfadeInProgress) {
                if (state.trackAboutToEndTriggered && remaining > 0 && remaining <= crossfadeMs) {
                    const nextIdx = computeNextIndex();
                    if (nextIdx >= 0) {
                        if (shouldSkipAutoCrossfadeBetween(state.currentIndex, nextIdx)) {
                            return;
                        }
                        state.autoCrossfadeTriggered = true;
                        console.log('[NATIVE] Auto crossfade triggered, remaining:', remaining + 'ms');
                        startNativeTransitionToIndex(nextIdx, crossfadeMs).catch((e) => {
                            console.error('[CROSSFADE] Native auto transition error:', e);
                            playIndex(nextIdx);
                        });
                        return;
                    }
                }
            }

            // Bazı formatlarda (özellikle yüklemenin hemen ardından) duration geçici olarak 0 dönebiliyor.
            // Bu durumda "parça bitti" algısı yanlış tetiklenip anında next/crossfade zinciri başlatabiliyor.
            const inOutputSwitchGrace = (Date.now() - Number(audioOutputRuntime.lastOutputChangeAt || 0)) < 2800;
            if (durationMs > 0 && !isPlaying && positionMs >= durationMs - 100 && !inOutputSwitchGrace) {
                handleNativePlaybackEnd();
            }
        } catch (e) {
            console.error('Native position update error:', e);
        }
    }, 250);
}

function stopNativePositionUpdates() {
    if (state.nativePositionTimer) {
        clearInterval(state.nativePositionTimer);
        state.nativePositionTimer = null;
    }

    // Interval callback'leri async olduğu için, clearInterval sonrası da bir tick
    // çalışmaya devam edebilir. Generation artırarak bu tick'leri etkisizleştiriyoruz.
    state.nativePositionGeneration = (state.nativePositionGeneration || 0) + 1;
}

function handleNativePlaybackEnd() {
    stopNativePositionUpdates();
    console.log('[NATIVE] Playback ended');

    if (state.autoCrossfadeTriggered || state.crossfadeInProgress) return;

    if (state.isRepeat) {
        playIndex(state.currentIndex);
    } else {
        const nextIdx = computeNextIndex();
        console.log('[NATIVE] Next index:', nextIdx);

        if (nextIdx >= 0) {
            if (state.settings?.playback?.crossfadeAutoEnabled && !shouldSkipAutoCrossfadeBetween(state.currentIndex, nextIdx)) {
                startNativeTransitionToIndex(nextIdx, state.settings.playback.crossfadeMs || 2000).catch((e) => {
                    console.error('[CROSSFADE] Native end transition error:', e);
                    playIndex(nextIdx);
                });
            } else {
                playIndex(nextIdx);
            }
        } else {
            state.isPlaying = false;
            updatePlayPauseIcon(false);
            scheduleRememberPlaybackStartupState(220);
        }
    }
}

// Albüm kapağı çıkarma
async function extractAlbumArt(filePath) {
    console.log('=== ALBUM KAPAK CIKARMA BASLADI ===');
    console.log('Dosya yolu:', filePath);

    try {
        const perf = getLibraryPerformanceState();
        if (perf.lightweightMode) {
            updateCoverArt(null, 'audio');
            return;
        }
        const cachedCover = readCachedAlbumArt(filePath);
        if (cachedCover) {
            updateCoverArt(cachedCover, 'audio');
            return;
        }
        const coverPrefs = getCoverPreferenceState();
        if (window.aurivo && window.aurivo.getBestAlbumArt) {
            console.log('getBestAlbumArt API mevcut, çağırılıyor...');
            const coverData = await window.aurivo.getBestAlbumArt(filePath, coverPrefs);

            if (coverData) {
                writeCachedAlbumArt(filePath, coverData);
                console.log('KAPAK VERISI ALINDI!');
                console.log('Veri uzunluğu:', coverData.length);
                console.log('İlk 80 karakter:', coverData.substring(0, 80));
                updateCoverArt(coverData, 'audio');
                return;
            } else {
                console.log('Kapak verisi NULL döndü');
            }
        } else {
            console.log('HATA: getAlbumArt fonksiyonu yok!');
            console.log('window.aurivo:', window.aurivo);
        }
    } catch (e) {
        console.error('HATA oluştu:', e);
    }

    console.log('Varsayılan kapak kullanılacak');
    updateCoverArt(null, 'audio');
}

async function extractVideoCover(filePath) {
    try {
        if (window.aurivo?.getVideoThumbnail) {
            const thumb = await window.aurivo.getVideoThumbnail(filePath);
            if (thumb) {
                updateCoverArt(thumb, 'video');
                return;
            }
        }
    } catch {
        // yoksay
    }
    updateCoverArt(null, 'video');
}

// Kapak resmini güncelle
function updateCoverArt(imageData, mediaType) {
    const coverImg = elements.coverArt;
    if (!coverImg) {
        console.log('coverArt element bulunamadı');
        return;
    }

    console.log('Cover güncelleniyor:', mediaType, imageData ? 'data var' : 'varsayılan');

    if (imageData) {
        // Base64 resim verisi
        coverImg.src = imageData;
        coverImg.classList.remove('default-cover');
    } else {
        // Varsayılan ikonları göster (mevcut dosyaları kullan)
        if (mediaType === 'video') {
            coverImg.src = '../icons/nav_video.svg';
        } else if (mediaType === 'web') {
            coverImg.src = '../icons/nav_internet.svg';
        } else {
            coverImg.src = '../icons/aurivo_256.png';
        }
        coverImg.classList.add('default-cover');
    }

    state.currentCover = imageData;

    // MPRIS metadata'yı güncelle (albüm kapağı değiştiğinde)
    updateMPRISMetadata();
}

function togglePlayPause() {
    const activePlayer = getActiveAudioPlayer();

    if (state.isPlaying) {
        // Duraklatma
        if (state.activeMedia === 'audio') {
            if (useNativeAudio) {
                // C++ Engine ile duraklat (opsiyonel fade)
                try {
                    if (state.settings?.playback?.fadeOnPauseResume && window.aurivo?.audio?.fadeVolumeTo) {
                        const ms = state.settings.playback.pauseFadeMs || 250;
                        window.aurivo.audio.fadeVolumeTo(0, ms).finally(() => {
                            try {
                                window.aurivo.audio.pause();
                            } catch (e) {
                                console.error('[togglePlayPause] pause error:', e);
                            }
                            stopNativePositionUpdates();
                        }).catch(e => {
                            console.error('[togglePlayPause] fadeVolumeTo error:', e);
                            try { window.aurivo.audio.pause(); } catch { }
                        });
                    } else {
                        const result = window.aurivo.audio.pause();
                        if (result && result.error) {
                            console.error('[togglePlayPause] pause failed:', result.error);
                        }
                        stopNativePositionUpdates();
                    }
                } catch (e) {
                    console.error('[togglePlayPause] Native pause error:', e);
                    // Fallback to HTML5
                    activePlayer.pause();
                }
            } else {
                // Fade on pause özelliği aktif mi?
                if (state.settings?.playback?.fadeOnPauseResume) {
                    fadeOutAndPause(activePlayer, state.settings.playback.pauseFadeMs || 250);
                } else {
                    activePlayer.pause();
                }
            }
        } else if (state.activeMedia === 'video') {
            elements.videoPlayer.pause();
        }
        // FIX: Web Pause handling added
        else if (state.activeMedia === 'web' && elements.webView) {
            elements.webView.executeJavaScript(`
                    var m = document.querySelector('video, audio');
                    if(m) m.pause();
                `).catch(e => console.error('[web pause error]:', e));
        }
        state.isPlaying = false;
        updatePlayPauseIcon(false);
        updateTrayState();
        updateMPRISMetadata();
    } else {
        // Oynatma
        if (state.activeMedia === 'web' && elements.webView) {
            // Web Play
            elements.webView.executeJavaScript(`
                var m = document.querySelector('video, audio');
                if(m) m.play();
            `).catch(e => console.error('[web play error]:', e));
            state.isPlaying = true;
            updatePlayPauseIcon(true);
            updateTrayState();
            updateMPRISMetadata();
            scheduleRememberPlaybackStartupState(220);
        } else if (state.currentIndex >= 0 && state.activeMedia === 'audio') {
            // Mevcut şarkıyı devam ettir
            if (useNativeAudio) {
                try {
                    if (state.settings?.playback?.fadeOnPauseResume && window.aurivo?.audio?.fadeVolumeTo) {
                        const ms = state.settings.playback.pauseFadeMs || 250;
                        window.aurivo.audio.setVolume(0);
                        const playResult = window.aurivo.audio.play();
                        if (playResult && playResult.error) {
                            console.error('[togglePlayPause] play failed:', playResult.error);
                            // Seçili parça engine'e yüklenmemiş olabilir -> doğrudan parçayı yeniden başlat.
                            playIndex(state.currentIndex);
                            return;
                        } else {
                            startNativePositionUpdates();
                            window.aurivo.audio.fadeVolumeTo(Math.max(0, Math.min(1, (state.volume || 0) / 100)), ms).catch(e => console.error('[fadeVolume error]:', e));
                        }
                    } else {
                        const playResult = window.aurivo.audio.play();
                        if (playResult && playResult.error) {
                            console.error('[togglePlayPause] play failed:', playResult.error);
                            // Seçili parça engine'e yüklenmemiş olabilir -> doğrudan parçayı yeniden başlat.
                            playIndex(state.currentIndex);
                            return;
                        } else {
                            startNativePositionUpdates();
                        }
                    }
                } catch (e) {
                    console.error('[togglePlayPause] Native play error:', e);
                    // Native play sırasında hata olursa seçili parçayı yeniden yükleyip başlat.
                    playIndex(state.currentIndex);
                    return;
                }
            } else {
                if (state.settings?.playback?.fadeOnPauseResume) {
                    fadeInAndPlay(activePlayer, state.settings.playback.pauseFadeMs || 250);
                } else {
                    activePlayer.play();
                }
            }
            state.isPlaying = true;
            updatePlayPauseIcon(true);
            updateTrayState();
            updateMPRISMetadata();
            scheduleRememberPlaybackStartupState(220);
        } else if (state.activeMedia === 'audio' && state.currentIndex === -1 && state.playlist.length > 0) {
            // Hiç şarkı çalmıyorsa ilk şarkıyı başlat
            playIndex(0);
        } else if (state.activeMedia === 'video') {
            elements.videoPlayer.play();
            state.isPlaying = true;
            updatePlayPauseIcon(true);
            updateTrayState();
            updateMPRISMetadata();
        }
    }
}

// Fade out ve duraklatma
function fadeOutAndPause(player, duration) {
    const startVolume = player.volume;
    const startTime = performance.now();

    function animate() {
        const elapsed = performance.now() - startTime;
        const progress = Math.min(elapsed / duration, 1);

        player.volume = startVolume * (1 - progress);

        if (progress < 1) {
            requestAnimationFrame(animate);
        } else {
            player.pause();
            player.volume = startVolume; // Orijinal ses seviyesini geri yükle
        }
    }

    requestAnimationFrame(animate);
}

// Fade in ve oynatma
function fadeInAndPlay(player, duration) {
    const targetVolume = state.volume / 100;
    player.volume = 0;
    player.play();

    const startTime = performance.now();

    function animate() {
        const elapsed = performance.now() - startTime;
        const progress = Math.min(elapsed / duration, 1);

        player.volume = targetVolume * progress;

        if (progress < 1) {
            requestAnimationFrame(animate);
        }
    }

    requestAnimationFrame(animate);
}

function getPlaybackSettings() {
    if (!state.settings || typeof state.settings !== 'object') state.settings = {};
    if (!state.settings.playback || typeof state.settings.playback !== 'object') state.settings.playback = {};
    if (!state.settings.playback.startupState || typeof state.settings.playback.startupState !== 'object') {
        state.settings.playback.startupState = {};
    }
    return state.settings.playback;
}

function getPlaybackVolumeLevelingPreset(level) {
    const mode = String(level || 'balanced').toLowerCase();
    if (mode === 'gentle') return { target: -17, maxGain: 4, attack: 120, release: 600, meterMode: 1 };
    if (mode === 'strong') return { target: -13, maxGain: 8, attack: 55, release: 420, meterMode: 1 };
    return { target: -15, maxGain: 6, attack: 80, release: 500, meterMode: 1 };
}

async function applyPlaybackVolumeLevelingToEngine() {
    const playback = getPlaybackSettings();
    if (!playback.smartVolumeLevelingEnabled) {
        // Playback-leveling kapalıysa, ana Ses Çıkışı loudness ayarını geri uygula.
        return applyLoudnessNormalizationToEngine();
    }
    const autoGainApi = window.aurivo?.audio?.autoGain;
    if (!autoGainApi) return false;

    try {
        const preset = getPlaybackVolumeLevelingPreset(playback.smartVolumeLevelingMode);
        await autoGainApi.setEnabled(true);
        await autoGainApi.setTarget(preset.target);
        await autoGainApi.setMaxGain(preset.maxGain);
        await autoGainApi.setAttack(preset.attack);
        await autoGainApi.setRelease(preset.release);
        await autoGainApi.setMode(preset.meterMode);
        return true;
    } catch (error) {
        console.warn('[PLAYBACK] smart volume leveling apply failed:', error);
        return false;
    }
}

function getCurrentPlaybackPositionMs() {
    if (state.activeMedia !== 'audio' || state.currentIndex < 0 || state.currentIndex >= state.playlist.length) {
        return 0;
    }
    if (useNativeAudio) {
        return Math.max(0, Math.round(Number(state.nativePositionMs) || 0));
    }
    const activePlayer = getActiveAudioPlayer();
    return Math.max(0, Math.round((Number(activePlayer?.currentTime) || 0) * 1000));
}

function rememberPlaybackStartupState({ persist = true } = {}) {
    const playback = getPlaybackSettings();
    const startup = playback.startupState;
    const currentItem = (state.activeMedia === 'audio' && state.currentIndex >= 0 && state.currentIndex < state.playlist.length)
        ? state.playlist[state.currentIndex]
        : null;

    startup.lastTrackPath = currentItem?.path ? String(currentItem.path) : '';
    startup.lastTrackIndex = currentItem ? Number(state.currentIndex) : -1;
    startup.lastPositionMs = currentItem ? getCurrentPlaybackPositionMs() : 0;
    startup.lastWasPlaying = !!(currentItem && state.isPlaying);
    startup.updatedAt = Date.now();

    if (persist) saveSettings().catch(() => {});
}

function scheduleRememberPlaybackStartupState(delayMs = 320) {
    if (playbackStatePersistTimer) {
        clearTimeout(playbackStatePersistTimer);
    }
    playbackStatePersistTimer = setTimeout(() => {
        playbackStatePersistTimer = null;
        rememberPlaybackStartupState({ persist: true });
    }, Math.max(120, Number(delayMs) || 320));
}

function getCurrentPlaybackWarningTrackKey() {
    const item = (state.activeMedia === 'audio' && state.currentIndex >= 0 && state.currentIndex < state.playlist.length)
        ? state.playlist[state.currentIndex]
        : null;
    if (!item?.path) return '';
    return `${item.path}::${state.currentIndex}`;
}

function maybeNotifyTrackEnding(remainingMs, durationMs) {
    const playback = getPlaybackSettings();
    if (!playback.endWarningEnabled || state.activeMedia !== 'audio') return;
    if (!state.isPlaying || state.currentIndex < 0) return;

    const warningSec = Math.max(3, Math.min(60, Number(playback.endWarningSeconds) || 10));
    const warningMs = warningSec * 1000;
    if (!Number.isFinite(remainingMs) || remainingMs <= 0 || remainingMs > warningMs) return;
    if (Number.isFinite(durationMs) && durationMs > 0 && durationMs < warningMs + 1400) return;

    const key = getCurrentPlaybackWarningTrackKey();
    if (!key || state.playbackEndWarnedTrackKey === key) return;

    state.playbackEndWarnedTrackKey = key;
    const currentItem = state.playlist[state.currentIndex];
    safeNotify(`Parça bitimine ${warningSec} sn kaldı: ${currentItem?.name || 'Parça'}`, 'info', 2400);
}

function getPlaybackSeekStepSeconds() {
    const raw = Number(state.settings?.playback?.seekStepSeconds);
    return Math.max(1, Math.min(60, Number.isFinite(raw) ? raw : 10));
}

function normalizeTrackCompareValue(value) {
    return String(value || '').trim().toLocaleLowerCase();
}

function getFirstExistingTrackField(item, keys) {
    if (!item || !Array.isArray(keys)) return '';
    for (const key of keys) {
        const value = item[key];
        if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return '';
}

function shouldSkipAutoCrossfadeBetween(fromIndex, toIndex) {
    const playback = state.settings?.playback;
    if (!playback?.crossfadeAutoEnabled) return false;
    if (!playback?.sameAlbumNoCrossfade) return false;
    if (fromIndex < 0 || toIndex < 0) return false;
    if (fromIndex >= state.playlist.length || toIndex >= state.playlist.length) return false;

    const fromItem = state.playlist[fromIndex];
    const toItem = state.playlist[toIndex];
    if (!fromItem || !toItem) return false;

    const cueFrom = normalizeTrackCompareValue(
        getFirstExistingTrackField(fromItem, ['cuePath', 'cueFilePath', 'cueFile', 'cueSheet', 'cue'])
    );
    const cueTo = normalizeTrackCompareValue(
        getFirstExistingTrackField(toItem, ['cuePath', 'cueFilePath', 'cueFile', 'cueSheet', 'cue'])
    );
    if (cueFrom && cueTo && cueFrom === cueTo) return true;

    const albumFrom = normalizeTrackCompareValue(fromItem.album);
    const albumTo = normalizeTrackCompareValue(toItem.album);
    if (!albumFrom || albumFrom !== albumTo) return false;

    const artistFrom = normalizeTrackCompareValue(fromItem.artist);
    const artistTo = normalizeTrackCompareValue(toItem.artist);
    if (!artistFrom || !artistTo) return true;
    return artistFrom === artistTo;
}

function updatePlayPauseIcon(isPlaying) {
    if (isPlaying) {
        elements.playIcon.classList.add('hidden');
        elements.pauseIcon.classList.remove('hidden');
    } else {
        elements.playIcon.classList.remove('hidden');
        elements.pauseIcon.classList.add('hidden');
    }

    // Playlist satırındaki ▶ / ❚❚ durum göstergesini anında güncelle
    if (state.activeMedia === 'audio' && state.currentIndex >= 0) {
        renderPlaylist();
    }
}

// ============================================
// CROSSFADE FUNCTIONS
// ============================================

// Crossfade yapılabilir mi kontrolü
function canCrossfadeNow() {
    if (state.crossfadeInProgress) return false;
    if (!state.settings?.playback) return false;
    if (state.settings.playback.crossfadeMs <= 0) return false;
    if (state.playlist.length <= 0) return false;
    if (state.currentIndex < 0 || state.currentIndex >= state.playlist.length) return false;

    // Native engine: HTML5 duration yok, yine de geçiş yapabiliriz
    if (useNativeAudio && state.activeMedia === 'audio') {
        return true;
    }

    const activePlayer = getActiveAudioPlayer();
    const duration = activePlayer.duration * 1000;

    // Parça çok kısa ise (opsiyonel) crossfade yapma
    if (state.settings.playback.crossfadeSkipShortTracks !== false) {
        const safetyPaddingMs = Math.max(0, Math.min(5000, Number(state.settings.playback.crossfadeSafetyPaddingMs) || 300));
        if (duration > 0 && duration < state.settings.playback.crossfadeMs + safetyPaddingMs) return false;
    }

    return true;
}

// Sonraki index'i hesapla
function computeNextIndex() {
    if (state.playlist.length <= 0) return -1;

    // Eğer geçerli bir şarkı çalmıyorsa (örn: durduruldu), ilk şarkıdan başla
    if (state.currentIndex < 0) return 0;

    if (state.isShuffle) {
        if (state.playlist.length <= 1) return state.currentIndex;
        let idx = Math.floor(Math.random() * state.playlist.length);
        if (idx === state.currentIndex) {
            idx = (idx + 1) % state.playlist.length;
        }
        return idx;
    }

    let nextIdx = state.currentIndex + 1;
    if (nextIdx >= state.playlist.length) {
        return state.isRepeat ? 0 : -1;
    }
    return nextIdx;
}

// Önceki index'i hesapla
function computePrevIndex() {
    if (state.playlist.length <= 0) return -1;

    if (state.isShuffle) {
        if (state.playlist.length <= 1) return state.currentIndex;
        let idx = Math.floor(Math.random() * state.playlist.length);
        if (idx === state.currentIndex) {
            idx = (idx + 1) % state.playlist.length;
        }
        return idx;
    }

    let prevIdx = state.currentIndex - 1;
    if (prevIdx < 0) {
        return state.isRepeat ? state.playlist.length - 1 : -1;
    }
    return prevIdx;
}

// Crossfade ile parça değiştir
function startCrossfadeToIndex(index, ms) {
    if (!canCrossfadeNow() || index < 0 || index >= state.playlist.length) {
        // Crossfade yapılamıyorsa normal geçiş
        playIndex(index);
        return;
    }

    // Native engine aktifse: fade-out -> track switch -> fade-in
    if (useNativeAudio && state.activeMedia === 'audio') {
        startNativeTransitionToIndex(index, ms || (state.settings?.playback?.crossfadeMs || 2000))
            .catch((e) => {
                console.error('[CROSSFADE] Native transition promise rejected:', e);
                playIndex(index);
            });
        return;
    }

    state.crossfadeInProgress = true;
    state.autoCrossfadeTriggered = false;
    state.trackAboutToEnd = false;

    const oldPlayer = getActiveAudioPlayer();
    const oldVolume = oldPlayer.volume;

    // Yeni player'a geç
    switchActivePlayer();
    const newPlayer = getActiveAudioPlayer();

    // Yeni parçayı hazırla
    const item = state.playlist[index];
    const encodedPath = toLocalFileUrl(item.path);

    newPlayer.src = encodedPath;
    newPlayer.volume = 0;
    newPlayer.play();

    // UI'yi güncelle
    state.currentIndex = index;
    state.isPlaying = true;
    state.playbackEndWarnedTrackKey = '';
    state.playbackStatePersistSecond = -1;
    elements.nowPlayingLabel.textContent = `${uiT('nowPlaying.prefix', 'Now Playing')}: ${item.name}`;
    renderPlaylist();
    extractAlbumArt(item.path);
    rememberPlaybackStartupState({ persist: false });

    // Crossfade animasyonu
    const startTime = performance.now();
    const targetVolume = state.volume / 100;

    function animateCrossfade() {
        const elapsed = performance.now() - startTime;
        const progress = Math.min(elapsed / ms, 1);

        // Eski player fade out
        oldPlayer.volume = oldVolume * (1 - progress);

        // Yeni player fade in
        newPlayer.volume = targetVolume * progress;

        if (progress < 1) {
            requestAnimationFrame(animateCrossfade);
        } else {
            // Crossfade bitti
            oldPlayer.pause();
            oldPlayer.src = '';
            oldPlayer.volume = 0;
            state.crossfadeInProgress = false;
            console.log('Crossfade tamamlandı');
        }
    }

    requestAnimationFrame(animateCrossfade);
    console.log('Crossfade başlatıldı:', item.name);
}

// Otomatik çapraz geçiş kontrolü (parça bitişi)
function maybeStartAutoCrossfade() {
    // Native audio kullanıyorken HTML5 audio crossfade'i devre dışı
    if (useNativeAudio) return;

    if (!state.settings?.playback?.crossfadeAutoEnabled) return;
    if (state.autoCrossfadeTriggered) return;
    if (!canCrossfadeNow()) return;

    const activePlayer = getActiveAudioPlayer();
    const positionMs = activePlayer.currentTime * 1000;
    const durationMs = activePlayer.duration * 1000;

    if (durationMs <= 0) return;

    const remaining = durationMs - positionMs;
    if (remaining <= 0) return;
    maybeNotifyTrackEnding(remaining, durationMs);

    const crossfadeMs = state.settings.playback.crossfadeMs || 2000;

    // Crossfade süresi kadar kala tetikle
    if (remaining > crossfadeMs) {
        state.trackAboutToEnd = false;
        return;
    }

    if (!state.trackAboutToEnd) {
        state.trackAboutToEnd = true;
    }

    const nextIdx = computeNextIndex();
    if (nextIdx < 0) return;
    if (shouldSkipAutoCrossfadeBetween(state.currentIndex, nextIdx)) return;

    state.autoCrossfadeTriggered = true;
    startCrossfadeToIndex(nextIdx, crossfadeMs);
}

// Manuel crossfade ile sonraki parça
function sendWebTransportCommand(command) {
    if (!elements.webView || typeof elements.webView.executeJavaScript !== 'function') return;
    const js = `
        (function () {
            try {
                var cmd = ${JSON.stringify(String(command || ''))};
                var host = String(location.hostname || '');
                function clickFirst(selectors) {
                    try {
                        for (var i = 0; i < selectors.length; i++) {
                            var el = document.querySelector(selectors[i]);
                            if (el && typeof el.click === 'function') { el.click(); return true; }
                        }
                    } catch (e) {}
                    return false;
                }
                function dispatchMediaKey(keyName) {
                    try {
                        var evtDown = new KeyboardEvent('keydown', { key: keyName, code: keyName, bubbles: true, cancelable: true });
                        var evtUp = new KeyboardEvent('keyup', { key: keyName, code: keyName, bubbles: true, cancelable: true });
                        document.dispatchEvent(evtDown);
                        document.dispatchEvent(evtUp);
                    } catch (e) {}
                }

                // YouTube / YT Music
                if (host.includes('youtube.com') || host.includes('music.youtube.com')) {
                    function dispatchYouTubeShortcut(key, withShift) {
                        try {
                            var evtDown = new KeyboardEvent('keydown', { key: key, code: 'Key' + String(key || '').toUpperCase(), shiftKey: !!withShift, bubbles: true, cancelable: true });
                            var evtUp = new KeyboardEvent('keyup', { key: key, code: 'Key' + String(key || '').toUpperCase(), shiftKey: !!withShift, bubbles: true, cancelable: true });
                            document.dispatchEvent(evtDown);
                            document.dispatchEvent(evtUp);
                        } catch (e) {}
                    }
                    if (cmd === 'next') {
                        if (!clickFirst([
                            '.ytp-next-button',
                            'button[aria-label=\"Next\"]',
                            'button[title=\"Next\"]',
                            'button[aria-label*=\"Sonraki\"]',
                            'button[title*=\"Sonraki\"]'
                        ])) {
                            // YouTube kısayolu: Shift+N (sonraki video)
                            dispatchYouTubeShortcut('N', true);
                        }
                        return;
                    }
                    if (cmd === 'previous') {
                        if (!clickFirst([
                            '.ytp-prev-button',
                            'button[aria-label=\"Previous\"]',
                            'button[title=\"Previous\"]',
                            'button[aria-label*=\"Önceki\"]',
                            'button[title*=\"Önceki\"]'
                        ])) {
                            // YouTube kısayolu: Shift+P (önceki video)
                            dispatchYouTubeShortcut('P', true);
                        }
                        return;
                    }
                }

                // Deezer
                if (host.includes('deezer.com')) {
                    if (cmd === 'next') {
                        clickFirst([
                            'footer button[data-testid*=\"next\" i]',
                            'button[data-testid*=\"next\" i]',
                            'footer button[aria-label*=\"Next\" i]',
                            'button[aria-label*=\"Next\" i]',
                            'footer button[title*=\"Next\" i]',
                            'button[title*=\"Next\" i]',
                            'footer button[aria-label*=\"Sonraki\" i]',
                            'button[aria-label*=\"Sonraki\" i]',
                            'footer button[title*=\"Sonraki\" i]',
                            'button[title*=\"Sonraki\" i]',
                            'footer button[class*=\"next\" i]',
                            'button[class*=\"next\" i]'
                        ]);
                        return;
                    }
                    if (cmd === 'previous') {
                        if (!clickFirst([
                            'footer button[data-testid*=\"prev\" i]',
                            'footer button[data-testid*=\"previous\" i]',
                            'button[data-testid*=\"prev\" i]',
                            'button[data-testid*=\"previous\" i]',
                            'footer button[aria-label*=\"Previous\" i]',
                            'button[aria-label*=\"Previous\" i]',
                            'footer button[title*=\"Previous\" i]',
                            'button[title*=\"Previous\" i]',
                            'footer button[aria-label*=\"Önceki\" i]',
                            'button[aria-label*=\"Önceki\" i]',
                            'footer button[title*=\"Önceki\" i]',
                            'button[title*=\"Önceki\" i]',
                            'footer button[class*=\"prev\" i]',
                            'button[class*=\"prev\" i]'
                        ])) {
                            try { window.history.back(); } catch (e) {}
                        }
                        return;
                    }
                }

                // SoundCloud (bonus)
                if (host.includes('soundcloud.com')) {
                    if (cmd === 'next') {
                        clickFirst(['.playControls__next', 'button[aria-label*=\"Next\" i]']);
                        return;
                    }
                    if (cmd === 'previous') {
                        clickFirst(['.playControls__prev', 'button[aria-label*=\"Previous\" i]']);
                        return;
                    }
                }

                // Fallback: media key
                if (cmd === 'next') dispatchMediaKey('MediaTrackNext');
                if (cmd === 'previous') dispatchMediaKey('MediaTrackPrevious');
            } catch (e) {}
        })();
    `;
    try { elements.webView.executeJavaScript(js); } catch { }
}

function playNextWithCrossfade() {
    if (state.activeMedia === 'web' && elements.webView) {
        sendWebTransportCommand('next');
        return;
    }
    if (state.playlist.length === 0) return;

    const nextIndex = computeNextIndex();
    if (nextIndex < 0) return;

    // Elle çapraz geçiş aktif mi?
    if (state.settings?.playback?.crossfadeManualEnabled && canCrossfadeNow()) {
        const crossfadeMs = state.settings.playback.crossfadeMs || 2000;
        startCrossfadeToIndex(nextIndex, crossfadeMs);
    } else {
        playIndex(nextIndex);
    }
}

// Manuel crossfade ile önceki parça
function playPreviousWithCrossfade() {
    if (state.activeMedia === 'web' && elements.webView) {
        sendWebTransportCommand('previous');
        return;
    }
    if (state.playlist.length === 0) return;

    const prevIndex = computePrevIndex();
    if (prevIndex < 0) return;

    // Elle çapraz geçiş aktif mi?
    if (state.settings?.playback?.crossfadeManualEnabled && canCrossfadeNow()) {
        const crossfadeMs = state.settings.playback.crossfadeMs || 2000;
        startCrossfadeToIndex(prevIndex, crossfadeMs);
    } else {
        playIndex(prevIndex);
    }
}

// Eski playNext fonksiyonu (dahili kullanım için)
function playNext() {
    // Video modunda sıradaki videoyu çal
    if (state.activeMedia === 'video') {
        playNextVideo();
        return;
    }

    // Müzik modunda sıradaki şarkıyı çal
    if (state.playlist.length === 0) return;

    let nextIndex;
    if (state.isShuffle) {
        nextIndex = Math.floor(Math.random() * state.playlist.length);
    } else {
        nextIndex = (state.currentIndex + 1) % state.playlist.length;
    }
    playIndex(nextIndex);
}

function playPrevious() {
    // Video modunda önceki videoyu çal
    if (state.activeMedia === 'video') {
        playPreviousVideo();
        return;
    }

    // Müzik modunda önceki şarkıyı çal
    if (state.playlist.length === 0) return;

    let prevIndex;
    if (state.isShuffle) {
        prevIndex = Math.floor(Math.random() * state.playlist.length);
    } else {
        prevIndex = state.currentIndex - 1;
        if (prevIndex < 0) prevIndex = state.playlist.length - 1;
    }
    playIndex(prevIndex);
}

function handleTrackEnded() {
    console.log('[PLAYBACK] Track ended. Current:', state.currentIndex, 'Total:', state.playlist.length);

    // Eğer otomatik crossfade zaten tetiklendiyse, bir şey yapma
    if (state.autoCrossfadeTriggered || state.crossfadeInProgress) {
        return;
    }

    // Stop after current aktifse, çalmayı durdur
    if (state.stopAfterCurrent) {
        state.stopAfterCurrent = false; // Tek seferlik
        state.isPlaying = false;
        updatePlayPauseIcon(false);
        updateTrayState();
        scheduleRememberPlaybackStartupState(220);
        return;
    }

    if (state.isRepeat) {
        playIndex(state.currentIndex);
    } else {
        // Otomatik crossfade aktifse ve sonraki parça varsa
        const nextIdx = computeNextIndex();
        console.log('[PLAYBACK] Next index:', nextIdx);
        if (nextIdx >= 0 && state.settings?.playback?.crossfadeAutoEnabled && !shouldSkipAutoCrossfadeBetween(state.currentIndex, nextIdx)) {
            startCrossfadeToIndex(nextIdx, state.settings.playback.crossfadeMs || 2000);
        } else if (nextIdx >= 0) {
            playIndex(nextIdx);
        } else {
            // Liste bitti
            console.log('[PLAYBACK] Playlist finished');
            state.isPlaying = false;
            updatePlayPauseIcon(false);
            updateTrayState();
            scheduleRememberPlaybackStartupState(220);
        }
    }
}

function seekBy(seconds) {
    if (state.activeMedia === 'video') {
        // Video için seek
        const video = elements.videoPlayer;
        video.currentTime = Math.max(0, Math.min(video.duration || 0, video.currentTime + seconds));
    } else if (state.activeMedia === 'web' && elements.webView) {
        const delta = Number(seconds) || 0;
        elements.webView.executeJavaScript(`
            (function() {
                const m = document.querySelector('video.html5-main-video, video, audio');
                if (!m) return false;
                const d = Number(m.duration) || 0;
                const next = Math.max(0, (Number(m.currentTime) || 0) + (${delta}));
                m.currentTime = d > 0 ? Math.min(d, next) : next;
                return true;
            })();
        `).catch(() => {
            // yoksay
        });
    } else if (useNativeAudio && state.activeMedia === 'audio') {
        // C++ Engine ile seek
        window.aurivo.audio.getPosition().then(pos => {
            window.aurivo.audio.seek(pos + seconds * 1000);
        });
    } else {
        // HTML5 Audio için seek
        const activePlayer = getActiveAudioPlayer();
        activePlayer.currentTime += seconds;
    }
    if (state.activeMedia === 'audio') {
        scheduleRememberPlaybackStartupState(220);
    }
}

async function handleSeek() {
    const value = elements.seekSlider.value;

    if (state.activeMedia === 'video') {
        // Video için seek
        const duration = elements.videoPlayer.duration || 0;
        elements.videoPlayer.currentTime = (value / 1000) * duration;
    } else if (state.activeMedia === 'web' && elements.webView) {
        const duration = Number(state.webDuration) || 0;
        if (duration > 0) {
            const newTime = (value / 1000) * duration;
            state.webPosition = newTime;
            elements.webView.executeJavaScript(`
                (function() {
                    const m = document.querySelector('video.html5-main-video, video, audio');
                    if (!m) return false;
                    m.currentTime = ${newTime};
                    return true;
                })();
            `).catch(() => {
                // yoksay
            });
        }
    } else if (useNativeAudio && state.activeMedia === 'audio') {
        // C++ Engine ile seek
        const duration = await window.aurivo.audio.getDuration();
        const newPos = (value / 1000) * duration;
        await window.aurivo.audio.seek(newPos);
    } else {
        // HTML5 Audio için seek
        const activePlayer = getActiveAudioPlayer();
        const duration = activePlayer.duration || 0;
        activePlayer.currentTime = (value / 1000) * duration;
    }
    if (state.activeMedia === 'audio') {
        scheduleRememberPlaybackStartupState(220);
    }
}

// Seek slider'a tek tıklamayla pozisyon ayarlama
async function handleSeekClick(e) {
    const rect = elements.seekSlider.getBoundingClientRect();
    const isRtl = document?.documentElement?.dir === 'rtl' || document?.body?.classList?.contains?.('rtl');
    const clickX = e.clientX - rect.left;
    let percent = clickX / rect.width;
    if (isRtl) {
        percent = (rect.right - e.clientX) / rect.width;
    }
    percent = Math.max(0, Math.min(1, percent));

    if (state.activeMedia === 'video') {
        // Video için seek
        const duration = elements.videoPlayer.duration || 0;
        if (duration > 0) {
            const newTime = percent * duration;
            elements.videoPlayer.currentTime = newTime;
            elements.seekSlider.value = percent * 1000;
            updateRainbowSlider(elements.seekSlider, percent * 100);
        }
    } else if (state.activeMedia === 'web' && elements.webView) {
        // Web için seek
        const duration = Number(state.webDuration) || 0;
        if (duration > 0) {
            const newTime = percent * duration;
            state.webPosition = newTime;
            elements.webView.executeJavaScript(`
                (function() {
                    const m = document.querySelector('video.html5-main-video, video, audio');
                    if (!m) return false;
                    m.currentTime = ${newTime};
                    return true;
                })();
            `).catch(() => {
                // yoksay
            });
            elements.seekSlider.value = percent * 1000;
            updateRainbowSlider(elements.seekSlider, percent * 100);
        }
    } else if (useNativeAudio && state.activeMedia === 'audio') {
        // C++ Engine ile seek - getDuration saniye dönüdürüyor, seek milisaniye bekliyor
        const durationSec = await window.aurivo.audio.getDuration();
        if (durationSec > 0) {
            const newPosMs = percent * durationSec * 1000; // Milisaniyeye çevir
            await window.aurivo.audio.seek(newPosMs);
            elements.seekSlider.value = percent * 1000;
            updateRainbowSlider(elements.seekSlider, percent * 100);
        }
    } else {
        // HTML5 Audio için seek
        const activePlayer = getActiveAudioPlayer();
        const duration = activePlayer.duration || 0;

        if (duration > 0) {
            const newTime = percent * duration;
            activePlayer.currentTime = newTime;
            elements.seekSlider.value = percent * 1000;
            updateRainbowSlider(elements.seekSlider, percent * 100);
        }
    }
    if (state.activeMedia === 'audio') {
        scheduleRememberPlaybackStartupState(220);
    }
}

function handleSeekWheel(e) {
    // Mouse wheel seek
    e.preventDefault();
    const deltaSeconds = e.deltaY < 0 ? getPlaybackSeekStepSeconds() : -getPlaybackSeekStepSeconds(); // wheel up = forward
    seekBy(deltaSeconds);
}

function updateTimeDisplay() {
    let current = 0;
    let duration = 0;

    if (state.activeMedia === 'video') {
        // Video için
        const video = elements.videoPlayer;
        current = video.currentTime || 0;
        duration = video.duration || 0;
    } else if (useNativeAudio && state.activeMedia === 'audio') {
        // Native audio için - startNativePositionUpdates kullanılır
        return;
    } else {
        // HTML5 Audio için
        const activePlayer = getActiveAudioPlayer();
        current = activePlayer.currentTime;
        duration = activePlayer.duration || 0;
    }

    elements.currentTime.textContent = formatTime(current);

    if (duration > 0) {
        const progress = (current / duration) * 1000;
        elements.seekSlider.value = progress;
        // Rainbow slider efektini güncelle
        updateRainbowSlider(elements.seekSlider, progress / 10);
        // Bitiş saatini güncelle
        elements.durationTime.textContent = formatTime(duration);
    }

    // MPRIS position'ı güncelle (her 2 saniyede bir)
    const currentSecInt = Math.floor(current);
    if (currentSecInt !== state.lastMPRISPosition && currentSecInt % 2 === 0) {
        state.lastMPRISPosition = currentSecInt;
        updateMPRISMetadata();
    }
}

function handleMetadataLoaded() {
    const activePlayer = getActiveAudioPlayer();
    const duration = activePlayer.duration;
    elements.durationTime.textContent = formatTime(duration);
}

function formatTime(seconds) {
    if (!seconds || isNaN(seconds)) return '00:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

// ============================================
// VOLUME
// ============================================
function handleVolumeChange() {
    const value = parseInt(elements.volumeSlider.value);
    setAppMasterVolume(value, { persist: true, syncSettingsSlider: true, syncMainSlider: true });
}

function toggleMute() {
    const fsVolumeSlider = document.getElementById('fsVolumeSlider');
    const fsVolumeLabel = document.getElementById('fsVolumeLabel');

    if (state.isMuted) {
        state.isMuted = false;
        elements.volumeSlider.value = state.savedVolume;
        setAppMasterVolume(state.savedVolume, { persist: false, syncSettingsSlider: true, syncMainSlider: true });
    } else {
        state.isMuted = true;
        state.savedVolume = state.volume;
        elements.volumeSlider.value = 0;
        setAppMasterVolume(0, { persist: false, syncSettingsSlider: true, syncMainSlider: true });
    }
    updateTrayState();
    saveSettings();
}

function updateVolumeIcon() {
    // İkon güncelleme (CSS ile yapılabilir)
}

// Ses slider tek tıkla ayarlama
function handleVolumeClick(e) {
    const rect = elements.volumeSlider.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const percent = Math.round((clickX / rect.width) * 100);
    const newValue = Math.max(0, Math.min(100, percent));

    elements.volumeSlider.value = newValue;
    handleVolumeChange();
}

// Ses slider tekerlek ile 5 kademeli ayarlama
function handleVolumeWheel(e) {
    e.preventDefault();
    const delta = e.deltaY < 0 ? 5 : -5; // Yukarı = artır, aşağı = azalt
    const newValue = Math.max(0, Math.min(100, parseInt(state.volume) + delta));

    elements.volumeSlider.value = newValue;
    handleVolumeChange();
}

function ensureNotificationContainer() {
    let container = document.getElementById('aurivoNotifyContainer');
    if (container) return container;
    container = document.createElement('div');
    container.id = 'aurivoNotifyContainer';
    container.className = 'aurivo-notify-container';
    container.setAttribute('aria-live', 'polite');
    document.body.appendChild(container);
    return container;
}

const NOTIFICATION_SOUND_URL = 'assets/sounds/notification.mp3';
let notificationSoundAudio = null;
let notificationSoundLastPlayAt = 0;

function playNotificationSound() {
    const now = Date.now();
    if (now - notificationSoundLastPlayAt < 180) return;
    notificationSoundLastPlayAt = now;

    if (!notificationSoundAudio) {
        try {
            notificationSoundAudio = new Audio(NOTIFICATION_SOUND_URL);
            notificationSoundAudio.preload = 'auto';
            notificationSoundAudio.volume = 0.72;
        } catch {
            return;
        }
    }

    try {
        notificationSoundAudio.currentTime = 0;
        const p = notificationSoundAudio.play();
        if (p && typeof p.catch === 'function') p.catch(() => { });
    } catch {
        // ignore playback errors
    }
}

function showNotification(message, type = 'info', timeoutMs = 3000) {
    const textValue = String(message || '').trim();
    if (!textValue) return;

    const container = ensureNotificationContainer();
    const item = document.createElement('div');
    item.className = `aurivo-notify aurivo-notify-${String(type || 'info').toLowerCase()}`;

    const bars = document.createElement('span');
    bars.className = 'aurivo-notify-bars';
    bars.innerHTML = '<i></i><i></i><i></i>';

    const text = document.createElement('span');
    text.className = 'aurivo-notify-text';
    text.textContent = textValue;

    const sweep = document.createElement('span');
    sweep.className = 'aurivo-notify-sweep';

    item.appendChild(bars);
    item.appendChild(text);
    item.appendChild(sweep);
    container.appendChild(item);

    playNotificationSound();
    requestAnimationFrame(() => item.classList.add('show'));

    const ttl = Math.max(900, Number(timeoutMs) || 3000);
    setTimeout(() => {
        item.classList.remove('show');
        item.classList.add('hide');
        setTimeout(() => item.remove(), 280);
    }, ttl);
}

function safeNotify(message, type = 'info', timeoutMs = 3000) {
    try {
        if (typeof showNotification === 'function') {
            showNotification(message, type, timeoutMs);
            return;
        }
    } catch { }
    console.log(`[${type}] ${message}`);
}

function isProbablyHttpUrl(value) {
    const s = String(value || '').trim();
    if (!s) return false;
    return /^https?:\/\//i.test(s);
}

function normalizeWebTitle(rawTitle) {
    const t = String(rawTitle || '').trim();
    if (!t) return '';
    return t
        .replace(/\s+-\s+YouTube\s*$/i, '')
        .replace(/\s+-\s+YouTube\s+Music\s*$/i, '')
        .trim();
}

function isGenericTitle(title) {
    const t = String(title || '').trim().toLowerCase();
    if (!t) return true;
    return (
        t === 'youtube' ||
        t === 'youtube music' ||
        t === 'aurivo player - hazır' ||
        t === 'aurivo player' ||
        t.startsWith('şu an çalınan:') && (t === 'şu an çalınan: aurivo player - hazır')
    );
}

async function getWebViewDocumentTitleSafe() {
    try {
        if (!elements.webView || typeof elements.webView.executeJavaScript !== 'function') return '';
        // Some pages may block; executeJavaScript still works within webview context.
        const title = await elements.webView.executeJavaScript('document.title', true);
        return normalizeWebTitle(title);
    } catch {
        return '';
    }
}

async function getClipboardTextSafe() {
    try {
        if (window.aurivo?.clipboard?.getText) {
            return String(await window.aurivo.clipboard.getText() || '');
        }
    } catch { }
    try {
        if (navigator.clipboard?.readText) {
            return String(await navigator.clipboard.readText() || '');
        }
    } catch { }
    return '';
}

async function fileExistsSafe(filePath) {
    try {
        if (!filePath || !window.aurivo?.fileExists) return false;
        return !!(await window.aurivo.fileExists(filePath));
    } catch {
        return false;
    }
}

// ============================================
// SHUFFLE & REPEAT
// ============================================
function toggleShuffle() {
    state.isShuffle = !state.isShuffle;
    elements.shuffleBtn.classList.toggle('active', state.isShuffle);
    saveSettings();
}

function toggleRepeat() {
    state.isRepeat = !state.isRepeat;
    elements.repeatBtn.classList.toggle('active', state.isRepeat);
    saveSettings();
}

// ============================================
// AYARLAR MODAL
// ============================================
function openSettings(defaultTab = 'playback') {
    if (!isStandaloneSettingsMode()) {
        window.aurivo?.openSettingsWindow?.(defaultTab).catch((e) => {
            console.error('[SETTINGS] settings window open error:', e);
        });
        return;
    }
    if (!elements.settingsPage) return;
    showUtilityPage(elements.settingsPage, elements.settingsBtn);
    loadSettingsToUI();
    activateSettingsTab(defaultTab);
    if (defaultTab === 'adblock') {
        refreshAdblockStats(true);
    }
}

window.safeNotify = safeNotify;
window.uiT = uiT;
window.openRestartModal = openRestartModal;
window.closeRestartModal = closeRestartModal;
window.showRestartHint = showRestartHint;
window.hideRestartHint = hideRestartHint;
window.hasPendingLanguageChange = hasPendingLanguageChange;

function closeSettings() {
    if (isStandaloneSettingsMode()) {
        requestStandaloneSettingsClose().catch((error) => {
            console.error('[SETTINGS] standalone close failed:', error);
        });
        return;
    }
    stopSettingsBackgroundWork();
    hideUtilityPage(elements.settingsPage, elements.settingsBtn);
}

function switchSettingsTab(tab) {
    window.AurivoSettingsShared?.switchSettingsTab?.({
        tab,
        elements,
        updateSecurityUI,
        updateAdblockModeUI,
        refreshAdblockStats
    });
    const tabName = String(tab?.dataset?.tab || '').trim().toLowerCase();
    if (tabName === 'audio') {
        refreshSystemAudioState();
        startAudioOutputMonitor();
        startAudioOutputLevelMeter();
    } else if (tabName === 'library') {
        if (state.libraryStats && typeof state.libraryStats === 'object') {
            applyLibraryStatsToUi();
        }
        scheduleLibraryStatsRefresh();
        stopAdblockStatsPolling();
    } else {
        stopAudioOutputMonitor();
        stopAudioOutputLevelMeter();
        if (tabName !== 'adblock') stopAdblockStatsPolling();
    }
    if (tabName === 'adblock') {
        startAdblockStatsPolling();
    }
}

function loadSettingsToUI() {
    window.AurivoSettingsShared?.loadSettingsToUI?.({
        state,
        elements,
        specialPaths: state.specialPaths,
        ensureAdblockSettings,
        normalizePulsePreferenceState,
        getPulseQuickModeConfig,
        updatePulseQuickModeUi,
        updateAdblockModeUI,
        updateAdblockBadge,
        blockedCount: adblockRuntime.lastBlocked,
        noSignalDefaultSec: PULSE_NO_SIGNAL_HINT_TOAST_DEFAULT_SEC,
        translate: uiT
    });
    updateSliderFxToggleStateUi();
    updateSfxLightsToggleStateUi();
    updateVisualModeUi();
    updateThemeFollowSystemUi();
    renderLibraryFolderSettings();
    updateLibraryMetadataStatusUi();
    if (elements.libraryPreferEmbeddedCover) elements.libraryPreferEmbeddedCover.checked = getCoverPreferenceState().preferEmbedded;
    if (elements.libraryScanFolderCover) elements.libraryScanFolderCover.checked = getCoverPreferenceState().allowFolderCover;
    if (elements.libraryMarkMissingCovers) elements.libraryMarkMissingCovers.checked = getCoverPreferenceState().markMissing;
    if (elements.libraryWatchFolders) elements.libraryWatchFolders.checked = ensureLibrarySettings().watchFolders !== false;
    if (elements.libraryFastScan) elements.libraryFastScan.checked = getLibraryPerformanceState().fastScan;
    if (elements.libraryLightweightMode) elements.libraryLightweightMode.checked = getLibraryPerformanceState().lightweightMode;
    if (elements.libraryCoverCacheLimitMb) elements.libraryCoverCacheLimitMb.value = String(getLibraryPerformanceState().coverCacheLimitMb);
    if (elements.libraryViewSort) elements.libraryViewSort.value = getLibraryViewPreferenceState().sortBy;
    if (elements.libraryViewGroup) elements.libraryViewGroup.value = getLibraryViewPreferenceState().groupBy;
    if (elements.libraryViewMode) elements.libraryViewMode.value = getLibraryViewPreferenceState().mode;
    if (elements.libraryAudioExtensions) elements.libraryAudioExtensions.value = getConfiguredLibraryExtensions('audio').join(', ');
    if (elements.libraryVideoExtensions) elements.libraryVideoExtensions.value = getConfiguredLibraryExtensions('video').join(', ');
    updateLibraryCleanupStatus();
    updateLibraryFlowsStatusUi();
    updateLibraryTransferStatus();
    updateLibraryPerformanceStatusUi();
    updateLibraryDiagnosticsUi();
    if (state.libraryStats && typeof state.libraryStats === 'object') {
        applyLibraryStatsToUi();
    } else {
        if (elements.libraryStatsTotalSongs) elements.libraryStatsTotalSongs.textContent = '...';
        if (elements.libraryStatsTotalArtists) elements.libraryStatsTotalArtists.textContent = '...';
        if (elements.libraryStatsTotalAlbums) elements.libraryStatsTotalAlbums.textContent = '...';
        if (elements.libraryStatsTotalDuration) elements.libraryStatsTotalDuration.textContent = '...';
        if (elements.libraryStatsMissingMetadata) elements.libraryStatsMissingMetadata.textContent = '...';
        if (elements.libraryStatsMissingCover) elements.libraryStatsMissingCover.textContent = '...';
    }
    if (shouldRefreshLibraryStatsUi()) {
        scheduleLibraryStatsRefresh();
    }
    const restoreLastTrackOnStartup = document.getElementById('restoreLastTrackOnStartup');
    const autoplayLastTrackOnStartup = document.getElementById('autoplayLastTrackOnStartup');
    const resumePositionOnStartup = document.getElementById('resumePositionOnStartup');
    if (autoplayLastTrackOnStartup) autoplayLastTrackOnStartup.disabled = !restoreLastTrackOnStartup?.checked;
    if (resumePositionOnStartup) resumePositionOnStartup.disabled = !restoreLastTrackOnStartup?.checked;
    const endWarningEnabled = document.getElementById('endWarningEnabled');
    const endWarningSeconds = document.getElementById('endWarningSeconds');
    if (endWarningSeconds) endWarningSeconds.disabled = !endWarningEnabled?.checked;
    const smartVolumeLevelingEnabled = document.getElementById('smartVolumeLevelingEnabled');
    const smartVolumeLevelingMode = document.getElementById('smartVolumeLevelingMode');
    if (smartVolumeLevelingMode) smartVolumeLevelingMode.disabled = !smartVolumeLevelingEnabled?.checked;
    applyAppearanceSettingsToRuntime();
    applySecuritySettingsToRuntime();
    updateRecognitionEngineUi();
}

async function applySettings() {
    settingsWindowRuntime.saving = true;
    let result;
    try {
        result = await window.AurivoSettingsShared?.applySettings?.({
            state,
            elements,
            ensureAdblockSettings,
            readAdblockSettingsFromUI,
            applyAdblockRuntimeConfig,
            updateAdblockBadge,
            blockedCount: adblockRuntime.lastBlocked,
            normalizeAdblockMode,
            saveSettings,
            normalizePulsePreferenceState,
            pulseDefaultSec: PULSE_NO_SIGNAL_HINT_TOAST_DEFAULT_SEC,
            pulseDefaultMode: PULSE_QUICK_MODE_DEFAULT,
            savePulsePreferences: (prefs) => window.aurivo?.pulse?.savePreferences?.(prefs),
            notifyPulseSaveError: (e) => {
                console.error('[PULSE] save preferences error:', e);
                safeNotify('Aurivo-Pulse tercihleri kaydedilemedi.', 'error', 2400);
            }
        });
    } finally {
        settingsWindowRuntime.saving = false;
    }
    if (!result) return;

    const { nextMode, prevMode } = result;
    if (!state.settings.appearance || typeof state.settings.appearance !== 'object') {
        state.settings.appearance = {};
    }
    // Save aninda toggle degeri kesin uygulanir.
    state.settings.appearance.sliderFxEnabled = getSliderFxToggleChecked();
    updateSliderFxToggleStateUi();
    updateThemeFollowSystemUi();
    state.volume = Math.max(0, Math.min(100, Number(state.settings?.volume) || 40));
    if (elements.volumeSlider) elements.volumeSlider.value = state.volume;
    if (elements.volumeLabel) elements.volumeLabel.textContent = `${state.volume}%`;
    if (elements.audio) elements.audio.volume = state.volume / 100;
    applySystemAudioStateToUi();
    const modeChanged = nextMode !== prevMode || adblockRuntime.pendingModeChange;
    if (modeChanged && state.settings.adblock?.autoRefreshOnModeChange && elements.webView) {
        try {
            elements.webView.reload();
        } catch {
            // yoksay
        }
    }
    adblockRuntime.pendingModeChange = false;
    trimAlbumArtCache();
    applyAppearanceSettingsToRuntime();
    // Kaydet sonrası tema secici kilit/acik durumu aninda UI'ye yansisin.
    updateThemeFollowSystemUi();
    applySecuritySettingsToRuntime();
    await applyPlaybackVolumeLevelingToEngine();
    updateLibraryPerformanceStatusUi();
    updateLibraryDiagnosticsUi();
    renderPlaylist();
    if (state.activeMedia === 'audio' && state.currentIndex >= 0) {
        const current = state.playlist[state.currentIndex];
        if (current?.path) {
            extractAlbumArt(current.path).catch(() => {});
        }
    }
    syncLibraryWatchState().catch(() => {});
    settingsWindowRuntime.dirty = false;
}

function markSettingsDirty() {
    if (!isStandaloneSettingsMode()) return;
    settingsWindowRuntime.dirty = true;
}

function bindStandaloneSettingsDirtyTracking() {
    if (!isStandaloneSettingsMode()) return;
    const root = document.body;
    if (!root || root.dataset.settingsDirtyTrackingBound === 'true') return;
    root.dataset.settingsDirtyTrackingBound = 'true';

    const markDirtyFromEvent = (event) => {
        const target = event?.target;
        if (!(target instanceof Element)) return;
        if (!target.closest('.settings-shell')) return;
        markSettingsDirty();
    };

    document.addEventListener('input', markDirtyFromEvent, true);
    document.addEventListener('change', markDirtyFromEvent, true);
}

async function saveStandaloneSettingsIfNeeded() {
    if (!isStandaloneSettingsMode()) return true;
    if (settingsWindowRuntime.saving) return true;
    if (!settingsWindowRuntime.dirty) return true;
    try {
        await applySettings();
        return true;
    } catch (error) {
        console.error('[SETTINGS] auto-save on close failed:', error);
        return false;
    }
}

async function requestStandaloneSettingsClose() {
    if (!isStandaloneSettingsMode()) return;
    if (settingsWindowRuntime.closing) return;
    settingsWindowRuntime.closing = true;
    try {
        const saved = await saveStandaloneSettingsIfNeeded();
        if (!saved) {
            safeNotify('Ayarlar kaydedilemedi. Pencere açık bırakıldı.', 'error', 2500);
            return;
        }
        stopSettingsBackgroundWork();
        await window.aurivo?.confirmSettingsClose?.();
    } finally {
        settingsWindowRuntime.closing = false;
    }
}

function installStandaloneSettingsLifecycleHooks() {
    if (!isStandaloneSettingsMode()) return;

    window.aurivo?.onSettingsCloseRequest?.(() => {
        requestStandaloneSettingsClose().catch((error) => {
            console.error('[SETTINGS] close request handling failed:', error);
        });
    });

    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            stopSettingsBackgroundWork();
            stopRainbowAnimation();
        } else {
            resumeSettingsBackgroundWork();
            startRainbowAnimation();
        }
    });
    window.addEventListener('blur', () => {
        stopSettingsBackgroundWork();
        stopRainbowAnimation();
    });
    window.addEventListener('focus', () => {
        resumeSettingsBackgroundWork();
        startRainbowAnimation();
    });
    window.addEventListener('pagehide', stopSettingsBackgroundWork);
    window.addEventListener('beforeunload', () => {
        stopSettingsBackgroundWork();
        stopRainbowAnimation();
    });
}

function applyAppearanceSettingsToRuntime(appearanceOverride = null) {
    const appearance = (appearanceOverride && typeof appearanceOverride === 'object')
        ? appearanceOverride
        : (state.settings?.appearance || {});
    const visualMode = String(appearance.visualMode || 'full').trim().toLowerCase();
    const theme = String(appearance.theme || 'aur-renk-efektleri').trim() || 'aur-renk-efektleri';
    const followSystemTheme = appearance.followSystemTheme === true;
    const systemPrefersDark = getSystemPrefersDark();
    document.documentElement.dataset.aurivoTheme = theme;
    document.body?.setAttribute?.('data-aurivo-theme', theme);
    document.body?.classList?.toggle('aurivo-system-light', followSystemTheme && !systemPrefersDark);
    document.body?.classList?.toggle('aurivo-visual-balanced', visualMode === 'balanced');
    document.body?.classList?.toggle('aurivo-ui-fx-disabled', appearance.uiFxEnabled === false);
    document.body?.classList?.toggle('aurivo-slider-fx-disabled', appearance.sliderFxEnabled === false);
    document.body?.classList?.toggle('aurivo-reduced-motion', appearance.reduceMotion === true);
    document.body?.classList?.toggle('aurivo-sfx-lights-disabled', appearance.sfxLights === false);
    if (appearance.sliderFxEnabled === false) {
        stopRainbowAnimation();
    } else {
        startRainbowAnimation();
    }
    applySliderFxModeToAll();
}

function syncSfxLightsShadowStorage(enabled) {
    try {
        localStorage.setItem('aurivo_ui_sfx_lights_enabled', enabled ? '1' : '0');
    } catch {
        // ignore
    }
}

function updateThemeFollowSystemUi() {
    const followSystemTheme = !!elements.uiFollowSystemThemeToggle?.checked;
    if (elements.themeSelect) {
        elements.themeSelect.disabled = followSystemTheme;
        elements.themeSelect.setAttribute('aria-disabled', followSystemTheme ? 'true' : 'false');
        elements.themeSelect.style.pointerEvents = followSystemTheme ? 'none' : '';
        elements.themeSelect.tabIndex = followSystemTheme ? -1 : 0;
        if (followSystemTheme && document.activeElement === elements.themeSelect) {
            elements.themeSelect.blur();
        }
    }
    if (elements.themeSystemHint) {
        elements.themeSystemHint.classList.toggle('hidden', !followSystemTheme);
    }
}

function updateSfxLightsToggleStateUi() {
    if (!elements.sfxLightsToggleState || !elements.sfxLightsToggle) return;
    const isOn = !!elements.sfxLightsToggle.checked;
    elements.sfxLightsToggleState.textContent = isOn
        ? uiT('ui.sfxLights.state.on', 'Açık')
        : uiT('ui.sfxLights.state.off', 'Kapalı');
    elements.sfxLightsToggleState.classList.toggle('is-on', isOn);
    elements.sfxLightsToggleState.classList.toggle('is-off', !isOn);
}

function updateSliderFxToggleStateUi() {
    const toggle = document.getElementById('sliderFxToggle');
    const stateEl = document.getElementById('sliderFxToggleState');
    if (!toggle || !stateEl) return;
    const isOn = !!toggle.checked;
    stateEl.textContent = isOn
        ? uiT('ui.sliderFx.state.on', 'Açık')
        : uiT('ui.sliderFx.state.off', 'Kapalı');
    stateEl.classList.toggle('is-on', isOn);
    stateEl.classList.toggle('is-off', !isOn);
}

function getVisualModePreset(mode) {
    const normalized = String(mode || 'full').trim().toLowerCase();
    if (normalized === 'balanced') {
        return { visualMode: 'balanced', uiFxEnabled: true, reduceMotion: true };
    }
    if (normalized === 'minimal') {
        return { visualMode: 'minimal', uiFxEnabled: false, reduceMotion: true };
    }
    return { visualMode: 'full', uiFxEnabled: true, reduceMotion: false };
}

function updateVisualModeUi() {
    const mode = String(elements.uiVisualModeSelect?.value || 'full').trim().toLowerCase();
    const preset = getVisualModePreset(mode);
    if (elements.uiFxEnabledToggle) {
        elements.uiFxEnabledToggle.checked = preset.uiFxEnabled;
        elements.uiFxEnabledToggle.disabled = true;
    }
    if (elements.uiReduceMotionToggle) {
        elements.uiReduceMotionToggle.checked = preset.reduceMotion;
        elements.uiReduceMotionToggle.disabled = true;
    }
    if (elements.uiVisualModeHint) {
        const hintMap = {
            full: uiT('ui.visualMode.hintFull', 'Tam mod: tüm animasyon ve görsel efektler aktif.'),
            balanced: uiT('ui.visualMode.hintBalanced', 'Dengeli mod: animasyonlar sadeleşir, performans daha stabildir.'),
            minimal: uiT('ui.visualMode.hintMinimal', 'Minimum mod: en hafif görünüm, animasyon ve efektler minimumdadır.')
        };
        elements.uiVisualModeHint.textContent = hintMap[preset.visualMode] || hintMap.full;
    }
    if (elements.uiVisualModePerfBadge) {
        const badge = elements.uiVisualModePerfBadge;
        const perfMap = {
            full: {
                text: uiT('ui.visualMode.perf.high', 'Performans: Yüksek GPU'),
                cls: 'settings-chip-accent'
            },
            balanced: {
                text: uiT('ui.visualMode.perf.medium', 'Performans: Orta'),
                cls: 'settings-chip-neutral'
            },
            minimal: {
                text: uiT('ui.visualMode.perf.low', 'Performans: Düşük'),
                cls: 'settings-chip-success'
            }
        };
        const info = perfMap[preset.visualMode] || perfMap.balanced;
        badge.textContent = info.text;
        badge.classList.remove('settings-chip-accent', 'settings-chip-neutral', 'settings-chip-success');
        badge.classList.add(info.cls);
    }
}

function previewAppearanceSettingsFromUI() {
    const current = state.settings?.appearance || {};
    const sfxLightsEnabled = !!elements.sfxLightsToggle?.checked;
    const sliderFxEnabled = getSliderFxToggleChecked();
    const followSystemTheme = !!elements.uiFollowSystemThemeToggle?.checked;
    const selectedTheme = followSystemTheme
        ? String(current.theme || 'aur-renk-efektleri')
        : String(elements.themeSelect?.value || current.theme || 'aur-renk-efektleri');
    const preset = getVisualModePreset(elements.uiVisualModeSelect?.value || current.visualMode || 'full');
    updateVisualModeUi();
    updateThemeFollowSystemUi();
    updateSliderFxToggleStateUi();
    updateSfxLightsToggleStateUi();
    syncSfxLightsShadowStorage(sfxLightsEnabled);
    applyAppearanceSettingsToRuntime({
        ...current,
        theme: selectedTheme,
        followSystemTheme,
        visualMode: preset.visualMode,
        uiFxEnabled: preset.uiFxEnabled,
        sliderFxEnabled,
        reduceMotion: preset.reduceMotion,
        sfxLights: sfxLightsEnabled
    });
}

function applySecuritySettingsToRuntime() {
    if (!elements.webView) return;
    const allowPopups = state.settings?.security?.allowPopups !== false;
    if (allowPopups) {
        elements.webView.setAttribute('allowpopups', '');
    } else {
        elements.webView.removeAttribute('allowpopups');
    }
    if (elements.securityAllowPopups) {
        elements.securityAllowPopups.checked = allowPopups;
    }
}

function resetPlaybackDefaults() {
    window.AurivoSettingsShared?.resetPlaybackDefaults?.();
}

function resetListenDefaults() {
    window.AurivoSettingsShared?.resetListenDefaults?.({
        elements,
        defaultSec: PULSE_NO_SIGNAL_HINT_TOAST_DEFAULT_SEC,
        defaultMode: PULSE_QUICK_MODE_DEFAULT,
        updatePulseQuickModeUi
    });
    updateRecognitionEngineUi();
}

function getActiveSettingsTabName() {
    return Array.from(elements.settingsTabs || []).find((tab) => tab.classList.contains('active'))?.dataset?.tab || 'playback';
}

function getSettingsTabLabel(tabName) {
    const normalized = String(tabName || '').trim().toLowerCase();
    const keyMap = {
        playback: 'settings.tabs.playback',
        listen: 'settings.tabs.listen',
        behavior: 'settings.tabs.behavior',
        security: 'securityPage.title',
        library: 'settings.tabs.library',
        audio: 'settings.tabs.audio',
        adblock: 'nav.adblock'
    };
    const fallbackMap = {
        playback: 'Oynat',
        listen: 'Dinle',
        behavior: 'Davranış',
        security: 'Güvenlik',
        library: 'Müzik Kütüphanesi',
        audio: 'Ses Çıkışı',
        adblock: 'DeliBlock'
    };
    return uiT(keyMap[normalized] || '', fallbackMap[normalized] || 'Ayarlar');
}

function resetBehaviorDefaults() {
    if (elements.languageSelect) {
        elements.languageSelect.value = String(
            state.settings?.ui?.language
            || state.settings?.lang
            || navigator.language
            || 'tr-TR'
        );
    }
    const themeSelect = document.getElementById('themeSelect');
    if (themeSelect) themeSelect.value = 'aur-renk-efektleri';
    const uiFollowSystemThemeToggle = document.getElementById('uiFollowSystemThemeToggle');
    if (uiFollowSystemThemeToggle) uiFollowSystemThemeToggle.checked = false;
    if (elements.uiVisualModeSelect) elements.uiVisualModeSelect.value = 'full';
    const uiFxEnabledToggle = document.getElementById('uiFxEnabledToggle');
    if (uiFxEnabledToggle) uiFxEnabledToggle.checked = true;
    const uiReduceMotionToggle = document.getElementById('uiReduceMotionToggle');
    if (uiReduceMotionToggle) uiReduceMotionToggle.checked = false;
    if (elements.sliderFxToggle) elements.sliderFxToggle.checked = true;
    if (elements.sfxLightsToggle) elements.sfxLightsToggle.checked = true;
    if (elements.behaviorRememberLastSection) elements.behaviorRememberLastSection.checked = true;
    if (elements.libraryRememberSection) elements.libraryRememberSection.checked = true;
    if (elements.behaviorStartupPage) elements.behaviorStartupPage.value = 'music';
    if (elements.libraryStartupPage) elements.libraryStartupPage.value = 'music';
    if (elements.behaviorCloseToTray) elements.behaviorCloseToTray.checked = true;
    updateVisualModeUi();
    updateThemeFollowSystemUi();
    previewAppearanceSettingsFromUI();
}

function resetSecurityDefaults() {
    if (elements.securityAllowPopups) elements.securityAllowPopups.checked = true;
    if (elements.securityStrictVpnBlock) elements.securityStrictVpnBlock.checked = false;
}

function resetLibraryDefaults() {
    if (elements.libraryRememberSection) elements.libraryRememberSection.checked = true;
    if (elements.libraryRestoreLastFolder) elements.libraryRestoreLastFolder.checked = true;
    if (elements.libraryRestoreLastPlaylist) elements.libraryRestoreLastPlaylist.checked = true;
    if (elements.libraryRememberTreeSelection) elements.libraryRememberTreeSelection.checked = true;
    if (elements.libraryStartupPage) elements.libraryStartupPage.value = 'music';
    if (elements.libraryScanOnStartup) elements.libraryScanOnStartup.checked = true;
    if (elements.libraryAutoRescanOnFolderChange) elements.libraryAutoRescanOnFolderChange.checked = true;
    if (elements.libraryWatchFolders) elements.libraryWatchFolders.checked = true;
    if (elements.libraryPreferEmbeddedCover) elements.libraryPreferEmbeddedCover.checked = true;
    if (elements.libraryScanFolderCover) elements.libraryScanFolderCover.checked = true;
    if (elements.libraryMarkMissingCovers) elements.libraryMarkMissingCovers.checked = true;
    if (elements.libraryViewSort) elements.libraryViewSort.value = 'title';
    if (elements.libraryViewGroup) elements.libraryViewGroup.value = 'none';
    if (elements.libraryViewMode) elements.libraryViewMode.value = 'list';
    if (elements.libraryAudioExtensions) elements.libraryAudioExtensions.value = DEFAULT_AUDIO_EXTENSIONS.join(', ');
    if (elements.libraryVideoExtensions) elements.libraryVideoExtensions.value = DEFAULT_VIDEO_EXTENSIONS.join(', ');
    if (elements.libraryFlowFavoritesEnabled) elements.libraryFlowFavoritesEnabled.checked = true;
    if (elements.libraryFlowRecentEnabled) elements.libraryFlowRecentEnabled.checked = true;
    if (elements.libraryFlowMostPlayedEnabled) elements.libraryFlowMostPlayedEnabled.checked = true;
    if (elements.libraryFlowRecentLimit) elements.libraryFlowRecentLimit.value = '25';
    if (elements.libraryFlowMostPlayedLimit) elements.libraryFlowMostPlayedLimit.value = '25';
    if (elements.libraryFastScan) elements.libraryFastScan.checked = true;
    if (elements.libraryLightweightMode) elements.libraryLightweightMode.checked = false;
    if (elements.libraryCoverCacheLimitMb) elements.libraryCoverCacheLimitMb.value = '64';
}

function resetAudioDefaults() {
    if (elements.audioFollowSystemVolume) elements.audioFollowSystemVolume.checked = true;
    window.AurivoSettingsShared?.setButtonToggleState?.(elements.audioAllowOverdrive150, false);
    if (elements.audioDefaultVolume) {
        elements.audioDefaultVolume.max = '100';
        elements.audioDefaultVolume.value = '40';
    }
    if (elements.audioAppVolume) elements.audioAppVolume.value = '40';
    window.AurivoSettingsShared?.updateAudioSettingsVolumeLabel?.(elements);
    window.AurivoSettingsShared?.updateAudioAppVolumeLabel?.(elements);
    if (elements.audioLoudnessEnabled) elements.audioLoudnessEnabled.checked = false;
    if (elements.audioLoudnessMode) elements.audioLoudnessMode.value = 'balanced';
    if (elements.audioLimiterEnabled) elements.audioLimiterEnabled.checked = false;
    if (elements.audioLimiterMode) elements.audioLimiterMode.value = 'balanced';
    if (elements.audioNightModeEnabled) elements.audioNightModeEnabled.checked = false;
    if (elements.audioNightModeLevel) elements.audioNightModeLevel.value = 'balanced';
    if (elements.audioStableVolume) elements.audioStableVolume.checked = false;
    if (elements.audioVolumeBoost) elements.audioVolumeBoost.checked = false;
    if (elements.audioVideoDelay) {
        elements.audioVideoDelay.value = '0';
        if (elements.audioVideoDelayValue) elements.audioVideoDelayValue.textContent = '0 ms';
    }
    if (elements.audioProfileCards?.length) {
        elements.audioProfileCards.forEach((card) => {
            card.classList.toggle('is-active', String(card.dataset.audioProfile || '') === 'music');
        });
    }
    if (elements.audioSpatialCards?.length) {
        elements.audioSpatialCards.forEach((card) => {
            card.classList.toggle('is-active', String(card.dataset.audioSpatial || '') === 'stereo');
        });
    }
}

function resetAdblockDefaults() {
    if (elements.adblockModeCards?.length) {
        elements.adblockModeCards.forEach((card) => {
            const active = String(card.dataset.adblockMode || '') === String(ADBLOCK_DEFAULT_SETTINGS.mode || 'ideal');
            card.classList.toggle('active', active);
            card.setAttribute('aria-pressed', active ? 'true' : 'false');
        });
    }
    if (elements.adblockShowBlockedCount) elements.adblockShowBlockedCount.checked = !!ADBLOCK_DEFAULT_SETTINGS.showBlockedCount;
    if (elements.adblockAutoRefreshOnModeChange) elements.adblockAutoRefreshOnModeChange.checked = !!ADBLOCK_DEFAULT_SETTINGS.autoRefreshOnModeChange;
}

function resetCurrentSettingsTab() {
    const activeTab = getActiveSettingsTabName();
    if (activeTab === 'playback') resetPlaybackDefaults();
    else if (activeTab === 'listen') resetListenDefaults();
    else if (activeTab === 'behavior') resetBehaviorDefaults();
    else if (activeTab === 'security') resetSecurityDefaults();
    else if (activeTab === 'library') resetLibraryDefaults();
    else if (activeTab === 'audio') resetAudioDefaults();
    else if (activeTab === 'adblock') resetAdblockDefaults();

    safeNotify(
        uiT('settings.notify.resetCurrentTabNamed', '{tab} varsayılan değerlere döndürüldü. Kaydet ile kalıcı olur.', {
            tab: getSettingsTabLabel(activeTab)
        }),
        'info',
        1800
    );
}

function showAbout() {
    openAboutModal();
}

function isAboutModalOpen() {
    return Boolean(elements.aboutModalOverlay && !elements.aboutModalOverlay.classList.contains('hidden'));
}

function openAboutModal() {
    if (!elements.aboutModalOverlay) return;
    elements.aboutModalOverlay.classList.remove('hidden');
    requestAnimationFrame(() => {
        elements.aboutCloseBtn?.focus?.();
    });
}

function closeAboutModal() {
    if (!elements.aboutModalOverlay) return;
    elements.aboutModalOverlay.classList.add('hidden');
}

// ============================================
// KEYBOARD SHORTCUTS
// ============================================
function handleKeyboard(e) {
    // About modal açıksa önce onu kapat
    if (isAboutModalOpen()) {
        if (e.code === 'Escape') {
            e.preventDefault();
            closeAboutModal();
        }
        return;
    }

    // Utility sayfalar açıkken klavye kısayollarını devre dışı bırak
    if (isPageVisible(elements.settingsPage)) return;

    // TAM EKRAN VİDEO KLAVİYE KISAYOLLARI
    if (document.fullscreenElement && state.activeMedia === 'video') {
        switch (e.code) {
            case 'Space':
                e.preventDefault();
                handleFsPlayPause();
                return;
            case 'ArrowLeft':
                e.preventDefault();
                seekVideoRelative(-10);
                return;
            case 'ArrowRight':
                e.preventDefault();
                seekVideoRelative(10);
                return;
            case 'ArrowUp':
                e.preventDefault();
                const currentVol = Math.round(elements.videoPlayer.volume * 100);
                const newVol = Math.min(100, currentVol + 5);
                elements.videoPlayer.volume = newVol / 100;
                document.getElementById('fsVolumeSlider').value = newVol;
                document.getElementById('fsVolumeLabel').textContent = newVol + '%';
                return;
            case 'ArrowDown':
                e.preventDefault();
                const currentVolDown = Math.round(elements.videoPlayer.volume * 100);
                const newVolDown = Math.max(0, currentVolDown - 5);
                elements.videoPlayer.volume = newVolDown / 100;
                document.getElementById('fsVolumeSlider').value = newVolDown;
                document.getElementById('fsVolumeLabel').textContent = newVolDown + '%';
                return;
            case 'KeyM':
                e.preventDefault();
                handleFsMute();
                return;
            case 'KeyF':
            case 'F11':
                e.preventDefault();
                exitVideoFullscreen();
                return;
            case 'Escape':
                e.preventDefault();
                exitVideoFullscreen();
                return;
        }
    }

    // CTRL+A - file tree'de tüm dosyaları seç
    if (e.ctrlKey && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault();
        e.stopPropagation();

        // Tüm dosya öğelerini seç (klasörleri hariç tut)
        const fileItems = document.querySelectorAll('.tree-item.file');
        if (fileItems.length > 0) {
            fileItems.forEach(item => {
                item.classList.add('selected');
            });
            console.log('CTRL+A: ' + fileItems.length + ' dosya seçildi');
        }
        return;
    }

    // ENTER - seçili dosyaları playlist'e ekle
    if (e.key === 'Enter') {
        const selectedItems = document.querySelectorAll('.tree-item.file.selected');
        if (selectedItems.length > 0) {
            e.preventDefault();
            addSelectedFilesToPlaylist();
            return;
        }
    }

    // F11 - Tam ekran toggle (video sayfasında)
    if (e.code === 'F11' && state.currentPage === 'video') {
        e.preventDefault();
        toggleVideoFullscreen();
        return;
    }

    switch (e.code) {
        case 'Space':
            e.preventDefault();
            togglePlayPause();
            break;
        case 'ArrowLeft':
            seekBy(-getPlaybackSeekStepSeconds());
            break;
        case 'ArrowRight':
            seekBy(getPlaybackSeekStepSeconds());
            break;
        case 'ArrowUp':
            elements.volumeSlider.value = Math.min(100, state.volume + 5);
            handleVolumeChange();
            break;
        case 'ArrowDown':
            elements.volumeSlider.value = Math.max(0, state.volume - 5);
            handleVolumeChange();
            break;
        case 'KeyM':
            toggleMute();
            break;
        case 'KeyS':
            toggleShuffle();
            break;
        case 'KeyR':
            toggleRepeat();
            break;
    }
}

// ============================================
// VISUALIZER - Qt/C++ AnalyzerContainer Port
// Based on dli/analyzers/analyzercontainer.cpp
// ============================================
let audioContext, analyser, dataArray;
let htmlAudioSourceNodeA = null;
let htmlAudioSourceNodeB = null;
let webAudioOutputGainNode = null;
let visualizerTimerId = null;
let visualizerInFlight = false;
let visualizerIsNative = false;
let visualizerCtx = null;
let visualizerCanvasRef = null;
let visualizerLastRenderAt = 0;
let visualizerReleaseFrame = null;
let visualizerReleaseState = null;

function getVisualizerReleaseDropMultiplier() {
    if (!visualizerReleaseState) return 1;
    if (state.activeMedia !== 'audio') return 1;
    if (state.isPlaying) return 1;
    return 2.1;
}

function setWebAudioOutputGainFromState() {
    if (useNativeAudio) return;
    if (!audioContext || !webAudioOutputGainNode) return;
    const gain = Math.max(0, Math.min(1, (Number(state.volume) || 0) / 100));
    try {
        if (typeof webAudioOutputGainNode.gain.setTargetAtTime === 'function') {
            webAudioOutputGainNode.gain.setTargetAtTime(gain, audioContext.currentTime || 0, 0.015);
        } else {
            webAudioOutputGainNode.gain.value = gain;
        }
    } catch {
        webAudioOutputGainNode.gain.value = gain;
    }
}

// Görselleştirici Ayarları
const VisualizerSettings = {
    currentAnalyzer: 'bar',
    currentFramerate: 30,
    psychedelicEnabled: true,
    glowEnabled: true,
    reflectionEnabled: false,
    hueOffset: 0,

    // Mevcut analyzerlar
    analyzers: {
        'bar': 'Bar çözümleyici',
        'block': 'Blok çözümleyici',
        'boom': 'Boom çözümleyici',
        'boom_noline': 'Boom çözümleyici (çizgisiz)',
        'sonogram': 'Sonogram',
        'turbine': 'Türbin',
        'nyanalyzer': 'Nyanalyzer Cat',
        'rainbow': 'Rainbow Dash',
        'none': 'Çözümleyici yok'
    },

    framerates: [20, 25, 30, 60],

    load() {
        try {
            const saved = localStorage.getItem('aurivo_visualizer');
            if (saved) {
                const data = JSON.parse(saved);
                this.currentAnalyzer = data.analyzer || 'bar';
                if (!Object.prototype.hasOwnProperty.call(this.analyzers, this.currentAnalyzer)) {
                    this.currentAnalyzer = 'bar';
                }
                this.currentFramerate = data.framerate || 30;
                this.psychedelicEnabled = data.psychedelic !== false;
                this.glowEnabled = data.glow !== false;
                this.reflectionEnabled = data.reflection || false;
            }
        } catch (e) {
            console.log('Visualizer settings load error:', e);
        }
    },

    save() {
        try {
            localStorage.setItem('aurivo_visualizer', JSON.stringify({
                analyzer: this.currentAnalyzer,
                framerate: this.currentFramerate,
                psychedelic: this.psychedelicEnabled,
                glow: this.glowEnabled,
                reflection: this.reflectionEnabled
            }));
        } catch (e) {
            console.log('Visualizer settings save error:', e);
        }
    }
};

// ============================================
// AURIVO BAR ANALYZER - Qt/C++'den JavaScript'e taşıma
// Temel: dli/analyzers/baranalyzer.cpp
// ============================================
const BarAnalyzer = {
    // baranalyzer.h sabitleri
    ROOF_HOLD_TIME: 48,
    ROOF_VELOCITY_REDUCTION_FACTOR: 32,
    NUM_ROOFS: 16,
    COLUMN_WIDTH: 4,
    GAP: 1,

    // Durum
    bandCount: 64,
    barVector: [],
    roofVector: [],
    roofVelocityVector: [],
    roofMem: [],
    lvlMapper: [],
    maxDown: -2,
    maxUp: 4,
    psychedelicEnabled: true,
    hueOffset: 0,

    // Analyzer'ı başlat
    init(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.resize();

        // Seviye eşleyici oluştur (logaritmik ölçek)
        const MAX_AMPLITUDE = 1.0;
        const F = (canvas.height - 2) / (Math.log10(255) * MAX_AMPLITUDE);

        for (let x = 0; x < 256; x++) {
            this.lvlMapper[x] = Math.floor(F * Math.log10(x + 1));
        }
    },

    resize() {
        if (!this.canvas) return;

        const width = this.canvas.width;
        const height = this.canvas.height;

        if (width <= 0 || height <= 0) return;

        this.bandCount = Math.floor(width / (this.COLUMN_WIDTH + this.GAP));
        if (this.bandCount === 0) this.bandCount = 1;

        this.maxDown = -Math.max(1, Math.floor(height / 50));
        this.maxUp = Math.max(1, Math.floor(height / 25));

        // Dizileri sıfırla
        this.barVector = new Array(this.bandCount).fill(0);
        this.roofVector = new Array(this.bandCount).fill(height - 5);
        this.roofVelocityVector = new Array(this.bandCount).fill(this.ROOF_VELOCITY_REDUCTION_FACTOR);
        this.roofMem = Array.from({ length: this.bandCount }, () => []);
    },

    // Konuma göre psikedelik renk al
    getColor(index, total, brightness = 100) {
        const hue = (this.hueOffset + (index / total) * 360) % 360;
        return `hsl(${hue}, 100%, ${brightness}%)`;
    },

    // Bar için gradient al
    getBarGradient(x, height, barHeight) {
        const gradient = this.ctx.createLinearGradient(x, this.canvas.height, x, this.canvas.height - barHeight);

        if (this.psychedelicEnabled) {
            const hue = (this.hueOffset + (x / this.canvas.width) * 360) % 360;
            gradient.addColorStop(0, `hsl(${hue}, 100%, 60%)`);
            gradient.addColorStop(0.5, `hsl(${(hue + 30) % 360}, 100%, 50%)`);
            gradient.addColorStop(1, `hsl(${(hue + 60) % 360}, 80%, 40%)`);
        } else {
            gradient.addColorStop(0, '#00d9ff');
            gradient.addColorStop(0.5, '#00a8cc');
            gradient.addColorStop(1, '#006688');
        }

        return gradient;
    },

    // Ana analiz fonksiyonu - spektrum verisini işler
    analyze(spectrumData, isPlaying) {
        const ctx = this.ctx;
        const canvas = this.canvas;
        const width = canvas.width;
        const height = canvas.height;

        // Canvas'ı temizle
        ctx.fillStyle = '#121212';
        ctx.fillRect(0, 0, width, height);

        if (!isPlaying || !spectrumData || spectrumData.length === 0) {
            // Boştaki barları çiz
            this.drawIdleBars();
            return;
        }

        // Psikedelik mod için hue güncelle
        if (this.psychedelicEnabled) {
            this.hueOffset = (this.hueOffset + 0.5) % 360;
        }

        // Bant sayısına uyması için spektrum verisini enterpole et
        const scope = this.interpolateSpectrum(spectrumData, this.bandCount);

        // Her bandı işle
        for (let i = 0; i < this.bandCount; i++) {
            const x = i * (this.COLUMN_WIDTH + this.GAP);

            // Spektrum değerini yüksekliğe eşle
            let y2 = Math.floor(scope[i] * 256);
            y2 = this.lvlMapper[Math.min(y2, 255)];

            // Yumuşak düşüş
            const change = y2 - this.barVector[i];
            if (change < this.maxDown) {
                y2 = this.barVector[i] + this.maxDown;
            }

            // Tavanı güncelle (peak göstergesi)
            if (y2 > this.roofVector[i]) {
                this.roofVector[i] = y2;
                this.roofVelocityVector[i] = 1;
            }

            this.barVector[i] = y2;

            // Gradient ile bar çiz
            if (y2 > 0) {
                ctx.fillStyle = this.getBarGradient(x, height, y2);
                ctx.fillRect(x, height - y2, this.COLUMN_WIDTH, y2);
            }

            // Tavanı çiz (peak göstergeleri)
            if (this.roofMem[i].length > this.NUM_ROOFS) {
                this.roofMem[i].shift();
            }

            // Sönen tavan izini çiz
            for (let c = 0; c < this.roofMem[i].length; c++) {
                const roofY = this.roofMem[i][c];
                const alpha = 1 - (c / this.NUM_ROOFS);
                const hue = (this.hueOffset + (i / this.bandCount) * 360) % 360;
                ctx.fillStyle = `hsla(${hue}, 100%, 70%, ${alpha * 0.5})`;
                ctx.fillRect(x, roofY, this.COLUMN_WIDTH, 2);
            }

            // Mevcut tavan
            const roofY = height - this.roofVector[i] - 2;
            this.roofMem[i].push(roofY);

            // Mevcut tavanı çiz (peak)
            const roofHue = (this.hueOffset + (i / this.bandCount) * 360 + 180) % 360;
            ctx.fillStyle = `hsl(${roofHue}, 100%, 80%)`;
            ctx.fillRect(x, roofY, this.COLUMN_WIDTH, 2);

            // Tavan fiziğini güncelle
            if (this.roofVelocityVector[i] !== 0) {
                if (this.roofVelocityVector[i] > 32) {
                    this.roofVector[i] -= Math.floor((this.roofVelocityVector[i] - 32) / 20);
                }

                if (this.roofVector[i] < 0) {
                    this.roofVector[i] = 0;
                    this.roofVelocityVector[i] = 0;
                } else {
                    this.roofVelocityVector[i]++;
                }
            }
        }
    },

    // Boştaki barları çiz when not playing
    drawIdleBars() {
        const ctx = this.ctx;
        const canvas = this.canvas;

        for (let i = 0; i < this.bandCount; i++) {
            const x = i * (this.COLUMN_WIDTH + this.GAP);
            const hue = (this.hueOffset + (i / this.bandCount) * 360) % 360;
            ctx.fillStyle = `hsla(${hue}, 100%, 50%, 0.3)`;
            ctx.fillRect(x, canvas.height - 3, this.COLUMN_WIDTH, 3);
        }

        this.hueOffset = (this.hueOffset + 0.2) % 360;
    },

    // Spektrum verisini enterpole et
    interpolateSpectrum(data, targetSize) {
        const result = new Array(targetSize);
        const ratio = data.length / targetSize;

        for (let i = 0; i < targetSize; i++) {
            const srcIndex = i * ratio;
            const low = Math.floor(srcIndex);
            const high = Math.min(low + 1, data.length - 1);
            const frac = srcIndex - low;

            // Düşük frekanslara hafif boost ile lineer enterpolasyon
            const boost = 1 + (1 - i / targetSize) * 0.5;
            result[i] = ((1 - frac) * data[low] + frac * data[high]) * boost;
        }

        return result;
    }
};

// ============================================
// BLOCK ANALYZER - Qt/C++'den JavaScript'e taşıma
// Based on dli/analyzers/blockanalyzer.cpp
// ============================================
const BlockAnalyzer = {
    BLOCK_HEIGHT: 3,
    BLOCK_WIDTH: 4,
    GAP: 1,
    FADE_SIZE: 90,

    bandCount: 64,
    rows: 20,
    scope: [],
    bandInfo: [],
    step: 0.5,
    hueOffset: 0,
    canvas: null,
    ctx: null,

    init(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.resize();
    },

    resize() {
        if (!this.canvas) return;
        const width = this.canvas.width;
        const height = this.canvas.height;
        if (width <= 0 || height <= 0) return;

        this.bandCount = Math.floor(width / (this.BLOCK_WIDTH + this.GAP));
        if (this.bandCount === 0) this.bandCount = 1;
        this.rows = Math.floor(height / (this.BLOCK_HEIGHT + this.GAP));
        if (this.rows === 0) this.rows = 1;

        this.scope = new Array(this.bandCount).fill(0);
        this.bandInfo = Array.from({ length: this.bandCount }, () => ({ height: 0, row: 0 }));
        this.step = 0.5;
    },

    analyze(spectrumData, isPlaying) {
        const ctx = this.ctx;
        const canvas = this.canvas;
        const width = canvas.width;
        const height = canvas.height;

        ctx.fillStyle = '#121212';
        ctx.fillRect(0, 0, width, height);

        if (!isPlaying || !spectrumData || spectrumData.length === 0) {
            this.drawIdle();
            return;
        }

        if (VisualizerSettings.psychedelicEnabled) {
            this.hueOffset = (this.hueOffset + 0.5) % 360;
        }

        // Interpolate spectrum
        const interpolated = this.interpolateSpectrum(spectrumData, this.bandCount);

        for (let x = 0; x < this.bandCount; x++) {
            const value = interpolated[x];
            let targetRow = Math.floor(Math.max(0, Math.min(1, value)) * this.rows);
            targetRow = Math.max(0, Math.min(this.rows, targetRow));

            // Smooth animation
            if (targetRow < this.bandInfo[x].row) {
                this.bandInfo[x].height = Math.max(targetRow, this.bandInfo[x].height - this.step);
                this.bandInfo[x].row = Math.floor(this.bandInfo[x].height);
            } else {
                this.bandInfo[x].height = targetRow;
                this.bandInfo[x].row = targetRow;
            }

            const row = Math.min(this.bandInfo[x].row, this.rows);
            const xPos = x * (this.BLOCK_WIDTH + this.GAP);

            // Draw blocks
            for (let y = 0; y < row; y++) {
                const yPos = height - (y + 1) * (this.BLOCK_HEIGHT + this.GAP);
                const intensity = 1 - (y / this.rows);

                if (VisualizerSettings.psychedelicEnabled) {
                    const hue = (this.hueOffset + (x / this.bandCount) * 360 + y * 5) % 360;
                    ctx.fillStyle = `hsl(${hue}, 100%, ${50 + intensity * 30}%)`;
                } else {
                    const g = Math.floor(100 + intensity * 155);
                    ctx.fillStyle = `rgb(0, ${g}, ${Math.floor(g * 0.8)})`;
                }

                ctx.fillRect(xPos, yPos, this.BLOCK_WIDTH, this.BLOCK_HEIGHT);
            }
        }
    },

    drawIdle() {
        const ctx = this.ctx;
        const canvas = this.canvas;
        for (let x = 0; x < this.bandCount; x++) {
            const xPos = x * (this.BLOCK_WIDTH + this.GAP);
            const hue = (this.hueOffset + (x / this.bandCount) * 360) % 360;
            ctx.fillStyle = `hsla(${hue}, 100%, 50%, 0.3)`;
            ctx.fillRect(xPos, canvas.height - this.BLOCK_HEIGHT, this.BLOCK_WIDTH, this.BLOCK_HEIGHT);
        }
        this.hueOffset = (this.hueOffset + 0.2) % 360;
    },

    interpolateSpectrum(data, targetSize) {
        const result = new Array(targetSize);
        const ratio = data.length / targetSize;
        for (let i = 0; i < targetSize; i++) {
            const srcIndex = i * ratio;
            const low = Math.floor(srcIndex);
            const high = Math.min(low + 1, data.length - 1);
            const frac = srcIndex - low;
            result[i] = (1 - frac) * data[low] + frac * data[high];
        }
        return result;
    }
};

// ============================================
// BOOM ANALYZER - Qt/C++'den JavaScript'e taşıma
// Based on dli/analyzers/boomanalyzer.cpp
// ============================================
const BoomAnalyzer = {
    COLUMN_WIDTH: 4,
    GAP: 1,
    K_BAR_HEIGHT: 1.271,
    F_PEAK_SPEED: 1.103,

    bandCount: 64,
    barHeight: [],
    peakHeight: [],
    peakSpeed: [],
    F: 1.0,
    hueOffset: 0,
    canvas: null,
    ctx: null,

    init(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.resize();
    },

    resize() {
        if (!this.canvas) return;
        const width = this.canvas.width;
        const height = this.canvas.height;
        if (width <= 0 || height <= 0) return;

        this.bandCount = Math.floor(width / (this.COLUMN_WIDTH + this.GAP));
        if (this.bandCount === 0) this.bandCount = 1;

        this.F = height / (Math.log10(256) * 1.1);
        this.barHeight = new Array(this.bandCount).fill(0);
        this.peakHeight = new Array(this.bandCount).fill(0);
        this.peakSpeed = new Array(this.bandCount).fill(0.01);
    },

    analyze(spectrumData, isPlaying) {
        const ctx = this.ctx;
        const canvas = this.canvas;
        const width = canvas.width;
        const height = canvas.height;

        ctx.fillStyle = '#121212';
        ctx.fillRect(0, 0, width, height);

        if (!isPlaying || !spectrumData || spectrumData.length === 0) {
            this.drawIdle();
            return;
        }

        if (VisualizerSettings.psychedelicEnabled) {
            this.hueOffset = (this.hueOffset + 0.5) % 360;
        }

        const scope = this.interpolateSpectrum(spectrumData, this.bandCount);
        const maxHeight = height - 1;

        for (let i = 0; i < this.bandCount; i++) {
            const x = i * (this.COLUMN_WIDTH + this.GAP);
            let h = Math.log10(scope[i] * 256 + 1) * this.F;
            if (h > maxHeight) h = maxHeight;

            if (h > this.barHeight[i]) {
                this.barHeight[i] = h;
                if (h > this.peakHeight[i]) {
                    this.peakHeight[i] = h;
                    this.peakSpeed[i] = 0.01;
                }
            } else {
                if (this.barHeight[i] > 0) {
                    this.barHeight[i] -= this.K_BAR_HEIGHT * getVisualizerReleaseDropMultiplier();
                    if (this.barHeight[i] < 0) this.barHeight[i] = 0;
                }
            }

            // Peak handling
            if (this.peakHeight[i] > 0) {
                this.peakHeight[i] -= this.peakSpeed[i];
                this.peakSpeed[i] *= this.F_PEAK_SPEED;
                if (this.peakHeight[i] < this.barHeight[i]) {
                    this.peakHeight[i] = this.barHeight[i];
                }
                if (this.peakHeight[i] < 0) this.peakHeight[i] = 0;
            }

            const y = height - this.barHeight[i];

            // Gradient ile bar çiz
            if (this.barHeight[i] > 0) {
                const gradient = ctx.createLinearGradient(x, height, x, y);
                if (VisualizerSettings.psychedelicEnabled) {
                    const hue = (this.hueOffset + (i / this.bandCount) * 360) % 360;
                    gradient.addColorStop(0, `hsl(${hue}, 100%, 60%)`);
                    gradient.addColorStop(1, `hsl(${(hue + 60) % 360}, 100%, 40%)`);
                } else {
                    gradient.addColorStop(0, '#00ff88');
                    gradient.addColorStop(1, '#004422');
                }
                ctx.fillStyle = gradient;
                ctx.fillRect(x, y, this.COLUMN_WIDTH, this.barHeight[i]);
            }

            // Draw peak
            const peakY = height - this.peakHeight[i];
            if (VisualizerSettings.psychedelicEnabled) {
                const hue = (this.hueOffset + (i / this.bandCount) * 360 + 180) % 360;
                ctx.fillStyle = `hsl(${hue}, 100%, 80%)`;
            } else {
                ctx.fillStyle = '#ffffff';
            }
            ctx.fillRect(x, peakY - 2, this.COLUMN_WIDTH, 2);
        }
    },

    drawIdle() {
        const ctx = this.ctx;
        const canvas = this.canvas;
        for (let i = 0; i < this.bandCount; i++) {
            const x = i * (this.COLUMN_WIDTH + this.GAP);
            const hue = (this.hueOffset + (i / this.bandCount) * 360) % 360;
            ctx.fillStyle = `hsla(${hue}, 100%, 50%, 0.3)`;
            ctx.fillRect(x, canvas.height - 3, this.COLUMN_WIDTH, 3);
        }
        this.hueOffset = (this.hueOffset + 0.2) % 360;
    },

    interpolateSpectrum(data, targetSize) {
        const result = new Array(targetSize);
        const ratio = data.length / targetSize;
        for (let i = 0; i < targetSize; i++) {
            const srcIndex = i * ratio;
            const low = Math.floor(srcIndex);
            const high = Math.min(low + 1, data.length - 1);
            const frac = srcIndex - low;
            result[i] = (1 - frac) * data[low] + frac * data[high];
        }
        return result;
    }
};

function getEffectiveVisualizerFps() {
    const configured = Math.max(1, Number(VisualizerSettings.currentFramerate) || 30);
    if (document.hidden) return Math.min(configured, 8);
    // Focus kaybında FPS düşürme: kapatıldı.
    // Kullanıcının seçtiği FPS ayarlar penceresi açıkken de korunur.
    if (state.activeMedia !== 'audio' || !state.isPlaying) return Math.min(configured, 12);
    if (VisualizerSettings.currentAnalyzer === 'none') return 2;
    return configured;
}

function shouldRunVisualizer() {
    if (!visualizerCanvasRef || !visualizerCtx) return false;
    const rect = typeof visualizerCanvasRef.getBoundingClientRect === 'function'
        ? visualizerCanvasRef.getBoundingClientRect()
        : null;
    const hasSize = visualizerCanvasRef.width > 0 && visualizerCanvasRef.height > 0;
    const visible = !!rect && rect.width > 0 && rect.height > 0;
    return hasSize && visible;
}

function scheduleVisualizerTick(delayMs = 0) {
    if (visualizerTimerId) {
        clearTimeout(visualizerTimerId);
    }
    visualizerTimerId = setTimeout(runVisualizerTick, Math.max(0, delayMs));
}

async function runVisualizerTick() {
    visualizerTimerId = null;
    if (visualizerInFlight) {
        scheduleVisualizerTick(50);
        return;
    }

    const fps = getEffectiveVisualizerFps();
    const minFrameMs = 1000 / fps;
    const now = performance.now();
    const elapsed = now - visualizerLastRenderAt;
    if (elapsed < minFrameMs) {
        scheduleVisualizerTick(minFrameMs - elapsed);
        return;
    }

    if (!shouldRunVisualizer()) {
        scheduleVisualizerTick(250);
        return;
    }

    visualizerInFlight = true;
    try {
        if (visualizerIsNative) {
            await drawNativeVisualizerFrame();
        } else if (analyser) {
            drawVisualizerFrame();
        } else {
            drawFallbackVisualizerFrame();
        }
        visualizerLastRenderAt = performance.now();
    } finally {
        visualizerInFlight = false;
        scheduleVisualizerTick(1000 / getEffectiveVisualizerFps());
    }
}

function startVisualizerLoop() {
    visualizerLastRenderAt = 0;
    scheduleVisualizerTick(0);
}

// ============================================
// BOOM ANALYZER (ÇİZGİSİZ) - Peak çizgisi olmadan boom görünümü
// ============================================
const BoomNoLineAnalyzer = {
    ...BoomAnalyzer,

    analyze(spectrumData, isPlaying) {
        const ctx = this.ctx;
        const canvas = this.canvas;
        const width = canvas.width;
        const height = canvas.height;

        ctx.fillStyle = '#121212';
        ctx.fillRect(0, 0, width, height);

        if (!isPlaying || !spectrumData || spectrumData.length === 0) {
            this.drawIdle();
            return;
        }

        if (VisualizerSettings.psychedelicEnabled) {
            this.hueOffset = (this.hueOffset + 0.5) % 360;
        }

        const scope = this.interpolateSpectrum(spectrumData, this.bandCount);
        const maxHeight = height - 1;

        for (let i = 0; i < this.bandCount; i++) {
            const x = i * (this.COLUMN_WIDTH + this.GAP);
            let h = Math.log10(scope[i] * 256 + 1) * this.F;
            if (h > maxHeight) h = maxHeight;

            if (h > this.barHeight[i]) {
                this.barHeight[i] = h;
            } else if (this.barHeight[i] > 0) {
                this.barHeight[i] -= this.K_BAR_HEIGHT * getVisualizerReleaseDropMultiplier();
                if (this.barHeight[i] < 0) this.barHeight[i] = 0;
            }

            const y = height - this.barHeight[i];
            if (this.barHeight[i] > 0) {
                const gradient = ctx.createLinearGradient(x, height, x, y);
                if (VisualizerSettings.psychedelicEnabled) {
                    const hue = (this.hueOffset + (i / this.bandCount) * 360) % 360;
                    gradient.addColorStop(0, `hsl(${hue}, 100%, 60%)`);
                    gradient.addColorStop(1, `hsl(${(hue + 60) % 360}, 100%, 40%)`);
                } else {
                    gradient.addColorStop(0, '#00ff88');
                    gradient.addColorStop(1, '#004422');
                }
                ctx.fillStyle = gradient;
                ctx.fillRect(x, y, this.COLUMN_WIDTH, this.barHeight[i]);
            }
        }
    }
};

// ============================================
// TURBINE ANALYZER - Qt/C++'den JavaScript'e taşıma
// Based on dli/analyzers/turbine.cpp
// ============================================
const TurbineAnalyzer = {
    COLUMN_WIDTH: 4,
    GAP: 1,
    K_BAR_HEIGHT: 1.271,
    F_PEAK_SPEED: 1.103,

    bandCount: 64,
    barHeight: [],
    peakHeight: [],
    peakSpeed: [],
    F: 1.0,
    hueOffset: 0,
    canvas: null,
    ctx: null,

    init(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.resize();
    },

    resize() {
        if (!this.canvas) return;
        const width = this.canvas.width;
        const height = this.canvas.height;
        if (width <= 0 || height <= 0) return;

        this.bandCount = Math.floor(width / (this.COLUMN_WIDTH + this.GAP));
        if (this.bandCount === 0) this.bandCount = 1;

        this.F = (height / 2) / (Math.log10(256) * 1.1);
        this.barHeight = new Array(this.bandCount).fill(0);
        this.peakHeight = new Array(this.bandCount).fill(0);
        this.peakSpeed = new Array(this.bandCount).fill(0.01);
    },

    analyze(spectrumData, isPlaying) {
        const ctx = this.ctx;
        const canvas = this.canvas;
        const width = canvas.width;
        const height = canvas.height;
        const hd2 = height / 2;

        ctx.fillStyle = '#121212';
        ctx.fillRect(0, 0, width, height);

        if (!isPlaying || !spectrumData || spectrumData.length === 0) {
            this.drawIdle();
            return;
        }

        if (VisualizerSettings.psychedelicEnabled) {
            this.hueOffset = (this.hueOffset + 0.5) % 360;
        }

        const scope = this.interpolateSpectrum(spectrumData, this.bandCount);
        const maxHeight = hd2 - 1;

        for (let i = 0; i < this.bandCount; i++) {
            const x = i * (this.COLUMN_WIDTH + this.GAP);
            let h = Math.min(Math.log10(scope[i] * 256 + 1) * this.F * 0.82, maxHeight);
            if (h > 0.35) h = Math.max(h, 2.2);

            if (h > this.barHeight[i]) {
                this.barHeight[i] = h;
                if (h > this.peakHeight[i]) {
                    this.peakHeight[i] = h;
                    this.peakSpeed[i] = 0.01;
                }
            } else {
                if (this.barHeight[i] > 0) {
                    this.barHeight[i] -= this.K_BAR_HEIGHT * getVisualizerReleaseDropMultiplier();
                    if (this.barHeight[i] < 0) this.barHeight[i] = 0;
                }
            }

            if (this.peakHeight[i] > 0) {
                this.peakHeight[i] -= this.peakSpeed[i];
                this.peakSpeed[i] *= this.F_PEAK_SPEED;
                this.peakHeight[i] = Math.max(0, Math.max(this.barHeight[i], this.peakHeight[i]));
            }

            const barH = this.barHeight[i];

            // Draw mirrored bars (turbine effect)
            if (barH > 0) {
                const gradient = ctx.createLinearGradient(x, hd2 - barH, x, hd2 + barH);
                if (VisualizerSettings.psychedelicEnabled) {
                    const hue = (this.hueOffset + (i / this.bandCount) * 360) % 360;
                    gradient.addColorStop(0, `hsl(${(hue + 60) % 360}, 100%, 40%)`);
                    gradient.addColorStop(0.5, `hsl(${hue}, 100%, 60%)`);
                    gradient.addColorStop(1, `hsl(${(hue + 60) % 360}, 100%, 40%)`);
                } else {
                    gradient.addColorStop(0, '#004466');
                    gradient.addColorStop(0.5, '#00aaff');
                    gradient.addColorStop(1, '#004466');
                }
                ctx.fillStyle = gradient;

                // Top bar
                ctx.fillRect(x, hd2 - barH, this.COLUMN_WIDTH, barH);
                // Bottom bar (mirrored)
                ctx.fillRect(x, hd2, this.COLUMN_WIDTH, barH);
            }

            // Draw peaks
            const peakH = this.peakHeight[i];
            if (VisualizerSettings.psychedelicEnabled) {
                const hue = (this.hueOffset + (i / this.bandCount) * 360 + 180) % 360;
                ctx.fillStyle = `hsl(${hue}, 100%, 80%)`;
            } else {
                ctx.fillStyle = '#88ccff';
            }
            ctx.fillRect(x, hd2 - peakH - 1, this.COLUMN_WIDTH, 2);
            ctx.fillRect(x, hd2 + peakH - 1, this.COLUMN_WIDTH, 2);
        }

        // Center line
        ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.fillRect(0, hd2, width, 1);
    },

    drawIdle() {
        const ctx = this.ctx;
        const canvas = this.canvas;
        const hd2 = canvas.height / 2;
        for (let i = 0; i < this.bandCount; i++) {
            const x = i * (this.COLUMN_WIDTH + this.GAP);
            const hue = (this.hueOffset + (i / this.bandCount) * 360) % 360;
            ctx.fillStyle = `hsla(${hue}, 100%, 50%, 0.3)`;
            ctx.fillRect(x, hd2 - 2, this.COLUMN_WIDTH, 4);
        }
        this.hueOffset = (this.hueOffset + 0.2) % 360;
    },

    interpolateSpectrum(data, targetSize) {
        const result = new Array(targetSize);
        const ratio = data.length / targetSize;
        for (let i = 0; i < targetSize; i++) {
            const srcIndex = i * ratio;
            const low = Math.floor(srcIndex);
            const high = Math.min(low + 1, data.length - 1);
            const frac = srcIndex - low;
            result[i] = (1 - frac) * data[low] + frac * data[high];
        }
        return result;
    }
};

// ============================================
// SONOGRAM ANALYZER - Qt/C++'den JavaScript'e taşıma
// Based on dli/analyzers/sonogram.cpp
// ============================================
const SonogramAnalyzer = {
    canvas: null,
    ctx: null,
    scopeSize: 128,
    imageData: null,
    hueOffset: 0,

    init(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.resize();
    },

    resize() {
        if (!this.canvas) return;
        const width = this.canvas.width;
        const height = this.canvas.height;
        if (width <= 0 || height <= 0) return;

        this.imageData = this.ctx.createImageData(width, height);
        // Fill with background color
        for (let i = 0; i < this.imageData.data.length; i += 4) {
            this.imageData.data[i] = 18;
            this.imageData.data[i + 1] = 18;
            this.imageData.data[i + 2] = 18;
            this.imageData.data[i + 3] = 255;
        }
    },

    analyze(spectrumData, isPlaying) {
        const ctx = this.ctx;
        const canvas = this.canvas;
        const width = canvas.width;
        const height = canvas.height;

        if (!this.imageData || this.imageData.width !== width) {
            this.resize();
        }

        // Shift image left by 1 pixel
        const data = this.imageData.data;
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width - 1; x++) {
                const srcIdx = (y * width + x + 1) * 4;
                const dstIdx = (y * width + x) * 4;
                data[dstIdx] = data[srcIdx];
                data[dstIdx + 1] = data[srcIdx + 1];
                data[dstIdx + 2] = data[srcIdx + 2];
                data[dstIdx + 3] = data[srcIdx + 3];
            }
        }

        // Draw new column on the right
        const x = width - 1;

        if (!isPlaying || !spectrumData || spectrumData.length === 0) {
            // Draw idle column
            for (let y = 0; y < height; y++) {
                const idx = (y * width + x) * 4;
                data[idx] = 18;
                data[idx + 1] = 18;
                data[idx + 2] = 18;
                data[idx + 3] = 255;
            }
        } else {
            if (VisualizerSettings.psychedelicEnabled) {
                this.hueOffset = (this.hueOffset + 0.5) % 360;
            }

            const scope = this.interpolateSpectrum(spectrumData, height);

            for (let y = 0; y < height; y++) {
                const idx = ((height - 1 - y) * width + x) * 4;
                const value = scope[y];

                if (value < 0.005) {
                    data[idx] = 18;
                    data[idx + 1] = 18;
                    data[idx + 2] = 18;
                } else {
                    let h, s, l;
                    if (VisualizerSettings.psychedelicEnabled) {
                        h = (this.hueOffset + value * 90) % 360;
                        s = 100;
                        l = Math.min(50 + value * 50, 100);
                    } else {
                        h = 95 - value * 90;
                        s = 100;
                        l = Math.min(50 + value * 50, 100);
                    }
                    const rgb = this.hslToRgb(h / 360, s / 100, l / 100);
                    data[idx] = rgb[0];
                    data[idx + 1] = rgb[1];
                    data[idx + 2] = rgb[2];
                }
                data[idx + 3] = 255;
            }
        }

        ctx.putImageData(this.imageData, 0, 0);
    },

    hslToRgb(h, s, l) {
        let r, g, b;
        if (s === 0) {
            r = g = b = l;
        } else {
            const hue2rgb = (p, q, t) => {
                if (t < 0) t += 1;
                if (t > 1) t -= 1;
                if (t < 1 / 6) return p + (q - p) * 6 * t;
                if (t < 1 / 2) return q;
                if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
                return p;
            };
            const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
            const p = 2 * l - q;
            r = hue2rgb(p, q, h + 1 / 3);
            g = hue2rgb(p, q, h);
            b = hue2rgb(p, q, h - 1 / 3);
        }
        return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
    },

    interpolateSpectrum(data, targetSize) {
        const result = new Array(targetSize);
        const ratio = data.length / targetSize;
        for (let i = 0; i < targetSize; i++) {
            const srcIndex = i * ratio;
            const low = Math.floor(srcIndex);
            const high = Math.min(low + 1, data.length - 1);
            const frac = srcIndex - low;
            result[i] = (1 - frac) * data[low] + frac * data[high];
        }
        return result;
    }
};

// ============================================
// RAINBOW DASH ANALYZER - Eğlenceli animasyonlu analyzer
// ============================================
const RainbowDashAnalyzer = {
    COLUMN_WIDTH: 6,
    GAP: 2,

    bandCount: 32,
    barHeight: [],
    hueOffset: 0,
    waveOffset: 0,
    canvas: null,
    ctx: null,

    init(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.resize();
    },

    resize() {
        if (!this.canvas) return;
        const width = this.canvas.width;
        if (width <= 0) return;

        this.bandCount = Math.floor(width / (this.COLUMN_WIDTH + this.GAP));
        if (this.bandCount === 0) this.bandCount = 1;
        this.barHeight = new Array(this.bandCount).fill(0);
    },

    analyze(spectrumData, isPlaying) {
        const ctx = this.ctx;
        const canvas = this.canvas;
        const width = canvas.width;
        const height = canvas.height;

        ctx.fillStyle = '#121212';
        ctx.fillRect(0, 0, width, height);

        this.hueOffset = (this.hueOffset + 2) % 360;
        this.waveOffset += 0.1;

        const scope = isPlaying && spectrumData
            ? this.interpolateSpectrum(spectrumData, this.bandCount)
            : new Array(this.bandCount).fill(0);

        for (let i = 0; i < this.bandCount; i++) {
            const x = i * (this.COLUMN_WIDTH + this.GAP);

            // Add wave effect
            const wave = Math.sin(this.waveOffset + i * 0.3) * 10;
            let targetHeight = scope[i] * height * 0.8 + (isPlaying ? wave : 0);
            if (targetHeight < 5) targetHeight = 5;

            // Smooth animation
            this.barHeight[i] += (targetHeight - this.barHeight[i]) * 0.3;

            const barH = this.barHeight[i];
            const y = height - barH;

            // Rainbow gradient
            const gradient = ctx.createLinearGradient(x, height, x, y);
            const hue1 = (this.hueOffset + i * 15) % 360;
            const hue2 = (hue1 + 60) % 360;
            const hue3 = (hue1 + 120) % 360;

            gradient.addColorStop(0, `hsl(${hue1}, 100%, 50%)`);
            gradient.addColorStop(0.5, `hsl(${hue2}, 100%, 60%)`);
            gradient.addColorStop(1, `hsl(${hue3}, 100%, 40%)`);

            ctx.fillStyle = gradient;

            // Rounded bars
            const radius = Math.min(this.COLUMN_WIDTH / 2, 3);
            ctx.beginPath();
            ctx.roundRect(x, y, this.COLUMN_WIDTH, barH, [radius, radius, 0, 0]);
            ctx.fill();

            // Parlama efekti
            if (VisualizerSettings.glowEnabled && barH > 10) {
                ctx.shadowBlur = 15;
                ctx.shadowColor = `hsl(${hue1}, 100%, 50%)`;
                ctx.fillRect(x, y, this.COLUMN_WIDTH, 2);
                ctx.shadowBlur = 0;
            }
        }
    },

    interpolateSpectrum(data, targetSize) {
        const result = new Array(targetSize);
        const ratio = data.length / targetSize;
        for (let i = 0; i < targetSize; i++) {
            const srcIndex = i * ratio;
            const low = Math.floor(srcIndex);
            const high = Math.min(low + 1, data.length - 1);
            const frac = srcIndex - low;
            result[i] = (1 - frac) * data[low] + frac * data[high];
        }
        return result;
    }
};

// ============================================
// NYANALYZER CAT - Eğlenceli kedi temalı analyzer
// ============================================
const NyanalyzerCatAnalyzer = {
    COLUMN_WIDTH: 5,
    GAP: 1,

    bandCount: 48,
    barHeight: [],
    starPositions: [],
    hueOffset: 0,
    canvas: null,
    ctx: null,

    init(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.resize();
        this.generateStars();
    },

    resize() {
        if (!this.canvas) return;
        const width = this.canvas.width;
        if (width <= 0) return;

        this.bandCount = Math.floor(width / (this.COLUMN_WIDTH + this.GAP));
        if (this.bandCount === 0) this.bandCount = 1;
        this.barHeight = new Array(this.bandCount).fill(0);
        this.generateStars();
    },

    generateStars() {
        this.starPositions = [];
        for (let i = 0; i < 30; i++) {
            this.starPositions.push({
                x: Math.random() * (this.canvas?.width || 300),
                y: Math.random() * (this.canvas?.height || 150),
                size: Math.random() * 2 + 1,
                speed: Math.random() * 2 + 1
            });
        }
    },

    analyze(spectrumData, isPlaying) {
        const ctx = this.ctx;
        const canvas = this.canvas;
        const width = canvas.width;
        const height = canvas.height;

        // Dark space background
        const bgGradient = ctx.createLinearGradient(0, 0, 0, height);
        bgGradient.addColorStop(0, '#0a0a1a');
        bgGradient.addColorStop(1, '#1a0a2a');
        ctx.fillStyle = bgGradient;
        ctx.fillRect(0, 0, width, height);

        // Draw moving stars
        this.hueOffset = (this.hueOffset + 1) % 360;
        for (const star of this.starPositions) {
            star.x -= star.speed;
            if (star.x < 0) star.x = width;

            ctx.fillStyle = `rgba(255, 255, 255, ${0.5 + Math.sin(Date.now() / 200 + star.x) * 0.3})`;
            ctx.beginPath();
            ctx.arc(star.x, star.y, star.size, 0, Math.PI * 2);
            ctx.fill();
        }

        const scope = isPlaying && spectrumData
            ? this.interpolateSpectrum(spectrumData, this.bandCount)
            : new Array(this.bandCount).fill(0);

        for (let i = 0; i < this.bandCount; i++) {
            const x = i * (this.COLUMN_WIDTH + this.GAP);

            let targetHeight = scope[i] * height * 0.7;
            if (targetHeight < 3) targetHeight = 3;

            this.barHeight[i] += (targetHeight - this.barHeight[i]) * 0.25;

            const barH = this.barHeight[i];
            const y = height - barH;

            // Nyan cat rainbow colors
            const rainbowColors = ['#ff0000', '#ff9900', '#ffff00', '#33ff00', '#0099ff', '#6633ff'];
            const colorIndex = i % rainbowColors.length;

            // Draw rainbow trail segments
            const segmentHeight = barH / rainbowColors.length;
            for (let c = 0; c < rainbowColors.length; c++) {
                const segY = height - (c + 1) * segmentHeight;
                ctx.fillStyle = rainbowColors[c];
                ctx.globalAlpha = 0.8;
                ctx.fillRect(x, segY, this.COLUMN_WIDTH, segmentHeight + 1);
            }
            ctx.globalAlpha = 1;
        }
    },

    interpolateSpectrum(data, targetSize) {
        const result = new Array(targetSize);
        const ratio = data.length / targetSize;
        for (let i = 0; i < targetSize; i++) {
            const srcIndex = i * ratio;
            const low = Math.floor(srcIndex);
            const high = Math.min(low + 1, data.length - 1);
            const frac = srcIndex - low;
            result[i] = (1 - frac) * data[low] + frac * data[high];
        }
        return result;
    }
};

// ============================================
// NO ANALYZER - Boş görüntü
// ============================================
const NoAnalyzer = {
    canvas: null,
    ctx: null,

    init(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
    },

    resize() { },

    analyze(spectrumData, isPlaying) {
        const ctx = this.ctx;
        const canvas = this.canvas;
        ctx.fillStyle = '#121212';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
};

// ============================================
// ANALYZER CONTAINER - Tüm analyzerları yönetir
// ============================================
const AnalyzerContainer = {
    currentAnalyzer: null,
    canvas: null,
    ctx: null,

    analyzers: {
        'bar': BarAnalyzer,
        'block': BlockAnalyzer,
        'boom': BoomAnalyzer,
        'boom_noline': BoomNoLineAnalyzer,
        'turbine': TurbineAnalyzer,
        'sonogram': SonogramAnalyzer,
        'rainbow': RainbowDashAnalyzer,
        'nyanalyzer': NyanalyzerCatAnalyzer,
        'none': NoAnalyzer
    },

    init(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');

        // Başlat all analyzers
        for (const key in this.analyzers) {
            this.analyzers[key].init(canvas);
        }

        // Set current analyzer
        this.setAnalyzer(VisualizerSettings.currentAnalyzer);
    },

    resize() {
        for (const key in this.analyzers) {
            if (this.analyzers[key].resize) {
                this.analyzers[key].resize();
            }
        }
    },

    setAnalyzer(type) {
        if (this.analyzers[type]) {
            this.currentAnalyzer = this.analyzers[type];
            VisualizerSettings.currentAnalyzer = type;
            VisualizerSettings.save();
            updateContextMenuState();
        }
    },

    analyze(spectrumData, isPlaying) {
        if (this.currentAnalyzer) {
            this.currentAnalyzer.analyze(spectrumData, isPlaying);
        }
    }
};

// ============================================
// GÖRSELLEŞTİRİCİ BAĞLAM MENÜSÜ
// ============================================
function setupVisualizerContextMenu() {
    const canvas = elements.visualizerCanvas;
    const contextMenu = document.getElementById('visualizerContextMenu');

    if (!canvas || !contextMenu) return;

    // Sağ tık işleyicisi
    canvas.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showContextMenu(e.clientX, e.clientY);
    });

    // Sol tık da menüyü açar (Qt sürümü gibi)
    canvas.addEventListener('click', (e) => {
        e.preventDefault();
        showContextMenu(e.clientX, e.clientY);
    });

    // Dışarı tıklanınca menüyü gizle
    document.addEventListener('click', (e) => {
        if (!contextMenu.contains(e.target) && e.target !== canvas) {
            hideContextMenu();
        }
    });

    // Analyzer türü seçimi
    contextMenu.querySelectorAll('[data-analyzer]').forEach(item => {
        item.addEventListener('click', () => {
            const type = item.dataset.analyzer;
            AnalyzerContainer.setAnalyzer(type);
            hideContextMenu();
        });
    });

    // FPS seçimi
    contextMenu.querySelectorAll('[data-framerate]').forEach(item => {
        item.addEventListener('click', () => {
            const fps = parseInt(item.dataset.framerate);
            VisualizerSettings.currentFramerate = fps;
            VisualizerSettings.save();
            updateContextMenuState();
            hideContextMenu();
        });
    });

    // Psikedelik aç/kapa
    const psychedelicToggle = document.getElementById('psychedelicToggle');
    if (psychedelicToggle) {
        psychedelicToggle.addEventListener('click', () => {
            VisualizerSettings.psychedelicEnabled = !VisualizerSettings.psychedelicEnabled;
            VisualizerSettings.save();
            updateContextMenuState();
        });
    }

    // Görsel efektler
    contextMenu.querySelectorAll('[data-visual]').forEach(item => {
        item.addEventListener('click', () => {
            const effect = item.dataset.visual;
            if (effect === 'glow') {
                VisualizerSettings.glowEnabled = !VisualizerSettings.glowEnabled;
            } else if (effect === 'reflection') {
                VisualizerSettings.reflectionEnabled = !VisualizerSettings.reflectionEnabled;
            }
            VisualizerSettings.save();
            updateContextMenuState();
        });
    });

    // Başlangıç durumu
    updateContextMenuState();
}

function showContextMenu(x, y) {
    const contextMenu = document.getElementById('visualizerContextMenu');
    if (!contextMenu) return;

    contextMenu.classList.remove('hidden');

    // Menüyü konumlandır
    const menuWidth = contextMenu.offsetWidth;
    const menuHeight = contextMenu.offsetHeight;
    const windowWidth = window.innerWidth;
    const windowHeight = window.innerHeight;

    // Menü ekrandan taşacaksa konumu ayarla
    if (x + menuWidth > windowWidth) {
        x = windowWidth - menuWidth - 10;
    }
    if (y + menuHeight > windowHeight) {
        y = windowHeight - menuHeight - 10;
    }

    contextMenu.style.left = x + 'px';
    contextMenu.style.top = y + 'px';
}

function hideContextMenu() {
    const contextMenu = document.getElementById('visualizerContextMenu');
    if (contextMenu) {
        contextMenu.classList.add('hidden');
    }
}

function updateContextMenuState() {
    const contextMenu = document.getElementById('visualizerContextMenu');
    if (!contextMenu) return;

    // Analyzer seçimini güncelle
    contextMenu.querySelectorAll('[data-analyzer]').forEach(item => {
        if (item.dataset.analyzer === VisualizerSettings.currentAnalyzer) {
            item.classList.add('active');
        } else {
            item.classList.remove('active');
        }
    });

    // FPS seçimini güncelle
    contextMenu.querySelectorAll('[data-framerate]').forEach(item => {
        if (parseInt(item.dataset.framerate) === VisualizerSettings.currentFramerate) {
            item.classList.add('active');
        } else {
            item.classList.remove('active');
        }
    });

    // Psikedelik aç/kapa güncelle
    const psychedelicToggle = document.getElementById('psychedelicToggle');
    if (psychedelicToggle) {
        if (VisualizerSettings.psychedelicEnabled) {
            psychedelicToggle.classList.add('checked');
        } else {
            psychedelicToggle.classList.remove('checked');
        }
    }

    // Görsel efektleri güncelle
    contextMenu.querySelectorAll('[data-visual]').forEach(item => {
        const effect = item.dataset.visual;
        let isEnabled = false;
        if (effect === 'glow') isEnabled = VisualizerSettings.glowEnabled;
        if (effect === 'reflection') isEnabled = VisualizerSettings.reflectionEnabled;

        if (isEnabled) {
            item.classList.add('checked');
        } else {
            item.classList.remove('checked');
        }
    });
}

function setupVisualizer() {
    const canvas = elements.visualizerCanvas;
    const ctx = canvas.getContext('2d');
    visualizerCtx = ctx;
    visualizerCanvasRef = canvas;

    // Ayarları yükle
    VisualizerSettings.load();

    // Canvas boyutunu ayarla
    function resizeCanvas() {
        canvas.width = canvas.offsetWidth;
        canvas.height = canvas.offsetHeight;
        AnalyzerContainer.resize();
    }
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    // Analyzer Container'ı başlat
    AnalyzerContainer.init(canvas);

    // Bağlam menüsünü kur
    setupVisualizerContextMenu();

    // C++ Audio Engine varsa ona bağlan, yoksa Web Audio API kullan
    if (useNativeAudio && window.aurivo && window.aurivo.audio) {
        console.log('🎵 C++ FFT verisi ile Analyzer Container başlatılıyor...');
        visualizerIsNative = true;
    } else {
        // Web Audio API kurulumu (fallback)
        try {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
            analyser = audioContext.createAnalyser();
            analyser.fftSize = 256;
            analyser.smoothingTimeConstant = 0.8;
            webAudioOutputGainNode = audioContext.createGain();

            if (!htmlAudioSourceNodeA) htmlAudioSourceNodeA = audioContext.createMediaElementSource(elements.audioA);
            if (!htmlAudioSourceNodeB) htmlAudioSourceNodeB = audioContext.createMediaElementSource(elements.audioB);

            htmlAudioSourceNodeA.connect(analyser);
            htmlAudioSourceNodeB.connect(analyser);
            analyser.connect(webAudioOutputGainNode);
            webAudioOutputGainNode.connect(audioContext.destination);
            setWebAudioOutputGainFromState();

            dataArray = new Uint8Array(analyser.frequencyBinCount);
            visualizerIsNative = false;
        } catch (e) {
            console.log('Visualizer başlatılamadı:', e);
            visualizerIsNative = false;
            analyser = null;
            webAudioOutputGainNode = null;
        }
    }

    document.addEventListener('visibilitychange', () => startVisualizerLoop());
    window.addEventListener('focus', () => startVisualizerLoop());
    window.addEventListener('blur', () => startVisualizerLoop());
    startVisualizerLoop();
}

// C++ Audio Engine FFT verisi ile görselleştirici
async function drawNativeVisualizerFrame() {
    try {
        let nativeIsPlaying = false;
        if (window.aurivo?.audio?.isPlaying) {
            try { nativeIsPlaying = !!(await window.aurivo.audio.isPlaying()); } catch { }
        }

        // C++ engine'den ham spectrum verisini al (master volume'dan bağımsız analiz stream)
        let spectrumData = [];
        if (window.aurivo?.audio?.spectrum?.getBands) {
            spectrumData = await window.aurivo.audio.spectrum.getBands(128);
        }
        spectrumData = normalizeSpectrumData(spectrumData);
        const isAudioMode = state.activeMedia === 'audio';
        const shouldAnimateNow = isAudioMode && (nativeIsPlaying || state.isPlaying);
        const releaseState = applyVisualizerReleaseFrame(spectrumData, shouldAnimateNow, isAudioMode);

        // Analyzer Container ile çiz
        AnalyzerContainer.analyze(releaseState.data, releaseState.animate);
    } catch (e) {
        // Hata durumunda idle bars çiz
        AnalyzerContainer.analyze(null, false);
    }
}

function drawVisualizerFrame() {
    if (!analyser) return;

    analyser.getByteFrequencyData(dataArray);

    // Uint8Array'i normalize diziye dönüştür
    const normalizedData = normalizeSpectrumData(Array.from(dataArray).map(v => v / 255));
    const activePlayer = getActiveAudioPlayer();
    const mediaPlaying = !!(activePlayer && !activePlayer.paused && !activePlayer.ended);
    const isAudioMode = state.activeMedia === 'audio';
    const shouldAnimateNow = isAudioMode && (mediaPlaying || state.isPlaying);
    const releaseState = applyVisualizerReleaseFrame(normalizedData, shouldAnimateNow, isAudioMode);
    AnalyzerContainer.analyze(releaseState.data, releaseState.animate);
}

function activateSettingsTab(tabName) {
    const name = String(tabName || '').trim();
    if (!name || !elements.settingsTabs?.length) return;
    const target = Array.from(elements.settingsTabs).find((tab) => tab.dataset.tab === name);
    if (target) {
        switchSettingsTab(target);
        return;
    }
    const fallback = Array.from(elements.settingsTabs).find((tab) => tab.dataset.tab === 'playback');
    if (fallback) switchSettingsTab(fallback);
}

function drawFallbackVisualizerFrame() {
    const fakeData = state.isPlaying
        ? Array.from({ length: 64 }, (_, i) =>
            (Math.sin(Date.now() / 200 + i * 0.3) * 0.5 + 0.5) * 0.6)
        : null;
    const isAudioMode = state.activeMedia === 'audio';
    const shouldAnimateNow = isAudioMode && state.isPlaying;
    const releaseState = applyVisualizerReleaseFrame(fakeData || [], shouldAnimateNow, isAudioMode);
    AnalyzerContainer.analyze(releaseState.data, releaseState.animate);
}

function applyVisualizerReleaseFrame(sourceData, shouldAnimateNow, isAudioMode) {
    if (!isAudioMode) {
        visualizerReleaseFrame = null;
        visualizerReleaseState = null;
        return { data: null, animate: false };
    }

    const nextSource = Array.isArray(sourceData) ? sourceData : [];
    if (shouldAnimateNow) {
        visualizerReleaseFrame = nextSource.slice();
        visualizerReleaseState = null;
        return { data: nextSource, animate: true };
    }

    if (!Array.isArray(visualizerReleaseFrame) || visualizerReleaseFrame.length === 0) {
        visualizerReleaseState = null;
        return { data: null, animate: false };
    }

    // Pause/stop sonrası: seviyeye bağlı serbest düşüş.
    // Sabit sürede zorla kesme yapma; tabana yaklaşınca bitir.
    const now = performance.now();
    if (!visualizerReleaseState) {
        visualizerReleaseState = {
            lastAt: now,
            zeroFeedFrames: 0,
            zeroFeedMaxFrames: 0
        };
    }

    const elapsed = Math.max(1, now - (visualizerReleaseState.lastAt || now));
    visualizerReleaseState.lastAt = now;

    // FPS değişse de benzer his için dt normalize et
    const dt = Math.max(0.5, Math.min(3, elapsed / 16.6667));
    const decayBase = 0.68; // daha hızlı doğal düşüş
    const decay = Math.pow(decayBase, dt);

    const released = visualizerReleaseFrame.map((v) => Math.max(0, Number(v) || 0) * decay);
    visualizerReleaseFrame = released;

    const peak = released.reduce((m, v) => (v > m ? v : m), 0);
    const cutoff = 0.00045;

    if (peak <= cutoff) {
        if (!visualizerReleaseState.zeroFeedMaxFrames) {
            const fps = Math.max(20, Number(VisualizerSettings?.currentFramerate) || 30);
            // Üst çizgiler ve barlar için daha uzun/akıcı kuyruk
            visualizerReleaseState.zeroFeedMaxFrames = Math.max(18, Math.min(72, Math.round(fps * 0.9)));
        }
        visualizerReleaseState.zeroFeedFrames += 1;
        // Veriyi bir anda 0'a çekme: son bölümde de kademeli düşüş devam etsin.
        visualizerReleaseFrame = released;
        if (visualizerReleaseState.zeroFeedFrames >= visualizerReleaseState.zeroFeedMaxFrames) {
            visualizerReleaseFrame = null;
            visualizerReleaseState = null;
            return { data: null, animate: false };
        }
        return { data: released, animate: true };
    }
    visualizerReleaseState.zeroFeedFrames = 0;
    visualizerReleaseState.zeroFeedMaxFrames = 0;

    return { data: released, animate: true };
}

function normalizeSpectrumData(spectrumData) {
    if (!spectrumData || !spectrumData.length) return [];

    let arr = Array.from(spectrumData, (v) => {
        const n = Number(v);
        return Number.isFinite(n) ? Math.max(0, n) : 0;
    });

    const noiseFloor = 0.004;
    arr = arr.map((v) => (v < noiseFloor ? 0 : v));

    const max = Math.max(...arr, 0);
    if (max <= 0) return arr.map(() => 0);

    // Native katmandan 0..255 gelebilir; analizörlerin beklediği 0..1 aralığına düşür.
    if (max > 1.5) {
        const scale = max > 255 ? max : 255;
        arr = arr.map((v) => v / scale);
    }

    // Dinamik gain: barlar çok kısa kalmasın ama sürekli full de olmasın.
    const peak01 = Math.max(...arr, 0);
    const targetPeak = 0.74;
    const dynamicGain = Math.min(24, Math.max(1, targetPeak / Math.max(peak01, 1e-6)));

    const len = arr.length || 1;
    return arr.map((v, i) => {
        // Tiz frekansları hafif öne çıkar (son bantlara doğru +%18).
        const hiTilt = 1 + (i / (len - 1 || 1)) * 0.18;
        const boosted = Math.min(1, v * dynamicGain * hiTilt);
        return Math.pow(boosted, 0.85);
    });
}

function renderVideoLibraryTree(renderToken = fileTreeRenderGeneration) {
    if (!elements.fileTree || !isActiveFileTreeRender(renderToken)) return;

    const videoItems = Array.isArray(state.videoFiles) ? state.videoFiles : [];
    const hasNowPlayingFocus = state.activeMedia === 'video' && state.isPlaying && state.currentVideoIndex >= 0;

    if (!resetFileTreeSurface(renderToken)) return;
    elements.fileTree.classList.add('video-library-mode');
    elements.fileTree.classList.toggle('has-playing-focus', hasNowPlayingFocus);

    if (!videoItems.length) {
        elements.fileTree.innerHTML = `
            <div class="video-library-empty">
                <div class="video-library-empty-title">Video yok</div>
                <div class="video-library-empty-hint">"Video Aç" ile dosya ekleyin</div>
            </div>
        `;
        return;
    }

    videoItems.forEach((video, index) => {
        const item = document.createElement('div');
        const isCurrent = index === state.currentVideoIndex;
        const isVideoCurrent = isCurrent && state.activeMedia === 'video';
        const isVideoPlaying = isVideoCurrent && state.isPlaying;
        const statusGlyph = isVideoCurrent ? (isVideoPlaying ? '❚❚' : '▶') : String(index + 1);
        const statusClass = isVideoCurrent ? 'video-lib-index playback-state' : 'video-lib-index';

        item.className = 'tree-item file video-library-item';
        if (isCurrent) item.classList.add('playing');
        if (isVideoCurrent && !isVideoPlaying) item.classList.add('is-paused');
        item.dataset.path = video.path;
        item.dataset.isDirectory = 'false';
        item.dataset.name = video.name || (window.aurivo?.path?.basename?.(video.path) || 'video');
        item.dataset.videoIndex = String(index);
        item.tabIndex = 0;
        item.innerHTML = `
            <span class="${statusClass}">${statusGlyph}</span>
            <span class="video-lib-icon">🎬</span>
            <span class="tree-name">${video.name || (window.aurivo?.path?.basename?.(video.path) || 'video')}</span>
        `;

        item.addEventListener('click', () => {
            document.querySelectorAll('.video-library-item').forEach(i => i.classList.remove('selected'));
            item.classList.add('selected');
        });

        item.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            playVideo(video.path);
        });

        item.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                playVideo(video.path);
            }
        });

        elements.fileTree.appendChild(item);
    });
}

// ============================================
// RAINBOW SLIDER - IŞIK DÖNGÜSÜ EFEKTİ
// ============================================
let rainbowHue = 0;
let rainbowAnimationId = null;
let rainbowLastFrameAt = 0;

function getSliderFxToggleChecked() {
    const toggle = document.getElementById('sliderFxToggle');
    if (toggle) return !!toggle.checked;
    return state.settings?.appearance?.sliderFxEnabled !== false;
}

function isSliderFxEnabledRuntime() {
    if (isStandaloneSettingsMode() || isPageVisible(elements.settingsPage)) {
        return getSliderFxToggleChecked();
    }
    return state.settings?.appearance?.sliderFxEnabled !== false;
}

function shouldAnimateRainbow() {
    if (document.hidden) return false;
    if (document.hasFocus && !document.hasFocus()) return false;
    if (!isSliderFxEnabledRuntime()) return false;
    return true;
}

function getRainbowAnimationIntervalMs() {
    if (isStandaloneSettingsMode() || isPageVisible(elements.settingsPage)) return 1000 / 8;
    if (state.activeMedia === 'audio' && state.isPlaying) return 1000 / 12;
    return 1000 / 6;
}

function stopRainbowAnimation() {
    if (rainbowAnimationId) {
        cancelAnimationFrame(rainbowAnimationId);
        rainbowAnimationId = null;
    }
}

function initializeRainbowSliders() {
    const seekSlider = document.getElementById('seekSlider') || elements.seekSlider;
    const volumeSlider = document.getElementById('volumeSlider') || elements.volumeSlider;
    const fsSeekSlider = document.getElementById('fsSeekSlider');
    const fsVolumeSlider = document.getElementById('fsVolumeSlider');

    // Başlangıç değerleriyle slider'ları güncelle
    if (seekSlider) updateRainbowSlider(seekSlider, 0);
    if (volumeSlider) updateRainbowSlider(volumeSlider, state.volume);

    // Tam ekran slider'ları da başlat
    if (fsSeekSlider) updateRainbowSlider(fsSeekSlider, 0);
    if (fsVolumeSlider) updateRainbowSlider(fsVolumeSlider, state.volume);

    applySliderFxModeToAll();
    if (state.settings?.appearance?.sliderFxEnabled !== false) {
        startRainbowAnimation();
    } else {
        stopRainbowAnimation();
    }
}

function startRainbowAnimation() {
    stopRainbowAnimation();
    function animateRainbow() {
        if (!shouldAnimateRainbow()) {
            rainbowAnimationId = null;
            return;
        }
        const now = performance.now();
        const intervalMs = getRainbowAnimationIntervalMs();
        if (now - rainbowLastFrameAt < intervalMs) {
            rainbowAnimationId = requestAnimationFrame(animateRainbow);
            return;
        }
        rainbowLastFrameAt = now;
        rainbowHue = (rainbowHue + 1) % 360;

        const seekSlider = document.getElementById('seekSlider') || elements.seekSlider;
        const volumeSlider = document.getElementById('volumeSlider') || elements.volumeSlider;
        const fsSeekSlider = document.getElementById('fsSeekSlider');
        const fsVolumeSlider = document.getElementById('fsVolumeSlider');

        // Seek slider - mevcut değeriyle güncelle
        if (seekSlider) {
            const seekPercent = (Number(seekSlider.value) / Math.max(1, Number(seekSlider.max) || 1)) * 100;
            updateRainbowSliderColors(seekSlider, seekPercent);
        }

        // Ses Seviyesi slider - mevcut değeriyle güncelle
        if (volumeSlider) {
            const volumePercent = Number(volumeSlider.value) || 0;
            updateRainbowSliderColors(volumeSlider, volumePercent);
        }

        // TAM EKRAN SLIDER'LAR - aynı rainbow efekti
        if (fsSeekSlider) {
            const fsSeekPercent = (fsSeekSlider.value / fsSeekSlider.max) * 100;
            updateRainbowSliderColors(fsSeekSlider, fsSeekPercent);
        }

        if (fsVolumeSlider) {
            const fsVolumePercent = fsVolumeSlider.value;
            updateRainbowSliderColors(fsVolumeSlider, fsVolumePercent);
        }

        rainbowAnimationId = requestAnimationFrame(animateRainbow);
    }
    rainbowLastFrameAt = 0;
    animateRainbow();
    console.log('🌈 Rainbow animasyon başlatıldı - tam ekran slider\'lar dahil');
}

function updateRainbowSlider(slider, percent) {
    updateRainbowSliderColors(slider, percent);
}

function updateRainbowSliderColors(slider, percent) {
    if (!slider) return;
    const safePercent = Math.max(0, Math.min(100, Number(percent) || 0));
    const sliderFxOff = !isSliderFxEnabledRuntime();
    if (sliderFxOff) {
        const isRtl = document?.documentElement?.dir === 'rtl' || document?.body?.classList?.contains('rtl');
        const emptyColor = 'rgba(40, 40, 40, 0.25)';
        const fixedBlue = '#22d3ee';
        const fixedBlueSoft = '#67e8f9';
        const gradientDir = isRtl ? 'to left' : 'to right';
        const trackBackground = `linear-gradient(${gradientDir},
            ${fixedBlue} 0%,
            ${fixedBlueSoft} ${safePercent}%,
            ${emptyColor} ${safePercent}%,
            ${emptyColor} 100%)`;
        slider.style.background = trackBackground;
        slider.style.setProperty('--slider-track', trackBackground);
        slider.style.setProperty('--thumb-color', fixedBlueSoft);
        slider.style.setProperty('--thumb-glow', fixedBlue);
        slider.style.accentColor = fixedBlueSoft;
        return;
    }

    const isRtl = document?.documentElement?.dir === 'rtl' || document?.body?.classList?.contains('rtl');
    // Gökkuşağı renkleri - hue değerine göre dönen
    const colors = [
        `hsl(${(rainbowHue + 0) % 360}, 100%, 50%)`,
        `hsl(${(rainbowHue + 40) % 360}, 100%, 50%)`,
        `hsl(${(rainbowHue + 80) % 360}, 100%, 50%)`,
        `hsl(${(rainbowHue + 120) % 360}, 100%, 50%)`,
        `hsl(${(rainbowHue + 160) % 360}, 100%, 50%)`,
        `hsl(${(rainbowHue + 200) % 360}, 100%, 50%)`
    ];

    // SOL TARAF (0'dan percent'e kadar) = Işiklı rainbow
    // SAĞ TARAF (percent'den 100'e kadar) = Yarı saydam koyu
    const emptyColor = 'rgba(40, 40, 40, 0.25)';

    // Background: Sol kısım renkli gradient, sağ kısım saydam
    const gradientDir = isRtl ? 'to left' : 'to right';
    const trackBackground = `linear-gradient(${gradientDir}, 
        ${colors[0]} 0%, 
        ${colors[1]} ${safePercent * 0.2}%, 
        ${colors[2]} ${safePercent * 0.4}%, 
        ${colors[3]} ${safePercent * 0.6}%, 
        ${colors[4]} ${safePercent * 0.8}%, 
        ${colors[5]} ${safePercent}%, 
        ${emptyColor} ${safePercent}%, 
        ${emptyColor} 100%)`;

    slider.style.background = trackBackground;
    slider.style.setProperty('--slider-track', trackBackground);

    // Thumb için parlak renk
    const thumbColor = `hsl(${(rainbowHue + 60) % 360}, 100%, 60%)`;
    const thumbGlow = `hsl(${(rainbowHue + 60) % 360}, 100%, 50%)`;
    slider.style.setProperty('--thumb-color', thumbColor);
    slider.style.setProperty('--thumb-glow', thumbGlow);
    slider.style.accentColor = thumbColor;
}

function applySliderFxModeToAll() {
    const seekSlider = document.getElementById('seekSlider') || elements.seekSlider;
    const volumeSlider = document.getElementById('volumeSlider') || elements.volumeSlider;
    const fsSeekSlider = document.getElementById('fsSeekSlider');
    const fsVolumeSlider = document.getElementById('fsVolumeSlider');

    if (seekSlider) {
        const seekPercent = (Number(seekSlider.value) / Math.max(1, Number(seekSlider.max) || 1)) * 100;
        updateRainbowSliderColors(seekSlider, seekPercent);
    }
    if (volumeSlider) {
        updateRainbowSliderColors(volumeSlider, Number(volumeSlider.value) || 0);
    }
    if (fsSeekSlider) {
        const fsSeekPercent = (Number(fsSeekSlider.value) / Math.max(1, Number(fsSeekSlider.max) || 1)) * 100;
        updateRainbowSliderColors(fsSeekSlider, fsSeekPercent);
    }
    if (fsVolumeSlider) {
        updateRainbowSliderColors(fsVolumeSlider, Number(fsVolumeSlider.value) || 0);
    }
}

// ============================================
// 32-BANT EQUALIZER DENETLEYİCİSİ
// Profesyonel Audio EQ Sistemi
// ============================================

const EQController = {
    // 32 bant frekansları (20Hz - 20kHz logaritmik)
    frequencies: [
        20, 25, 31, 40, 50, 63, 80, 100,
        125, 160, 200, 250, 315, 400, 500, 630,
        800, 1000, 1250, 1600, 2000, 2500, 3150, 4000,
        5000, 6300, 8000, 10000, 12500, 16000, 18000, 20000
    ],

    // Mevcut bant değerleri (dB)
    bands: new Array(32).fill(0),

    // Ayarlar
    enabled: true,
    autoGain: true,
    preamp: 0,
    masterVolume: 100,
    bassBoost: 0,

    // UI Elemanları
    elements: {
        modal: null,
        bandsContainer: null,
        sliders: [],
        preampSlider: null,
        volumeSlider: null,
        bassKnob: null,
        presetSelect: null,
        enableToggle: null,
        autoGainToggle: null,
        clippingLed: null,
        levelBars: []
    },

    // Factory Presets - Doğru frekans aralıklarına göre ayarlanmış
    // Frequencies: [20, 25, 31, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1k, 1.25k, 1.6k, 2k, 2.5k, 3.15k, 4k, 5k, 6.3k, 8k, 10k, 12.5k, 16k, 18k, 20k]
    factoryPresets: {
        flat: {
            name: 'Flat (Düz)',
            description: 'Tüm bantlar nötr',
            bands: new Array(32).fill(0),
            bassBoost: 0,
            preamp: 0
        },
        bass_boost: {
            name: 'Bass Boost',
            description: '20-100Hz +6dB, 125-250Hz +3dB',
            // 20Hz-100Hz: +6dB (index 0-7), 125Hz-250Hz: +3dB (index 8-11), rest: 0
            bands: [6, 6, 6, 6, 6, 6, 6, 6, 3, 3, 3, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            bassBoost: 50,
            preamp: -2
        },
        treble_boost: {
            name: 'Treble Boost',
            description: '4kHz-20kHz +5dB',
            // 4kHz-20kHz: +5dB (index 23-31)
            bands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 5, 5, 5, 5, 5, 5, 5, 5, 5],
            bassBoost: 0,
            preamp: -1
        },
        rock: {
            name: 'Rock',
            description: 'Bass +4dB, mid-low -2dB, mid-high +3dB, treble +4dB',
            // Bass (20-100Hz): +4, mid-low (125-500Hz): -2, mid-high (630Hz-2kHz): +3, treble (2.5k+): +4
            bands: [4, 4, 4, 4, 4, 4, 4, 4, -2, -2, -2, -2, -2, -2, -2, -2, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4, 4, 4, 3, 3],
            bassBoost: 25,
            preamp: -1
        },
        pop: {
            name: 'Pop',
            description: 'Bass +3dB, mid +2dB, treble +2dB',
            // Bass (20-100Hz): +3, mid (125Hz-4kHz): +2, treble (5k+): +2
            bands: [3, 3, 3, 3, 3, 3, 3, 3, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 1, 1],
            bassBoost: 20,
            preamp: -1
        },
        classical: {
            name: 'Klasik',
            description: 'Doğal akustik: Bass 0dB, mid +2dB, treble +3dB',
            // Bass (20-100Hz): 0, mid (125Hz-2kHz): +2, treble (2.5k+): +3
            bands: [0, 0, 0, 0, 0, 0, 0, 0, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3, 3, 3, 2, 2],
            bassBoost: 0,
            preamp: 0
        },
        jazz: {
            name: 'Jazz',
            description: 'Bass +2dB, mid-low +3dB, mid-high -1dB, treble +2dB',
            // Bass (20-100Hz): +2, mid-low (125-500Hz): +3, mid-high (630Hz-2kHz): -1, treble (2.5k+): +2
            bands: [2, 2, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3, 3, -1, -1, -1, -1, -1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2],
            bassBoost: 15,
            preamp: 0
        },
        vocal: {
            name: 'Vokal',
            description: '200Hz-2kHz +3dB (insan sesi frekansları)',
            // 200Hz-2kHz: +3dB (index 10-20)
            bands: [-2, -2, -2, -2, -1, -1, 0, 0, 1, 2, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 2, 1, 0, -1, -1, -1, -2, -2, -2, -2, -2],
            bassBoost: 5,
            preamp: 0
        },
        electronic: {
            name: 'Elektronik',
            description: 'Güçlü bass, parlak treble',
            bands: [6, 6, 5, 5, 4, 4, 3, 2, 0, 0, 0, 1, 1, 2, 2, 1, 0, 0, 0, 1, 2, 3, 4, 5, 5, 5, 5, 5, 5, 5, 4, 4],
            bassBoost: 60,
            preamp: -2
        },
        hiphop: {
            name: 'Hip-Hop',
            description: 'Derin bass, net vokal',
            bands: [7, 6, 6, 5, 5, 4, 3, 2, 0, 0, 1, 1, 2, 2, 2, 2, 2, 2, 2, 1, 1, 2, 2, 3, 3, 3, 3, 3, 3, 3, 2, 2],
            bassBoost: 65,
            preamp: -2
        },
        loudness: {
            name: 'Loudness',
            description: 'Düşük seslerde bass ve treble artışı',
            bands: [5, 5, 4, 4, 3, 3, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 4, 4, 5, 5, 5, 5, 5, 4, 4],
            bassBoost: 40,
            preamp: -1
        },
        acoustic: {
            name: 'Akustik',
            description: 'Doğal enstrüman sesleri',
            bands: [1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 2, 2, 2, 1, 1],
            bassBoost: 10,
            preamp: 0
        },
        spoken_word: {
            name: 'Konuşma/Podcast',
            description: 'Net konuşma, azaltılmış bass',
            bands: [-4, -4, -3, -3, -2, -2, -1, 0, 2, 3, 4, 4, 4, 4, 4, 4, 4, 4, 3, 2, 1, 0, 0, -1, -1, -2, -2, -3, -3, -3, -3, -3],
            bassBoost: 0,
            preamp: 2
        }
    },

    // Custom presets (localStorage'dan yüklenir)
    customPresets: {},

    // Mevcut preset takibi
    currentPreset: 'flat',

    // Geriye uyumluluk için eski alias
    get presets() {
        return { ...this.factoryPresets, ...this.customPresets };
    },

    // EQ denetleyicisini başlat
    init() {
        this.cacheElements();
        this.loadCustomPresets(); // Yükle custom presets first
        this.createBandSliders();
        this.populatePresetSelect(); // Populate dropdown
        this.setupEventListeners();
        this.setupPresetManagerListeners();
        this.loadSettings();
        this.initKnobs();
        console.log('🎚️ EQ Controller initialized');
    },

    // DOM elemanlarını önbellekle
    cacheElements() {
        this.elements.modal = document.getElementById('eqModal');
        this.elements.bandsContainer = document.getElementById('eqBands');
        this.elements.preampSlider = document.getElementById('preampSlider');
        this.elements.volumeSlider = document.getElementById('masterVolumeSlider');
        this.elements.presetSelect = document.getElementById('eqPresetSelect');
        this.elements.enableToggle = document.getElementById('eqEnableToggle');
        this.elements.autoGainToggle = document.getElementById('autoGainToggle');
        this.elements.clippingLed = document.querySelector('.clip-led');
        this.elements.levelBars = document.querySelectorAll('.level-bar');
        this.elements.bassKnobContainer = document.getElementById('bassBoostKnob');
        this.elements.bassKnobCanvas = document.getElementById('bassBoostCanvas');
        this.elements.bassKnobValue = document.getElementById('bassBoostValue');
        this.elements.eqButton = document.querySelector('.eq-btn-player');

        // Preset yöneticisi elemanları
        this.elements.savePresetModal = document.getElementById('savePresetModal');
        this.elements.presetManagerModal = document.getElementById('presetManagerModal');
        this.elements.presetNameInput = document.getElementById('presetName');
        this.elements.presetDescInput = document.getElementById('presetDescription');
        this.elements.factoryPresetList = document.getElementById('factoryPresetList');
        this.elements.customPresetList = document.getElementById('customPresetList');
    },

    // Özel presetleri localStorage'dan yükle
    loadCustomPresets() {
        try {
            const saved = localStorage.getItem('aurivo_custom_presets');
            if (saved) {
                this.customPresets = JSON.parse(saved);
                console.log(`📂 ${Object.keys(this.customPresets).length} özel preset yüklendi`);
            }
        } catch (e) {
            console.error('Custom presets yüklenemedi:', e);
            this.customPresets = {};
        }
    },

    // Özel presetleri localStorage'a kaydet
    saveCustomPresets() {
        try {
            localStorage.setItem('aurivo_custom_presets', JSON.stringify(this.customPresets));
        } catch (e) {
            console.error('Custom presets kaydedilemedi:', e);
        }
    },

    // Preset seçim açılır listesini doldur
    populatePresetSelect() {
        if (!this.elements.presetSelect) return;

        this.elements.presetSelect.innerHTML = '';

        // Fabrika preset grubu
        const factoryGroup = document.createElement('optgroup');
        factoryGroup.label = '🏭 Fabrika Presetleri';

        Object.entries(this.factoryPresets).forEach(([key, preset]) => {
            const option = document.createElement('option');
            option.value = key;
            option.textContent = preset.name;
            option.title = preset.description || '';
            factoryGroup.appendChild(option);
        });

        this.elements.presetSelect.appendChild(factoryGroup);

        // Özel presetler group (if any)
        const customKeys = Object.keys(this.customPresets);
        if (customKeys.length > 0) {
            const customGroup = document.createElement('optgroup');
            customGroup.label = '⭐ Özel Presetler';

            customKeys.forEach(key => {
                const preset = this.customPresets[key];
                const option = document.createElement('option');
                option.value = key;
                option.textContent = preset.name;
                option.title = preset.description || '';
                option.dataset.custom = 'true';
                customGroup.appendChild(option);
            });

            this.elements.presetSelect.appendChild(customGroup);
        }

        // Mevcut seçimi ayarla
        if (this.currentPreset) {
            this.elements.presetSelect.value = this.currentPreset;
        }
    },

    // 32 bant slider'larını oluştur
    createBandSliders() {
        if (!this.elements.bandsContainer) return;

        this.elements.bandsContainer.innerHTML = '';
        this.elements.sliders = [];

        this.frequencies.forEach((freq, index) => {
            const band = document.createElement('div');
            band.className = 'eq-band';
            band.dataset.index = index;

            // Değer gösterimi
            const valueDiv = document.createElement('div');
            valueDiv.className = 'eq-band-value';
            valueDiv.textContent = '0';

            // Slider
            const slider = document.createElement('input');
            slider.type = 'range';
            slider.className = 'eq-band-slider';
            slider.min = -12;
            slider.max = 12;
            slider.step = 0.5;
            slider.value = this.bands[index];
            slider.dataset.index = index;

            // Frekans etiketi
            const freqLabel = document.createElement('div');
            freqLabel.className = 'eq-band-freq';
            freqLabel.textContent = this.formatFrequency(freq);

            band.appendChild(valueDiv);
            band.appendChild(slider);
            band.appendChild(freqLabel);
            this.elements.bandsContainer.appendChild(band);

            this.elements.sliders.push({ slider, valueDiv, band });
        });
    },

    // Görüntü için frekansı biçimlendir
    formatFrequency(freq) {
        if (freq >= 1000) {
            return (freq / 1000).toFixed(freq >= 10000 ? 0 : 1) + 'k';
        }
        return freq.toString();
    },

    // Event listener'ları kur
    setupEventListeners() {
        // EQ button to open Sound Effects window
        if (this.elements.eqButton) {
            this.elements.eqButton.addEventListener('click', () => {
                // Yeni Ses Efektleri penceresini aç
                if (window.aurivo && window.aurivo.soundEffects) {
                    window.aurivo.soundEffects.openWindow();
                    console.log('🎛️ Ses Efektleri penceresi açılıyor...');
                } else {
                    // Fallback: Eski modal'ı aç
                    this.toggleModal();
                }
            });
        }

        // Bant slider'ları
        this.elements.sliders.forEach(({ slider, valueDiv, band }, index) => {
            slider.addEventListener('input', (e) => {
                const value = parseFloat(e.target.value);
                this.setBand(index, value);
                valueDiv.textContent = value > 0 ? `+${value}` : value;

                // Güncelle band class
                band.classList.remove('positive', 'negative');
                if (value > 0) band.classList.add('positive');
                if (value < 0) band.classList.add('negative');
            });

            slider.addEventListener('mouseenter', () => band.classList.add('active'));
            slider.addEventListener('mouseleave', () => band.classList.remove('active'));

            // Çift tık ile sıfırla
            slider.addEventListener('dblclick', () => {
                slider.value = 0;
                this.setBand(index, 0);
                valueDiv.textContent = '0';
                band.classList.remove('positive', 'negative');
            });
        });

        // Preamp slider'ı
        if (this.elements.preampSlider) {
            this.elements.preampSlider.addEventListener('input', (e) => {
                const value = parseFloat(e.target.value);
                this.setPreamp(value);
                const valueDisplay = document.getElementById('preampValue');
                if (valueDisplay) {
                    valueDisplay.textContent = (value > 0 ? '+' : '') + value + ' dB';
                }
            });
        }

        // Master volume slider'ı
        if (this.elements.volumeSlider) {
            this.elements.volumeSlider.addEventListener('input', (e) => {
                const value = parseFloat(e.target.value);
                this.setMasterVolume(value);
                const valueDisplay = document.getElementById('masterVolumeValue');
                if (valueDisplay) {
                    valueDisplay.textContent = value + '%';
                }
            });
        }

        // Preset seçimi
        if (this.elements.presetSelect) {
            this.elements.presetSelect.addEventListener('change', (e) => {
                this.applyPreset(e.target.value);
            });
        }

        // Etkinleştirme aç/kapa
        if (this.elements.enableToggle) {
            this.elements.enableToggle.addEventListener('change', (e) => {
                this.enabled = e.target.checked;
                this.updateEQState();
            });
        }

        // Auto-gain aç/kapa
        if (this.elements.autoGainToggle) {
            this.elements.autoGainToggle.addEventListener('change', (e) => {
                this.autoGain = e.target.checked;
                this.updateAutoGain();
            });
        }

        // Sıfırla butonu
        const resetBtn = document.getElementById('resetEQBtn');
        if (resetBtn) {
            resetBtn.addEventListener('click', () => this.resetAll());
        }

        // Preset kaydet butonu (alt kısım)
        const savePresetBtn = document.getElementById('eqSavePreset');
        if (savePresetBtn) {
            savePresetBtn.addEventListener('click', () => this.openSavePresetModal());
        }

        // Presetleri yönet butonu
        const managePresetsBtn = document.getElementById('eqManagePresets');
        if (managePresetsBtn) {
            managePresetsBtn.addEventListener('click', () => this.openPresetManager());
        }

        // Kapat butonu
        const closeBtn = document.getElementById('closeEQ');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => this.closeModal());
        }

        // Kapat butonu (footer)
        const closeFooterBtn = document.getElementById('eqClose');
        if (closeFooterBtn) {
            closeFooterBtn.addEventListener('click', () => this.closeModal());
        }

        // Arka plana tıklayınca kapat
        if (this.elements.modal) {
            this.elements.modal.addEventListener('click', (e) => {
                if (e.target === this.elements.modal) {
                    this.closeModal();
                }
            });
        }

        // Klavye kısayolları
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                if (this.elements.savePresetModal?.classList.contains('active')) {
                    this.closeSavePresetModal();
                } else if (this.elements.presetManagerModal?.classList.contains('active')) {
                    this.closePresetManager();
                } else if (this.elements.modal?.classList.contains('active')) {
                    this.closeModal();
                }
            }
            if (e.key === 'e' && e.ctrlKey) {
                e.preventDefault();
                this.toggleModal();
            }
        });
    },

    // Preset yöneticisi event listener'larını kur
    setupPresetManagerListeners() {
        // Preset kaydet modalı
        const closeSavePreset = document.getElementById('closeSavePreset');
        if (closeSavePreset) {
            closeSavePreset.addEventListener('click', () => this.closeSavePresetModal());
        }

        const cancelSavePreset = document.getElementById('cancelSavePreset');
        if (cancelSavePreset) {
            cancelSavePreset.addEventListener('click', () => this.closeSavePresetModal());
        }

        const confirmSavePreset = document.getElementById('confirmSavePreset');
        if (confirmSavePreset) {
            confirmSavePreset.addEventListener('click', () => this.saveCustomPreset());
        }

        // Preset yöneticisi modalı
        const closePresetManager = document.getElementById('closePresetManager');
        if (closePresetManager) {
            closePresetManager.addEventListener('click', () => this.closePresetManager());
        }

        const closePresetManagerBtn = document.getElementById('closePresetManagerBtn');
        if (closePresetManagerBtn) {
            closePresetManagerBtn.addEventListener('click', () => this.closePresetManager());
        }

        // Sekme değiştirme
        document.querySelectorAll('.preset-tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                const targetTab = e.target.dataset.tab;
                this.switchPresetTab(targetTab);
            });
        });

        // Dışa aktar/İçe aktar butonları
        const exportBtn = document.getElementById('exportPresets');
        if (exportBtn) {
            exportBtn.addEventListener('click', () => this.exportPresets());
        }

        const importBtn = document.getElementById('importPresets');
        if (importBtn) {
            importBtn.addEventListener('click', () => document.getElementById('importFile')?.click());
        }

        const importFile = document.getElementById('importFile');
        if (importFile) {
            importFile.addEventListener('change', (e) => this.importPresets(e));
        }

        // Modal arka plan tıklamaları
        if (this.elements.savePresetModal) {
            this.elements.savePresetModal.addEventListener('click', (e) => {
                if (e.target === this.elements.savePresetModal) {
                    this.closeSavePresetModal();
                }
            });
        }

        if (this.elements.presetManagerModal) {
            this.elements.presetManagerModal.addEventListener('click', (e) => {
                if (e.target === this.elements.presetManagerModal) {
                    this.closePresetManager();
                }
            });
        }
    },

    // Knobları başlat (bass boost, etc.)
    initKnobs() {
        if (!this.elements.bassKnobCanvas) {
            console.log('Bass knob canvas bulunamadı');
            return;
        }

        const canvas = this.elements.bassKnobCanvas;
        if (typeof canvas.getContext !== 'function') {
            console.error('bassKnobCanvas geçerli bir canvas değil:', canvas);
            return;
        }

        const ctx = canvas.getContext('2d');
        if (!ctx) {
            console.error('Canvas context alınamadı');
            return;
        }

        // Başlangıç durumunu çiz
        this.drawKnob(ctx, canvas, this.bassBoost / 100);

        // Knob etkileşimi
        let isDragging = false;
        let startY = 0;
        let startValue = 0;

        canvas.addEventListener('mousedown', (e) => {
            isDragging = true;
            startY = e.clientY;
            startValue = this.bassBoost;
            canvas.style.cursor = 'grabbing';
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;

            const delta = (startY - e.clientY) * 0.5;
            let newValue = Math.max(0, Math.min(100, startValue + delta));
            this.setBassBoost(newValue);
            this.drawKnob(ctx, canvas, newValue / 100);

            if (this.elements.bassKnobValue) {
                this.elements.bassKnobValue.textContent = Math.round(newValue) + '%';
            }
        });

        document.addEventListener('mouseup', () => {
            if (isDragging) {
                isDragging = false;
                canvas.style.cursor = 'pointer';
            }
        });

        // Ayarlamak için kaydır
        canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            const delta = e.deltaY > 0 ? -2 : 2;
            let newValue = Math.max(0, Math.min(100, this.bassBoost + delta));
            this.setBassBoost(newValue);
            this.drawKnob(ctx, canvas, newValue / 100);

            if (this.elements.bassKnobValue) {
                this.elements.bassKnobValue.textContent = Math.round(newValue) + '%';
            }
        });
    },

    // Döner knob çiz
    drawKnob(ctx, canvas, value) {
        const size = canvas.width;
        const center = size / 2;
        const radius = size * 0.35;

        // Clear
        ctx.clearRect(0, 0, size, size);

        // Arka plan halkası
        ctx.beginPath();
        ctx.arc(center, center, radius + 8, 0.75 * Math.PI, 2.25 * Math.PI);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
        ctx.lineWidth = 6;
        ctx.lineCap = 'round';
        ctx.stroke();

        // Değer yayı
        const startAngle = 0.75 * Math.PI;
        const endAngle = startAngle + (1.5 * Math.PI * value);

        const gradient = ctx.createLinearGradient(0, size, size, 0);
        gradient.addColorStop(0, '#00d9ff');
        gradient.addColorStop(0.5, '#00aaff');
        gradient.addColorStop(1, '#0066ff');

        ctx.beginPath();
        ctx.arc(center, center, radius + 8, startAngle, endAngle);
        ctx.strokeStyle = gradient;
        ctx.lineWidth = 6;
        ctx.lineCap = 'round';
        ctx.stroke();

        // Knob gövdesi
        const knobGradient = ctx.createRadialGradient(
            center - 5, center - 5, 0,
            center, center, radius
        );
        knobGradient.addColorStop(0, '#3a3a4a');
        knobGradient.addColorStop(0.5, '#2a2a3a');
        knobGradient.addColorStop(1, '#1a1a2a');

        ctx.beginPath();
        ctx.arc(center, center, radius, 0, Math.PI * 2);
        ctx.fillStyle = knobGradient;
        ctx.fill();

        // Knob kenarlığı
        ctx.beginPath();
        ctx.arc(center, center, radius, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
        ctx.lineWidth = 1;
        ctx.stroke();

        // Gösterge çizgisi
        const angle = startAngle + (1.5 * Math.PI * value);
        const lineStart = radius * 0.4;
        const lineEnd = radius * 0.8;

        ctx.beginPath();
        ctx.moveTo(
            center + Math.cos(angle) * lineStart,
            center + Math.sin(angle) * lineStart
        );
        ctx.lineTo(
            center + Math.cos(angle) * lineEnd,
            center + Math.sin(angle) * lineEnd
        );
        ctx.strokeStyle = '#00d9ff';
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.stroke();

        // Parlama efekti
        ctx.shadowColor = '#00d9ff';
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.arc(
            center + Math.cos(angle) * lineEnd,
            center + Math.sin(angle) * lineEnd,
            3, 0, Math.PI * 2
        );
        ctx.fillStyle = '#00d9ff';
        ctx.fill();
        ctx.shadowBlur = 0;
    },

    // Bireysel bandı ayarla
    setBand(index, value) {
        this.bands[index] = value;

        // Native audio varsa çağır
        if (window.audioAPI?.eq?.setBand) {
            try {
                window.audioAPI.eq.setBand(index, value);
            } catch (e) {
                console.warn('Native EQ not available:', e);
            }
        }
    },

    // Preamp'ı ayarla
    setPreamp(value) {
        this.preamp = value;
        if (window.audioAPI?.preamp?.set) {
            try {
                window.audioAPI.preamp.set(value);
            } catch (e) {
                console.warn('Native preamp not available:', e);
            }
        }
    },

    // Master volume'u ayarla
    setMasterVolume(value) {
        this.masterVolume = value;
        if (window.audioAPI?.setMasterVolume) {
            try {
                window.audioAPI.setMasterVolume(value);
            } catch (e) {
                console.warn('Native volume not available:', e);
            }
        }
    },

    // Bass boost'u ayarla
    setBassBoost(value) {
        this.bassBoost = value;
        if (window.audioAPI?.bass?.setBoost) {
            try {
                window.audioAPI.bass.setBoost(value);
            } catch (e) {
                console.warn('Native bass boost not available:', e);
            }
        }
    },

    // Preset uygula
    applyPreset(presetKey) {
        const preset = this.presets[presetKey];
        if (!preset) return;

        // Band değerlerini uygula
        preset.bands.forEach((value, index) => {
            this.bands[index] = value;

            const sliderData = this.elements.sliders[index];
            if (sliderData) {
                sliderData.slider.value = value;
                sliderData.valueDiv.textContent = value > 0 ? `+${value}` : value;

                sliderData.band.classList.remove('positive', 'negative');
                if (value > 0) sliderData.band.classList.add('positive');
                if (value < 0) sliderData.band.classList.add('negative');
            }

            this.setBand(index, value);
        });

        // Bass boost uygula
        this.setBassBoost(preset.bassBoost);
        if (this.elements.bassKnobCanvas) {
            const ctx = this.elements.bassKnobCanvas.getContext('2d');
            this.drawKnob(ctx, this.elements.bassKnobCanvas, preset.bassBoost / 100);
        }
        const bassValue = document.getElementById('bassBoostValue');
        if (bassValue) bassValue.textContent = preset.bassBoost + '%';

        console.log(`🎵 Applied preset: ${preset.name}`);
    },

    // Hepsini düz yap (flat)
    resetAll() {
        // Bandları sıfırla
        this.bands = new Array(32).fill(0);
        this.elements.sliders.forEach(({ slider, valueDiv, band }) => {
            slider.value = 0;
            valueDiv.textContent = '0';
            band.classList.remove('positive', 'negative');
        });

        // Sliderları sıfırla
        if (this.elements.preampSlider) {
            this.elements.preampSlider.value = 0;
            document.getElementById('preampValue').textContent = '0 dB';
        }

        if (this.elements.volumeSlider) {
            this.elements.volumeSlider.value = 100;
            document.getElementById('masterVolumeValue').textContent = '100%';
        }

        // Bass'ı sıfırla
        this.bassBoost = 0;
        if (this.elements.bassKnobCanvas) {
            const ctx = this.elements.bassKnobCanvas.getContext('2d');
            this.drawKnob(ctx, this.elements.bassKnobCanvas, 0);
        }
        document.getElementById('bassBoostValue').textContent = '0%';

        // Preset seçimini sıfırla
        if (this.elements.presetSelect) {
            this.elements.presetSelect.value = 'flat';
        }

        // Native'a uygula
        this.bands.forEach((v, i) => this.setBand(i, 0));
        this.setPreamp(0);
        this.setMasterVolume(100);
        this.setBassBoost(0);

        console.log('🎚️ EQ reset to flat');
    },

    // EQ etkin durumunu güncelle
    updateEQState() {
        if (window.audioAPI?.eq?.setEnabled) {
            try {
                window.audioAPI.eq.setEnabled(this.enabled);
            } catch (e) {
                console.warn('Could not set EQ state:', e);
            }
        }

        if (this.elements.eqButton) {
            this.elements.eqButton.classList.toggle('active', this.enabled);
        }
    },

    // Auto-gain durumunu güncelle
    updateAutoGain() {
        if (window.audioAPI?.setAutoGain) {
            try {
                window.audioAPI.setAutoGain(this.autoGain);
            } catch (e) {
                console.warn('Could not set auto-gain:', e);
            }
        }
    },

    // Modal aç/kapa
    toggleModal() {
        if (this.elements.modal?.classList.contains('active')) {
            this.closeModal();
        } else {
            this.openModal();
        }
    },

    // Modal aç
    openModal() {
        if (this.elements.modal) {
            this.elements.modal.classList.remove('hidden');
            this.elements.modal.classList.add('active');
            // Başlat knob with current value
            if (this.elements.bassKnobCanvas) {
                const ctx = this.elements.bassKnobCanvas.getContext('2d');
                this.drawKnob(ctx, this.elements.bassKnobCanvas, this.bassBoost / 100);
            }
        }
    },

    // Modal kapat
    closeModal() {
        if (this.elements.modal) {
            this.elements.modal.classList.remove('active');
            this.elements.modal.classList.add('hidden');
        }
    },

    // Ayarları localStorage'a kaydet
    saveSettings() {
        const settings = {
            bands: this.bands,
            preamp: this.preamp,
            masterVolume: this.masterVolume,
            bassBoost: this.bassBoost,
            enabled: this.enabled,
            autoGain: this.autoGain
        };

        try {
            localStorage.setItem('aurivo_eq_settings', JSON.stringify(settings));
            console.log('💾 EQ settings saved');

            // Show notification
            showNotification('EQ ayarları kaydedildi', 'success');
        } catch (e) {
            console.error('Failed to save EQ settings:', e);
        }
    },

    // Ayarları yükle from localStorage
    loadSettings() {
        try {
            const saved = localStorage.getItem('aurivo_eq_settings');
            if (!saved) return;

            const settings = JSON.parse(saved);

            // Uygula bands
            if (settings.bands) {
                settings.bands.forEach((value, index) => {
                    this.bands[index] = value;
                    this.setBand(index, value);

                    const sliderData = this.elements.sliders[index];
                    if (sliderData) {
                        sliderData.slider.value = value;
                        sliderData.valueDiv.textContent = value > 0 ? `+${value}` : value;

                        sliderData.band.classList.remove('positive', 'negative');
                        if (value > 0) sliderData.band.classList.add('positive');
                        if (value < 0) sliderData.band.classList.add('negative');
                    }
                });
            }

            // Uygula other settings
            if (settings.preamp !== undefined) {
                this.preamp = settings.preamp;
                this.setPreamp(settings.preamp);
                if (this.elements.preampSlider) {
                    this.elements.preampSlider.value = settings.preamp;
                    document.getElementById('preampValue').textContent =
                        (settings.preamp > 0 ? '+' : '') + settings.preamp + ' dB';
                }
            }

            if (settings.masterVolume !== undefined) {
                this.masterVolume = settings.masterVolume;
                this.setMasterVolume(settings.masterVolume);
                if (this.elements.volumeSlider) {
                    this.elements.volumeSlider.value = settings.masterVolume;
                    document.getElementById('masterVolumeValue').textContent = settings.masterVolume + '%';
                }
            }

            if (settings.bassBoost !== undefined) {
                this.bassBoost = settings.bassBoost;
                this.setBassBoost(settings.bassBoost);
                document.getElementById('bassBoostValue').textContent = settings.bassBoost + '%';
            }

            if (settings.enabled !== undefined) {
                this.enabled = settings.enabled;
                if (this.elements.enableToggle) {
                    this.elements.enableToggle.checked = settings.enabled;
                }
                this.updateEQState();
            }

            if (settings.autoGain !== undefined) {
                this.autoGain = settings.autoGain;
                if (this.elements.autoGainToggle) {
                    this.elements.autoGainToggle.checked = settings.autoGain;
                }
            }

            console.log('📂 EQ settings loaded');
        } catch (e) {
            console.error('Failed to load EQ settings:', e);
        }
    },

    // Seviye metrelerini güncelle (call from audio loop)
    updateLevels(leftLevel, rightLevel) {
        const bars = this.elements.levelBars;
        if (bars.length >= 2) {
            bars[0].style.setProperty('--level', `${leftLevel * 100}%`);
            bars[1].style.setProperty('--level', `${rightLevel * 100}%`);
        }

        // Clipping kontrolü
        if (this.elements.clippingLed) {
            const isClipping = leftLevel > 0.95 || rightLevel > 0.95;
            this.elements.clippingLed.classList.toggle('active', isClipping);
        }
    },

    // ============================================
    // PRESET YÖNETİCİSİ FONKSİYONLARI
    // ============================================

    // Preset kaydet modalını aç
    openSavePresetModal() {
        if (!this.elements.savePresetModal) return;

        // Önizlemeyi güncelle
        this.updatePresetPreview();

        // Girdi alanlarını temizle
        if (this.elements.presetNameInput) {
            this.elements.presetNameInput.value = '';
            this.elements.presetNameInput.focus();
        }
        if (this.elements.presetDescInput) {
            this.elements.presetDescInput.value = '';
        }

        this.elements.savePresetModal.classList.add('active');
    },

    // Preset kaydet modalını kapat
    closeSavePresetModal() {
        if (this.elements.savePresetModal) {
            this.elements.savePresetModal.classList.remove('active');
        }
    },

    // Preset önizlemesini güncelle
    updatePresetPreview() {
        // Bass boost value
        const bassPreview = document.getElementById('previewBassBoost');
        if (bassPreview) {
            bassPreview.textContent = Math.round(this.bassBoost) + '%';
        }

        // Preamp value
        const preampPreview = document.getElementById('previewPreamp');
        if (preampPreview) {
            const val = this.preamp;
            preampPreview.textContent = (val > 0 ? '+' : '') + val + ' dB';
        }

        // Aktif band sayısı
        const activeBandsPreview = document.getElementById('previewActiveBands');
        if (activeBandsPreview) {
            const activeBands = this.bands.filter(b => b !== 0).length;
            activeBandsPreview.textContent = `${activeBands}/32`;
        }

        // Mini EQ preview
        this.drawMiniEqPreview();
    },

    // Mini EQ önizlemesini çiz
    drawMiniEqPreview() {
        const container = document.getElementById('miniEqPreview');
        if (!container) return;

        container.innerHTML = '';

        this.bands.forEach((value, index) => {
            const bar = document.createElement('div');
            bar.className = 'mini-eq-bar';

            const height = Math.abs(value) * 4; // Max 48px for ±12dB
            const isPositive = value >= 0;

            bar.style.cssText = `
                width: 6px;
                height: ${height}px;
                background: ${isPositive ? 'var(--accent-primary)' : '#ff6b6b'};
                border-radius: 2px;
                position: absolute;
                left: ${index * 8}px;
                ${isPositive ? 'bottom: 50%' : 'top: 50%'};
                opacity: ${value === 0 ? 0.2 : 0.8};
            `;

            container.appendChild(bar);
        });
    },

    // Özel preset kaydet
    saveCustomPreset() {
        const name = this.elements.presetNameInput?.value.trim();
        if (!name) {
            showNotification('Lütfen preset adı girin', 'error');
            this.elements.presetNameInput?.focus();
            return;
        }

        // Benzersiz anahtar üret
        const key = 'custom_' + name.toLowerCase().replace(/[^a-z0-9]/g, '_') + '_' + Date.now();

        // Preset nesnesi oluştur
        const preset = {
            name: name,
            description: this.elements.presetDescInput?.value.trim() || '',
            bands: [...this.bands],
            bassBoost: this.bassBoost,
            preamp: this.preamp,
            createdAt: new Date().toISOString(),
            isCustom: true
        };

        // Özel presetlere kaydet
        this.customPresets[key] = preset;
        this.saveCustomPresets();

        // Açılır listeyi güncelle
        this.populatePresetSelect();

        // Yeni preset'i seç
        if (this.elements.presetSelect) {
            this.elements.presetSelect.value = key;
        }
        this.currentPreset = key;

        // Modal kapat
        this.closeSavePresetModal();

        showNotification(`"${name}" preset kaydedildi`, 'success');
        console.log(`💾 Custom preset saved: ${name}`);
    },

    // Preset yöneticisini aç
    openPresetManager() {
        if (!this.elements.presetManagerModal) return;

        // Listeleri doldur
        this.populateFactoryPresetList();
        this.populateCustomPresetList();

        // Varsayılan olarak fabrika sekmesine geç
        this.switchPresetTab('factory');

        this.elements.presetManagerModal.classList.add('active');
    },

    // Preset yöneticisini kapat
    closePresetManager() {
        if (this.elements.presetManagerModal) {
            this.elements.presetManagerModal.classList.remove('active');
        }
    },

    // Preset sekmesini değiştir
    switchPresetTab(tab) {
        // Sekme butonlarını güncelle
        document.querySelectorAll('.preset-tab').forEach(t => {
            t.classList.toggle('active', t.dataset.tab === tab);
        });

        // Listeleri güncelle
        const factoryList = document.getElementById('factoryPresetList');
        const customList = document.getElementById('customPresetList');

        if (factoryList) factoryList.classList.toggle('hidden', tab !== 'factory');
        if (customList) customList.classList.toggle('hidden', tab !== 'custom');
    },

    // Fabrika preset listesini doldur
    populateFactoryPresetList() {
        const container = this.elements.factoryPresetList;
        if (!container) return;

        container.innerHTML = '';

        Object.entries(this.factoryPresets).forEach(([key, preset]) => {
            const item = this.createPresetListItem(key, preset, false);
            container.appendChild(item);
        });
    },

    // Özel preset listesini doldur
    populateCustomPresetList() {
        const container = this.elements.customPresetList;
        if (!container) return;

        const customKeys = Object.keys(this.customPresets);
        const emptyState = document.getElementById('noCustomPresets');

        // Mevcut öğeleri temizle (except empty state)
        container.querySelectorAll('.preset-list-item').forEach(el => el.remove());

        if (customKeys.length === 0) {
            if (emptyState) emptyState.classList.remove('hidden');
            return;
        }

        if (emptyState) emptyState.classList.add('hidden');

        customKeys.forEach(key => {
            const preset = this.customPresets[key];
            const item = this.createPresetListItem(key, preset, true);
            container.appendChild(item);
        });
    },

    // Preset liste öğesi oluştur
    createPresetListItem(key, preset, isCustom) {
        const item = document.createElement('div');
        item.className = 'preset-list-item';
        item.dataset.key = key;

        // İstatistikleri hesapla
        const activeBands = preset.bands.filter(b => b !== 0).length;
        const avgGain = preset.bands.reduce((a, b) => a + b, 0) / preset.bands.length;

        item.innerHTML = `
            <div class="preset-item-info">
                <div class="preset-item-name">${preset.name}</div>
                <div class="preset-item-desc">${preset.description || 'Açıklama yok'}</div>
                <div class="preset-item-stats">
                    <span>Bass: ${preset.bassBoost}%</span>
                    <span>Aktif: ${activeBands}/32</span>
                    ${preset.createdAt ? `<span>${new Date(preset.createdAt).toLocaleDateString('tr-TR')}</span>` : ''}
                </div>
            </div>
            <div class="preset-item-actions">
                <button class="preset-action-btn apply-btn" title="Uygula">
                    <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
                        <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
                    </svg>
                </button>
                ${isCustom ? `
                    <button class="preset-action-btn edit-btn" title="Düzenle">
                        <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
                            <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
                        </svg>
                    </button>
                    <button class="preset-action-btn delete-btn" title="Sil">
                        <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
                            <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
                        </svg>
                    </button>
                ` : ''}
            </div>
        `;

        // Event listener'lar
        const applyBtn = item.querySelector('.apply-btn');
        if (applyBtn) {
            applyBtn.addEventListener('click', () => {
                this.applyPreset(key);
                this.currentPreset = key;
                if (this.elements.presetSelect) {
                    this.elements.presetSelect.value = key;
                }
                showNotification(`"${preset.name}" uygulandı`, 'success');
            });
        }

        if (isCustom) {
            const editBtn = item.querySelector('.edit-btn');
            if (editBtn) {
                editBtn.addEventListener('click', () => this.editCustomPreset(key));
            }

            const deleteBtn = item.querySelector('.delete-btn');
            if (deleteBtn) {
                deleteBtn.addEventListener('click', () => this.deleteCustomPreset(key));
            }
        }

        return item;
    },

    // Özel preset düzenle
    editCustomPreset(key) {
        const preset = this.customPresets[key];
        if (!preset) return;

        // Preset uygula values to EQ
        this.applyPreset(key);

        // Mevcut değerlerle kaydet modalını aç
        this.openSavePresetModal();

        // Ad ve açıklamayı önceden doldur
        if (this.elements.presetNameInput) {
            this.elements.presetNameInput.value = preset.name;
        }
        if (this.elements.presetDescInput) {
            this.elements.presetDescInput.value = preset.description || '';
        }

        // Kaydederken eski preset'i sil
        const oldConfirmHandler = document.getElementById('confirmSavePreset');
        if (oldConfirmHandler) {
            const newHandler = oldConfirmHandler.cloneNode(true);
            oldConfirmHandler.parentNode.replaceChild(newHandler, oldConfirmHandler);

            newHandler.addEventListener('click', () => {
                // Önce eski preset'i sil
                delete this.customPresets[key];
                // Sonra yeni olarak kaydet
                this.saveCustomPreset();
                // Listeyi yeniden doldur
                this.populateCustomPresetList();
            });
        }
    },

    // Özel preset sil
    deleteCustomPreset(key) {
        const preset = this.customPresets[key];
        if (!preset) return;

        const ask = async () => {
            try {
                if (window.i18n?.t) return await window.i18n.t('confirm.deletePreset', { name: preset.name });
            } catch {
                // yoksay
            }
            return `"${preset.name}" presetini silmek istediğinize emin misiniz?`;
        };

        ask().then((msg) => {
            if (!confirm(msg)) return;
            delete this.customPresets[key];
            this.saveCustomPresets();
            this.populatePresetSelect();
            this.populateCustomPresetList();

            // Bu mevcut preset ise, flat'a geç
            if (this.currentPreset === key) {
                this.currentPreset = 'flat';
                if (this.elements.presetSelect) {
                    this.elements.presetSelect.value = 'flat';
                }
            }

            const notify = async () => {
                try {
                    if (window.i18n?.t) return await window.i18n.t('notifications.presetDeleted', { name: preset.name });
                } catch {
                    // yoksay
                }
                return `"${preset.name}" silindi`;
            };
            notify().then((text) => showNotification(text, 'info'));
        });
    },

    // Presetleri JSON dosyasına dışa aktar
    exportPresets() {
        const exportData = {
            version: '1.0',
            exportDate: new Date().toISOString(),
            customPresets: this.customPresets
        };

        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = `aurivo_eq_presets_${Date.now()}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        showNotification('Presetler dışa aktarıldı', 'success');
    },

    // Presetleri JSON dosyasından içe aktar
    importPresets(event) {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = JSON.parse(e.target.result);

                if (!data.customPresets || typeof data.customPresets !== 'object') {
                    throw new Error('Geçersiz preset dosyası');
                }

                // Mevcut presetlerle birleştir
                let importedCount = 0;
                Object.entries(data.customPresets).forEach(([key, preset]) => {
                    // Preset yapısını doğrula
                    if (preset.name && Array.isArray(preset.bands) && preset.bands.length === 32) {
                        // Çakışmaları önlemek için yeni anahtar üret
                        const newKey = 'custom_' + preset.name.toLowerCase().replace(/[^a-z0-9]/g, '_') + '_' + Date.now();
                        this.customPresets[newKey] = {
                            ...preset,
                            importedAt: new Date().toISOString()
                        };
                        importedCount++;
                    }
                });

                if (importedCount > 0) {
                    this.saveCustomPresets();
                    this.populatePresetSelect();
                    this.populateCustomPresetList();
                    showNotification(`${importedCount} preset içe aktarıldı`, 'success');
                } else {
                    showNotification('İçe aktarılacak geçerli preset bulunamadı', 'warning');
                }

            } catch (err) {
                console.error('Import error:', err);
                showNotification('Dosya okunamadı: ' + err.message, 'error');
            }
        };

        reader.readAsText(file);

        // Dosya girişini sıfırla
        event.target.value = '';
    }
};

// ============================================
// AGC DENETLEYİCİ - Otomatik Gain Kontrolü
// Gelişmiş Seviye Yönetimi ve Limiter
// ============================================

const AGCController = {
    // Yapılandırma
    config: {
        enabled: true,
        checkInterval: 100,          // 100ms interval for level checking
        peakThreshold: 0.95,         // 95% of max (31129 / 32768)
        lowLevelThreshold: 0.50,     // 50% for low level detection
        lowLevelDuration: 5000,      // 5 seconds before suggesting increase
        attackTime: 5,               // 5ms attack
        releaseTime: 50,             // 50ms release
        limiterThreshold: 0.98,      // Hard limiter at 98%
    },

    // Durum
    state: {
        isRunning: false,
        intervalId: null,
        lowLevelStartTime: null,
        lastClippingWarning: 0,
        totalGainReductions: 0,
        sessionClippingEvents: 0,
    },

    // UI Elemanları
    elements: {
        toggle: null,
        statusIndicator: null,
        gainReductionMeter: null,
        peakMeter: null,
        clippingLed: null,
    },

    // AGC denetleyicisini başlat
    init() {
        this.cacheElements();
        this.setupEventListeners();
        this.loadSettings();

        if (this.config.enabled) {
            this.start();
        }

        console.log('🎚️ AGC Controller initialized');
    },

    // DOM elemanlarını önbellekle
    cacheElements() {
        this.elements.toggle = document.getElementById('autoGainToggle');
        this.elements.statusIndicator = document.getElementById('agcStatusIndicator');
        this.elements.gainReductionMeter = document.getElementById('gainReductionMeter');
        this.elements.peakMeter = document.getElementById('peakMeter');
        this.elements.clippingLed = document.getElementById('clipLed');
    },

    // Event listener'ları kur
    setupEventListeners() {
        // Aç/Kapat listener is handled in EQController
        // We just need to listen for changes
        if (this.elements.toggle) {
            this.elements.toggle.addEventListener('change', (e) => {
                this.setEnabled(e.target.checked);
            });
        }
    },

    // AGC izlemeyi başlat
    start() {
        if (this.state.isRunning) return;

        this.state.isRunning = true;
        this.state.intervalId = setInterval(() => this.checkLevels(), this.config.checkInterval);

        // AGC parametrelerini native'a gönder
        this.updateNativeParameters();

        console.log('🔊 AGC monitoring started');
    },

    // AGC izlemeyi durdur
    stop() {
        if (!this.state.isRunning) return;

        this.state.isRunning = false;
        if (this.state.intervalId) {
            clearInterval(this.state.intervalId);
            this.state.intervalId = null;
        }

        console.log('🔇 AGC monitoring stopped');
    },

    // AGC etkinleştir/kapat
    setEnabled(enabled) {
        this.config.enabled = enabled;

        // Native AGC'yi güncelle
        if (window.audioAPI?.agc?.setEnabled) {
            try {
                window.audioAPI.agc.setEnabled(enabled);
            } catch (e) {
                console.warn('Native AGC not available:', e);
            }
        }

        if (enabled) {
            this.start();
        } else {
            this.stop();
        }

        // Kaydet setting
        this.saveSettings();

        // UI'yi güncelle
        if (this.elements.toggle) {
            this.elements.toggle.checked = enabled;
        }
    },

    // Native AGC'yi güncelle parameters
    updateNativeParameters() {
        if (!window.audioAPI?.agc?.setParameters) return;

        try {
            window.audioAPI.agc.setParameters({
                attackMs: this.config.attackTime,
                releaseMs: this.config.releaseTime,
                threshold: this.config.limiterThreshold
            });
        } catch (e) {
            console.warn('Could not set AGC parameters:', e);
        }
    },

    // Ana seviye kontrol fonksiyonu - called every 100ms
    checkLevels() {
        if (!this.config.enabled) return;
        if (!state.isPlaying) return; // Sadece çalarken kontrol et

        // Native'dan AGC durumunu al
        let agcStatus = null;
        if (window.audioAPI?.agc?.getStatus) {
            try {
                agcStatus = window.audioAPI.agc.getStatus();
            } catch (e) {
                // Native not available, try channel levels
            }
        }

        // Temel seviye kontrolüne fallback
        if (!agcStatus && window.audioAPI?.spectrum?.getChannelLevels) {
            try {
                const levels = window.audioAPI.spectrum.getChannelLevels();
                agcStatus = {
                    peakLevel: Math.max(levels.left || 0, levels.right || 0),
                    rmsLevel: (levels.left + levels.right) / 2,
                    gainReduction: 1.0,
                    isClipping: false,
                    clippingCount: 0
                };
            } catch (e) {
                return; // Seviyeler kontrol edilemiyor
            }
        }

        if (!agcStatus) return;

        // UI metrelerini güncelle
        this.updateMeters(agcStatus);

        // Check for clipping
        if (agcStatus.isClipping || agcStatus.peakLevel > this.config.peakThreshold) {
            this.handleClipping(agcStatus);
        }

        // Süregelen düşük seviye kontrolü
        this.checkLowLevels(agcStatus);
    },

    // Görsel metreleri güncelle
    updateMeters(status) {
        // Güncelle level bars in EQ modal
        if (EQController?.elements?.levelBars?.length >= 2) {
            EQController.updateLevels(status.peakLevel, status.peakLevel);
        }

        // Clipping LED'ini güncelle
        if (this.elements.clippingLed) {
            this.elements.clippingLed.classList.toggle('active', status.isClipping);
        }

        // Peak etiketini güncelle
        const peakLabel = document.getElementById('peakLabel');
        if (peakLabel) {
            const peakDB = status.peakLevel > 0 ? (20 * Math.log10(status.peakLevel)).toFixed(1) : '-∞';
            peakLabel.textContent = `${peakDB} dB`;
            peakLabel.style.color = status.peakLevel > 0.9 ? '#ff4444' :
                status.peakLevel > 0.7 ? '#ffaa00' : '#00ff88';
        }
    },

    // Clipping olaylarını işle
    handleClipping(status) {
        const now = Date.now();

        // Spam'i önle - sadece 2 saniyede bir uyar
        if (now - this.state.lastClippingWarning < 2000) return;

        this.state.lastClippingWarning = now;
        this.state.sessionClippingEvents++;

        console.warn(`⚠️ Clipping detected! Peak: ${(status.peakLevel * 100).toFixed(1)}%`);

        // Acil azaltma uygula
        this.applyEmergencyReduction();

        // Uyarı bildirimi göster
        showNotification(
            'Ses seviyesi çok yüksek, otomatik azaltma uygulandı',
            'warning',
            3000
        );
    },

    // Acil gain azaltma uygula
    applyEmergencyReduction() {
        this.state.totalGainReductions++;

        // Önce native acil azaltmayı dene
        if (window.audioAPI?.agc?.applyEmergencyReduction) {
            try {
                window.audioAPI.agc.applyEmergencyReduction();
                return;
            } catch (e) {
                // Fall through to JS implementation
            }
        }

        // JS fallback: tüm EQ bandlarını 1dB azalt
        if (EQController) {
            EQController.bands.forEach((value, index) => {
                const newValue = Math.max(-15, value - 1);
                EQController.bands[index] = newValue;
                EQController.setBand(index, newValue);

                // Güncelle slider
                const sliderData = EQController.elements.sliders[index];
                if (sliderData) {
                    sliderData.slider.value = newValue;
                    sliderData.valueDiv.textContent = newValue > 0 ? `+${newValue}` : newValue;
                }
            });

            // Preamp'ı 0.5dB azalt
            const newPreamp = Math.max(-12, EQController.preamp - 0.5);
            EQController.preamp = newPreamp;
            EQController.setPreamp(newPreamp);

            if (EQController.elements.preampSlider) {
                EQController.elements.preampSlider.value = newPreamp;
                const preampDisplay = document.getElementById('preampValue');
                if (preampDisplay) {
                    preampDisplay.textContent = (newPreamp > 0 ? '+' : '') + newPreamp.toFixed(1) + ' dB';
                }
            }
        }
    },

    // Süregelen düşük seviye kontrolü and suggest preamp increase
    checkLowLevels(status) {
        if (status.peakLevel < this.config.lowLevelThreshold) {
            // Seviye düşük
            if (!this.state.lowLevelStartTime) {
                this.state.lowLevelStartTime = Date.now();
            } else {
                const lowDuration = Date.now() - this.state.lowLevelStartTime;

                // Yapılandırılan süre düşükse, artış öner
                if (lowDuration >= this.config.lowLevelDuration) {
                    this.suggestPreampIncrease();
                    this.state.lowLevelStartTime = null; // Sıfırla timer
                }
            }
        } else {
            // Seviye iyi, zamanlayıcıyı sıfırla
            this.state.lowLevelStartTime = null;
        }
    },

    // Kullanıcıya preamp artışı öner
    suggestPreampIncrease() {
        // Sadece preamp maksimumun altındaysa öner
        if (EQController && EQController.preamp < 12) {
            // Native öneriyi kontrol et
            let suggestion = 0.5; // Varsayılan
            if (window.audioAPI?.agc?.getPreampSuggestion) {
                try {
                    suggestion = window.audioAPI.agc.getPreampSuggestion();
                } catch (e) {
                    // Varsayılanı kullan
                }
            }

            if (suggestion > 0) {
                // Küçük artışı otomatik uygula
                const newPreamp = Math.min(12, EQController.preamp + suggestion);
                EQController.preamp = newPreamp;
                EQController.setPreamp(newPreamp);

                // UI'yi güncelle
                if (EQController.elements.preampSlider) {
                    EQController.elements.preampSlider.value = newPreamp;
                    const preampDisplay = document.getElementById('preampValue');
                    if (preampDisplay) {
                        preampDisplay.textContent = (newPreamp > 0 ? '+' : '') + newPreamp.toFixed(1) + ' dB';
                    }
                }

                console.log(`📈 Auto-increased preamp by +${suggestion.toFixed(1)}dB`);
            }
        }
    },

    // AGC istatistiklerini al
    getStats() {
        return {
            enabled: this.config.enabled,
            isRunning: this.state.isRunning,
            totalGainReductions: this.state.totalGainReductions,
            sessionClippingEvents: this.state.sessionClippingEvents,
            config: { ...this.config }
        };
    },

    // İstatistikleri sıfırla
    resetStats() {
        this.state.totalGainReductions = 0;
        this.state.sessionClippingEvents = 0;

        // Native clipping sayısını sıfırla
        if (window.audioAPI?.agc?.resetClippingCount) {
            try {
                window.audioAPI.agc.resetClippingCount();
            } catch (e) {
                // yoksay
            }
        }
    },

    // Ayarları kaydet
    saveSettings() {
        try {
            localStorage.setItem('aurivo_agc_settings', JSON.stringify({
                enabled: this.config.enabled,
                attackTime: this.config.attackTime,
                releaseTime: this.config.releaseTime,
                limiterThreshold: this.config.limiterThreshold
            }));
        } catch (e) {
            console.error('Could not save AGC settings:', e);
        }
    },

    // Ayarları yükle
    loadSettings() {
        try {
            const saved = localStorage.getItem('aurivo_agc_settings');
            if (saved) {
                const settings = JSON.parse(saved);
                this.config.enabled = settings.enabled ?? true;
                this.config.attackTime = settings.attackTime ?? 5;
                this.config.releaseTime = settings.releaseTime ?? 50;
                this.config.limiterThreshold = settings.limiterThreshold ?? 0.98;
            }
        } catch (e) {
            console.error('Could not load AGC settings:', e);
        }
    }
};

// DOM hazır olduğunda EQ ve AGC'yi başlat
document.addEventListener('DOMContentLoaded', () => {
    // Slight delay to ensure all elements are ready
    setTimeout(() => {
        EQController.init();
        AGCController.init();
    }, 100);
});
