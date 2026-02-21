// ============================================
// AURIVO MEDIA PLAYER - Preload Betiği
// Native Ses Motoru için Güvenli IPC Köprüsü
// Sürüm 2.1 - Tüm Ses Main Process IPC üzerinden
// ============================================

const AURIVO_VERBOSE_LOGS =
    typeof process !== 'undefined' &&
    process?.env &&
    process.env.AURIVO_VERBOSE_LOGS === '1';

const preloadLog = (...args) => {
    if (AURIVO_VERBOSE_LOGS) console.log(...args);
};

preloadLog('[PRELOAD] Script basliyor...');

const { contextBridge, ipcRenderer, clipboard } = require('electron');
const path = require('path');
const os = require('os');
const { pathToFileURL } = require('url');

preloadLog('[PRELOAD] Electron modulleri yuklendi');

// ============================================
// "Open with" / second-instance file delivery buffer
// Attach listener ASAP so early messages are not missed.
// ============================================
if (!globalThis.__aurivoOpenFilesState) {
    globalThis.__aurivoOpenFilesState = {
        buffered: [],
        callbacks: new Set(),
        listenerAttached: false
    };
}

try {
    const state = globalThis.__aurivoOpenFilesState;
    if (!state.listenerAttached) {
        state.listenerAttached = true;
        ipcRenderer.on('app:open-files', (_event, filePaths) => {
            const list = Array.isArray(filePaths) ? filePaths.filter(Boolean) : [];
            if (!list.length) return;

            const cbCount = state.callbacks.size;
            if (!cbCount) {
                state.buffered.push(...list);
                return;
            }

            for (const cb of Array.from(state.callbacks)) {
                try { cb(list); } catch { }
            }
        });
    }
} catch {
    // ignore
}

// ============================================
// Native Audio artık SADECE Main Process'te!
// Renderer process'te native modül yüklemiyoruz
// ============================================
let isNativeAvailable = true; // Main process'ten kontrol edilecek

// ============================================
// EQ Frekansları (32 bant)
// ============================================
const EQ_FREQUENCIES = [
    20, 25, 31.5, 40, 50, 63, 80, 100,
    125, 160, 200, 250, 315, 400, 500, 630,
    800, 1000, 1250, 1600, 2000, 2500, 3150, 4000,
    5000, 6300, 8000, 10000, 12500, 16000, 20000, 20000
];

