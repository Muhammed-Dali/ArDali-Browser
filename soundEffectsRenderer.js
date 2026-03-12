/**
 * Aurivo Medya Player - Ses Efektleri Renderer
 * Profesyonel DSP & EQ Arayüzü
 */

// ============================================
// GLOBAL STATE
// ============================================
const SFX = {
    currentEffect: 'eq32',
    masterEnabled: true,
    settings: {},
    eqSliders: [],      // Array of RainbowSlider instances
    knobInstances: {},  // Map of "effectName_paramName" -> ColorKnob instance
    barAnalyzer: null,
    autoGainInterval: null,  // Auto Gain periyodik güncelleme timer'ı
    suppressEq32SliderEvents: false,
    eq32PersistTimer: null,
    eq32PersistInFlight: false,
    crossfeedStatusInterval: null,
    crossfeedDeviceInterval: null,
    crossfeedAutoForcedBySystem: false,
    surroundStatusInterval: null,
    surroundAutoForcedBySystem: false,
    eqTopViz: {
        running: false,
        frameId: 0,
        lastFetchAt: 0,
        busy: false,
        bars: new Uint8Array(0),
        smooth: new Float32Array(0),
        norm: 0.02,
        rawNorm: 0.02
    },

    // 32-Band EQ Frekansları
    eqFrequencies: [
        '20', '25', '31', '40', '50', '63', '80', '100',
        '125', '160', '200', '250', '315', '400', '500', '630',
        '800', '1k', '1.3k', '1.6k', '2k', '2.5k', '3.2k', '4k',
        '5k', '6.3k', '8k', '10k', '12.5k', '16k', '20k', '22k'
    ],

    // Varsayılan Efekt Ayarları
    defaults: {
        eq32: {
            bands: new Array(32).fill(0),
            bass: 0,
            mid: 0,
            treble: 0,
            stereoExpander: 100,
            balance: 0,
            acousticSpace: 'off'
        },
        reverb: {
            enabled: false,
            roomSize: 1000,
            damping: 0.5,
            wetDry: -10,
            hfRatio: 0.7,
            inputGain: 0,
            lastPreset: null
        },
        compressor: {
            enabled: false,
            threshold: -20,
            ratio: 4,
            attack: 10,
            release: 100,
            makeupGain: 0,
            knee: 3
        },
        limiter: {
            enabled: false,
            ceiling: -0.3,
            release: 50,
            lookahead: 5,
            gain: 0
        },
        bassboost: {
            enabled: false,
            frequency: 80,
            gain: 6,
            harmonics: 50,
            width: 1.5,
            mix: 50
        },
        noisegate: {
            enabled: false,
            threshold: -40,
            attack: 5,
            hold: 100,
            release: 150,
            range: -80
        },
        deesser: {
            enabled: false,
            frequency: 7000,
            threshold: -30,
            ratio: 4,
            range: -12,
            listenMode: false
        },
        exciter: {
            enabled: false,
            frequency: 3000,
            amount: 50,
            harmonics: 'odd',
            mix: 30
        },
        stereowidener: {
            enabled: false,
            width: 100,
            centerLevel: 0,
            sideLevel: 0,
            bassToMono: 200
        },
        echo: {
            enabled: false,
            delay: 250,
            feedback: 40,
            wetDry: 30,
            highCut: 8000
        },
        softecho: {
            enabled: false,
            delay: 220,
            feedback: 22,
            wetMix: 18,
            highCut: 7000,
            stereo: false,
            lastPreset: 'natural'
        },
        convreverb: {
            enabled: false,
            preset: 'hall',
            mix: 30,
            predelay: 20
        },
        peq: {
            enabled: false,
            bands: [
                { freq: 100, gain: 0, q: 1.0 },
                { freq: 500, gain: 0, q: 1.0 },
                { freq: 1000, gain: 0, q: 1.0 },
                { freq: 4000, gain: 0, q: 1.0 },
                { freq: 10000, gain: 0, q: 1.0 }
            ]
        },
        autogain: {
            enabled: false,
            targetLevel: -14,
            maxGain: 12,
            speed: 'medium'
        },
        truepeak: {
            enabled: false,
            ceiling: -0.1,
            release: 50,
            lookahead: 5,
            drive: 0,
            oversampling: 4,
            linkChannels: true,
            lastPreset: 'balanced'
        },
        crossfeed: {
            enabled: false,
            level: 30,
            delay: 0.3,
            lowCut: 700,
            highCut: 4000,
            preset: 0,
            autoHeadphones: true
        },
        surround: {
            enabled: false,
            center: 0,
            surround: 0,
            lfe: 0,
            crossover: 110,
            delay: 8,
            mix: 75,
            autoMultichannel: false,
            lastPreset: 'movie'
        },
        bassmono: {
            enabled: false,
            cutoff: 120,
            slope: 24,
            stereoWidth: 100,
            lastPreset: null
        },
        dynamiceq: {
            enabled: false,
            frequency: 3500,
            q: 2.0,
            threshold: -40,
            gain: -6,
            range: 12,
            attack: 5,
            release: 120,
            lastPreset: null
        },
        tapesat: {
            enabled: false,
            driveDb: 6,
            mix: 50,
            tone: 50,
            outputDb: -1,
            mode: 0,
            hiss: 0,
            lastPreset: null
        },
        bitdither: {
            enabled: false,
            bitDepth: 16,
            dither: 2,         // TPDF
            shaping: 0,        // Off
            downsample: 1,     // 1x
            mix: 100,
            outputDb: 0,
            lastPreset: null
        },
        'bass-enhancer': {
            enabled: false,
            frequency: 80,
            gain: 6,
            harmonics: 50,
            width: 1.5,
            dryWet: 50
        }
    }
}

// Video oynatma kararlılığı için güvenli mod:
// Efektler sekmesindeki ağır animasyonları kapatır.
const SFX_ANIM_SAFE_MODE = false;

// RAM öncelikli mod: sekme değişince eski panel DOM'unu boşalt
const RAM_PRIORITY_MODE = false;

// 32-band EQ ağır görsellerini düşük yük modunda çalıştır.
// Video oynarken pause/freeze etkisini azaltmak için animasyonları sadeleştirir.
const SFX_LOW_LOAD_EQ32 = false;

// EQ debug loglarını kapat/aç
const DEBUG_EQ = false;

const SFX_EMBEDDED_MODE = (() => {
    try {
        return new URLSearchParams(window.location.search).get('embedded') === '1';
    } catch {
        return false;
    }
})();

const EMBED_VIDEO_SFX_SETTINGS_KEY = 'aurivo_video_sfx_settings_v1';
let SFX_RUNTIME_ANIMS_ACTIVE = true;
let SFX_APPLIED_LANG = '';

function normalizeSfxLightsEnabled(value) {
    return value !== false;
}

function getSfxLightsFromShadowStorage() {
    try {
        const raw = localStorage.getItem('aurivo_ui_sfx_lights_enabled');
        if (raw === '0') return false;
        if (raw === '1') return true;
    } catch {
        // ignore
    }
    return null;
}

async function applySfxLightsFromAppSettings() {
    try {
        const shadow = getSfxLightsFromShadowStorage();
        if (typeof shadow === 'boolean') {
            document.documentElement.dataset.sfxLights = shadow ? 'on' : 'off';
            return;
        }
        if (!window.aurivo?.loadSettings) return;
        const appSettings = await window.aurivo.loadSettings();
        const enabled = normalizeSfxLightsEnabled(
            appSettings?.appearance?.sfxLights ?? appSettings?.ui?.sfxLightsEnabled
        );
        document.documentElement.dataset.sfxLights = enabled ? 'on' : 'off';
    } catch {
        document.documentElement.dataset.sfxLights = 'on';
    }
}

function postEmbeddedVideoUpdate(payload) {
    try {
        if (!SFX_EMBEDDED_MODE) return;
        window.parent?.postMessage({ type: 'sfx:videoUpdate', payload }, '*');
    } catch {
        // ignore
    }
}

function installEmbeddedVideoBridge() {
    if (!SFX_EMBEDDED_MODE) return;

    const safeLoad = async () => {
        try {
            const raw = localStorage.getItem(EMBED_VIDEO_SFX_SETTINGS_KEY);
            return raw ? JSON.parse(raw) : {};
        } catch {
            return {};
        }
    };
    const safeSave = async (next) => {
        try {
            localStorage.setItem(EMBED_VIDEO_SFX_SETTINGS_KEY, JSON.stringify(next || {}));
            return true;
        } catch {
            return false;
        }
    };

    const bridgeAudio = {
        isNativeAvailable: () => true,
        on: () => true,
        setEffectsEnabled: (enabled) => {
            postEmbeddedVideoUpdate({ type: 'dspEnabled', enabled: !!enabled });
            return true;
        },
        setDSPEnabled: (enabled) => {
            postEmbeddedVideoUpdate({ type: 'dspEnabled', enabled: !!enabled });
            return true;
        },
        setBalance: (value) => {
            postEmbeddedVideoUpdate({ type: 'balance', balance: Number(value) || 0 });
            return true;
        },
        setBass: () => true,
        setMid: () => true,
        setTreble: () => true,
        setStereoExpander: () => true,
        preamp: {
            set: (gainDB) => {
                postEmbeddedVideoUpdate({ type: 'preamp', gainDB: Number(gainDB) || 0 });
                return true;
            },
            get: async () => 0
        },
        balance: {
            set: (value) => {
                postEmbeddedVideoUpdate({ type: 'balance', balance: Number(value) || 0 });
                return true;
            },
            get: async () => 0
        },
        eq: {
            setBand: (band, gainDB) => {
                postEmbeddedVideoUpdate({ type: 'eqBand', band: Number(band) || 0, gainDB: Number(gainDB) || 0 });
                return true;
            },
            setAllBands: (bands) => {
                postEmbeddedVideoUpdate({ type: 'eqBands', bands: Array.isArray(bands) ? bands : [] });
                return true;
            },
            resetBands: () => {
                postEmbeddedVideoUpdate({ type: 'eqBands', bands: new Array(32).fill(0) });
                return true;
            },
            getAllBands: async () => new Array(32).fill(0)
        }
    };

    const makeNoopProxy = (path = []) => new Proxy(() => true, {
        get(_t, prop) {
            if (prop === 'then') return undefined;
            return makeNoopProxy(path.concat(String(prop)));
        },
        apply(_t, _thisArg, args) {
            const p = path.join('.');
            // Route the few controls that video WebAudio graph currently supports.
            if (p === 'eq.setBand' || p === 'ipcAudio.eq.setBand') {
                postEmbeddedVideoUpdate({ type: 'eqBand', band: Number(args[0]) || 0, gainDB: Number(args[1]) || 0 });
                return Promise.resolve(true);
            }
            if (p === 'eq.setAllBands' || p === 'ipcAudio.eq.setAllBands') {
                postEmbeddedVideoUpdate({ type: 'eqBands', bands: Array.isArray(args[0]) ? args[0] : [] });
                return Promise.resolve(true);
            }
            if (p === 'ipcAudio.eq.resetBands' || p === 'eq.resetBands') {
                postEmbeddedVideoUpdate({ type: 'eqReset' });
                return Promise.resolve(true);
            }
            if (p === 'balance.set' || p === 'ipcAudio.balance.set') {
                postEmbeddedVideoUpdate({ type: 'balance', balance: Number(args[0]) || 0 });
                return Promise.resolve(true);
            }
            if (p === 'preamp.set') {
                postEmbeddedVideoUpdate({ type: 'preamp', gainDB: Number(args[0]) || 0 });
                return Promise.resolve(true);
            }
            if (p === 'setEffectsEnabled' || p === 'setDSPEnabled' || p === 'ipcAudio.setDSPEnabled') {
                postEmbeddedVideoUpdate({ type: 'dspEnabled', enabled: !!args[0] });
                return Promise.resolve(true);
            }
            if (p.endsWith('.getAllBands')) return Promise.resolve(new Array(32).fill(0));
            if (p.endsWith('.getParams')) return Promise.resolve({});
            if (p.endsWith('.getMeter')) return Promise.resolve({ inPeak: -120, outPeak: -120, gainReduction: 0, clipped: 0 });
            if (p.endsWith('.getGainReduction') || p.endsWith('.getReduction')) return Promise.resolve(0);
            return Promise.resolve(true);
        }
    });

    try {
        if (!window.aurivo) window.aurivo = {};
        window.aurivo.loadSettings = safeLoad;
        window.aurivo.saveSettings = safeSave;
        window.aurivo.audio = bridgeAudio;
        window.aurivo.ipcAudio = makeNoopProxy(['ipcAudio']);
    } catch {
        // ignore
    }
}

installEmbeddedVideoBridge();

function currentLangCode() {
    try {
        return String(window.i18n?.getLanguage?.() || window.i18n?.locale || '').trim();
    } catch {
        return '';
    }
}

async function applyEmbeddedLanguage(lang, { forceRefresh = false } = {}) {
    const nextLang = String(lang || '').trim();
    if (!nextLang) return;

    if (!forceRefresh && SFX_APPLIED_LANG && SFX_APPLIED_LANG === nextLang) {
        return;
    }

    try {
        if (window.i18n?.setLanguage) {
            await window.i18n.setLanguage(nextLang, { skipPersist: true });
        } else if (window.i18n?.setLanguagePreference) {
            await window.i18n.setLanguagePreference(nextLang);
            window.i18n?.translatePage?.();
        }
    } catch {
        // ignore
    }

    const resolved = currentLangCode() || nextLang;
    const langChanged = SFX_APPLIED_LANG !== resolved;
    SFX_APPLIED_LANG = resolved;

    if (langChanged || forceRefresh) {
        refreshLocalizedRuntimeUi();
    }
}

async function syncEmbeddedLanguageFromParent() {
    if (!SFX_EMBEDDED_MODE) return;
    try {
        const parentLang = String(window.parent?.i18n?.getLanguage?.() || window.parent?.i18n?.locale || '').trim();
        if (!parentLang) return;
        await applyEmbeddedLanguage(parentLang, { forceRefresh: true });
    } catch {
        // ignore
    }
}

function syncMeterLoops() {
    if (!SFX_RUNTIME_ANIMS_ACTIVE) {
        stopTruePeakMeter();
        stopAutoGainMeter();
        stopCompressorMeter();
        stopLimiterMeter();
        stopEqTopVisualizer();
        return;
    }
    if (SFX.currentEffect === 'truepeak') startTruePeakMeter(); else stopTruePeakMeter();
    if (SFX.currentEffect === 'autogain') startAutoGainMeter(); else stopAutoGainMeter();
    if (SFX.currentEffect === 'compressor') startCompressorMeter(); else stopCompressorMeter();
    if (SFX.currentEffect === 'limiter') startLimiterMeter(); else stopLimiterMeter();
    if (SFX.currentEffect === 'eq32') startEqTopVisualizer(); else stopEqTopVisualizer();
}

function setRuntimeAnimationsActive(active) {
    const next = !!active;
    if (SFX_RUNTIME_ANIMS_ACTIVE === next) return;
    SFX_RUNTIME_ANIMS_ACTIVE = next;

    if (!next) {
        pauseAllEffectAnimations();
        syncMeterLoops();
        return;
    }

    if (!SFX_ANIM_SAFE_MODE) setEffectAnimationsActive(SFX.currentEffect, true);
    syncMeterLoops();
}

function dbgEq(...args) {
    if (DEBUG_EQ) console.log(...args);
}

function tSync(key, vars) {
    try {
        if (window.i18n?.tSync) return window.i18n.tSync(key, vars);
    } catch {
        // ignore
    }
    return String(key);
}

function tOr(key, fallback) {
    const v = tSync(key);
    return v && v !== key ? v : fallback;
}

function getKnobLabel(effectName, param, fallback) {
    const p = String(param || '');
    const specificKey = `sfx.knob.${effectName}.${p}`;
    const specific = tSync(specificKey);
    if (specific && specific !== specificKey) return specific;

    // PEQ gibi band0_freq -> freq normalizasyonu
    const m = p.match(/^band\d+_(.+)$/i);
    const normalized = m ? m[1] : p;
    const genericKey = `sfx.knob.param.${normalized}`;
    return tOr(genericKey, fallback);
}

function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (ch) => {
        switch (ch) {
            case '&':
                return '&amp;';
            case '<':
                return '&lt;';
            case '>':
                return '&gt;';
            case '"':
                return '&quot;';
            case '\'':
                return '&#39;';
            default:
                return ch;
        }
    });
}

function getPresetIconSvg(iconName) {
    const icons = {
        room: '<svg class="preset-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2.5 7.2 8 2.8l5.5 4.4v6.3h-11V7.2Z" stroke="currentColor" stroke-width="1.4"/><path d="M6.2 13.5v-3h3.6v3" stroke="currentColor" stroke-width="1.4"/></svg>',
        building: '<svg class="preset-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="3" y="2.5" width="10" height="11" rx="1.5" stroke="currentColor" stroke-width="1.4"/><path d="M6 5.5h1.5M8.5 5.5H10M6 8h1.5M8.5 8H10M6 10.5h1.5M8.5 10.5H10" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',
        hall: '<svg class="preset-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2.5 6h11v7.5h-11V6Z" stroke="currentColor" stroke-width="1.4"/><path d="M4 6V3.5h8V6M5.2 9h5.6M5.2 11.2h5.6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
        church: '<svg class="preset-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 2.2v3.2M6.4 3.8h3.2M4 6.2h8v7.3H4V6.2Z" stroke="currentColor" stroke-width="1.4"/><path d="M6.5 13.5v-2.2h3v2.2" stroke="currentColor" stroke-width="1.3"/></svg>',
        plate: '<svg class="preset-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="2.5" y="3.5" width="11" height="9" rx="1.8" stroke="currentColor" stroke-width="1.4"/><path d="M5 6.2h6M5 8h6M5 9.8h6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',
        natural: '<svg class="preset-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M12.8 3.2c-4.2 0-7.6 3.4-7.6 7.6V13h2.2c4.2 0 7.6-3.4 7.6-7.6V3.2h-2.2Z" stroke="currentColor" stroke-width="1.4"/><path d="M6 10.6c1.6-1.9 3.4-3.5 5.5-4.7" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
        mild: '<svg class="preset-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 8c2-1.8 4-1.8 6 0s4 1.8 4 0" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M3 11c2-1.5 4-1.5 6 0" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',
        strong: '<svg class="preset-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="2" y="9" width="2.5" height="5" rx="1" fill="currentColor"/><rect x="6.75" y="6.5" width="2.5" height="7.5" rx="1" fill="currentColor"/><rect x="11.5" y="3" width="2.5" height="11" rx="1" fill="currentColor"/></svg>',
        wide: '<svg class="preset-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 8h10M4.5 5.5 2.8 8l1.7 2.5M11.5 5.5 13.2 8l-1.7 2.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
        custom: '<svg class="preset-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 2.8 9.2 5l2.4.3-1.7 1.7.4 2.4L8 8.2l-2 1.2.4-2.4L4.7 5.3 7 5l1-2.2Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>',
        vinyl: '<svg class="preset-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="5.8" stroke="currentColor" stroke-width="1.4"/><circle cx="8" cy="8" r="1.8" stroke="currentColor" stroke-width="1.4"/></svg>',
        club: '<svg class="preset-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4.2 10.8V5.4l5.6-1.2v5.2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><circle cx="4.2" cy="11.6" r="1.4" stroke="currentColor" stroke-width="1.2"/><circle cx="9.8" cy="10.6" r="1.4" stroke="currentColor" stroke-width="1.2"/></svg>',
        mastering: '<svg class="preset-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 4h10M3 8h10M3 12h10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><circle cx="6" cy="4" r="1.3" fill="currentColor"/><circle cx="10.5" cy="8" r="1.3" fill="currentColor"/><circle cx="7.5" cy="12" r="1.3" fill="currentColor"/></svg>',
        dj: '<svg class="preset-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="5" cy="8" r="2.2" stroke="currentColor" stroke-width="1.3"/><circle cx="11" cy="8" r="2.2" stroke="currentColor" stroke-width="1.3"/><path d="M7.2 8h1.6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
        sub: '<svg class="preset-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="3" y="4" width="5" height="8" rx="1.4" stroke="currentColor" stroke-width="1.3"/><path d="M10 6.3c1 .5 1.8 1 2.5 1.7M10 9.7c1-.5 1.8-1 2.5-1.7" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
        vocal: '<svg class="preset-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="6" y="2.8" width="4" height="6" rx="2" stroke="currentColor" stroke-width="1.3"/><path d="M4.5 7.8a3.5 3.5 0 0 0 7 0M8 11.3V14M6.2 14h3.6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
        target: '<svg class="preset-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="5.5" stroke="currentColor" stroke-width="1.3"/><circle cx="8" cy="8" r="2.5" stroke="currentColor" stroke-width="1.3"/><circle cx="8" cy="8" r="1" fill="currentColor"/></svg>',
        sparkle: '<svg class="preset-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 2.8 9.1 6 12.3 7.1 9.1 8.2 8 11.4 6.9 8.2 3.7 7.1 6.9 6 8 2.8Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>',
        mute: '<svg class="preset-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 6.3h2.5l3-2.5v8.4l-3-2.4H3V6.3Z" stroke="currentColor" stroke-width="1.3"/><path d="M11.5 5 14 11M14 5l-2.5 6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
        guitar: '<svg class="preset-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M10.5 3.2 12.8 5.5 8 10.3a2.2 2.2 0 1 1-3-3l4.8-4.8Z" stroke="currentColor" stroke-width="1.3"/><path d="M10 4.8 11.2 6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',
        air: '<svg class="preset-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2.8 6.3c1.3-1.1 2.7-1.1 4 0s2.7 1.1 4 0" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M5.2 9.3c.9-.7 1.8-.7 2.7 0" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',
        drum: '<svg class="preset-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true"><ellipse cx="8" cy="8.5" rx="4.8" ry="2.5" stroke="currentColor" stroke-width="1.3"/><path d="M3.2 8.5V11c0 1.4 2.2 2.5 4.8 2.5s4.8-1.1 4.8-2.5V8.5" stroke="currentColor" stroke-width="1.2"/></svg>',
        flame: '<svg class="preset-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M9.8 2.7c.4 1.8-1 2.6-1.7 3.7-.8 1.2-.7 2.2.1 3.1.5.5.7 1.1.7 1.8 0 1.4-1 2.4-2.4 2.4A2.4 2.4 0 0 1 4 11.3c0-2.7 1.8-4 3.1-5.7.9-1.1 1.8-1.9 2.7-2.9Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>',
        tape: '<svg class="preset-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="2.5" y="3.5" width="11" height="9" rx="1.6" stroke="currentColor" stroke-width="1.3"/><circle cx="6" cy="8" r="1.6" stroke="currentColor" stroke-width="1.2"/><circle cx="10" cy="8" r="1.6" stroke="currentColor" stroke-width="1.2"/></svg>',
        ice: '<svg class="preset-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 2.8 12 6.8 8 13.2 4 6.8 8 2.8Z" stroke="currentColor" stroke-width="1.3"/><path d="M8 4.8v6.5" stroke="currentColor" stroke-width="1.2"/></svg>',
        retro: '<svg class="preset-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="2.8" y="4" width="10.4" height="8" rx="1.3" stroke="currentColor" stroke-width="1.3"/><path d="M5 7.2h6M5 9.2h4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',
        game: '<svg class="preset-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="2.5" y="6" width="11" height="5.5" rx="2.2" stroke="currentColor" stroke-width="1.3"/><path d="M6 8.7H4.6M5.3 8v1.4M10.2 8.3h.1M11.5 9h.1" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',
        burst: '<svg class="preset-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m8 2.5 1.4 3.2 3.3.4-2.5 2 0 3.2L8 9.8l-2.2 1.5 0-3.2-2.5-2 3.3-.4L8 2.5Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>'
    };
    return icons[iconName] || icons.target;
}

function renderModernPresetButton({ panelId, preset, label, icon, active = false, extraClass = '' }) {
    const panelAttr = panelId ? ` data-panel="${panelId}"` : '';
    const safeLabel = escapeHtml(label);
    return `<button class="preset-btn modern-preset-btn ${extraClass} ${active ? 'active' : ''}" data-preset="${preset}"${panelAttr} aria-pressed="${active ? 'true' : 'false'}">${getPresetIconSvg(icon)}<span>${safeLabel}</span></button>`;
}

function getLocalizedPresetName(lastPreset) {
    const filename = String(lastPreset?.filename || '').toLowerCase();
    const name = String(lastPreset?.name || '');

    const flatKey = 'eqPresets.flatName';
    const flatLocalized = tSync(flatKey);
    const hasFlatLocalized = typeof flatLocalized === 'string' && flatLocalized && flatLocalized !== flatKey;

    const looksFlat =
        filename.includes('flat') ||
        name.toLowerCase() === 'flat' ||
        name.toLowerCase().includes('düz') ||
        name.toLowerCase().includes('duz');

    if (looksFlat && hasFlatLocalized) return flatLocalized;
    return name || '';
}

function safeNormalizeEq32Settings(settings) {
    const s = settings || {};
    s.bands = normalize32Bands(s.bands);
    if (!Number.isFinite(s.balance)) s.balance = 0;
    if (!Number.isFinite(s.bass)) s.bass = 0;
    if (!Number.isFinite(s.mid)) s.mid = 0;
    if (!Number.isFinite(s.treble)) s.treble = 0;
    if (!Number.isFinite(s.stereoExpander)) s.stereoExpander = 100;
    if (!('acousticSpace' in s)) s.acousticSpace = 'off';
    return s;
}

function updateEq32UIFromSettings(settings) {
    const bands = Array.isArray(settings?.bands) ? settings.bands : new Array(32).fill(0);

    // Sliderlar + değer etiketleri
    if (SFX.eqSliders && SFX.eqSliders.length > 0) {
        SFX.suppressEq32SliderEvents = true;
        try {
            for (let i = 0; i < 32; i++) {
                const slider = SFX.eqSliders[i];
                if (slider) slider.setValue(bands[i], { immediate: true });
                const valueEl = document.getElementById(`eqValue${i}`);
                if (valueEl) valueEl.textContent = `${Number(bands[i]).toFixed(1)}d`;
            }
        } finally {
            SFX.suppressEq32SliderEvents = false;
        }
    }

    // Aurivo modül knobları
    const bass = Number(settings?.bass);
    const mid = Number(settings?.mid);
    const treble = Number(settings?.treble);
    const stereoExpander = Number(settings?.stereoExpander);
    if (SFX.knobInstances['bass'] && Number.isFinite(bass)) SFX.knobInstances['bass'].setValue(bass);
    if (SFX.knobInstances['mid'] && Number.isFinite(mid)) SFX.knobInstances['mid'].setValue(mid);
    if (SFX.knobInstances['treble'] && Number.isFinite(treble)) SFX.knobInstances['treble'].setValue(treble);
    if (SFX.knobInstances['stereoExpander'] && Number.isFinite(stereoExpander)) {
        SFX.knobInstances['stereoExpander'].setValue(stereoExpander);
    }

    // Balance UI
    const balance = Number(settings?.balance);
    const balanceSlider = document.getElementById('balanceSlider');
    const balanceValue = document.getElementById('balanceValue');
    if (balanceSlider && Number.isFinite(balance)) balanceSlider.value = String(balance);
    if (balanceValue && Number.isFinite(balance)) balanceValue.textContent = getBalanceText(balance);

    // Akustik mekan seçici
    const acoustic = document.getElementById('acousticSpace');
    if (acoustic) acoustic.value = String(settings?.acousticSpace || 'off');
}

const EQ32_ACOUSTIC_SPACE_PRESETS = {
    off: { bass: 0, mid: 0, treble: 0, stereoExpander: 100 },
    small: { bass: 1.5, mid: 0.5, treble: -0.5, stereoExpander: 110 },
    medium: { bass: 2.5, mid: 1.0, treble: -1.0, stereoExpander: 120 },
    large: { bass: 3.5, mid: 1.2, treble: -1.8, stereoExpander: 132 },
    hall: { bass: 4.5, mid: 1.8, treble: -2.5, stereoExpander: 145 }
};

function applyAcousticSpacePreset(space, { persist = true } = {}) {
    const key = String(space || 'off');
    const hasPreset = Object.prototype.hasOwnProperty.call(EQ32_ACOUSTIC_SPACE_PRESETS, key);
    const preset = EQ32_ACOUSTIC_SPACE_PRESETS[key] || EQ32_ACOUSTIC_SPACE_PRESETS.off;
    const settings = getSettings('eq32');
    settings.acousticSpace = hasPreset ? key : 'off';
    settings.bass = preset.bass;
    settings.mid = preset.mid;
    settings.treble = preset.treble;
    settings.stereoExpander = preset.stereoExpander;
    saveSettings('eq32', settings);

    // Knobları görsel olarak preset değerine getir
    if (SFX.knobInstances['bass']) SFX.knobInstances['bass'].setValue(settings.bass);
    if (SFX.knobInstances['mid']) SFX.knobInstances['mid'].setValue(settings.mid);
    if (SFX.knobInstances['treble']) SFX.knobInstances['treble'].setValue(settings.treble);
    if (SFX.knobInstances['stereoExpander']) SFX.knobInstances['stereoExpander'].setValue(settings.stereoExpander);

    // DSP tarafına tek seferde uygula
    applyEffect('eq32');

    if (persist) {
        schedulePersistEq32ToAppSettings(settings);
    }
}

function schedulePersistEq32ToAppSettings(eq32Settings) {
    if (!window.aurivo?.loadSettings || !window.aurivo?.saveSettings) return;

    // Sürekli slider hareketinde dosya yazımını boğmamak için debounce
    if (SFX.eq32PersistTimer) clearTimeout(SFX.eq32PersistTimer);
    SFX.eq32PersistTimer = setTimeout(async () => {
        if (SFX.eq32PersistInFlight) return;
        SFX.eq32PersistInFlight = true;
        try {
            await persistEq32ToAppSettings(eq32Settings);
        } catch {
            // ignore
        } finally {
            SFX.eq32PersistInFlight = false;
        }
    }, 250);
}

// ============================================
// INITIALIZATION
// ============================================
document.addEventListener('DOMContentLoaded', () => {
    (async () => {
        try {
            // Uyarı: Native audio engine mevcut değilse ses efektleri çalışmayacak
            const isNativeAudioAvailable = window.aurivo?.audio?.isNativeAvailable?.();
            if (!isNativeAudioAvailable) {
                const warningDiv = document.createElement('div');
                warningDiv.style.cssText = `
                    position: fixed;
                    top: 10px;
                    left: 50%;
                    transform: translateX(-50%);
                    background: #ff6b6b;
                    color: white;
                    padding: 12px 20px;
                    border-radius: 4px;
                    font-size: 14px;
                    z-index: 10000;
                    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
                `;
                warningDiv.textContent = tSync('sfx.nativeUnavailable');
                document.body.appendChild(warningDiv);
                setTimeout(() => warningDiv.remove(), 8000);
                console.warn('[SFX] Native audio unavailable - sound effects disabled');
            }
            
            if (window.i18n?.init) {
                await window.i18n.init();
                await syncEmbeddedLanguageFromParent();
                try {
                    document.title = await window.i18n.t('sfx.windowTitle');
                } catch {
                    // ignore
                }
            }
        } catch {
            // ignore
        }

        await applySfxLightsFromAppSettings();
        initEffects();
        setupEventListeners();
        setupEQPresetListener();
        loadAllSettings();

        // Uygulama ayarlarından EQ32'yi geri yükle (varsa) ve DSP'ye uygula
        await hydrateEq32FromAppSettings();
        syncStartupEffectsState();

        // İlk efekti göster (paneli lazy-load eder)
        showEffect('eq32');
        updateEqPresetButtonLabel();
    })().catch((e) => {
        console.warn('[SFX INIT] Başlatma hatası (devam ediliyor):', e?.message || e);
        updateEqPresetButtonLabel();
        showEffect('eq32');
    });
});

let eqPresetListenerAttached = false;

function setupEQPresetListener() {
    if (eqPresetListenerAttached) return;
    eqPresetListenerAttached = true;

    if (!window.aurivo?.audio?.on) return;

    window.aurivo.audio.on('eqPresetSelected', (payload) => {
        try {
            applyEQPresetPayload(payload);
        } catch (e) {
            console.warn('[EQ PRESET] Uygulama hatası:', e?.message || e);
        }
    });
}

function initEffects() {
    console.log('🎛️ Ses Efektleri penceresi başlatılıyor...');

    // Tüm efekt panellerini başlangıçta oluştur (DOM'da kalıcı olacak)
    createAllEffectPanels();
}

function setupEventListeners() {
    // Sidebar efekt seçimi
    document.querySelectorAll('.effect-item').forEach(item => {
        item.addEventListener('click', () => {
            const effectName = item.dataset.effect;
            showEffect(effectName);
        });
    });

    // Master toggle
    const masterToggle = document.getElementById('masterEffectsToggle');
    if (masterToggle) {
        masterToggle.addEventListener('change', (e) => {
            SFX.masterEnabled = e.target.checked;
            updateDSPStatus();
            // Ana uygulamaya bildir
            if (window.aurivo?.audio) {
                window.aurivo?.audio.setEffectsEnabled(SFX.masterEnabled);
            }
        });
    }

    // Header tabs
    document.getElementById('tabEffects')?.addEventListener('click', () => {
        document.getElementById('tabEffects').classList.add('active');
        document.getElementById('tabPresets').classList.remove('active');
        document.getElementById('effectsSidebar').style.display = 'block';
        if (SFX_ANIM_SAFE_MODE) pauseAllEffectAnimations();
        else if (SFX_RUNTIME_ANIMS_ACTIVE) setEffectAnimationsActive(SFX.currentEffect, true);
    });

    document.getElementById('tabPresets')?.addEventListener('click', () => {
        document.getElementById('tabPresets').classList.add('active');
        document.getElementById('tabEffects').classList.remove('active');
        pauseAllEffectAnimations();
        // TODO: Ön ayarlar panelini göster
    });

    document.addEventListener('visibilitychange', () => {
        setRuntimeAnimationsActive(!document.hidden);
    });

    window.addEventListener('focus', () => {
        if (!document.hidden) {
            setRuntimeAnimationsActive(true);
        }
        applySfxLightsFromAppSettings().catch(() => { });
    });
    window.addEventListener('storage', (e) => {
        if (e.key !== 'aurivo_ui_sfx_lights_enabled') return;
        const enabled = e.newValue !== '0';
        document.documentElement.dataset.sfxLights = enabled ? 'on' : 'off';
    });
    window.aurivo?.onSettingsReload?.((nextSettings) => {
        const enabled = normalizeSfxLightsEnabled(
            nextSettings?.appearance?.sfxLights ?? nextSettings?.ui?.sfxLightsEnabled
        );
        document.documentElement.dataset.sfxLights = enabled ? 'on' : 'off';
    });

    window.addEventListener('message', (e) => {
        const t = String(e?.data?.type || '');
        if (t === 'sfx:animControl') {
            const action = String(e?.data?.action || '');
            if (action === 'pause') setRuntimeAnimationsActive(false);
            if (action === 'resume') setRuntimeAnimationsActive(!document.hidden);
            return;
        }
        if (t === 'sfx:setLanguage') {
            const lang = String(e?.data?.lang || '').trim();
            if (!lang) return;
            Promise.resolve().then(async () => {
                await applyEmbeddedLanguage(lang);
            });
        }
    });

    // Window controls (frameless pencere için)
    document.getElementById('closeBtn')?.addEventListener('click', () => {
        if (SFX_EMBEDDED_MODE) {
            try { window.parent?.postMessage({ type: 'sfx:closeEmbedded' }, '*'); } catch { }
            return;
        }
        if (window.aurivo?.electronAPI) {
            window.aurivo.electronAPI.closeWindow();
        } else {
            window.close();
        }
    });

    document.getElementById('minimizeBtn')?.addEventListener('click', () => {
        if (SFX_EMBEDDED_MODE) return;
        if (window.aurivo?.electronAPI) {
            window.aurivo.electronAPI.minimizeWindow();
        }
    });

    document.getElementById('maximizeBtn')?.addEventListener('click', async () => {
        if (SFX_EMBEDDED_MODE) return;
        if (window.aurivo?.electronAPI) {
            const isMaximized = await window.aurivo.electronAPI.maximizeWindow();
            const btn = document.getElementById('maximizeBtn');
            if (btn) {
                btn.textContent = isMaximized ? '❐' : '☐';
                btn.title = isMaximized ? tSync('sfx.window.restore') : tSync('sfx.window.maximizeOnly');
            }
        }
    });
}

