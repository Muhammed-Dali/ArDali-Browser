'use strict';

const $ = (id) => document.getElementById(id);
const els = {
    device: $('deviceSelect'),
    bigListen: $('bigListenBtn'),
    listenTitle: $('listenStateTitle'),
    listenSub: $('listenStateSub'),
    start: $('startBtn'),
    stop: $('stopBtn'),
    refresh: $('refreshBtn'),
    status: $('statusText'),
    level: $('levelBar'),
    hint: $('hintText'),
    results: $('results'),
    menu: $('menuBtn'),
    menuPopover: $('menuPopover'),
    themeSelect: $('themeSelect'),
    preferences: $('preferencesBtn'),
    about: $('aboutBtn'),
    listenView: $('listenView'),
    preferencesView: $('preferencesView'),
    aboutView: $('aboutView'),
    viewBack: $('viewBackBtn'),
    preferencesBack: $('preferencesBackBtn'),
    preferencesCancel: $('preferencesCancelBtn'),
    preferencesDefaults: $('preferencesDefaultsBtn'),
    preferencesSave: $('preferencesSaveBtn'),
    openPlatform: $('openPlatformSelect'),
    listenMode: $('listenModeSelect'),
    requestInterval: $('requestIntervalInput'),
    bufferSize: $('bufferSizeInput'),
    noDuplicates: $('noDuplicatesCheckbox'),
    webFallback: $('webFallbackCheckbox'),
    autoStop: $('autoStopCheckbox'),
    autoOpen: $('autoOpenCheckbox'),
    rememberDevice: $('rememberDeviceCheckbox'),
    aboutBack: $('aboutBackBtn'),
    aboutOk: $('aboutOkBtn')
};

let lastDevices = [];
let running = false;
let renderedRunning = null;
let renderedStatus = '';
let renderedListenTitle = '';
let renderedListenSub = '';
let renderedHint = '';
let renderedLevel = -1;
const visibleResultKeys = new Set();
let preferences = {
    open_platform: 'youtube',
    no_duplicates: true,
    web_metadata_fallback_enabled: true,
    auto_stop_on_result: true,
    auto_open_on_result: false,
    remember_audio_device: true,
    request_interval_secs_v3: 6,
    buffer_size_secs: 12,
    recognition_engine: 'songrec_only'
};

let currentStatusI18n = { key: 'listen.status.ready', fallback: 'Hazır' };
let currentListenI18n = {
    titleKey: 'listen.state.ready.title',
    titleFallback: 'Dinlemeye hazır',
    subKey: 'listen.state.ready.subtitle',
    subFallback: 'Ortadaki düğmeye bas bilgisayarda çalan şarkıyı bulmaya başlayayım'
};

function t(key, fallback = '', vars) {
    try {
        const value = window.i18n?.tSync?.(key, vars);
        if (value && value !== key) return value;
    } catch {
        // ignore
    }
    if (vars && typeof vars === 'object') {
        return String(fallback || key || '').replace(/\{(\w+)\}/g, (_m, name) => (
            Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : `{${name}}`
        ));
    }
    return fallback || String(key || '');
}

function setStatusKey(key, fallback, vars) {
    currentStatusI18n = { key, fallback, vars };
    setStatus(t(key, fallback, vars));
}

function setListenCopyKey(titleKey, titleFallback, subKey, subFallback, vars) {
    currentListenI18n = { titleKey, titleFallback, subKey, subFallback, vars };
    setListenCopy(t(titleKey, titleFallback, vars), t(subKey, subFallback, vars));
}