// ============================================
// IPC tabanlı Ses Kontrol API
// Tüm audio işlemleri main process'e IPC ile gönderilir
// ============================================
const createIPCAudioAPI = () => {
    return {
        eq: {
            setBand: (band, gain) => ipcRenderer.invoke('audio:setEQBand', band, gain),
            resetBands: () => ipcRenderer.invoke('audio:resetEQ'),
            getFrequencies: () => EQ_FREQUENCIES
        },
        balance: {
            set: (value) => ipcRenderer.invoke('audio:setBalance', value)
        },
        module: {
            setBass: (dB) => ipcRenderer.invoke('audio:setBass', dB),
            setMid: (dB) => ipcRenderer.invoke('audio:setMid', dB),
            setTreble: (dB) => ipcRenderer.invoke('audio:setTreble', dB),
            setStereoExpander: (percent) => ipcRenderer.invoke('audio:setStereoExpander', percent),
            reset: async () => {
                await ipcRenderer.invoke('audio:setBass', 0);
                await ipcRenderer.invoke('audio:setMid', 0);
                await ipcRenderer.invoke('audio:setTreble', 0);
                await ipcRenderer.invoke('audio:setStereoExpander', 100);
                return true;
            }
        },
        reverb: {
            setEnabled: (enabled) => ipcRenderer.invoke('audio:setReverbEnabled', enabled),
            setRoomSize: (ms) => ipcRenderer.invoke('audio:setReverbRoomSize', ms),
            setDamping: (value) => ipcRenderer.invoke('audio:setReverbDamping', value),
            setWetDry: (dB) => ipcRenderer.invoke('audio:setReverbWetDry', dB),
            setHFRatio: (ratio) => ipcRenderer.invoke('audio:setReverbHFRatio', ratio),
            setInputGain: (dB) => ipcRenderer.invoke('audio:setReverbInputGain', dB),
            reset: async () => {
                await ipcRenderer.invoke('audio:setReverbEnabled', false);
                return true;
            }
        },
        compressor: {
            enable: (enabled) => ipcRenderer.invoke('audio:enableCompressor', enabled),
            setThreshold: (dB) => ipcRenderer.invoke('audio:setCompressorThreshold', dB),
            setRatio: (ratio) => ipcRenderer.invoke('audio:setCompressorRatio', ratio),
            setAttack: (ms) => ipcRenderer.invoke('audio:setCompressorAttack', ms),
            setRelease: (ms) => ipcRenderer.invoke('audio:setCompressorRelease', ms),
            setMakeupGain: (dB) => ipcRenderer.invoke('audio:setCompressorMakeupGain', dB),
            setKnee: (dB) => ipcRenderer.invoke('audio:setCompressorKnee', dB),
            getGainReduction: () => ipcRenderer.invoke('audio:getCompressorGainReduction'),
            reset: () => ipcRenderer.invoke('audio:resetCompressor'),
            set: (enabled, thresh, ratio, att, rel, makeup) =>
                ipcRenderer.invoke('audio:setCompressor', enabled, thresh, ratio, att, rel, makeup)
        },
        gate: {
            set: (enabled, thresh, att, rel) =>
                ipcRenderer.invoke('audio:setGate', enabled, thresh, att, rel)
        },
        limiter: {
            set: (enabled, ceiling, rel) =>
                ipcRenderer.invoke('audio:setLimiter', enabled, ceiling, rel),
            enable: (enabled) => ipcRenderer.invoke('audio:enableLimiter', enabled),
            setCeiling: (dB) => ipcRenderer.invoke('audio:setLimiterCeiling', dB),
            setRelease: (ms) => ipcRenderer.invoke('audio:setLimiterRelease', ms),
            setLookahead: (ms) => ipcRenderer.invoke('audio:setLimiterLookahead', ms),
            setGain: (dB) => ipcRenderer.invoke('audio:setLimiterGain', dB),
            getReduction: () => ipcRenderer.invoke('audio:getLimiterReduction'),
            reset: () => ipcRenderer.invoke('audio:resetLimiter')
        },
        bassEnhancer: {
            enable: (enabled) => ipcRenderer.invoke('audio:enableBassEnhancer', enabled),
            setFrequency: (hz) => ipcRenderer.invoke('audio:setBassEnhancerFrequency', hz),
            setGain: (dB) => ipcRenderer.invoke('audio:setBassEnhancerGain', dB),
            setHarmonics: (percent) => ipcRenderer.invoke('audio:setBassEnhancerHarmonics', percent),
            setWidth: (value) => ipcRenderer.invoke('audio:setBassEnhancerWidth', value),
            setMix: (percent) => ipcRenderer.invoke('audio:setBassEnhancerMix', percent),
            reset: () => ipcRenderer.invoke('audio:resetBassEnhancer')
        },
        noiseGate: {
            enable: (enabled) => ipcRenderer.invoke('audio:enableNoiseGate', enabled),
            setThreshold: (dB) => ipcRenderer.invoke('audio:setNoiseGateThreshold', dB),
            setAttack: (ms) => ipcRenderer.invoke('audio:setNoiseGateAttack', ms),
            setHold: (ms) => ipcRenderer.invoke('audio:setNoiseGateHold', ms),
            setRelease: (ms) => ipcRenderer.invoke('audio:setNoiseGateRelease', ms),
            setRange: (dB) => ipcRenderer.invoke('audio:setNoiseGateRange', dB),
            getStatus: () => ipcRenderer.invoke('audio:getNoiseGateStatus'),
            reset: () => ipcRenderer.invoke('audio:resetNoiseGate')
        },
        deEsser: {
            enable: (enabled) => ipcRenderer.invoke('audio:enableDeEsser', enabled),
            setFrequency: (hz) => ipcRenderer.invoke('audio:setDeEsserFrequency', hz),
            setThreshold: (dB) => ipcRenderer.invoke('audio:setDeEsserThreshold', dB),
            setRatio: (ratio) => ipcRenderer.invoke('audio:setDeEsserRatio', ratio),
            setRange: (dB) => ipcRenderer.invoke('audio:setDeEsserRange', dB),
            setListenMode: (listen) => ipcRenderer.invoke('audio:setDeEsserListenMode', listen),
            getActivity: () => ipcRenderer.invoke('audio:getDeEsserActivity'),
            reset: () => ipcRenderer.invoke('audio:resetDeEsser')
        },
        exciter: {
            enable: (enabled) => ipcRenderer.invoke('audio:enableExciter', enabled),
            setAmount: (percent) => ipcRenderer.invoke('audio:setExciterAmount', percent),
            setFrequency: (hz) => ipcRenderer.invoke('audio:setExciterFrequency', hz),
            setHarmonics: (percent) => ipcRenderer.invoke('audio:setExciterHarmonics', percent),
            setMix: (percent) => ipcRenderer.invoke('audio:setExciterMix', percent),
            setType: (type) => ipcRenderer.invoke('audio:setExciterType', type),
            reset: () => ipcRenderer.invoke('audio:resetExciter')
        },
        stereoWidener: {
            enable: (enabled) => ipcRenderer.invoke('audio:enableStereoWidener', enabled),
            setWidth: (percent) => ipcRenderer.invoke('audio:setStereoWidenerWidth', percent),
            setBassCutoff: (hz) => ipcRenderer.invoke('audio:setStereoBassCutoff', hz),
            setDelay: (ms) => ipcRenderer.invoke('audio:setStereoDelay', ms),
            setBalance: (value) => ipcRenderer.invoke('audio:setStereoWidenerBalance', value),
            setMonoLow: (enabled) => ipcRenderer.invoke('audio:setStereoMonoLow', enabled),
            getPhase: () => ipcRenderer.invoke('audio:getStereoPhase'),
            reset: () => ipcRenderer.invoke('audio:resetStereoWidener')
        },
        echo: {
            enable: (enabled) => ipcRenderer.invoke('audio:enableEchoEffect', enabled),
            setDelay: (delayMs) => ipcRenderer.invoke('audio:setEchoDelay', delayMs),
            setFeedback: (feedback) => ipcRenderer.invoke('audio:setEchoFeedback', feedback),
            setWetMix: (wetMix) => ipcRenderer.invoke('audio:setEchoWetMix', wetMix),
            setDryMix: (dryMix) => ipcRenderer.invoke('audio:setEchoDryMix', dryMix),
            setStereoMode: (stereo) => ipcRenderer.invoke('audio:setEchoStereoMode', stereo),
            setLowCut: (freq) => ipcRenderer.invoke('audio:setEchoLowCut', freq),
            setHighCut: (freq) => ipcRenderer.invoke('audio:setEchoHighCut', freq),
            setTempo: (bpm, division) => ipcRenderer.invoke('audio:setEchoTempo', bpm, division),
            reset: () => ipcRenderer.invoke('audio:resetEchoEffect'),
            // Eski API - geriye uyumluluk
            set: (enabled, delay, feedback, mix) =>
                ipcRenderer.invoke('audio:setEcho', enabled, delay, feedback, mix)
        },
        convolutionReverb: {
            enable: (enabled) => ipcRenderer.invoke('audio:enableConvolutionReverb', enabled),
            loadIR: (filepath) => ipcRenderer.invoke('audio:loadIRFile', filepath),
            setRoomSize: (percent) => ipcRenderer.invoke('audio:setConvReverbRoomSize', percent),
            setDecay: (seconds) => ipcRenderer.invoke('audio:setConvReverbDecay', seconds),
            setDamping: (value) => ipcRenderer.invoke('audio:setConvReverbDamping', value),
            setWetMix: (percent) => ipcRenderer.invoke('audio:setConvReverbWetMix', percent),
            setDryMix: (percent) => ipcRenderer.invoke('audio:setConvReverbDryMix', percent),
            setPreDelay: (ms) => ipcRenderer.invoke('audio:setConvReverbPreDelay', ms),
            setRoomType: (type) => ipcRenderer.invoke('audio:setConvReverbRoomType', type),
            getPresets: () => ipcRenderer.invoke('audio:getIRPresets'),
            reset: () => ipcRenderer.invoke('audio:resetConvolutionReverb')
        },
        crossfeed: {
            enable: (enabled) => ipcRenderer.invoke('audio:enableCrossfeed', enabled),
            setLevel: (percent) => ipcRenderer.invoke('audio:setCrossfeedLevel', percent),
            setDelay: (ms) => ipcRenderer.invoke('audio:setCrossfeedDelay', ms),
            setLowCut: (hz) => ipcRenderer.invoke('audio:setCrossfeedLowCut', hz),
            setHighCut: (hz) => ipcRenderer.invoke('audio:setCrossfeedHighCut', hz),
            setPreset: (preset) => ipcRenderer.invoke('audio:setCrossfeedPreset', preset),
            getParams: () => ipcRenderer.invoke('audio:getCrossfeedParams'),
            reset: () => ipcRenderer.invoke('audio:resetCrossfeed')
        },
        bassBoostDsp: {
            set: (enabled, gain, freq) =>
                ipcRenderer.invoke('audio:setBassBoostDsp', enabled, gain, freq)
        },
        peq: {
            setBand: (band, freq, gain, q, enabled = true) =>
                ipcRenderer.invoke('audio:setPEQ', band, enabled, freq, gain, q),
            setFilterType: (band, filterType) =>
                ipcRenderer.invoke('audio:setPEQFilterType', band, filterType),
            getBand: (band) =>
                ipcRenderer.invoke('audio:getPEQBand', band)
        },
        autoGain: {
            setEnabled: (enabled) => ipcRenderer.invoke('audio:setAutoGainEnabled', enabled),
            setTarget: (dBFS) => ipcRenderer.invoke('audio:setAutoGainTarget', dBFS),
            setMaxGain: (dB) => ipcRenderer.invoke('audio:setAutoGainMaxGain', dB),
            setAttack: (ms) => ipcRenderer.invoke('audio:setAutoGainAttack', ms),
            setRelease: (ms) => ipcRenderer.invoke('audio:setAutoGainRelease', ms),
            setMode: (mode) => ipcRenderer.invoke('audio:setAutoGainMode', mode),
            update: () => ipcRenderer.invoke('audio:updateAutoGain'),
            normalize: (targetDB) => ipcRenderer.invoke('audio:normalizeAudio', targetDB),
            reset: () => ipcRenderer.invoke('audio:resetAutoGain'),
            getStats: () => ipcRenderer.invoke('audio:getAutoGainStats'),
            getPeakLevel: () => ipcRenderer.invoke('audio:getPeakLevel'),
            getReduction: () => ipcRenderer.invoke('audio:getGainReduction')
        }
    };
};