function refreshLocalizedRuntimeUi() {
    try {
        const title = tSync('sfx.windowTitle');
        if (title && title !== 'sfx.windowTitle') document.title = title;
    } catch {
        // ignore
    }

    // data-i18n alanlarını güncelle
    try {
        window.i18n?.translatePage?.();
    } catch {
        // ignore
    }

    const currentEffect = SFX.currentEffect || 'eq32';
    try {
        unloadEffectPanel(currentEffect);
    } catch {
        // ignore
    }
    showEffect(currentEffect);
    updateEqPresetButtonLabel();
    updateDSPStatus();
}

// ============================================
// EFFECT SWITCHING
// ============================================

function setEffectAnimationsActive(effectName, active) {
    if (!effectName) return;

    // Generic knobs (effectName_*) + eq32 direct knobs (bass/mid/treble/stereoExpander)
    Object.entries(SFX.knobInstances).forEach(([key, inst]) => {
        const isEq32Direct = effectName === 'eq32' && ['bass', 'mid', 'treble', 'stereoExpander'].includes(key);
        if (key.startsWith(`${effectName}_`) || isEq32Direct) {
            if (inst && typeof inst.setActive === 'function') inst.setActive(active);
            else if (inst && typeof inst.stopAnimation === 'function' && !active) inst.stopAnimation();
            else if (inst && typeof inst.startAnimation === 'function' && active) inst.startAnimation();
        }
    });

    if (effectName === 'eq32') {
        (SFX.eqSliders || []).forEach((slider) => {
            if (slider && typeof slider.setActive === 'function') slider.setActive(active);
            else if (slider && typeof slider.stopAnimation === 'function' && !active) slider.stopAnimation();
            else if (slider && typeof slider.startAnimation === 'function' && active) slider.startAnimation();
        });
    }
}

function pauseAllEffectAnimations() {
    Object.values(SFX.knobInstances).forEach((inst) => {
        if (inst && typeof inst.setActive === 'function') inst.setActive(false);
        else if (inst && typeof inst.stopAnimation === 'function') inst.stopAnimation();
    });
    (SFX.eqSliders || []).forEach((slider) => {
        if (slider && typeof slider.setActive === 'function') slider.setActive(false);
        else if (slider && typeof slider.stopAnimation === 'function') slider.stopAnimation();
    });
}

// Tüm efekt panellerini başlangıçta oluştur - DOM'da kalıcı olacaklar
function createAllEffectPanels() {
    const contentArea = document.getElementById('effectContent');
    if (!contentArea) return;

    const effectNames = [
        'eq32', 'reverb', 'compressor', 'limiter', 'bassboost',
        'noisegate', 'deesser', 'exciter', 'stereowidener',
        'echo', 'softecho', 'convreverb', 'peq', 'autogain', 'truepeak', 'crossfeed', 'surround', 'bassmono', 'dynamiceq', 'tapesat', 'bitdither'
    ];

    // Başlangıçta SADECE wrapper'ları oluştur (içerik lazy-load)
    let allPanelsHTML = '';
    effectNames.forEach(name => {
        allPanelsHTML += `<div class="effect-panel-wrapper" data-effect="${name}" data-rendered="false" style="display: none;"></div>`;
    });

    contentArea.innerHTML = allPanelsHTML;
    console.log('✓ Efekt wrapper\'ları oluşturuldu (lazy-load)');
}

function ensureEffectPanelRendered(effectName) {
    const wrapper = document.querySelector(`.effect-panel-wrapper[data-effect="${effectName}"]`);
    if (!wrapper) return;
    if (wrapper.dataset.rendered === 'true') return;

    const template = getEffectTemplate(effectName);
    wrapper.innerHTML = template;
    wrapper.dataset.rendered = 'true';

    initEffectControls(effectName);
}

function unloadEffectPanel(effectName) {
    const wrapper = document.querySelector(`.effect-panel-wrapper[data-effect="${effectName}"]`);
    if (!wrapper) return;
    if (wrapper.dataset.rendered !== 'true') return;

    // UI-only timer/loop cleanup
    if (effectName === 'truepeak') stopTruePeakMeter();
    if (effectName === 'compressor') stopCompressorMeter();
    if (effectName === 'limiter') stopLimiterMeter();
    if (effectName === 'autogain') stopAutoGainMeter();

    if (effectName === 'crossfeed') {
        if (SFX.crossfeedStatusInterval) {
            clearInterval(SFX.crossfeedStatusInterval);
            SFX.crossfeedStatusInterval = null;
        }
        if (SFX.crossfeedDeviceInterval) {
            clearInterval(SFX.crossfeedDeviceInterval);
            SFX.crossfeedDeviceInterval = null;
        }
    }
    if (effectName === 'surround') {
        if (SFX.surroundStatusInterval) {
            clearInterval(SFX.surroundStatusInterval);
            SFX.surroundStatusInterval = null;
        }
    }

    // Instance referanslarını bırak
    if (effectName === 'eq32') {
        stopEqTopVisualizer();
        SFX.eqSliders.forEach((slider) => {
            if (slider && typeof slider.destroy === 'function') slider.destroy();
            else if (slider && typeof slider.stopAnimation === 'function') slider.stopAnimation();
        });
        SFX.eqSliders = [];

        SFX.barAnalyzer = null;

        ['bass', 'mid', 'treble', 'stereoExpander'].forEach((k) => {
            const inst = SFX.knobInstances[k];
            if (inst && typeof inst.destroy === 'function') inst.destroy();
            else if (inst && typeof inst.stopAnimation === 'function') inst.stopAnimation();
            delete SFX.knobInstances[k];
        });

        // eq32 yeniden açılınca kontroller tekrar init edilsin
        eq32ControlsInitialized = false;
    }

    // Generic knobs: effectName_ ile başlayanları sil
    Object.keys(SFX.knobInstances).forEach(k => {
        if (k.startsWith(`${effectName}_`)) {
            const inst = SFX.knobInstances[k];
            if (inst && typeof inst.destroy === 'function') inst.destroy();
            else if (inst && typeof inst.stopAnimation === 'function') inst.stopAnimation();
            delete SFX.knobInstances[k];
        }
    });

    wrapper.innerHTML = '';
    wrapper.dataset.rendered = 'false';
}

function showEffect(effectName) {
    const prevEffect = SFX.currentEffect;

    // Panel içeriklerini ilk ihtiyaçta oluştur
    ensureEffectPanelRendered(effectName);

    // Sidebar aktif durumu güncelle
    document.querySelectorAll('.effect-item').forEach(item => {
        item.classList.toggle('active', item.dataset.effect === effectName);
    });

    // Tüm panelleri gizle, sadece seçileni göster
    document.querySelectorAll('.effect-panel-wrapper').forEach(wrapper => {
        const isActive = wrapper.dataset.effect === effectName;
        wrapper.style.display = isActive ? 'block' : 'none';

        if (isActive) {
            // Fade animasyonu için
            wrapper.classList.add('panel-active');
        } else {
            wrapper.classList.remove('panel-active');
        }
    });

    // Aktif efekti önce güncelle ki loop senkronu doğru efekte göre çalışsın.
    SFX.currentEffect = effectName;

    // Meter loop'ları yalnızca aktif efekt + aktif pencere durumunda çalıştır
    syncMeterLoops();

    if (effectName === 'eq32' && SFX.barAnalyzer) {
        requestAnimationFrame(() => {
            try {
                SFX.barAnalyzer.resize();
                resetEqTopVisualizerState();
                startEqTopVisualizer();
            } catch {
                // ignore
            }
        });
    }

    // PEQ filter type event listeners
    if (effectName === 'peq') {
        setupPEQFilterTypeListeners();
    }

    // Yalnız aktif efektin ışık/animasyon döngüsü çalışsın
    pauseAllEffectAnimations();
    if (!SFX_ANIM_SAFE_MODE && SFX_RUNTIME_ANIMS_ACTIVE) {
        setEffectAnimationsActive(effectName, true);
    }

    // RAM öncelikli: önceki paneli boşalt
    if (RAM_PRIORITY_MODE && prevEffect && prevEffect !== effectName) {
        unloadEffectPanel(prevEffect);
    }
}

// PEQ Filter Type Event Listeners
function setupPEQFilterTypeListeners() {
    const ipcAudio = window.aurivo?.ipcAudio;

    for (let i = 0; i < 6; i++) {
        const select = document.getElementById(`peqBand${i}Type`);
        if (select && !select.dataset.listenerAttached) {
            select.dataset.listenerAttached = 'true';

            select.addEventListener('change', async (e) => {
                const bandIndex = parseInt(e.target.dataset.band);
                const filterType = parseInt(e.target.value);

                // Settings güncelle
                const settings = getSettings('peq');
                if (settings.bands && settings.bands[bandIndex]) {
                    settings.bands[bandIndex].filterType = filterType;
                    saveSettings('peq', settings);
                }

                // Native modüle gönder
                if (ipcAudio?.peq?.setFilterType) {
                    const result = await ipcAudio.peq.setFilterType(bandIndex, filterType);
                    console.log(`[PEQ] Band ${bandIndex + 1} Filter Type: ${filterType}`, result);
                }
            });
        }
    }
}

// ============================================
// METERING LOOPS
// ============================================
let truePeakTimer = null;
// True Peak Meter için smooth animasyon değişkenleri
let truePeakAnimFrame = null;
let truePeakCurrentL = 0;
let truePeakCurrentR = 0;
let truePeakTargetL = 0;
let truePeakTargetR = 0;
let truePeakHoldCurrentL = 0;
let truePeakHoldCurrentR = 0;
let truePeakHoldTargetL = 0;
let truePeakHoldTargetR = 0;
let lastMeterData = null;

function startTruePeakMeter() {
    stopTruePeakMeter();

    // Veri çekme - daha seyrek ama non-blocking
    const fetchMeterData = async () => {
        if (!window.aurivo?.ipcAudio?.truePeakLimiter) return;

        try {
            const meter = await window.aurivo.ipcAudio.truePeakLimiter.getMeter();
            if (meter) {
                lastMeterData = meter;

                // Hedef değerleri güncelle
                truePeakTargetL = Math.max(0, Math.min(100, ((meter.truePeakL + 60) / 60) * 100));
                truePeakTargetR = Math.max(0, Math.min(100, ((meter.truePeakR + 60) / 60) * 100));
                truePeakHoldTargetL = Math.max(0, Math.min(100, ((meter.holdL + 60) / 60) * 100));
                truePeakHoldTargetR = Math.max(0, Math.min(100, ((meter.holdR + 60) / 60) * 100));
            }
        } catch (e) {
            // Sessizce geç
        }
    };

    // Veri çekmeyi başlat
    truePeakTimer = setInterval(fetchMeterData, 30);  // 30ms veri çekme
    fetchMeterData();  // İlk veriyi hemen al

    // Smooth animasyon için requestAnimationFrame loop'u
    function animateTruePeakMeters() {
        const meterL = document.getElementById('truePeakMeterL');
        const meterR = document.getElementById('truePeakMeterR');
        const holdL = document.getElementById('truePeakHoldL');
        const holdR = document.getElementById('truePeakHoldR');

        // Çubuklar için hızlı interpolation
        const barSmoothUp = 0.7;    // Yukarı çıkarken çok hızlı
        const barSmoothDown = 0.15; // Aşağı inerken yavaş (VU meter etkisi)

        // Hold çizgileri için smooth factor
        const holdSmooth = 0.5;

        // Left bar
        if (truePeakTargetL > truePeakCurrentL) {
            truePeakCurrentL += (truePeakTargetL - truePeakCurrentL) * barSmoothUp;
        } else {
            truePeakCurrentL += (truePeakTargetL - truePeakCurrentL) * barSmoothDown;
        }

        // Right bar
        if (truePeakTargetR > truePeakCurrentR) {
            truePeakCurrentR += (truePeakTargetR - truePeakCurrentR) * barSmoothUp;
        } else {
            truePeakCurrentR += (truePeakTargetR - truePeakCurrentR) * barSmoothDown;
        }

        // Hold lines (smooth)
        truePeakHoldCurrentL += (truePeakHoldTargetL - truePeakHoldCurrentL) * holdSmooth;
        truePeakHoldCurrentR += (truePeakHoldTargetR - truePeakHoldCurrentR) * holdSmooth;

        // DOM güncelle
        if (meterL) meterL.style.width = `${truePeakCurrentL}%`;
        if (meterR) meterR.style.width = `${truePeakCurrentR}%`;
        if (holdL) holdL.style.left = `${truePeakHoldCurrentL}%`;
        if (holdR) holdR.style.left = `${truePeakHoldCurrentR}%`;

        // Değer etiketlerini güncelle (her frame değil, veri varsa)
        if (lastMeterData) {
            const settings = getSettings('truepeak');
            const ceiling = settings.ceiling || -0.1;

            const valueL = document.getElementById('truePeakValueL');
            const valueR = document.getElementById('truePeakValueR');

            if (valueL) {
                valueL.textContent = `${lastMeterData.truePeakL.toFixed(1)} dBTP`;
                valueL.style.color = lastMeterData.truePeakL > ceiling - 0.5 ? '#f44336' :
                    lastMeterData.truePeakL > ceiling - 3 ? '#ffeb3b' : '#00d4ff';
            }

            if (valueR) {
                valueR.textContent = `${lastMeterData.truePeakR.toFixed(1)} dBTP`;
                valueR.style.color = lastMeterData.truePeakR > ceiling - 0.5 ? '#f44336' :
                    lastMeterData.truePeakR > ceiling - 3 ? '#ffeb3b' : '#00d4ff';
            }

            // Clipping Counter
            const clipCount = document.getElementById('truepeakClipCount');
            if (clipCount) clipCount.textContent = lastMeterData.clippingCount;

            // Gain Reduction göstergesi
            const grDisplay = document.getElementById('truepeakGainReduction');
            const rawGr = Number(lastMeterData.gainReduction) || 0;
            const gr = Math.abs(rawGr) < 0.05 ? 0 : rawGr; // -0.0 görüntüsünü engelle
            if (grDisplay) {
                grDisplay.textContent = `${gr.toFixed(1)} dB`;
                // GR varsa renk değiştir
                if (gr < -3) {
                    grDisplay.style.color = '#f44336';  // Kırmızı - yoğun limiting
                } else if (gr < -1) {
                    grDisplay.style.color = '#ff9800';  // Turuncu - orta limiting
                } else if (gr < 0) {
                    grDisplay.style.color = '#00bcd4';  // Mavi - hafif limiting
                } else {
                    grDisplay.style.color = '#4caf50';  // Yeşil - limiting yok
                }
            }

            const activityInfo = document.getElementById('truepeakActivityInfo');
            if (activityInfo) {
                const enabled = !!settings.enabled;
                const clip = Number(lastMeterData.clippingCount) || 0;
                if (!enabled) {
                    activityInfo.textContent = 'Limiter kapalı: Clipping ve GR değerinin 0 görünmesi normal.';
                    activityInfo.style.color = '#9aa3b2';
                } else if (clip === 0 && gr === 0) {
                    activityInfo.textContent = 'Limiter açık: Sinyal ceiling seviyesini aşmıyor, bu yüzden GR 0.0 dB.';
                    activityInfo.style.color = '#9aa3b2';
                } else {
                    activityInfo.textContent = `Limiter aktif: Clipping ${clip}, anlık GR ${gr.toFixed(1)} dB.`;
                    activityInfo.style.color = '#00d4ff';
                }
            }
        }

        truePeakAnimFrame = requestAnimationFrame(animateTruePeakMeters);
    }

    truePeakAnimFrame = requestAnimationFrame(animateTruePeakMeters);
}

function stopTruePeakMeter() {
    if (truePeakTimer) {
        clearInterval(truePeakTimer);
        truePeakTimer = null;
    }

    if (truePeakAnimFrame) {
        cancelAnimationFrame(truePeakAnimFrame);
        truePeakAnimFrame = null;
    }

    // Reset values
    truePeakCurrentL = 0;
    truePeakCurrentR = 0;
    truePeakTargetL = 0;
    truePeakTargetR = 0;
    truePeakHoldCurrentL = 0;
    truePeakHoldCurrentR = 0;
    truePeakHoldTargetL = 0;
    truePeakHoldTargetR = 0;
    lastMeterData = null;

    // Reset meter displays
    const meterL = document.getElementById('truePeakMeterL');
    const meterR = document.getElementById('truePeakMeterR');
    if (meterL) meterL.style.width = '0%';
    if (meterR) meterR.style.width = '0%';
}

let compressorTimer = null;
function startCompressorMeter() {
    stopCompressorMeter();
    const meterFill = document.getElementById('compressorMeter');
    if (!meterFill) return;

    compressorTimer = setInterval(async () => {
        if (!window.aurivo?.ipcAudio?.compressor?.getGainReduction) return;
        const reduction = await window.aurivo.ipcAudio.compressor.getGainReduction();
        const reductionAbs = Math.min(Math.abs(reduction || 0), 24);
        const percent = (reductionAbs / 24) * 100;

        meterFill.style.width = `${percent}%`;

        if (reductionAbs < 6) {
            meterFill.style.backgroundColor = '#4caf50';
        } else if (reductionAbs < 12) {
            meterFill.style.backgroundColor = '#ffeb3b';
        } else {
            meterFill.style.backgroundColor = '#f44336';
        }
    }, 100);
}

function stopCompressorMeter() {
    if (compressorTimer) {
        clearInterval(compressorTimer);
        compressorTimer = null;
    }
}

// Limiter Meter
let limiterTimer = null;
function startLimiterMeter() {
    stopLimiterMeter();
    const meterFill = document.getElementById('limiterMeter');
    if (!meterFill) return;

    limiterTimer = setInterval(async () => {
        if (!window.aurivo?.ipcAudio?.limiter?.getReduction) return;
        const reduction = await window.aurivo.ipcAudio.limiter.getReduction();
        const reductionAbs = Math.min(Math.abs(reduction || 0), 20);
        const percent = (reductionAbs / 20) * 100;

        meterFill.style.width = `${percent}%`;

        if (reductionAbs < 3) {
            meterFill.style.backgroundColor = '#4caf50';
        } else if (reductionAbs < 10) {
            meterFill.style.backgroundColor = '#ffeb3b';
        } else {
            meterFill.style.backgroundColor = '#f44336';
        }
    }, 50);
}

function stopLimiterMeter() {
    if (limiterTimer) {
        clearInterval(limiterTimer);
        limiterTimer = null;
    }
}

let autoGainTimer = null;
function startAutoGainMeter() {
    stopAutoGainMeter();
    // Eğer autogain UI'da bir meter varsa burada güncelle
}

function stopAutoGainMeter() {
    if (autoGainTimer) {
        clearInterval(autoGainTimer);
        autoGainTimer = null;
    }
}

// ============================================
// EFFECT TEMPLATES
// ============================================
function getEffectTemplate(effectName) {
    const templates = {
        eq32: getEQ32Template(),
        reverb: getReverbTemplate(),
        compressor: getCompressorTemplate(),
        limiter: getLimiterTemplate(),
        bassboost: getBassBoostTemplate(),
        noisegate: getNoiseGateTemplate(),
        deesser: getDeesserTemplate(),
        exciter: getExciterTemplate(),
        stereowidener: getStereoWidenerTemplate(),
        echo: getEchoTemplate(),
        softecho: getSoftEchoTemplate(),
        convreverb: getConvReverbTemplate(),
        peq: getPEQTemplate(),
        autogain: getAutoGainTemplate(),
        truepeak: getTruePeakTemplate(),
        autogain: getAutoGainTemplate(),
        truepeak: getTruePeakTemplate(),
        crossfeed: getCrossfeedTemplate(),
        surround: getSurroundTemplate(),
        bassmono: getBassMonoTemplate(),
        dynamiceq: getDynamicEQTemplate(),
        tapesat: getTapeSatTemplate(),
        bitdither: getBitDitherTemplate()
    };

    return templates[effectName] || `<div class="effect-panel"><p>${tSync('sfx.ui.notImplemented')}</p></div>`;
}

// --- 32-Band EQ Template ---
function getEQ32Template() {
    const settings = getSettings('eq32');

    // 32 band slider oluştur
    let bandsHTML = '';
    SFX.eqFrequencies.forEach((freq, i) => {
        const value = settings.bands[i] || 0;
        bandsHTML += `
            <div class="eq-band">
                <span class="eq-band-value" id="eqValue${i}">${value.toFixed(1)}d</span>
                <div class="eq-slider-container">
                    <!-- Canvas for RainbowSlider -->
                    <canvas class="eq-slider-canvas" id="eqSlider${i}" 
                            data-band="${i}" width="26" height="150"
                            title="${freq}"></canvas>
                </div>
                <span class="eq-band-freq">${freq}</span>
            </div>
        `;
    });

	    return `
	        <div class="effect-panel" id="eq32Panel">
	            <div class="effect-header">
	                <div class="effect-title-section">
	                    <h2 class="effect-title">🎚️ ${tSync('sfx.eq32.title')}</h2>
	                    <p class="effect-description">${tSync('sfx.eq32.description')}</p>
	                </div>
	                <div class="effect-actions">
	                    <button class="action-btn primary" id="eqPresetsBtn">${tSync('sfx.ui.presets')}</button>
	                    <button class="action-btn danger" id="eqResetBtn">${tSync('sfx.ui.reset')}</button>
	                </div>
	            </div>
	            
	            <div class="eq-section" style="position: relative; padding-top: 10px;">
                <!-- Top visualizer -->
                <div class="eq-top-visualizer">
                    <canvas id="barAnalyzerCanvas" class="eq-top-visualizer-canvas"></canvas>
                </div>

                <div class="eq-bands-wrapper" id="eqBandsWrapper" style="position: relative; z-index: 1;">
                    ${bandsHTML}
                </div>
            </div>
	            
	            <div class="aurivo-module">
	                <div class="module-panel knobs-panel">
	                    <div class="module-title">${tSync('sfx.eq32.moduleTitle')}</div>
	                    <div class="knobs-container" id="aurivoKnobs">
	                        <div class="knob-wrapper">
	                            <canvas class="aurivo-knob-canvas" id="knobBassCanvas" width="130" height="170"></canvas>
	                        </div>

                        <div class="knob-wrapper">
                            <canvas class="aurivo-knob-canvas" id="knobMidCanvas" width="130" height="170"></canvas>
                        </div>

                        <div class="knob-wrapper">
                            <canvas class="aurivo-knob-canvas" id="knobTrebleCanvas" width="130" height="170"></canvas>
                        </div>

                        <div class="knob-wrapper">
                            <canvas class="aurivo-knob-canvas" id="knobStereoCanvas" width="130" height="170"></canvas>
                        </div>
	                    </div>
	                    <div class="module-dropdown">
	                        <label>${tSync('sfx.eq32.acousticSpace.label')}</label>
	                        <select id="acousticSpace">
	                            <option value="off" ${settings.acousticSpace === 'off' ? 'selected' : ''}>${tSync('sfx.eq32.acousticSpace.off')}</option>
	                            <option value="small" ${settings.acousticSpace === 'small' ? 'selected' : ''}>${tSync('sfx.eq32.acousticSpace.small')}</option>
	                            <option value="medium" ${settings.acousticSpace === 'medium' ? 'selected' : ''}>${tSync('sfx.eq32.acousticSpace.medium')}</option>
	                            <option value="large" ${settings.acousticSpace === 'large' ? 'selected' : ''}>${tSync('sfx.eq32.acousticSpace.large')}</option>
	                            <option value="hall" ${settings.acousticSpace === 'hall' ? 'selected' : ''}>${tSync('sfx.eq32.acousticSpace.hall')}</option>
	                        </select>
	                    </div>
	                    <button class="action-btn secondary module-reset-btn" id="moduleResetBtn">${tSync('sfx.ui.resetModule')}</button>
	                </div>
	                
	                <div class="module-panel balance-panel">
	                    <div class="module-title">${tSync('sfx.balance.title')}</div>
	                    <div class="balance-container">
	                        <input type="range" class="balance-slider" id="balanceSlider" 
	                               min="-100" max="100" value="${settings.balance}">
	                        <span class="balance-value" id="balanceValue">${getBalanceText(settings.balance)}</span>
                    </div>
                </div>
            </div>
        </div>
    `;
}

// --- Reverb Template ---
function getReverbTemplate() {
    const settings = getSettings('reverb');

    return `
        <div class="effect-panel" id="reverbPanel">
            <div class="effect-header">
                <div class="effect-title-section">
                    <h2 class="effect-title">🎵 Reverb (BASS FX)</h2>
                    <p class="effect-description">${tSync('sfx.reverb.description')}</p>
                </div>
                <div class="effect-actions">
                    <label class="enable-toggle">
                        <input type="checkbox" id="reverbEnabled" ${settings.enabled ? 'checked' : ''}>
                        <span class="toggle-slider"></span>
                        <span class="enable-label">${tSync('sfx.ui.enable')}</span>
                    </label>
                </div>
            </div>
            
            <div class="knobs-container">
                <div class="knob-wrapper">
                    <canvas class="aurivo-knob-canvas" id="knobRoomSizeCanvas" 
                        width="130" height="170"
                        data-param="roomSize" 
                        data-label="Room Size" 
                        data-min="0" data-max="3000" 
                        data-value="${settings.roomSize}" 
                        data-unit=" ms"></canvas>
                </div>
                
                <div class="knob-wrapper">
                    <canvas class="aurivo-knob-canvas" id="knobDampingCanvas" 
                        width="130" height="170"
                        data-param="damping" 
                        data-label="Damping"
                        data-min="0" data-max="1" 
                        data-step="0.001" 
                        data-value="${settings.damping}" 
                        data-unit=""></canvas>
                </div>
                
                <div class="knob-wrapper">
                    <canvas class="aurivo-knob-canvas" id="knobWetDryCanvas" 
                        width="130" height="170"
                        data-param="wetDry" 
                        data-label="Wet/Dry Mix"
                        data-min="-96" data-max="0" 
                        data-value="${settings.wetDry}" 
                        data-unit=" dB"></canvas>
                </div>
                
                <div class="knob-wrapper">
                    <canvas class="aurivo-knob-canvas" id="knobHFRatioCanvas" 
                        width="130" height="170"
                        data-param="hfRatio" 
                        data-label="HF Ratio"
                        data-min="0.001" data-max="0.999" 
                        data-step="0.001" 
                        data-value="${settings.hfRatio}" 
                        data-unit=""></canvas>
                </div>
                
                <div class="knob-wrapper">
                    <canvas class="aurivo-knob-canvas" id="knobInputGainCanvas" 
                        width="130" height="170"
                        data-param="inputGain" 
                        data-label="Input Gain"
                        data-min="-96" data-max="12" 
                        data-value="${settings.inputGain}" 
                        data-unit=" dB"></canvas>
                </div>
            </div>
            
            <div class="presets-section">
                <div class="presets-title">📁 ${tSync('sfx.ui.presets')}</div>
                <div class="presets-buttons">
                    ${renderModernPresetButton({ panelId: 'reverbPanel', preset: 'smallRoom', label: tSync('sfx.reverb.presets.smallRoom'), icon: 'room', active: settings.lastPreset === 'smallRoom' })}
                    ${renderModernPresetButton({ panelId: 'reverbPanel', preset: 'largeRoom', label: tSync('sfx.reverb.presets.largeRoom'), icon: 'building', active: settings.lastPreset === 'largeRoom' })}
                    ${renderModernPresetButton({ panelId: 'reverbPanel', preset: 'concertHall', label: tSync('sfx.reverb.presets.concertHall'), icon: 'hall', active: settings.lastPreset === 'concertHall' })}
                    ${renderModernPresetButton({ panelId: 'reverbPanel', preset: 'cathedral', label: tSync('sfx.reverb.presets.cathedral'), icon: 'church', active: settings.lastPreset === 'cathedral' })}
                    ${renderModernPresetButton({ panelId: 'reverbPanel', preset: 'studioPlate', label: tOr('sfx.reverb.presets.studioPlate', 'Studio Plate'), icon: 'plate', active: settings.lastPreset === 'studioPlate' })}
                    ${renderModernPresetButton({ panelId: 'reverbPanel', preset: 'arena', label: tOr('sfx.reverb.presets.arena', 'Arena'), icon: 'hall', active: settings.lastPreset === 'arena' })}
                    ${renderModernPresetButton({ panelId: 'reverbPanel', preset: 'vocalRoom', label: tOr('sfx.reverb.presets.vocalRoom', 'Vocal Room'), icon: 'vocal', active: settings.lastPreset === 'vocalRoom' })}
                    ${renderModernPresetButton({ panelId: 'reverbPanel', preset: 'ambientWash', label: tOr('sfx.reverb.presets.ambientWash', 'Ambient Wash'), icon: 'air', active: settings.lastPreset === 'ambientWash' })}
                    ${renderModernPresetButton({ panelId: 'reverbPanel', preset: 'slapback', label: tOr('sfx.reverb.presets.slapback', 'Slapback'), icon: 'burst', active: settings.lastPreset === 'slapback' })}
                    ${renderModernPresetButton({ panelId: 'reverbPanel', preset: 'dreamVox', label: tOr('sfx.reverb.presets.dreamVox', 'Dream Vox'), icon: 'sparkle', active: settings.lastPreset === 'dreamVox' })}
                </div>
            </div>
            
            <div style="display: flex; justify-content: flex-end; margin-top: 16px;">
                <button class="action-btn danger" id="reverbResetBtn">${tSync('sfx.ui.reset')}</button>
            </div>
        </div>
    `;
}

// --- Compressor Template ---
function getCompressorTemplate() {
    const settings = getSettings('compressor');

    return `
        <div class="effect-panel" id="compressorPanel">
            <div class="effect-header">
                <div class="effect-title-section">
                    <h2 class="effect-title">🎛️ ${tSync('sfx.compressor.title')}</h2>
                    <p class="effect-description">${tSync('sfx.compressor.description')}</p>
                </div>
                <div class="effect-actions">
                    <label class="enable-toggle">
                        <input type="checkbox" id="compressorEnabled" ${settings.enabled ? 'checked' : ''}>
                        <span class="toggle-slider"></span>
                        <span class="enable-label">${tSync('sfx.ui.enable')}</span>
                    </label>
                </div>
            </div>
            
            <div class="knobs-container">
                <div class="knob-wrapper">
                    <canvas class="aurivo-knob-canvas" id="knobThresholdCanvas" 
                        width="130" height="170"
                        data-param="threshold" 
                        data-label="Threshold (Eşik)"
                        data-min="-60" data-max="0" 
                        data-value="${settings.threshold}" 
                        data-unit=" dB"></canvas>
                </div>
                <div class="knob-wrapper">
                    <canvas class="aurivo-knob-canvas" id="knobRatioCanvas" 
                        width="130" height="170"
                        data-param="ratio" 
                        data-label="Ratio (Oran)"
                        data-min="1" data-max="20" 
                        data-value="${settings.ratio}" 
                        data-unit=":1"></canvas>
                </div>
                <div class="knob-wrapper">
                    <canvas class="aurivo-knob-canvas" id="knobAttackCanvas" 
                        width="130" height="170"
                        data-param="attack" 
                        data-label="Attack (Saldırı)"
                        data-min="0.1" data-max="100" 
                        data-value="${settings.attack}" 
                        data-unit=" ms"></canvas>
                </div>
                <div class="knob-wrapper">
                    <canvas class="aurivo-knob-canvas" id="knobReleaseCanvas" 
                        width="130" height="170"
                        data-param="release" 
                        data-label="Release (Salıverme)"
                        data-min="10" data-max="1000" 
                        data-value="${settings.release}" 
                        data-unit=" ms"></canvas>
                </div>
                <div class="knob-wrapper">
                    <canvas class="aurivo-knob-canvas" id="knobMakeupCanvas" 
                        width="130" height="170"
                        data-param="makeupGain" 
                        data-label="Makeup Gain"
                        data-min="-12" data-max="24" 
                        data-value="${settings.makeupGain}" 
                        data-unit=" dB"></canvas>
                </div>
                <div class="knob-wrapper">
                    <canvas class="aurivo-knob-canvas" id="knobKneeCanvas" 
                        width="130" height="170"
                        data-param="knee" 
                        data-label="Knee (Diz)"
                        data-min="0" data-max="10" 
                        data-value="${settings.knee}" 
                        data-unit=" dB"></canvas>
                </div>
            </div>
            
            <div class="meter-container">
                <div class="meter-label">Gain Reduction</div>
                <div class="meter-bar">
                    <div class="meter-fill" id="compressorMeter" style="width: 0%;"></div>
                </div>
                <div class="meter-markers">
                    <span>0 dB</span>
                    <span>-6 dB</span>
                    <span>-12 dB</span>
                    <span>-18 dB</span>
                    <span>-24 dB</span>
                </div>
            </div>
            
            <div style="display: flex; justify-content: flex-end; margin-top: 16px;">
                <button class="action-btn danger" id="compressorResetBtn">${tSync('sfx.ui.reset')}</button>
            </div>
        </div>
    `;
}