function applyTheme(theme, options = {}) {
    const rawTheme = String(theme || 'ardali').trim().toLowerCase();
    const nextTheme = rawTheme === 'github' ? 'light' : (rawTheme || 'ardali');
    const commitTheme = () => {
        document.documentElement.setAttribute('theme', nextTheme);
        localStorage.setItem('ardaliPulseTheme', nextTheme);
        localStorage.setItem('theme', nextTheme);
        if (els.themeSelect) els.themeSelect.value = nextTheme;
    };

    const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    if (!options.animate || prefersReducedMotion || typeof document.startViewTransition !== 'function') {
        commitTheme();
        return;
    }

    const x = window.innerWidth;
    const y = 0;
    const maxRadius = Math.hypot(window.innerWidth, window.innerHeight);
    const transition = document.startViewTransition(commitTheme);
    transition.ready.then(() => {
        document.documentElement.animate(
            {
                clipPath: [
                    `circle(0px at ${x}px ${y}px)`,
                    `circle(${maxRadius}px at ${x}px ${y}px)`
                ]
            },
            {
                duration: 1100,
                easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
                pseudoElement: '::view-transition-new(root)'
            }
        );
    }).catch(() => {});
}
const DEFAULT_PREFERENCES = {
    open_platform: 'youtube',
    no_duplicates: true,
    web_metadata_fallback_enabled: true,
    auto_stop_on_result: true,
    auto_open_on_result: false,
    remember_audio_device: true,
    request_interval_secs_v3: 6,
    buffer_size_secs: 12,
    recognition_engine: 'songrec_only'
};

function humanPulseReason(reason) {
    const key = String(reason || '').trim().toLowerCase();
    if (key === 'no-signal') return t('listen.reason.noSignal', 'Sinyal zayıf müziğin bilgisayarda çaldığından emin olun');
    if (key === 'not-enough-audio') return t('listen.reason.notEnoughAudio', 'Kısa bir örnek birikiyor biraz daha dinliyorum');
    if (key === 'not-enough-peaks') return t('listen.reason.notEnoughPeaks', 'Ses net değil daha temiz bir bölüm bekliyorum');
    if (key === 'no-match') return t('listen.reason.noMatch', 'Eşleşme bulunmadı dinlemeye devam ediyorum');
    if (key === 'rate-limited' || key === 'rate-limited-waiting') return t('listen.reason.rateLimited', 'Shazam istek limiti devrede kısa süre sonra tekrar deneyeceğim');
    if (key === 'network-timeout') return t('listen.reason.networkTimeout', 'Ağ yanıtı gecikti internet bağlantısını kontrol edin');
    if (key === 'acoustid-engine-unavailable') return t('listen.reason.acoustidUnavailable', 'AcoustID modu bu sürümde hazır değil. SongRec/Shazam uyumlu motoru seçin.');
    if (key === 'duplicate-result') return t('listen.reason.duplicateResult', 'Aynı parça tekrar bulundu listeye ikinci kez eklenmedi');
    return key || t('listen.status.listening', 'Dinleniyor');
}

function pulseReasonI18nKey(reason) {
    const key = String(reason || '').trim().toLowerCase();
    if (key === 'no-signal') return 'listen.reason.noSignal';
    if (key === 'not-enough-audio') return 'listen.reason.notEnoughAudio';
    if (key === 'not-enough-peaks') return 'listen.reason.notEnoughPeaks';
    if (key === 'no-match') return 'listen.reason.noMatch';
    if (key === 'rate-limited' || key === 'rate-limited-waiting') return 'listen.reason.rateLimited';
    if (key === 'network-timeout') return 'listen.reason.networkTimeout';
    if (key === 'acoustid-engine-unavailable') return 'listen.reason.acoustidUnavailable';
    if (key === 'duplicate-result') return 'listen.reason.duplicateResult';
    return 'listen.status.listening';
}

function getFillPercent(payload) {
    const direct = Number(payload?.fillPercent);
    if (Number.isFinite(direct) && direct > 0) return Math.max(0, Math.min(100, Math.round(direct)));
    const status = Number(payload?.bufferFillPercent);
    if (Number.isFinite(status) && status > 0) return Math.max(0, Math.min(100, Math.round(status)));
    return 0;
}