// ============================================
// Audio API (IPC-Based - Main Process'e yönlendirir)
// ============================================
const createAudioAPI = () => {
    return {
        // Temel Kontroller
        isNativeAvailable: () => isNativeAvailable,

        init: async (deviceIndex = -1) => {
            const available = await ipcRenderer.invoke('audio:isNativeAvailable');
            isNativeAvailable = available;
            return { success: available };
        },

        loadFile: async (filepath) => {
            console.log('[IPC-Audio] loadFile:', filepath);
            return await ipcRenderer.invoke('audio:loadFile', filepath);
        },

        crossfadeTo: async (filepath, durationMs = 2000) => {
            console.log('[IPC-Audio] crossfadeTo:', filepath, 'ms:', durationMs);
            return await ipcRenderer.invoke('audio:crossfadeTo', filepath, durationMs);
        },

        play: () => ipcRenderer.invoke('audio:play'),
        pause: () => ipcRenderer.invoke('audio:pause'),
        stop: () => ipcRenderer.invoke('audio:stop'),
        seek: (positionMs) => ipcRenderer.invoke('audio:seek', positionMs),

        setVolume: (value) => ipcRenderer.invoke('audio:setVolume', value),
        fadeVolumeTo: (target, durationMs) => ipcRenderer.invoke('audio:fadeVolumeTo', target, durationMs),
        getVolume: async () => (await ipcRenderer.invoke('audio:getVolume')) || 0,

        // DSP Master Etkinleştir/Devre dışı bırak
        setEffectsEnabled: (enabled) => ipcRenderer.invoke('audio:setDSPEnabled', enabled),
        setDSPEnabled: (enabled) => ipcRenderer.invoke('audio:setDSPEnabled', enabled),

        getCurrentTime: async () => {
            const ms = await ipcRenderer.invoke('audio:getPosition');
            return (ms || 0) / 1000;
        },
        getPosition: () => ipcRenderer.invoke('audio:getPosition'),

        getDuration: async () => {
            const ms = await ipcRenderer.invoke('audio:getDuration');
            return (ms || 0) / 1000;
        },

        isPlaying: () => ipcRenderer.invoke('audio:isPlaying'),

        // Event Listeners
        on: (channel, callback) => {
            // Map simple names to namespaced IPC channels if needed
            // For 'frequencyData', we assume main sends 'audio:frequencyData'
            const ipcChannel = channel.includes(':') ? channel : `audio:${channel}`;
            ipcRenderer.on(ipcChannel, (_, ...args) => callback(...args));
        },

        // 32-Band Equalizer
        eq: {
            setBand: (index, gain) => ipcRenderer.invoke('audio:setEQBand', index, gain),
            getBand: (index) => ipcRenderer.invoke('audio:getEQBand', index),
            getAllBands: () => ipcRenderer.invoke('audio:getAllEQBands'),
            setAllBands: (gains) => ipcRenderer.invoke('audio:setEQBands', gains),
            resetBands: () => ipcRenderer.invoke('audio:resetEQ'),
            getFrequencies: () => EQ_FREQUENCIES
        },

        // Bass Boost
        bass: {
            setBoost: (value) => ipcRenderer.invoke('audio:setBassBoost', value),
            getBoost: () => ipcRenderer.invoke('audio:getBassBoost')
        },

        // Preamp
        preamp: {
            set: (value) => ipcRenderer.invoke('audio:setPreamp', value),
            get: () => ipcRenderer.invoke('audio:getPreamp')
        },

        // Auto Gain / Normalize et
        autoGain: {
            setEnabled: (enabled) => ipcRenderer.invoke('audio:setAutoGainEnabled', enabled),
            setTarget: (dBFS) => ipcRenderer.invoke('audio:setAutoGainTarget', dBFS),
            setMaxGain: (dB) => ipcRenderer.invoke('audio:setAutoGainMaxGain', dB),
            setAttack: (ms) => ipcRenderer.invoke('audio:setAutoGainAttack', ms),
            setRelease: (ms) => ipcRenderer.invoke('audio:setAutoGainRelease', ms),
            setMode: (mode) => ipcRenderer.invoke('audio:setAutoGainMode', mode),
            update: () => ipcRenderer.invoke('audio:updateAutoGain'),
            normalize: (targetDB) => ipcRenderer.invoke('audio:normalizeAudio', targetDB),
            reset: () => ipcRenderer.invoke('audio:resetAutoGain'),
            getStats: () => ipcRenderer.invoke('audio:getAutoGainStats'),
            getPeakLevel: () => ipcRenderer.invoke('audio:getPeakLevel'),
            getReduction: () => ipcRenderer.invoke('audio:getGainReduction')
        },

        // True Peak Limiter + Meter
        truePeakLimiter: {
            setEnabled: (enabled) => ipcRenderer.invoke('audio:setTruePeakEnabled', enabled),
            setCeiling: (dBFS) => ipcRenderer.invoke('audio:setTruePeakCeiling', dBFS),
            setRelease: (ms) => ipcRenderer.invoke('audio:setTruePeakRelease', ms),
            setLookahead: (ms) => ipcRenderer.invoke('audio:setTruePeakLookahead', ms),
            setOversampling: (rate) => ipcRenderer.invoke('audio:setTruePeakOversampling', rate),
            setLinkChannels: (link) => ipcRenderer.invoke('audio:setTruePeakLinkChannels', link),
            getMeter: () => ipcRenderer.invoke('audio:getTruePeakMeter'),
            resetClipping: () => ipcRenderer.invoke('audio:resetTruePeakClipping'),
            reset: () => ipcRenderer.invoke('audio:resetTruePeakLimiter')
        },

        // Spectrum / FFT
        spectrum: {
            getFFT: () => ipcRenderer.invoke('audio:getFFTData'),
            getBands: (numBands) => ipcRenderer.invoke('audio:getSpectrumBands', numBands || 64),
            getLevels: () => ipcRenderer.invoke('audio:getChannelLevels')
        },

        // Balance
        balance: {
            set: (value) => ipcRenderer.invoke('audio:setBalance', value),
            get: () => ipcRenderer.invoke('audio:getBalance')
        },

        // Aurivo Module
        module: {
            setBass: (dB) => ipcRenderer.invoke('audio:setBass', dB),
            getBass: () => ipcRenderer.invoke('audio:getBass'),
            setMid: (dB) => ipcRenderer.invoke('audio:setMid', dB),
            getMid: () => ipcRenderer.invoke('audio:getMid'),
            setTreble: (dB) => ipcRenderer.invoke('audio:setTreble', dB),
            getTreble: () => ipcRenderer.invoke('audio:getTreble'),
            setStereoExpander: (percent) => ipcRenderer.invoke('audio:setStereoExpander', percent),
            getStereoExpander: () => ipcRenderer.invoke('audio:getStereoExpander'),
            reset: async () => {
                await ipcRenderer.invoke('audio:setBass', 0);
                await ipcRenderer.invoke('audio:setMid', 0);
                await ipcRenderer.invoke('audio:setTreble', 0);
                await ipcRenderer.invoke('audio:setStereoExpander', 100);
                return true;
            }
        },

        // Reverb
        reverb: {
            setEnabled: (enabled) => ipcRenderer.invoke('audio:setReverbEnabled', enabled),
            isEnabled: () => ipcRenderer.invoke('audio:isReverbEnabled'),
            setRoomSize: (ms) => ipcRenderer.invoke('audio:setReverbRoomSize', ms),
            setDamping: (value) => ipcRenderer.invoke('audio:setReverbDamping', value),
            setWetDry: (dB) => ipcRenderer.invoke('audio:setReverbWetDry', dB),
            setHFRatio: (ratio) => ipcRenderer.invoke('audio:setReverbHFRatio', ratio),
            setInputGain: (dB) => ipcRenderer.invoke('audio:setReverbInputGain', dB),
            reset: () => ipcRenderer.invoke('audio:setReverbEnabled', false)
        },

        // Compressor
        compressor: {
            enable: (enabled) => ipcRenderer.invoke('audio:enableCompressor', enabled),
            setThreshold: (dB) => ipcRenderer.invoke('audio:setCompressorThreshold', dB),
            setRatio: (ratio) => ipcRenderer.invoke('audio:setCompressorRatio', ratio),
            setAttack: (ms) => ipcRenderer.invoke('audio:setCompressorAttack', ms),
            setRelease: (ms) => ipcRenderer.invoke('audio:setCompressorRelease', ms),
            setMakeupGain: (dB) => ipcRenderer.invoke('audio:setCompressorMakeupGain', dB),
            setKnee: (dB) => ipcRenderer.invoke('audio:setCompressorKnee', dB),
            getGainReduction: () => ipcRenderer.invoke('audio:getCompressorGainReduction'),
            reset: () => ipcRenderer.invoke('audio:resetCompressor'),
            set: (enabled, thresh, ratio, att, rel, makeup) =>
                ipcRenderer.invoke('audio:setCompressor', enabled, thresh, ratio, att, rel, makeup)
        },

        // Noise Gate
        gate: {
            set: (enabled, thresh, att, rel) =>
                ipcRenderer.invoke('audio:setGate', enabled, thresh, att, rel)
        },

        // Limiter
        limiter: {
            set: (enabled, ceiling, rel) =>
                ipcRenderer.invoke('audio:setLimiter', enabled, ceiling, rel),
            enable: (enabled) => ipcRenderer.invoke('audio:enableLimiter', enabled),
            setCeiling: (dB) => ipcRenderer.invoke('audio:setLimiterCeiling', dB),
            setRelease: (ms) => ipcRenderer.invoke('audio:setLimiterRelease', ms),
            setLookahead: (ms) => ipcRenderer.invoke('audio:setLimiterLookahead', ms),
            setGain: (dB) => ipcRenderer.invoke('audio:setLimiterGain', dB),
            getReduction: () => ipcRenderer.invoke('audio:getLimiterReduction'),
            reset: () => ipcRenderer.invoke('audio:resetLimiter')
        },

        // Bass Enhancer
        bassEnhancer: {
            enable: (enabled) => ipcRenderer.invoke('audio:enableBassEnhancer', enabled),
            setFrequency: (hz) => ipcRenderer.invoke('audio:setBassEnhancerFrequency', hz),
            setGain: (dB) => ipcRenderer.invoke('audio:setBassEnhancerGain', dB),
            setHarmonics: (percent) => ipcRenderer.invoke('audio:setBassEnhancerHarmonics', percent),
            setWidth: (value) => ipcRenderer.invoke('audio:setBassEnhancerWidth', value),
            setMix: (percent) => ipcRenderer.invoke('audio:setBassEnhancerMix', percent),
            reset: () => ipcRenderer.invoke('audio:resetBassEnhancer')
        },

        // Noise Gate (Advanced)
        noiseGate: {
            enable: (enabled) => ipcRenderer.invoke('audio:enableNoiseGate', enabled),
            setThreshold: (dB) => ipcRenderer.invoke('audio:setNoiseGateThreshold', dB),
            setAttack: (ms) => ipcRenderer.invoke('audio:setNoiseGateAttack', ms),
            setHold: (ms) => ipcRenderer.invoke('audio:setNoiseGateHold', ms),
            setRelease: (ms) => ipcRenderer.invoke('audio:setNoiseGateRelease', ms),
            setRange: (dB) => ipcRenderer.invoke('audio:setNoiseGateRange', dB),
            getStatus: () => ipcRenderer.invoke('audio:getNoiseGateStatus'),
            reset: () => ipcRenderer.invoke('audio:resetNoiseGate')
        },

        // De-esser
        deEsser: {
            enable: (enabled) => ipcRenderer.invoke('audio:enableDeEsser', enabled),
            setFrequency: (hz) => ipcRenderer.invoke('audio:setDeEsserFrequency', hz),
            setThreshold: (dB) => ipcRenderer.invoke('audio:setDeEsserThreshold', dB),
            setRatio: (ratio) => ipcRenderer.invoke('audio:setDeEsserRatio', ratio),
            setRange: (dB) => ipcRenderer.invoke('audio:setDeEsserRange', dB),
            setListenMode: (listen) => ipcRenderer.invoke('audio:setDeEsserListenMode', listen),
            getActivity: () => ipcRenderer.invoke('audio:getDeEsserActivity'),
            reset: () => ipcRenderer.invoke('audio:resetDeEsser')
        },

        // Exciter (Harmonic Enhancer)
        exciter: {
            enable: (enabled) => ipcRenderer.invoke('audio:enableExciter', enabled),
            setAmount: (percent) => ipcRenderer.invoke('audio:setExciterAmount', percent),
            setFrequency: (hz) => ipcRenderer.invoke('audio:setExciterFrequency', hz),
            setHarmonics: (percent) => ipcRenderer.invoke('audio:setExciterHarmonics', percent),
            setMix: (percent) => ipcRenderer.invoke('audio:setExciterMix', percent),
            setType: (type) => ipcRenderer.invoke('audio:setExciterType', type),
            reset: () => ipcRenderer.invoke('audio:resetExciter')
        },

        // Stereo Widener
        stereoWidener: {
            enable: (enabled) => ipcRenderer.invoke('audio:enableStereoWidener', enabled),
            setWidth: (percent) => ipcRenderer.invoke('audio:setStereoWidenerWidth', percent),
            setBassCutoff: (hz) => ipcRenderer.invoke('audio:setStereoBassCutoff', hz),
            setDelay: (ms) => ipcRenderer.invoke('audio:setStereoDelay', ms),
            setBalance: (value) => ipcRenderer.invoke('audio:setStereoWidenerBalance', value),
            setMonoLow: (enabled) => ipcRenderer.invoke('audio:setStereoMonoLow', enabled),
            getPhase: () => ipcRenderer.invoke('audio:getStereoPhase'),
            reset: () => ipcRenderer.invoke('audio:resetStereoWidener')
        },

        // Echo
        echo: {
            enable: (enabled) => ipcRenderer.invoke('audio:enableEchoEffect', enabled),
            setDelay: (delayMs) => ipcRenderer.invoke('audio:setEchoDelay', delayMs),
            setFeedback: (feedback) => ipcRenderer.invoke('audio:setEchoFeedback', feedback),
            setWetMix: (wetMix) => ipcRenderer.invoke('audio:setEchoWetMix', wetMix),
            setDryMix: (dryMix) => ipcRenderer.invoke('audio:setEchoDryMix', dryMix),
            setStereoMode: (stereo) => ipcRenderer.invoke('audio:setEchoStereoMode', stereo),
            setLowCut: (freq) => ipcRenderer.invoke('audio:setEchoLowCut', freq),
            setHighCut: (freq) => ipcRenderer.invoke('audio:setEchoHighCut', freq),
            setTempo: (bpm, division) => ipcRenderer.invoke('audio:setEchoTempo', bpm, division),
            reset: () => ipcRenderer.invoke('audio:resetEchoEffect'),
            // Eski API - geriye uyumluluk
            set: (enabled, delay, feedback, mix) =>
                ipcRenderer.invoke('audio:setEcho', enabled, delay, feedback, mix)
        },

        // Convolution Reverb
        convolutionReverb: {
            enable: (enabled) => ipcRenderer.invoke('audio:enableConvolutionReverb', enabled),
            loadIR: (filepath) => ipcRenderer.invoke('audio:loadIRFile', filepath),
            setRoomSize: (percent) => ipcRenderer.invoke('audio:setConvReverbRoomSize', percent),
            setDecay: (seconds) => ipcRenderer.invoke('audio:setConvReverbDecay', seconds),
            setDamping: (value) => ipcRenderer.invoke('audio:setConvReverbDamping', value),
            setWetMix: (percent) => ipcRenderer.invoke('audio:setConvReverbWetMix', percent),
            setDryMix: (percent) => ipcRenderer.invoke('audio:setConvReverbDryMix', percent),
            setPreDelay: (ms) => ipcRenderer.invoke('audio:setConvReverbPreDelay', ms),
            setRoomType: (type) => ipcRenderer.invoke('audio:setConvReverbRoomType', type),
            getPresets: () => ipcRenderer.invoke('audio:getIRPresets'),
            reset: () => ipcRenderer.invoke('audio:resetConvolutionReverb')
        },

        // Crossfeed (Kulaklık İyileştirme)
        crossfeed: {
            enable: (enabled) => ipcRenderer.invoke('audio:enableCrossfeed', enabled),
            setLevel: (percent) => ipcRenderer.invoke('audio:setCrossfeedLevel', percent),
            setDelay: (ms) => ipcRenderer.invoke('audio:setCrossfeedDelay', ms),
            setLowCut: (hz) => ipcRenderer.invoke('audio:setCrossfeedLowCut', hz),
            setHighCut: (hz) => ipcRenderer.invoke('audio:setCrossfeedHighCut', hz),
            setPreset: (preset) => ipcRenderer.invoke('audio:setCrossfeedPreset', preset),
            getParams: () => ipcRenderer.invoke('audio:getCrossfeedParams'),
            reset: () => ipcRenderer.invoke('audio:resetCrossfeed')
        },

        // Bass Mono (Low Frequency Mono Summing)
        bassMono: {
            enable: (enabled) => ipcRenderer.invoke('audio:enableBassMono', enabled),
            setCutoff: (hz) => ipcRenderer.invoke('audio:setBassMonoCutoff', hz),
            setSlope: (dbPerOct) => ipcRenderer.invoke('audio:setBassMonoSlope', dbPerOct),
            setStereoWidth: (percent) => ipcRenderer.invoke('audio:setBassMonoStereoWidth', percent),
            reset: () => ipcRenderer.invoke('audio:resetBassMono')
        },

        // Bass Boost DSP
        bassBoostDsp: {
            set: (enabled, gain, freq) =>
                ipcRenderer.invoke('audio:setBassBoostDsp', enabled, gain, freq)
        },

        // Parametric EQ
        peq: {
            setBand: (band, freq, gain, q, enabled = true) =>
                ipcRenderer.invoke('audio:setPEQ', band, enabled, freq, gain, q),
            setEnabled: (enabled) => {
                // Enable/disable için tüm bantlara enabled flag gönderilir
                // Renderer tarafında applyEffect('peq') çağrılmalı
                // Bu fonksiyon sadece geriye uyumluluk için var
                console.log('[PEQ preload] setEnabled called, use applyEffect instead');
            }
        },
        dynamicEQ: {
            enable: (enabled) => ipcRenderer.invoke('audio:enableDynamicEQ', enabled),
            setFrequency: (hz) => ipcRenderer.invoke('audio:setDynamicEQFrequency', hz),
            setGain: (dB) => ipcRenderer.invoke('audio:setDynamicEQGain', dB),
            setQ: (q) => ipcRenderer.invoke('audio:setDynamicEQQ', q),
            setThreshold: (dB) => ipcRenderer.invoke('audio:setDynamicEQThreshold', dB),
            setAttack: (ms) => ipcRenderer.invoke('audio:setDynamicEQAttack', ms),
            setRelease: (ms) => ipcRenderer.invoke('audio:setDynamicEQRelease', ms),
            setRange: (dB) => ipcRenderer.invoke('audio:setDynamicEQRange', dB),
            reset: async () => {
                await ipcRenderer.invoke('audio:enableDynamicEQ', false);
                return true;
            }
        },
        tapeSat: {
            enable: (enabled) => ipcRenderer.invoke('audio:enableTapeSaturation', enabled),
            setDrive: (dB) => ipcRenderer.invoke('audio:setTapeDrive', dB),
            setMix: (percent) => ipcRenderer.invoke('audio:setTapeMix', percent),
            setTone: (value) => ipcRenderer.invoke('audio:setTapeTone', value),
            setOutput: (dB) => ipcRenderer.invoke('audio:setTapeOutput', dB),
            setMode: (mode) => ipcRenderer.invoke('audio:setTapeMode', mode),
            setHiss: (percent) => ipcRenderer.invoke('audio:setTapeHiss', percent),
            reset: async () => {
                await ipcRenderer.invoke('audio:enableTapeSaturation', false);
                return true;
            }
        },
        bitDither: {
            enable: (enabled) => ipcRenderer.invoke('audio:enableBitDepthDither', enabled),
            setBitDepth: (bits) => ipcRenderer.invoke('audio:setBitDepth', bits),
            setDither: (type) => ipcRenderer.invoke('audio:setDitherType', type),
            setShaping: (shape) => ipcRenderer.invoke('audio:setNoiseShaping', shape),
            setDownsample: (factor) => ipcRenderer.invoke('audio:setDownsampleFactor', factor),
            setMix: (percent) => ipcRenderer.invoke('audio:setBitDitherMix', percent),
            setOutput: (dB) => ipcRenderer.invoke('audio:setBitDitherOutput', dB),
            reset: async () => {
                await ipcRenderer.invoke('audio:resetBitDepthDither');
                return true;
            }
        }
    };
};