// --- Limiter Template ---
function getLimiterTemplate() {
    const settings = getSettings('limiter');

    return `
        <div class="effect-panel" id="limiterPanel">
            <div class="effect-header">
                <div class="effect-title-section">
                    <h2 class="effect-title">🔒 ${tSync('sfx.effects.limiter')}</h2>
                    <p class="effect-description">${tSync('sfx.descriptions.limiter')}</p>
                </div>
                <div class="effect-actions">
                    <label class="enable-toggle">
                        <input type="checkbox" id="limiterEnabled" ${settings.enabled ? 'checked' : ''}>
                        <span class="toggle-slider"></span>
                        <span class="enable-label">${tSync('sfx.ui.enable')}</span>
                    </label>
                </div>
            </div>
            
            <div class="knobs-container">
                <div class="knob-wrapper">
                    <canvas class="aurivo-knob-canvas" id="knobCeilingCanvas" 
                        width="130" height="170"
                        data-param="ceiling" 
                        data-label="Ceiling (Tavan)"
                        data-min="-12" data-max="0" 
                        data-step="0.1"
                        data-value="${settings.ceiling}" 
                        data-unit=" dB"></canvas>
                </div>
                <div class="knob-wrapper">
                    <canvas class="aurivo-knob-canvas" id="knobLimReleaseCanvas" 
                        width="130" height="170"
                        data-param="release" 
                        data-label="Release"
                        data-min="10" data-max="500" 
                        data-value="${settings.release}" 
                        data-unit=" ms"></canvas>
                </div>
                <div class="knob-wrapper">
                    <canvas class="aurivo-knob-canvas" id="knobLookaheadCanvas" 
                        width="130" height="170"
                        data-param="lookahead" 
                        data-label="Lookahead (Öngörü)"
                        data-min="0" data-max="20" 
                        data-value="${settings.lookahead}" 
                        data-unit=" ms"></canvas>
                </div>
                <div class="knob-wrapper">
                    <canvas class="aurivo-knob-canvas" id="knobLimGainCanvas" 
                        width="130" height="170"
                        data-param="gain" 
                        data-label="Gain (Kazanç)"
                        data-min="-12" data-max="12" 
                        data-value="${settings.gain}" 
                        data-unit=" dB"></canvas>
                </div>
            </div>
            
            <div class="meter-container">
                <div class="meter-label">Limiting Amount</div>
                <div class="meter-bar">
                    <div class="meter-fill" id="limiterMeter" style="width: 0%;"></div>
                </div>
            </div>
            
            <div style="display: flex; justify-content: flex-end; margin-top: 16px;">
                <button class="action-btn danger" id="limiterResetBtn">${tSync('sfx.ui.reset')}</button>
            </div>
        </div>
    `;
}

// --- Bass Boost Template ---
function getBassBoostTemplate() {
    const settings = getSettings('bassboost');

	    return `
	        <div class="effect-panel" id="bassboostPanel">
	            <div class="effect-header">
	                <div class="effect-title-section">
	                    <h2 class="effect-title">🔊 ${tSync('sfx.bassboost.title')}</h2>
	                    <p class="effect-description">${tSync('sfx.bassboost.description')}</p>
	                </div>
	                <div class="effect-actions">
	                    <label class="enable-toggle">
	                        <input type="checkbox" id="bassboostEnabled" ${settings.enabled ? 'checked' : ''}>
	                        <span class="toggle-slider"></span>
	                        <span class="enable-label">${tSync('sfx.ui.enable')}</span>
	                    </label>
	                </div>
	            </div>
            
            <div class="knobs-container">
                <div class="knob-wrapper">
                    <canvas class="aurivo-knob-canvas" id="knobBBFreqCanvas" 
                        width="130" height="170"
                        data-param="frequency" 
                        data-label="Frequency (Frekans)"
                        data-min="20" data-max="200" 
                        data-value="${settings.frequency}" 
                        data-unit=" Hz"></canvas>
                </div>
                <div class="knob-wrapper">
                    <canvas class="aurivo-knob-canvas" id="knobBBGainCanvas" 
                        width="130" height="170"
                        data-param="gain" 
                        data-label="Gain (Kazanç)"
                        data-min="0" data-max="18" 
                        data-value="${settings.gain}" 
                        data-unit=" dB"></canvas>
                </div>
                <div class="knob-wrapper">
                    <canvas class="aurivo-knob-canvas" id="knobHarmonicsCanvas" 
                        width="130" height="170"
                        data-param="harmonics" 
                        data-label="Harmonics"
                        data-min="0" data-max="100" 
                        data-value="${settings.harmonics}" 
                        data-unit="%"></canvas>
                </div>
                <div class="knob-wrapper">
                    <canvas class="aurivo-knob-canvas" id="knobBBWidthCanvas" 
                        width="130" height="170"
                        data-param="width" 
                        data-label="Width (Genişlik)"
                        data-min="0.5" data-max="3" 
                        data-step="0.1"
                        data-value="${settings.width}" 
                        data-unit=""></canvas>
                </div>
                <div class="knob-wrapper">
                    <canvas class="aurivo-knob-canvas" id="knobBBMixCanvas" 
                        width="130" height="170"
                        data-param="mix" 
                        data-label="Dry/Wet Mix"
                        data-min="0" data-max="100" 
                        data-value="${settings.mix}" 
                        data-unit="%"></canvas>
                </div>
            </div>
	            
	            <div style="display: flex; justify-content: flex-end; margin-top: 16px;">
	                <button class="action-btn danger" id="bassboostResetBtn">${tSync('sfx.ui.reset')}</button>
	            </div>
	        </div>
	    `;
}

// --- Noise Gate Template ---
function getNoiseGateTemplate() {
    const settings = getSettings('noisegate');

    return `
        <div class="effect-panel" id="noisegatePanel">
            <div class="effect-header">
                <div class="effect-title-section">
                    <h2 class="effect-title">🎙️ ${tSync('sfx.effects.noisegate')}</h2>
                    <p class="effect-description">${tSync('sfx.descriptions.noisegate')}</p>
                </div>
                <div class="effect-actions">
                    <label class="enable-toggle">
                        <input type="checkbox" id="noisegateEnabled" ${settings.enabled ? 'checked' : ''}>
                        <span class="toggle-slider"></span>
                        <span class="enable-label">${tSync('sfx.ui.enable')}</span>
                    </label>
                </div>
            </div>
            
            <div class="knobs-container">
                <div class="knob-wrapper">
                    <canvas class="aurivo-knob-canvas" id="knobNGThresholdCanvas" 
                        width="130" height="170"
                        data-param="threshold" 
                        data-label="Threshold (Eşik)"
                        data-min="-96" data-max="0" 
                        data-value="${settings.threshold}" 
                        data-unit=" dB"></canvas>
                </div>
                <div class="knob-wrapper">
                    <canvas class="aurivo-knob-canvas" id="knobNGAttackCanvas" 
                        width="130" height="170"
                        data-param="attack" 
                        data-label="Attack (Saldırı)"
                        data-min="0.1" data-max="50" 
                        data-value="${settings.attack}" 
                        data-unit=" ms"></canvas>
                </div>
                <div class="knob-wrapper">
                    <canvas class="aurivo-knob-canvas" id="knobNGHoldCanvas" 
                        width="130" height="170"
                        data-param="hold" 
                        data-label="Hold (Tutma)"
                        data-min="0" data-max="500" 
                        data-value="${settings.hold}" 
                        data-unit=" ms"></canvas>
                </div>
                <div class="knob-wrapper">
                    <canvas class="aurivo-knob-canvas" id="knobNGReleaseCanvas" 
                        width="130" height="170"
                        data-param="release" 
                        data-label="Release (Salıverme)"
                        data-min="10" data-max="2000" 
                        data-value="${settings.release}" 
                        data-unit=" ms"></canvas>
                </div>
                <div class="knob-wrapper">
                    <canvas class="aurivo-knob-canvas" id="knobNGRangeCanvas" 
                        width="130" height="170"
                        data-param="range" 
                        data-label="Range (Aralık)"
                        data-min="-96" data-max="0" 
                        data-value="${settings.range}" 
                        data-unit=" dB"></canvas>
                </div>
            </div>
            
            <div class="led-indicator">
                <div class="led" id="gateStatusLed"></div>
                <span class="led-label">${tSync('sfx.noisegate.gateStatusLabel')} <span id="gateStatusText">${tSync('sfx.off')}</span></span>
            </div>
            
            <div style="display: flex; justify-content: flex-end; margin-top: 16px;">
                <button class="action-btn danger" id="noisegateResetBtn">${tSync('sfx.ui.reset')}</button>
            </div>
        </div>
    `;
}

// --- Diğer Template'ler (basitleştirilmiş) ---
function getDeesserTemplate() {
    return getGenericEffectTemplate('deesser', `🎤 ${tSync('sfx.effects.deesser')}`, tSync('sfx.descriptions.deesser'), [
        { id: 'frequency', label: 'Frequency', min: 2000, max: 12000, unit: 'Hz' },
        { id: 'threshold', label: 'Threshold', min: -60, max: 0, unit: 'dB' },
        { id: 'ratio', label: 'Ratio', min: 1, max: 10, unit: ':1' },
        { id: 'range', label: 'Range', min: -24, max: 0, unit: 'dB' }
    ]);
}

function getExciterTemplate() {
    return getGenericEffectTemplate('exciter', `✨ ${tSync('sfx.effects.exciter')}`, tSync('sfx.descriptions.exciter'), [
        { id: 'frequency', label: 'Frequency', min: 1000, max: 8000, unit: 'Hz' },
        { id: 'amount', label: 'Amount', min: 0, max: 100, unit: '%' },
        { id: 'mix', label: 'Mix', min: 0, max: 100, unit: '%' }
    ]);
}

function getStereoWidenerTemplate() {
    return getGenericEffectTemplate('stereowidener', `🔀 ${tSync('sfx.effects.stereowidener')}`, tSync('sfx.descriptions.stereowidener'), [
        { id: 'width', label: 'Width', min: 0, max: 200, unit: '%' },
        { id: 'centerLevel', label: 'Center Level', min: -12, max: 12, unit: 'dB' },
        { id: 'sideLevel', label: 'Side Level', min: -12, max: 12, unit: 'dB' },
        { id: 'bassToMono', label: 'Bass to Mono', min: 0, max: 500, unit: 'Hz' }
    ]);
}

function getEchoTemplate() {
    return getGenericEffectTemplate('echo', `🔁 ${tSync('sfx.effects.echo')}`, tSync('sfx.descriptions.echo'), [
        { id: 'delay', label: 'Delay', min: 10, max: 1000, unit: 'ms' },
        { id: 'feedback', label: 'Feedback', min: 0, max: 95, unit: '%' },
        { id: 'wetDry', label: 'Wet/Dry', min: 0, max: 100, unit: '%' },
        { id: 'highCut', label: 'High Cut', min: 1000, max: 20000, unit: 'Hz' }
    ]);
}

function getSoftEchoTemplate() {
    const settings = getSettings('softecho');
    const selectedPreset = String(settings.lastPreset || 'natural');
    return `
        <div class="effect-panel" id="softechoPanel">
            <div class="effect-header">
                <div class="effect-title-section">
                    <h2 class="effect-title">🫧 ${tOr('sfx.effects.softecho', 'Soft Echo')}</h2>
                    <p class="effect-description">${tOr('sfx.descriptions.softecho', 'Natural and smooth echo profile without metallic double-voice feel.')}</p>
                </div>
                <div class="effect-actions">
                    <label class="enable-toggle">
                        <input type="checkbox" id="softechoEnabled" ${settings.enabled ? 'checked' : ''}>
                        <span class="toggle-slider"></span>
                        <span class="enable-label">${tSync('sfx.ui.enable')}</span>
                    </label>
                </div>
            </div>

            <div class="knobs-container">
                <div class="knob-wrapper">
                    <canvas class="aurivo-knob-canvas" width="130" height="170"
                        data-param="delay"
                        data-label="Delay"
                        data-min="60" data-max="650"
                        data-step="1"
                        data-value="${settings.delay}"
                        data-unit=" ms"></canvas>
                </div>
                <div class="knob-wrapper">
                    <canvas class="aurivo-knob-canvas" width="130" height="170"
                        data-param="feedback"
                        data-label="Feedback"
                        data-min="5" data-max="45"
                        data-step="1"
                        data-value="${settings.feedback}"
                        data-unit=" %"></canvas>
                </div>
                <div class="knob-wrapper">
                    <canvas class="aurivo-knob-canvas" width="130" height="170"
                        data-param="wetMix"
                        data-label="${tOr('sfx.knob.param.wetMix', 'Wet Mix')}"
                        data-min="5" data-max="40"
                        data-step="1"
                        data-value="${settings.wetMix}"
                        data-unit=" %"></canvas>
                </div>
                <div class="knob-wrapper">
                    <canvas class="aurivo-knob-canvas" width="130" height="170"
                        data-param="highCut"
                        data-label="${tOr('sfx.knob.param.toneHighCut', 'Tone (High Cut)')}"
                        data-min="3000" data-max="12000"
                        data-step="100"
                        data-value="${settings.highCut}"
                        data-unit=" Hz"></canvas>
                </div>
            </div>

            <div class="presets-section">
                <div class="presets-title">🎛️ ${tOr('sfx.softecho.presets.title', 'Soft Echo Presets')}</div>
                <div class="presets-buttons">
                    ${renderModernPresetButton({ panelId: 'softechoPanel', preset: 'natural', label: tOr('sfx.softecho.presets.natural', 'Natural'), icon: 'natural', active: selectedPreset === 'natural', extraClass: 'softecho-preset-btn' })}
                    ${renderModernPresetButton({ panelId: 'softechoPanel', preset: 'velvet', label: tOr('sfx.softecho.presets.velvet', 'Velvet'), icon: 'air', active: selectedPreset === 'velvet', extraClass: 'softecho-preset-btn' })}
                    ${renderModernPresetButton({ panelId: 'softechoPanel', preset: 'tape', label: tOr('sfx.softecho.presets.tape', 'Tape Glow'), icon: 'tape', active: selectedPreset === 'tape', extraClass: 'softecho-preset-btn' })}
                    ${renderModernPresetButton({ panelId: 'softechoPanel', preset: 'vocal', label: tOr('sfx.softecho.presets.vocal', 'Vocal Soft'), icon: 'vocal', active: selectedPreset === 'vocal', extraClass: 'softecho-preset-btn' })}
                    ${renderModernPresetButton({ panelId: 'softechoPanel', preset: 'wide', label: tOr('sfx.softecho.presets.wide', 'Wide Air'), icon: 'wide', active: selectedPreset === 'wide', extraClass: 'softecho-preset-btn' })}
                    ${renderModernPresetButton({ panelId: 'softechoPanel', preset: 'cinema', label: tOr('sfx.softecho.presets.cinema', 'Cinema Tail'), icon: 'hall', active: selectedPreset === 'cinema', extraClass: 'softecho-preset-btn' })}
                </div>
            </div>

            <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 10px;">
                <label style="display:flex; align-items:center; gap:8px; color:#aeb8c5; font-size:13px; cursor:pointer;">
                    <input type="checkbox" id="softechoStereo" ${settings.stereo ? 'checked' : ''} style="width:16px; height:16px;">
                    ${tOr('sfx.softecho.stereoPingPong', 'Stereo (Ping-Pong)')}
                </label>
                <button class="action-btn danger" id="softechoResetBtn">${tSync('sfx.ui.reset')}</button>
            </div>
        </div>
    `;
}

function getConvReverbTemplate() {
    const settings = getSettings('convreverb');
    const currentPreset = String(settings.preset || 'hall');
    return `
        <div class="effect-panel" id="convreverbPanel">
            <div class="effect-header">
                <div class="effect-title-section">
                    <h2 class="effect-title">🎪 ${tSync('sfx.effects.convreverb')}</h2>
                    <p class="effect-description">${tSync('sfx.descriptions.convreverb')}</p>
                </div>
                <div class="effect-actions">
                    <label class="enable-toggle">
                        <input type="checkbox" id="convreverbEnabled" ${settings.enabled ? 'checked' : ''}>
                        <span class="toggle-slider"></span>
                        <span class="enable-label">${tSync('sfx.ui.enable')}</span>
                    </label>
                </div>
            </div>
            
            <div class="presets-section">
                <div class="presets-title">📁 ${tSync('sfx.convreverb.irPresets')}</div>
                <div class="presets-buttons">
                    ${renderModernPresetButton({ panelId: 'convreverbPanel', preset: 'hall', label: tSync('sfx.convreverb.presets.hall'), icon: 'hall', active: currentPreset === 'hall', extraClass: 'ir-preset-btn' })}
                    ${renderModernPresetButton({ panelId: 'convreverbPanel', preset: 'church', label: tSync('sfx.convreverb.presets.church'), icon: 'church', active: currentPreset === 'church', extraClass: 'ir-preset-btn' })}
                    ${renderModernPresetButton({ panelId: 'convreverbPanel', preset: 'room', label: tSync('sfx.convreverb.presets.room'), icon: 'room', active: currentPreset === 'room', extraClass: 'ir-preset-btn' })}
                    ${renderModernPresetButton({ panelId: 'convreverbPanel', preset: 'plate', label: tSync('sfx.convreverb.presets.plate'), icon: 'plate', active: currentPreset === 'plate', extraClass: 'ir-preset-btn' })}
                    ${renderModernPresetButton({ panelId: 'convreverbPanel', preset: 'small', label: tOr('sfx.convreverb.presets.small', 'Small Room'), icon: 'room', active: currentPreset === 'small', extraClass: 'ir-preset-btn' })}
                    ${renderModernPresetButton({ panelId: 'convreverbPanel', preset: 'large', label: tOr('sfx.convreverb.presets.large', 'Large Room'), icon: 'building', active: currentPreset === 'large', extraClass: 'ir-preset-btn' })}
                    ${renderModernPresetButton({ panelId: 'convreverbPanel', preset: 'spring', label: tOr('sfx.convreverb.presets.spring', 'Spring'), icon: 'sparkle', active: currentPreset === 'spring', extraClass: 'ir-preset-btn' })}
                    ${renderModernPresetButton({ panelId: 'convreverbPanel', preset: 'chamber', label: tOr('sfx.convreverb.presets.chamber', 'Chamber'), icon: 'hall', active: currentPreset === 'chamber', extraClass: 'ir-preset-btn' })}
                </div>
            </div>
            
            <div class="knobs-container">
                <div class="knob-wrapper">
                    <canvas class="aurivo-knob-canvas" id="knobConvMixCanvas" 
                        width="130" height="170"
                        data-param="mix" 
                        data-label="Mix"
                        data-min="0" data-max="100" 
                        data-value="${settings.mix}" 
                        data-unit="%"></canvas>
                </div>
                <div class="knob-wrapper">
                    <canvas class="aurivo-knob-canvas" id="knobPredelayCanvas" 
                        width="130" height="170"
                        data-param="predelay" 
                        data-label="Pre-delay"
                        data-min="0" data-max="200" 
                        data-value="${settings.predelay}" 
                        data-unit=" ms"></canvas>
                </div>
            </div>
            
            <div style="display: flex; justify-content: flex-end; margin-top: 16px;">
                <button class="action-btn danger" id="convreverbResetBtn">${tSync('sfx.ui.reset')}</button>
            </div>
        </div>
    `;
}

function getPEQTemplate() {
    const settings = getSettings('peq');
    // Default 6 bands with filter types
    if (!settings.bands || settings.bands.length < 6) {
        settings.bands = [
            { freq: 60, gain: 0, q: 1.0, filterType: 1 },     // Low Shelf
            { freq: 150, gain: 0, q: 1.0, filterType: 0 },    // Bell
            { freq: 400, gain: 0, q: 1.0, filterType: 0 },    // Bell
            { freq: 1500, gain: 0, q: 1.0, filterType: 0 },   // Bell
            { freq: 5000, gain: 0, q: 1.0, filterType: 0 },   // Bell
            { freq: 12000, gain: 0, q: 1.0, filterType: 2 }   // High Shelf
        ];
    }

    const filterTypeOptions = `
        <option value="0">🔔 Bell</option>
        <option value="1">📊 Low Shelf</option>
        <option value="2">📈 High Shelf</option>
        <option value="3">📉 Low Pass</option>
        <option value="4">📈 High Pass</option>
        <option value="5">🚫 Notch</option>
        <option value="6">🎯 Band Pass</option>
    `;

    // Helper to generate band controls with filter type
    const generateBandKnobs = (index, label, freqMin, freqMax, defaultFreq) => {
        const band = settings.bands[index] || { freq: defaultFreq, gain: 0, q: 1.0, filterType: 0 };
        const filterType = band.filterType || 0;

        return `
            <div class="peq-band-group" style="background: rgba(255,255,255,0.03); border-radius: 12px; padding: 16px; min-width: 160px;">
                <div class="peq-band-title" style="text-align: center; font-weight: 600; color: #fff; margin-bottom: 10px; font-size: 14px;">${label}</div>
                
                <!-- Filter Type Selector -->
                <div style="margin-bottom: 12px;">
                    <select id="peqBand${index}Type" class="peq-filter-select" data-band="${index}" style="width: 100%; padding: 8px 10px; background: #1a1a1a; border: 1px solid #333; border-radius: 6px; color: #fff; font-size: 12px; cursor: pointer;">
                        ${filterTypeOptions.replace(`value="${filterType}"`, `value="${filterType}" selected`)}
                    </select>
                </div>
                
                <div class="knobs-container compact" style="flex-direction: column; gap: 6px;">
                    <div class="knob-wrapper small">
                        <canvas class="aurivo-knob-canvas" id="peqBand${index}FreqCanvas" 
                            width="110" height="145"
                            data-param="band${index}_freq" 
                            data-label="Freq"
                            data-min="${freqMin}" data-max="${freqMax}" 
                            data-value="${band.freq}" 
                            data-unit=" Hz"></canvas>
                    </div>
                    <div class="knob-wrapper small">
                        <canvas class="aurivo-knob-canvas" id="peqBand${index}GainCanvas" 
                            width="110" height="145"
                            data-param="band${index}_gain" 
                            data-label="Gain"
                            data-min="-15" data-max="15" 
                            data-value="${band.gain}" 
                            data-unit=" dB"></canvas>
                    </div>
                    <div class="knob-wrapper small">
                        <canvas class="aurivo-knob-canvas" id="peqBand${index}QCanvas" 
                            width="110" height="145"
                            data-param="band${index}_q" 
                            data-label="Q"
                            data-min="0.1" data-max="10" 
                            data-step="0.1"
                            data-value="${band.q}" 
                            data-unit=""></canvas>
                    </div>
                </div>
            </div>
        `;
    };

	    return `
	        <div class="effect-panel" id="peqPanel">
	            <div class="effect-header">
	                <div class="effect-title-section">
	                    <h2 class="effect-title">📊 ${tSync('sfx.peq.title')}</h2>
	                    <p class="effect-description">${tSync('sfx.peq.description')}</p>
	                </div>
	                <div class="effect-actions">
	                    <label class="enable-toggle">
	                        <input type="checkbox" id="peqEnabled" ${settings.enabled ? 'checked' : ''}>
	                        <span class="toggle-slider"></span>
	                        <span class="enable-label">${tSync('sfx.ui.enable')}</span>
	                    </label>
	                </div>
	            </div>
            
            <div class="peq-bands-container" style="display:flex; flex-wrap:wrap; gap:12px; justify-content:center; margin-top: 16px;">
                ${generateBandKnobs(0, tSync('sfx.peq.bands.subBass'), 20, 200, 60)}
                ${generateBandKnobs(1, tSync('sfx.peq.bands.bass'), 50, 500, 150)}
                ${generateBandKnobs(2, tSync('sfx.peq.bands.lowMid'), 200, 2000, 400)}
                ${generateBandKnobs(3, tSync('sfx.peq.bands.mid'), 500, 5000, 1500)}
                ${generateBandKnobs(4, tSync('sfx.peq.bands.highMid'), 2000, 10000, 5000)}
                ${generateBandKnobs(5, tSync('sfx.peq.bands.high'), 5000, 20000, 12000)}
            </div>

	            <div style="display: flex; justify-content: flex-end; margin-top: 16px;">
	                <button class="action-btn danger" id="peqResetBtn">${tSync('sfx.ui.reset')}</button>
	            </div>
	        </div>
	    `;
	}

function getAutoGainTemplate() {
    const settings = getSettings('autogain');
    return `
        <div class="effect-panel" id="autogainPanel">
            <div class="effect-header">
                <div class="effect-title-section">
                    <h2 class="effect-title">📈 ${tSync('sfx.effects.autogain')}</h2>
                    <p class="effect-description">${tSync('sfx.descriptions.autogain')}</p>
                </div>
                <div class="effect-actions">
                    <label class="enable-toggle">
                        <input type="checkbox" id="autogainEnabled" ${settings.enabled ? 'checked' : ''}>
                        <span class="toggle-slider"></span>
                        <span class="enable-label">${tSync('sfx.ui.enable')}</span>
                    </label>
                </div>
            </div>
            
            <div class="knobs-container">
                <div class="knob-wrapper">
                    <canvas class="aurivo-knob-canvas" id="knobTargetLevelCanvas" 
                        width="130" height="170"
                        data-param="targetLevel" 
                        data-label="Target Level"
                        data-min="-24" data-max="0" 
                        data-value="${settings.targetLevel !== undefined ? settings.targetLevel : -14}" 
                        data-unit=" dBFS"></canvas>
                </div>
                <div class="knob-wrapper">
                    <canvas class="aurivo-knob-canvas" id="knobMaxGainCanvas" 
                        width="130" height="170"
                        data-param="maxGain" 
                        data-label="Max Gain"
                        data-min="0" data-max="24" 
                        data-value="${settings.maxGain !== undefined ? settings.maxGain : 12}" 
                        data-unit=" dB"></canvas>
                </div>
            </div>
            
            <div style="display: flex; justify-content: flex-end; margin-top: 16px;">
                <button class="action-btn danger" id="autogainResetBtn">${tSync('sfx.ui.reset')}</button>
            </div>
        </div>
    `;
}

function getTruePeakTemplate() {
    const settings = getSettings('truepeak');
    const allowedPresets = new Set(['soft', 'balanced', 'loud', 'spotify', 'youtube', 'cd', 'broadcast']);
    const selectedPresetRaw = String(settings.lastPreset || 'balanced');
    const selectedPreset = allowedPresets.has(selectedPresetRaw) ? selectedPresetRaw : 'balanced';
    return `
        <div class="effect-panel" id="truepeakPanel">
            <div class="effect-header">
                <div class="effect-title-section">
                    <h2 class="effect-title">📏 True Peak Limiter + Meter</h2>
                    <p class="effect-description">${tSync('sfx.descriptions.truepeak')}</p>
                </div>
                <div class="effect-actions">
                    <label class="enable-toggle">
                        <input type="checkbox" id="truepeakEnabled" ${settings.enabled ? 'checked' : ''}>
                        <span class="toggle-slider"></span>
                        <span class="enable-label">${tSync('sfx.ui.enable')}</span>
                    </label>
                </div>
            </div>
            
            <div class="knobs-container">
                <div class="knob-wrapper">
                    <canvas class="aurivo-knob-canvas" id="knobTPCeilingCanvas" 
                        width="130" height="170"
                        data-param="ceiling" 
                        data-label="Ceiling"
                        data-min="-12" data-max="0" 
                        data-step="0.1"
                        data-value="${settings.ceiling}" 
                        data-unit=" dBTP"></canvas>
                </div>
                <div class="knob-wrapper">
                    <canvas class="aurivo-knob-canvas" id="knobTPReleaseCanvas" 
                        width="130" height="170"
                        data-param="release" 
                        data-label="Release"
                        data-min="10" data-max="500" 
                        data-value="${settings.release}" 
                        data-unit=" ms"></canvas>
                </div>
                <div class="knob-wrapper">
                    <canvas class="aurivo-knob-canvas" id="knobTPLookaheadCanvas" 
                        width="130" height="170"
                        data-param="lookahead" 
                        data-label="Lookahead"
                        data-min="0" data-max="20" 
                        data-step="0.5"
                        data-value="${settings.lookahead}" 
                        data-unit=" ms"></canvas>
                </div>
                <div class="knob-wrapper">
                    <canvas class="aurivo-knob-canvas" id="knobTPDriveCanvas" 
                        width="130" height="170"
                        data-param="drive" 
                        data-label="Drive"
                        data-min="-12" data-max="24" 
                        data-step="0.5"
                        data-value="${settings.drive ?? 0}" 
                        data-unit=" dB"></canvas>
                </div>
            </div>
            
            <!-- Stereo True Peak Meters -->
            <div class="true-peak-meters" style="margin-top: 24px; padding: 16px; background: rgba(255,255,255,0.03); border-radius: 12px;">
                <h3 style="margin: 0 0 12px 0; color: #aaa; font-size: 14px;">Stereo True Peak Meters</h3>
                
                <!-- Left Channel -->
                <div class="channel-meter" style="display: flex; align-items: center; gap: 12px; margin-bottom: 8px;">
                    <span style="width: 20px; font-weight: 700; color: #fff;">L</span>
                    <div class="meter-bar" style="flex: 1; height: 10px; background: #0a0a0a; border-radius: 5px; position: relative; overflow: hidden;">
                        <div class="meter-fill" id="truePeakMeterL" style="width: 0%; height: 100%; background: linear-gradient(90deg, #4caf50 0%, #8bc34a 40%, #ffeb3b 70%, #ff9800 85%, #f44336 95%); will-change: width;"></div>
                        <div id="truePeakHoldL" style="position: absolute; top: 0; height: 100%; width: 2px; background: #fff; box-shadow: 0 0 4px #fff; left: 0%; will-change: left;"></div>
                        <div id="truePeakCeilingLine" style="position: absolute; top: 0; height: 100%; width: 2px; background: #ff0080; box-shadow: 0 0 4px #ff0080; right: ${Math.abs(settings.ceiling) / 60 * 100}%;"></div>
                    </div>
                    <span id="truePeakValueL" style="min-width: 80px; font-size: 13px; color: #00d4ff; text-align: right;">-96.0 dBTP</span>
                </div>
                
                <!-- Right Channel -->
                <div class="channel-meter" style="display: flex; align-items: center; gap: 12px; margin-bottom: 8px;">
                    <span style="width: 20px; font-weight: 700; color: #fff;">R</span>
                    <div class="meter-bar" style="flex: 1; height: 10px; background: #0a0a0a; border-radius: 5px; position: relative; overflow: hidden;">
                        <div class="meter-fill" id="truePeakMeterR" style="width: 0%; height: 100%; background: linear-gradient(90deg, #4caf50 0%, #8bc34a 40%, #ffeb3b 70%, #ff9800 85%, #f44336 95%); will-change: width;"></div>
                        <div id="truePeakHoldR" style="position: absolute; top: 0; height: 100%; width: 2px; background: #fff; box-shadow: 0 0 4px #fff; left: 0%; will-change: left;"></div>
                    </div>
                    <span id="truePeakValueR" style="min-width: 80px; font-size: 13px; color: #00d4ff; text-align: right;">-96.0 dBTP</span>
                </div>
                
                <div class="meter-markers" style="display: flex; justify-content: space-between; color: #666; font-size: 11px; padding: 0 32px;">
                    <span>-60</span>
                    <span>-36</span>
                    <span>-18</span>
                    <span>-6</span>
                    <span>0 dBTP</span>
                </div>
                
                <!-- Clipping Counter -->
                <div class="clipping-section" style="display: flex; align-items: center; gap: 12px; margin-top: 16px; padding: 12px; background: rgba(244, 67, 54, 0.08); border: 1px solid rgba(244, 67, 54, 0.2); border-radius: 8px;">
                    <span style="color: #f44336;">${tSync('sfx.truepeak.clipping')}</span>
                    <span id="truepeakClipCount" style="font-size: 18px; font-weight: 700; color: #f44336; min-width: 50px;">0</span>
                    <button id="resetClipBtn" style="padding: 6px 12px; background: #f44336; border: none; border-radius: 4px; color: #fff; cursor: pointer; font-size: 12px;">${tSync('sfx.ui.reset')}</button>
                    
                    <div style="margin-left: auto; display: flex; align-items: center; gap: 8px;">
                        <span style="color: #00bcd4; font-size: 13px;">${tSync('sfx.truepeak.gainReduction')}</span>
                        <span id="truepeakGainReduction" style="font-size: 16px; font-weight: 700; color: #00bcd4; min-width: 70px;">0.0 dB</span>
                    </div>
                </div>
                <div id="truepeakActivityInfo" style="margin-top: 8px; color: #9aa3b2; font-size: 12px;">
                    Limiter kapalı: Clipping ve GR değerinin 0 görünmesi normal.
                </div>
            </div>
            
            <!-- Oversampling & Link Options -->
            <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 16px; flex-wrap: wrap; gap: 12px;">
                <div class="oversampling-selector" style="display: flex; align-items: center; gap: 8px;">
                    <span style="color: #aaa; font-size: 13px;">${tSync('sfx.truepeak.oversampling')}</span>
                    <button class="os-btn ${settings.oversampling === 2 ? 'active' : ''}" data-rate="2" style="padding: 6px 12px; border: 1px solid #444; border-radius: 4px; background: ${settings.oversampling === 2 ? '#0099ff' : '#222'}; color: #fff; cursor: pointer;">2x</button>
                    <button class="os-btn ${settings.oversampling === 4 ? 'active' : ''}" data-rate="4" style="padding: 6px 12px; border: 1px solid #444; border-radius: 4px; background: ${settings.oversampling === 4 ? '#0099ff' : '#222'}; color: #fff; cursor: pointer;">4x</button>
                    <button class="os-btn ${settings.oversampling === 8 ? 'active' : ''}" data-rate="8" style="padding: 6px 12px; border: 1px solid #444; border-radius: 4px; background: ${settings.oversampling === 8 ? '#0099ff' : '#222'}; color: #fff; cursor: pointer;">8x</button>
                </div>
                
                <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                    <input type="checkbox" id="truepeakLinkChannels" ${settings.linkChannels ? 'checked' : ''} style="width: 16px; height: 16px;">
                    <span style="color: #aaa; font-size: 13px;">Stereo Link</span>
                </label>
            </div>
            
            <!-- Presets -->
            <div class="truepeak-presets" style="display: flex; gap: 8px; margin-top: 16px; flex-wrap: wrap;">
                <button class="preset-btn tp-preset-btn tp-soft ${selectedPreset === 'soft' ? 'active' : ''}" data-preset="soft" aria-pressed="${selectedPreset === 'soft' ? 'true' : 'false'}"><svg class="tp-preset-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M12.8 3.2c-4.2 0-7.6 3.4-7.6 7.6V13h2.2c4.2 0 7.6-3.4 7.6-7.6V3.2h-2.2Z" stroke="currentColor" stroke-width="1.5"/><path d="M6 10.6c1.6-1.9 3.4-3.5 5.5-4.7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg><span>Soft</span></button>
                <button class="preset-btn tp-preset-btn tp-balanced ${selectedPreset === 'balanced' ? 'active' : ''}" data-preset="balanced" aria-pressed="${selectedPreset === 'balanced' ? 'true' : 'false'}"><svg class="tp-preset-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 4h10M3 8h10M3 12h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="6" cy="4" r="1.5" fill="currentColor"/><circle cx="10" cy="8" r="1.5" fill="currentColor"/><circle cx="7" cy="12" r="1.5" fill="currentColor"/></svg><span>Balanced</span></button>
                <button class="preset-btn tp-preset-btn tp-loud ${selectedPreset === 'loud' ? 'active' : ''}" data-preset="loud" aria-pressed="${selectedPreset === 'loud' ? 'true' : 'false'}"><svg class="tp-preset-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="2" y="9" width="2.5" height="5" rx="1" fill="currentColor"/><rect x="6.75" y="6.5" width="2.5" height="7.5" rx="1" fill="currentColor"/><rect x="11.5" y="3" width="2.5" height="11" rx="1" fill="currentColor"/></svg><span>Loud</span></button>
                <button class="preset-btn tp-preset-btn tp-spotify ${selectedPreset === 'spotify' ? 'active' : ''}" data-preset="spotify" aria-pressed="${selectedPreset === 'spotify' ? 'true' : 'false'}"><svg class="tp-preset-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.5"/><path d="M4.4 6.5c2.6-1 4.7-1 7.3 0" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><path d="M5 8.6c2-.7 3.8-.7 5.8 0" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><path d="M5.6 10.5c1.4-.4 2.7-.4 4.1 0" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg><span>Spotify</span></button>
                <button class="preset-btn tp-preset-btn tp-youtube ${selectedPreset === 'youtube' ? 'active' : ''}" data-preset="youtube" aria-pressed="${selectedPreset === 'youtube' ? 'true' : 'false'}"><svg class="tp-preset-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="1.5" y="3.5" width="13" height="9" rx="3" stroke="currentColor" stroke-width="1.5"/><path d="M7 6.2v3.6l3-1.8-3-1.8Z" fill="currentColor"/></svg><span>YouTube</span></button>
                <button class="preset-btn tp-preset-btn tp-cd ${selectedPreset === 'cd' ? 'active' : ''}" data-preset="cd" aria-pressed="${selectedPreset === 'cd' ? 'true' : 'false'}"><svg class="tp-preset-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.5"/><circle cx="8" cy="8" r="2" stroke="currentColor" stroke-width="1.5"/><circle cx="10.8" cy="5.2" r="0.9" fill="currentColor"/></svg><span>CD Master</span></button>
                <button class="preset-btn tp-preset-btn tp-broadcast ${selectedPreset === 'broadcast' ? 'active' : ''}" data-preset="broadcast" aria-pressed="${selectedPreset === 'broadcast' ? 'true' : 'false'}"><svg class="tp-preset-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 11.5V8.8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="8" cy="6.7" r="1.3" fill="currentColor"/><path d="M5.4 9.5a3.6 3.6 0 0 1 0-5.1M10.6 9.5a3.6 3.6 0 0 0 0-5.1" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M3.5 11.2a6.2 6.2 0 0 1 0-8.7M12.5 11.2a6.2 6.2 0 0 0 0-8.7" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/></svg><span>Broadcast</span></button>
            </div>
            <div id="truepeakPresetHint" style="margin-top: 10px; color: #9aa3b2; font-size: 12px; line-height: 1.45;">
                ${tOr(`sfx.truepeak.presetDescriptions.${selectedPreset}`, '⚖️ Balanced: Günlük kullanım için dengeli limiter davranışı.')}
            </div>
            
            <div style="display: flex; justify-content: flex-end; margin-top: 16px;">
                <button class="action-btn danger" id="truepeakResetBtn">${tSync('sfx.ui.reset')}</button>
            </div>
        </div>
    `;
}

