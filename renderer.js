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
let nativeAudioAvailable = false; // engine initialized successfully (BASS)

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
    activePlayer: 'A', // 'A' veya 'B'
    // Native ses durumu
    nativePositionTimer: null,
    nativePositionGeneration: 0,
    nativeIpcBound: false,
    nativeIpcActive: false,
    nativeIpcLastAt: 0,
    // MPRIS takibi
    lastMPRISPosition: -1,
    // Sekme bazlı konum hafızası
    lastAudioPath: null, // Müzik sekmesi son konum
    lastVideoPath: null, // Video sekmesi son konum
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
    autoSortPlaylist: true,
    deferPlaylistSort: false,
    playlistSortOrder: 'asc', // auto sort default: A-Z
    missingFileWatchTimer: null,
    missingFileWatchKey: null,
    missingFileWarned: new Set()
};

// Web player <-> uygulama ses senkronu (sonsuz döngü/jitter önleme)
const webVolumeSync = {
    ignoreIncomingUntil: 0
};
const securityRuntime = {
    vpnWarned: false
};

// ============================================================
// WEBVIEW RUNTIME (stability helpers)
// ============================================================
const webRuntime = {
    lastRequestedUrl: 'about:blank',
    retryCount: 0,
    retryTimer: null,
    recovering: false,
    lastFailAt: 0
};

function clearWebRetryTimer() {
    if (webRuntime.retryTimer) {
        clearTimeout(webRuntime.retryTimer);
        webRuntime.retryTimer = null;
    }
}

function resetWebRuntime() {
    clearWebRetryTimer();
    webRuntime.retryCount = 0;
    webRuntime.recovering = false;
    webRuntime.lastFailAt = 0;
}

function isTransientWebviewError(code) {
    const c = Number(code);
    // -3 is ERR_ABORTED (common during redirects / manual navigation)
    if (c === -3) return false;
    // common transient-ish network failures in Chromium
    return [
        -2,   // FAILED
        -7,   // TIMED_OUT
        -100, // CONNECTION_CLOSED
        -101, // CONNECTION_RESET
        -102, // CONNECTION_REFUSED
        -105, // NAME_NOT_RESOLVED
        -106, // INTERNET_DISCONNECTED
        -109, // ADDRESS_UNREACHABLE
        -118, // CONNECTION_TIMED_OUT
        -137, // NAME_RESOLUTION_FAILED
        -324  // EMPTY_RESPONSE
    ].includes(c);
}

function safeLoadWebUrl(nextUrl, { reason = '', force = false } = {}) {
    if (!elements.webView) return;
    const parsed = parseHttpUrl(nextUrl);
    if (!parsed) return;
    const url = parsed.toString();
    if (!isAllowedWebUrl(url)) return;

    webRuntime.lastRequestedUrl = url;
    if (force) resetWebRuntime();

    try {
        // Prefer loadURL but keep src as a fallback.
        try {
            const maybe = elements.webView.loadURL(url);
            if (maybe && typeof maybe.catch === 'function') maybe.catch(() => { });
        } catch { /* ignore */ }
        try { elements.webView.setAttribute('src', url); } catch { /* ignore */ }
    } catch (e) {
        console.warn('[WEBVIEW] safeLoadWebUrl failed:', reason, e?.message || e);
    }
}

function scheduleWebRetry(url, { code = 0, desc = '', reason = '' } = {}) {
    const target = String(url || '').trim();
    if (!target || target === 'about:blank') return;
    if (!isAllowedWebUrl(target)) return;

    // Prevent retry storms
    const now = Date.now();
    if (now - webRuntime.lastFailAt < 400) return;
    webRuntime.lastFailAt = now;

    const maxRetries = 3;
    if (webRuntime.retryCount >= maxRetries) return;

    webRuntime.retryCount += 1;
    clearWebRetryTimer();

    const base = 650;
    const delay = Math.min(8000, base * Math.pow(2, webRuntime.retryCount - 1)) + Math.floor(Math.random() * 250);
    console.warn('[WEBVIEW] scheduling retry', { attempt: webRuntime.retryCount, delay, code, desc, reason, target });

    webRuntime.retryTimer = setTimeout(() => {
        webRuntime.retryTimer = null;
        // Only retry if user still wants the same target.
        if (webRuntime.lastRequestedUrl !== target) return;
        safeLoadWebUrl(target, { reason: `retry:${reason}`, force: false });
    }, delay);
}

function recreateWebView(reason = '') {
    if (webRuntime.recovering) return;
    webRuntime.recovering = true;
    clearWebRetryTimer();

    try {
        const webPage = document.getElementById('webPage');
        if (!webPage) return;

        const old = document.getElementById('webView');
        try { old?.remove?.(); } catch { /* ignore */ }

        const wv = document.createElement('webview');
        wv.id = 'webView';
        wv.setAttribute('partition', 'persist:aurivo-web');
        wv.setAttribute('src', 'about:blank');
        // Keep popups setting consistent with security toggle.
        try {
            const allow = !!elements.securityAllowPopups?.checked;
            if (allow) wv.setAttribute('allowpopups', '');
        } catch { /* ignore */ }

        webPage.appendChild(wv);
        elements.webView = wv;
        attachWebViewEvents(wv);

        // reload last requested url (if any)
        const url = webRuntime.lastRequestedUrl;
        webRuntime.recovering = false;
        if (url && url !== 'about:blank') {
            setTimeout(() => safeLoadWebUrl(url, { reason: `recreate:${reason}`, force: true }), 250);
        }
    } catch (e) {
        webRuntime.recovering = false;
        console.warn('[WEBVIEW] recreateWebView failed:', e?.message || e);
    }
}

function attachWebViewEvents(webviewEl) {
    if (!webviewEl) return;

    webviewEl.addEventListener('did-fail-load', (e) => {
        try {
            const code = e?.errorCode;
            const desc = e?.errorDescription || '';
            const url = e?.validatedURL || getWebViewUrlSafe();
            console.warn('[WEBVIEW] did-fail-load:', { code, desc, url });

            if (Number(code) === -3) return; // ERR_ABORTED

            if (isTransientWebviewError(code)) {
                scheduleWebRetry(url, { code, desc, reason: 'did-fail-load' });
                return;
            }
            safeNotify(uiT('web.notify.loadFailed', 'Web sayfasi yuklenemedi: {desc}', { desc: desc || String(code || '') }), 'error');
        } catch {
            // best effort
        }
    });

    webviewEl.addEventListener('did-finish-load', () => {
        resetWebRuntime();
        try { updateNavButtons(); } catch { }
    });

    webviewEl.addEventListener('did-navigate', () => {
        try { updateNavButtons(); } catch { }
    });
    webviewEl.addEventListener('did-navigate-in-page', () => {
        try { updateNavButtons(); } catch { }
    });
    webviewEl.addEventListener('did-start-loading', () => {
        try { updateNavButtons(); } catch { }
    });
    webviewEl.addEventListener('did-stop-loading', () => {
        try { updateNavButtons(); } catch { }
    });

    webviewEl.addEventListener('render-process-gone', (e) => {
        console.warn('[WEBVIEW] render-process-gone:', e?.reason || e);
        setTimeout(() => recreateWebView('render-process-gone'), 300);
    });
    webviewEl.addEventListener('crashed', () => {
        console.warn('[WEBVIEW] crashed');
        setTimeout(() => recreateWebView('crashed'), 300);
    });
}

// Desteklenen ses formatları (kütüphane tarama filtresi)
// Not: uzantı kontrolü her yerde `toLowerCase()` ile yapılır.
const AUDIO_EXTENSIONS = [
    'mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac', 'opus', 'wma', 'aiff', 'ape', 'wv'
];

// Video formatları (ileride kullanılabilir)
const VIDEO_EXTENSIONS = ['mp4', 'mkv', 'webm', 'avi', 'mov', 'wmv', 'm4v', 'flv', 'mpg', 'mpeg'];
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

// ============================================
// AUTO UPDATE UI STATE
// ============================================
const updateUi = {
    state: null,
    dismissed: false,
    dismissedVersion: ''
};

// Dosya ağacı fare sürükleme seçim durumu
let fileTreeDragTrack = null; // { startItem, startX, startY, selecting }
let suppressFileItemClickOnce = false;
let blockFileTreeDragStart = false;

// ============================================
// BAŞLATMA
// ============================================
document.addEventListener('DOMContentLoaded', async () => {
    cacheElements();
    // "Dosyalar" sekmesini kaldır: sadece Video / Müzik / Web kalsın.
    try {
        const filesTabBtn = document.querySelector('.sidebar-btn[data-page="files"]');
        if (filesTabBtn) filesTabBtn.remove();
    } catch {
        // yoksay
    }
    await initializeI18n();

    // Apply Sound Effects changes to video playback too (WebAudio graph).
    try {
        if (window.aurivo?.audio?.on) {
            window.aurivo.audio.on('sfxUpdate', (payload) => {
                try {
                    // Ensure graph exists when a video is active/loaded.
                    if (elements.videoPlayer) ensureVideoSfxGraph();
                    handleSfxUpdateForVideo(payload);
                } catch { }
            });
            window.aurivo.audio.on('soundEffects:visibility', (payload) => {
                try {
                    setSoundEffectsWindowOpen(!!payload?.open);
                } catch { }
            });
            window.aurivo.audio.on('soundEffects:heartbeat', () => {
                try {
                    if (shouldKeepVideoAliveForSfx()) {
                        resumeVideoAfterAuxWindowOpen();
                    }
                    if ((Date.now() < sfxOpenForceResumeUntil || Date.now() < sfxOpenGuardUntil) && state.activeMedia === 'video' && elements.videoPlayer) {
                        const p = elements.videoPlayer.play();
                        if (p && typeof p.catch === 'function') p.catch(() => { });
                    }
                } catch { }
            });
        }
    } catch {
        // ignore
    }
    try { await syncVideoSfxStateFromEngine(); } catch { }

    // "Open with" / ikinci instance: disaridan acilan dosyalari mevcut instance'a ekle ve cal.
    try {
        if (window.aurivo?.app?.onOpenFiles) {
            window.aurivo.app.onOpenFiles(async (filePaths) => {
                const paths = Array.isArray(filePaths) ? filePaths.filter(Boolean) : [];
                if (!paths.length) return;

                // Prefer the first file as the "play now" target.
                const target = String(paths[0] || '').trim();
                const name = window.aurivo?.path?.basename?.(target) || target.split(/[\\/]/).pop();
                const isVideo = isVideoFile(name);

                // Switch UI to correct section
                if (isVideo) {
                    setActiveSidebarByPage('video');
                    state.currentPage = 'video';
                    state.currentPanel = 'library';
                    switchPage('video');
                    isolateMediaSection('video');
                    try {
                        // Keep a minimal video list
                        if (!Array.isArray(state.videoFiles)) state.videoFiles = [];
                        if (!state.videoFiles.find(v => v.path === target)) {
                            state.videoFiles = [{ path: target, name }];
                        }
                        playVideo(target);
                    } catch (e) {
                        console.warn('[OPENFILES] playVideo error:', e?.message || e);
                    }
                    return;
                }

                // Audio: append only the selected file(s), do not auto-import whole folders.
                setActiveSidebarByPage('music');
                state.currentPage = 'music';
                state.currentPanel = 'library';
                switchPage('music');
                isolateMediaSection('music');

                const prevDefer = state.deferPlaylistSort;
                state.deferPlaylistSort = true;
                let playIdx = -1;
                try {
                    for (const p of paths) {
                        const fp = String(p || '').trim();
                        if (!fp) continue;
                        // best-effort exists check (async)
                        try {
                            if (window.aurivo?.fileExists) {
                                const ok = await window.aurivo.fileExists(fp);
                                if (!ok) continue;
                            }
                        } catch { }

                        const base = window.aurivo?.path?.basename?.(fp) || fp.split(/[\\/]/).pop();
                        const { index, added } = addToPlaylist(fp, base);
                        if (fp === target) {
                            // if already existed, find its index too
                            playIdx = (index >= 0) ? index : state.playlist.findIndex(i => i.path === fp);
                        } else if (playIdx === -1 && fp === target) {
                            playIdx = index;
                        }
                    }
                } finally {
                    state.deferPlaylistSort = prevDefer;
                }

                if (state.autoSortPlaylist && !state.deferPlaylistSort) {
                    sortPlaylistByName(state.playlistSortOrder || 'asc');
                    // Re-find after sort
                    if (target) {
                        const idx2 = state.playlist.findIndex(i => i.path === target);
                        if (idx2 >= 0) playIdx = idx2;
                    }
                }

                if (playIdx >= 0) {
                    playIndex(playIdx);
                } else if (target) {
                    // Fallback: try to play first playlist item
                    const idx3 = state.playlist.findIndex(i => i.path === target);
                    if (idx3 >= 0) playIndex(idx3);
                }
            });
        }
    } catch {
        // ignore
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
    await loadPlaylist();
    setupEventListeners();
    initUpdaterUi();
    applyWebUiClasses();
    setupVisualizer();
    await initializeFileTree();
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
                    elements.languageSelect.addEventListener('change', async (e) => {
                        const next = e?.target?.value;
                        if (!next) return;
                        await window.i18n.setLanguagePreference(next);
                        showRestartHint();
                        openRestartModal();
                    });
                }
            }
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
                    nativeAudioAvailable = true;
                    console.log('✓ C++ Audio Engine başarıyla başlatıldı');

                    // AGC'yi kapat - ses bozukluğunu önlemek için
                    if (window.aurivo.audio.autoGain) {
                        window.aurivo.audio.autoGain.setEnabled(false);
                        console.log('AGC devre dışı bırakıldı');
                    }

                    // ✨ EQ ayarlarını yükle ve uygula
                    await loadAndApplyEQSettings();
                } else {
                    useNativeAudio = false;
                    nativeAudioAvailable = false;
                    console.warn('C++ Audio Engine başlatılamadı:', initResult?.error);
                }
            } else {
                useNativeAudio = false;
                nativeAudioAvailable = false;
            }
        }
    } catch (e) {
        console.error('Native audio kontrol hatası:', e);
        useNativeAudio = false;
        nativeAudioAvailable = false;
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
    elements.securityBtn = document.getElementById('securityBtn');
    elements.infoBtn = document.getElementById('infoBtn');
    elements.aboutModalOverlay = document.getElementById('aboutModalOverlay');
    elements.aboutCloseBtn = document.getElementById('aboutCloseBtn');
    elements.aboutGithubBtn = document.getElementById('aboutGithubBtn');
    elements.aboutCheckUpdateBtn = document.getElementById('aboutCheckUpdateBtn');
    elements.infoUpdateBadge = document.getElementById('infoUpdateBadge');

    // Update UI
    elements.updateBanner = document.getElementById('updateBanner');
    elements.updateBannerText = document.getElementById('updateBannerText');
    elements.updateBannerDetailsBtn = document.getElementById('updateBannerDetailsBtn');
    elements.updateBannerUpdateBtn = document.getElementById('updateBannerUpdateBtn');
    elements.updateBannerDismissBtn = document.getElementById('updateBannerDismissBtn');

    elements.updateModalOverlay = document.getElementById('updateModalOverlay');
    elements.updateModalClose = document.getElementById('updateModalClose');
    elements.updateCloseBtn = document.getElementById('updateCloseBtn');
    elements.updateActionBtn = document.getElementById('updateActionBtn');
    elements.updateStatusText = document.getElementById('updateStatusText');
    elements.updateVersionText = document.getElementById('updateVersionText');
    elements.updateNotesTitle = document.getElementById('updateNotesTitle');
    elements.updateNotesText = document.getElementById('updateNotesText');
    elements.updateProgressWrap = document.getElementById('updateProgressWrap');
    elements.updateProgressFill = document.getElementById('updateProgressFill');
    elements.updateProgressText = document.getElementById('updateProgressText');

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
    elements.webDrawerToggleBtn = document.getElementById('webDrawerToggleBtn');

    // Şimdi Çalıyor
    elements.nowPlayingLabel = document.getElementById('nowPlayingLabel');

    // Sayfalar
    elements.musicPage = document.getElementById('musicPage');
    elements.videoPage = document.getElementById('videoPage');
    elements.webPage = document.getElementById('webPage');
    elements.settingsPage = document.getElementById('settingsPage');
    elements.securityPage = document.getElementById('securityPage');
    elements.pages = document.querySelectorAll('.page');
    elements.videoSfxModal = document.getElementById('videoSfxModal');
    elements.videoSfxFrame = document.getElementById('videoSfxFrame');
    elements.videoSfxCloseBtn = document.getElementById('videoSfxCloseBtn');

    // Çalma Listesi
    elements.playlist = document.getElementById('playlist');
    elements.musicAddFolderBtn = document.getElementById('musicAddFolderBtn');
    elements.musicAddFilesBtn = document.getElementById('musicAddFilesBtn');
    elements.musicSortPlaylistBtn = document.getElementById('musicSortPlaylistBtn');
    elements.videoAddFolderBtn = document.getElementById('videoAddFolderBtn');
    elements.videoAddFilesBtn = document.getElementById('videoAddFilesBtn');

    // Video ve Web
    elements.videoPlayer = document.getElementById('videoPlayer');
    elements.webView = document.getElementById('webView');

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
    elements.settingsApply = document.getElementById('settingsApply');
    elements.settingsCancel = document.getElementById('settingsCancel');
    elements.resetPlayback = document.getElementById('resetPlayback');
    elements.languageSelect = document.getElementById('languageSelect');
    elements.restartModalOverlay = document.getElementById('restartModalOverlay');
    elements.restartModalClose = document.getElementById('restartModalClose');
    elements.restartModalYes = document.getElementById('restartModalYes');
    elements.restartModalNo = document.getElementById('restartModalNo');

    // Güvenlik (uygulama içi sayfa)
    elements.closeSecurity = document.getElementById('closeSecurity');
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
    hideUtilityPage(elements.securityPage, elements.securityBtn);
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

        // Çalma ayarları: eski sürümlerle geriye dönük uyumlu normalize.
        const pb = state.settings.playback || {};
        const normalizedCrossfadeMs = (() => {
            const raw = Number(
                pb.crossfadeMs ??
                pb.crossfadeDurationMs ??
                pb.crossfadeDuration ??
                2000
            );
            if (!Number.isFinite(raw)) return 2000;
            return Math.max(0, Math.min(15000, Math.round(raw)));
        })();
        const normalizedPauseFadeMs = (() => {
            const raw = Number(pb.pauseFadeMs ?? pb.pauseFade ?? 250);
            if (!Number.isFinite(raw)) return 250;
            return Math.max(0, Math.min(3000, Math.round(raw)));
        })();
        state.settings.playback = {
            crossfadeStopEnabled: !!(pb.crossfadeStopEnabled ?? pb.crossfadeStop ?? true),
            crossfadeManualEnabled: !!(pb.crossfadeManualEnabled ?? pb.crossfadeManual ?? true),
            crossfadeAutoEnabled: !!(pb.crossfadeAutoEnabled ?? pb.crossfadeAuto ?? true),
            sameAlbumNoCrossfade: !!(pb.sameAlbumNoCrossfade ?? pb.sameAlbumNo ?? false),
            crossfadeMs: normalizedCrossfadeMs,
            fadeOnPauseResume: !!(pb.fadeOnPauseResume ?? pb.fadeOnPause ?? false),
            pauseFadeMs: normalizedPauseFadeMs
        };

        // Tam ekran video ayarları için varsayılanlar
        if (!state.settings.videoFullscreen) {
            state.settings.videoFullscreen = {
                stableVolume: false,
                volumeBoost: false,
                cinematicLighting: true,
                annotations: true,
                sleepTimerMinutes: 0,
                subtitles: 'off'
            };
        }
        if (!state.settings.security || typeof state.settings.security !== 'object') {
            state.settings.security = {
                strictVpnBlock: false
            };
        }

        // UI'yi güncelle
        elements.volumeSlider.value = state.volume;
        elements.volumeLabel.textContent = state.volume + '%';
        elements.audio.volume = state.volume / 100;

        if (state.isShuffle) elements.shuffleBtn.classList.add('active');
        if (state.isRepeat) elements.repeatBtn.classList.add('active');
    }
}