// ============================================
// Context Bridge - Renderer'a Aç
// ============================================
const aurivoAPI = {
    // Dosya Sistemi
    openFile: () => ipcRenderer.invoke('dialog:openFile'),
    openFolder: (opts) => ipcRenderer.invoke('dialog:openFolder', opts),
    readDirectory: (dirPath) => ipcRenderer.invoke('fs:readDirectory', dirPath),
    getSpecialPaths: () => ipcRenderer.invoke('fs:getSpecialPaths'),
    fileExists: (filePath) => ipcRenderer.invoke('fs:exists', filePath),
    getFileInfo: (filePath) => ipcRenderer.invoke('fs:getFileInfo', filePath),

    // Medya Metadata
    getAlbumArt: (filePath) => ipcRenderer.invoke('media:getAlbumArt', filePath),
    getVideoThumbnail: (filePath) => ipcRenderer.invoke('media:getVideoThumbnail', filePath),

    // Ayarlar
    saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
    loadSettings: () => ipcRenderer.invoke('settings:load'),

    // Playlist
    savePlaylist: (playlist) => ipcRenderer.invoke('playlist:save', playlist),
    loadPlaylist: () => ipcRenderer.invoke('playlist:load'),

    // Dialog API
    dialog: {
        openFolder: (opts) => ipcRenderer.invoke('dialog:openFolder', opts),
        openFiles: (filters) => ipcRenderer.invoke('dialog:openFiles', filters)
    },

    // Clipboard API (URL otomatik yapıştırma için)
    clipboard: {
        getText: () => {
            try { return clipboard.readText(); } catch { return ''; }
        },
        setText: (text) => {
            try { clipboard.writeText(String(text ?? '')); return true; } catch { return false; }
        }
    },

    // Aurivo-Dawlod downloader window
    dawlod: {
        openWindow: (options) => ipcRenderer.invoke('dawlod:openWindow', options),
        setLocale: (lang) => ipcRenderer.invoke('dawlod:setLocale', lang)
    },

    // Web Security / Privacy helpers
    webSecurity: {
        openExternal: (url) => ipcRenderer.invoke('web:openExternal', url),
        clearData: (options) => ipcRenderer.invoke('web:clearData', options),
        getSecurityState: () => ipcRenderer.invoke('web:getSecurityState')
    },

    // C++ AUDIO ENGINE API (IPC-Based)
    audio: createAudioAPI(),

    // IPC AUDIO API (Sound Effects Window için - alias)
    ipcAudio: createAudioAPI(),

    // AUTOEQ PRESETS API
    presets: {
        loadPresetList: () => ipcRenderer.invoke('presets:loadList'),
        loadPreset: (filename) => ipcRenderer.invoke('presets:load', filename),
        searchPresets: (query) => ipcRenderer.invoke('presets:search', query),

        getFeaturedEQPresets: () => ipcRenderer.invoke('eqPresets:getFeaturedList'),

        // EQ Hazır Ayarlar penceresi
        openEQPresetsWindow: () => ipcRenderer.invoke('eqPresets:openWindow'),
        closeEQPresetsWindow: () => ipcRenderer.invoke('eqPresets:closeWindow'),
        selectEQPreset: (filename) => ipcRenderer.invoke('eqPresets:select', filename)
    },

    // SES EFEKTLERİ PENCERESİ API
    soundEffects: {
        openWindow: () => ipcRenderer.invoke('soundEffects:openWindow'),
        closeWindow: () => ipcRenderer.invoke('soundEffects:closeWindow')
    },

    // ELECTRON PENCERE KONTROL API
    electronAPI: {
        minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
        maximizeWindow: () => ipcRenderer.invoke('window:maximize'),
        closeWindow: () => ipcRenderer.invoke('window:close'),
        isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
        setFullscreen: (enabled) => ipcRenderer.invoke('window:setFullscreen', !!enabled),
        isFullscreen: () => ipcRenderer.invoke('window:isFullscreen'),
        setMenuBarVisible: (visible) => ipcRenderer.invoke('window:setMenuBarVisible', !!visible),
        onF11Hotkey: (callback) => {
            if (typeof callback !== 'function') return;
            ipcRenderer.on('hotkey:f11', () => {
                try { callback(); } catch { }
            });
        }
    },

    // APP CONTROL
    app: {
        relaunch: () => ipcRenderer.invoke('app:relaunch'),
        // When user double-clicks a media file while the app is already running,
        // main process forwards file paths here.
        onOpenFiles: (callback) => {
            try {
                if (typeof callback !== 'function') return;

                const state = globalThis.__aurivoOpenFilesState;
                state.callbacks.add(callback);

                // Flush any buffered files to this callback (once).
                if (Array.isArray(state.buffered) && state.buffered.length) {
                    const list = state.buffered.splice(0, state.buffered.length);
                    if (list.length) {
                        try { callback(list); } catch { }
                    }
                }
            } catch {
                // ignore
            }
        }
    },

    // AUTO UPDATE (electron-updater bridge)
    updater: {
        getState: () => ipcRenderer.invoke('update:getState'),
        check: () => ipcRenderer.invoke('update:check'),
        download: () => ipcRenderer.invoke('update:download'),
        install: () => ipcRenderer.invoke('update:install'),
        onState: (callback) => {
            ipcRenderer.on('update:state', (_event, state) => {
                try { callback(state || null); } catch { }
            });
        }
    },

    // I18N
    i18n: {
        loadLocale: (lang) => ipcRenderer.invoke('i18n:loadLocale', lang),
        getSystemLocale: () => ipcRenderer.invoke('get-system-locale')
    },

    // SYSTEM TRAY MEDIA CONTROL LISTENER
    onMediaControl: (callback) => {
        ipcRenderer.on('media-control', (event, action) => callback(action));
    },

    // TRAY'E PLAYBACK STATE GÖNDER
    updateTrayState: (state) => ipcRenderer.send('update-tray-state', state),

    // MPRIS'E METADATA GÖNDER (Linux ortam oynatıcısı)
    updateMPRISMetadata: (metadata) => ipcRenderer.send('update-mpris-metadata', metadata),

    // MPRIS SEEK listener
    onMPRISSeek: (callback) => {
        ipcRenderer.on('mpris-seek', (event, offset) => callback(offset));
    },

    // MPRIS POSITION listener
    onMPRISPosition: (callback) => {
        ipcRenderer.on('mpris-position', (event, position) => callback(position));
    },

    // Platform & Version Info
    platform: process.platform,
    version: '2.1.0',
    isNativeAudioAvailable: isNativeAvailable,
    
    // System Yollar API
    getHomeDir: () => os.homedir(),
    getUserName: () => os.userInfo().username,
    
    // Yol utilities
    path: {
        join: (...args) => path.join(...args),
        basename: (p) => path.basename(p),
        dirname: (p) => path.dirname(p),
        resolve: (...args) => path.resolve(...args),
        toFileUrl: (p) => {
            try {
                return pathToFileURL(String(p || '')).toString();
            } catch {
                return '';
            }
        }
    }
};