// --- Crossfeed (Headphone Enhancement) Template ---
function getCrossfeedTemplate() {
    const settings = getSettings('crossfeed');
    const autoHeadphones = settings.autoHeadphones !== false;

    const presetDescriptions = {
        0: tSync('sfx.crossfeed.presetDescriptions.0'),
        1: tSync('sfx.crossfeed.presetDescriptions.1'),
        2: tSync('sfx.crossfeed.presetDescriptions.2'),
        3: tSync('sfx.crossfeed.presetDescriptions.3'),
        4: tSync('sfx.crossfeed.presetDescriptions.4')
    };

    return `
        <div class="effect-panel" id="crossfeedPanel">
            <div class="effect-header">
                <div class="effect-title-section">
                    <h2 class="effect-title">🎧 ${tSync('sfx.effects.crossfeed')}</h2>
                    <p class="effect-description">${tSync('sfx.descriptions.crossfeed')}</p>
                </div>
                <div class="effect-actions">
                    <label class="enable-toggle">
                        <input type="checkbox" id="crossfeedEnabled" ${settings.enabled ? 'checked' : ''}>
                        <span class="toggle-slider"></span>
                        <span class="enable-label">${tSync('sfx.ui.enable')}</span>
                    </label>
                </div>
            </div>
            
            
            <!-- Crossfeed Visualization -->
            <div class="crossfeed-visual-panel" style="margin: 20px 0; padding: 20px; background: #0a0a0a; border-radius: 12px; border: 1px solid #333;">
                <h3 style="color: #00d4ff; margin-bottom: 10px; font-size: 14px;">Stereo Field Simulation</h3>
                <canvas id="crossfeed-canvas" width="400" height="200" style="width: 100%; max-width: 400px; display: block; margin: 0 auto;"></canvas>
            </div>
            <div id="crossfeed-status" style="margin-top: -8px; margin-bottom: 12px; color: #888; font-size: 12px;">
                ${tSync('sfx.crossfeed.statusChecking')}
            </div>
            <div id="crossfeedDeviceHint" style="margin-top: -2px; margin-bottom: 12px; padding: 10px 12px; border-radius: 8px; background: rgba(0, 153, 255, 0.08); border: 1px solid rgba(0, 153, 255, 0.22); color: #8fc8ff; font-size: 12px;">
                ${tOr('sfx.crossfeed.device.loading', 'Output device is being checked...')}
            </div>
            <label style="display:flex; align-items:center; gap:8px; margin-top:10px; color:#aeb8c5; font-size:12px; cursor:pointer;">
                <input type="checkbox" id="crossfeedAutoHeadphones" ${autoHeadphones ? 'checked' : ''} style="width:14px; height:14px;">
                ${tOr('sfx.crossfeed.autoHeadphones', 'Auto enable/disable crossfeed according to headphone connection')}
            </label>
            
            <!-- Preset Selector -->
            <div class="crossfeed-presets" style="margin: 20px 0;">
                <h3 style="color: #aaa; margin-bottom: 12px; font-size: 14px;">${tSync('sfx.ui.presets')}</h3>
                <div class="preset-buttons" style="display: flex; gap: 10px; flex-wrap: wrap;">
                    ${renderModernPresetButton({ panelId: 'crossfeedPanel', preset: '0', label: 'Natural', icon: 'natural', active: settings.preset === 0, extraClass: 'crossfeed-preset-btn' })}
                    ${renderModernPresetButton({ panelId: 'crossfeedPanel', preset: '1', label: 'Mild', icon: 'mild', active: settings.preset === 1, extraClass: 'crossfeed-preset-btn' })}
                    ${renderModernPresetButton({ panelId: 'crossfeedPanel', preset: '2', label: 'Strong', icon: 'strong', active: settings.preset === 2, extraClass: 'crossfeed-preset-btn' })}
                    ${renderModernPresetButton({ panelId: 'crossfeedPanel', preset: '3', label: 'Wide', icon: 'wide', active: settings.preset === 3, extraClass: 'crossfeed-preset-btn' })}
                    ${renderModernPresetButton({ panelId: 'crossfeedPanel', preset: '4', label: 'Custom', icon: 'custom', active: settings.preset === 4, extraClass: 'crossfeed-preset-btn' })}
                    <button class="action-btn danger" id="crossfeedResetBtn" style="margin-left: auto; padding: 10px 16px;">🔄 ${tSync('sfx.ui.reset')}</button>
                </div>
                <p id="crossfeed-preset-description" style="color: #888; font-size: 12px; margin-top: 10px; padding: 8px; background: rgba(0,212,255,0.05); border-radius: 6px;">
                    ${presetDescriptions[settings.preset]}
                </p>
            </div>
            
            <!-- Knobs -->
            <div class="knob-grid" style="display: flex; justify-content: center; gap: 30px; flex-wrap: wrap; margin: 20px 0;">
                <div class="knob-wrapper">
                    <canvas class="aurivo-knob-canvas crossfeed-knob" id="crossfeedLevelCanvas" 
                        width="110" height="145"
                        data-param="level" 
                        data-label="Level"
                        data-min="0" 
                        data-max="100" 
                        data-value="${settings.level}"
                        data-unit="%"></canvas>
                </div>
                <div class="knob-wrapper">
                    <canvas class="aurivo-knob-canvas crossfeed-knob" id="crossfeedDelayCanvas" 
                        width="110" height="145"
                        data-param="delay" 
                        data-label="Delay"
                        data-min="0.1" 
                        data-max="1.5" 
                        data-value="${settings.delay}"
                        data-step="0.01"
                        data-unit="ms"></canvas>
                </div>
                <div class="knob-wrapper">
                    <canvas class="aurivo-knob-canvas crossfeed-knob" id="crossfeedLowCutCanvas" 
                        width="110" height="145"
                        data-param="lowCut" 
                        data-label="Low Cut"
                        data-min="200" 
                        data-max="2000" 
                        data-value="${settings.lowCut}"
                        data-unit="Hz"></canvas>
                </div>
                <div class="knob-wrapper">
                    <canvas class="aurivo-knob-canvas crossfeed-knob" id="crossfeedHighCutCanvas" 
                        width="110" height="145"
                        data-param="highCut" 
                        data-label="High Cut"
                        data-min="2000" 
                        data-max="10000" 
                        data-value="${settings.highCut}"
                        data-unit="Hz"></canvas>
                </div>
            </div>
            
            <!-- Info Panel -->
            <div class="crossfeed-info-panel" style="margin-top: 20px; padding: 20px; background: rgba(0, 212, 255, 0.05); border: 2px solid rgba(0, 212, 255, 0.2); border-radius: 12px;">
                <h3 style="color: #00d4ff; margin-bottom: 10px; font-size: 14px;">${tSync('sfx.crossfeed.info.title')}</h3>
                <p style="color: #aaa; font-size: 13px; line-height: 1.6; margin-bottom: 10px;">
                    ${tSync('sfx.crossfeed.info.body1')}
                </p>
                <p style="color: #aaa; font-size: 13px; line-height: 1.6; margin-bottom: 10px;">
                    <strong style="color: #00d4ff;">${tSync('sfx.effects.crossfeed')}</strong> ${tSync('sfx.crossfeed.info.body2')}
                </p>
                <ul style="list-style: none; padding-left: 0; margin-bottom: 10px;">
                    <li style="color: #888; font-size: 12px; margin-bottom: 5px;">✅ ${tSync('sfx.crossfeed.info.benefit1')}</li>
                    <li style="color: #888; font-size: 12px; margin-bottom: 5px;">✅ ${tSync('sfx.crossfeed.info.benefit2')}</li>
                    <li style="color: #888; font-size: 12px; margin-bottom: 5px;">✅ ${tSync('sfx.crossfeed.info.benefit3')}</li>
                    <li style="color: #888; font-size: 12px; margin-bottom: 5px;">✅ ${tSync('sfx.crossfeed.info.benefit4')}</li>
                </ul>
                <p style="color: #ffeb3b; font-size: 12px; margin-top: 15px; padding: 10px; background: rgba(255, 235, 59, 0.1); border-radius: 6px;">
                    ⚠️ <strong>${tSync('sfx.crossfeed.info.noteLabel')}</strong> ${tSync('sfx.crossfeed.info.noteBody')}
                </p>
            </div>
        </div>
    `;
}

function getSurroundTemplate() {
    const settings = getSettings('surround');
    const selectedPreset = String(settings.lastPreset || 'movie');
    return `
        <div class="effect-panel" id="surroundPanel">
            <div class="effect-header">
                <div class="effect-title-section">
                    <h2 class="effect-title">🛰️ ${tOr('sfx.effects.surround', 'Surround (5.1/7.1)')}</h2>
                    <p class="effect-description">${tOr('sfx.descriptions.surround', 'Cinematic stage simulation with center/surround/LFE balance for stereo sources.')}</p>
                </div>
                <div class="effect-actions">
                    <label class="enable-toggle">
                        <input type="checkbox" id="surroundEnabled" ${settings.enabled ? 'checked' : ''}>
                        <span class="toggle-slider"></span>
                        <span class="enable-label">${tSync('sfx.ui.enable')}</span>
                    </label>
                </div>
            </div>

            <div class="knobs-container">
                <div class="knob-wrapper">
                    <canvas class="aurivo-knob-canvas" width="130" height="170"
                        data-param="center"
                        data-label="Center Level"
                        data-min="-12" data-max="12"
                        data-step="0.1"
                        data-value="${settings.center}"
                        data-unit=" dB"></canvas>
                </div>
                <div class="knob-wrapper">
                    <canvas class="aurivo-knob-canvas" width="130" height="170"
                        data-param="surround"
                        data-label="${tOr('sfx.knob.param.surroundLevel', 'Surround Level')}"
                        data-min="-12" data-max="12"
                        data-step="0.1"
                        data-value="${settings.surround}"
                        data-unit=" dB"></canvas>
                </div>
                <div class="knob-wrapper">
                    <canvas class="aurivo-knob-canvas" width="130" height="170"
                        data-param="lfe"
                        data-label="${tOr('sfx.knob.param.lfeLevel', 'LFE Level')}"
                        data-min="-12" data-max="12"
                        data-step="0.1"
                        data-value="${settings.lfe}"
                        data-unit=" dB"></canvas>
                </div>
                <div class="knob-wrapper">
                    <canvas class="aurivo-knob-canvas" width="130" height="170"
                        data-param="crossover"
                        data-label="${tOr('sfx.knob.param.crossover', 'Crossover')}"
                        data-min="40" data-max="200"
                        data-step="1"
                        data-value="${settings.crossover}"
                        data-unit=" Hz"></canvas>
                </div>
                <div class="knob-wrapper">
                    <canvas class="aurivo-knob-canvas" width="130" height="170"
                        data-param="delay"
                        data-label="${tOr('sfx.knob.param.rearDelay', 'Rear Delay')}"
                        data-min="0" data-max="30"
                        data-step="0.1"
                        data-value="${settings.delay}"
                        data-unit=" ms"></canvas>
                </div>
                <div class="knob-wrapper">
                    <canvas class="aurivo-knob-canvas" width="130" height="170"
                        data-param="mix"
                        data-label="Mix"
                        data-min="0" data-max="100"
                        data-step="1"
                        data-value="${settings.mix}"
                        data-unit=" %"></canvas>
                </div>
            </div>

            <div class="presets-section">
                <div class="presets-title">🎬 ${tOr('sfx.surround.presets.title', 'Surround Presets')}</div>
                <div class="presets-buttons">
                    ${renderModernPresetButton({ panelId: 'surroundPanel', preset: 'movie', label: tOr('sfx.surround.presets.movie', 'Movie'), icon: 'hall', active: selectedPreset === 'movie', extraClass: 'surround-preset-btn' })}
                    ${renderModernPresetButton({ panelId: 'surroundPanel', preset: 'music', label: tOr('sfx.surround.presets.music', 'Music'), icon: 'natural', active: selectedPreset === 'music', extraClass: 'surround-preset-btn' })}
                    ${renderModernPresetButton({ panelId: 'surroundPanel', preset: 'game', label: tOr('sfx.surround.presets.game', 'Game'), icon: 'wide', active: selectedPreset === 'game', extraClass: 'surround-preset-btn' })}
                    ${renderModernPresetButton({ panelId: 'surroundPanel', preset: 'voice', label: tOr('sfx.surround.presets.voice', 'Voice+'), icon: 'vocal', active: selectedPreset === 'voice', extraClass: 'surround-preset-btn' })}
                    ${renderModernPresetButton({ panelId: 'surroundPanel', preset: 'night', label: tOr('sfx.surround.presets.night', 'Night'), icon: 'mild', active: selectedPreset === 'night', extraClass: 'surround-preset-btn' })}
                </div>
            </div>

            <div id="surroundDeviceHint" style="margin-top: 10px; padding: 10px 12px; border-radius: 8px; background: rgba(0, 153, 255, 0.08); border: 1px solid rgba(0, 153, 255, 0.22); color: #8fc8ff; font-size: 12px;">
                ${tOr('sfx.surround.hint.loading', 'Reading output info...')}
            </div>
            <label style="display:flex; align-items:center; gap:8px; margin-top:10px; color:#aeb8c5; font-size:12px; cursor:pointer;">
                <input type="checkbox" id="surroundAutoMultichannel" ${settings.autoMultichannel ? 'checked' : ''} style="width:14px; height:14px;">
                ${tOr('sfx.surround.autoMultichannel', 'Auto enable/disable surround on multichannel outputs (>2 channels)')}
            </label>

            <div style="display: flex; justify-content: flex-end; margin-top: 16px;">
                <button class="action-btn danger" id="surroundResetBtn">${tSync('sfx.ui.reset')}</button>
            </div>
        </div>
    `;
}

// --- Bass Mono Template ---
function getBassMonoTemplate() {
    const settings = getSettings('bassmono');

    return `
        <div class="effect-panel" id="bassmonoPanel">
            <div class="effect-header">
                <div class="effect-title-section">
                    <h2 class="effect-title">🔉 ${tSync('sfx.effects.bassmono')}</h2>
                    <p class="effect-description">${tSync('sfx.descriptions.bassmono')}</p>
                </div>
                <div class="effect-actions">
                    <label class="enable-toggle">
                        <input type="checkbox" id="bassmonoEnabled" ${settings.enabled ? 'checked' : ''}>
                        <span class="toggle-slider"></span>
                        <span class="enable-label">${tSync('sfx.ui.enable')}</span>
                    </label>
                </div>
            </div>

            <!-- Visualization -->
            <div class="bass-mono-visual-panel" style="margin: 20px 0; padding: 20px; background: #0a0a0a; border-radius: 12px; border: 1px solid #333;">
                <h3 style="color: #ff0080; margin-bottom: 10px; font-size: 14px;">Frequency Split Visualization</h3>
                <canvas id="bass-mono-canvas" width="600" height="250" style="width: 100%; height: auto; display: block;"></canvas>
            </div>

            <!-- Presets -->
            <div class="bass-mono-presets" style="margin-bottom: 20px;">
                <h3 style="color: #aaa; margin-bottom: 10px; font-size: 14px;">${tSync('sfx.ui.presets')}</h3>
                <div class="preset-grid" style="display: flex; gap: 10px; flex-wrap: wrap;">
                    ${renderModernPresetButton({ panelId: 'bassmonoPanel', preset: 'vinyl', label: tSync('sfx.bassmono.presets.vinyl'), icon: 'vinyl', active: settings.lastPreset === 'vinyl', extraClass: 'bassmono-preset-btn' })}
                    ${renderModernPresetButton({ panelId: 'bassmonoPanel', preset: 'club', label: tSync('sfx.bassmono.presets.club'), icon: 'club', active: settings.lastPreset === 'club', extraClass: 'bassmono-preset-btn' })}
                    ${renderModernPresetButton({ panelId: 'bassmonoPanel', preset: 'mastering', label: tSync('sfx.bassmono.presets.mastering'), icon: 'mastering', active: settings.lastPreset === 'mastering', extraClass: 'bassmono-preset-btn' })}
                    ${renderModernPresetButton({ panelId: 'bassmonoPanel', preset: 'dj', label: tSync('sfx.bassmono.presets.dj'), icon: 'dj', active: settings.lastPreset === 'dj', extraClass: 'bassmono-preset-btn' })}
                    ${renderModernPresetButton({ panelId: 'bassmonoPanel', preset: 'sub', label: tSync('sfx.bassmono.presets.sub'), icon: 'sub', active: settings.lastPreset === 'sub', extraClass: 'bassmono-preset-btn' })}
                </div>
            </div>

            <!-- Knobs -->
            <div class="knob-grid" style="display: flex; justify-content: center; gap: 30px; flex-wrap: wrap; margin: 20px 0;">
                <div class="knob-wrapper">
                    <canvas class="aurivo-knob-canvas bass-mono-knob" id="bassmonoCutoffCanvas" 
                        width="130" height="170"
                        data-param="cutoff" 
                        data-label="Cutoff"
                        data-min="40" 
                        data-max="300" 
                        data-value="${settings.cutoff}"
                        data-unit="Hz"></canvas>
                </div>
                
                <div class="slope-selector" style="display: flex; flex-direction: column; align-items: center; justify-content: center;">
                    <label style="color: #aaa; font-size: 12px; margin-bottom: 8px;">${tSync('sfx.bassmono.slopeLabel')}</label>
                    <div style="display: flex; flex-direction: column; gap: 5px;">
                        <button class="slope-btn ${settings.slope === 12 ? 'active' : ''}" data-slope="12">12 dB/oct</button>
                        <button class="slope-btn ${settings.slope === 24 ? 'active' : ''}" data-slope="24">24 dB/oct</button>
                        <button class="slope-btn ${settings.slope === 48 ? 'active' : ''}" data-slope="48">48 dB/oct</button>
                    </div>
                </div>

                <div class="knob-wrapper">
                    <canvas class="aurivo-knob-canvas bass-mono-knob" id="bassmonoStereoWidthCanvas" 
                        width="130" height="170"
                        data-param="stereoWidth" 
                        data-label="Stereo Width"
                        data-min="0" 
                        data-max="200" 
                        data-value="${settings.stereoWidth}"
                        data-unit="%"></canvas>
                </div>
            </div>

            <!-- Info Panel -->
            <div class="bass-mono-info-panel" style="margin-top: 20px; padding: 15px; background: rgba(255, 0, 128, 0.05); border: 1px solid rgba(255, 0, 128, 0.2); border-radius: 8px;">
                <h3 style="color: #ff0080; font-size: 14px; margin-bottom: 5px;">${tSync('sfx.bassmono.info.title')}</h3>
                <p style="color: #aaa; font-size: 12px; line-height: 1.5;">${tSync('sfx.bassmono.info.body')}</p>
            </div>
            
            <div style="display: flex; justify-content: flex-end; margin-top: 16px;">
                <button class="action-btn danger" id="bassmonoResetBtn">${tSync('sfx.ui.reset')}</button>
            </div>
        </div>
    `;
}

function getDynamicEQTemplate() {
    const settings = getSettings('dynamiceq');

    return `
        <div class="effect-panel" id="dynamiceqPanel">
            <div class="effect-header">
                <div class="effect-title-section">
                    <h2 class="effect-title">📊 ${tSync('sfx.effects.dynamiceq')}</h2>
                    <p class="effect-description">${tSync('sfx.descriptions.dynamiceq')}</p>
                </div>
                <div class="effect-actions">
                    <label class="enable-toggle">
                        <input type="checkbox" id="dynamiceqEnabled" ${settings.enabled ? 'checked' : ''}>
                        <span class="toggle-slider"></span>
                        <span class="enable-label">${tSync('sfx.ui.enable')}</span>
                    </label>
                </div>
            </div>

            <!-- Presets -->
            <div class="dynamiceq-presets" style="margin-bottom: 20px;">
                <h3 style="color: #aaa; margin-bottom: 10px; font-size: 14px;">${tSync('sfx.ui.presets')}</h3>
                <div class="preset-grid" style="display: flex; gap: 10px; flex-wrap: wrap;">
                    ${renderModernPresetButton({ panelId: 'dynamiceqPanel', preset: 'deharsh', label: tSync('sfx.dynamiceq.presets.deharsh'), icon: 'sparkle', active: settings.lastPreset === 'deharsh', extraClass: 'dynamiceq-preset-btn' })}
                    ${renderModernPresetButton({ panelId: 'dynamiceqPanel', preset: 'demud', label: tSync('sfx.dynamiceq.presets.demud'), icon: 'target', active: settings.lastPreset === 'demud', extraClass: 'dynamiceq-preset-btn' })}
                    ${renderModernPresetButton({ panelId: 'dynamiceqPanel', preset: 'vocal', label: tSync('sfx.dynamiceq.presets.vocal'), icon: 'vocal', active: settings.lastPreset === 'vocal', extraClass: 'dynamiceq-preset-btn' })}
                    ${renderModernPresetButton({ panelId: 'dynamiceqPanel', preset: 'deesser', label: tSync('sfx.dynamiceq.presets.deesser'), icon: 'mute', active: settings.lastPreset === 'deesser', extraClass: 'dynamiceq-preset-btn' })}
                    ${renderModernPresetButton({ panelId: 'dynamiceqPanel', preset: 'basstighten', label: tSync('sfx.dynamiceq.presets.basstighten'), icon: 'guitar', active: settings.lastPreset === 'basstighten', extraClass: 'dynamiceq-preset-btn' })}
                    ${renderModernPresetButton({ panelId: 'dynamiceqPanel', preset: 'air', label: tSync('sfx.dynamiceq.presets.air'), icon: 'air', active: settings.lastPreset === 'air', extraClass: 'dynamiceq-preset-btn' })}
                    ${renderModernPresetButton({ panelId: 'dynamiceqPanel', preset: 'drumsnap', label: tSync('sfx.dynamiceq.presets.drumsnap'), icon: 'drum', active: settings.lastPreset === 'drumsnap', extraClass: 'dynamiceq-preset-btn' })}
                    ${renderModernPresetButton({ panelId: 'dynamiceqPanel', preset: 'warmth', label: tSync('sfx.dynamiceq.presets.warmth'), icon: 'flame', active: settings.lastPreset === 'warmth', extraClass: 'dynamiceq-preset-btn' })}
                </div>
            </div>

            <!-- Knobs -->
            <div class="knob-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 20px; margin: 20px 0;">
                <div class="knob-wrapper">
                    <canvas class="aurivo-knob-canvas dynamiceq-knob" id="dynamiceqFrequencyCanvas" 
                        width="130" height="170"
                        data-param="frequency" 
                        data-label="Frequency"
                        data-min="20" 
                        data-max="20000" 
                        data-value="${settings.frequency}"
                        data-unit="Hz"></canvas>
                </div>
                
                <div class="knob-wrapper">
                    <canvas class="aurivo-knob-canvas dynamiceq-knob" id="dynamiceqQCanvas" 
                        width="130" height="170"
                        data-param="q" 
                        data-label="Q (Bandwidth)"
                        data-min="0.1" 
                        data-max="10" 
                        data-value="${settings.q}"
                        data-unit=""></canvas>
                </div>

                <div class="knob-wrapper">
                    <canvas class="aurivo-knob-canvas dynamiceq-knob" id="dynamiceqThresholdCanvas" 
                        width="130" height="170"
                        data-param="threshold" 
                        data-label="Threshold"
                        data-min="-80" 
                        data-max="0" 
                        data-value="${settings.threshold}"
                        data-unit=" dBFS"></canvas>
                </div>

                <div class="knob-wrapper">
                    <canvas class="aurivo-knob-canvas dynamiceq-knob" id="dynamiceqGainCanvas" 
                        width="130" height="170"
                        data-param="gain" 
                        data-label="Target Gain"
                        data-min="-24" 
                        data-max="24" 
                        data-value="${settings.gain}"
                        data-unit=" dB"></canvas>
                </div>

                <div class="knob-wrapper">
                    <canvas class="aurivo-knob-canvas dynamiceq-knob" id="dynamiceqRangeCanvas" 
                        width="130" height="170"
                        data-param="range" 
                        data-label="Range"
                        data-min="0" 
                        data-max="24" 
                        data-value="${settings.range}"
                        data-unit=" dB"></canvas>
                </div>

                <div class="knob-wrapper">
                    <canvas class="aurivo-knob-canvas dynamiceq-knob" id="dynamiceqAttackCanvas" 
                        width="130" height="170"
                        data-param="attack" 
                        data-label="Attack"
                        data-min="1" 
                        data-max="2000" 
                        data-value="${settings.attack}"
                        data-unit=" ms"></canvas>
                </div>

                <div class="knob-wrapper">
                    <canvas class="aurivo-knob-canvas dynamiceq-knob" id="dynamiceqReleaseCanvas" 
                        width="130" height="170"
                        data-param="release" 
                        data-label="Release"
                        data-min="5" 
                        data-max="5000" 
                        data-value="${settings.release}"
                        data-unit=" ms"></canvas>
                </div>
            </div>

            <!-- Info Panel -->
            <div class="dynamiceq-info-panel" style="margin-top: 20px; padding: 15px; background: rgba(0, 128, 255, 0.05); border: 1px solid rgba(0, 128, 255, 0.2); border-radius: 8px;">
                <h3 style="color: #0080ff; font-size: 14px; margin-bottom: 5px;">${tSync('sfx.dynamiceq.info.title')}</h3>
                <p style="color: #aaa; font-size: 12px; line-height: 1.5;">${tSync('sfx.dynamiceq.info.body')}</p>
            </div>
            
            <div style="display: flex; justify-content: flex-end; margin-top: 16px;">
                <button class="action-btn danger" id="dynamiceqResetBtn">${tSync('sfx.ui.reset')}</button>
            </div>
        </div>
    `;
}

function getTapeSatTemplate() {
    const settings = getSettings('tapesat');
    return `
            <div class="effect-panel" id="tapesatPanel">
            <div class="effect-header">
                <div class="effect-title-section">
                    <h2 class="effect-title">📼 ${tSync('sfx.effects.tapesat')}</h2>
                    <p class="effect-description">${tSync('sfx.descriptions.tapesat')}</p>
                </div>
                <div class="effect-actions">
                    <label class="enable-toggle">
                        <input type="checkbox" id="tapesatEnabled" ${settings.enabled ? 'checked' : ''}>
                        <span class="toggle-slider"></span>
                        <span class="enable-label">${tSync('sfx.ui.enable')}</span>
                    </label>
                </div>
            </div>

            <!-- Presets -->
            <div class="tapesat-presets" style="margin-bottom: 20px;">
                <h3 style="color: #aaa; margin-bottom: 10px; font-size: 14px;">${tSync('sfx.ui.presets')}</h3>
                <div class="preset-grid" style="display: flex; gap: 10px; flex-wrap: wrap;">
                    ${renderModernPresetButton({ panelId: 'tapesatPanel', preset: 'subtle', label: tSync('sfx.tapesat.presets.subtle'), icon: 'sparkle', active: settings.lastPreset === 'subtle', extraClass: 'tapesat-modern-preset-btn' })}
                    ${renderModernPresetButton({ panelId: 'tapesatPanel', preset: 'glue', label: tSync('sfx.tapesat.presets.glue'), icon: 'target', active: settings.lastPreset === 'glue', extraClass: 'tapesat-modern-preset-btn' })}
                    ${renderModernPresetButton({ panelId: 'tapesatPanel', preset: 'crisp', label: tSync('sfx.tapesat.presets.crisp'), icon: 'ice', active: settings.lastPreset === 'crisp', extraClass: 'tapesat-modern-preset-btn' })}
                    ${renderModernPresetButton({ panelId: 'tapesatPanel', preset: 'lofi', label: tSync('sfx.tapesat.presets.lofi'), icon: 'tape', active: settings.lastPreset === 'lofi', extraClass: 'tapesat-modern-preset-btn' })}
                </div>
            </div>

            <!-- Tape Mode Selector -->
            <div class="mode-selector" style="margin-bottom: 20px; background: rgba(0,0,0,0.2); padding: 15px; border-radius: 8px;">
                <h3 style="color: #aaa; margin-bottom: 10px; font-size: 14px;">Kaset Karakteri (Tape Mode)</h3>
                <div style="display: flex; gap: 10px;">
                    <button class="mode-btn ${settings.mode === 0 ? 'active' : ''}" data-mode="0" onclick="setTapeModeUI(0)" style="flex: 1; padding: 10px; background: #1a1a1a; border: 1px solid #333; color: #ccc; border-radius: 4px; cursor: pointer;">Classic Tape</button>
                    <button class="mode-btn ${settings.mode === 1 ? 'active' : ''}" data-mode="1" onclick="setTapeModeUI(1)" style="flex: 1; padding: 10px; background: #1a1a1a; border: 1px solid #333; color: #ccc; border-radius: 4px; cursor: pointer;">Warm Tube</button>
                    <button class="mode-btn ${settings.mode === 2 ? 'active' : ''}" data-mode="2" onclick="setTapeModeUI(2)" style="flex: 1; padding: 10px; background: #1a1a1a; border: 1px solid #333; color: #ccc; border-radius: 4px; cursor: pointer;">Hot Saturation</button>
                </div>
            </div>

            <!-- Knobs -->
            <div class="knob-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 20px; margin: 20px 0;">
                <div class="knob-wrapper">
                    <canvas class="aurivo-knob-canvas tapesat-knob" id="tapesatDriveDbCanvas" 
                        width="130" height="170"
                        data-param="driveDb" 
                        data-label="Drive"
                        data-min="0" 
                        data-max="24" 
                        data-value="${settings.driveDb}"
                        data-unit=" dB"></canvas>
                </div>
                
                <div class="knob-wrapper">
                    <canvas class="aurivo-knob-canvas tapesat-knob" id="tapesatMixCanvas" 
                        width="130" height="170"
                        data-param="mix" 
                        data-label="Mix"
                        data-min="0" 
                        data-max="100" 
                        data-value="${settings.mix}"
                        data-unit=" %"></canvas>
                </div>

                <div class="knob-wrapper">
                    <canvas class="aurivo-knob-canvas tapesat-knob" id="tapesatToneCanvas" 
                        width="130" height="170"
                        data-param="tone" 
                        data-label="Tone"
                        data-min="0" 
                        data-max="100" 
                        data-value="${settings.tone}"
                        data-unit=""></canvas>
                </div>

                <div class="knob-wrapper">
                    <canvas class="aurivo-knob-canvas tapesat-knob" id="tapesatOutputDbCanvas" 
                        width="130" height="170"
                        data-param="outputDb" 
                        data-label="Output"
                        data-min="-12" 
                        data-max="12" 
                        data-value="${settings.outputDb}"
                        data-unit=" dB"></canvas>
                </div>

                <div class="knob-wrapper">
                    <canvas class="aurivo-knob-canvas tapesat-knob" id="tapesatHissCanvas" 
                        width="130" height="170"
                        data-param="hiss" 
                        data-label="Tape Hiss"
                        data-min="0" 
                        data-max="100" 
                        data-value="${settings.hiss}"
                        data-unit=" %"></canvas>
                </div>
            </div>

            <!-- Status -->
            <div class="tapesat-status" style="margin-top: 10px; padding: 10px; background: rgba(0,0,0,0.2); border-radius: 4px; font-size: 12px; color: #888;">
                ${tSync('sfx.tapesat.statusLabel')} <span id="tapesatDSPStatus" style="color: #00d4ff;">${tSync('sfx.tapesat.statusAttached')}</span>
            </div>

            <div style="text-align: right; margin-top: 20px;">
                <button class="action-btn" onclick="resetEffect('tapesat')" style="background: #e74c3c;">${tSync('sfx.ui.reset')}</button>
            </div>
        </div>
    `;
}