function setStatus(text) {
    const next = String(text || '');
    if (next === renderedStatus) return;
    renderedStatus = next;
    if (els.status) els.status.textContent = next;
}

function setListenCopy(title, subtitle) {
    const nextTitle = String(title || '');
    const nextSub = String(subtitle || '');
    if (els.listenTitle && nextTitle !== renderedListenTitle) {
        renderedListenTitle = nextTitle;
        els.listenTitle.textContent = nextTitle;
    }
    if (els.listenSub && nextSub !== renderedListenSub) {
        renderedListenSub = nextSub;
        els.listenSub.textContent = nextSub;
    }
}

function setHint(text) {
    renderedHint = String(text || '');
    if (els.hint) els.hint.textContent = '';
}

function setLevel(percent) {
    if (!els.level) return;
    const next = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
    if (Math.abs(next - renderedLevel) < 1) return;
    renderedLevel = next;
    els.level.style.transform = `scaleX(${next / 100})`;
}

function translateStaticPage() {
    document.title = t('listen.window.title', 'ArDali Dinle');
    window.i18n?.translatePage?.();
}

function refreshLocalizedUi() {
    translateStaticPage();
    renderedStatus = '';
    renderedListenTitle = '';
    renderedListenSub = '';
    setStatusKey(currentStatusI18n.key, currentStatusI18n.fallback, currentStatusI18n.vars);
    setListenCopyKey(
        currentListenI18n.titleKey,
        currentListenI18n.titleFallback,
        currentListenI18n.subKey,
        currentListenI18n.subFallback,
        currentListenI18n.vars
    );
    setRunningState(running, true);
    const selectedDevice = els.device?.value || '';
    if (lastDevices.length) {
        renderDevices(lastDevices);
        if (els.device) els.device.value = selectedDevice;
    }
}

async function initLanguage() {
    if (window.i18n && typeof window.i18n.init === 'function') {
        await window.i18n.init();
    }
    translateStaticPage();
}

function normalizeOpenPlatform(value) {
    const key = String(value || '').trim().toLowerCase();
    return ['youtube', 'ytmusic'].includes(key) ? key : 'youtube';
}

function selectedOpenPlatform() {
    return normalizeOpenPlatform(els.openPlatform?.value || preferences.open_platform);
}

function getListenModePreset(mode) {
    const key = String(mode || '').trim().toLowerCase();
    if (key === 'normal') return { request_interval_secs_v3: 8, buffer_size_secs: 10 };
    if (key === 'max') return { request_interval_secs_v3: 6, buffer_size_secs: 16 };
    return { request_interval_secs_v3: 6, buffer_size_secs: 12 };
}

function inferListenMode(prefs = preferences) {
    const req = Number(prefs.request_interval_secs_v3);
    const buf = Number(prefs.buffer_size_secs);
    if (req === 8 && buf === 10) return 'normal';
    if (req === 6 && buf === 12) return 'background';
    if (req === 6 && buf === 16) return 'max';
    if (req === 4 && buf === 16) return 'max';
    if (req === 10 && buf === 8) return 'normal';
    if (req === 5 && buf === 12) return 'normal';
    if (req === 4 && buf === 14) return 'background';
    if (req === 3 && buf === 16) return 'max';
    return 'custom';
}

function syncPreferenceForm() {
    if (els.openPlatform) els.openPlatform.value = normalizeOpenPlatform(preferences.open_platform);
    if (els.listenMode) els.listenMode.value = inferListenMode(preferences);
    if (els.requestInterval) els.requestInterval.value = String(preferences.request_interval_secs_v3 || 6);
    if (els.bufferSize) els.bufferSize.value = String(preferences.buffer_size_secs || 12);
    if (els.noDuplicates) els.noDuplicates.checked = preferences.no_duplicates !== false;
    if (els.webFallback) els.webFallback.checked = preferences.web_metadata_fallback_enabled !== false;
    if (els.autoStop) els.autoStop.checked = preferences.auto_stop_on_result !== false;
    if (els.autoOpen) els.autoOpen.checked = preferences.auto_open_on_result === true;
    if (els.rememberDevice) els.rememberDevice.checked = preferences.remember_audio_device !== false;
}