async function saveSettings() {
    if (window.aurivo && state.settings) {
        state.settings.volume = state.volume;
        state.settings.shuffle = state.isShuffle;
        state.settings.repeat = state.isRepeat;
        await window.aurivo.saveSettings(state.settings);
    }
}

// ============================================
// OLAY DİNLEYİCİLERİ
// ============================================
function setupEventListeners() {
    // Kenar çubuğu Gezinti
    elements.sidebarBtns.forEach(btn => {
        btn.addEventListener('click', () => handleSidebarClick(btn));
    });

    if (elements.settingsBtn) elements.settingsBtn.addEventListener('click', openSettings);
    if (elements.securityBtn) elements.securityBtn.addEventListener('click', openSecurity);
    if (elements.infoBtn) elements.infoBtn.addEventListener('click', showAbout);
    if (elements.aboutCloseBtn) elements.aboutCloseBtn.addEventListener('click', closeAboutModal);
    if (elements.aboutCheckUpdateBtn) {
        elements.aboutCheckUpdateBtn.addEventListener('click', async () => {
            openUpdateModal();
            await requestUpdateCheck();
        });
    }
    if (elements.aboutGithubBtn) {
        elements.aboutGithubBtn.addEventListener('click', async () => {
            // Canonical repo for downloads/updates.
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

    if (elements.updateBannerDetailsBtn) {
        elements.updateBannerDetailsBtn.addEventListener('click', () => {
            openUpdateModal();
        });
    }
    if (elements.updateBannerUpdateBtn) {
        elements.updateBannerUpdateBtn.addEventListener('click', async () => {
            openUpdateModal();
            await handlePrimaryUpdateAction();
        });
    }
    if (elements.updateBannerDismissBtn) {
        elements.updateBannerDismissBtn.addEventListener('click', () => {
            updateUi.dismissed = true;
            updateUi.dismissedVersion = String(updateUi.state?.version || '');
            hideUpdateBanner();
        });
    }

    if (elements.updateModalClose) elements.updateModalClose.addEventListener('click', closeUpdateModal);
    if (elements.updateCloseBtn) elements.updateCloseBtn.addEventListener('click', closeUpdateModal);
    if (elements.updateModalOverlay) {
        elements.updateModalOverlay.addEventListener('click', (e) => {
            if (e.target === elements.updateModalOverlay) closeUpdateModal();
        });
    }
    if (elements.updateActionBtn) {
        elements.updateActionBtn.addEventListener('click', handlePrimaryUpdateAction);
    }

    // Video içi embedded SFX paneli
    if (elements.videoSfxCloseBtn) {
        elements.videoSfxCloseBtn.addEventListener('click', () => closeEmbeddedVideoSfxPanel());
    }
    if (elements.videoSfxModal) {
        elements.videoSfxModal.addEventListener('click', (e) => {
            if (e.target === elements.videoSfxModal) closeEmbeddedVideoSfxPanel();
        });
    }
    if (elements.videoSfxFrame) {
        elements.videoSfxFrame.addEventListener('load', () => {
            postEmbeddedVideoSfxLanguage(currentUiLanguage());
            if (elements.videoSfxModal && !elements.videoSfxModal.classList.contains('hidden')) {
                postEmbeddedVideoSfxAnimControl('resume');
            } else {
                postEmbeddedVideoSfxAnimControl('pause');
            }
        });
    }
    window.addEventListener('message', (e) => {
        const t = String(e?.data?.type || '');
        if (t === 'sfx:closeEmbedded') closeEmbeddedVideoSfxPanel();
        if (t === 'sfx:videoUpdate') {
            try { handleSfxUpdateForVideo(e?.data?.payload || {}); } catch { }
        }
    });

    // Yeniden başlatma modalı (dil)
    if (elements.restartModalClose) elements.restartModalClose.addEventListener('click', closeRestartModal);
    if (elements.restartModalNo) elements.restartModalNo.addEventListener('click', closeRestartModal);
    if (elements.restartModalYes) {
        elements.restartModalYes.addEventListener('click', async () => {
            try {
                const ok = await window.aurivo?.app?.relaunch?.();
                if (!ok) closeRestartModal();
            } catch {
                closeRestartModal();
            }
        });
    }
    if (elements.restartModalOverlay) {
        elements.restartModalOverlay.addEventListener('click', (e) => {
            if (e.target === elements.restartModalOverlay) closeRestartModal();
        });
    }

    // Web Platformları
    elements.platformBtns.forEach(btn => {
        btn.addEventListener('click', () => handlePlatformClick(btn));
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

    // Klasör bağlam menüsü dışına tıklanınca kapat
    document.addEventListener('click', () => {
        const menu = document.getElementById('folderContextMenu');
        if (menu) menu.classList.add('hidden');
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
    elements.rewindBtn.addEventListener('click', () => seekBy(-10));
    elements.forwardSeekBtn.addEventListener('click', () => seekBy(10));


    // Müzik/Video araç çubuğu düğmeleri (kullanıcı hızlı ekleme)
    if (elements.musicAddFolderBtn) {
        elements.musicAddFolderBtn.addEventListener('click', async () => {
            try {
                state.mediaFilter = 'audio';
                const res = await window.aurivo?.dialog?.openFolder?.({
                    title: 'Müzik klasörü seç',
                    defaultPath: state.specialPaths?.music || undefined
                });
                if (res?.path) addUserFolder(res.path, res.name || window.aurivo?.path?.basename?.(res.path) || 'Klasör', 'audio');
            } catch (e) {
                safeNotify('Klasör seçilemedi: ' + (e?.message || e), 'error');
            }
        });
    }

    if (elements.musicAddFilesBtn) {
        elements.musicAddFilesBtn.addEventListener('click', async () => {
            try {
                state.mediaFilter = 'audio';
                const files = await window.aurivo?.dialog?.openFiles?.({
                    title: 'Müzik dosyalarını seç',
                    filters: [
                        { name: 'Müzik Dosyaları', extensions: AUDIO_EXTENSIONS },
                        { name: 'Tüm Dosyalar', extensions: ['*'] }
                    ]
                });
                if (!files || !files.length) return;

                let addedCount = 0;
                const prevDefer = state.deferPlaylistSort;
                state.deferPlaylistSort = true;
                try {
                    for (const f of files) {
                        const { added } = addToPlaylist(f.path, f.name);
                        if (added) addedCount++;
                    }
                } finally {
                    state.deferPlaylistSort = prevDefer;
                }
                if (state.autoSortPlaylist && !state.deferPlaylistSort) {
                    sortPlaylistByName(state.playlistSortOrder || 'asc');
                }
                if (addedCount) safeNotify(`${addedCount} dosya eklendi`, 'success');
                if (state.currentIndex === -1 && state.playlist.length) {
                    playIndex(0);
                }
            } catch (e) {
                safeNotify('Dosya seçilemedi: ' + (e?.message || e), 'error');
            }
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
                if (res?.path) addUserFolder(res.path, res.name || window.aurivo?.path?.basename?.(res.path) || 'Klasör', 'video');
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
                        { name: 'Video Dosyaları', extensions: VIDEO_EXTENSIONS },
                        { name: 'Tüm Dosyalar', extensions: ['*'] }
                    ]
                });
                if (!files || !files.length) return;

                state.videoFiles = files.map((f) => ({ name: f.name, path: f.path }));
                playVideo(state.videoFiles[0].path);
            } catch (e) {
                safeNotify('Video seçilemedi: ' + (e?.message || e), 'error');
            }
        });
    }

    // Görselleştirici (projectM)
    const visualizerBtn = document.getElementById('visualizer-btn');
    if (visualizerBtn) {
        visualizerBtn.addEventListener('click', async () => {
            if (window.app && window.app.visualizer && typeof window.app.visualizer.start === 'function') {
                await window.app.visualizer.start();
            } else {
                console.warn('Visualizer API yok (window.app.visualizer.start)');
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

    // Ses Seviyesi kaydırıcısı - tek tıkla ayarlama
    elements.volumeSlider.addEventListener('click', handleVolumeClick);

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
    if (elements.settingsOk) elements.settingsOk.addEventListener('click', () => { applySettings(); closeSettings(); });
    if (elements.settingsApply) elements.settingsApply.addEventListener('click', applySettings);

    if (elements.settingsTabs && elements.settingsTabs.length) {
        elements.settingsTabs.forEach(tab => {
            tab.addEventListener('click', () => switchSettingsTab(tab));
        });
    }

    if (elements.resetPlayback) elements.resetPlayback.addEventListener('click', resetPlaybackDefaults);

    // Çapraz Geçiş Otomatik onay kutusu bağımlılığı
    const crossfadeAuto = document.getElementById('crossfadeAuto');
    const sameAlbumNo = document.getElementById('sameAlbumNoCrossfade');
    if (crossfadeAuto && sameAlbumNo) {
        crossfadeAuto.addEventListener('change', () => {
            sameAlbumNo.disabled = !crossfadeAuto.checked;
        });
    }

    // Klavye Kısayolları
    document.addEventListener('keydown', handleKeyboard);

    // Sürükle & Bırak - geliştirilmiş
    setupDragAndDrop();

    // İndirme UI

    // Güvenlik UI
    setupSecurityUI();

    // WebView Gezinti Olayları (YouTube parça değişimi tespiti)
    if (elements.webView) {
        // Stability: auto retry + crash recovery
        attachWebViewEvents(elements.webView);

        elements.webView.addEventListener('did-navigate', handleWebNavigation);
        elements.webView.addEventListener('did-navigate-in-page', handleWebNavigation);
        elements.webView.addEventListener('new-window', (e) => {
            const target = e?.url;
            const parsed = parseHttpUrl(target);
            if (!parsed) return;
            if (!isAllowedWebUrl(parsed.toString())) return;

            // OAuth/login akışları popup ile çalışır; popup izni açıksa pencereyi engelleme.
            const popupsEnabled = !!elements.webView?.hasAttribute?.('allowpopups');
            if (popupsEnabled) return;

            e.preventDefault();
            try { elements.webView.loadURL(parsed.toString()); } catch { }
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
            elements.webView.executeJavaScript(`
                try {
                    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
                    if (!window.chrome) window.chrome = { runtime: {} };
                    (function() {
                        const send = (payload) => {
                            try { console.log('AURIVO_SYNC:' + JSON.stringify(payload)); } catch(e) {}
                        };

                        let lastMetaKey = '';
                        let lastTimeKey = '';
                        let lastVolumeKey = '';
                        let lastMedia = null;

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
                        });
                        observer.observe(document.documentElement || document.body, { childList: true, subtree: true });

                        const media = document.querySelector('video, audio');
                        if (media) attachEvents(media);

                        setInterval(() => {
                            emitMetadata(false);
                            emitTime(false);
                            emitVolume(false);
                        }, 900);

                        emitMetadata(true);
                        emitTime(true);
                        emitVolume(true);
                    })();
                } catch(e) { console.error("AURIVO_SYNC error:", e); }
            `);
            setTimeout(() => {
                pushAppVolumeToWeb();
            }, 120);
        });
    }

    if (elements.musicSortPlaylistBtn) {
        updateMusicSortPlaylistBtnUi();
        elements.musicSortPlaylistBtn.addEventListener('click', () => {
            sortPlaylistByName();
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

const WEB_ALLOWED_HOSTS = new Set([
    'google.com',
    'www.google.com',
    'youtube.com',
    'www.youtube.com',
    'm.youtube.com',
    'music.youtube.com',
    'youtube-nocookie.com',
    'www.youtube-nocookie.com',
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
    '.youtube-nocookie.com',
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

// ============================================
// UPDATE MODAL + BANNER
// ============================================
function isUpdateModalOpen() {
    return Boolean(elements.updateModalOverlay && !elements.updateModalOverlay.classList.contains('hidden'));
}

function openUpdateModal() {
    if (!elements.updateModalOverlay) return;
    elements.updateModalOverlay.classList.remove('hidden');
    requestAnimationFrame(() => {
        elements.updateCloseBtn?.focus?.();
    });
}

function closeUpdateModal() {
    if (!elements.updateModalOverlay) return;
    elements.updateModalOverlay.classList.add('hidden');
}

function showUpdateBanner() {
    if (!elements.updateBanner) return;
    elements.updateBanner.classList.remove('hidden');
}

function hideUpdateBanner() {
    if (!elements.updateBanner) return;
    elements.updateBanner.classList.add('hidden');
}

function getUiLangCode() {
    try {
        const raw = String(window?.i18n?.locale || '').trim();
        if (!raw) return 'en';
        return raw.split('-')[0].toLowerCase() || 'en';
    } catch {
        return 'en';
    }
}

function getLocalizedText(key, lang) {
    const L = (lang || getUiLangCode() || 'en').toLowerCase();
    const dict = {
        updateNotesTitle: {
            tr: 'Yapılan iyileştirmeler',
            en: 'Improvements',
            ar: 'التحسينات',
            de: 'Verbesserungen',
            fr: 'Améliorations',
            es: 'Mejoras',
            it: 'Miglioramenti',
            pt: 'Melhorias',
            ru: 'Улучшения',
            uk: 'Покращення',
            fi: 'Parannukset',
            hu: 'Fejlesztések',
            el: 'Βελτιώσεις',
            ja: '改善点',
            zh: '改进',
            vi: 'Cải tiến',
            fa: 'بهبودها',
            hi: 'सुधार',
            bn: 'উন্নয়ন',
            ne: 'सुधारहरू',
            pl: 'Ulepszenia'
        },
        updateNotesFallback: {
            tr: 'Sürüm notları eklenmedi. Detaylar için GitHub Releases sayfasına bakın.',
            en: 'Release notes are not available. Please check the GitHub Releases page for details.',
            ar: 'ملاحظات الإصدار غير متاحة. يرجى مراجعة صفحة GitHub Releases للتفاصيل.',
            de: 'Keine Versionshinweise verfügbar. Bitte prüfe die GitHub-Releases-Seite für Details.',
            fr: 'Notes de version indisponibles. Consultez la page GitHub Releases pour les détails.',
            es: 'No hay notas de versión disponibles. Revisa la página de GitHub Releases para más detalles.',
            it: 'Note di rilascio non disponibili. Controlla la pagina GitHub Releases per i dettagli.',
            pt: 'Notas da versão indisponíveis. Veja a página de GitHub Releases para detalhes.',
            ru: 'Заметки о выпуске недоступны. Подробности смотрите на странице GitHub Releases.',
            uk: 'Нотатки до релізу недоступні. Перевірте сторінку GitHub Releases для деталей.',
            fi: 'Julkaisutiedot eivät ole saatavilla. Katso lisätiedot GitHub Releases -sivulta.',
            hu: 'A kiadási megjegyzések nem érhetők el. Részletekért nézd meg a GitHub Releases oldalt.',
            el: 'Δεν υπάρχουν σημειώσεις έκδοσης. Δες τη σελίδα GitHub Releases για λεπτομέρειες.',
            ja: 'リリースノートがありません。詳細は GitHub Releases ページをご確認ください。',
            zh: '暂无发行说明。请在 GitHub Releases 页面查看详情。',
            vi: 'Chưa có ghi chú phát hành. Vui lòng xem trang GitHub Releases để biết chi tiết.',
            fa: 'یادداشت‌های انتشار در دسترس نیست. لطفاً صفحه GitHub Releases را ببینید.',
            hi: 'रिलीज़ नोट्स उपलब्ध नहीं हैं। विवरण के लिए GitHub Releases पेज देखें।',
            bn: 'রিলিজ নোটস নেই। বিস্তারিত জানতে GitHub Releases পেজ দেখুন।',
            ne: 'रिलिज नोटहरू उपलब्ध छैनन्। विवरणका लागि GitHub Releases पेज हेर्नुहोस्।',
            pl: 'Brak informacji o wydaniu. Szczegóły znajdziesz na stronie GitHub Releases.'
        }
        ,
        updateUnsupportedLinuxPm: {
            tr: 'Bu Linux kurulum türünde otomatik güncelleme desteklenmiyor. Lütfen paket yöneticinizle güncelleyin (örn. APT/DNF/Pacman) veya AppImage sürümünü kullanın.',
            en: 'In-app updates are not supported for this Linux install type. Please update via your package manager (e.g., APT/DNF/Pacman) or use the AppImage build.',
            ar: 'التحديث داخل التطبيق غير مدعوم لهذا النوع من تثبيت لينكس. يرجى التحديث عبر مدير الحزم أو استخدام إصدار AppImage.',
            de: 'In-App-Updates werden für diese Linux-Installation nicht unterstützt. Bitte über den Paketmanager aktualisieren oder die AppImage-Version verwenden.',
            fr: 'Les mises à jour intégrées ne sont pas prises en charge pour ce type d’installation Linux. Mettez à jour via le gestionnaire de paquets ou utilisez AppImage.',
            es: 'Las actualizaciones dentro de la app no están soportadas para este tipo de instalación Linux. Actualiza con tu gestor de paquetes o usa AppImage.',
            it: 'Gli aggiornamenti in-app non sono supportati per questo tipo di installazione Linux. Aggiorna tramite package manager o usa AppImage.',
            pt: 'Atualizações no aplicativo não são suportadas para este tipo de instalação no Linux. Atualize via gerenciador de pacotes ou use AppImage.',
            ru: 'Встроенные обновления не поддерживаются для этого типа установки Linux. Обновляйте через менеджер пакетов или используйте AppImage.',
            uk: 'Вбудовані оновлення не підтримуються для цього типу інсталяції Linux. Оновлюйте через менеджер пакунків або використовуйте AppImage.',
            fi: 'Sovelluksen sisäisiä päivityksiä ei tueta tälle Linux-asennustyypille. Päivitä pakettienhallinnalla tai käytä AppImage-versiota.',
            hu: 'Ehhez a Linux telepítési típushoz nem támogatott a beépített frissítés. Frissíts csomagkezelővel vagy használd az AppImage verziót.',
            el: 'Οι ενσωματωμένες ενημερώσεις δεν υποστηρίζονται για αυτόν τον τύπο εγκατάστασης Linux. Ενημερώστε μέσω διαχειριστή πακέτων ή χρησιμοποιήστε AppImage.',
            ja: 'この Linux インストール形式ではアプリ内更新はサポートされません。パッケージマネージャーで更新するか AppImage 版を使用してください。',
            zh: '此 Linux 安装方式不支持应用内更新。请使用系统包管理器更新，或改用 AppImage 版本。',
            vi: 'Không hỗ trợ cập nhật trong ứng dụng cho kiểu cài đặt Linux này. Hãy cập nhật bằng trình quản lý gói hoặc dùng bản AppImage.',
            fa: 'به‌روزرسانی داخل برنامه برای این نوع نصب لینوکس پشتیبانی نمی‌شود. لطفاً با مدیر بسته‌ها به‌روزرسانی کنید یا از AppImage استفاده کنید.',
            hi: 'इस Linux इंस्टॉल प्रकार के लिए इन-ऐप अपडेट समर्थित नहीं है। कृपया पैकेज मैनेजर से अपडेट करें या AppImage उपयोग करें।',
            bn: 'এই Linux ইনস্টল টাইপে ইন-অ্যাপ আপডেট সমর্থিত নয়। প্যাকেজ ম্যানেজার দিয়ে আপডেট করুন অথবা AppImage ব্যবহার করুন।',
            ne: 'यो Linux स्थापना प्रकारका लागि इन-एप अपडेट समर्थित छैन। प्याकेज म्यानेजरबाट अपडेट गर्नुहोस् वा AppImage प्रयोग गर्नुहोस्।',
            pl: 'Aktualizacje w aplikacji nie są obsługiwane dla tego typu instalacji Linuksa. Zaktualizuj przez menedżer pakietów lub użyj AppImage.'
        }
    };
    const table = dict[key] || {};
    return table[L] || table.en || '';
}

function normalizeReleaseNotesText(raw) {
    const s = String(raw || '').replace(/\r\n/g, '\n').trim();
    if (!s) return '';
    const lines = s.split('\n').map(l => l.trim()).filter(Boolean);
    const filtered = lines.filter(l => !/^full changelog:/i.test(l));
    const uniq = [];
    for (const l of filtered) {
        if (!uniq.includes(l)) uniq.push(l);
    }
    return uniq.join('\n').trim();
}

function pickLocalizedReleaseNotes(raw, lang) {
    const text = String(raw || '').replace(/\r\n/g, '\n');
    const re = /\[lang\s*=\s*([a-z]{2}(?:-[a-z]{2})?)\]([\s\S]*?)\[\/lang\]/gi;
    const map = {};
    let m;
    while ((m = re.exec(text))) {
        const k = String(m[1] || '').toLowerCase();
        const v = String(m[2] || '').trim();
        if (!k || !v) continue;
        map[k] = v;
        // Also map primary code for convenience.
        const primary = k.split('-')[0];
        if (primary && !map[primary]) map[primary] = v;
    }
    const want = String(lang || getUiLangCode() || 'en').toLowerCase();
    const wantPrimary = want.split('-')[0];
    return map[want] || map[wantPrimary] || map.en || map['en-us'] || '';
}

function setInfoUpdateBadgeVisible(visible) {
    if (!elements.infoUpdateBadge) return;
    elements.infoUpdateBadge.classList.toggle('hidden', !visible);
}

function setUpdateProgress(percent) {
    const p = Math.max(0, Math.min(100, Number(percent || 0)));
    if (elements.updateProgressFill) elements.updateProgressFill.style.width = `${p}%`;
    if (elements.updateProgressText) elements.updateProgressText.textContent = `${Math.round(p)}%`;
}

function updateUpdateUiFromState(st) {
    updateUi.state = st || null;

    const supported = !!st?.supported;
    const reason = String(st?.reason || '');
    const status = String(st?.status || 'idle');
    const available = !!st?.available;
    const version = String(st?.version || '');
    const lang = getUiLangCode();
    const rawNotes = String(st?.releaseNotes || '').trim();
    const localizedFromBlocks = pickLocalizedReleaseNotes(rawNotes, lang);
    const cleaned = normalizeReleaseNotesText(localizedFromBlocks || rawNotes);
    const linuxPmHint = (!supported && reason === 'linux-package-manager')
        ? (getLocalizedText('updateUnsupportedLinuxPm', lang) || '')
        : '';
    const notes = linuxPmHint || cleaned || getLocalizedText('updateNotesFallback', lang) || '-';
    const progress = Number(st?.progress || 0);
    const err = String(st?.error || '').trim();

    // Reset dismiss state when a new version appears
    if (available && version && updateUi.dismissed && updateUi.dismissedVersion && updateUi.dismissedVersion !== version) {
        updateUi.dismissed = false;
        updateUi.dismissedVersion = '';
    }

    setInfoUpdateBadgeVisible(available);

    if (elements.updateStatusText) {
        const map = {
            idle: 'Hazır',
            checking: 'Kontrol ediliyor...',
            available: 'Güncelleme bulundu',
            'not-available': 'Güncelleme yok',
            downloading: 'İndiriliyor...',
            downloaded: 'Kuruluma hazır',
            error: 'Hata'
        };
        elements.updateStatusText.textContent = map[status] || status;
    }
    if (elements.updateVersionText) elements.updateVersionText.textContent = version || '-';
    if (elements.updateNotesTitle) {
        elements.updateNotesTitle.textContent = getLocalizedText('updateNotesTitle', lang) || elements.updateNotesTitle.textContent;
    }
    if (elements.updateNotesText) elements.updateNotesText.textContent = notes;

    if (elements.updateProgressWrap) {
        const show = status === 'downloading' || status === 'downloaded';
        elements.updateProgressWrap.classList.toggle('hidden', !show);
    }
    if (elements.updateProgressFill) {
        elements.updateProgressFill.classList.toggle('is-downloading', status === 'downloading');
    }
    setUpdateProgress(progress);

    if (elements.updateActionBtn) {
        if (!supported) {
            elements.updateActionBtn.textContent = (reason === 'linux-package-manager') ? 'Paket yöneticisi' : 'Desteklenmiyor';
            elements.updateActionBtn.disabled = true;
        } else if (status === 'downloaded') {
            elements.updateActionBtn.textContent = 'Yeniden başlat ve kur';
            elements.updateActionBtn.disabled = false;
        } else if (status === 'downloading') {
            elements.updateActionBtn.textContent = 'İndiriliyor...';
            elements.updateActionBtn.disabled = true;
        } else if (available) {
            elements.updateActionBtn.textContent = 'Güncelle';
            elements.updateActionBtn.disabled = false;
        } else {
            elements.updateActionBtn.textContent = 'Güncelleme denetle';
            elements.updateActionBtn.disabled = false;
        }
    }

    // Banner logic: only show when update is available/downloading/downloaded/error.
    if (!elements.updateBanner || !elements.updateBannerText) return;

    if (updateUi.dismissed && available && version && updateUi.dismissedVersion === version) {
        hideUpdateBanner();
        return;
    }

    if (status === 'available') {
        elements.updateBannerText.textContent = `Yeni sürüm var: ${version || ''}`.trim();
        if (elements.updateBannerUpdateBtn) elements.updateBannerUpdateBtn.disabled = false;
        showUpdateBanner();
    } else if (status === 'downloading') {
        elements.updateBannerText.textContent = `Güncelleme indiriliyor: ${Math.round(progress)}%`;
        if (elements.updateBannerUpdateBtn) elements.updateBannerUpdateBtn.disabled = true;
        showUpdateBanner();
    } else if (status === 'downloaded') {
        elements.updateBannerText.textContent = 'Güncelleme indirildi. Kuruluma hazır.';
        if (elements.updateBannerUpdateBtn) {
            elements.updateBannerUpdateBtn.disabled = false;
            elements.updateBannerUpdateBtn.textContent = 'Kur';
        }
        showUpdateBanner();
    } else if (status === 'error') {
        elements.updateBannerText.textContent = `Güncelleme hatası: ${err || 'Bilinmeyen hata'}`;
        if (elements.updateBannerUpdateBtn) elements.updateBannerUpdateBtn.disabled = false;
        showUpdateBanner();
    } else {
        // Default: keep banner hidden
        hideUpdateBanner();
        if (elements.updateBannerUpdateBtn) elements.updateBannerUpdateBtn.textContent = 'Güncelle';
    }
}

async function requestUpdateCheck() {
    try {
        const res = await window.aurivo?.updater?.check?.();
        // Res is the state snapshot; actual updates come via event as well.
        if (res && typeof res === 'object') updateUpdateUiFromState(res);
        if (res?.status === 'not-available') safeNotify('Güncelleme yok.', 'info', 2000);
        if (res?.supported === false) {
            const lang = getUiLangCode();
            const reason = String(res?.reason || '');
            if (reason === 'linux-package-manager') {
                safeNotify(getLocalizedText('updateUnsupportedLinuxPm', lang) || 'Paket yöneticisi ile güncelleyin.', 'info', 4500);
            } else {
                safeNotify('Güncelleme denetimi paketli sürümde çalışır (installer).', 'info', 3500);
            }
        }
    } catch (e) {
        safeNotify('Güncelleme kontrolü başarısız: ' + (e?.message || e), 'error', 4000);
    }
}

async function handlePrimaryUpdateAction() {
    const st = updateUi.state || {};
    const supported = !!st.supported;
    const status = String(st.status || 'idle');
    const available = !!st.available;

    if (!supported) {
        const lang = getUiLangCode();
        const reason = String(st.reason || '');
        if (reason === 'linux-package-manager') {
            safeNotify(getLocalizedText('updateUnsupportedLinuxPm', lang) || 'Paket yöneticisi ile güncelleyin.', 'info', 4500);
        } else {
            safeNotify('Güncelleme denetimi paketli sürümde çalışır (installer).', 'info', 3500);
        }
        return;
    }

    try {
        if (status === 'downloaded') {
            await window.aurivo?.updater?.install?.();
            return;
        }

        if (available) {
            await window.aurivo?.updater?.download?.();
            return;
        }

        await requestUpdateCheck();
    } catch (e) {
        safeNotify('Güncelleme işlemi başarısız: ' + (e?.message || e), 'error', 4500);
    }
}

function initUpdaterUi() {
    try {
        if (window.aurivo?.updater?.onState) {
            window.aurivo.updater.onState((st) => {
                updateUpdateUiFromState(st);
            });
        }
    } catch { }

    // initial snapshot
    (async () => {
        try {
            const st = await window.aurivo?.updater?.getState?.();
            if (st && typeof st === 'object') updateUpdateUiFromState(st);
        } catch { }
    })();
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

function updateSecurityUI() {
    updateSecurityUIAsync();
}

async function updateSecurityUIAsync() {
    const url = getWebViewUrlSafe();
    const isHttps = url.startsWith('https://');
    const isHttp = url.startsWith('http://');
    const canOpenExternal = !!parseHttpUrl(url);
    const sec = await getSecurityStateSafe();

    if (elements.securityCurrentUrl) {
        elements.securityCurrentUrl.textContent = uiT('securityPage.dynamic.urlLine', 'URL: {url}', { url });
    }
    if (elements.securityConnStatus) {
        if (isHttps) elements.securityConnStatus.textContent = uiT('securityPage.dynamic.connSecure', 'Connection: Secure (HTTPS)');
        else if (isHttp) elements.securityConnStatus.textContent = uiT('securityPage.dynamic.connInsecure', 'Connection: Insecure (HTTP)');
        else elements.securityConnStatus.textContent = uiT('securityPage.dynamic.connUnknown', 'Connection: -');
    }

    if (elements.securityAllowPopups && elements.webView) {
        const has = elements.webView.hasAttribute('allowpopups');
        elements.securityAllowPopups.checked = has;
    }
    if (elements.securityStrictVpnBlock) {
        elements.securityStrictVpnBlock.checked = !!state.settings?.security?.strictVpnBlock;
    }

    const vpnEl = document.getElementById('securityVpnStatus');
    if (vpnEl) {
        if (sec.vpnDetected) {
            const list = (sec.vpnInterfaces || []).join(', ');
            vpnEl.textContent = uiT(
                'securityPage.dynamic.vpnDetected',
                'VPN: Algılandı ({interfaces})',
                {interfaces: list || '-'}
            );
        } else {
            vpnEl.textContent = uiT('securityPage.dynamic.vpnNotDetected', 'VPN: Algılanmadı');
        }
    }

    if (elements.securityOpenInBrowserBtn) {
        elements.securityOpenInBrowserBtn.disabled = !canOpenExternal;
        elements.securityOpenInBrowserBtn.style.opacity = canOpenExternal ? '1' : '0.55';
        elements.securityOpenInBrowserBtn.style.cursor = canOpenExternal ? 'pointer' : 'not-allowed';
    }
}

function openSecurity() {
    if (!elements.securityPage) return;
    hideUtilityPage(elements.settingsPage, elements.settingsBtn);
    showUtilityPage(elements.securityPage, elements.securityBtn);
    updateSecurityUI();
}

function closeSecurity() {
    hideUtilityPage(elements.securityPage, elements.securityBtn);
}

function setupSecurityUI() {
    if (!elements.securityPage) return;

    if (elements.closeSecurity) elements.closeSecurity.addEventListener('click', closeSecurity);

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
            (async () => {
                try {
                    // Clear cached web data, then rebuild the webview instance.
                    await window.aurivo?.webSecurity?.clearData?.({ all: true, storage: true, cache: true, cookies: true });
                } catch {
                    // best effort
                }
                try {
                    webRuntime.lastRequestedUrl = 'about:blank';
                    resetWebRuntime();
                    recreateWebView('manual-reset');
                    safeNotify(uiT('securityPage.notify.webResetOk', 'Web has been reset.'), 'success');
                    updateSecurityUI();
                } catch (e) {
                    safeNotify(uiT('securityPage.notify.webResetFailed', "Couldn't reset Web: {error}", { error: e?.message || e }), 'error');
                }
            })();
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
            case 'play-pause':
                togglePlayPause();
                break;
            case 'stop':
                if (state.activeMedia === 'video') {
                    stopVideo();
                } else if (state.activeMedia === 'web') {
                    stopWeb();
                } else {
                    stopAudio();
                }
                state.isPlaying = false;
                updatePlayPauseIcon(false);
                break;
            case 'previous':
                if (state.activeMedia === 'video') {
                    if (state.videoFiles.length > 1 && state.currentVideoIndex > 0) {
                        playPreviousVideo();
                    }
                } else if (state.activeMedia === 'audio') {
                    playPreviousWithCrossfade();
                }
                break;
            case 'next':
                if (state.activeMedia === 'video') {
                    if (state.videoFiles.length > 1 && state.currentVideoIndex >= 0 && state.currentVideoIndex < state.videoFiles.length - 1) {
                        playNextVideo();
                    }
                } else if (state.activeMedia === 'audio') {
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
            if (isStrictVpnBlockEnabled()) {
                elements.webView?.loadURL?.('about:blank');
                safeNotify(uiT('securityPage.notify.vpnBlocked', 'VPN algılandı. Güvenlik nedeniyle Web sekmesi geçici olarak engellendi.'), 'error');
                if (isPageVisible(elements.securityPage)) updateSecurityUI();
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
            elements.webView?.loadURL?.('about:blank');
            safeNotify(uiT('securityPage.notify.urlBlocked', 'Bu adres güvenlik politikası nedeniyle engellendi.'), 'error');
            if (isPageVisible(elements.securityPage)) updateSecurityUI();
            return;
        }
    }

    if (state.activeMedia === 'web') {
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
    if (isPageVisible(elements.securityPage)) {
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
        canGoNext = false;
        canGoPrevious = false;
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

    // Bırakılan dosyaları yakala:
    // - Playlist üstüne bırakınca drop event'i stopPropagation ile body'ye gitmiyor.
    //   Bu yüzden dropZone'a da bağla.
    // - Playlist dışına bırakınca body handler yakalar.
    dropZone.addEventListener('drop', handleFileDrop, false);
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

    video.addEventListener('waiting', () => {
        if (state.activeMedia === 'video') {
            console.warn('[SFX-VID] video waiting', { readyState: video.readyState, networkState: video.networkState });
        }
    });

    video.addEventListener('stalled', () => {
        if (state.activeMedia === 'video') {
            console.warn('[SFX-VID] video stalled', { readyState: video.readyState, networkState: video.networkState });
        }
    });

    // Video bittiğinde
    video.addEventListener('ended', () => {
        if (state.activeMedia === 'video') {
            state.isPlaying = false;
            updatePlayPauseIcon(false);
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
            updateTrayState();
            updateMPRISMetadata();
        }
    });

    video.addEventListener('pause', () => {
        if (state.activeMedia === 'video') {
            if (shouldKeepVideoAliveForSfx()) {
                console.warn('[SFX-VID] pause intercepted -> auto-resume', {
                    sfxOpen: soundEffectsWindowOpen,
                    force: forceVideoPlaybackForSfx,
                    manual: videoManualPauseByUser,
                    guard: Date.now() < videoPauseGuardUntil,
                    openGuard: Date.now() < sfxOpenGuardUntil,
                    hidden: document.hidden
                });
                setTimeout(() => {
                    try {
                        if (state.activeMedia === 'video' && elements.videoPlayer?.paused) {
                            elements.videoPlayer.play().catch(() => { });
                        }
                    } catch { }
                }, 60);
                return;
            }
            state.isPlaying = false;
            updatePlayPauseIcon(false);
            updateTrayState();
            updateMPRISMetadata();
        }
    });

    // Some systems pause HTML5 video when focus changes between app windows.
    window.addEventListener('blur', () => {
        if (shouldKeepVideoAliveForSfx()) {
            setTimeout(() => { try { resumeVideoAfterAuxWindowOpen(); } catch { } }, 80);
        }
    });
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            postEmbeddedVideoSfxAnimControl('pause');
        } else if (elements.videoSfxModal && !elements.videoSfxModal.classList.contains('hidden')) {
            postEmbeddedVideoSfxAnimControl('resume');
        }
        if (shouldKeepVideoAliveForSfx()) {
            setTimeout(() => { try { resumeVideoAfterAuxWindowOpen(); } catch { } }, 80);
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
let fsVideoGainNode = null;

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
        if (!fsVideoGainNode) fsVideoGainNode = fsAudioCtx.createGain();
        fsVideoSourceNode.connect(fsVideoGainNode);
        fsVideoGainNode.connect(fsAudioCtx.destination);
        return true;
    } catch (e) {
        console.warn('[FS] audio graph failed:', e?.message || e);
        return false;
    }
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
    }, 100);
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

function handleSidebarClick(btn) {
    const page = btn.dataset.page;
    const panel = btn.dataset.panel;

    // Yardımcı pages should not remain open when switching tabs
    closeAllUtilityPages();

    // "İndir" sekmesi: Aurivo-Dawlod penceresini aç, mevcut sekmeyi bozmadan geri dön.
    if (page === 'download') {
        const prevActive = document.querySelector('.sidebar-btn[data-page].active');
        try {
            if (window.aurivo?.dawlod?.openWindow) {
                // Ensure Dawlod follows the app language (single source of truth).
                try {
                    const lang = window.i18n?.getLanguage?.();
                    if (lang && window.aurivo?.dawlod?.setLocale) {
                        window.aurivo.dawlod.setLocale(lang);
                    }
                } catch { }
                // Web sekmesindeyken mevcut URL'yi downloader'a otomatik taşı.
                const currentUrl = getWebViewUrlSafe();
                const u = parseHttpUrl(currentUrl);
                const urlToSend = u ? u.toString() : null;
                if (urlToSend && window.aurivo?.clipboard?.setText) {
                    // Dawlod host clipboard'tan da okuyabildiği için best-effort.
                    try { window.aurivo.clipboard.setText(urlToSend); } catch { }
                }
                window.aurivo.dawlod.openWindow(urlToSend ? { url: urlToSend } : undefined);
            } else {
                safeNotify('İndirme modülü bulunamadı (Aurivo-Dawlod).', 'error');
            }
        } catch (e) {
            safeNotify('İndirme penceresi açılamadı: ' + (e?.message || e), 'error');
        }
        // Active state'i eski sekmeye geri al
        try {
            elements.sidebarBtns.forEach(b => b.classList.remove('active'));
            if (prevActive) prevActive.classList.add('active');
        } catch { }
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
    try { updateNavButtons(); } catch { }

    // Sol panelde: aktif klasör yoksa kayıtlı klasörleri, varsa klasör içeriğini göster.
    try {
        if (panel === 'library') {
            // Sekme değiştirince önceki sekmenin açık klasörü taşınmasın.
            state.currentPath = '';
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
    }
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
            elements.webView.stop();
            // Sessiz sayfa yükle - about:blank kullan (data URL yerine)
            elements.webView.loadURL('about:blank');
        } catch (e) {
            // WebView henüz yüklenmemiş olabilir - yoksay
        }
    }
    // Platform butonlarından active kaldır
    elements.platformBtns.forEach(b => b.classList.remove('active'));
}

function switchPage(pageName) {
    // Yardımcı buttons should not stay active when switching main pages
    if (elements.settingsBtn) elements.settingsBtn.classList.remove('active');
    if (elements.securityBtn) elements.securityBtn.classList.remove('active');
    if (pageName !== 'video') closeEmbeddedVideoSfxPanel();

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
    const url = btn.dataset.url;
    const platform = btn.dataset.platform || 'web';
    const parsed = parseHttpUrl(url);
    if (!parsed) {
        safeNotify(uiT('securityPage.notify.invalidExternalUrl', 'Önce geçerli bir web sayfası açın (http/https).'), 'error');
        return;
    }

    const sec = await getSecurityStateSafe();
    if (sec.vpnDetected) {
        if (isStrictVpnBlockEnabled()) {
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

    // WebView'a URL yükle
    if (elements.webView) {
        try {
            try {
                elements.webView.setUserAgent(getEmbeddedDesktopUserAgent());
            } catch { }
            const nextUrl = parsed.toString();
            webRuntime.lastRequestedUrl = nextUrl;
            resetWebRuntime();
            // Bazı durumlarda loadURL sessiz fail edebiliyor; src fallback ile zorla.
            try {
                const maybePromise = elements.webView.loadURL(nextUrl);
                if (maybePromise && typeof maybePromise.then === 'function') {
                    maybePromise.catch(() => { });
                }
            } catch {
                // fall through
            }
            try {
                const cur = getWebViewUrlSafe();
                if (!cur || cur === 'about:blank' || cur === nextUrl) {
                    // no-op
                } else {
                    // If we are stuck, force by setting src.
                    // (loadURL may be blocked before guest is ready in some Electron builds)
                }
            } catch { }
            try {
                // Always set src too; Chromium will ignore if already on same URL.
                elements.webView.setAttribute('src', nextUrl);
            } catch { }
            try { updateNavButtons(); } catch { }
        } catch (e) {
            // Webview yükleme hatası - yoksay
            console.warn('WebView URL yükleme hatası:', e.message);
        }
    }

    // Web sayfasına geç
    switchPage('web');
    applyWebUiClasses();

    // Now playing güncelle
    const platformName = btn.querySelector('span').textContent;
    elements.nowPlayingLabel.textContent = `${uiT('nowPlaying.prefix', 'Now Playing')}: ${platformName}`;

    // Platform logosunu kapak olarak göster
    updatePlatformCover(platform);

    // Sistem entegrasyonunu güncelle (MPRIS/Tray)
    updateTrayState();
    updateMPRISMetadata();
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
    // Web panelinde geri/ileri/yenile butonlari WebView history'yi kontrol etmeli.
    const isWebUi = (state.currentPanel === 'web' || state.currentPage === 'web' || state.activeMedia === 'web') && !!elements.webView;
    if (isWebUi) {
        try {
            if (elements.webView.canGoBack && elements.webView.canGoBack()) {
                elements.webView.goBack();
            } else {
                console.log('[RENDERER] Web history boş, geri gidilemiyor');
            }
        } catch (e) {
            console.warn('[RENDERER] Web goBack hatası:', e?.message || e);
        }
        try { updateNavButtons(); } catch { }
        return;
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
    const isWebUi = (state.currentPanel === 'web' || state.currentPage === 'web' || state.activeMedia === 'web') && !!elements.webView;
    if (isWebUi) {
        try {
            if (elements.webView.canGoForward && elements.webView.canGoForward()) {
                elements.webView.goForward();
            } else {
                console.log('[RENDERER] Web forward boş, ileri gidilemiyor');
            }
        } catch (e) {
            console.warn('[RENDERER] Web goForward hatası:', e?.message || e);
        }
        try { updateNavButtons(); } catch { }
        return;
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
    const isWebUi = (state.currentPanel === 'web' || state.currentPage === 'web' || state.activeMedia === 'web') && !!elements.webView;
    if (isWebUi) {
        try {
            const cur = getWebViewUrlSafe();
            if (cur && cur !== 'about:blank') {
                // reloadIgnoringCache is a bit more reliable for stuck pages.
                if (typeof elements.webView.reloadIgnoringCache === 'function') {
                    elements.webView.reloadIgnoringCache();
                } else {
                    elements.webView.reload();
                }
            }
        } catch (e) {
            console.warn('[RENDERER] Web reload hatası:', e?.message || e);
        }
        try { updateNavButtons(); } catch { }
        return;
    }

    if (state.currentPath) loadDirectory(state.currentPath, false);
}

function updateNavButtons() {
    if (!elements.backBtn || !elements.forwardBtn || !elements.refreshBtn) return;

    const isWebUi = (state.currentPanel === 'web' || state.currentPage === 'web' || state.activeMedia === 'web') && !!elements.webView;
    if (isWebUi) {
        let canBack = false;
        let canFwd = false;
        try { canBack = !!elements.webView.canGoBack?.(); } catch { }
        try { canFwd = !!elements.webView.canGoForward?.(); } catch { }

        elements.backBtn.disabled = !canBack;
        elements.forwardBtn.disabled = !canFwd;
        elements.refreshBtn.disabled = false;
        return;
    }

    // Library mode: back/forward sadece klasor history varsa aktif olsun.
    elements.backBtn.disabled = state.pathHistory.length === 0;
    elements.forwardBtn.disabled = state.pathForward.length === 0;
    elements.refreshBtn.disabled = false;
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

    const scope = getUserFoldersScope();
    const savedFolders = loadSavedFolders(scope);

    // Aktif klasör varsa onun içeriğini göster.
    if (state.currentPath) {
        await loadDirectory(state.currentPath, false);
        console.log('File Tree aktif klasör içeriğiyle yüklendi:', state.currentPath);
        return;
    }

    // Aktif klasör yoksa yalnızca kullanıcının eklediği klasörleri göster.
    elements.fileTree.innerHTML = '';
    savedFolders.forEach((folder) => {
        const label = folder?.name || window.aurivo?.path?.basename?.(folder.path) || 'Klasör';
        const item = createTreeItem(label, folder.path, true, '📁');
        item.classList.add('user-folder');
        item.dataset.userFolder = 'true';
        item.dataset.folderScope = scope;
        elements.fileTree.appendChild(item);
    });

    // Hiç klasör eklenmemişse boş panel yerine ipucu göster.
    if (!savedFolders.length) {
        const hint = document.createElement('div');
        hint.className = 'tree-empty';
        hint.textContent = uiT('library.emptyHint', 'Kütüphaneye klasör ekleyin veya şarkı sürükleyip bırakın.');
        elements.fileTree.appendChild(hint);
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
        const key = getUserFoldersStorageKey(scope);
        const saved = localStorage.getItem(key);
        return saved ? JSON.parse(saved) : [];
    } catch (e) {
        console.error('Klasörler yüklenemedi:', e);
        return [];
    }
}

function saveFolders(scope, folders) {
    try {
        const key = getUserFoldersStorageKey(scope);
        localStorage.setItem(key, JSON.stringify(folders));
    } catch (e) {
        console.error('Klasörler kaydedilemedi:', e);
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
            addUserFolder(result.path, result.name);
        }
    } catch (e) {
        console.error('Klasör seçme hatası:', e);
    }
}

// Kullanıcı klasörü ekle
function addUserFolder(path, name, scopeOverride = null) {
    const scope = scopeOverride || getUserFoldersScope();
    const folders = loadSavedFolders(scope);

    // Zaten ekli mi kontrol et
    if (folders.some(f => f.path === path)) {
        console.log('Bu klasör zaten ekli:', path);
        // Zaten kayıtlıysa sadece listeyi göster.
        state.currentPath = '';
        initializeFileTree();
        return;
    }

    folders.push({ name, path });
    saveFolders(scope, folders);

    // Klasörün kendisini listede göster; içeriği otomatik açma.
    state.currentPath = '';
    initializeFileTree();

    console.log('Klasör eklendi:', name, path);

}

// Kullanıcı klasörünü kaldır
function removeUserFolder(path) {
    const scope = getUserFoldersScope();
    let folders = loadSavedFolders(scope);
    folders = folders.filter(f => f.path !== path);
    saveFolders(scope, folders);

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
    const isVirtualDrop = item.dataset.virtualDrop === 'true';

    if (isDirectory) {
        loadDirectory(path);
    } else {
        // Dosyayı türüne göre ilgili sekmede çalıştır
        // Virtual drop view: never scan the whole folder (playMediaFromFolder).
        if (isVirtualDrop) {
            if (isVideoFile(name)) {
                setActiveSidebarByPage('video');
                state.currentPage = 'video';
                state.currentPanel = 'library';
                switchPage('video');
                playVideo(path);
            } else {
                setActiveSidebarByPage('music');
                state.currentPage = 'music';
                state.currentPanel = 'library';
                switchPage('music');
                addToPlaylist(path, name);
                playFile(path);
            }
            return;
        }

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
            <span>Kütüphaneden Kaldır</span>
        </div>
        <div class="context-menu-item" data-action="open">
            <span class="context-menu-icon">📂</span>
            <span>Klasörü Aç</span>
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
    initializeFileTree();
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
            icon = VIDEO_EXTENSIONS.includes(ext) ? '🎬' : '🎵';
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
        }
        return;
    }

    // Normal tıklama - sadece bu öğeyi seç
    document.querySelectorAll('.tree-item.file').forEach(i => i.classList.remove('selected'));
    item.classList.add('selected');
    lastClickedFileItem = item;
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
    const playTargetPath = filePath;
    const currentDirItems = await window.aurivo.readDirectory(dirPath);
    const collator = getUiCollator();
    const audioItems = currentDirItems
        .filter(i => i.isFile && isAudioFile(i.name))
        .sort((a, b) => compareNamesForSort(a?.name, b?.name, collator));

    const prevDefer = state.deferPlaylistSort;
    state.deferPlaylistSort = true;
    try {
        for (const item of audioItems) {
            addToPlaylist(item.path, item.name);
        }
    } finally {
        state.deferPlaylistSort = prevDefer;
    }

    if (state.autoSortPlaylist && !state.deferPlaylistSort) {
        sortPlaylistByName(state.playlistSortOrder || 'asc');
    }
    playIndexTarget = state.playlist.findIndex(i => i.path === playTargetPath);

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

async function loadDirectory(dirPath, pushHistory = true) {
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

        const items = await window.aurivo.readDirectory(dirPath);
        console.log('Okunan öğeler:', items.length);

        elements.fileTree.innerHTML = '';

        // Dosyaları filtrele - mediaFilter'a göre
        let files = items.filter(i => i.isFile);

        // mediaFilter'a göre filtreleme
        if (state.mediaFilter === 'audio') {
            // Sadece ses dosyalarını göster
            files = files.filter(i => {
                const ext = i.name.split('.').pop().toLowerCase();
                return AUDIO_EXTENSIONS.includes(ext);
            });
        } else if (state.mediaFilter === 'video') {
            // Sadece video dosyalarını göster
            files = files.filter(i => {
                const ext = i.name.split('.').pop().toLowerCase();
                return VIDEO_EXTENSIONS.includes(ext);
            });
        } else if (state.mediaFilter === 'web') {
            // Web sekmesinde dosya ağacı gösterilmez
            files = [];
        }

        {
            const collator = getUiCollator();
            files.sort((a, b) => compareNamesForSort(a?.name, b?.name, collator));
        }

        // Video sekmesinde klasördeki tüm videoları kaydet (sıralı çalma için)
        if (state.mediaFilter === 'video') {
            state.videoFiles = files.map(f => ({
                name: f.name,
                path: f.path
            }));
            console.log('Video dosyaları kaydedildi:', state.videoFiles.length);
        }

        // Klasör listelemeyi kaldırdık: sol panelde sadece medya dosyaları görünsün.

        // Dosyaları ekle (gizli dosyaları atla)
        files.forEach(item => {
            if (!item.name.startsWith('.')) {
                const treeItem = createTreeItem(item.name, item.path, false);
                elements.fileTree.appendChild(treeItem);
            }
        });

        console.log('Yüklendi:', files.length, 'dosya');

    } catch (error) {
        console.error('Klasör yükleme hatası:', error);
    }
}

function isMediaFile(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    return AUDIO_EXTENSIONS.includes(ext) || VIDEO_EXTENSIONS.includes(ext);
}

function isVideoFile(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    return VIDEO_EXTENSIONS.includes(ext);
}

function isAudioFile(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    return AUDIO_EXTENSIONS.includes(ext);
}

// ============================================
// PLAYLIST
// ============================================
async function loadPlaylist() {
    if (window.aurivo) {
        state.playlist = await window.aurivo.loadPlaylist();
        dedupePlaylistInPlace();
        if (state.autoSortPlaylist && Array.isArray(state.playlist) && state.playlist.length >= 2) {
            sortPlaylistByName(state.playlistSortOrder || 'asc');
        } else {
            renderPlaylist();
        }
    }
}

async function savePlaylistToDisk() {
    if (window.aurivo) {
        await window.aurivo.savePlaylist(state.playlist);
    }
}

function renderPlaylist() {
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

    state.playlist.forEach((item, index) => {
        const div = document.createElement('div');
        div.className = 'playlist-item';
        if (item.missing) {
            div.classList.add('missing');
            div.title = uiT('playlist.missing', 'Dosya silinmiş veya taşınmış.');
        }
        if (index === state.currentIndex) {
            div.classList.add('playing');
        }
        div.dataset.index = index;

        const icon = isVideoFile(item.name) ? '🎬' : '🎵';
        div.innerHTML = `
            <span class="item-index">${index + 1}</span>
            <span class="item-icon">${icon}</span>
            <span class="item-name">${item.name}</span>
            <button class="item-remove" data-index="${index}">✕</button>
        `;

        div.addEventListener('click', () => selectPlaylistItem(index));
        div.addEventListener('dblclick', () => {
            console.log('[PLAYLIST] Double-click on item', index, ':', item.name);
            playIndex(index);
        });

        // Kaldır butonu
        const removeBtn = div.querySelector('.item-remove');
        removeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            removeFromPlaylist(index);
        });

        elements.playlist.appendChild(div);
    });
}

function selectPlaylistItem(index) {
    document.querySelectorAll('.playlist-item').forEach(i => i.classList.remove('selected'));
    const item = elements.playlist.children[index];
    if (item) item.classList.add('selected');
}

function canonicalizeFilePath(p) {
    if (!p) return '';
    let s = String(p);
    // Strip Windows extended-length prefix if present.
    if (s.startsWith('\\\\?\\')) s = s.slice(4);
    // Normalize separators.
    s = s.replace(/\\/g, '/').replace(/\/+/g, '/');
    s = s.trim();
    // Windows paths are case-insensitive.
    if (/^[a-zA-Z]:\//.test(s)) s = s.toLowerCase();
    return s;
}

function canonicalizeTrackName(name) {
    let s = playlistSortKey(name);
    s = s.replace(/\s+/g, ' ').trim();
    let lower = s.toLowerCase();

    // Strip audio extension if present so "song.mp3" and "song.MP3" are considered the same.
    try {
        const exts = Array.isArray(AUDIO_EXTENSIONS) ? AUDIO_EXTENSIONS : [];
        for (const ext of exts) {
            const e = String(ext || '').toLowerCase().trim();
            if (!e) continue;
            const suffix = '.' + e;
            if (lower.endsWith(suffix)) {
                lower = lower.slice(0, -suffix.length).trim();
                break;
            }
        }
    } catch {
        // yoksay
    }

    return lower;
}

function stopMissingFileWatcher() {
    if (state.missingFileWatchTimer) {
        clearInterval(state.missingFileWatchTimer);
        state.missingFileWatchTimer = null;
    }
    state.missingFileWatchKey = null;
}

function markFileTreeItemMissingByPath(filePath) {
    const key = canonicalizeFilePath(filePath);
    if (!key || !elements.fileTree) return;

    try {
        const items = elements.fileTree.querySelectorAll('.tree-item.file');
        items.forEach((el) => {
            const p = el?.dataset?.path;
            if (!p) return;
            if (canonicalizeFilePath(p) !== key) return;
            el.classList.add('missing');
            el.title = uiT('playlist.missing', 'Dosya silinmiş veya taşınmış.');
        });
    } catch {
        // yoksay
    }
}

function clearFileTreeItemMissingByPath(filePath) {
    const key = canonicalizeFilePath(filePath);
    if (!key || !elements.fileTree) return;

    try {
        const items = elements.fileTree.querySelectorAll('.tree-item.file.missing');
        items.forEach((el) => {
            const p = el?.dataset?.path;
            if (!p) return;
            if (canonicalizeFilePath(p) !== key) return;
            el.classList.remove('missing');
            el.title = '';
        });
    } catch {
        // yoksay
    }
}

function markPlaylistItemMissingByPath(filePath, notify = true) {
    const key = canonicalizeFilePath(filePath);
    if (!key) return;

    let changed = false;
    for (const it of state.playlist) {
        if (canonicalizeFilePath(it?.path) === key && !it.missing) {
            it.missing = true;
            changed = true;
        }
    }

    if (changed) {
        renderPlaylist();
        savePlaylistToDisk();
    }

    // Sol listede (file tree) de silindi çizgisi göster.
    markFileTreeItemMissingByPath(filePath);

    if (notify && !state.missingFileWarned.has(key)) {
        state.missingFileWarned.add(key);
        safeNotify(
            uiT('playlist.notify.fileDeleted', 'Dosya silinmiş: {name}', { name: window.aurivo?.path?.basename?.(filePath) || filePath }),
            'warning',
            4500
        );
    }
}

function clearPlaylistItemMissingByPath(filePath, notify = false) {
    const key = canonicalizeFilePath(filePath);
    if (!key) return;

    let changed = false;
    for (const it of state.playlist) {
        if (canonicalizeFilePath(it?.path) === key && it.missing) {
            it.missing = false;
            changed = true;
        }
    }

    if (changed) {
        renderPlaylist();
        savePlaylistToDisk();
    }

    clearFileTreeItemMissingByPath(filePath);

    if (notify) {
        safeNotify(
            uiT('playlist.notify.fileRestored', 'Dosya geri geldi: {name}', { name: window.aurivo?.path?.basename?.(filePath) || filePath }),
            'success',
            2800
        );
    }
}

function startMissingFileWatcher(filePath) {
    stopMissingFileWatcher();
    if (!filePath || !window.aurivo?.fileExists) return;

    const key = canonicalizeFilePath(filePath);
    state.missingFileWatchKey = key;

    state.missingFileWatchTimer = setInterval(async () => {
        try {
            if (state.activeMedia !== 'audio') return;
            if (state.currentIndex < 0 || state.currentIndex >= state.playlist.length) return;
            const cur = state.playlist[state.currentIndex];
            if (!cur?.path) return;
            if (canonicalizeFilePath(cur.path) !== key) return;

            const ok = await window.aurivo.fileExists(cur.path);
            if (!ok) {
                // Don't stop playback; just mark and inform. Playback may continue due to OS file handle semantics.
                markPlaylistItemMissingByPath(cur.path, true);
                return;
            }

            // File came back (e.g. restored from Recycle Bin): clear missing flags.
            if (cur.missing) {
                clearPlaylistItemMissingByPath(cur.path, false);
                // allow future delete warnings again
                state.missingFileWarned.delete(key);
            }
        } catch {
            // yoksay
        }
    }, 2500);
}

function dedupePlaylistInPlace() {
    if (!Array.isArray(state.playlist) || state.playlist.length < 2) return;

    const keep = [];
    const seen = new Set();
    const seenName = new Set();

    const currentPathKey =
        state.currentIndex >= 0 && state.currentIndex < state.playlist.length
            ? canonicalizeFilePath(state.playlist[state.currentIndex]?.path)
            : null;
    const currentNameKey =
        state.currentIndex >= 0 && state.currentIndex < state.playlist.length
            ? canonicalizeTrackName(state.playlist[state.currentIndex]?.name)
            : null;

    for (const item of state.playlist) {
        const key = canonicalizeFilePath(item?.path);
        const nameKey = canonicalizeTrackName(item?.name);
        if (!key) continue;
        if (seen.has(key)) continue;
        if (nameKey && seenName.has(nameKey)) continue;
        seen.add(key);
        if (nameKey) seenName.add(nameKey);
        keep.push(item);
    }

    state.playlist = keep;

    // Preserve current playing item if possible (path first, then name).
    if (currentPathKey) {
        const idx = state.playlist.findIndex(i => canonicalizeFilePath(i.path) === currentPathKey);
        if (idx >= 0) {
            state.currentIndex = idx;
            return;
        }
    }
    if (currentNameKey) {
        const idx = state.playlist.findIndex(i => canonicalizeTrackName(i.name) === currentNameKey);
        state.currentIndex = idx;
    } else {
        state.currentIndex = Math.min(state.currentIndex, state.playlist.length - 1);
    }
}

function addToPlaylist(filePath, fileName = null) {
    const name = fileName || filePath.split('/').pop();

    // Video dosyalarını playlist'e ekleme - sadece ses dosyaları!
    if (isVideoFile(name)) {
        console.log('[PLAYLIST] Video dosyası reddedildi:', name);
        return { index: -1, added: false };
    }

    // Zaten listede var mı kontrol et
    const key = canonicalizeFilePath(filePath);
    const nameKey = canonicalizeTrackName(name);
    const existingIndex = state.playlist.findIndex(item => {
        if (canonicalizeFilePath(item.path) === key) return true;
        // Aynı isimli (farklı konumlu) şarkıyı da ikinci kez ekleme.
        if (nameKey && canonicalizeTrackName(item.name) === nameKey) return true;
        return false;
    });
    if (existingIndex !== -1) {
        return { index: existingIndex, added: false };
    }

    state.playlist.push({ path: filePath, name: name });

    // Auto-sort (A-Z / Z-A) unless we're in a bulk add section.
    if (state.autoSortPlaylist && !state.deferPlaylistSort && state.playlist.length >= 2) {
        sortPlaylistByName(state.playlistSortOrder || 'asc');
        const idx = state.playlist.findIndex(i => canonicalizeFilePath(i.path) === key);
        return { index: idx, added: true };
    }

    renderPlaylist();
    savePlaylistToDisk();
    return { index: state.playlist.length - 1, added: true };
}

function updateMusicSortPlaylistBtnUi() {
    if (!elements.musicSortPlaylistBtn) return;
    const order = state.playlistSortOrder === 'desc' ? 'desc' : 'asc';
    elements.musicSortPlaylistBtn.textContent = order === 'asc' ? 'A-Z' : 'Z-A';
    elements.musicSortPlaylistBtn.title = order === 'asc' ? 'A-Z' : 'Z-A';
}

function playlistSortKey(name) {
    const s = (name || '').toString();
    // Remove common invisible chars (BOM, zero-width, RTL marks) that can break sorting.
    // Also trim and strip leading punctuation/symbols.
    return s
        .replace(/[\u200B-\u200F\u2060\uFEFF]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/^[^0-9A-Za-z\u00C0-\u024F\u0400-\u04FF\u0600-\u06FF\u0900-\u097F\u4E00-\u9FFF]+/u, '');
}

function getUiCollator() {
    let locale = 'tr-TR';
    try {
        locale = window.i18n?.getLanguage?.() || locale;
    } catch {
        // yoksay
    }
    return new Intl.Collator(locale, { numeric: true, sensitivity: 'base' });
}

function compareNamesForSort(aName, bName, collator) {
    const an = playlistSortKey(aName);
    const bn = playlistSortKey(bName);
    const r = collator.compare(an, bn);
    if (r !== 0) return r;
    return String(aName || '').localeCompare(String(bName || ''));
}

function sortPlaylistByName(order = null) {
    if (!Array.isArray(state.playlist) || state.playlist.length < 2) return;

    const currentKey =
        state.currentIndex >= 0 && state.currentIndex < state.playlist.length
            ? canonicalizeFilePath(state.playlist[state.currentIndex]?.path)
            : null;

    const nextOrder =
        order ||
        (state.playlistSortOrder ? (state.playlistSortOrder === 'asc' ? 'desc' : 'asc') : 'asc');
    state.playlistSortOrder = nextOrder === 'desc' ? 'desc' : 'asc';

    const collator = getUiCollator();

    state.playlist.sort((a, b) => {
        const r = compareNamesForSort(a?.name, b?.name, collator);
        if (r !== 0) return state.playlistSortOrder === 'asc' ? r : -r;
        const ap = (a?.path || '').toString();
        const bp = (b?.path || '').toString();
        return ap.localeCompare(bp);
    });

    if (currentKey) {
        const idx = state.playlist.findIndex(i => canonicalizeFilePath(i.path) === currentKey);
        state.currentIndex = idx;
    }

    renderPlaylist();
    savePlaylistToDisk();
    updateMusicSortPlaylistBtnUi();

    // If we're in the virtual drop view on the left, keep it consistent with the sort order.
    try {
        if (elements.fileTree && elements.fileTree.dataset.view === 'virtualDrop') {
            const items = Array.from(elements.fileTree.querySelectorAll('.tree-item.file'));
            items.sort((ea, eb) => {
                const r = compareNamesForSort(ea.dataset.name || '', eb.dataset.name || '', collator);
                return state.playlistSortOrder === 'asc' ? r : -r;
            });
            elements.fileTree.innerHTML = '';
            for (const el of items) elements.fileTree.appendChild(el);
        }
    } catch {
        // yoksay
    }
}

function removeFromPlaylist(index) {
    state.playlist.splice(index, 1);

    // Çalan parça kaldırıldıysa
    if (index === state.currentIndex) {
        try {
            if (state.activeMedia === 'audio') {
                stopAudio();
            } else {
                elements.audio.pause();
            }
        } catch {
            // yoksay
        }
        state.currentIndex = -1;
        state.isPlaying = false;
        updatePlayPauseIcon(false);
    } else if (index < state.currentIndex) {
        state.currentIndex--;
    }

    renderPlaylist();
    savePlaylistToDisk();
}

// Sadece playlist'i temizle (kullanici klasorleri/kutuphane ayarlari silinmesin).
function clearPlaylistOnly() {
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
    state.isPlaying = false;
    updatePlayPauseIcon(false);

    if (elements.nowPlayingLabel) {
        elements.nowPlayingLabel.textContent = uiT('nowPlaying.ready', 'Now Playing: Aurivo Player - Ready');
    }

    renderPlaylist();
    savePlaylistToDisk();
    updateTrayState();
    updateMPRISMetadata();
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

    // Sol panel listesini de temizle (müzik/video fark etmez).
    state.currentPath = '';
    if (elements.fileTree) elements.fileTree.innerHTML = '';

    // Sekme değişiminde geri gelmemesi için kayıtlı klasörleri de temizle.
    saveFolders('audio', []);
    saveFolders('video', []);
    state.lastAudioPath = null;
    state.lastVideoPath = null;

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

    state.isPlaying = false;
    updatePlayPauseIcon(false);

    if (elements.nowPlayingLabel) {
        elements.nowPlayingLabel.textContent = uiT('nowPlaying.ready', 'Now Playing: Aurivo Player - Ready');
    }

    renderPlaylist();
    savePlaylistToDisk();
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

        // Drag&drop audio should never auto-import "the whole folder". Users expect:
        // "Temizledim => sadece surukledigim dosyalar gelsin."
        const droppedAudio = dropped.filter(f => isAudioFile(f.name));
        if (!droppedAudio.length) return;

        const hadPlayingAudio = state.activeMedia === 'audio' && state.currentIndex !== -1 && state.isPlaying === true;

        // Stop other media and ensure audio mode.
        stopVideo();
        stopWeb();
        state.activeMedia = 'audio';
        state.mediaFilter = 'audio';

        // Not used for autoplay anymore; user expects A-Z order to define the first track.
        const prevDefer = state.deferPlaylistSort;
        state.deferPlaylistSort = true;
        try {
            for (const f of droppedAudio) {
                addToPlaylist(f.path, f.name);
            }
        } finally {
            state.deferPlaylistSort = prevDefer;
        }
        if (state.autoSortPlaylist && !state.deferPlaylistSort) {
            sortPlaylistByName(state.playlistSortOrder || 'asc');
        }

        // Sol panel (file tree) drop edilen dosyalarla guncellensin (virtual view).
        // Aksi halde parca calar ama solda "listeye gelmedi" hissi olusuyor.
        if (elements.fileTree) {
            const wasVirtualView = elements.fileTree.dataset.view === 'virtualDrop';
            if (!wasVirtualView) {
                elements.fileTree.innerHTML = '';
                elements.fileTree.dataset.view = 'virtualDrop';
            }

            const existingPaths = new Set(
                Array.from(elements.fileTree.querySelectorAll('.tree-item.file')).map(el => el.dataset.path)
            );

            for (const f of droppedAudio) {
                if (existingPaths.has(f.path)) continue;
                const treeItem = createTreeItem(f.name, f.path, false);
                treeItem.dataset.virtualDrop = 'true';
                elements.fileTree.appendChild(treeItem);
                existingPaths.add(f.path);
            }
        }

        // Sadece bir sey calinmiyorsa otomatik baslat (liste doluyken calani bolmeyelim).
        if (!hadPlayingAudio && state.currentIndex === -1 && state.playlist.length) {
            playIndex(0);
        }
    }

    // Seçimleri temizle
    document.querySelectorAll('.tree-item.file').forEach(i => i.classList.remove('selected'));
}

// Seçili dosyaları playlist'e ekle (ENTER tuşu için)
function addSelectedFilesToPlaylist() {
    const selectedItems = document.querySelectorAll('.tree-item.file.selected');
    let addedCount = 0;
    let firstPlayableIndex = null;
    // Autoplay should follow A-Z order, not "first clicked" file.
    let firstPlayablePath = null;

    const __prevDeferSort = state.deferPlaylistSort;
    state.deferPlaylistSort = true;

    selectedItems.forEach(item => {
        const path = item.dataset.path;
        const name = item.dataset.name;
        // Video dosyalarını playlist'e ekleme (sadece ses dosyaları)
        if (path && name && isAudioFile(name)) {
            const { index, added } = addToPlaylist(path, name);
            if (typeof index === 'number' && index >= 0) {
                if (firstPlayableIndex === null) {
                    firstPlayableIndex = index;
                    firstPlayablePath = path;
                }
                if (added) addedCount++;
            }
        }
    });

    state.deferPlaylistSort = __prevDeferSort;
    if (state.autoSortPlaylist && !state.deferPlaylistSort) {
        sortPlaylistByName(state.playlistSortOrder || 'asc');
    }

    // İlk dosyayı çal (eğer hiçbir şey çalmıyorsa)
    if (state.currentIndex === -1 && state.playlist.length) {
        playIndex(0);
    }

    console.log(`ENTER: ${addedCount} dosya eklendi`);
}

// ============================================
// VIDEO PLAYBACK (Playlist'siz, direkt kütüphaneden)
// ============================================
const VIDEO_EQ_FREQUENCIES = [
    20, 25, 31.5, 40, 50, 63, 80, 100,
    125, 160, 200, 250, 315, 400, 500, 630,
    800, 1000, 1250, 1600, 2000, 2500, 3150, 4000,
    5000, 6300, 8000, 10000, 12500, 16000, 20000, 20000
];

let videoSfxGraph = null; // { ctx, source, preamp, panner, filters[] }
let videoSfxState = {
    enabled: true,
    preampDb: 0,
    balance: 0,
    bands: new Array(32).fill(0)
};
let videoPauseGuardUntil = 0;
let videoKeepAliveTimer = null;
let soundEffectsWindowOpen = false;
let forceVideoPlaybackForSfx = false;
let videoManualPauseByUser = false;
let sfxOpenForceResumeUntil = 0;
let sfxOpenGuardUntil = 0;
let videoKeepAliveLastTime = 0;
let videoKeepAliveLastClock = 0;

function shouldKeepVideoAliveForSfx() {
    if (videoManualPauseByUser) return false;
    if (soundEffectsWindowOpen && state.activeMedia === 'video') return true;
    return (
        (soundEffectsWindowOpen && forceVideoPlaybackForSfx) ||
        Date.now() < videoPauseGuardUntil ||
        Date.now() < sfxOpenForceResumeUntil ||
        Date.now() < sfxOpenGuardUntil
    );
}

function dbToGain(db) {
    const d = Number(db) || 0;
    return Math.pow(10, d / 20);
}

function normalizeBalanceToPan(balance) {
    const b = Number(balance);
    if (!Number.isFinite(b)) return 0;
    // Accept -1..1 or -100..100.
    if (Math.abs(b) <= 1.001) return Math.max(-1, Math.min(1, b));
    return Math.max(-1, Math.min(1, b / 100));
}

async function syncVideoSfxStateFromEngine() {
    const audioApi = window.aurivo?.audio;
    if (!audioApi) return;

    try {
        if (audioApi.preamp?.get) {
            try {
                const pre = await audioApi.preamp.get();
                if (Number.isFinite(Number(pre))) videoSfxState.preampDb = Number(pre);
            } catch { }
        }

        if (audioApi.balance?.get) {
            try {
                const bal = await audioApi.balance.get();
                if (Number.isFinite(Number(bal))) videoSfxState.balance = Number(bal);
            } catch { }
        }

        if (audioApi.eq?.getAllBands) {
            try {
                const bands = await audioApi.eq.getAllBands();
                if (Array.isArray(bands) && bands.length) {
                    const next = new Array(32).fill(0);
                    for (let i = 0; i < 32; i++) next[i] = Number(bands[i]) || 0;
                    videoSfxState.bands = next;
                }
            } catch { }
        }
    } finally {
        applyVideoSfxState();
    }
}

function ensureVideoSfxGraph() {
    try {
        if (!elements.videoPlayer) return null;

        if (videoSfxGraph && videoSfxGraph.ctx) return videoSfxGraph;

        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return null;

        const ctx = new Ctx();
        const source = ctx.createMediaElementSource(elements.videoPlayer);

        const preamp = ctx.createGain();
        preamp.gain.value = 1;

        const panner = (typeof ctx.createStereoPanner === 'function') ? ctx.createStereoPanner() : null;
        if (panner) panner.pan.value = 0;

        const filters = VIDEO_EQ_FREQUENCIES.map((freq) => {
            const f = ctx.createBiquadFilter();
            f.type = 'peaking';
            f.frequency.value = Number(freq) || 1000;
            f.Q.value = 1.2;
            f.gain.value = 0;
            return f;
        });

        // Chain: source -> preamp -> EQ -> (panner) -> destination
        let node = source;
        node.connect(preamp);
        node = preamp;
        for (const f of filters) {
            node.connect(f);
            node = f;
        }
        if (panner) {
            node.connect(panner);
            panner.connect(ctx.destination);
        } else {
            node.connect(ctx.destination);
        }

        videoSfxGraph = { ctx, source, preamp, panner, filters };
        applyVideoSfxState();
        return videoSfxGraph;
    } catch (e) {
        console.warn('[VIDEO SFX] init error:', e?.message || e);
        return null;
    }
}

function applyVideoSfxState() {
    if (!videoSfxGraph) {
        ensureVideoSfxGraph();
        if (!videoSfxGraph) return;
    }
    try {
        const enabled = !!videoSfxState.enabled;
        const bands = Array.isArray(videoSfxState.bands) ? videoSfxState.bands : [];
        const preampDb = enabled ? (Number(videoSfxState.preampDb) || 0) : 0;

        if (videoSfxGraph.preamp) {
            videoSfxGraph.preamp.gain.value = dbToGain(preampDb);
        }
        if (Array.isArray(videoSfxGraph.filters)) {
            for (let i = 0; i < videoSfxGraph.filters.length; i++) {
                const node = videoSfxGraph.filters[i];
                if (!node) continue;
                const v = enabled ? (Number(bands[i]) || 0) : 0;
                node.gain.value = v;
            }
        }
        if (videoSfxGraph.panner) {
            videoSfxGraph.panner.pan.value = enabled ? normalizeBalanceToPan(videoSfxState.balance) : 0;
        }
    } catch (e) {
        console.warn('[VIDEO SFX] apply error:', e?.message || e);
    }
}

async function resumeVideoAfterAuxWindowOpen() {
    try {
        if (state.activeMedia !== 'video' || !elements.videoPlayer) return;
        if (videoManualPauseByUser) return;

        ensureVideoSfxGraph();
        try { if (videoSfxGraph?.ctx?.state === 'suspended') await videoSfxGraph.ctx.resume(); } catch { }

        if (elements.videoPlayer.paused) {
            console.log('[SFX-VID] resume attempt: video is paused -> play()');
            const p = elements.videoPlayer.play();
            if (p && typeof p.then === 'function') await p;
            console.log('[SFX-VID] resume success');
        }
    } catch (e) {
        console.warn('[SFX-VID] resume failed:', e?.message || e);
    }
}

function armVideoKeepAlive(ms = 5000) {
    videoPauseGuardUntil = Date.now() + Math.max(1000, Number(ms) || 5000);

    if (videoKeepAliveTimer) {
        clearInterval(videoKeepAliveTimer);
        videoKeepAliveTimer = null;
    }

    videoKeepAliveTimer = setInterval(() => {
        try {
            if (Date.now() >= videoPauseGuardUntil) {
                clearInterval(videoKeepAliveTimer);
                videoKeepAliveTimer = null;
                return;
            }
            if (state.activeMedia !== 'video' || !elements.videoPlayer) return;
            if (videoManualPauseByUser) return;
            const now = Date.now();
            const t = Number(elements.videoPlayer.currentTime || 0);

            // If paused, always try to resume while guard is active.
            if (elements.videoPlayer.paused) {
                resumeVideoAfterAuxWindowOpen();
            } else if (videoKeepAliveLastClock > 0) {
                // If playback time is stuck while SFX window is active, poke play again.
                const dtMs = now - videoKeepAliveLastClock;
                const dPos = Math.abs(t - videoKeepAliveLastTime);
                if (dtMs > 700 && dPos < 0.01) {
                    resumeVideoAfterAuxWindowOpen();
                }
            }

            videoKeepAliveLastClock = now;
            videoKeepAliveLastTime = t;
        } catch { }
    }, 200);
}

function setSoundEffectsWindowOpen(open) {
    soundEffectsWindowOpen = !!open;
    console.log('[SFX-VID] soundEffectsWindowOpen =', soundEffectsWindowOpen);

    if (!soundEffectsWindowOpen) {
        forceVideoPlaybackForSfx = false;
        videoManualPauseByUser = false;
        sfxOpenForceResumeUntil = 0;
        sfxOpenGuardUntil = 0;
        videoPauseGuardUntil = 0;
        videoKeepAliveLastClock = 0;
        videoKeepAliveLastTime = 0;
        if (videoKeepAliveTimer) {
            clearInterval(videoKeepAliveTimer);
            videoKeepAliveTimer = null;
        }
        return;
    }

    if (forceVideoPlaybackForSfx) {
        sfxOpenGuardUntil = Math.max(sfxOpenGuardUntil, Date.now() + 15000);
        armVideoKeepAlive(60 * 60 * 1000); // Keep alive while SFX window stays open.
        setTimeout(() => { try { resumeVideoAfterAuxWindowOpen(); } catch { } }, 40);
    }
}

function postEmbeddedVideoSfxAnimControl(action) {
    try {
        const a = String(action || '');
        if (!a || !elements.videoSfxFrame?.contentWindow) return;
        elements.videoSfxFrame.contentWindow.postMessage({ type: 'sfx:animControl', action: a }, '*');
    } catch {
        // ignore
    }
}

function currentUiLanguage() {
    try {
        const lang = String(window.i18n?.getLanguage?.() || window.i18n?.locale || '').trim();
        return lang;
    } catch {
        return '';
    }
}

function postEmbeddedVideoSfxLanguage(lang) {
    try {
        const l = String(lang || '').trim();
        if (!l || !elements.videoSfxFrame?.contentWindow) return;
        elements.videoSfxFrame.contentWindow.postMessage({ type: 'sfx:setLanguage', lang: l }, '*');
    } catch {
        // ignore
    }
}

function openEmbeddedVideoSfxPanel() {
    if (!elements.videoSfxModal || !elements.videoSfxFrame) return;

    // Keep video alive while the embedded panel is open.
    videoManualPauseByUser = false;
    forceVideoPlaybackForSfx = true;
    setSoundEffectsWindowOpen(true);
    armVideoKeepAlive(60 * 60 * 1000);

    if (!elements.videoSfxFrame.src || elements.videoSfxFrame.src === 'about:blank') {
        elements.videoSfxFrame.src = 'soundEffects.html?embedded=1';
    }

    // Dil güncellemesini görünür olmadan önce gönder; açılışta "gidip-gelme" hissini azaltır.
    postEmbeddedVideoSfxLanguage(currentUiLanguage());
    elements.videoSfxModal.classList.remove('hidden');
    elements.videoSfxModal.setAttribute('aria-hidden', 'false');
    postEmbeddedVideoSfxAnimControl('resume');
    setTimeout(() => { try { resumeVideoAfterAuxWindowOpen(); } catch { } }, 60);
}

function closeEmbeddedVideoSfxPanel() {
    if (!elements.videoSfxModal) return;
    postEmbeddedVideoSfxAnimControl('pause');
    elements.videoSfxModal.classList.add('hidden');
    elements.videoSfxModal.setAttribute('aria-hidden', 'true');
    setSoundEffectsWindowOpen(false);
}

function handleSfxUpdateForVideo(payload) {
    try {
        const p = payload || {};
        const t = String(p.type || '');
        ensureVideoSfxGraph();
        if (t === 'videoHardReset') {
            videoSfxState.enabled = true;
            videoSfxState.preampDb = 0;
            videoSfxState.balance = 0;
            videoSfxState.bands = new Array(32).fill(0);
            applyVideoSfxState();
            return;
        }
        if (t === 'dspEnabled') {
            videoSfxState.enabled = !!p.enabled;
            applyVideoSfxState();
            return;
        }
        if (t === 'preamp') {
            videoSfxState.preampDb = Number(p.gainDB) || 0;
            applyVideoSfxState();
            return;
        }
        if (t === 'balance') {
            videoSfxState.balance = Number(p.balance) || 0;
            applyVideoSfxState();
            return;
        }
        if (t === 'eqReset') {
            videoSfxState.bands = new Array(32).fill(0);
            applyVideoSfxState();
            return;
        }
        if (t === 'eqBand') {
            const i = Number(p.band);
            if (!Number.isFinite(i) || i < 0 || i >= 32) return;
            if (!Array.isArray(videoSfxState.bands) || videoSfxState.bands.length !== 32) {
                videoSfxState.bands = new Array(32).fill(0);
            }
            videoSfxState.bands[i] = Number(p.gainDB) || 0;
            applyVideoSfxState();
            return;
        }
        if (t === 'eqBands') {
            const g = Array.isArray(p.gains) ? p.gains : (Array.isArray(p.bands) ? p.bands : []);
            if (!g.length) return;
            const bands = new Array(32).fill(0);
            for (let i = 0; i < 32; i++) bands[i] = Number(g[i]) || 0;
            videoSfxState.bands = bands;
            applyVideoSfxState();
            return;
        }
    } catch (e) {
        console.warn('[VIDEO SFX] update handler error:', e?.message || e);
    }
}

function playVideo(videoPath) {
    console.log('[PLAY VIDEO] Video oynatılıyor:', videoPath);

    // Müziği tamamen durdur
    stopAudio();
    stopWeb();

    if (!elements.videoPlayer) {
        console.warn('[PLAY VIDEO] videoPlayer elementi yok; oynatma ertelendi');
        setTimeout(() => {
            try {
                if (elements.videoPlayer) playVideo(videoPath);
            } catch { }
        }, 250);
        return;
    }

    // Videolar listesinde bu videonun indeksini bul (tek dosya açma senaryosu için fallback)
    let videoIndex = state.videoFiles.findIndex(v => v.path === videoPath);
    if (videoIndex === -1) {
        const fileName = window.aurivo?.path?.basename?.(videoPath) || String(videoPath || '').split('/').pop() || 'video';
        state.videoFiles = [{ name: fileName, path: videoPath }];
        videoIndex = 0;
    }

    state.currentVideoIndex = videoIndex;
    state.currentVideoPath = videoPath;
    state.activeMedia = 'video';

    // Video sayfasına geç
    switchPage('video');

    // Video player'ı ayarla ve oynat
    elements.videoPlayer.src = toLocalFileUrl(videoPath);
    elements.videoPlayer.muted = false;

    // Ensure video audio can receive sound effects while playing.
    // (WebAudio graph; controlled via main-process sfx updates.)
    ensureVideoSfxGraph();
    syncVideoSfxStateFromEngine();

    // Video ses seviyesini ayarla (kaydedilen seviye)
    elements.videoPlayer.volume = state.volume / 100;

    // Tam ekran ses kontrollerini başlat
    const fsVolumeSlider = document.getElementById('fsVolumeSlider');
    const fsVolumeLabel = document.getElementById('fsVolumeLabel');
    if (fsVolumeSlider) {
        fsVolumeSlider.value = state.volume;
    }
    if (fsVolumeLabel) {
        fsVolumeLabel.textContent = state.volume + '%';
    }

    const attemptAutoplayWithFallback = async () => {
        try {
            const p = elements.videoPlayer.play();
            if (p && typeof p.then === 'function') await p;
            try { if (videoSfxGraph?.ctx?.state === 'suspended') await videoSfxGraph.ctx.resume(); } catch { }
            return true;
        } catch (err) {
            console.warn('[PLAY VIDEO] autoplay blocked/failed, muted fallback:', err?.message || err);
        }

        // Chromium autoplay policy: try muted autoplay, then unmute on first "playing".
        try {
            const prevMuted = elements.videoPlayer.muted;
            elements.videoPlayer.muted = true;
            const p2 = elements.videoPlayer.play();
            if (p2 && typeof p2.then === 'function') await p2;
            try { if (videoSfxGraph?.ctx?.state === 'suspended') await videoSfxGraph.ctx.resume(); } catch { }

            elements.videoPlayer.addEventListener('playing', () => {
                try {
                    elements.videoPlayer.muted = prevMuted;
                    elements.videoPlayer.volume = state.volume / 100;
                } catch { }
            }, { once: true });
            return true;
        } catch (err2) {
            console.warn('[PLAY VIDEO] muted autoplay also failed:', err2?.message || err2);
        }

        // Last resort: wait for first user interaction then retry play().
        try {
            state.pendingAutoplayVideo = videoPath;
            const resume = async () => {
                if (state.pendingAutoplayVideo !== videoPath) return;
                try {
                    state.pendingAutoplayVideo = '';
                    const p3 = elements.videoPlayer.play();
                    if (p3 && typeof p3.then === 'function') await p3;
                } catch (e3) {
                    console.warn('[PLAY VIDEO] resume play failed:', e3?.message || e3);
                }
            };
            document.addEventListener('pointerdown', resume, { once: true, capture: true });
            document.addEventListener('keydown', resume, { once: true, capture: true });
        } catch { }
        return false;
    };

    attemptAutoplayWithFallback();

    // Video kapağı (thumbnail) göster
    extractVideoCover(videoPath);

    state.isPlaying = true;
    updatePlayPauseIcon(true);

    const fileName = videoPath.split('/').pop();
    elements.nowPlayingLabel.textContent = `${uiT('nowPlaying.prefix', 'Now Playing')}: ${fileName}`;

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

    // Skip missing/deleted files (while keeping current playback intact until we actually switch).
    const maxAttempts = Math.max(1, state.playlist.length);
    let attempt = 0;
    let idx = index;
    while (attempt < maxAttempts) {
        if (idx < 0 || idx >= state.playlist.length) {
            console.log('[PLAYINDEX] Geçersiz index, iptal ediliyor');
            return;
        }
        const candidate = state.playlist[idx];
        if (!candidate?.path || !window.aurivo?.fileExists) break;

        try {
            const ok = await window.aurivo.fileExists(candidate.path);
            if (ok) break;

            // Mark + remove (can't be played anymore).
            markPlaylistItemMissingByPath(candidate.path, true);
            removeFromPlaylist(idx);
            if (!state.playlist.length) return;
            idx = Math.min(idx, state.playlist.length - 1);
            attempt++;
            continue;
        } catch {
            break;
        }
    }

    if (idx < 0 || idx >= state.playlist.length) {
        console.log('[PLAYINDEX] Geçersiz index, iptal ediliyor');
        return;
    }

    const item = state.playlist[idx];
    console.log('[PLAYINDEX] Çalınacak dosya:', item.path);
    console.log('[PLAYINDEX] Current index before:', state.currentIndex, '-> after:', idx);

    state.currentIndex = idx;

    // Prefer native engine when available (effects/crossfade). If it can't decode,
    // main process will try FFmpeg transcode fallback, and if that still fails we fall back to HTML5.
    if (nativeAudioAvailable) {
        useNativeAudio = true;
    }

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
            console.warn('[PLAYINDEX] Native audio load failed, falling back to HTML5:', result);
            // Keep the app usable even when the native engine can't decode the file.
            useNativeAudio = false;
            showNotification('Bu format native engine ile acilamadi. HTML5 ile oynatiliyor (efektler kapali).', 'warning');
            playWithHTML5Audio(item);
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

    state.isPlaying = true;
    updatePlayPauseIcon(true);
    elements.nowPlayingLabel.textContent = `${uiT('nowPlaying.prefix', 'Now Playing')}: ${item.name}`;
    renderPlaylist();

    // Keep monitoring the currently playing file existence (warn if user deletes it while playing).
    startMissingFileWatcher(item.path);

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
    activePlayer.volume = state.volume / 100;
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
            updatePlayPauseIcon(true);
            elements.nowPlayingLabel.textContent = `${uiT('nowPlaying.prefix', 'Now Playing')}: ${toItem.name}`;
            renderPlaylist();
            extractAlbumArt(toItem.path);

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
    bindNativeAudioIpcOnce();

    // Prefer main-process position updates (not throttled in background). If they don't arrive,
    // fall back to renderer polling.
    const myGen = ++state.nativePositionGeneration;
    state.nativeIpcActive = false;
    state.nativeIpcLastAt = 0;

    const fallbackAfterMs = 900;
    setTimeout(() => {
        if (myGen !== state.nativePositionGeneration) return;
        if (state.nativeIpcActive) return;
        startNativePositionUpdatesFallbackPoll(myGen);
    }, fallbackAfterMs);
}

function bindNativeAudioIpcOnce() {
    if (state.nativeIpcBound) return;
    if (!window?.aurivo?.audio?.on) return;

    state.nativeIpcBound = true;

    window.aurivo.audio.on('position', (payload) => {
        try {
            if (!useNativeAudio || state.activeMedia !== 'audio') return;
            const positionMs = Number(payload?.positionMs) || 0;
            const durationMs = Number(payload?.durationMs) || 0;
            const isPlaying = typeof payload?.isPlaying === 'boolean' ? payload.isPlaying : state.isPlaying;
            state.nativeIpcActive = true;
            state.nativeIpcLastAt = Date.now();
            handleNativePositionTick(positionMs, durationMs, isPlaying);
        } catch (e) {
            console.warn('[NATIVE][IPC] position handler error:', e?.message || e);
        }
    });

    window.aurivo.audio.on('ended', () => {
        try {
            if (!useNativeAudio || state.activeMedia !== 'audio') return;
            handleNativePlaybackEnd();
        } catch (e) {
            console.warn('[NATIVE][IPC] ended handler error:', e?.message || e);
        }
    });
}

function startNativePositionUpdatesFallbackPoll(myGen) {
    console.log('[NATIVE] Falling back to renderer polling for position updates');
    state.nativePositionTimer = setInterval(async () => {
        if (myGen !== state.nativePositionGeneration) return;
        if (!useNativeAudio || state.activeMedia !== 'audio') return;

        try {
            const positionMs = await window.aurivo.audio.getPosition(); // ms
            const durationSec = await window.aurivo.audio.getDuration(); // seconds
            const isPlaying = await window.aurivo.audio.isPlaying();
            if (myGen !== state.nativePositionGeneration) return;
            handleNativePositionTick(Number(positionMs) || 0, Number(durationSec || 0) * 1000, !!isPlaying);
        } catch (e) {
            console.error('Native position update error:', e);
        }
    }, 150);
}

function handleNativePositionTick(positionMs, durationMs, isPlaying) {
    const durationSec = Math.max(0, (Number(durationMs) || 0) / 1000);
    const positionSec = Math.max(0, (Number(positionMs) || 0) / 1000);

    // Cache for seek/crossfade logic
    state.nativePositionMs = Number(positionMs) || 0;
    state.nativeDurationSec = durationSec;

    // UI update
    if (elements.currentTime) elements.currentTime.textContent = formatTime(positionSec);
    if (elements.durationTime) elements.durationTime.textContent = formatTime(durationSec);
    if (durationSec > 0 && elements.seekSlider) {
        const progress = (positionSec / durationSec) * 1000;
        elements.seekSlider.value = progress;
        updateRainbowSlider(elements.seekSlider, progress / 10);
    }

    // MPRIS position update (every 2s)
    const currentSecInt = Math.floor(positionSec);
    if (currentSecInt !== state.lastMPRISPosition && currentSecInt % 2 === 0) {
        state.lastMPRISPosition = currentSecInt;
        updateMPRISMetadata();
    }

    // Auto-next/crossfade logic: keep existing behavior but without relying on background timers.
    const crossfadeMs = state.settings?.playback?.crossfadeMs || 2000;
    const fudgeMs = 100;
    const gap = crossfadeMs + (state.settings?.playback?.crossfadeAutoEnabled ? 0 : 1000);
    const remaining = durationMs - positionMs;
    const minimumPlayTimeMs = 3000;

    if (durationMs > 0 && !state.trackAboutToEndTriggered && remaining > 0) {
        if (remaining < gap + fudgeMs && positionMs >= minimumPlayTimeMs) {
            state.trackAboutToEndTriggered = true;
        }
    }

    if (state.settings?.playback?.crossfadeAutoEnabled && !state.autoCrossfadeTriggered && !state.crossfadeInProgress) {
        if (state.trackAboutToEndTriggered && remaining > 0 && remaining <= crossfadeMs) {
            const nextIdx = computeNextIndex();
            if (nextIdx >= 0) {
                state.autoCrossfadeTriggered = true;
                startNativeTransitionToIndex(nextIdx, crossfadeMs).catch((e) => {
                    console.error('[CROSSFADE] Native auto transition error:', e);
                    playIndex(nextIdx);
                });
                return;
            }
        }
    }

    if (durationMs > 0 && !isPlaying && positionMs >= durationMs - 120) {
        handleNativePlaybackEnd();
    }
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
            if (state.settings?.playback?.crossfadeAutoEnabled) {
                startNativeTransitionToIndex(nextIdx, state.settings.playback.crossfadeMs || 2000).catch((e) => {
                    console.error('[CROSSFADE] Native end transition error:', e);
                    playIndex(nextIdx);
                });
            } else {
                playIndex(nextIdx);
            }
        } else {
            state.isPlaying = false;
            resetSeekUiToStart();
            updatePlayPauseIcon(false);
        }
    }
}

// Albüm kapağı çıkarma
async function extractAlbumArt(filePath) {
    console.log('=== ALBUM KAPAK CIKARMA BASLADI ===');
    console.log('Dosya yolu:', filePath);

    try {
        if (window.aurivo && window.aurivo.getAlbumArt) {
            console.log('getAlbumArt API mevcut, çağırılıyor...');
            const coverData = await window.aurivo.getAlbumArt(filePath);

            if (coverData) {
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

    // Video için state.isPlaying yerine gerçek video durumunu kullan.
    // Böylece SFX keep-alive açıkken de Play/Pause butonu her zaman çalışır.
    if (state.activeMedia === 'video' && elements.videoPlayer) {
        const currentlyPlaying = !elements.videoPlayer.paused;
        if (currentlyPlaying) {
            videoManualPauseByUser = true;
            forceVideoPlaybackForSfx = false;
            elements.videoPlayer.pause();
            state.isPlaying = false;
            updatePlayPauseIcon(false);
            updateTrayState();
            updateMPRISMetadata();
        } else {
            videoManualPauseByUser = false;
            elements.videoPlayer.play();
            if (soundEffectsWindowOpen) {
                forceVideoPlaybackForSfx = true;
                armVideoKeepAlive(60 * 60 * 1000);
            }
            state.isPlaying = true;
            updatePlayPauseIcon(true);
            updateTrayState();
            updateMPRISMetadata();
        }
        return;
    }

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
                            // Fallback to HTML5
                            useNativeAudio = false;
                            activePlayer.play();
                        } else {
                            startNativePositionUpdates();
                            window.aurivo.audio.fadeVolumeTo(Math.max(0, Math.min(1, (state.volume || 0) / 100)), ms).catch(e => console.error('[fadeVolume error]:', e));
                        }
                    } else {
                        const playResult = window.aurivo.audio.play();
                        if (playResult && playResult.error) {
                            console.error('[togglePlayPause] play failed:', playResult.error);
                            // Fallback to HTML5
                            useNativeAudio = false;
                            activePlayer.play();
                        } else {
                            startNativePositionUpdates();
                        }
                    }
                } catch (e) {
                    console.error('[togglePlayPause] Native play error:', e);
                    // Fallback to HTML5
                    useNativeAudio = false;
                    activePlayer.play();
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
        } else if (state.activeMedia === 'audio' && state.currentIndex === -1 && state.playlist.length > 0) {
            // Hiç şarkı çalmıyorsa ilk şarkıyı başlat
            playIndex(0);
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

function updatePlayPauseIcon(isPlaying) {
    if (isPlaying) {
        elements.playIcon.classList.add('hidden');
        elements.pauseIcon.classList.remove('hidden');
    } else {
        elements.playIcon.classList.remove('hidden');
        elements.pauseIcon.classList.add('hidden');
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

    // Parça çok kısa ise crossfade yapma
    if (duration > 0 && duration < state.settings.playback.crossfadeMs + 300) return false;

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
    elements.nowPlayingLabel.textContent = `${uiT('nowPlaying.prefix', 'Now Playing')}: ${item.name}`;
    renderPlaylist();
    extractAlbumArt(item.path);

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
                    if (cmd === 'next') {
                        clickFirst([
                            '.ytp-next-button',
                            'button[aria-label=\"Next\"]',
                            'button[title=\"Next\"]',
                            'button[aria-label*=\"Sonraki\"]',
                            'button[title*=\"Sonraki\"]'
                        ]);
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
                            try { window.history.back(); } catch (e) {}
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

// Keep Dawlod language in sync when the app language changes.
try {
    window.addEventListener('aurivo:languageChanged', (e) => {
        const lang = e?.detail?.lang;
        if (!lang) return;
        if (window.aurivo?.dawlod?.setLocale) {
            window.aurivo.dawlod.setLocale(lang);
        }
        postEmbeddedVideoSfxLanguage(lang);
    });
} catch {
    // ignore
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
    stopMissingFileWatcher();

    // Eğer otomatik crossfade zaten tetiklendiyse, bir şey yapma
    if (state.autoCrossfadeTriggered || state.crossfadeInProgress) {
        return;
    }

    // Stop after current aktifse, çalmayı durdur
    if (state.stopAfterCurrent) {
        state.stopAfterCurrent = false; // Tek seferlik
        state.isPlaying = false;
        resetSeekUiToStart();
        updatePlayPauseIcon(false);
        updateTrayState();
        return;
    }

    if (state.isRepeat) {
        playIndex(state.currentIndex);
    } else {
        // Otomatik crossfade aktifse ve sonraki parça varsa
        const nextIdx = computeNextIndex();
        console.log('[PLAYBACK] Next index:', nextIdx);
        if (nextIdx >= 0 && state.settings?.playback?.crossfadeAutoEnabled) {
            startCrossfadeToIndex(nextIdx, state.settings.playback.crossfadeMs || 2000);
        } else if (nextIdx >= 0) {
            playIndex(nextIdx);
        } else {
            // Liste bitti
            console.log('[PLAYBACK] Playlist finished');
            state.isPlaying = false;
            resetSeekUiToStart();
            updatePlayPauseIcon(false);
            updateTrayState();
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
}

function handleSeekWheel(e) {
    // Mouse wheel seek: ±10 seconds
    e.preventDefault();
    const deltaSeconds = e.deltaY < 0 ? 10 : -10; // wheel up = forward
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

function resetSeekUiToStart() {
    if (elements.seekSlider) {
        elements.seekSlider.value = 0;
        updateRainbowSlider(elements.seekSlider, 0);
    }
    if (elements.currentTime) {
        elements.currentTime.textContent = '00:00';
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
    state.volume = value;
    state.isMuted = false;

    // C++ Audio Engine kullanılıyorsa (0-100 arası değer bekliyor)
    if (useNativeAudio && state.activeMedia === 'audio') {
        window.aurivo.audio.setVolume(value / 100); // 0-1 arası
    }

    // HTML5 Audio/Video için de güncelle (0-1 arası bekliyor)
    const activePlayer = getActiveAudioPlayer();
    if (!state.crossfadeInProgress) {
        activePlayer.volume = value / 100;
    }
    elements.videoPlayer.volume = value / 100;
    elements.videoPlayer.muted = false;
    if (elements.audio) elements.audio.muted = false;
    elements.volumeLabel.textContent = value + '%';

    // Tam ekran ses slider'ını da senkronize et
    const fsVolumeSlider = document.getElementById('fsVolumeSlider');
    const fsVolumeLabel = document.getElementById('fsVolumeLabel');
    if (fsVolumeSlider) {
        fsVolumeSlider.value = value;
    }
    if (fsVolumeLabel) {
        fsVolumeLabel.textContent = value + '%';
    }

    updateVolumeIcon();
    // Rainbow slider efektini güncelle
    updateRainbowSlider(elements.volumeSlider, value);
    updateFsVolumeIcon();
    pushAppVolumeToWeb();
    saveSettings();
}

function toggleMute() {
    const fsVolumeSlider = document.getElementById('fsVolumeSlider');
    const fsVolumeLabel = document.getElementById('fsVolumeLabel');

    if (state.isMuted) {
        state.isMuted = false;
        elements.volumeSlider.value = state.savedVolume;
        state.volume = state.savedVolume;

        if (useNativeAudio) {
            window.aurivo.audio.setVolume(state.savedVolume / 100); // 0-1
        }
        elements.audio.volume = state.savedVolume / 100;
        elements.videoPlayer.volume = state.savedVolume / 100;
        elements.videoPlayer.muted = false;
        if (elements.audio) elements.audio.muted = false;
        elements.volumeLabel.textContent = state.savedVolume + '%';

        // Tam ekran kontrollerini güncelle
        if (fsVolumeSlider) fsVolumeSlider.value = state.savedVolume;
        if (fsVolumeLabel) fsVolumeLabel.textContent = state.savedVolume + '%';
    } else {
        state.isMuted = true;
        state.savedVolume = state.volume;
        elements.volumeSlider.value = 0;
        state.volume = 0;

        if (useNativeAudio) {
            window.aurivo.audio.setVolume(0);
        }
        elements.audio.volume = 0;
        elements.videoPlayer.volume = 0;
        elements.videoPlayer.muted = true;
        if (elements.audio) elements.audio.muted = true;
        elements.volumeLabel.textContent = '0%';

        // Tam ekran kontrollerini güncelle
        if (fsVolumeSlider) fsVolumeSlider.value = 0;
        if (fsVolumeLabel) fsVolumeLabel.textContent = '0%';
    }
    updateRainbowSlider(elements.volumeSlider, state.volume);
    updateVolumeIcon();
    updateTrayState();
    updateFsVolumeIcon();
    pushAppVolumeToWeb();
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
function openSettings() {
    if (!elements.settingsPage) return;
    hideUtilityPage(elements.securityPage, elements.securityBtn);
    showUtilityPage(elements.settingsPage, elements.settingsBtn);
    loadSettingsToUI();
}

function closeSettings() {
    hideUtilityPage(elements.settingsPage, elements.settingsBtn);
}

function switchSettingsTab(tab) {
    const tabName = tab.dataset.tab;

    elements.settingsTabs.forEach(t => t.classList.remove('active'));
    tab.classList.add('active');

    elements.settingsPages.forEach(p => {
        p.classList.add('hidden');
        p.classList.remove('active');
    });

    const targetPage = document.getElementById(tabName + 'Settings');
    if (targetPage) {
        targetPage.classList.remove('hidden');
        targetPage.classList.add('active');
    }
}

function loadSettingsToUI() {
    if (!state.settings) return;
    const pb = state.settings.playback;

    document.getElementById('crossfadeStop').checked = pb.crossfadeStopEnabled;
    document.getElementById('crossfadeManual').checked = pb.crossfadeManualEnabled;
    document.getElementById('crossfadeAuto').checked = pb.crossfadeAutoEnabled;
    document.getElementById('sameAlbumNoCrossfade').checked = pb.sameAlbumNoCrossfade;
    document.getElementById('sameAlbumNoCrossfade').disabled = !pb.crossfadeAutoEnabled;
    document.getElementById('crossfadeMs').value = pb.crossfadeMs;
    document.getElementById('fadeOnPause').checked = pb.fadeOnPauseResume;
    document.getElementById('pauseFadeMs').value = pb.pauseFadeMs;

}

function applySettings() {
    if (!state.settings) return;

    const crossfadeMs = Math.max(0, Math.min(15000, parseInt(document.getElementById('crossfadeMs').value, 10) || 0));
    const pauseFadeMs = Math.max(0, Math.min(3000, parseInt(document.getElementById('pauseFadeMs').value, 10) || 0));

    state.settings.playback = {
        crossfadeStopEnabled: document.getElementById('crossfadeStop').checked,
        crossfadeManualEnabled: document.getElementById('crossfadeManual').checked,
        crossfadeAutoEnabled: document.getElementById('crossfadeAuto').checked,
        sameAlbumNoCrossfade: document.getElementById('sameAlbumNoCrossfade').checked,
        crossfadeMs,
        fadeOnPauseResume: document.getElementById('fadeOnPause').checked,
        pauseFadeMs
    };

    saveSettings();
}

function resetPlaybackDefaults() {
    document.getElementById('crossfadeStop').checked = true;
    document.getElementById('crossfadeManual').checked = true;
    document.getElementById('crossfadeAuto').checked = true;
    document.getElementById('sameAlbumNoCrossfade').checked = false;
    document.getElementById('sameAlbumNoCrossfade').disabled = false;
    document.getElementById('crossfadeMs').value = 2000;
    document.getElementById('fadeOnPause').checked = false;
    document.getElementById('pauseFadeMs').value = 250;
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
    if (elements.videoSfxModal && !elements.videoSfxModal.classList.contains('hidden')) {
        if (e.code === 'Escape') {
            e.preventDefault();
            closeEmbeddedVideoSfxPanel();
        }
        return;
    }

    // About modal açıksa önce onu kapat
    if (isAboutModalOpen()) {
        if (e.code === 'Escape') {
            e.preventDefault();
            closeAboutModal();
        }
        return;
    }

    // Update modal açıksa önce onu kapat
    if (isUpdateModalOpen()) {
        if (e.code === 'Escape') {
            e.preventDefault();
            closeUpdateModal();
        }
        return;
    }

    // Utility sayfalar açıkken klavye kısayollarını devre dışı bırak
    if (isPageVisible(elements.settingsPage) || isPageVisible(elements.securityPage)) return;

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
            seekBy(-5);
            break;
        case 'ArrowRight':
            seekBy(5);
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

function getCanvasScale(canvas) {
    try {
        const rect = canvas.getBoundingClientRect?.();
        const cssW = Number(rect?.width) || canvas.offsetWidth || canvas.width || 1;
        const cssH = Number(rect?.height) || canvas.offsetHeight || canvas.height || 1;
        const scaleX = cssW > 0 ? (canvas.width / cssW) : 1;
        const scaleY = cssH > 0 ? (canvas.height / cssH) : 1;
        return {
            cssW: Math.max(1, Math.round(cssW)),
            cssH: Math.max(1, Math.round(cssH)),
            scaleX: Number.isFinite(scaleX) && scaleX > 0 ? scaleX : 1,
            scaleY: Number.isFinite(scaleY) && scaleY > 0 ? scaleY : 1
        };
    } catch {
        return { cssW: canvas.width || 1, cssH: canvas.height || 1, scaleX: 1, scaleY: 1 };
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

        const { cssW, cssH, scaleX, scaleY } = getCanvasScale(this.canvas);
        const width = this.canvas.width;
        const height = this.canvas.height;

        if (width <= 0 || height <= 0) return;

        // Keep bar thickness stable in CSS pixels; renderScale should only affect sharpness.
        this._colW = Math.max(1, Math.round(this.COLUMN_WIDTH * scaleX));
        this._gap = Math.max(0, Math.round(this.GAP * scaleX));
        this._step = this._colW + this._gap;

        this.bandCount = Math.floor(cssW / (this.COLUMN_WIDTH + this.GAP));
        if (this.bandCount === 0) this.bandCount = 1;

        this.maxDown = -Math.max(1, Math.floor((cssH / 50) * scaleY));
        this.maxUp = Math.max(1, Math.floor((cssH / 25) * scaleY));

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
        const colW = this._colW || this.COLUMN_WIDTH;
        const step = this._step || (this.COLUMN_WIDTH + this.GAP);

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
            const x = i * step;

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
                ctx.fillRect(x, height - y2, colW, y2);
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
                ctx.fillRect(x, roofY, colW, 2);
            }

            // Mevcut tavan
            const roofY = height - this.roofVector[i] - 2;
            this.roofMem[i].push(roofY);

            // Mevcut tavanı çiz (peak)
            const roofHue = (this.hueOffset + (i / this.bandCount) * 360 + 180) % 360;
            ctx.fillStyle = `hsl(${roofHue}, 100%, 80%)`;
            ctx.fillRect(x, roofY, colW, 2);

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
        const colW = this._colW || this.COLUMN_WIDTH;
        const step = this._step || (this.COLUMN_WIDTH + this.GAP);

        for (let i = 0; i < this.bandCount; i++) {
            const x = i * step;
            const hue = (this.hueOffset + (i / this.bandCount) * 360) % 360;
            ctx.fillStyle = `hsla(${hue}, 100%, 50%, 0.3)`;
            ctx.fillRect(x, canvas.height - 3, colW, 3);
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
        const { cssW, cssH, scaleX, scaleY } = getCanvasScale(this.canvas);
        const width = this.canvas.width;
        const height = this.canvas.height;
        if (width <= 0 || height <= 0) return;

        this._blockW = Math.max(1, Math.round(this.BLOCK_WIDTH * scaleX));
        this._blockH = Math.max(1, Math.round(this.BLOCK_HEIGHT * scaleY));
        this._gapX = Math.max(0, Math.round(this.GAP * scaleX));
        this._gapY = Math.max(0, Math.round(this.GAP * scaleY));
        this._stepX = this._blockW + this._gapX;
        this._stepY = this._blockH + this._gapY;

        this.bandCount = Math.floor(cssW / (this.BLOCK_WIDTH + this.GAP));
        if (this.bandCount === 0) this.bandCount = 1;
        this.rows = Math.floor(cssH / (this.BLOCK_HEIGHT + this.GAP));
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
            let targetRow = Math.floor(value * this.rows);

            // Smooth animation
            if (targetRow < this.bandInfo[x].row) {
                this.bandInfo[x].height += this.step;
                this.bandInfo[x].row = Math.floor(this.bandInfo[x].height);
            } else {
                this.bandInfo[x].height = targetRow;
                this.bandInfo[x].row = targetRow;
            }

            const row = Math.min(this.bandInfo[x].row, this.rows);
            const xPos = x * (this._stepX || (this.BLOCK_WIDTH + this.GAP));

            // Draw blocks
            for (let y = 0; y < row; y++) {
                const yPos = height - (y + 1) * (this._stepY || (this.BLOCK_HEIGHT + this.GAP));
                const intensity = 1 - (y / this.rows);

                if (VisualizerSettings.psychedelicEnabled) {
                    const hue = (this.hueOffset + (x / this.bandCount) * 360 + y * 5) % 360;
                    ctx.fillStyle = `hsl(${hue}, 100%, ${50 + intensity * 30}%)`;
                } else {
                    const g = Math.floor(100 + intensity * 155);
                    ctx.fillStyle = `rgb(0, ${g}, ${Math.floor(g * 0.8)})`;
                }

                ctx.fillRect(xPos, yPos, this._blockW || this.BLOCK_WIDTH, this._blockH || this.BLOCK_HEIGHT);
            }
        }
    },

    drawIdle() {
        const ctx = this.ctx;
        const canvas = this.canvas;
        for (let x = 0; x < this.bandCount; x++) {
            const xPos = x * (this._stepX || (this.BLOCK_WIDTH + this.GAP));
            const hue = (this.hueOffset + (x / this.bandCount) * 360) % 360;
            ctx.fillStyle = `hsla(${hue}, 100%, 50%, 0.3)`;
            ctx.fillRect(
                xPos,
                canvas.height - (this._blockH || this.BLOCK_HEIGHT),
                this._blockW || this.BLOCK_WIDTH,
                this._blockH || this.BLOCK_HEIGHT
            );
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
        const { cssW, scaleX } = getCanvasScale(this.canvas);
        const width = this.canvas.width;
        const height = this.canvas.height;
        if (width <= 0 || height <= 0) return;

        this._colW = Math.max(1, Math.round(this.COLUMN_WIDTH * scaleX));
        this._gap = Math.max(0, Math.round(this.GAP * scaleX));
        this._step = this._colW + this._gap;

        this.bandCount = Math.floor(cssW / (this.COLUMN_WIDTH + this.GAP));
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
        const colW = this._colW || this.COLUMN_WIDTH;
        const step = this._step || (this.COLUMN_WIDTH + this.GAP);

        for (let i = 0; i < this.bandCount; i++) {
            const x = i * step;
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
                    this.barHeight[i] -= this.K_BAR_HEIGHT;
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
                ctx.fillRect(x, y, colW, this.barHeight[i]);
            }

            // Draw peak
            const peakY = height - this.peakHeight[i];
            if (VisualizerSettings.psychedelicEnabled) {
                const hue = (this.hueOffset + (i / this.bandCount) * 360 + 180) % 360;
                ctx.fillStyle = `hsl(${hue}, 100%, 80%)`;
            } else {
                ctx.fillStyle = '#ffffff';
            }
            ctx.fillRect(x, peakY - 2, colW, 2);
        }
    },

    drawIdle() {
        const ctx = this.ctx;
        const canvas = this.canvas;
        const colW = this._colW || this.COLUMN_WIDTH;
        const step = this._step || (this.COLUMN_WIDTH + this.GAP);
        for (let i = 0; i < this.bandCount; i++) {
            const x = i * step;
            const hue = (this.hueOffset + (i / this.bandCount) * 360) % 360;
            ctx.fillStyle = `hsla(${hue}, 100%, 50%, 0.3)`;
            ctx.fillRect(x, canvas.height - 3, colW, 3);
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
        const { cssW, scaleX } = getCanvasScale(this.canvas);
        const width = this.canvas.width;
        const height = this.canvas.height;
        if (width <= 0 || height <= 0) return;

        this._colW = Math.max(1, Math.round(this.COLUMN_WIDTH * scaleX));
        this._gap = Math.max(0, Math.round(this.GAP * scaleX));
        this._step = this._colW + this._gap;

        this.bandCount = Math.floor(cssW / (this.COLUMN_WIDTH + this.GAP));
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
        const colW = this._colW || this.COLUMN_WIDTH;
        const step = this._step || (this.COLUMN_WIDTH + this.GAP);

        for (let i = 0; i < this.bandCount; i++) {
            const x = i * step;
            let h = Math.min(Math.log10(scope[i] * 256 + 1) * this.F * 0.5, maxHeight);

            if (h > this.barHeight[i]) {
                this.barHeight[i] = h;
                if (h > this.peakHeight[i]) {
                    this.peakHeight[i] = h;
                    this.peakSpeed[i] = 0.01;
                }
            } else {
                if (this.barHeight[i] > 0) {
                    this.barHeight[i] -= this.K_BAR_HEIGHT;
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
                ctx.fillRect(x, hd2 - barH, colW, barH);
                // Bottom bar (mirrored)
                ctx.fillRect(x, hd2, colW, barH);
            }

            // Draw peaks
            const peakH = this.peakHeight[i];
            if (VisualizerSettings.psychedelicEnabled) {
                const hue = (this.hueOffset + (i / this.bandCount) * 360 + 180) % 360;
                ctx.fillStyle = `hsl(${hue}, 100%, 80%)`;
            } else {
                ctx.fillStyle = '#88ccff';
            }
            ctx.fillRect(x, hd2 - peakH - 1, colW, 2);
            ctx.fillRect(x, hd2 + peakH - 1, colW, 2);
        }

        // Center line
        ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.fillRect(0, hd2, width, 1);
    },

    drawIdle() {
        const ctx = this.ctx;
        const canvas = this.canvas;
        const hd2 = canvas.height / 2;
        const colW = this._colW || this.COLUMN_WIDTH;
        const step = this._step || (this.COLUMN_WIDTH + this.GAP);
        for (let i = 0; i < this.bandCount; i++) {
            const x = i * step;
            const hue = (this.hueOffset + (i / this.bandCount) * 360) % 360;
            ctx.fillStyle = `hsla(${hue}, 100%, 50%, 0.3)`;
            ctx.fillRect(x, hd2 - 2, colW, 4);
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
    _colW: null,
    _gap: null,
    _step: null,
    _scaleX: 1,
    _scaleY: 1,
    canvas: null,
    ctx: null,

    init(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.resize();
    },

    resize() {
        if (!this.canvas) return;
        const { cssW, scaleX, scaleY } = getCanvasScale(this.canvas);
        const width = this.canvas.width;
        const height = this.canvas.height;
        if (width <= 0 || height <= 0) return;

        // Keep bar thickness stable in CSS pixels; renderScale should only affect sharpness.
        this._scaleX = scaleX;
        this._scaleY = scaleY;
        this._colW = Math.max(1, Math.round(this.COLUMN_WIDTH * scaleX));
        this._gap = Math.max(0, Math.round(this.GAP * scaleX));
        this._step = this._colW + this._gap;

        this.bandCount = Math.floor(cssW / (this.COLUMN_WIDTH + this.GAP));
        if (this.bandCount === 0) this.bandCount = 1;
        this.barHeight = new Array(this.bandCount).fill(0);
    },

    analyze(spectrumData, isPlaying) {
        const ctx = this.ctx;
        const canvas = this.canvas;
        const width = canvas.width;
        const height = canvas.height;
        const colW = this._colW || this.COLUMN_WIDTH;
        const step = this._step || (this.COLUMN_WIDTH + this.GAP);
        const scaleX = this._scaleX || 1;
        const scaleY = this._scaleY || 1;

        ctx.fillStyle = '#121212';
        ctx.fillRect(0, 0, width, height);

        this.hueOffset = (this.hueOffset + 2) % 360;
        this.waveOffset += 0.1;

        const scope = isPlaying && spectrumData
            ? this.interpolateSpectrum(spectrumData, this.bandCount)
            : new Array(this.bandCount).fill(0);

        for (let i = 0; i < this.bandCount; i++) {
            const x = i * step;

            // Add wave effect
            const wave = Math.sin(this.waveOffset + i * 0.3) * 10 * scaleY;
            let targetHeight = scope[i] * height * 0.8 + (isPlaying ? wave : 0);
            const minH = 5 * scaleY;
            if (targetHeight < minH) targetHeight = minH;

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
            const radiusCap = Math.max(1, Math.round(3 * scaleX));
            const radius = Math.min(colW / 2, radiusCap);
            ctx.beginPath();
            ctx.roundRect(x, y, colW, barH, [radius, radius, 0, 0]);
            ctx.fill();

            // Parlama efekti
            if (VisualizerSettings.glowEnabled && barH > 10) {
                ctx.shadowBlur = 15;
                ctx.shadowColor = `hsl(${hue1}, 100%, 50%)`;
                ctx.fillRect(x, y, colW, Math.max(1, Math.round(2 * scaleY)));
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
    _colW: null,
    _gap: null,
    _step: null,
    _scaleX: 1,
    _scaleY: 1,
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
        const { cssW, scaleX, scaleY } = getCanvasScale(this.canvas);
        const width = this.canvas.width;
        const height = this.canvas.height;
        if (width <= 0 || height <= 0) return;

        // Keep bar thickness stable in CSS pixels; renderScale should only affect sharpness.
        this._scaleX = scaleX;
        this._scaleY = scaleY;
        this._colW = Math.max(1, Math.round(this.COLUMN_WIDTH * scaleX));
        this._gap = Math.max(0, Math.round(this.GAP * scaleX));
        this._step = this._colW + this._gap;

        this.bandCount = Math.floor(cssW / (this.COLUMN_WIDTH + this.GAP));
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
        const colW = this._colW || this.COLUMN_WIDTH;
        const step = this._step || (this.COLUMN_WIDTH + this.GAP);
        const scaleY = this._scaleY || 1;

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
            const x = i * step;

            let targetHeight = scope[i] * height * 0.7;
            const minH = 3 * scaleY;
            if (targetHeight < minH) targetHeight = minH;

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
                ctx.fillRect(x, segY, colW, segmentHeight + Math.max(1, Math.round(1 * scaleY)));
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

    // projectM visualizer toggle (native external window)
    const projectmToggle = document.getElementById('projectmToggle');
    if (projectmToggle) {
        projectmToggle.addEventListener('click', async () => {
            try {
                if (window.app?.visualizer?.toggle) {
                    const res = await window.app.visualizer.toggle();
                    if (res && typeof res.running === 'boolean') {
                        projectmToggle.classList.toggle('checked', res.running);
                    }
                } else {
                    console.warn('Visualizer API yok (window.app.visualizer.toggle)');
                }
            } catch (e) {
                console.error('[Visualizer] projectM toggle failed:', e);
                try { safeNotify('Görselleştirici başlatılamadı.', 'error'); } catch { }
            } finally {
                hideContextMenu();
            }
        });
    }

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
        drawNativeVisualizer(ctx, canvas);
    } else {
        // Web Audio API kurulumu (fallback)
        try {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
            analyser = audioContext.createAnalyser();
            analyser.fftSize = 256;

            const source = audioContext.createMediaElementSource(elements.audio);
            source.connect(analyser);
            analyser.connect(audioContext.destination);

            dataArray = new Uint8Array(analyser.frequencyBinCount);

            drawVisualizer(ctx, canvas);
        } catch (e) {
            console.log('Visualizer başlatılamadı:', e);
            drawFallbackVisualizer(ctx, canvas);
        }
    }
}

// C++ Audio Engine FFT verisi ile görselleştirici
async function drawNativeVisualizer(ctx, canvas) {
    setTimeout(() => drawNativeVisualizer(ctx, canvas), 1000 / VisualizerSettings.currentFramerate);

    const isPlaying = state.isPlaying && state.activeMedia === 'audio';

    try {
        // C++ engine'den spectrum verisini al - doğru API yolu
        let spectrumData = null;
        if (isPlaying && window.aurivo && window.aurivo.audio && window.aurivo.audio.spectrum) {
            spectrumData = await window.aurivo.audio.spectrum.getBands(128);
        }

        // Analyzer Container ile çiz
        AnalyzerContainer.analyze(spectrumData, isPlaying);
    } catch (e) {
        // Hata durumunda idle bars çiz
        AnalyzerContainer.analyze(null, false);
    }
}

function drawVisualizer(ctx, canvas) {
    setTimeout(() => drawVisualizer(ctx, canvas), 1000 / VisualizerSettings.currentFramerate);

    if (!analyser) return;

    analyser.getByteFrequencyData(dataArray);

    // Uint8Array'i normalize diziye dönüştür
    const normalizedData = Array.from(dataArray).map(v => v / 255);

    // Analyzer Container ile çiz
    AnalyzerContainer.analyze(normalizedData, state.isPlaying);
}

function drawFallbackVisualizer(ctx, canvas) {
    // Basit animasyon (audio context yoksa)
    function animate() {
        setTimeout(animate, 1000 / VisualizerSettings.currentFramerate);

        // Animasyon için sahte spektrum verisi
        const fakeData = state.isPlaying
            ? Array.from({ length: 64 }, (_, i) =>
                (Math.sin(Date.now() / 200 + i * 0.3) * 0.5 + 0.5) * 0.6)
            : null;

        AnalyzerContainer.analyze(fakeData, state.isPlaying);
    }

    animate();
}

// ============================================
// RAINBOW SLIDER - IŞIK DÖNGÜSÜ EFEKTİ
// ============================================
let rainbowHue = 0;
let rainbowAnimationId = null;

function initializeRainbowSliders() {
    // Başlangıç değerleriyle slider'ları güncelle
    updateRainbowSlider(elements.seekSlider, 0);
    updateRainbowSlider(elements.volumeSlider, state.volume);

    // Tam ekran slider'ları da başlat
    const fsSeekSlider = document.getElementById('fsSeekSlider');
    const fsVolumeSlider = document.getElementById('fsVolumeSlider');
    if (fsSeekSlider) updateRainbowSlider(fsSeekSlider, 0);
    if (fsVolumeSlider) updateRainbowSlider(fsVolumeSlider, state.volume);

    // Rainbow animasyonu başlat
    startRainbowAnimation();
}

function startRainbowAnimation() {
    function animateRainbow() {
        rainbowHue = (rainbowHue + 1) % 360;

        // Seek slider - mevcut değeriyle güncelle
        const seekPercent = (elements.seekSlider.value / elements.seekSlider.max) * 100;
        updateRainbowSliderColors(elements.seekSlider, seekPercent);

        // Ses Seviyesi slider - mevcut değeriyle güncelle
        const volumePercent = elements.volumeSlider.value;
        updateRainbowSliderColors(elements.volumeSlider, volumePercent);

        // TAM EKRAN SLIDER'LAR - aynı rainbow efekti
        const fsSeekSlider = document.getElementById('fsSeekSlider');
        const fsVolumeSlider = document.getElementById('fsVolumeSlider');

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
    animateRainbow();
    console.log('🌈 Rainbow animasyon başlatıldı - tam ekran slider\'lar dahil');
}

function updateRainbowSlider(slider, percent) {
    updateRainbowSliderColors(slider, percent);
}

function updateRainbowSliderColors(slider, percent) {
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
        ${colors[1]} ${percent * 0.2}%, 
        ${colors[2]} ${percent * 0.4}%, 
        ${colors[3]} ${percent * 0.6}%, 
        ${colors[4]} ${percent * 0.8}%, 
        ${colors[5]} ${percent}%, 
        ${emptyColor} ${percent}%, 
        ${emptyColor} 100%)`;

    slider.style.background = trackBackground;

    // Thumb için parlak renk
    const thumbColor = `hsl(${(rainbowHue + 60) % 360}, 100%, 60%)`;
    const thumbGlow = `hsl(${(rainbowHue + 60) % 360}, 100%, 50%)`;
    slider.style.setProperty('--thumb-color', thumbColor);
    slider.style.setProperty('--thumb-glow', thumbGlow);
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
        this.elements.eqButton = document.getElementById('eqBtn');

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
            this.elements.eqButton.addEventListener('click', async (e) => {
                try {
                    e.preventDefault();
                    e.stopPropagation();
                } catch { }

                const videoWasPlaying = !!(state.activeMedia === 'video' && elements.videoPlayer && !elements.videoPlayer.paused);
                console.log('[SFX-VID] EQ button click', { videoWasPlaying, activeMedia: state.activeMedia });

                // Video için ayrı panel: tam soundEffects.html'i uygulama içinde embed aç.
                if (state.activeMedia === 'video') {
                    openEmbeddedVideoSfxPanel();
                    return;
                }

                // Yeni Ses Efektleri penceresini aç
                if (window.aurivo && window.aurivo.soundEffects) {
                    if (videoWasPlaying) {
                        // Important: arm guard BEFORE window open to catch immediate focus-change pause events.
                        videoManualPauseByUser = false;
                        forceVideoPlaybackForSfx = true;
                        sfxOpenForceResumeUntil = Date.now() + 8000; // first-open stabilization window
                        sfxOpenGuardUntil = Date.now() + 15000; // extra guard for delayed focus/occlusion pauses
                        armVideoKeepAlive(60 * 60 * 1000);
                        setSoundEffectsWindowOpen(true);
                    }

                    try { await syncVideoSfxStateFromEngine(); } catch { }
                    await window.aurivo.soundEffects.openWindow();
                    console.log('🎛️ Ses Efektleri penceresi açılıyor...');

                    if (videoWasPlaying) {
                        setTimeout(() => { try { resumeVideoAfterAuxWindowOpen(); } catch { } }, 80);
                        setTimeout(() => { try { resumeVideoAfterAuxWindowOpen(); } catch { } }, 320);
                        setTimeout(() => { try { resumeVideoAfterAuxWindowOpen(); } catch { } }, 900);
                        setTimeout(() => {
                            try {
                                if (state.activeMedia === 'video' && elements.videoPlayer?.paused && !videoManualPauseByUser) {
                                    const p = elements.videoPlayer.play();
                                    if (p && typeof p.catch === 'function') p.catch(() => { });
                                }
                            } catch { }
                        }, 1800);
                    }
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
    openModal(opts = {}) {
        if (this.elements.modal) {
            this.elements.modal.classList.remove('hidden');
            this.elements.modal.classList.add('active');
            this.elements.modal.classList.toggle('video-sfx-modal', !!opts.videoMode);
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
            this.elements.modal.classList.remove('video-sfx-modal');
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