function getBitDitherTemplate() {
    const settings = getSettings('bitdither');
    return `
        <div class="effect-panel" id="bitditherPanel">
            <div class="effect-header">
                <div class="effect-title-section">
                    <h2 class="effect-title">🎚️ ${tSync('sfx.effects.bitdither')}</h2>
                    <p class="effect-description">${tSync('sfx.descriptions.bitdither')}</p>
                </div>
                <div class="effect-actions">
                    <label class="enable-toggle">
                        <input type="checkbox" id="bitditherEnabled" ${settings.enabled ? 'checked' : ''}>
                        <span class="toggle-slider"></span>
                        <span class="enable-label">${tSync('sfx.ui.enable')}</span>
                    </label>
                </div>
            </div>

            <!-- Presets -->
            <div class="tapesat-presets" style="margin-bottom: 20px;">
                <h3 style="color: #aaa; margin-bottom: 10px; font-size: 14px;">${tSync('sfx.ui.presets')}</h3>
                <div class="preset-grid" style="display: flex; gap: 10px; flex-wrap: wrap;">
                    ${renderModernPresetButton({ panelId: 'bitditherPanel', preset: 'cd16', label: tSync('sfx.bitdither.presets.cd16'), icon: 'vinyl', active: settings.lastPreset === 'cd16', extraClass: 'bitdither-preset-btn' })}
                    ${renderModernPresetButton({ panelId: 'bitditherPanel', preset: 'retro12', label: tSync('sfx.bitdither.presets.retro12'), icon: 'retro', active: settings.lastPreset === 'retro12', extraClass: 'bitdither-preset-btn' })}
                    ${renderModernPresetButton({ panelId: 'bitditherPanel', preset: 'game8', label: tSync('sfx.bitdither.presets.game8'), icon: 'game', active: settings.lastPreset === 'game8', extraClass: 'bitdither-preset-btn' })}
                    ${renderModernPresetButton({ panelId: 'bitditherPanel', preset: 'vinyl', label: tSync('sfx.bitdither.presets.vinyl'), icon: 'tape', active: settings.lastPreset === 'vinyl', extraClass: 'bitdither-preset-btn' })}
                    ${renderModernPresetButton({ panelId: 'bitditherPanel', preset: 'crunch', label: tSync('sfx.bitdither.presets.crunch'), icon: 'burst', active: settings.lastPreset === 'crunch', extraClass: 'bitdither-preset-btn' })}
                </div>
            </div>

            <!-- Selectors Grid -->
            <div class="selectors-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin-bottom: 25px; background: rgba(0,0,0,0.2); padding: 20px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.05);">
                
                <div class="selector-item">
                    <label style="display: block; color: #888; font-size: 11px; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 1px;">Bit Depth (Çözünürlük)</label>
                    <select class="action-btn secondary" id="bitditherBitDepth" style="width: 100%; text-align: left;" onchange="updateBitDitherSelect('bitDepth', this.value)">
                        <option value="24" ${settings.bitDepth === 24 ? 'selected' : ''}>24-bit (Studio Grade)</option>
                        <option value="16" ${settings.bitDepth === 16 ? 'selected' : ''}>16-bit (CD Quality)</option>
                        <option value="12" ${settings.bitDepth === 12 ? 'selected' : ''}>12-bit (Vintage Sampler)</option>
                        <option value="8" ${settings.bitDepth === 8 ? 'selected' : ''}>8-bit (Retro Computing)</option>
                        <option value="6" ${settings.bitDepth === 6 ? 'selected' : ''}>6-bit (Aggressive Crush)</option>
                        <option value="4" ${settings.bitDepth === 4 ? 'selected' : ''}>4-bit (Extreme Distortion)</option>
                    </select>
                </div>

                <div class="selector-item">
                    <label style="display: block; color: #888; font-size: 11px; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 1px;">Dither Type</label>
                    <select class="action-btn secondary" id="bitditherDither" style="width: 100%; text-align: left;" onchange="updateBitDitherSelect('dither', this.value)">
                        <option value="0" ${settings.dither === 0 ? 'selected' : ''}>None (Hard Quantization)</option>
                        <option value="1" ${settings.dither === 1 ? 'selected' : ''}>RPDF (Rectangular)</option>
                        <option value="2" ${settings.dither === 2 ? 'selected' : ''}>TPDF (Triangular - Industry Std)</option>
                    </select>
                </div>

                <div class="selector-item">
                    <label style="display: block; color: #888; font-size: 11px; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 1px;">Noise Shaping</label>
                    <select class="action-btn secondary" id="bitditherShaping" style="width: 100%; text-align: left;" onchange="updateBitDitherSelect('shaping', this.value)">
                        <option value="0" ${settings.shaping === 0 ? 'selected' : ''}>Off (Clean)</option>
                        <option value="1" ${settings.shaping === 1 ? 'selected' : ''}>Light (HF Distribution)</option>
                    </select>
                </div>

                <div class="selector-item">
                    <label style="display: block; color: #888; font-size: 11px; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 1px;">Downsample (Sample Hold)</label>
                    <select class="action-btn secondary" id="bitditherDownsample" style="width: 100%; text-align: left;" onchange="updateBitDitherSelect('downsample', this.value)">
                        <option value="1" ${settings.downsample === 1 ? 'selected' : ''}>Off (1x)</option>
                        <option value="2" ${settings.downsample === 2 ? 'selected' : ''}>2x (24kHz aliasing)</option>
                        <option value="4" ${settings.downsample === 4 ? 'selected' : ''}>4x (12kHz aliasing)</option>
                        <option value="8" ${settings.downsample === 8 ? 'selected' : ''}>8x (6kHz aliasing)</option>
                        <option value="16" ${settings.downsample === 16 ? 'selected' : ''}>16x (Extreme Lo-fi)</option>
                    </select>
                </div>
            </div>

            <!-- Knobs -->
            <div class="knob-grid" style="display: flex; justify-content: center; gap: 40px; margin: 20px 0;">
                <div class="knob-wrapper">
                    <canvas class="aurivo-knob-canvas bitdither-knob" id="bitditherMixCanvas" 
                        width="130" height="170"
                        data-param="mix" 
                        data-label="Mix"
                        data-min="0" 
                        data-max="100" 
                        data-value="${settings.mix}"
                        data-unit=" %"></canvas>
                </div>
                
                <div class="knob-wrapper">
                    <canvas class="aurivo-knob-canvas bitdither-knob" id="bitditherOutputDbCanvas" 
                        width="130" height="170"
                        data-param="outputDb" 
                        data-label="Output"
                        data-min="-12" 
                        data-max="12" 
                        data-value="${settings.outputDb}"
                        data-unit=" dB"></canvas>
                </div>
            </div>

            <div style="text-align: right; margin-top: 20px;">
                <button class="action-btn" onclick="resetEffect('bitdither')" style="background: #e74c3c;">${tSync('sfx.ui.reset')}</button>
            </div>
        </div>
    `;
}

// Generic effect template builder
function getGenericEffectTemplate(effectId, title, description, knobs) {
    const settings = getSettings(effectId);

    let knobsHTML = knobs.map(k => {
        const value = settings[k.id] || 0;
        // Use Canvas Knob
        return `
            <div class="knob-wrapper">
                <canvas class="aurivo-knob-canvas" id="${effectId}${k.id}Canvas" 
                    width="130" height="170"
                    data-param="${k.id}" 
                    data-label="${k.label}"
                    data-min="${k.min}" 
                    data-max="${k.max}" 
                    data-value="${value}"
                    data-unit="${k.unit}"></canvas>
            </div>
        `;
    }).join('');

    return `
        <div class="effect-panel" id="${effectId}Panel">
            <div class="effect-header">
                <div class="effect-title-section">
                    <h2 class="effect-title">${title}</h2>
                    <p class="effect-description">${description}</p>
                </div>
                <div class="effect-actions">
                    <label class="enable-toggle">
                        <input type="checkbox" id="${effectId}Enabled" ${settings.enabled ? 'checked' : ''}>
                        <span class="toggle-slider"></span>
                        <span class="enable-label">${tSync('sfx.ui.enable')}</span>
                    </label>
                </div>
            </div>
            
            <div class="knobs-container">
                ${knobsHTML}
            </div>
            
            <div style="display: flex; justify-content: flex-end; margin-top: 16px;">
                <button class="action-btn danger" id="${effectId}ResetBtn">${tSync('sfx.ui.reset')}</button>
            </div>
        </div>
    `;
}

// ============================================
// EFFECT CONTROLS INITIALIZATION
// ============================================

// Knob'ların zaten başlatılıp başlatılmadığını takip et
let knobsInitialized = false;
let eq32ControlsInitialized = false;

function initEffectControls(effectName) {
    // Knob'ları sadece bir kere başlat (tüm paneller için)
    // Legacy knobs support (if any left)
    if (!knobsInitialized) {
        initKnobs();
        knobsInitialized = true;
    }

    // EQ sliders
    if (effectName === 'eq32') {
        if (eq32ControlsInitialized) return;
        eq32ControlsInitialized = true;

        // İlk frame'i boş geç: UI animasyonları akıcı başlasın
        requestAnimationFrame(() => {
            initEQSliders();
            initBalanceSlider();
        });

        // Butonlar
        document.getElementById('eqResetBtn')?.addEventListener('click', () => resetEffect('eq32'));
        document.getElementById('moduleResetBtn')?.addEventListener('click', () => resetAurivoModule());
        document.getElementById('eqPresetsBtn')?.addEventListener('click', () => showEQPresets());
    } else {
        // Init Canvas Knobs for other panels
        initGenericKnobs(effectName);
    }

    // Reset butonları
    document.getElementById(`${effectName}ResetBtn`)?.addEventListener('click', () => resetEffect(effectName));

    // Enable toggle (Reverb için özel işlem)
    const enableToggle = document.getElementById(`${effectName}Enabled`);
    console.log(`[DEBUG] initEffectControls for ${effectName}, enableToggle element:`, enableToggle);
    if (enableToggle) {
        enableToggle.addEventListener('change', (e) => {
            console.log(`[DEBUG] Toggle changed for ${effectName}:`, e.target.checked);
            const settings = getSettings(effectName);
            settings.enabled = e.target.checked;
            saveSettings(effectName, settings);

            // Reverb için direkt IPC çağrısı
            if (effectName === 'reverb' && window.aurivo?.ipcAudio?.reverb) {
                window.aurivo.ipcAudio.reverb.setEnabled(e.target.checked);
                if (e.target.checked) {
                    // Reverb açıldığında tüm parametreleri uygula
                    applyEffect('reverb');
                }
            } else {
                console.log(`[DEBUG] Calling applyEffect for ${effectName}`);
                applyEffect(effectName);
            }
        });
    } else {
        console.warn(`[DEBUG] enableToggle not found for ${effectName}!`);
    }

    // Reverb presets
    if (effectName === 'reverb') {
        const panel = document.getElementById('reverbPanel');
        panel?.querySelectorAll('.preset-btn')?.forEach(btn => {
            btn.addEventListener('click', () => applyReverbPreset(btn.dataset.preset));
        });
    }

    // Convolution Reverb presets
    if (effectName === 'convreverb') {
        const panel = document.getElementById('convreverbPanel');
        panel?.querySelectorAll('.ir-preset-btn')?.forEach((btn) => {
            btn.addEventListener('click', () => selectIRPreset(btn.dataset.preset));
        });
    }

    if (effectName === 'softecho') {
        const panel = document.getElementById('softechoPanel');
        panel?.querySelectorAll('.softecho-preset-btn')?.forEach((btn) => {
            btn.addEventListener('click', () => applySoftEchoPreset(btn.dataset.preset));
        });
        const stereoCb = document.getElementById('softechoStereo');
        if (stereoCb) {
            stereoCb.addEventListener('change', (e) => {
                const settings = getSettings('softecho');
                settings.stereo = !!e.target.checked;
                saveSettings('softecho', settings);
                if (window.aurivo?.ipcAudio?.softEcho?.setStereoMode) {
                    window.aurivo.ipcAudio.softEcho.setStereoMode(settings.stereo);
                }
                applyEffect('softecho');
            });
        }
    }

    // True Peak Limiter için özel event listener'lar
    if (effectName === 'truepeak') {
        // Oversampling butonları
        document.querySelectorAll('.os-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const rate = parseInt(btn.dataset.rate);
                const settings = getSettings('truepeak');
                settings.oversampling = rate;
                saveSettings('truepeak', settings);

                // UI güncelle
                document.querySelectorAll('.os-btn').forEach(b => {
                    b.style.background = parseInt(b.dataset.rate) === rate ? '#0099ff' : '#222';
                });

                // C++ tarafına gönder
                if (window.aurivo?.ipcAudio?.truePeakLimiter?.setOversampling) {
                    window.aurivo.ipcAudio.truePeakLimiter.setOversampling(rate);
                }

                console.log(`[TRUE PEAK] ${tSync('sfx.truepeak.oversampling')} ${rate}x`);
            });
        });

        // Link channels checkbox
        const linkCb = document.getElementById('truepeakLinkChannels');
        if (linkCb) {
            linkCb.addEventListener('change', (e) => {
                const settings = getSettings('truepeak');
                settings.linkChannels = e.target.checked;
                saveSettings('truepeak', settings);

                if (window.aurivo?.ipcAudio?.truePeakLimiter?.setLinkChannels) {
                    window.aurivo.ipcAudio.truePeakLimiter.setLinkChannels(e.target.checked);
                }

                console.log(`[TRUE PEAK] Link channels: ${e.target.checked ? 'ON' : 'OFF'}`);
            });
        }

        // Reset clipping button
        const resetClipBtn = document.getElementById('resetClipBtn');
        if (resetClipBtn) {
            resetClipBtn.addEventListener('click', () => {
                if (window.aurivo?.ipcAudio?.truePeakLimiter?.resetClipping) {
                    window.aurivo.ipcAudio.truePeakLimiter.resetClipping();
                }
                const clipCount = document.getElementById('truepeakClipCount');
                if (clipCount) clipCount.textContent = '0';
                console.log('[TRUE PEAK] Clipping counter reset');
            });
        }

        // Presets (sadece truepeak paneli içinde)
        const panel = document.getElementById('truepeakPanel');
        panel?.querySelectorAll('.preset-btn')?.forEach(btn => {
            btn.addEventListener('click', () => {
                const preset = btn.dataset.preset;
                applyTruePeakPreset(preset);
            });
        });
    }

    // Crossfeed için özel event listener'lar
    if (effectName === 'crossfeed') {
        initCrossfeedControls();
    }

    if (effectName === 'surround') {
        initSurroundControls();
    }

    // Bass Mono
    if (effectName === 'bassmono') {
        initBassMonoControls();
    }

    // Dynamic EQ
    if (effectName === 'dynamiceq') {
        const panel = document.getElementById('dynamiceqPanel');
        panel?.querySelectorAll('.dynamiceq-preset-btn')?.forEach((btn) => {
            btn.addEventListener('click', () => window.applyDynamicEQPreset?.(btn.dataset.preset));
        });
    }

    // Tape Saturation
    if (effectName === 'tapesat') {
        const panel = document.getElementById('tapesatPanel');
        panel?.querySelectorAll('.tapesat-modern-preset-btn')?.forEach((btn) => {
            btn.addEventListener('click', () => applyTapeSatPreset(btn.dataset.preset));
        });
    }

    // Bit Dither
    if (effectName === 'bitdither') {
        const panel = document.getElementById('bitditherPanel');
        panel?.querySelectorAll('.bitdither-preset-btn')?.forEach((btn) => {
            btn.addEventListener('click', () => applyBitDitherPreset(btn.dataset.preset));
        });
    }
}

// Generic Knobs Initializer
function initGenericKnobs(effectName) {
    const panel = document.getElementById(`${effectName}Panel`);
    if (!panel) return;

    const elements = panel.querySelectorAll('.aurivo-knob-canvas');
    elements.forEach(canvas => {
        // Skip if already initialized
        if (canvas._knobInitialized) return;

        const param = canvas.dataset.param;
        const min = parseFloat(canvas.dataset.min);
        const max = parseFloat(canvas.dataset.max);
        const step = parseFloat(canvas.dataset.step) || 1;
        const val = parseFloat(canvas.dataset.value);
        const unit = canvas.dataset.unit || '';
        const label = getKnobLabel(effectName, param, canvas.dataset.label || param);

        const knob = new ColorKnob(canvas, {
            label: label,
            minValue: min,
            maxValue: max,
            stepSize: step,
            value: val,
            suffix: ' ' + unit,
            wheelStep: (max - min) / 40,
            // PEQ frequency/Q gibi geniş aralıklarda drag hissi çok yavaştı.
            // Bu ayar, sürükleme ile tüm aralığı makul mesafede gezmeyi sağlar.
            ...(effectName === 'peq' ? { dragRangePx: 220 } : {})
        });

        knob.onChange((value) => {
            updateEffectParam(effectName, param, value);
        });

        // Store globally for reset access
        SFX.knobInstances[`${effectName}_${param}`] = knob;
        canvas._knobInstance = knob; // Link for easy DOM access
        canvas._knobInitialized = true;
    });
}


// ============================================
// KNOB SYSTEM
// ============================================
function initKnobs() {
    document.querySelectorAll('.knob').forEach(knob => {
        const param = knob.dataset.param;
        const min = parseFloat(knob.dataset.min) || 0;
        const max = parseFloat(knob.dataset.max) || 100;
        const step = parseFloat(knob.dataset.step) || 1;
        let value = parseFloat(knob.dataset.value) || 0;

        // İndikatör açısını ayarla
        updateKnobIndicator(knob, value, min, max);

        // Mouse drag
        let isDragging = false;
        let startY = 0;
        let startValue = 0;

        knob.addEventListener('mousedown', (e) => {
            isDragging = true;
            startY = e.clientY;
            startValue = value;
            knob.style.cursor = 'grabbing';
            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;

            const delta = (startY - e.clientY) * ((max - min) / 200);
            value = Math.max(min, Math.min(max, startValue + delta));
            value = Math.round(value / step) * step;

            knob.dataset.value = value;
            updateKnobIndicator(knob, value, min, max);
            updateKnobValue(knob, param, value);

            // Ayarları kaydet ve uygula
            updateEffectParam(SFX.currentEffect, param, value);
        });

        document.addEventListener('mouseup', () => {
            if (isDragging) {
                isDragging = false;
                knob.style.cursor = 'pointer';
            }
        });

        // Mouse wheel
        knob.addEventListener('wheel', (e) => {
            e.preventDefault();
            const delta = e.deltaY > 0 ? -step : step;
            value = Math.max(min, Math.min(max, value + delta * 2));
            value = Math.round(value / step) * step;

            knob.dataset.value = value;
            updateKnobIndicator(knob, value, min, max);
            updateKnobValue(knob, param, value);
            updateEffectParam(SFX.currentEffect, param, value);
        });
    });
}

function updateKnobIndicator(knob, value, min, max) {
    const indicator = knob.querySelector('.knob-indicator');
    if (!indicator) return;

    // -135° ile +135° arası (270° toplam)
    const percentage = (value - min) / (max - min);
    const angle = -135 + (percentage * 270);

    if (knob.classList.contains('knob-aurivo')) {
        // Nokta indikatör: merkezden dışarı it (Halka üzerine)
        // Halka yarıçapı yaklaşık 40px (104px container / 2 - padding)
        indicator.style.transform = `translate(-50%, -50%) rotate(${angle}deg) translateY(-38px)`;
        return;
    }

    // Legacy çizgi indikatör
    indicator.style.transform = `translateX(-50%) rotate(${angle}deg)`;
}

function updateKnobValue(knob, param, value) {
    const wrapper = knob.closest('.knob-wrapper') || knob.closest('.knob-item');
    const valueEl = wrapper?.querySelector('.knob-value');
    if (!valueEl) return;

    // Param'a göre format
    const formats = {
        bass: `${value.toFixed(1)} dB`,
        mid: `${value.toFixed(1)} dB`,
        treble: `${value.toFixed(1)} dB`,
        stereoExpander: `${Math.round(value)} %`,
        roomSize: `${Math.round(value)} ms`,
        damping: value.toFixed(3),
        wetDry: `${Math.round(value)} dB`,
        hfRatio: value.toFixed(3),
        inputGain: `${Math.round(value)} dB`,
        threshold: `${Math.round(value)} dB`,
        ratio: `${value}:1`,
        attack: `${value} ms`,
        release: `${Math.round(value)} ms`,
        makeupGain: `${Math.round(value)} dB`,
        knee: `${value} dB`,
        ceiling: `${value.toFixed(1)} dB`,
        lookahead: `${Math.round(value)} ms`,
        gain: `${Math.round(value)} dB`,
        frequency: `${Math.round(value)} Hz`,
        harmonics: `${Math.round(value)}%`,
        width: value.toFixed(1),
        mix: `${Math.round(value)}%`,
        hold: `${Math.round(value)} ms`,
        range: `${Math.round(value)} dB`,
        targetLevel: `${Math.round(value)} LUFS`,
        maxGain: `${Math.round(value)} dB`,
        center: `${value.toFixed(1)} dB`,
        surround: `${value.toFixed(1)} dB`,
        lfe: `${value.toFixed(1)} dB`,
        crossover: `${Math.round(value)} Hz`
    };

    valueEl.textContent = formats[param] || value;
}

// ============================================
// EQ SLIDERS (RainbowSlider)
// ============================================
const eqSliders = [];

const EQ_TOP_MIN_HZ = 20;
const EQ_TOP_MAX_HZ = 22000;
const EQ_TOP_FIXED_BANDS = 92;
const EQ_TOP_TARGET_FPS = 45;
const EQ_TOP_FRAME_MS = Math.max(8, Math.floor(1000 / EQ_TOP_TARGET_FPS));
const EQ_TOP_EQ_FREQS = [
    20, 25, 31, 40, 50, 63, 80, 100,
    125, 160, 200, 250, 315, 400, 500, 630,
    800, 1000, 1300, 1600, 2000, 2500, 3200, 4000,
    5000, 6300, 8000, 10000, 12500, 16000, 20000, 22000
];

function clamp01(v) {
    return Math.max(0, Math.min(1, Number(v) || 0));
}

function lerp(a, b, t) {
    return a + (b - a) * t;
}

function eqGainAtFreq(freqHz, settings) {
    const bands = Array.isArray(settings?.bands) ? settings.bands : [];
    if (bands.length !== 32) return 0;
    const f = Math.max(EQ_TOP_MIN_HZ, Math.min(EQ_TOP_MAX_HZ, Number(freqHz) || EQ_TOP_MIN_HZ));
    if (f <= EQ_TOP_EQ_FREQS[0]) return Number(bands[0]) || 0;
    if (f >= EQ_TOP_EQ_FREQS[31]) return Number(bands[31]) || 0;
    for (let i = 0; i < 31; i++) {
        const a = EQ_TOP_EQ_FREQS[i];
        const b = EQ_TOP_EQ_FREQS[i + 1];
        if (f >= a && f <= b) {
            const t = (Math.log(f) - Math.log(a)) / (Math.log(b) - Math.log(a));
            return lerp(Number(bands[i]) || 0, Number(bands[i + 1]) || 0, t);
        }
    }
    return 0;
}

function eqModuleWeightAtFreq(freqHz, settings) {
    const bass = Number(settings?.bass) || 0;
    const mid = Number(settings?.mid) || 0;
    const treble = Number(settings?.treble) || 0;

    const lowW = freqHz <= 220 ? 1 : (freqHz < 700 ? (700 - freqHz) / 480 : 0);
    let midW = 0;
    if (freqHz >= 250 && freqHz <= 4500) {
        const d = Math.abs(Math.log(freqHz / 1200) / Math.log(4.2));
        midW = clamp01(1 - d);
    }
    const highW = freqHz >= 3500 ? clamp01((freqHz - 3500) / 8000) : 0;

    const db = bass * lowW + mid * midW + treble * highW;
    return Math.max(0.4, Math.min(2.6, Math.pow(10, db / 20)));
}

function computeEqTopBars(rawBands, targetCount) {
    const src = Array.isArray(rawBands) ? rawBands : [];
    const count = Math.max(8, Number(targetCount) || 8);
    if (!(SFX.eqTopViz.smooth instanceof Float32Array) || SFX.eqTopViz.smooth.length !== count) {
        SFX.eqTopViz.smooth = new Float32Array(count).fill(0);
    }
    const out = new Uint8Array(count);
    if (!src.length) return out;

    const settings = getSettings('eq32');
    const minHz = EQ_TOP_MIN_HZ;
    const maxHz = EQ_TOP_MAX_HZ;
    const ratio = maxHz / minHz;
    let rawPeak = 0;

    for (let i = 0; i < count; i++) {
        const p0 = i / count;
        const p1 = (i + 1) / count;
        const a = Math.floor(p0 * src.length);
        const b = Math.max(a + 1, Math.floor(p1 * src.length));
        let e = 0;
        for (let j = a; j < b; j++) {
            const v = Number(src[j]) || 0;
            if (v > e) e = v;
        }
        if (e > rawPeak) rawPeak = e;

        const t = count <= 1 ? 0 : (i / (count - 1));
        const freq = minHz * Math.pow(ratio, t);
        const eqDb = eqGainAtFreq(freq, settings);
        const eqWeight = Math.max(0.45, Math.min(3.2, Math.pow(10, eqDb / 20)));
        const moduleWeight = eqModuleWeightAtFreq(freq, settings);
        const freqComp = Math.pow(freq / minHz, 0.22); // High-frequency visibility compensation

        // Normalize using raw (pre-EQ-weighted) level so EQ boost/cut stays visible.
        const rawBase = e / Math.max(1e-6, SFX.eqTopViz.rawNorm);
        const weighted = rawBase * eqWeight * moduleWeight * freqComp;
        const prev = SFX.eqTopViz.smooth[i] || 0;
        const alpha = weighted >= prev ? 0.62 : 0.34; // fast attack, controlled release
        const sm = lerp(prev, weighted, alpha);
        SFX.eqTopViz.smooth[i] = sm;
    }

    if (rawPeak > SFX.eqTopViz.rawNorm) SFX.eqTopViz.rawNorm = lerp(SFX.eqTopViz.rawNorm, rawPeak, 0.28);
    else SFX.eqTopViz.rawNorm = lerp(SFX.eqTopViz.rawNorm, rawPeak, 0.08);

    for (let i = 0; i < count; i++) {
        const n = clamp01(SFX.eqTopViz.smooth[i] || 0);
        const curved = Math.pow(n, 0.62);
        out[i] = Math.round(curved * 255);
    }
    return out;
}

function stopEqTopVisualizer() {
    SFX.eqTopViz.running = false;
    SFX.eqTopViz.busy = false;
    if (SFX.eqTopViz.frameId) {
        cancelAnimationFrame(SFX.eqTopViz.frameId);
        SFX.eqTopViz.frameId = 0;
    }
}

function startEqTopVisualizer() {
    if (SFX.eqTopViz.running) return;
    if (SFX.currentEffect !== 'eq32') return;
    const canvas = document.getElementById('barAnalyzerCanvas');
    if (!canvas || !SFX.barAnalyzer) return;
    const spectrumApi = window.aurivo?.audio?.spectrum;
    if (!spectrumApi || typeof spectrumApi.getBands !== 'function') return;

    SFX.eqTopViz.running = true;
    SFX.eqTopViz.lastFetchAt = 0;
    SFX.eqTopViz.busy = false;
    SFX.eqTopViz.norm = 0.02;

    const tick = (ts) => {
        if (!SFX.eqTopViz.running || SFX.currentEffect !== 'eq32' || !SFX.barAnalyzer) {
            SFX.eqTopViz.running = false;
            SFX.eqTopViz.frameId = 0;
            return;
        }

        const now = Number(ts) || performance.now();
        const needsFetch = (now - SFX.eqTopViz.lastFetchAt) >= (SFX_LOW_LOAD_EQ32 ? 34 : EQ_TOP_FRAME_MS);

        if (needsFetch && !SFX.eqTopViz.busy) {
            SFX.eqTopViz.busy = true;
            SFX.eqTopViz.lastFetchAt = now;
            const target = Math.max(48, Math.min(112, Number(SFX.barAnalyzer.bandCount) || EQ_TOP_FIXED_BANDS));
            const requestBands = Math.max(128, target * 2);
            spectrumApi.getBands(requestBands)
                .then((bands) => {
                    if (!SFX.eqTopViz.running) return;
                    SFX.eqTopViz.bars = computeEqTopBars(bands, target);
                })
                .catch(() => { /* ignore */ })
                .finally(() => {
                    SFX.eqTopViz.busy = false;
                });
        }

        if (SFX.eqTopViz.bars && SFX.eqTopViz.bars.length) {
            SFX.barAnalyzer.draw(SFX.eqTopViz.bars);
        }
        SFX.eqTopViz.frameId = requestAnimationFrame(tick);
    };

    SFX.eqTopViz.frameId = requestAnimationFrame(tick);
}

function resetEqTopVisualizerState() {
    const count = Math.max(48, Number(SFX.barAnalyzer?.bandCount) || 96);
    SFX.eqTopViz.bars = new Uint8Array(count).fill(0);
    SFX.eqTopViz.smooth = new Float32Array(count).fill(0);
    SFX.eqTopViz.norm = 0.02;
    SFX.eqTopViz.rawNorm = 0.02;
}

function initEQSliders() {
    // Clear old instances
    SFX.eqSliders = [];

    const settings = getSettings('eq32');

    // 1. Initialize Top Visualizer
    const analyzerCanvas = document.getElementById('barAnalyzerCanvas');
    if (analyzerCanvas) {
        SFX.barAnalyzer = new BarAnalyzer(analyzerCanvas, {
            columnWidth: 4,
            spacing: 2,
            backgroundColor: '#000000',
            rainbow: true,
            fixedBands: EQ_TOP_FIXED_BANDS,
            roofHold: 8,
            fallDivisor: 10
        });
        resetEqTopVisualizerState();
        startEqTopVisualizer();
    } else {
        SFX.barAnalyzer = null;
    }

    document.querySelectorAll('.eq-slider-canvas').forEach(canvas => {
        const band = parseInt(canvas.dataset.band);
        const freq = canvas.title;

        const slider = new RainbowSlider(canvas, {
            minValue: -12,
            maxValue: 12,
            stepSize: 0.1,
            value: settings.bands[band] || 0,
            frequency: freq,
            animatedHue: !SFX_LOW_LOAD_EQ32
        });

        slider.onChange((value) => {
            if (SFX.suppressEq32SliderEvents) return;
            // Değeri göster
            const valueEl = document.getElementById(`eqValue${band}`);
            if (valueEl) {
                valueEl.textContent = `${value.toFixed(1)}d`;
            }

            // Ayarları güncelle
            const currentSettings = getSettings('eq32');
            // Manuel değişiklik, artık preset birebir değil
            if (currentSettings.lastPreset) {
                currentSettings.lastPreset = null;
                updateEqPresetButtonLabel();
            }
            currentSettings.bands[band] = value;
            saveSettings('eq32', currentSettings);

            if (window.aurivo?.ipcAudio?.eq) {
                window.aurivo.ipcAudio.eq.setBand(band, value).catch(console.error);
            }

            // Kalıcı kayıt (debounce)
            schedulePersistEq32ToAppSettings(currentSettings);
        });

        SFX.eqSliders[band] = slider;
    });

    // Initialize Aurivo Module Knobs
    initAurivoKnobs();
}

function initAurivoKnobs() {
    const settings = getSettings('eq32');

    const knobsConfig = [
        { id: 'knobBassCanvas', param: 'bass', label: 'Bas (100 Hz)', min: -12, max: 12, step: 0.1, val: settings.bass, suffix: ' dB' },
        { id: 'knobMidCanvas', param: 'mid', label: 'Mid (500Hz-2kHz)', min: -12, max: 12, step: 0.1, val: settings.mid, suffix: ' dB' },
        { id: 'knobTrebleCanvas', param: 'treble', label: 'Tiz (10 kHz)', min: -12, max: 12, step: 0.1, val: settings.treble, suffix: ' dB' },
        { id: 'knobStereoCanvas', param: 'stereoExpander', label: 'Stereo Expander', min: 0, max: 200, step: 1, val: settings.stereoExpander, suffix: ' %' }
    ];

    knobsConfig.forEach(cfg => {
        const canvas = document.getElementById(cfg.id);
        if (canvas) {
            const knob = new ColorKnob(canvas, {
                label: getKnobLabel('eq32', cfg.param, cfg.label),
                minValue: cfg.min,
                maxValue: cfg.max,
                stepSize: cfg.step,
                value: cfg.val,
                suffix: cfg.suffix,
                wheelStep: (cfg.max - cfg.min) / 40
            });

            knob.onChange((value) => {
                updateEffectParam('eq32', cfg.param, value);
            });

            // Store instance
            SFX.knobInstances[cfg.param] = knob;
        }
    });

    const acousticSelect = document.getElementById('acousticSpace');
    if (acousticSelect) {
        acousticSelect.value = String(settings.acousticSpace || 'off');
        acousticSelect.addEventListener('change', (e) => {
            const selected = String(e.target.value || 'off');
            applyAcousticSpacePreset(selected);
        });
    }

    initBalanceSlider();
}


function setupHighDPI(canvas) {
    // Optional: High DPI scaling if needed
    // const dpr = window.devicePixelRatio || 1;
    // const rect = canvas.getBoundingClientRect();
    // canvas.width = rect.width * dpr;
    // canvas.height = rect.height * dpr;
    // canvas.getContext('2d').scale(dpr, dpr);
}

// ============================================
// BALANCE SLIDER
// ============================================
function initBalanceSlider() {
    const slider = document.getElementById('balanceSlider');
    const valueEl = document.getElementById('balanceValue');

    if (slider) {
        slider.addEventListener('input', (e) => {
            const value = parseInt(e.target.value);
            if (valueEl) {
                valueEl.textContent = getBalanceText(value);
            }

            const settings = getSettings('eq32');
            settings.balance = value;
            saveSettings('eq32', settings);

            schedulePersistEq32ToAppSettings(settings);

            // IPC Audio API'ye gönder (main process'e)
            if (window.aurivo?.ipcAudio?.balance) {
                window.aurivo.ipcAudio.balance.set(value);
            }
        });
    }
}

function getBalanceText(value) {
    if (value === 0) return tSync('sfx.balance.center', { pct: 0 });
    if (value < 0) return tSync('sfx.balance.left', { pct: Math.abs(value) });
    return tSync('sfx.balance.right', { pct: value });
}

// ============================================
// SETTINGS MANAGEMENT
// ============================================
function getSettings(effectName) {
    if (!SFX.settings[effectName]) {
        // localStorage'dan yükle veya varsayılan kullan
        try {
            const saved = localStorage.getItem(`aurivo_sfx_${effectName}`);
            SFX.settings[effectName] = saved ? JSON.parse(saved) : { ...SFX.defaults[effectName] };
        } catch (e) {
            SFX.settings[effectName] = { ...SFX.defaults[effectName] };
        }

        if (effectName === 'eq32') {
            SFX.settings[effectName] = safeNormalizeEq32Settings(SFX.settings[effectName]);
        }
    }
    return SFX.settings[effectName];
}

function saveSettings(effectName, settings) {
    SFX.settings[effectName] = settings;
    try {
        localStorage.setItem(`aurivo_sfx_${effectName}`, JSON.stringify(settings));
    } catch (e) {
        console.error('Ayarlar kaydedilemedi:', e);
    }
}

function loadAllSettings(effectNames) {
    const names = Array.isArray(effectNames) && effectNames.length > 0
        ? effectNames
        : Object.keys(SFX.defaults);
    names.forEach(effectName => {
        if (SFX.defaults[effectName]) getSettings(effectName);
    });
}

function syncStartupEffectsState() {
    try {
        // Panel açılmasa bile kayıtlı efekt ayarlarını native DSP'ye uygula.
        const effectOrder = [
            'eq32', 'reverb', 'compressor', 'limiter', 'bassboost',
            'noisegate', 'deesser', 'exciter', 'stereowidener',
            'echo', 'softecho', 'convreverb', 'peq', 'autogain', 'truepeak',
            'crossfeed', 'surround', 'bassmono', 'dynamiceq', 'tapesat', 'bitdither'
        ];
        effectOrder.forEach((effectName) => applyEffect(effectName));
        console.log('[SFX INIT] Startup sync applied for all effects');
    } catch (e) {
        console.warn('[SFX INIT] Startup sync failed:', e?.message || e);
    }
}