function normalizeResultKeyPart(value) {
    return String(value || '')
        .normalize('NFKC')
        .toLocaleLowerCase('tr-TR')
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim()
        .replace(/\s+/g, ' ');
}

function getVisibleResultKey(result = {}) {
    const trackKey = String(result?.trackKey || '').trim();
    if (trackKey) return `track:${trackKey}`;
    const title = normalizeResultKeyPart(result?.title);
    const artist = normalizeResultKeyPart(result?.artist);
    return `song:${artist}|${title}`;
}

function setMenuOpen(open) {
    const next = !!open;
    els.menuPopover?.classList.toggle('hidden', !next);
    els.menu?.classList.toggle('open', next);
    els.menu?.setAttribute('aria-expanded', next ? 'true' : 'false');
}

function showView(viewName) {
    setMenuOpen(false);
    const target = String(viewName || 'listen').trim().toLowerCase();
    els.listenView?.classList.toggle('hidden', target !== 'listen');
    els.preferencesView?.classList.toggle('hidden', target !== 'preferences');
    els.aboutView?.classList.toggle('hidden', target !== 'about');
    els.viewBack?.classList.toggle('hidden', target === 'listen');
}

async function loadPreferences() {
    const res = await window.ardali?.pulse?.getPreferences?.().catch(() => null);
    const prefs = res?.preferences && typeof res.preferences === 'object' ? res.preferences : {};
    preferences = {
        ...preferences,
        ...prefs,
        open_platform: normalizeOpenPlatform(prefs.open_platform),
        no_duplicates: prefs.no_duplicates !== false,
        web_metadata_fallback_enabled: prefs.web_metadata_fallback_enabled !== false,
        auto_stop_on_result: prefs.auto_stop_on_result !== false,
        auto_open_on_result: prefs.auto_open_on_result === true,
        remember_audio_device: prefs.remember_audio_device !== false,
        request_interval_secs_v3: Math.max(1, Math.min(120, Number(prefs.request_interval_secs_v3) || 6)),
        buffer_size_secs: Math.max(4, Math.min(30, Number(prefs.buffer_size_secs) || 12)),
        recognition_engine: 'songrec_only'
    };
    syncPreferenceForm();
}

async function savePreferencePatch(patch) {
    const next = {
        ...preferences,
        ...(patch || {})
    };
    next.open_platform = normalizeOpenPlatform(next.open_platform);
    next.no_duplicates = next.no_duplicates !== false;
    next.web_metadata_fallback_enabled = next.web_metadata_fallback_enabled !== false;
    next.auto_stop_on_result = next.auto_stop_on_result !== false;
    next.auto_open_on_result = next.auto_open_on_result === true;
    next.remember_audio_device = next.remember_audio_device !== false;
    next.request_interval_secs_v3 = Math.max(1, Math.min(120, Number(next.request_interval_secs_v3) || 6));
    next.buffer_size_secs = Math.max(4, Math.min(30, Number(next.buffer_size_secs) || 12));
    next.recognition_engine = 'songrec_only';
    const res = await window.ardali?.pulse?.savePreferences?.(next);
    const saved = res?.preferences && typeof res.preferences === 'object' ? res.preferences : next;
    preferences = {
        ...preferences,
        ...saved,
        open_platform: normalizeOpenPlatform(saved.open_platform),
        no_duplicates: saved.no_duplicates !== false,
        web_metadata_fallback_enabled: saved.web_metadata_fallback_enabled !== false,
        auto_stop_on_result: saved.auto_stop_on_result !== false,
        auto_open_on_result: saved.auto_open_on_result === true,
        remember_audio_device: saved.remember_audio_device !== false,
        request_interval_secs_v3: Math.max(1, Math.min(120, Number(saved.request_interval_secs_v3) || next.request_interval_secs_v3)),
        buffer_size_secs: Math.max(4, Math.min(30, Number(saved.buffer_size_secs) || next.buffer_size_secs)),
        recognition_engine: 'songrec_only'
    };
    syncPreferenceForm();
    return preferences;
}