preloadLog('[PRELOAD] aurivoAPI objesi olusturuldu');
preloadLog('[PRELOAD] API anahtarlari:', Object.keys(aurivoAPI));

// Global fallback
try {
    globalThis.aurivo = aurivoAPI;
    preloadLog('[PRELOAD] globalThis.aurivo atandi');
} catch (e) {
    console.error('[PRELOAD] globalThis hata:', e.message);
}

// contextBridge ile güvenli expose
try {
    contextBridge.exposeInMainWorld('aurivo', aurivoAPI);
    preloadLog('[PRELOAD] contextBridge.exposeInMainWorld basarili');
} catch (e) {
    console.error('[PRELOAD] contextBridge hata:', e.message);
}

// Görselleştirici API (projectM native çalıştırılabilir)
const appAPI = {
    visualizer: {
        toggle: () => ipcRenderer.invoke('visualizer:toggle'),
        start: () => ipcRenderer.invoke('visualizer:start'),
        stop: () => ipcRenderer.invoke('visualizer:stop'),
        status: () => ipcRenderer.invoke('visualizer:status')
    }
};

try {
    globalThis.app = appAPI;
    preloadLog('[PRELOAD] globalThis.app atandi');
} catch (e) {
    console.error('[PRELOAD] globalThis.app hata:', e.message);
}

try {
    contextBridge.exposeInMainWorld('app', appAPI);
    preloadLog('[PRELOAD] contextBridge.exposeInMainWorld (app) basarili');
} catch (e) {
    console.error('[PRELOAD] contextBridge (app) hata:', e.message);
}

// Başlangıç logu (sade)
console.log(`[PRELOAD] ready | platform=${process.platform}`);