function updateEffectParam(effectName, param, value) {
    const settings = getSettings(effectName);

    // Special handling for PEQ bands (e.g., param "band0_freq")
    if (effectName === 'peq' && param.startsWith('band')) {
        const parts = param.split('_'); // ["band0", "freq"]
        const bandIndex = parseInt(parts[0].replace('band', ''));
        const bandParam = parts[1]; // "freq", "gain", "q"

        if (settings.bands && settings.bands[bandIndex]) {
            settings.bands[bandIndex][bandParam] = value;
        }
    } else {
        settings[param] = value;
    }

    saveSettings(effectName, settings);

    if (effectName === 'eq32') {
        schedulePersistEq32ToAppSettings(settings);
    }

    const ipcAudio = window.aurivo?.ipcAudio;
    if (!ipcAudio) return;

    // Parametre bazlı direkt IPC çağrısı
    if (effectName === 'eq32') {
        switch (param) {
            case 'bass':
                ipcAudio.module?.setBass(value);
                break;
            case 'mid':
                ipcAudio.module?.setMid(value);
                break;
            case 'treble':
                ipcAudio.module?.setTreble(value);
                break;
            case 'stereoExpander':
                ipcAudio.module?.setStereoExpander(value);
                break;
            case 'balance': // balance slider
                ipcAudio.balance.set(value);
                break;
        }
    } else if (effectName === 'compressor') {
        const comp = ipcAudio.compressor;
        if (comp) {
            if (param === 'threshold' && typeof comp.setThreshold === 'function') {
                comp.setThreshold(value);
                return;
            }
            if (param === 'ratio' && typeof comp.setRatio === 'function') {
                comp.setRatio(value);
                return;
            }
            if (param === 'attack' && typeof comp.setAttack === 'function') {
                comp.setAttack(value);
                return;
            }
            if (param === 'release' && typeof comp.setRelease === 'function') {
                comp.setRelease(value);
                return;
            }
            if (param === 'makeupGain' && typeof comp.setMakeupGain === 'function') {
                comp.setMakeupGain(value);
                return;
            }
            if (param === 'knee' && typeof comp.setKnee === 'function') {
                comp.setKnee(value);
                return;
            }
        }
    } else if (effectName === 'convreverb') {
        // Conv reverb için update
        // Parametreler: mix, predelay, preset
        // IPC tarafında henüz tam destek yoksa genele bırak
        applyEffect(effectName);
    } else if (effectName === 'peq') {
        // PEQ band parametreleri için anlık güncelleme
        if (param.startsWith('band')) {
            const parts = param.split('_'); // ["band0", "freq"]
            const bandIndex = parseInt(parts[0].replace('band', ''));
            const band = settings.bands[bandIndex];

            if (band && ipcAudio.peq) {
                // Her knob değişiminde bandı güncelle
                ipcAudio.peq.setBand(bandIndex, band.freq, band.gain, band.q, settings.enabled);
                console.log(`[PEQ] Band ${bandIndex + 1} güncellendi:`, band);
            }
        }
    } else if (effectName === 'autogain') {
        // Auto Gain parametreleri için anlık güncelleme
        if (ipcAudio.autoGain) {
            switch (param) {
                case 'targetLevel':
                    ipcAudio.autoGain.setTarget?.(value);
                    console.log(`[AUTO GAIN] Target Level: ${value} dBFS`);
                    break;
                case 'maxGain':
                    ipcAudio.autoGain.setMaxGain?.(value);
                    console.log(`[AUTO GAIN] Max Gain: ${value} dB`);
                    break;
            }
        }
    } else if (effectName === 'softecho') {
        if (ipcAudio.softEcho) {
            if (!settings.enabled && param !== 'enabled') {
                settings.enabled = true;
                saveSettings('softecho', settings);
                const toggle = document.getElementById('softechoEnabled');
                if (toggle) toggle.checked = true;
                ipcAudio.softEcho.enable?.(true);
            }
            switch (param) {
                case 'delay':
                    ipcAudio.softEcho.setDelay?.(value);
                    break;
                case 'feedback':
                    ipcAudio.softEcho.setFeedback?.(value);
                    break;
                case 'wetMix':
                    ipcAudio.softEcho.setWetMix?.(value);
                    break;
                case 'highCut':
                    ipcAudio.softEcho.setHighCut?.(value);
                    break;
            }
        }
    } else if (effectName === 'truepeak') {
        // True Peak Limiter parametreleri için anlık güncelleme
        if (ipcAudio.truePeakLimiter) {
            switch (param) {
                case 'ceiling':
                    ipcAudio.truePeakLimiter.setCeiling?.(value);
                    console.log(`[TRUE PEAK] Ceiling: ${value} dBTP`);
                    break;
                case 'release':
                    ipcAudio.truePeakLimiter.setRelease?.(value);
                    console.log(`[TRUE PEAK] Release: ${value} ms`);
                    break;
                case 'lookahead':
                    ipcAudio.truePeakLimiter.setLookahead?.(value);
                    console.log(`[TRUE PEAK] Lookahead: ${value} ms`);
                    break;
                case 'drive':
                    ipcAudio.truePeakLimiter.setInputGain?.(value);
                    console.log(`[TRUE PEAK] Drive: ${value} dB`);
                    break;
            }
        }
    } else if (effectName === 'crossfeed') {
        // Crossfeed parametreleri için anlık güncelleme
        if (ipcAudio.crossfeed) {
            if (!settings.enabled) {
                settings.enabled = true;
                saveSettings('crossfeed', settings);
                const toggle = document.getElementById('crossfeedEnabled');
                if (toggle) toggle.checked = true;
                ipcAudio.crossfeed.enable?.(true);
            }
            switch (param) {
                case 'level':
                    ipcAudio.crossfeed.setLevel?.(value);
                    console.log(`[CROSSFEED] Level: ${value}%`);
                    updateCrossfeedVisual();
                    break;
                case 'delay':
                    ipcAudio.crossfeed.setDelay?.(value);
                    console.log(`[CROSSFEED] Delay: ${value} ms`);
                    updateCrossfeedVisual();
                    break;
                case 'lowCut':
                    ipcAudio.crossfeed.setLowCut?.(value);
                    console.log(`[CROSSFEED] Low Cut: ${value} Hz`);
                    break;
                case 'highCut':
                    ipcAudio.crossfeed.setHighCut?.(value);
                    console.log(`[CROSSFEED] High Cut: ${value} Hz`);
                    break;
            }
        }
    } else if (effectName === 'surround') {
        if (ipcAudio.surround) {
            if (!settings.enabled && param !== 'enabled') {
                settings.enabled = true;
                saveSettings('surround', settings);
                const toggle = document.getElementById('surroundEnabled');
                if (toggle) toggle.checked = true;
                ipcAudio.surround.enable?.(true);
            }
            switch (param) {
                case 'center':
                    ipcAudio.surround.setCenter?.(value);
                    break;
                case 'surround':
                    ipcAudio.surround.setSurround?.(value);
                    break;
                case 'lfe':
                    ipcAudio.surround.setLfe?.(value);
                    break;
                case 'crossover':
                    ipcAudio.surround.setCrossover?.(value);
                    break;
                case 'delay':
                    ipcAudio.surround.setDelay?.(value);
                    break;
                case 'mix':
                    ipcAudio.surround.setMix?.(value);
                    break;
            }
        }
    } else if (effectName === 'dynamiceq') {
        // Dynamic EQ parametreleri için anlık güncelleme
        if (ipcAudio.dynamicEQ) {
            if (!settings.enabled && param !== 'enabled') {
                settings.enabled = true;
                saveSettings('dynamiceq', settings);
                const toggle = document.getElementById('dynamiceqEnabled');
                if (toggle) toggle.checked = true;
                ipcAudio.dynamicEQ.enable?.(true);
            }
            switch (param) {
                case 'frequency':
                    ipcAudio.dynamicEQ.setFrequency?.(value);
                    break;
                case 'q':
                    ipcAudio.dynamicEQ.setQ?.(value);
                    break;
                case 'threshold':
                    ipcAudio.dynamicEQ.setThreshold?.(value);
                    break;
                case 'gain':
                    ipcAudio.dynamicEQ.setGain?.(value); // Note: param is 'gain' in JS, calling setGain
                    break;
                case 'range':
                    ipcAudio.dynamicEQ.setRange?.(value);
                    break;
                case 'attack':
                    ipcAudio.dynamicEQ.setAttack?.(value);
                    break;
                case 'release':
                    ipcAudio.dynamicEQ.setRelease?.(value);
                    break;
            }
            console.log(`[DYNAMIC EQ] ${param}: ${value}`);
        }
    } else if (effectName === 'bassmono') {
        // Bass Mono parametreleri için anlık güncelleme
        if (ipcAudio.bassMono) {
            if (!settings.enabled && param !== 'enabled') {
                settings.enabled = true;
                saveSettings('bassmono', settings);
                const toggle = document.getElementById('bassmonoEnabled');
                if (toggle) toggle.checked = true;
                ipcAudio.bassMono.enable?.(true);
            }
            switch (param) {
                case 'cutoff':
                    ipcAudio.bassMono.setCutoff?.(value);
                    console.log(`[BASS MONO] Cutoff: ${value} Hz`);
                    break;
                case 'stereoWidth':
                    ipcAudio.bassMono.setStereoWidth?.(value);
                    console.log(`[BASS MONO] Stereo Width: ${value}%`);
                    break;
            }
            updateBassMonoVisual();
        }
    } else {
        // Diğer efektler için genel uygulama
        applyEffect(effectName);
    }
}

// ============================================
// APPLY & RESET EFFECTS
// ============================================
function applyEffect(effectName) {
    const settings = getSettings(effectName);
    const ipcAudio = window.aurivo?.ipcAudio;

    if (!ipcAudio) {
        console.warn('IPC Audio API mevcut değil');
        return;
    }
    
    // Native audio mevcut değilse uyarı
    const isNativeAudioAvailable = window.aurivo?.audio?.isNativeAvailable?.();
    if (!isNativeAudioAvailable) {
        console.warn(`[SFX] Native audio unavailable - effect "${effectName}" cannot be applied`);
        return;
    }

    switch (effectName) {
        case 'eq32':
            // 32-Band EQ bantlarını uygula
            if (ipcAudio.eq) {
                const gains = normalize32Bands(settings.bands);
                if (typeof ipcAudio.eq.setAllBands === 'function') {
                    ipcAudio.eq.setAllBands(gains);
                } else {
                    gains.forEach((val, i) => {
                        ipcAudio.eq.setBand(i, val);
                    });
                }
            }
            // Balance uygula
            if (ipcAudio.balance) {
                ipcAudio.balance.set(settings.balance);
            }
            // Aurivo Module (Bass, Mid, Treble, Stereo)
            if (ipcAudio.module) {
                ipcAudio.module.setBass(settings.bass);
                ipcAudio.module.setMid(settings.mid);
                ipcAudio.module.setTreble(settings.treble);
                ipcAudio.module.setStereoExpander(settings.stereoExpander);
            }
            break;

        case 'peq':
            console.log('[PEQ UI] Applying PEQ, settings:', settings);
            if (ipcAudio.peq && settings.bands) {
                settings.bands.forEach((band, i) => {
                    // enabled flag her banda gönderiliyor
                    ipcAudio.peq.setBand(i, band.freq, band.gain, band.q, settings.enabled);
                    console.log(`[PEQ] Band ${i + 1}: ${band.freq} Hz, ${band.gain} dB, Q=${band.q}, enabled=${settings.enabled}`);
                });
            }
            break;


        case 'reverb':
            if (ipcAudio.reverb) {
                ipcAudio.reverb.setEnabled(settings.enabled);
                if (settings.enabled) {
                    ipcAudio.reverb.setRoomSize(settings.roomSize);
                    ipcAudio.reverb.setDamping(settings.damping);
                    ipcAudio.reverb.setWetDry(settings.wetDry);
                    ipcAudio.reverb.setHFRatio(settings.hfRatio);
                    ipcAudio.reverb.setInputGain(settings.inputGain);
                }
            }
            break;

        case 'compressor':
            if (ipcAudio.compressor) {
                if (typeof ipcAudio.compressor.enable === 'function') {
                    ipcAudio.compressor.enable(settings.enabled);
                    if (settings.enabled) {
                        ipcAudio.compressor.setThreshold?.(settings.threshold);
                        ipcAudio.compressor.setRatio?.(settings.ratio);
                        ipcAudio.compressor.setAttack?.(settings.attack);
                        ipcAudio.compressor.setRelease?.(settings.release);
                        ipcAudio.compressor.setMakeupGain?.(settings.makeupGain);
                        ipcAudio.compressor.setKnee?.(settings.knee);
                    }
                } else if (typeof ipcAudio.compressor.set === 'function') {
                    // enabled, thresh, ratio, att, rel, makeup
                    ipcAudio.compressor.set(
                        settings.enabled,
                        settings.threshold,
                        settings.ratio,
                        settings.attack,
                        settings.release,
                        settings.makeupGain
                    );
                }
            }
            break;

        case 'noisegate':
            // Noise Gate: threshold, attack, hold, release, range
            if (ipcAudio.noiseGate) {
                if (typeof ipcAudio.noiseGate.enable === 'function') {
                    ipcAudio.noiseGate.enable(settings.enabled);
                    if (settings.enabled) {
                        ipcAudio.noiseGate.setThreshold?.(settings.threshold);
                        ipcAudio.noiseGate.setAttack?.(settings.attack);
                        ipcAudio.noiseGate.setHold?.(settings.hold);
                        ipcAudio.noiseGate.setRelease?.(settings.release);
                        ipcAudio.noiseGate.setRange?.(settings.range);
                    }
                }
            } else if (ipcAudio.gate) {
                // Fallback: eski gate API
                ipcAudio.gate.set(settings.enabled, settings.threshold, settings.attack, settings.release);
            }
            break;

        case 'limiter':
            // Limiter: ceiling, release, lookahead, gain
            if (ipcAudio.limiter) {
                if (typeof ipcAudio.limiter.enable === 'function') {
                    ipcAudio.limiter.enable(settings.enabled);
                    if (settings.enabled) {
                        ipcAudio.limiter.setCeiling?.(settings.ceiling);
                        ipcAudio.limiter.setRelease?.(settings.release);
                        ipcAudio.limiter.setLookahead?.(settings.lookahead);
                        ipcAudio.limiter.setGain?.(settings.gain);
                    }
                } else if (typeof ipcAudio.limiter.set === 'function') {
                    // Fallback: set(enabled, ceiling, release)
                    ipcAudio.limiter.set(settings.enabled, settings.ceiling, settings.release);
                }
            }
            break;

        case 'echo':
            console.log('[ECHO UI] Applying echo, settings:', settings);
            console.log('[ECHO UI] ipcAudio.echo:', ipcAudio.echo);
            if (ipcAudio.echo) {
                if (typeof ipcAudio.echo.enable === 'function') {
                    console.log('[ECHO] Enabling:', settings.enabled);
                    ipcAudio.echo.enable(settings.enabled);
                    if (settings.enabled && ipcAudio.softEcho?.enable) {
                        ipcAudio.softEcho.enable(false);
                        const soft = getSettings('softecho');
                        if (soft.enabled) {
                            soft.enabled = false;
                            saveSettings('softecho', soft);
                            const softCb = document.getElementById('softechoEnabled');
                            if (softCb) softCb.checked = false;
                        }
                    }
                    if (settings.enabled) {
                        ipcAudio.echo.setDelay?.(settings.delay || 250);
                        ipcAudio.echo.setFeedback?.(settings.feedback || 30);
                        ipcAudio.echo.setWetMix?.(settings.wetMix !== undefined ? settings.wetMix : settings.wetDry || 50);
                        ipcAudio.echo.setDryMix?.(settings.dryMix !== undefined ? settings.dryMix : 100);
                        ipcAudio.echo.setStereoMode?.(settings.stereo || settings.pingPong || false);
                        ipcAudio.echo.setLowCut?.(settings.lowCut || 80);
                        ipcAudio.echo.setHighCut?.(settings.highCut || 8000);
                        console.log('[ECHO] Applied - Delay:', settings.delay, 'Feedback:', settings.feedback, 'WetMix:', settings.wetMix);
                    }
                } else if (typeof ipcAudio.echo.set === 'function') {
                    // Fallback: eski API - set(enabled, delay, feedback, mix)
                    ipcAudio.echo.set(settings.enabled, settings.delay, settings.feedback / 100.0, settings.wetDry / 100.0);
                } else {
                    console.warn('[ECHO UI] enable function not found!');
                }
            } else {
                console.warn('[ECHO UI] ipcAudio.echo is undefined!');
            }
            break;

        case 'softecho':
            console.log('[SOFT ECHO UI] Applying softecho, settings:', settings);
            if (ipcAudio.softEcho) {
                ipcAudio.softEcho.enable?.(settings.enabled);
                if (settings.enabled) {
                    // Aynı DSP slotunu kullanan normal Echo'yu devre dışı bırak
                    ipcAudio.echo?.enable?.(false);
                    const classicEcho = getSettings('echo');
                    if (classicEcho.enabled) {
                        classicEcho.enabled = false;
                        saveSettings('echo', classicEcho);
                        const echoCb = document.getElementById('echoEnabled');
                        if (echoCb) echoCb.checked = false;
                    }
                    ipcAudio.softEcho.setDelay?.(settings.delay || 220);
                    ipcAudio.softEcho.setFeedback?.(settings.feedback || 22);
                    ipcAudio.softEcho.setWetMix?.(settings.wetMix || 18);
                    ipcAudio.softEcho.setDryMix?.(100);
                    ipcAudio.softEcho.setHighCut?.(settings.highCut || 7000);
                    ipcAudio.softEcho.setStereoMode?.(settings.stereo || false);
                }
            } else {
                console.warn('[SOFT ECHO UI] ipcAudio.softEcho is undefined!');
            }
            break;

        case 'bassboost':
            // Yeni DSP Bass Boost: gain, frequency
            if (ipcAudio.bassBoostDsp) {
                ipcAudio.bassBoostDsp.set(settings.enabled, settings.gain, settings.frequency);
            } else if (ipcAudio.module) {
                // Fallback (eski modül)
                ipcAudio.module.setBass(settings.enabled ? settings.gain : 0);
            }
            break;

        case 'stereowidener':
            console.log('[STEREO WIDENER UI] Applying stereo widener, settings:', settings);
            console.log('[STEREO WIDENER UI] ipcAudio.stereoWidener:', ipcAudio.stereoWidener);
            if (ipcAudio.stereoWidener) {
                if (typeof ipcAudio.stereoWidener.enable === 'function') {
                    console.log('[STEREO WIDENER] Enabling:', settings.enabled);
                    ipcAudio.stereoWidener.enable(settings.enabled);
                    if (settings.enabled) {
                        ipcAudio.stereoWidener.setWidth?.(settings.width);
                        ipcAudio.stereoWidener.setBassCutoff?.(settings.bassToMono || settings.bassFreq || 120);
                        ipcAudio.stereoWidener.setDelay?.(settings.delay || 0);
                        ipcAudio.stereoWidener.setBalance?.(settings.balance || 0);
                        ipcAudio.stereoWidener.setMonoLow?.(settings.monoLow !== false);
                        console.log('[STEREO WIDENER] Applied - Width:', settings.width, 'Bass:', settings.bassToMono);
                    }
                } else {
                    console.warn('[STEREO WIDENER UI] enable function not found!');
                }
            } else if (ipcAudio.module) {
                // Fallback (eski modül)
                ipcAudio.module.setStereoExpander(settings.enabled ? settings.width : 100);
            } else {
                console.warn('[STEREO WIDENER UI] ipcAudio.stereoWidener is undefined!');
            }
            break;

        case 'convolution-reverb':
        case 'convolutionreverb':
            console.log('[CONV REVERB UI] Applying convolution reverb, settings:', settings);
            console.log('[CONV REVERB UI] ipcAudio.convolutionReverb:', ipcAudio.convolutionReverb);
            if (ipcAudio.convolutionReverb) {
                if (typeof ipcAudio.convolutionReverb.enable === 'function') {
                    console.log('[CONV REVERB] Enabling:', settings.enabled);
                    ipcAudio.convolutionReverb.enable(settings.enabled);
                    if (settings.enabled) {
                        ipcAudio.convolutionReverb.setRoomSize?.(settings.roomSize || 50);
                        ipcAudio.convolutionReverb.setDecay?.(settings.decay || 1.5);
                        ipcAudio.convolutionReverb.setDamping?.(settings.damping || 0.5);
                        ipcAudio.convolutionReverb.setWetMix?.(settings.wetMix !== undefined ? settings.wetMix : settings.wetDry || 30);
                        ipcAudio.convolutionReverb.setDryMix?.(settings.dryMix !== undefined ? settings.dryMix : 100);
                        ipcAudio.convolutionReverb.setPreDelay?.(settings.preDelay || 0);
                        if (settings.roomType !== undefined) {
                            ipcAudio.convolutionReverb.setRoomType?.(settings.roomType);
                        }
                        console.log('[CONV REVERB] Applied - Room:', settings.roomSize, 'Decay:', settings.decay, 'Wet:', settings.wetMix);
                    }
                } else {
                    console.warn('[CONV REVERB UI] enable function not found!');
                }
            } else {
                console.warn('[CONV REVERB UI] ipcAudio.convolutionReverb is undefined!');
            }
            break;

        case 'bass-enhancer':
            // Bass Enhancer: frequency, gain, harmonics, width, dryWet
            if (ipcAudio.bassEnhancer) {
                if (typeof ipcAudio.bassEnhancer.enable === 'function') {
                    ipcAudio.bassEnhancer.enable(settings.enabled);
                    if (settings.enabled) {
                        ipcAudio.bassEnhancer.setFrequency?.(settings.frequency);
                        ipcAudio.bassEnhancer.setGain?.(settings.gain);
                        ipcAudio.bassEnhancer.setHarmonics?.(settings.harmonics);
                        ipcAudio.bassEnhancer.setWidth?.(settings.width);
                        ipcAudio.bassEnhancer.setMix?.(settings.dryWet);
                    }
                }
            }
            break;

        case 'deesser':
            // De-esser: frequency, threshold, ratio, range, listenMode
            console.log('[DE-ESSER UI] Applying deesser, settings:', settings);
            console.log('[DE-ESSER UI] ipcAudio.deEsser:', ipcAudio.deEsser);
            if (ipcAudio.deEsser) {
                if (typeof ipcAudio.deEsser.enable === 'function') {
                    console.log('[DE-ESSER UI] Calling enable:', settings.enabled);
                    ipcAudio.deEsser.enable(settings.enabled);
                    if (settings.enabled) {
                        console.log('[DE-ESSER UI] Setting params - freq:', settings.frequency, 'thresh:', settings.threshold, 'ratio:', settings.ratio, 'range:', settings.range);
                        ipcAudio.deEsser.setFrequency?.(settings.frequency);
                        ipcAudio.deEsser.setThreshold?.(settings.threshold);
                        ipcAudio.deEsser.setRatio?.(settings.ratio);
                        ipcAudio.deEsser.setRange?.(settings.range);
                        ipcAudio.deEsser.setListenMode?.(settings.listenMode || false);
                    }
                } else {
                    console.warn('[DE-ESSER UI] enable function not found!');
                }
            } else {
                console.warn('[DE-ESSER UI] ipcAudio.deEsser is undefined!');
            }
            break;

        case 'exciter':
            console.log('[EXCITER UI] Applying exciter, settings:', settings);
            console.log('[EXCITER UI] ipcAudio.exciter:', ipcAudio.exciter);
            if (ipcAudio.exciter) {
                if (typeof ipcAudio.exciter.enable === 'function') {
                    console.log('[EXCITER] Enabling:', settings.enabled);
                    ipcAudio.exciter.enable(settings.enabled);
                    if (settings.enabled) {
                        // Type dönüşümü: 'odd', 'even', 'tape', 'tube' -> 0, 1, 2, 3
                        let typeValue = 0;
                        if (settings.harmonics === 'odd' || settings.type === 0) typeValue = 0;
                        else if (settings.harmonics === 'even' || settings.type === 1) typeValue = 1;
                        else if (settings.harmonics === 'tape' || settings.type === 2) typeValue = 2;
                        else if (settings.harmonics === 'tube' || settings.type === 3) typeValue = 3;

                        ipcAudio.exciter.setAmount?.(settings.amount);
                        ipcAudio.exciter.setFrequency?.(settings.frequency);
                        ipcAudio.exciter.setHarmonics?.(settings.amount); // harmonics = amount based
                        ipcAudio.exciter.setMix?.(settings.mix);
                        ipcAudio.exciter.setType?.(typeValue);
                        console.log('[EXCITER] Applied - Amount:', settings.amount, 'Freq:', settings.frequency, 'Mix:', settings.mix, 'Type:', typeValue);
                    }
                } else {
                    console.warn('[EXCITER UI] enable function not found!');
                }
            } else {
                console.warn('[EXCITER UI] ipcAudio.exciter is undefined!');
            }
            break;

        case 'convreverb':
            console.log('[CONV REVERB UI] Applying convreverb, settings:', settings);
            console.log('[CONV REVERB UI] ipcAudio.convolutionReverb:', ipcAudio.convolutionReverb);
            if (ipcAudio.convolutionReverb) {
                if (typeof ipcAudio.convolutionReverb.enable === 'function') {
                    console.log('[CONV REVERB] Enabling:', settings.enabled);
                    ipcAudio.convolutionReverb.enable(settings.enabled);
                    if (settings.enabled) {
                        // Mix değerini wetMix olarak gönder (UI'da "mix" parametresi var)
                        const wetMixValue = settings.mix !== undefined ? settings.mix : (settings.wetMix !== undefined ? settings.wetMix : 50);
                        const preDelayValue = settings.predelay !== undefined ? settings.predelay : (settings.preDelay !== undefined ? settings.preDelay : 0);

                        ipcAudio.convolutionReverb.setWetMix?.(wetMixValue);
                        ipcAudio.convolutionReverb.setPreDelay?.(preDelayValue);
                        ipcAudio.convolutionReverb.setRoomSize?.(settings.roomSize || 50);
                        ipcAudio.convolutionReverb.setDecay?.(settings.decay || 1.5);
                        ipcAudio.convolutionReverb.setDamping?.(settings.damping || 0.5);
                        ipcAudio.convolutionReverb.setDryMix?.(settings.dryMix !== undefined ? settings.dryMix : 100);

                        if (settings.roomType !== undefined) {
                            ipcAudio.convolutionReverb.setRoomType?.(settings.roomType);
                        }
                        console.log('[CONV REVERB] Applied - Wet:', wetMixValue, 'PreDelay:', preDelayValue);
                    }
                } else {
                    console.warn('[CONV REVERB UI] enable function not found!');
                }
            } else {
                console.warn('[CONV REVERB UI] ipcAudio.convolutionReverb is undefined!');
            }
            break;

        case 'autogain':
            console.log('[AUTO GAIN UI] Applying autogain, settings:', settings);

            // Önceki timer'ı temizle
            if (SFX.autoGainInterval) {
                clearInterval(SFX.autoGainInterval);
                SFX.autoGainInterval = null;
            }

            if (ipcAudio.autoGain) {
                // Enable/Disable
                if (typeof ipcAudio.autoGain.setEnabled === 'function') {
                    ipcAudio.autoGain.setEnabled(settings.enabled);
                    console.log('[AUTO GAIN] setEnabled called with:', settings.enabled);
                }

                if (settings.enabled) {
                    // Target Level
                    if (typeof ipcAudio.autoGain.setTarget === 'function') {
                        ipcAudio.autoGain.setTarget(settings.targetLevel);
                    }

                    // Max Gain
                    if (typeof ipcAudio.autoGain.setMaxGain === 'function') {
                        ipcAudio.autoGain.setMaxGain(settings.maxGain);
                    }

                    // Periyodik güncelleme başlat (her 100ms)
                    SFX.autoGainInterval = setInterval(() => {
                        if (ipcAudio.autoGain && typeof ipcAudio.autoGain.update === 'function') {
                            ipcAudio.autoGain.update();
                        }
                    }, 100);

                    console.log('[AUTO GAIN] Timer started - Target:', settings.targetLevel, 'MaxGain:', settings.maxGain);
                } else {
                    // Devre dışı bırakıldığında volume'u sıfırla
                    if (typeof ipcAudio.autoGain.reset === 'function') {
                        ipcAudio.autoGain.reset();
                    }
                    console.log('[AUTO GAIN] Disabled and reset');
                }
            } else {
                console.warn('[AUTO GAIN UI] ipcAudio.autoGain is undefined!');
            }
            break;

        case 'truepeak':
            console.log('[TRUE PEAK UI] Applying truepeak, settings:', settings);
            if (ipcAudio.truePeakLimiter) {
                // Enable/Disable
                if (typeof ipcAudio.truePeakLimiter.setEnabled === 'function') {
                    ipcAudio.truePeakLimiter.setEnabled(settings.enabled);
                    console.log('[TRUE PEAK] setEnabled called with:', settings.enabled);
                }

                if (settings.enabled) {
                    // Ceiling
                    if (typeof ipcAudio.truePeakLimiter.setCeiling === 'function') {
                        ipcAudio.truePeakLimiter.setCeiling(settings.ceiling);
                    }

                    // Release
                    if (typeof ipcAudio.truePeakLimiter.setRelease === 'function') {
                        ipcAudio.truePeakLimiter.setRelease(settings.release);
                    }

                    // Lookahead
                    if (typeof ipcAudio.truePeakLimiter.setLookahead === 'function') {
                        ipcAudio.truePeakLimiter.setLookahead(settings.lookahead || 5);
                    }

                    // Input Drive
                    if (typeof ipcAudio.truePeakLimiter.setInputGain === 'function') {
                        ipcAudio.truePeakLimiter.setInputGain(settings.drive || 0);
                    }

                    // Oversampling
                    if (typeof ipcAudio.truePeakLimiter.setOversampling === 'function') {
                        ipcAudio.truePeakLimiter.setOversampling(settings.oversampling || 4);
                    }

                    // Link Channels
                    if (typeof ipcAudio.truePeakLimiter.setLinkChannels === 'function') {
                        ipcAudio.truePeakLimiter.setLinkChannels(settings.linkChannels !== false);
                    }

                    console.log('[TRUE PEAK] Applied - Ceiling:', settings.ceiling, 'Release:', settings.release);
                } else {
                    // Devre dışı bırakıldığında reset
                    if (typeof ipcAudio.truePeakLimiter.reset === 'function') {
                        ipcAudio.truePeakLimiter.reset();
                    }
                    console.log('[TRUE PEAK] Disabled');
                }
            } else {
                console.warn('[TRUE PEAK UI] ipcAudio.truePeakLimiter is undefined!');
            }
            break;

        case 'crossfeed':
            console.log('[CROSSFEED UI] Applying crossfeed, settings:', settings);
            if (ipcAudio.crossfeed) {
                // Enable/Disable
                if (typeof ipcAudio.crossfeed.enable === 'function') {
                    ipcAudio.crossfeed.enable(settings.enabled);
                    console.log('[CROSSFEED] setEnabled called with:', settings.enabled);
                }

                if (settings.enabled) {
                    // Level
                    if (typeof ipcAudio.crossfeed.setLevel === 'function') {
                        ipcAudio.crossfeed.setLevel(settings.level);
                    }

                    // Delay
                    if (typeof ipcAudio.crossfeed.setDelay === 'function') {
                        ipcAudio.crossfeed.setDelay(settings.delay);
                    }

                    // Low Cut
                    if (typeof ipcAudio.crossfeed.setLowCut === 'function') {
                        ipcAudio.crossfeed.setLowCut(settings.lowCut);
                    }

                    // High Cut
                    if (typeof ipcAudio.crossfeed.setHighCut === 'function') {
                        ipcAudio.crossfeed.setHighCut(settings.highCut);
                    }

                    console.log('[CROSSFEED] Applied - Level:', settings.level, 'Delay:', settings.delay);
                } else {
                    // Devre dışı bırakıldığında reset
                    if (typeof ipcAudio.crossfeed.reset === 'function') {
                        ipcAudio.crossfeed.reset();
                    }
                    console.log('[CROSSFEED] Disabled');
                }

                // Visualization güncelle
                updateCrossfeedVisual();
            } else {
                console.warn('[CROSSFEED UI] ipcAudio.crossfeed is undefined!');
            }
            break;

        case 'surround':
            console.log('[SURROUND UI] Applying surround, settings:', settings);
            if (ipcAudio.surround) {
                ipcAudio.surround.enable?.(settings.enabled);
                if (settings.enabled) {
                    ipcAudio.surround.setCenter?.(settings.center);
                    ipcAudio.surround.setSurround?.(settings.surround);
                    ipcAudio.surround.setLfe?.(settings.lfe);
                    ipcAudio.surround.setCrossover?.(settings.crossover);
                    ipcAudio.surround.setDelay?.(settings.delay);
                    ipcAudio.surround.setMix?.(settings.mix);
                } else {
                    ipcAudio.surround.reset?.();
                }
            } else {
                console.warn('[SURROUND UI] ipcAudio.surround is undefined!');
            }
            break;

        case 'bassmono':
            console.log('[BASS MONO UI] Applying bass mono, settings:', settings);
            if (ipcAudio.bassMono) {
                // Enable/Disable
                if (typeof ipcAudio.bassMono.enable === 'function') {
                    ipcAudio.bassMono.enable(settings.enabled);
                    console.log('[BASS MONO] setEnabled called with:', settings.enabled);
                }

                if (settings.enabled) {
                    // Cutoff
                    if (typeof ipcAudio.bassMono.setCutoff === 'function') {
                        ipcAudio.bassMono.setCutoff(settings.cutoff);
                    }

                    // Slope
                    if (typeof ipcAudio.bassMono.setSlope === 'function') {
                        ipcAudio.bassMono.setSlope(settings.slope);
                    }

                    // Stereo Width
                    if (typeof ipcAudio.bassMono.setStereoWidth === 'function') {
                        ipcAudio.bassMono.setStereoWidth(settings.stereoWidth);
                    }

                    console.log('[BASS MONO] Applied - Cutoff:', settings.cutoff, 'Slope:', settings.slope, 'Width:', settings.stereoWidth);
                } else {
                    // Devre dışı bırakıldığında reset
                    if (typeof ipcAudio.bassMono.reset === 'function') {
                        ipcAudio.bassMono.reset();
                    }
                    console.log('[BASS MONO] Disabled');
                }

                // Visualization güncelle
                updateBassMonoVisual();
            } else {
                console.warn('[BASS MONO UI] ipcAudio.bassMono is undefined!');
            }
            break;

        case 'dynamiceq':
            console.log('[DYNAMIC EQ UI] Applying dynamic EQ, settings:', settings);
            if (ipcAudio.dynamicEQ) {
                if (typeof ipcAudio.dynamicEQ.enable === 'function') {
                    ipcAudio.dynamicEQ.enable(settings.enabled);
                }

                if (settings.enabled) {
                    if (typeof ipcAudio.dynamicEQ.setFrequency === 'function') {
                        ipcAudio.dynamicEQ.setFrequency(settings.frequency);
                    }
                    if (typeof ipcAudio.dynamicEQ.setQ === 'function') {
                        ipcAudio.dynamicEQ.setQ(settings.q);
                    }
                    if (typeof ipcAudio.dynamicEQ.setThreshold === 'function') {
                        ipcAudio.dynamicEQ.setThreshold(settings.threshold);
                    }
                    if (typeof ipcAudio.dynamicEQ.setGain === 'function') {
                        ipcAudio.dynamicEQ.setGain(settings.gain);
                    }
                    if (typeof ipcAudio.dynamicEQ.setRange === 'function') {
                        ipcAudio.dynamicEQ.setRange(settings.range);
                    }
                    if (typeof ipcAudio.dynamicEQ.setAttack === 'function') {
                        ipcAudio.dynamicEQ.setAttack(settings.attack);
                    }
                    if (typeof ipcAudio.dynamicEQ.setRelease === 'function') {
                        ipcAudio.dynamicEQ.setRelease(settings.release);
                    }
                    console.log('[DYNAMIC EQ] Applied - Freq:', settings.frequency, 'Q:', settings.q, 'Threshold:', settings.threshold, 'Gain:', settings.gain);
                }
            } else {
                console.warn('[DYNAMIC EQ UI] ipcAudio.dynamicEQ is undefined!');
            }
            break;

        case 'tapesat':
            // Tape Saturation: driveDb, mix, tone, outputDb, mode, hiss
            if (window.aurivo?.audio?.tapeSat) {
                const ts = window.aurivo.audio.tapeSat;
                ts.enable(settings.enabled);
                ts.setDrive(settings.driveDb);
                ts.setMix(settings.mix);
                ts.setTone(settings.tone);
                ts.setOutput(settings.outputDb);
                ts.setMode(settings.mode);
                ts.setHiss(settings.hiss);
                console.log('[TAPE SAT] Applied - Drive:', settings.driveDb, 'Mode:', settings.mode);
            }
            break;

        case 'bitdither':
            // Bit Depth / Dither: bitDepth, dither, shaping, downsample, mix, outputDb
            if (window.aurivo?.audio?.bitDither) {
                const bd = window.aurivo.audio.bitDither;
                bd.enable(settings.enabled);
                bd.setBitDepth(parseInt(settings.bitDepth));
                bd.setDither(parseInt(settings.dither));
                bd.setShaping(parseInt(settings.shaping));
                bd.setDownsample(parseInt(settings.downsample));
                bd.setMix(settings.mix);
                bd.setOutput(settings.outputDb);
                console.log('[BIT/DITHER] Applied - Bits:', settings.bitDepth, 'Dither:', settings.dither);
            }
            break;

        default:
            console.log(`${effectName} efekti henüz uygulanmadı`);
    }
}