function setRunningState(nextRunning, force = false) {
    const next = !!nextRunning;
    running = next;
    if (renderedRunning === next && !force) return;
    renderedRunning = next;
    if (els.start) els.start.disabled = running;
    if (els.stop) els.stop.disabled = !running;
    if (els.refresh) els.refresh.disabled = running;
    if (els.device) els.device.disabled = running;
    if (els.bigListen) {
        els.bigListen.classList.toggle('active', running);
        els.bigListen.classList.toggle('searching', running);
        els.bigListen.title = running
            ? t('listen.actions.stop', 'Dinlemeyi durdur')
            : t('listen.actions.start', 'Dinlemeyi başlat');
    }
    setListenCopyKey(
        running ? 'listen.state.listening.title' : 'listen.state.ready.title',
        running ? 'Dinliyorum' : 'Dinlemeye hazır',
        running ? 'listen.state.listening.subtitle' : 'listen.state.ready.subtitle',
        running
            ? 'Bilgisayarda çalan sesi analiz ediyorum. Sonuç geldiğinde aşağıdaki listeye eklenir.'
            : 'Ortadaki düğmeye bas bilgisayarda çalan şarkıyı bulmaya başlayayım'
    );
}

function getDeviceLabel(deviceId) {
    const id = String(deviceId || '').trim();
    if (!id) return t('listen.device.automatic', 'Otomatik cihaz');
    const found = lastDevices.find((device) => String(device?.id || '') === id);
    return found?.label || id;
}

function renderDevices(devices = []) {
    lastDevices = devices;
    els.device.innerHTML = '';
    if (!devices.length) {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = t('listen.device.none', 'Ses kaynağı bulunamadı');
        els.device.appendChild(option);
        return;
    }
    for (const device of devices) {
        const option = document.createElement('option');
        option.value = device.id;
        const prefix = device.isDefaultMonitor
            ? t('listen.device.defaultMonitorPrefix', 'Varsayılan monitor - ')
            : (device.isMonitor ? t('listen.device.monitorPrefix', 'Monitor - ') : '');
        option.textContent = `${prefix}${device.label || device.id}`;
        els.device.appendChild(option);
    }
}

async function refreshDevices() {
    setStatusKey('listen.status.readingDevices', 'Cihazlar okunuyor...');
    const res = await window.ardali?.pulse?.listDevices?.();
    renderDevices(res?.devices || []);
    const pref = await window.ardali?.pulse?.getPreferredDevice?.().catch(() => null);
    const defaultMonitor = lastDevices.find((device) => device.isDefaultMonitor);
    if (preferences.remember_audio_device !== false && pref?.audioDevice && lastDevices.some((device) => device.id === pref.audioDevice)) {
        els.device.value = pref.audioDevice;
    } else if (defaultMonitor?.id) {
        els.device.value = defaultMonitor.id;
    }
    setStatusKey(
        (res?.devices || []).length ? 'listen.status.ready' : 'listen.status.noDevice',
        (res?.devices || []).length ? 'Hazır' : 'Cihaz bulunamadı'
    );
}

function addResult(result) {
    const title = String(result?.title || '').trim();
    const artist = String(result?.artist || '').trim();
    const genre = String(result?.genre || '').trim();
    const coverUrl = String(result?.coverUrl || '').trim();
    if (!title && !artist) return false;
    const visibleKey = getVisibleResultKey(result);
    if (visibleKey && visibleResultKeys.has(visibleKey)) {
        if (running) {
            setListenCopyKey(
                'listen.state.listening.title',
                'Dinliyorum',
                'listen.reason.duplicateResult',
                'Aynı şarkı tekrar bulundu listeye ikinci kez eklenmedi'
            );
        }
        return false;
    }
    if (visibleKey) visibleResultKeys.add(visibleKey);
    const empty = els.results.querySelector('.empty');
    if (empty) empty.remove();
    const item = document.createElement('div');
    item.className = 'result';

    const art = document.createElement(coverUrl ? 'img' : 'div');
    art.className = 'result-art';
    if (coverUrl) {
        art.src = coverUrl;
        art.alt = '';
        art.loading = 'lazy';
        art.referrerPolicy = 'no-referrer';
    } else {
        art.textContent = '♪';
    }

    const text = document.createElement('div');
    text.className = 'result-text';
    const strong = document.createElement('strong');
    strong.textContent = title || t('listen.results.unknownTrack', 'Bilinmeyen parça');
    const span = document.createElement('span');
    span.textContent = artist || t('listen.results.unknownArtist', 'Bilinmeyen sanatçı');
    text.append(strong, span);
    if (genre) {
        const small = document.createElement('small');
        small.textContent = genre;
        text.appendChild(small);
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = t('listen.results.open', 'Aç');
    button.title = t('listen.results.openInApp', 'Ana uygulamada ara');
    button.addEventListener('click', () => openResultInApp(result));
    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.className = 'delete-result';
    removeButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3h6l1 2h4v2H4V5h4l1-2Zm1 7h2v8h-2v-8Zm4 0h2v8h-2v-8ZM7 9h10l-.7 11H7.7L7 9Z" fill="currentColor"></path></svg>';
    removeButton.title = t('listen.results.remove', 'Bu sonucu kaldır');
    removeButton.setAttribute('aria-label', t('listen.results.remove', 'Bu sonucu kaldır'));
    removeButton.addEventListener('click', () => {
        item.remove();
        if (visibleKey) visibleResultKeys.delete(visibleKey);
        if (!els.results.querySelector('.result')) {
            const placeholder = document.createElement('div');
            placeholder.className = 'empty';
            placeholder.textContent = t('listen.results.empty', 'Henüz bulunan şarkı yok.');
            placeholder.setAttribute('data-i18n', 'listen.results.empty');
            els.results.appendChild(placeholder);
        }
    });
    const controls = document.createElement('div');
    controls.className = 'result-actions';
    controls.append(button, removeButton);
    item.append(art, text, controls);
    els.results.prepend(item);
    return true;
}

function openResultInApp(result = {}) {
    const title = String(result?.title || '').trim();
    const artist = String(result?.artist || '').trim();
    const query = [artist, title].filter(Boolean).join(' ');
    if (!query) return;
    window.ardali?.pulse?.openQueryInApp?.({ query, platform: selectedOpenPlatform(), result });
}

async function start() {
    const audioDevice = els.device.value || '';
    const res = await window.ardali?.pulse?.startListening?.({
        audioDevice,
        autoSwitchOutputMonitor: true
    });
    if (!res?.success) {
        setStatusKey('listen.status.startFailed', 'Başlatılamadı: {error}', { error: res?.error || t('listen.status.unknownError', 'bilinmeyen hata') });
        setRunningState(false);
        return;
    }
    setRunningState(true);
    const activeDevice = res?.status?.audioDevice || audioDevice;
    setStatusKey('listen.status.listeningDevice', 'Dinliyor - {device}', { device: getDeviceLabel(activeDevice) });
    setListenCopyKey(
        'listen.state.listening.title',
        'Dinliyorum',
        'listen.state.buffering.subtitle',
        'Canlı örnek birikiyor ilk sonuç birkaç saniye içinde gelir'
    );
}

async function stop() {
    await window.ardali?.pulse?.stopListening?.();
    setRunningState(false);
    setStatusKey('listen.status.stopped', 'Durduruldu');
    setLevel(0);
}

async function toggleBigListen() {
    if (running) {
        await stop();
        return;
    }
    await start();
}

els.bigListen?.addEventListener('click', toggleBigListen);
els.start?.addEventListener('click', start);
els.stop?.addEventListener('click', stop);
els.refresh?.addEventListener('click', refreshDevices);
els.menu?.addEventListener('click', (event) => {
    event.stopPropagation();
    setMenuOpen(els.menuPopover?.classList.contains('hidden'));
});
els.preferences?.addEventListener('click', () => {
    syncPreferenceForm();
    showView('preferences');
});
els.about?.addEventListener('click', () => showView('about'));
els.themeSelect?.addEventListener('change', () => {
    applyTheme(els.themeSelect.value, { animate: true });
});
els.preferencesBack?.addEventListener('click', () => showView('listen'));
els.viewBack?.addEventListener('click', () => showView('listen'));
els.preferencesCancel?.addEventListener('click', () => showView('listen'));
els.preferencesDefaults?.addEventListener('click', () => {
    preferences = {
        ...preferences,
        ...DEFAULT_PREFERENCES
    };
    syncPreferenceForm();
});
els.preferencesSave?.addEventListener('click', async () => {
    await savePreferencePatch({
        open_platform: selectedOpenPlatform(),
        no_duplicates: !!els.noDuplicates?.checked,
        web_metadata_fallback_enabled: !!els.webFallback?.checked,
        auto_stop_on_result: !!els.autoStop?.checked,
        auto_open_on_result: !!els.autoOpen?.checked,
        remember_audio_device: !!els.rememberDevice?.checked,
        request_interval_secs_v3: Number(els.requestInterval?.value) || preferences.request_interval_secs_v3,
        buffer_size_secs: Number(els.bufferSize?.value) || preferences.buffer_size_secs,
        recognition_engine: 'songrec_only'
    });
    showView('listen');
    setStatusKey('listen.status.preferencesSaved', 'Tercihler kaydedildi');
});
els.listenMode?.addEventListener('change', () => {
    if (els.listenMode.value === 'custom') return;
    const preset = getListenModePreset(els.listenMode.value);
    if (els.requestInterval) els.requestInterval.value = String(preset.request_interval_secs_v3);
    if (els.bufferSize) els.bufferSize.value = String(preset.buffer_size_secs);
});
els.requestInterval?.addEventListener('input', () => {
    if (els.listenMode) els.listenMode.value = 'custom';
});
els.bufferSize?.addEventListener('input', () => {
    if (els.listenMode) els.listenMode.value = 'custom';
});
els.aboutBack?.addEventListener('click', () => showView('listen'));
els.aboutOk?.addEventListener('click', () => showView('listen'));
document.addEventListener('click', (event) => {
    if (!els.menuPopover || els.menuPopover.classList.contains('hidden')) return;
    const target = event.target;
    if (target instanceof Node && (els.menuPopover.contains(target) || els.menu?.contains(target))) return;
    setMenuOpen(false);
});
document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    setMenuOpen(false);
    showView('listen');
});