// UI değerlerini pencereyi yenilemeden güncelle
function updateEffectUIValues(effectName) {
    const settings = getSettings(effectName);
    const defaults = SFX.defaults[effectName];

    // İlgili efektin panelini bul (artık wrapper içinde)
    const wrapper = document.querySelector(`.effect-panel-wrapper[data-effect="${effectName}"]`);
    if (!wrapper) return;

    // Knob'ları güncelle (reverb, compressor vb. için)
    wrapper.querySelectorAll('.knob').forEach(knob => {
        const param = knob.dataset.param;
        if (param && defaults[param] !== undefined) {
            const value = defaults[param];
            const min = parseFloat(knob.dataset.min) || 0;
            const max = parseFloat(knob.dataset.max) || 100;

            knob.dataset.value = value;
            updateKnobIndicator(knob, value, min, max);

            // Knob value label'ını güncelle
            const valueLabel = document.getElementById(`knob${param.charAt(0).toUpperCase() + param.slice(1)}Value`);
            if (valueLabel) {
                // Değer formatını belirle
                if (param === 'damping' || param === 'hfRatio') {
                    valueLabel.textContent = value.toFixed(3);
                } else if (param === 'roomSize') {
                    valueLabel.textContent = `${value} ms`;
                } else if (param === 'wetDry' || param === 'inputGain' || param === 'threshold' || param === 'makeupGain' || param === 'ceiling' || param === 'gain') {
                    valueLabel.textContent = `${value} dB`;
                } else if (param === 'attack' || param === 'release' || param === 'hold' || param === 'delay' || param === 'lookahead' || param === 'predelay') {
                    valueLabel.textContent = `${value} ms`;
                } else if (param === 'ratio') {
                    valueLabel.textContent = `${value}:1`;
                } else if (param === 'frequency') {
                    valueLabel.textContent = `${value} Hz`;
                } else if (param === 'mix' || param === 'amount' || param === 'harmonics' || param === 'feedback' || param === 'width') {
                    valueLabel.textContent = `${value}%`;
                } else {
                    valueLabel.textContent = value;
                }
            }
        }
    });

    // Slider ve range input'ları (varsa)
    wrapper.querySelectorAll('input[type="range"]').forEach(slider => {
        const id = slider.id;
        // ID'den ayar adını çıkart
        const settingName = id.replace(effectName, '').replace(/^[A-Z]/, c => c.toLowerCase());
        if (defaults[settingName] !== undefined) {
            slider.value = defaults[settingName];
            // Değer label'ını da güncelle
            const valueLabel = document.getElementById(`${id}Value`) ||
                slider.parentElement?.querySelector('.slider-value');
            if (valueLabel) {
                valueLabel.textContent = defaults[settingName];
            }
        }
    });

    // Checkbox ve toggle'lar
    wrapper.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
        const id = checkbox.id;
        // ID pattern: reverbEnabled, compressorEnabled vb.
        if (id === `${effectName}Enabled` && defaults.enabled !== undefined) {
            checkbox.checked = defaults.enabled;
        }
    });

    // Select/dropdown'lar
    wrapper.querySelectorAll('select').forEach(select => {
        const id = select.id;
        const settingName = id.replace(effectName, '').replace(/^[A-Z]/, c => c.toLowerCase());
        if (defaults[settingName] !== undefined) {
            select.value = defaults[settingName];
        }
    });
}

function resetEffect(effectName) {
    if (effectName === 'eq32') {
        const settings = getSettings('eq32');
        settings.bands = new Array(32).fill(0);
        settings.lastPreset = {
            filename: '__flat__',
            name: tSync('eqPresets.flatName') || 'Düz (Flat)'
        };
        saveSettings('eq32', settings);

        updateEqPresetButtonLabel();
        // Hazır Ayarlar penceresi tekrar açıldığında seçim "Flat" gelsin
        schedulePersistEq32ToAppSettings(settings);

        // UI'yi tek seferde güncelle (onChange tetikleme yok)
        updateEq32UIFromSettings(settings);

        // Engine + settings.json reset (tek IPC)
        if (window.aurivo?.ipcAudio?.eq?.resetBands) {
            window.aurivo.ipcAudio.eq.resetBands();
        } else {
            applyEffect('eq32');
        }

        if (SFX_EMBEDDED_MODE) {
            postEmbeddedVideoUpdate({ type: 'videoHardReset' });
        }
    } else if (effectName === 'peq') {
        // PEQ Özel Sıfırlama - 6 bant + filter type
        const defaults = {
            enabled: false,
            bands: [
                { freq: 60, gain: 0, q: 1.0, filterType: 1 },     // Low Shelf
                { freq: 150, gain: 0, q: 1.0, filterType: 0 },    // Bell
                { freq: 400, gain: 0, q: 1.0, filterType: 0 },    // Bell
                { freq: 1500, gain: 0, q: 1.0, filterType: 0 },   // Bell
                { freq: 5000, gain: 0, q: 1.0, filterType: 0 },   // Bell
                { freq: 12000, gain: 0, q: 1.0, filterType: 2 }   // High Shelf
            ]
        };
        saveSettings('peq', defaults);

        // UI Update
        const panel = document.getElementById('peqPanel');
        if (panel) {
            const enabledCb = document.getElementById('peqEnabled');
            if (enabledCb) enabledCb.checked = false;

            defaults.bands.forEach((band, index) => {
                const kFreq = SFX.knobInstances[`peq_band${index}_freq`];
                const kGain = SFX.knobInstances[`peq_band${index}_gain`];
                const kQ = SFX.knobInstances[`peq_band${index}_q`];
                if (kFreq) kFreq.setValue(band.freq);
                if (kGain) kGain.setValue(band.gain);
                if (kQ) kQ.setValue(band.q);

                // Filter type dropdown'ını güncelle
                const filterSelect = document.getElementById(`peqBand${index}Type`);
                if (filterSelect) filterSelect.value = band.filterType;
            });
        }

        // Apply (Disable and reset gains)
        updateEffectParam('peq', 'enabled', false);
        // Tüm bantları varsayılan değerlerle güncelle
        if (window.aurivo?.ipcAudio?.peq) {
            defaults.bands.forEach((band, i) => {
                window.aurivo.ipcAudio.peq.setBand(i, band.freq, band.gain, band.q, false);
                // Filter type'ı da sıfırla
                if (typeof window.aurivo.ipcAudio.peq.setFilterType === 'function') {
                    window.aurivo.ipcAudio.peq.setFilterType(i, band.filterType);
                }
            });
        }

        console.log('🔄 PEQ sıfırlandı (6 bant)');
    } else if (effectName === 'autogain') {
        // Auto Gain Özel Sıfırlama

        // Timer'ı temizle
        if (SFX.autoGainInterval) {
            clearInterval(SFX.autoGainInterval);
            SFX.autoGainInterval = null;
        }

        const defaults = {
            enabled: false,
            targetLevel: -14,
            maxGain: 12
        };
        saveSettings('autogain', defaults);

        // UI Update
        const panel = document.getElementById('autogainPanel');
        if (panel) {
            const enabledCb = document.getElementById('autogainEnabled');
            if (enabledCb) enabledCb.checked = false;

            const kTarget = SFX.knobInstances['autogain_targetLevel'];
            const kMaxGain = SFX.knobInstances['autogain_maxGain'];
            if (kTarget) kTarget.setValue(defaults.targetLevel);
            if (kMaxGain) kMaxGain.setValue(defaults.maxGain);
        }

        // Apply reset
        if (window.aurivo?.ipcAudio?.autoGain?.reset) {
            window.aurivo.ipcAudio.autoGain.reset();
        }

        console.log('🔄 Auto Gain sıfırlandı');
    } else if (effectName === 'truepeak') {
        // True Peak Limiter Özel Sıfırlama
        const defaults = {
            enabled: false,
            ceiling: -0.1,
            release: 50,
            lookahead: 5,
            drive: 0,
            oversampling: 4,
            linkChannels: true,
            lastPreset: 'balanced'
        };
        saveSettings('truepeak', defaults);

        // UI Update
        const panel = document.getElementById('truepeakPanel');
        if (panel) {
            const enabledCb = document.getElementById('truepeakEnabled');
            if (enabledCb) enabledCb.checked = false;

            // Knob instances güncelle
            const kCeiling = SFX.knobInstances['truepeak_ceiling'];
            const kRelease = SFX.knobInstances['truepeak_release'];
            const kLookahead = SFX.knobInstances['truepeak_lookahead'];
            const kDrive = SFX.knobInstances['truepeak_drive'];
            if (kCeiling) kCeiling.setValue(defaults.ceiling);
            if (kRelease) kRelease.setValue(defaults.release);
            if (kLookahead) kLookahead.setValue(defaults.lookahead);
            if (kDrive) kDrive.setValue(defaults.drive);

            // Oversampling buttons reset
            panel.querySelectorAll('.os-btn').forEach(btn => {
                btn.style.background = parseInt(btn.dataset.rate) === 4 ? '#0099ff' : '#222';
            });

            // Link channels checkbox
            const linkCb = document.getElementById('truepeakLinkChannels');
            if (linkCb) linkCb.checked = true;

            // Preset görünümünü sıfırla
            panel.querySelectorAll('.tp-preset-btn').forEach((btn) => {
                const active = btn.dataset.preset === defaults.lastPreset;
                btn.classList.toggle('active', active);
                btn.setAttribute('aria-pressed', active ? 'true' : 'false');
            });

            const hintEl = document.getElementById('truepeakPresetHint');
            if (hintEl) {
                hintEl.textContent = tOr(
                    `sfx.truepeak.presetDescriptions.${defaults.lastPreset}`,
                    '⚖️ Balanced: Günlük kullanım için dengeli limiter davranışı.'
                );
            }
        }

        // Apply reset
        if (window.aurivo?.ipcAudio?.truePeakLimiter?.reset) {
            window.aurivo.ipcAudio.truePeakLimiter.reset();
        }

        console.log('🔄 True Peak Limiter sıfırlandı');
    } else if (effectName === 'crossfeed') {
        // Crossfeed Özel Sıfırlama
        const defaults = {
            enabled: false,
            level: 30,
            delay: 0.3,
            lowCut: 700,
            highCut: 4000,
            preset: 0
        };
        saveSettings('crossfeed', defaults);

        // UI Update
        const panel = document.getElementById('crossfeedPanel');
        if (panel) {
            const enabledCb = document.getElementById('crossfeedEnabled');
            if (enabledCb) enabledCb.checked = false;

            // Knob instances güncelle
            const kLevel = SFX.knobInstances['crossfeed_level'];
            const kDelay = SFX.knobInstances['crossfeed_delay'];
            const kLowCut = SFX.knobInstances['crossfeed_lowCut'];
            const kHighCut = SFX.knobInstances['crossfeed_highCut'];
            if (kLevel) kLevel.setValue(defaults.level);
            if (kDelay) kDelay.setValue(defaults.delay);
            if (kLowCut) kLowCut.setValue(defaults.lowCut);
            if (kHighCut) kHighCut.setValue(defaults.highCut);

            // Preset buttons reset - Natural aktif
            panel.querySelectorAll('.crossfeed-preset-btn').forEach(b => {
                const active = parseInt(b.dataset.preset) === 0;
                b.classList.toggle('active', active);
                b.setAttribute('aria-pressed', active ? 'true' : 'false');
            });

            // Açıklamayı güncelle
            const descEl = document.getElementById('crossfeed-preset-description');
            if (descEl) descEl.textContent = tSync('sfx.crossfeed.presetDescriptions.0');
        }

        // Apply reset
        if (window.aurivo?.ipcAudio?.crossfeed?.reset) {
            window.aurivo.ipcAudio.crossfeed.reset();
        }

        // Visualization güncelle
        updateCrossfeedVisual();

        console.log('🔄 Crossfeed sıfırlandı');
    } else if (effectName === 'surround') {
        const defaults = { ...SFX.defaults.surround };
        saveSettings('surround', defaults);
        const panel = document.getElementById('surroundPanel');
        if (panel) {
            const enabledCb = document.getElementById('surroundEnabled');
            if (enabledCb) enabledCb.checked = false;
            ['center', 'surround', 'lfe', 'crossover', 'delay', 'mix'].forEach((param) => {
                const inst = SFX.knobInstances[`surround_${param}`];
                if (inst) inst.setValue(defaults[param]);
            });
            panel.querySelectorAll('.surround-preset-btn').forEach((btn) => {
                const active = btn.dataset.preset === defaults.lastPreset;
                btn.classList.toggle('active', active);
                btn.setAttribute('aria-pressed', active ? 'true' : 'false');
            });
        }
        applyEffect('surround');
        console.log('🔄 Surround sıfırlandı');
    } else if (effectName === 'tapesat') {
        const defaults = { ...SFX.defaults.tapesat };
        saveSettings('tapesat', defaults);

        // Update all UI elements via specialized function
        setTapeModeUI(defaults.mode); // This will handle applyEffect and button visuals

        ['driveDb', 'mix', 'tone', 'outputDb', 'hiss'].forEach(param => {
            const knb = SFX.knobInstances[`tapesat_${param}`];
            if (knb) knb.setValue(defaults[param]);
        });

        const toggle = document.getElementById('tapesatEnabled');
        if (toggle) toggle.checked = false;

        const panel = document.getElementById('tapesatPanel');
        panel?.querySelectorAll('.tapesat-modern-preset-btn').forEach((btn) => {
            btn.classList.remove('active');
            btn.setAttribute('aria-pressed', 'false');
        });

        console.log('🔄 Tape Saturation sıfırlandı');
    } else if (effectName === 'bitdither') {
        const defaults = { ...SFX.defaults.bitdither };
        saveSettings('bitdither', defaults);

        // Update UI
        const panel = document.getElementById('bitditherPanel');
        if (panel) {
            ['bitDepth', 'dither', 'shaping', 'downsample'].forEach(id => {
                const el = document.getElementById(`bitdither${id.charAt(0).toUpperCase() + id.slice(1)}`);
                if (el) el.value = defaults[id];
            });

            ['mix', 'outputDb'].forEach(param => {
                const inst = SFX.knobInstances[`bitdither_${param}`];
                if (inst) inst.setValue(defaults[param]);
            });

            const toggle = document.getElementById('bitditherEnabled');
            if (toggle) toggle.checked = false;

            panel.querySelectorAll('.bitdither-preset-btn').forEach((btn) => {
                btn.classList.remove('active');
                btn.setAttribute('aria-pressed', 'false');
            });
        }

        applyEffect('bitdither');
        console.log('🔄 Bit-depth/Dither sıfırlandı');
    } else if (effectName === 'softecho') {
        const defaults = { ...SFX.defaults.softecho };
        saveSettings('softecho', defaults);
        const panel = document.getElementById('softechoPanel');
        if (panel) {
            ['delay', 'feedback', 'wetMix', 'highCut'].forEach((param) => {
                const inst = SFX.knobInstances[`softecho_${param}`];
                if (inst) inst.setValue(defaults[param]);
            });
            const enabledCb = document.getElementById('softechoEnabled');
            if (enabledCb) enabledCb.checked = false;
            const stereoCb = document.getElementById('softechoStereo');
            if (stereoCb) stereoCb.checked = !!defaults.stereo;
            panel.querySelectorAll('.softecho-preset-btn').forEach((btn) => {
                const active = btn.dataset.preset === defaults.lastPreset;
                btn.classList.toggle('active', active);
                btn.setAttribute('aria-pressed', active ? 'true' : 'false');
            });
        }
        applyEffect('softecho');
        console.log('🔄 Soft Echo sıfırlandı');
    } else {
        // Diğer efektler için (Deep Copy!!)
        SFX.settings[effectName] = JSON.parse(JSON.stringify(SFX.defaults[effectName]));
        saveSettings(effectName, SFX.settings[effectName]);

        const panel = document.getElementById(`${effectName}Panel`);
        if (panel) {
            // Find all Generic Knobs in this panel and set default value
            const canvases = panel.querySelectorAll('.aurivo-knob-canvas');
            canvases.forEach(canvas => {
                const param = canvas.dataset.param;
                // Defaults check
                const defSettings = SFX.defaults[effectName];
                let defVal = 0;
                if (defSettings && defSettings[param] !== undefined) {
                    defVal = defSettings[param];
                }

                if (canvas._knobInstance) {
                    canvas._knobInstance.setValue(defVal);
                }
            });

            // Checkboxes
            const chk = panel.querySelector('input[type="checkbox"]');
            if (chk) chk.checked = SFX.defaults[effectName].enabled;

            const defaultPreset = SFX.defaults[effectName]?.lastPreset ?? SFX.defaults[effectName]?.preset;
            panel.querySelectorAll('.modern-preset-btn, .tp-preset-btn').forEach((btn) => {
                const active = defaultPreset !== undefined && String(btn.dataset.preset) === String(defaultPreset);
                btn.classList.toggle('active', !!active);
                btn.setAttribute('aria-pressed', active ? 'true' : 'false');
            });
        }

        applyEffect(effectName);
        console.log(`🔄 ${effectName} sıfırlandı`);
    }
}

function resetAurivoModule() {
    const settings = getSettings('eq32');
    settings.bass = 0;
    settings.mid = 0;
    settings.treble = 0;
    settings.stereoExpander = 100;
    // balance ve acousticSpace'i de sıfırla
    settings.balance = 0;
    settings.acousticSpace = 'off';
    saveSettings('eq32', settings);

    // Update Knobs Visual
    if (SFX.knobInstances['bass']) SFX.knobInstances['bass'].setValue(0);
    if (SFX.knobInstances['mid']) SFX.knobInstances['mid'].setValue(0);
    if (SFX.knobInstances['treble']) SFX.knobInstances['treble'].setValue(0);
    if (SFX.knobInstances['stereoExpander']) SFX.knobInstances['stereoExpander'].setValue(100);

    const balSlider = document.getElementById('balanceSlider');
    if (balSlider) {
        balSlider.value = 0;
        document.getElementById('balanceValue').textContent = getBalanceText(0);
    }

    const acoustic = document.getElementById('acousticSpace');
    if (acoustic) acoustic.value = 'off';

    // IPC Audio API'ye uygula - önce ipcAudio sonra audio dene
    const ipcAudio = window.aurivo?.ipcAudio;
    const audio = window.aurivo?.audio;

    if (ipcAudio?.module) {
        ipcAudio.module.reset();
    } else if (audio) {
        // Fallback: doğrudan audio API
        if (audio.setBass) audio.setBass(0);
        if (audio.setMid) audio.setMid(0);
        if (audio.setTreble) audio.setTreble(0);
        if (audio.setStereoExpander) audio.setStereoExpander(100);
    }

    if (ipcAudio?.balance) {
        ipcAudio.balance.set(0);
    } else if (audio?.setBalance) {
        audio.setBalance(0);
    }

    // Aurivo knob'larını doğrudan güncelle (pencereyi yenilemeden)
    const aurivoKnobUpdates = [
        { id: 'knobBass', value: 0 },
        { id: 'knobMid', value: 0 },
        { id: 'knobTreble', value: 0 },
        { id: 'knobStereo', value: 100 }
    ];

    aurivoKnobUpdates.forEach(({ id, value }) => {
        const knob = document.getElementById(id);
        if (!knob) return;
        const min = parseFloat(knob.dataset.min) || 0;
        const max = parseFloat(knob.dataset.max) || 100;
        knob.dataset.value = value;
        updateKnobIndicator(knob, value, min, max);
        updateKnobValue(knob, knob.dataset.param, value);
    });

    // Balance slider
    const balanceSlider = document.getElementById('balanceSlider');
    const balanceValueEl = document.getElementById('balanceValue');
    if (balanceSlider) balanceSlider.value = 0;
    if (balanceValueEl) balanceValueEl.textContent = 'Merkez (0%)';

    // Akustik mekan dropdown
    const acousticSelect = document.getElementById('acousticSpace');
    if (acousticSelect) acousticSelect.value = 'off';

    console.log('🔄 Aurivo Modülü sıfırlandı');
}

// ============================================
// REVERB PRESETS
// ============================================
function setReverbKnobValue(param, value) {
    // 1) Global map'ten dene
    const key = `reverb_${param}`;
    const mappedKnob = SFX.knobInstances[key];
    if (mappedKnob && typeof mappedKnob.setValue === 'function') {
        mappedKnob.setValue(value);
        return;
    }

    // 2) Canvas üstündeki instance'tan dene
    const panel = document.getElementById('reverbPanel');
    const canvas = panel?.querySelector(`.aurivo-knob-canvas[data-param="${param}"]`);
    const canvasKnob = canvas?._knobInstance;
    if (canvasKnob && typeof canvasKnob.setValue === 'function') {
        canvasKnob.setValue(value);
    }
}

function applyReverbPreset(presetName) {
    const presets = {
        smallRoom: { roomSize: 500, damping: 0.8, wetDry: -15, hfRatio: 0.5, inputGain: 0 },
        largeRoom: { roomSize: 1500, damping: 0.5, wetDry: -10, hfRatio: 0.7, inputGain: 0 },
        concertHall: { roomSize: 2500, damping: 0.3, wetDry: -8, hfRatio: 0.8, inputGain: 0 },
        cathedral: { roomSize: 3000, damping: 0.2, wetDry: -6, hfRatio: 0.9, inputGain: 0 },
        studioPlate: { roomSize: 900, damping: 0.62, wetDry: -12, hfRatio: 0.75, inputGain: 0 },
        arena: { roomSize: 2800, damping: 0.28, wetDry: -7, hfRatio: 0.84, inputGain: 1.0 },
        vocalRoom: { roomSize: 720, damping: 0.68, wetDry: -13, hfRatio: 0.72, inputGain: 0.5 },
        ambientWash: { roomSize: 2200, damping: 0.38, wetDry: -9, hfRatio: 0.86, inputGain: -0.5 },
        slapback: { roomSize: 280, damping: 0.78, wetDry: -18, hfRatio: 0.55, inputGain: 0.0 },
        dreamVox: { roomSize: 1400, damping: 0.46, wetDry: -11, hfRatio: 0.88, inputGain: 0.8 }
    };

    const preset = presets[presetName];
    if (!preset) return;

    const settings = getSettings('reverb');
    Object.assign(settings, preset);
    settings.lastPreset = presetName;
    settings.enabled = true;
    saveSettings('reverb', settings);

    // Knobları doğrudan preset değerlerine getir
    setReverbKnobValue('roomSize', settings.roomSize);
    setReverbKnobValue('damping', settings.damping);
    setReverbKnobValue('wetDry', settings.wetDry);
    setReverbKnobValue('hfRatio', settings.hfRatio);
    setReverbKnobValue('inputGain', settings.inputGain);

    // Toggle görselini de açık yap
    const enabledCb = document.getElementById('reverbEnabled');
    if (enabledCb) enabledCb.checked = true;

    applyEffect('reverb');

    // Preset butonunu aktif yap
    document.querySelectorAll('#reverbPanel .preset-btn').forEach(btn => {
        const active = btn.dataset.preset === presetName;
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
}

function applySoftEchoPreset(presetName) {
    const presets = {
        natural: { delay: 220, feedback: 22, wetMix: 18, highCut: 7000, stereo: false },
        velvet: { delay: 280, feedback: 18, wetMix: 16, highCut: 6200, stereo: false },
        tape: { delay: 340, feedback: 26, wetMix: 22, highCut: 5400, stereo: false },
        vocal: { delay: 180, feedback: 16, wetMix: 14, highCut: 8200, stereo: false },
        wide: { delay: 310, feedback: 24, wetMix: 20, highCut: 7600, stereo: true },
        cinema: { delay: 420, feedback: 30, wetMix: 24, highCut: 6000, stereo: true }
    };
    const preset = presets[presetName];
    if (!preset) return;

    const settings = getSettings('softecho');
    Object.assign(settings, preset);
    settings.lastPreset = presetName;
    settings.enabled = true;
    saveSettings('softecho', settings);

    ['delay', 'feedback', 'wetMix', 'highCut'].forEach((param) => {
        const mapped = SFX.knobInstances[`softecho_${param}`];
        if (mapped && typeof mapped.setValue === 'function') {
            mapped.setValue(settings[param]);
            return;
        }
        const canvas = document.querySelector(`#softechoPanel .aurivo-knob-canvas[data-param="${param}"]`);
        const inst = canvas?._knobInstance;
        if (inst && typeof inst.setValue === 'function') inst.setValue(settings[param]);
    });

    const stereoCb = document.getElementById('softechoStereo');
    if (stereoCb) stereoCb.checked = !!settings.stereo;
    const enabledCb = document.getElementById('softechoEnabled');
    if (enabledCb) enabledCb.checked = true;

    document.querySelectorAll('#softechoPanel .softecho-preset-btn').forEach((btn) => {
        const active = btn.dataset.preset === presetName;
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });

    applyEffect('softecho');
}

// ============================================
// TRUE PEAK LIMITER PRESETS
// ============================================
function applyTruePeakPreset(presetName) {
    const presetDescriptions = {
        soft: tOr('sfx.truepeak.presetDescriptions.soft', '🌿 Soft: Şeffaf ve hafif koruma, minimum sıkıştırma hissi.'),
        balanced: tOr('sfx.truepeak.presetDescriptions.balanced', '⚖️ Balanced: Günlük kullanım için dengeli limiter davranışı.'),
        loud: tOr('sfx.truepeak.presetDescriptions.loud', '🔥 Loud: Daha yüksek ses hissi için agresif limiter.'),
        spotify: tOr('sfx.truepeak.presetDescriptions.spotify', '🎵 Spotify: Platform hedeflerine uygun güvenli tepe kontrolü.'),
        youtube: tOr('sfx.truepeak.presetDescriptions.youtube', '📺 YouTube: Yayın dostu tepe kontrolü, orta seviye sıkıştırma.'),
        cd: tOr('sfx.truepeak.presetDescriptions.cd', '💿 CD Master: Minimum tepe payı ile daha temiz master yaklaşımı.'),
        broadcast: tOr('sfx.truepeak.presetDescriptions.broadcast', '📡 Broadcast: Yayın standardı için daha sıkı ve güvenli limit.')
    };

    const presets = {
        soft: {
            ceiling: -1.5,
            release: 120,
            lookahead: 10,
            drive: 0.5,
            oversampling: 4,
            linkChannels: true
        },
        balanced: {
            ceiling: -1.0,
            release: 70,
            lookahead: 8,
            drive: 2.0,
            oversampling: 4,
            linkChannels: true
        },
        loud: {
            ceiling: -1.0,
            release: 35,
            lookahead: 6,
            drive: 4.5,
            oversampling: 8,
            linkChannels: true
        },
        spotify: {
            ceiling: -1.0,      // Spotify: -1 dBTP
            release: 50,
            lookahead: 5,
            drive: 2.5,
            oversampling: 4,
            linkChannels: true
        },
        youtube: {
            ceiling: -1.0,      // YouTube: -1 dBTP
            release: 60,
            lookahead: 8,
            drive: 3.0,
            oversampling: 4,
            linkChannels: true
        },
        cd: {
            ceiling: -0.1,      // CD: -0.1 dBFS
            release: 40,
            lookahead: 10,
            drive: 1.0,
            oversampling: 8,
            linkChannels: true
        },
        broadcast: {
            ceiling: -2.0,      // EBU R128: -2 dBTP
            release: 100,
            lookahead: 12,
            drive: 4.0,
            oversampling: 4,
            linkChannels: true
        }
    };

    const preset = presets[presetName];
    if (!preset) {
        console.warn('[TRUE PEAK] Unknown preset:', presetName);
        return;
    }

    const settings = getSettings('truepeak');
    Object.assign(settings, preset);
    settings.lastPreset = presetName;
    saveSettings('truepeak', settings);

    // Knobları güncelle
    const kCeiling = SFX.knobInstances['truepeak_ceiling'];
    const kRelease = SFX.knobInstances['truepeak_release'];
    const kLookahead = SFX.knobInstances['truepeak_lookahead'];
    const kDrive = SFX.knobInstances['truepeak_drive'];

    if (kCeiling) kCeiling.setValue(preset.ceiling);
    if (kRelease) kRelease.setValue(preset.release);
    if (kLookahead) kLookahead.setValue(preset.lookahead);
    if (kDrive) kDrive.setValue(preset.drive);

    // Oversampling buttons
    document.querySelectorAll('.os-btn').forEach(btn => {
        btn.style.background = parseInt(btn.dataset.rate) === preset.oversampling ? '#0099ff' : '#222';
    });

    // Link channels checkbox
    const linkCb = document.getElementById('truepeakLinkChannels');
    if (linkCb) linkCb.checked = preset.linkChannels;

    const hintEl = document.getElementById('truepeakPresetHint');
    if (hintEl) hintEl.textContent = presetDescriptions[presetName] || '';

    // Aktif preset butonunu vurgula (glow + check)
    const truePeakPanel = document.getElementById('truepeakPanel');
    truePeakPanel?.querySelectorAll('.tp-preset-btn, .preset-btn[data-preset]')?.forEach((btn) => {
        const active = btn.dataset.preset === presetName;
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });

    // Preset uygulanınca efekti de aktif et
    settings.enabled = true;
    const enabledCb = document.getElementById('truepeakEnabled');
    if (enabledCb) enabledCb.checked = true;
    applyEffect('truepeak');

    console.log(`[TRUE PEAK] Preset applied: ${presetName}`);
}

// ============================================
// CROSSFEED CONTROLS
// ============================================
function initCrossfeedControls() {
    const panel = document.getElementById('crossfeedPanel');
    if (!panel) return;

    const presetDescriptions = {
        0: tSync('sfx.crossfeed.presetDescriptions.0'),
        1: tSync('sfx.crossfeed.presetDescriptions.1'),
        2: tSync('sfx.crossfeed.presetDescriptions.2'),
        3: tSync('sfx.crossfeed.presetDescriptions.3'),
        4: tSync('sfx.crossfeed.presetDescriptions.4')
    };

    const presetValues = [
        { level: 30, delay: 0.3, lowCut: 700, highCut: 4000 },   // Natural
        { level: 20, delay: 0.2, lowCut: 800, highCut: 5000 },   // Mild
        { level: 50, delay: 0.5, lowCut: 600, highCut: 3500 },   // Strong
        { level: 60, delay: 0.7, lowCut: 500, highCut: 3000 }    // Wide
    ];

    // Preset butonları
    panel.querySelectorAll('.crossfeed-preset-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const preset = parseInt(btn.dataset.preset);

            // Tüm butonları güncelle
            panel.querySelectorAll('.crossfeed-preset-btn').forEach(b => {
                const active = parseInt(b.dataset.preset) === preset;
                b.classList.toggle('active', active);
                b.setAttribute('aria-pressed', active ? 'true' : 'false');
            });

            // Açıklamayı güncelle
            const descEl = document.getElementById('crossfeed-preset-description');
            if (descEl) descEl.textContent = presetDescriptions[preset];

            // Settings güncelle
            const settings = getSettings('crossfeed');
            settings.preset = preset;

            // Custom değilse knobları güncelle
            if (preset < 4) {
                const p = presetValues[preset];
                settings.level = p.level;
                settings.delay = p.delay;
                settings.lowCut = p.lowCut;
                settings.highCut = p.highCut;

                // Knobları güncelle
                const kLevel = SFX.knobInstances['crossfeed_level'];
                const kDelay = SFX.knobInstances['crossfeed_delay'];
                const kLowCut = SFX.knobInstances['crossfeed_lowCut'];
                const kHighCut = SFX.knobInstances['crossfeed_highCut'];

                if (kLevel) kLevel.setValue(p.level);
                if (kDelay) kDelay.setValue(p.delay);
                if (kLowCut) kLowCut.setValue(p.lowCut);
                if (kHighCut) kHighCut.setValue(p.highCut);
            }

            saveSettings('crossfeed', settings);

            // C++ tarafına preset gönder
            if (window.aurivo?.ipcAudio?.crossfeed?.setPreset) {
                window.aurivo.ipcAudio.crossfeed.setPreset(preset);
            }

            // Visualization güncelle
            updateCrossfeedVisual();

            console.log(`[CROSSFEED] Preset: ${preset}`);
        });
    });

    // Toggle switch event listener
    const enabledToggle = document.getElementById('crossfeedEnabled');
    if (enabledToggle) {
        enabledToggle.addEventListener('change', (e) => {
            const settings = getSettings('crossfeed');
            settings.enabled = e.target.checked;
            saveSettings('crossfeed', settings);

            if (window.aurivo?.ipcAudio?.crossfeed?.enable) {
                window.aurivo.ipcAudio.crossfeed.enable(settings.enabled);
                console.log(`[CROSSFEED] ${settings.enabled ? 'Etkinleştirildi' : 'Devre dışı'}`);
            }

            updateCrossfeedVisual();
        });
    }

    const autoHeadphonesCb = document.getElementById('crossfeedAutoHeadphones');
    if (autoHeadphonesCb) {
        autoHeadphonesCb.addEventListener('change', (e) => {
            const settings = getSettings('crossfeed');
            settings.autoHeadphones = !!e.target.checked;
            saveSettings('crossfeed', settings);
            if (!settings.autoHeadphones) {
                SFX.crossfeedAutoForcedBySystem = false;
            }
        });
    }
    // Başlangıçta enable durumunu senkronize et
    if (window.aurivo?.ipcAudio?.crossfeed?.enable) {
        window.aurivo.ipcAudio.crossfeed.enable(getSettings('crossfeed').enabled);
    }

    // Reset butonu event listener
    const resetBtn = document.getElementById('crossfeedResetBtn');
    if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            resetEffect('crossfeed');

            // Preset butonlarını Natural'a güncelle
            panel.querySelectorAll('.crossfeed-preset-btn').forEach(b => {
                const active = parseInt(b.dataset.preset) === 0;
                b.classList.toggle('active', active);
                b.setAttribute('aria-pressed', active ? 'true' : 'false');
            });

            // Açıklamayı güncelle
            const descEl = document.getElementById('crossfeed-preset-description');
            if (descEl) descEl.textContent = presetDescriptions[0];

            console.log('[CROSSFEED] Sıfırlandı');
        });
    }

    // İlk visualization çiz
    setTimeout(() => {
        updateCrossfeedVisual();
    }, 100);

    // DSP status güncelle
    const statusEl = document.getElementById('crossfeed-status');
    const updateStatus = async () => {
        if (!statusEl || !window.aurivo?.ipcAudio?.crossfeed?.getParams) return;
        try {
            const params = await window.aurivo.ipcAudio.crossfeed.getParams();
            const attached = params?.dspAttached ? tSync('sfx.crossfeed.attached') : tSync('sfx.crossfeed.detached');
            const count = params?.callbackCount ?? 0;
            const err = params?.lastError ?? 0;
            const errText = err ? ` | ${tSync('sfx.crossfeed.errorLabel')}: ${err}` : '';
            statusEl.textContent = tSync('sfx.crossfeed.statusLine', { attached, count, errText });
        } catch (e) {
            statusEl.textContent = tSync('sfx.crossfeed.statusUnreadable');
        }
    };
    updateStatus();
    if (SFX.crossfeedStatusInterval) {
        clearInterval(SFX.crossfeedStatusInterval);
        SFX.crossfeedStatusInterval = null;
    }
    SFX.crossfeedStatusInterval = setInterval(updateStatus, 1000);

    const deviceHintEl = document.getElementById('crossfeedDeviceHint');
    const updateDeviceState = async () => {
        if (!deviceHintEl) return;
        try {
            const st = await window.aurivo?.systemAudio?.getState?.();
            const outputName = String(st?.currentOutputName || st?.currentOutputBadge || tOr('sfx.crossfeed.outputUnknown', 'Unknown output'));
            const rawIsHeadphones = !!st?.isHeadphones;
            const isUsbHeadsetLike = String(st?.currentOutputKind || '') === 'usb' && !!st?.hasRelatedInput;
            const isHeadphones = rawIsHeadphones || isUsbHeadsetLike;
            const settings = getSettings('crossfeed');

            if (isHeadphones) {
                deviceHintEl.style.background = 'rgba(56, 212, 108, 0.10)';
                deviceHintEl.style.borderColor = 'rgba(56, 212, 108, 0.28)';
                deviceHintEl.style.color = '#6dffb0';
                const hintKey = isUsbHeadsetLike && !rawIsHeadphones
                    ? 'sfx.crossfeed.device.usbHeadset'
                    : 'sfx.crossfeed.device.headphones';
                const hintFallback = isUsbHeadsetLike && !rawIsHeadphones
                    ? '✓ {outputName} detected as USB headset (output + related mic). Crossfeed is suitable.'
                    : '✓ {outputName} detected as headphones. Crossfeed is suitable.';
                deviceHintEl.textContent = tOr(hintKey, hintFallback).replace('{outputName}', outputName);
            } else {
                deviceHintEl.style.background = 'rgba(255, 193, 7, 0.10)';
                deviceHintEl.style.borderColor = 'rgba(255, 193, 7, 0.28)';
                deviceHintEl.style.color = '#ffe082';
                deviceHintEl.textContent = tOr('sfx.crossfeed.device.speakers', 'ℹ {outputName} detected as speaker/line output. Crossfeed is usually unnecessary.')
                    .replace('{outputName}', outputName);
            }

            if (settings.autoHeadphones !== false) {
                if (isHeadphones && !settings.enabled) {
                    settings.enabled = true;
                    saveSettings('crossfeed', settings);
                    if (enabledToggle) enabledToggle.checked = true;
                    SFX.crossfeedAutoForcedBySystem = true;
                    applyEffect('crossfeed');
                } else if (!isHeadphones && settings.enabled) {
                    settings.enabled = false;
                    saveSettings('crossfeed', settings);
                    if (enabledToggle) enabledToggle.checked = false;
                    SFX.crossfeedAutoForcedBySystem = false;
                    applyEffect('crossfeed');
                }
            }
        } catch {
            deviceHintEl.style.background = 'rgba(255, 193, 7, 0.10)';
            deviceHintEl.style.borderColor = 'rgba(255, 193, 7, 0.28)';
            deviceHintEl.style.color = '#ffe082';
            deviceHintEl.textContent = tOr('sfx.crossfeed.device.unreadable', 'ℹ Output info could not be read. Crossfeed remains in manual mode.');
        }
    };

    updateDeviceState();
    if (SFX.crossfeedDeviceInterval) {
        clearInterval(SFX.crossfeedDeviceInterval);
        SFX.crossfeedDeviceInterval = null;
    }
    SFX.crossfeedDeviceInterval = setInterval(updateDeviceState, 2000);
}