window.ardali?.onSettingsReload?.((nextSettings) => {
    const nextLang = String(nextSettings?.ui?.language || '').trim();
    if (nextLang && window.i18n?.setLanguage) {
        window.i18n.setLanguage(nextLang, { skipPersist: true })
            .then(refreshLocalizedUi)
            .catch(refreshLocalizedUi);
    } else {
        refreshLocalizedUi();
    }
});

window.i18n?.onChange?.(refreshLocalizedUi);

applyTheme(localStorage.getItem('ardaliPulseTheme') || localStorage.getItem('theme') || 'ardali');

initLanguage()
    .then(refreshLocalizedUi)
    .catch(refreshLocalizedUi);

setRunningState(false);

window.ardali?.pulse?.onState?.((state) => {
    setRunningState(!!state?.running);
    if (state?.running) {
        if (state?.audioDevice && els.device && lastDevices.some((device) => device.id === state.audioDevice)) {
            els.device.value = state.audioDevice;
        }
        setStatusKey(
            'listen.status.listeningDevice',
            'Dinliyor - {device}',
            { device: state?.warning ? humanPulseReason(state.warning) : getDeviceLabel(state?.audioDevice) }
        );
        if (state?.bufferFillPercent > 0 && state.bufferFillPercent < 72) {
            setListenCopyKey(
                'listen.state.listening.title',
                'Dinliyorum',
                'listen.state.bufferFill.subtitle',
                'Canlı örnek doluyor %{percent}',
                { percent: Math.round(state.bufferFillPercent) }
            );
        }
    } else if (state?.lastError) {
        setStatusKey('listen.status.notReady', 'Hazır değil - {error}', { error: state.lastError });
    } else {
        setStatusKey('listen.status.ready', 'Hazır');
    }
    if (typeof state?.levelPercent === 'number') {
        setLevel(state.levelPercent);
    }
});

window.ardali?.pulse?.onResult?.(async (result) => {
    const added = addResult(result);
    if (!added) return;
    if (preferences.auto_open_on_result === true) {
        openResultInApp(result);
    }
    if (preferences.auto_stop_on_result !== false) {
        await window.ardali?.pulse?.stopListening?.();
        setRunningState(false);
        setLevel(0);
    }
    setStatusKey('listen.status.found', 'Eşleşme bulundu');
    setListenCopyKey(
        'listen.state.found.title',
        'Eşleşme bulundu',
        preferences.auto_stop_on_result !== false
            ? 'listen.state.found.subtitle'
            : 'listen.state.found.continueSubtitle',
        preferences.auto_stop_on_result !== false
            ? 'Sonuç listeye eklendi'
            : 'Sonuç listeye eklendi dinlemeye devam ediyorum'
    );
});
window.ardali?.pulse?.onVolume?.((payload) => {
    setLevel(payload?.percent);
    const fill = Math.round(Number(payload?.bufferFillPercent) || 0);
    if (running && fill > 0 && fill < 72) {
        setListenCopyKey(
            'listen.state.listening.title',
            'Dinliyorum',
            'listen.state.bufferFill.subtitle',
            'Canlı örnek doluyor %{percent}',
            { percent: fill }
        );
    }
});
window.ardali?.pulse?.onUncertain?.((payload) => {
    const reason = String(payload?.reason || '').trim();
    if (reason === 'not-enough-audio') {
        const fill = getFillPercent(payload);
        if (fill > 0) {
            setListenCopyKey(
                'listen.state.listening.title',
                'Dinliyorum',
                'listen.state.bufferFill.subtitle',
                'Canlı örnek doluyor %{percent}',
                { percent: fill }
            );
        } else {
            setListenCopyKey('listen.state.listening.title', 'Dinliyorum', 'listen.reason.notEnoughAudio', humanPulseReason(reason));
        }
        return;
    }
    if (running) setListenCopyKey('listen.state.listening.title', 'Dinliyorum', pulseReasonI18nKey(reason), humanPulseReason(reason));
});

loadPreferences()
    .catch(() => {})
    .then(() => refreshDevices())
    .catch((error) => {
        setStatusKey('listen.status.readDevicesFailed', 'Cihazlar okunamadı: {error}', { error: error?.message || error });
    });

window.ardali?.pulse?.getStatus?.().then((res) => {
    const status = res?.status || {};
    setRunningState(!!status.running);
    if (status.running) {
        setStatusKey('listen.status.listeningDevice', 'Dinliyor - {device}', { device: getDeviceLabel(status.audioDevice) });
    }
}).catch(() => {
    setRunningState(false);
});