function applySurroundPreset(presetName) {
    const presets = {
        movie: { center: 2.0, surround: 3.0, lfe: 2.5, crossover: 110, delay: 10, mix: 82 },
        music: { center: 0.5, surround: 1.5, lfe: 1.0, crossover: 95, delay: 6, mix: 68 },
        game: { center: 1.0, surround: 4.0, lfe: 2.0, crossover: 120, delay: 12, mix: 88 },
        voice: { center: 3.5, surround: 0.0, lfe: -2.0, crossover: 130, delay: 4, mix: 70 },
        night: { center: 1.5, surround: -1.0, lfe: -4.0, crossover: 100, delay: 8, mix: 58 }
    };
    const p = presets[presetName];
    if (!p) return;

    const settings = getSettings('surround');
    settings.center = p.center;
    settings.surround = p.surround;
    settings.lfe = p.lfe;
    settings.crossover = p.crossover;
    settings.delay = p.delay;
    settings.mix = p.mix;
    settings.lastPreset = presetName;
    settings.enabled = true;
    saveSettings('surround', settings);

    ['center', 'surround', 'lfe', 'crossover', 'delay', 'mix'].forEach((param) => {
        const inst = SFX.knobInstances[`surround_${param}`];
        if (inst) inst.setValue(settings[param]);
    });

    const panel = document.getElementById('surroundPanel');
    panel?.querySelectorAll('.surround-preset-btn')?.forEach((btn) => {
        const active = btn.dataset.preset === presetName;
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    const enabledCb = document.getElementById('surroundEnabled');
    if (enabledCb) enabledCb.checked = true;
    applyEffect('surround');
}

function initSurroundControls() {
    const panel = document.getElementById('surroundPanel');
    if (!panel) return;
    const autoCb = document.getElementById('surroundAutoMultichannel');
    if (autoCb) {
        autoCb.addEventListener('change', (e) => {
            const settings = getSettings('surround');
            settings.autoMultichannel = !!e.target.checked;
            saveSettings('surround', settings);
            if (!settings.autoMultichannel) {
                SFX.surroundAutoForcedBySystem = false;
            }
        });
    }
    panel.querySelectorAll('.surround-preset-btn').forEach((btn) => {
        btn.addEventListener('click', () => applySurroundPreset(btn.dataset.preset));
    });

    const hintEl = document.getElementById('surroundDeviceHint');
    const updateDeviceHint = async () => {
        if (!hintEl) return;
        try {
            const st = await window.aurivo?.systemAudio?.getState?.();
            const channels = Number(st?.channelCount || 0);
            const outputName = String(st?.currentOutputName || st?.currentOutputBadge || tOr('sfx.surround.outputUnknown', 'Unknown output'));
            const isMulti = Number.isFinite(channels) && channels > 2;
            const settings = getSettings('surround');
            if (isMulti) {
                hintEl.style.background = 'rgba(56, 212, 108, 0.10)';
                hintEl.style.borderColor = 'rgba(56, 212, 108, 0.28)';
                hintEl.style.color = '#6dffb0';
                hintEl.textContent = tOr('sfx.surround.hint.multi', '✓ {outputName} • {channels} channels detected. Surround mode is recommended.')
                    .replace('{outputName}', outputName)
                    .replace('{channels}', String(channels));
            } else {
                hintEl.style.background = 'rgba(255, 193, 7, 0.10)';
                hintEl.style.borderColor = 'rgba(255, 193, 7, 0.28)';
                hintEl.style.color = '#ffe082';
                hintEl.textContent = tOr('sfx.surround.hint.stereo', 'ℹ {outputName} • {channels} channels detected. This mode simulates virtual surround for stereo content.')
                    .replace('{outputName}', outputName)
                    .replace('{channels}', String(channels || 2));
            }

            if (settings.autoMultichannel) {
                if (isMulti && !settings.enabled) {
                    settings.enabled = true;
                    saveSettings('surround', settings);
                    const enabledCb = document.getElementById('surroundEnabled');
                    if (enabledCb) enabledCb.checked = true;
                    SFX.surroundAutoForcedBySystem = true;
                    applyEffect('surround');
                } else if (!isMulti && SFX.surroundAutoForcedBySystem && settings.enabled) {
                    settings.enabled = false;
                    saveSettings('surround', settings);
                    const enabledCb = document.getElementById('surroundEnabled');
                    if (enabledCb) enabledCb.checked = false;
                    SFX.surroundAutoForcedBySystem = false;
                    applyEffect('surround');
                }
            }
        } catch {
            hintEl.style.background = 'rgba(255, 193, 7, 0.10)';
            hintEl.style.borderColor = 'rgba(255, 193, 7, 0.28)';
            hintEl.style.color = '#ffe082';
            hintEl.textContent = tOr('sfx.surround.hint.unreadable', 'ℹ Output info could not be read. Surround mode works as virtual simulation on stereo sources.');
        }
    };

    updateDeviceHint();
    if (SFX.surroundStatusInterval) clearInterval(SFX.surroundStatusInterval);
    SFX.surroundStatusInterval = setInterval(updateDeviceHint, 2000);
}

// Crossfeed Visualization güncelleme
function updateCrossfeedVisual() {
    const canvas = document.getElementById('crossfeed-canvas');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    const centerX = width / 2;
    const centerY = height / 2;

    // Settings al
    const settings = getSettings('crossfeed');
    const level = settings.level / 100;
    const delay = settings.delay;

    // Temizle
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, width, height);

    // Kafa çiz (üstten bakış)
    ctx.strokeStyle = '#444';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(centerX, centerY, 50, 0, Math.PI * 2);
    ctx.stroke();

    // Kulaklar
    ctx.fillStyle = '#333';
    ctx.beginPath();
    ctx.ellipse(centerX - 58, centerY, 10, 18, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(centerX + 58, centerY, 10, 18, 0, 0, Math.PI * 2);
    ctx.fill();

    // SOL HOPARLÖR → SAĞ KULAK (crossfeed)
    ctx.strokeStyle = `rgba(0, 212, 255, ${level * 0.7 + 0.1})`;
    ctx.lineWidth = 2 + level * 4;
    ctx.shadowBlur = 10;
    ctx.shadowColor = '#00d4ff';
    ctx.setLineDash([8, 4]);
    ctx.beginPath();
    ctx.moveTo(centerX - 100, centerY - 60);  // Sol hoparlör
    ctx.quadraticCurveTo(centerX, centerY - 100, centerX + 58, centerY);  // Sağ kulak
    ctx.stroke();

    // SAĞ HOPARLÖR → SOL KULAK (crossfeed)
    ctx.strokeStyle = `rgba(255, 0, 212, ${level * 0.7 + 0.1})`;
    ctx.beginPath();
    ctx.moveTo(centerX + 100, centerY - 60);  // Sağ hoparlör
    ctx.quadraticCurveTo(centerX, centerY - 100, centerX - 58, centerY);  // Sol kulak
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.shadowBlur = 0;

    // Direkt yollar (daha kalın)
    ctx.strokeStyle = '#00ff00';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(centerX - 100, centerY - 60);
    ctx.lineTo(centerX - 58, centerY);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(centerX + 100, centerY - 60);
    ctx.lineTo(centerX + 58, centerY);
    ctx.stroke();

    // Hoparlörler
    ctx.fillStyle = '#00ff00';
    ctx.beginPath();
    ctx.arc(centerX - 100, centerY - 60, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(centerX + 100, centerY - 60, 8, 0, Math.PI * 2);
    ctx.fill();

    // Etiketler
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('L', centerX - 100, centerY - 75);
    ctx.fillText('R', centerX + 100, centerY - 75);

    ctx.fillStyle = '#888';
    ctx.font = '11px sans-serif';
    ctx.fillText(`Crossfeed: ${(level * 100).toFixed(0)}%`, centerX, height - 30);
    ctx.fillText(`Delay: ${delay.toFixed(2)} ms`, centerX, height - 15);
}

// ============================================
// EQ PRESETS
// ============================================
function showEQPresets() {
    dbgEq('[showEQPresets] Fonksiyon çağrıldı');
    
    if (window.aurivo?.presets?.openEQPresetsWindow) {
        dbgEq('[showEQPresets] API bulundu, openEQPresetsWindow çağrılıyor...');
        window.aurivo.presets.openEQPresetsWindow()
            .then(result => dbgEq('[showEQPresets] Başarılı, sonuç:', result))
            .catch(err => console.error('[showEQPresets] Hata:', err));
        return;
    }
    console.error('[showEQPresets] HATA: presets API bulunamadı!');
    if (window.i18n?.t) {
        window.i18n.t('errors.presetsWindowOpenFailed')
            .then((msg) => alert(msg))
            .catch(() => alert(tSync('errors.presetsWindowOpenFailed')));
    } else {
        alert(tSync('errors.presetsWindowOpenFailed'));
    }
}

function clampEQGain(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return 0;
    return Math.max(-12, Math.min(12, n));
}

function normalize32Bands(bands) {
    const out = new Array(32).fill(0);
    if (Array.isArray(bands)) {
        for (let i = 0; i < 32; i++) out[i] = clampEQGain(bands[i]);
    }
    return out;
}

function applyEQPresetPayload(payload) {
    dbgEq('[APPLY EQ PRESET] Fonksiyon çağrıldı, payload:', payload);
    
    const preset = payload?.preset || payload;
    const filename = payload?.filename;
    if (!preset) {
        console.error('[APPLY EQ PRESET] ✗ Preset bulunamadı!');
        return;
    }

    const bands = normalize32Bands(preset.bands);
    const presetName =
        preset.name ||
        (filename ? filename.replace(/\.json$/i, '').replace(/_/g, ' ') : tSync('sfx.ui.presetFallback'));

    dbgEq('[APPLY EQ PRESET] Preset bilgisi:', {
        name: presetName,
        filename: filename,
        bantSayısı: bands.length
    });

    const settings = getSettings('eq32');
    settings.bands = bands;
    settings.lastPreset = {
        filename: filename || null,
        name: presetName
    };

    saveSettings('eq32', settings);

    // UI + Engine (tek sefer, event fırtınası olmadan)
    updateEq32UIFromSettings(settings);
    applyEffect('eq32');

    // Buton etiketini kalıcı güncelle
    updateEqPresetButtonLabel();

    // Kalıcı kayıt (preset seçimi kapanıp açılınca da görünsün)
    schedulePersistEq32ToAppSettings(settings);

}

function updateEqPresetButtonLabel() {
    const btn = document.getElementById('eqPresetsBtn');
    if (!btn) return;
    const settings = getSettings('eq32');
    const label = tSync('sfx.ui.presets');
    const name = getLocalizedPresetName(settings?.lastPreset);

    if (name) {
        btn.innerHTML = `${escapeHtml(label)} <span class="preset-sep">•</span> <span class="preset-name">${escapeHtml(name)}</span>`;
    } else {
        btn.textContent = label;
    }
}

async function persistEq32ToAppSettings(eq32Settings) {
    dbgEq('[PERSIST EQ32] çağrıldı');

    if (!window.aurivo?.loadSettings || !window.aurivo?.saveSettings) {
        console.error('[PERSIST EQ32] ✗ aurivo.loadSettings veya saveSettings mevcut değil!');
        return;
    }

    const current = await window.aurivo.loadSettings();
    dbgEq('[PERSIST EQ32] mevcut yüklendi');

    const next = { ...(current || {}) };
    next.sfx = { ...(current?.sfx || {}) };
    next.sfx.eq32 = { ...(current?.sfx?.eq32 || {}) };

    next.sfx.eq32.bands = normalize32Bands(eq32Settings?.bands);
    next.sfx.eq32.balance = Number.isFinite(eq32Settings?.balance) ? eq32Settings.balance : 0;
    next.sfx.eq32.bass = Number.isFinite(eq32Settings?.bass) ? eq32Settings.bass : 0;
    next.sfx.eq32.mid = Number.isFinite(eq32Settings?.mid) ? eq32Settings.mid : 0;
    next.sfx.eq32.treble = Number.isFinite(eq32Settings?.treble) ? eq32Settings.treble : 0;
    next.sfx.eq32.stereoExpander = Number.isFinite(eq32Settings?.stereoExpander) ? eq32Settings.stereoExpander : 100;
    next.sfx.eq32.lastPreset = eq32Settings?.lastPreset || null;

    const result = await window.aurivo.saveSettings(next);
    dbgEq('[PERSIST EQ32] ✓ Kayıt sonucu:', result);
    
    return result;
}

async function hydrateEq32FromAppSettings() {
    if (!window.aurivo?.loadSettings) return;

    try {
        dbgEq('[EQ32 HYDRATE] Kayıtlı ayarlar yükleniyor...');
        const appSettings = await window.aurivo.loadSettings();
        const sfxEq32 = appSettings?.sfx?.eq32;
        if (!sfxEq32) {
            dbgEq('[EQ32 HYDRATE] Kayıtlı ayar yok, varsayılan kullanılacak');
            return;
        }

        dbgEq('[EQ32 HYDRATE] Ayarlar bulundu');

        const settings = getSettings('eq32');
        if (Array.isArray(sfxEq32.bands)) settings.bands = normalize32Bands(sfxEq32.bands);
        if (Number.isFinite(sfxEq32.balance)) settings.balance = sfxEq32.balance;
        if (Number.isFinite(sfxEq32.bass)) settings.bass = sfxEq32.bass;
        if (Number.isFinite(sfxEq32.mid)) settings.mid = sfxEq32.mid;
        if (Number.isFinite(sfxEq32.treble)) settings.treble = sfxEq32.treble;
        if (Number.isFinite(sfxEq32.stereoExpander)) settings.stereoExpander = sfxEq32.stereoExpander;
        if (sfxEq32.lastPreset) settings.lastPreset = sfxEq32.lastPreset;

        saveSettings('eq32', settings);

        updateEq32UIFromSettings(settings);
        dbgEq('[EQ32 HYDRATE] ✓ Kayıtlı ayarlar yüklendi:', settings.lastPreset?.name || 'Düz (Flat)');
    } catch (e) {
        console.warn('[EQ32] Yükleme hatası:', e);
    }
}

// ============================================
// DSP STATUS
// ============================================
function updateDSPStatus() {
    const statusEl = document.getElementById('dspStatus');
    if (statusEl) {
        const activeCount = Object.values(SFX.settings).filter(s => s.enabled).length;
        const on = tSync('sfx.on') === 'sfx.on' ? 'On' : tSync('sfx.on');
        const off = tSync('sfx.off') === 'sfx.off' ? 'Off' : tSync('sfx.off');
        const dsp = SFX.masterEnabled ? on : off;
        const py = on;
        const localized = tSync('sfx.dspStatus', { dsp, py, active: activeCount });
        statusEl.textContent = localized && localized !== 'sfx.dspStatus' ? localized : `DSP: ${dsp} • PY: ${py} • Active: ${activeCount}`;
    }
}

// ============================================
// IR PRESET SELECTION (Convolution Reverb)
// ============================================
const CONV_REVERB_PRESET_PROFILES = {
    hall: { roomType: 3, mix: 32, predelay: 22, roomSize: 74, decay: 2.2, damping: 0.42 },
    church: { roomType: 4, mix: 38, predelay: 35, roomSize: 90, decay: 3.1, damping: 0.34 },
    room: { roomType: 1, mix: 24, predelay: 12, roomSize: 48, decay: 1.2, damping: 0.58 },
    plate: { roomType: 5, mix: 28, predelay: 18, roomSize: 62, decay: 1.8, damping: 0.50 },
    small: { roomType: 0, mix: 20, predelay: 8, roomSize: 36, decay: 0.9, damping: 0.65 },
    large: { roomType: 2, mix: 35, predelay: 26, roomSize: 82, decay: 2.6, damping: 0.40 },
    spring: { roomType: 6, mix: 26, predelay: 9, roomSize: 44, decay: 1.5, damping: 0.62 },
    chamber: { roomType: 7, mix: 30, predelay: 16, roomSize: 58, decay: 1.9, damping: 0.52 }
};

function selectIRPreset(presetName) {
    console.log('[IR PRESET] Seçilen preset:', presetName);

    const profile = CONV_REVERB_PRESET_PROFILES[presetName];
    if (!profile) {
        console.warn('[IR PRESET] Bilinmeyen preset:', presetName);
        return;
    }

    // Settings + knoblar profil değerlerine göre güncellensin
    const settings = getSettings('convreverb');
    Object.assign(settings, {
        preset: presetName,
        roomType: profile.roomType,
        mix: profile.mix,
        predelay: profile.predelay,
        roomSize: profile.roomSize,
        decay: profile.decay,
        damping: profile.damping
    });
    saveSettings('convreverb', settings);

    const kMix = SFX.knobInstances['convreverb_mix'];
    const kPredelay = SFX.knobInstances['convreverb_predelay'];
    if (kMix) kMix.setValue(settings.mix);
    if (kPredelay) kPredelay.setValue(settings.predelay);

    // Butonları güncelle
    document.querySelectorAll('#convreverbPanel .presets-buttons .preset-btn').forEach(btn => {
        const active = btn.dataset.preset === presetName;
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });

    // Etki açıksa native'e anında uygula
    if (settings.enabled) {
        applyEffect('convreverb');
    }

    console.log('[IR PRESET] Preset uygulandı:', presetName, profile);
}


// ============================================
// BASS MONO CONTROLS
// ============================================
function initBassMonoControls() {
    const panel = document.getElementById('bassmonoPanel');
    if (!panel) return;

    panel.querySelectorAll('.bassmono-preset-btn').forEach((btn) => {
        btn.addEventListener('click', () => window.applyBassMonoPreset?.(btn.dataset.preset));
    });

    // Slope buttons
    panel.querySelectorAll('.slope-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const slope = parseFloat(btn.dataset.slope);

            // UI güncelle
            panel.querySelectorAll('.slope-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            // Settings güncelle
            const settings = getSettings('bassmono');
            settings.slope = slope;
            saveSettings('bassmono', settings);

            // Native'e gönder
            if (window.aurivo?.audio?.bassMono?.setSlope) {
                window.aurivo.audio.bassMono.setSlope(slope);
            }

            updateBassMonoVisual();
        });
    });

    // Reset button
    document.getElementById('bassmonoResetBtn')?.addEventListener('click', () => {
        resetEffect('bassmono');
        // Slope default (24)
        panel.querySelectorAll('.slope-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.slope === "24");
        });
        updateBassMonoVisual();
    });

    // İlk çizim
    setTimeout(updateBassMonoVisual, 100);
}

function updateBassMonoVisual() {
    const canvas = document.getElementById('bass-mono-canvas');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;

    // Settings al
    const settings = getSettings('bassmono');
    const cutoff = settings.cutoff;
    const slope = settings.slope;
    const stereoWidth = settings.stereoWidth / 100;

    // Temizle
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, width, height);

    // Grid
    ctx.strokeStyle = '#222';
    ctx.lineWidth = 1;
    ctx.font = '10px sans-serif';
    ctx.fillStyle = '#666';

    const freqs = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
    const minFreq = 20;
    const maxFreq = 20000;

    const freqToX = (f) => (Math.log(f / minFreq) / Math.log(maxFreq / minFreq)) * width;
    const xToFreq = (x) => minFreq * Math.pow(maxFreq / minFreq, x / width);

    // Draw Grid
    freqs.forEach(f => {
        const x = freqToX(f);
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
        ctx.fillText(`${f >= 1000 ? f / 1000 + 'k' : f}`, x + 2, height - 5);
    });

    const cutoffX = freqToX(cutoff);

    // MONO BÖLGESİ (cutoff altı)
    ctx.fillStyle = 'rgba(255, 0, 128, 0.15)';
    ctx.fillRect(0, 0, cutoffX, height);
    ctx.fillStyle = '#ff0080';
    ctx.fillText('MONO', 10, height / 2);

    // STEREO BÖLGESİ (cutoff üstü)
    ctx.fillStyle = 'rgba(0, 212, 255, 0.1)';
    ctx.fillRect(cutoffX, 0, width - cutoffX, height);
    ctx.fillStyle = '#00d4ff';
    ctx.fillText('STEREO', width - 50, height / 2);

    // Cutoff Çizgisi
    ctx.strokeStyle = '#ffeb3b';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(cutoffX, 0);
    ctx.lineTo(cutoffX, height);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#ffeb3b';
    ctx.fillText(`${cutoff} Hz`, cutoffX + 5, 20);

    // Response curve (Slope visual)
    ctx.strokeStyle = '#ff0080';
    ctx.lineWidth = 3;
    ctx.shadowBlur = 10;
    ctx.shadowColor = '#ff0080';
    ctx.beginPath();

    for (let x = 0; x < width; x += 2) {
        const f = xToFreq(x);
        let response = 0; // Mono amount (1.0 = fully mono, 0.0 = stereo)

        // Basit crossover simulasyon
        // Lowpass magnitude response
        const w = 2 * Math.PI * f;
        const wc = 2 * Math.PI * cutoff;
        const n = slope / 6; // order approx
        const mag = 1 / Math.sqrt(1 + Math.pow(w / wc, 2 * n));

        const y = height - (mag * (height * 0.8)) - 20;

        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Stereo Width visual (> Cutoff)
    ctx.strokeStyle = '#00d4ff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let x = cutoffX; x < width; x += 5) {
        const y = height / 2;
        const wVal = stereoWidth * 40; // Scale for visual
        ctx.moveTo(x, y - wVal);
        ctx.lineTo(x, y + wVal);
    }
    ctx.stroke();
}

// Global scope expose for onclick
window.applyBassMonoPreset = function (presetName) {
    const presets = {
        vinyl: { cutoff: 150, slope: 24, stereoWidth: 100 },
        club: { cutoff: 120, slope: 24, stereoWidth: 120 },
        mastering: { cutoff: 80, slope: 48, stereoWidth: 100 },
        dj: { cutoff: 100, slope: 24, stereoWidth: 110 },
        sub: { cutoff: 60, slope: 48, stereoWidth: 150 }
    };

    const p = presets[presetName];
    if (!p) return;

    // Update Settings
    const settings = getSettings('bassmono');
    settings.cutoff = p.cutoff;
    settings.slope = p.slope;
    settings.stereoWidth = p.stereoWidth;
    settings.lastPreset = presetName;
    saveSettings('bassmono', settings);

    // Update UI Knobs
    const kCutoff = SFX.knobInstances['bassmono_cutoff'];
    const kWidth = SFX.knobInstances['bassmono_stereoWidth'];
    if (kCutoff) kCutoff.setValue(p.cutoff);
    if (kWidth) kWidth.setValue(p.stereoWidth);

    // Update Slope Buttons
    document.querySelectorAll('#bassmonoPanel .slope-btn').forEach(b => {
        b.classList.toggle('active', parseFloat(b.dataset.slope) === p.slope);
    });
    document.querySelectorAll('#bassmonoPanel .bassmono-preset-btn').forEach((btn) => {
        const active = btn.dataset.preset === presetName;
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });

    // Send to Native
    // Knob onChange handles cutoff/width
    // Slope needs manual send
    if (window.aurivo?.audio?.bassMono?.setSlope) {
        window.aurivo.audio.bassMono.setSlope(p.slope);
    }

    updateBassMonoVisual();
    console.log(`[BassMono] Preset applied: ${presetName}`);
};

// Dynamic EQ Presets
window.applyDynamicEQPreset = function (presetName) {
    const presets = {
        deharsh: { frequency: 4000, q: 2.0, threshold: -40, gain: -8, range: 12, attack: 5, release: 120 },
        demud: { frequency: 300, q: 1.5, threshold: -35, gain: -6, range: 12, attack: 10, release: 150 },
        vocal: { frequency: 2500, q: 2.5, threshold: -45, gain: 6, range: 10, attack: 3, release: 100 },
        deesser: { frequency: 7000, q: 3.0, threshold: -40, gain: -10, range: 15, attack: 1, release: 80 },
        basstighten: { frequency: 80, q: 2.5, threshold: -35, gain: -8, range: 12, attack: 10, release: 200 },
        air: { frequency: 12000, q: 0.7, threshold: -45, gain: 6, range: 10, attack: 5, release: 100 },
        drumsnap: { frequency: 5000, q: 2.0, threshold: -40, gain: 8, range: 12, attack: 1, release: 50 },
        warmth: { frequency: 250, q: 1.2, threshold: -42, gain: 5, range: 10, attack: 15, release: 150 }
    };

    const p = presets[presetName];
    if (!p) return;

    const settings = getSettings('dynamiceq');
    settings.frequency = p.frequency;
    settings.q = p.q;
    settings.threshold = p.threshold;
    settings.gain = p.gain;
    settings.range = p.range;
    settings.attack = p.attack;
    settings.release = p.release;
    settings.lastPreset = presetName;
    saveSettings('dynamiceq', settings);

    // Update knob instances directly
    ['frequency', 'q', 'threshold', 'gain', 'range', 'attack', 'release'].forEach(param => {
        const knob = SFX.knobInstances[`dynamiceq_${param}`];
        if (knob) {
            knob.setValue(p[param === 'gain' ? 'gain' : param]);
        }
    });

    applyEffect('dynamiceq');
    document.querySelectorAll('#dynamiceqPanel .dynamiceq-preset-btn').forEach((btn) => {
        const active = btn.dataset.preset === presetName;
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    console.log('🔄 Dynamic EQ preset applied:', presetName);
}

/**
 * Tape Saturation Hazır Ayarlarını Uygula
 * @param {string} presetName 
 */
function applyTapeSatPreset(presetName) {
    const presets = {
        subtle: { driveDb: 4, mix: 35, tone: 45, outputDb: 0, mode: 1, hiss: 0 },
        lofi: { driveDb: 12, mix: 70, tone: 25, outputDb: -2, mode: 2, hiss: 20 },
        glue: { driveDb: 6, mix: 40, tone: 55, outputDb: -1, mode: 0, hiss: 0 },
        crisp: { driveDb: 5, mix: 35, tone: 70, outputDb: 0, mode: 0, hiss: 0 }
    };

    const p = presets[presetName];
    if (!p) return;

    // Update settings
    const settings = getSettings('tapesat');
    Object.assign(settings, p);
    settings.lastPreset = presetName;
    saveSettings('tapesat', settings);

    // Update UI elements
    const panel = document.getElementById('tapesatPanel');
    if (panel) {
        // Update Knobs
        ['driveDb', 'mix', 'tone', 'outputDb', 'hiss'].forEach(param => {
            const instance = SFX.knobInstances[`tapesat_${param}`];
            if (instance) instance.setValue(p[param]);
        });

        // Update Mode Buttons Visuals
        const btns = panel.querySelectorAll('.mode-btn');
        btns.forEach(btn => {
            const m = parseInt(btn.dataset.mode);
            if (m === settings.mode) {
                btn.classList.add('active');
                btn.style.borderColor = '#00d4ff';
                btn.style.background = 'rgba(0, 212, 255, 0.2)';
            } else {
                btn.classList.remove('active');
                btn.style.borderColor = '#444';
                btn.style.background = '#1a1a1a';
            }
        });
    }

    // Apply to native
    applyEffect('tapesat');
    document.querySelectorAll('#tapesatPanel .tapesat-modern-preset-btn').forEach((btn) => {
        const active = btn.dataset.preset === presetName;
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    console.log(`🔄 Tape Saturation preset applied: ${presetName}. Mode: ${settings.mode}`);
}

/**
 * Bit-depth / Dither Hazır Ayarlarını Uygula
 * @param {string} presetName 
 */
function applyBitDitherPreset(presetName) {
    const presets = {
        'cd16': { bitDepth: 16, dither: 2, shaping: 1, downsample: 1, mix: 100, outputDb: 0 },
        'retro12': { bitDepth: 12, dither: 2, shaping: 0, downsample: 2, mix: 100, outputDb: -1 },
        'game8': { bitDepth: 8, dither: 1, shaping: 0, downsample: 8, mix: 100, outputDb: -2 },
        'vinyl': { bitDepth: 12, dither: 2, shaping: 0, downsample: 4, mix: 70, outputDb: 0 },
        'crunch': { bitDepth: 16, dither: 0, shaping: 0, downsample: 1, mix: 25, outputDb: 0 }
    };

    const p = presets[presetName];
    if (!p) return;

    const settings = getSettings('bitdither');
    Object.assign(settings, p);
    settings.lastPreset = presetName;
    saveSettings('bitdither', settings);

    // UI Update
    const panel = document.getElementById('bitditherPanel');
    if (panel) {
        // Dropdowns
        ['bitDepth', 'dither', 'shaping', 'downsample'].forEach(id => {
            const el = document.getElementById(`bitdither${id.charAt(0).toUpperCase() + id.slice(1)}`);
            if (el) el.value = settings[id];
        });

        // Knobs
        ['mix', 'outputDb'].forEach(param => {
            const instance = SFX.knobInstances[`bitdither_${param}`];
            if (instance) instance.setValue(settings[param]);
        });
    }

    applyEffect('bitdither');
    document.querySelectorAll('#bitditherPanel .bitdither-preset-btn').forEach((btn) => {
        const active = btn.dataset.preset === presetName;
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    console.log('🔄 BitDither preset applied:', presetName);
}
;

/**
 * Tape Saturation Modu Ayarla (UI)
 * @param {number} mode 0=Tape, 1=Warm, 2=Hot
 */
function setTapeModeUI(mode) {
    console.log(`[TAPE SAT UI] Mode button clicked: ${mode}`);

    // Save model state
    const settings = getSettings('tapesat');
    settings.mode = mode;
    saveSettings('tapesat', settings);

    // Visual feedback: Update buttons
    const panel = document.getElementById('tapesatPanel');
    if (panel) {
        const btns = panel.querySelectorAll('.mode-btn');
        btns.forEach(btn => {
            const m = parseInt(btn.dataset.mode);
            if (m === mode) {
                btn.classList.add('active');
                btn.style.borderColor = '#00d4ff';
                btn.style.background = 'rgba(0, 212, 255, 0.2)';
            } else {
                btn.classList.remove('active');
                btn.style.borderColor = '#444';
                btn.style.background = '#1a1a1a';
            }
        });
    }

    // Apply to DSP
    applyEffect('tapesat');
}

// Window'a expose et (HTML onclick için)
window.selectIRPreset = selectIRPreset;
window.applyDynamicEQPreset = applyDynamicEQPreset;
window.applyTapeSatPreset = applyTapeSatPreset;
window.setTapeModeUI = setTapeModeUI;

/**
 * Bit-depth / Dither seçici değişikliği
 */
window.updateBitDitherSelect = function (param, value) {
    const settings = getSettings('bitdither');
    settings[param] = parseInt(value);
    saveSettings('bitdither', settings);
    applyEffect('bitdither');
    console.log(`[BITDITHER UI] ${param} changed:`, value);
};

// ============================================
// EXPORT
// ============================================
window.SFX = SFX;
