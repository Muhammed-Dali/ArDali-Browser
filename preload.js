// ============================================
// ARDALI MEDIA PLAYER - Preload Betiği
// Native Ses Motoru için Güvenli IPC Köprüsü
// Sürüm 2.1 - Tüm Ses Main Process IPC üzerinden
// ============================================

const ARDALI_VERBOSE_LOGS =
    typeof process !== 'undefined' &&
    process?.env &&
    process.env.ARDALI_VERBOSE_LOGS === '1';

const preloadLog = (...args) => {
    if (ARDALI_VERBOSE_LOGS) console.log(...args);
};

preloadLog('[PRELOAD] Script basliyor...');

const { contextBridge, ipcRenderer, clipboard, webUtils } = require('electron');
const preloadArgv = Array.isArray(process?.argv) ? process.argv : [];
const preloadStandaloneView = String(
    preloadArgv.find((arg) => String(arg).startsWith('--ardali-view=')) || ''
).split('=').slice(1).join('=').trim().toLowerCase();
const preloadStandaloneTab = String(
    preloadArgv.find((arg) => String(arg).startsWith('--ardali-settings-tab=')) || ''
).split('=').slice(1).join('=').trim().toLowerCase();
const preloadStandaloneScope = String(
    preloadArgv.find((arg) => String(arg).startsWith('--ardali-settings-scope=')) || ''
).split('=').slice(1).join('=').trim().toLowerCase();
const path = require('path');
const os = require('os');
const { pathToFileURL } = require('url');

preloadLog('[PRELOAD] Electron modulleri yuklendi');

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
        softEcho: {
            enable: (enabled) => ipcRenderer.invoke('audio:enableSoftEchoEffect', enabled),
            setDelay: (delayMs) => ipcRenderer.invoke('audio:setSoftEchoDelay', delayMs),
            setFeedback: (feedback) => ipcRenderer.invoke('audio:setSoftEchoFeedback', feedback),
            setWetMix: (wetMix) => ipcRenderer.invoke('audio:setSoftEchoWetMix', wetMix),
            setDryMix: (dryMix) => ipcRenderer.invoke('audio:setSoftEchoDryMix', dryMix),
            setStereoMode: (stereo) => ipcRenderer.invoke('audio:setSoftEchoStereoMode', stereo),
            setHighCut: (freq) => ipcRenderer.invoke('audio:setSoftEchoHighCut', freq),
            reset: () => ipcRenderer.invoke('audio:resetSoftEchoEffect')
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
        surround: {
            enable: (enabled) => ipcRenderer.invoke('audio:enableSurroundVirtualizer', enabled),
            setCenter: (dB) => ipcRenderer.invoke('audio:setSurroundCenterLevel', dB),
            setSurround: (dB) => ipcRenderer.invoke('audio:setSurroundSideLevel', dB),
            setLfe: (dB) => ipcRenderer.invoke('audio:setSurroundLfeLevel', dB),
            setCrossover: (hz) => ipcRenderer.invoke('audio:setSurroundCrossover', hz),
            setDelay: (ms) => ipcRenderer.invoke('audio:setSurroundRearDelay', ms),
            setMix: (percent) => ipcRenderer.invoke('audio:setSurroundMix', percent),
            reset: () => ipcRenderer.invoke('audio:resetSurroundVirtualizer')
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

        devices: {
            get: () => ipcRenderer.invoke("audio:getDevices"),
            setDevice: (id) => ipcRenderer.invoke("audio:setDevice", id)
        },

        outputProfile: {
            configure: (profile) => ipcRenderer.invoke('audio:configureOutputProfile', profile || {}),
            getStatus: () => ipcRenderer.invoke('audio:getOutputProfileStatus')
        },

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
            setInputGain: (dB) => ipcRenderer.invoke('audio:setTruePeakInputGain', dB),
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
            getLevels: () => ipcRenderer.invoke('audio:getChannelLevels'),
            getPCM: (framesPerChannel) => ipcRenderer.invoke('audio:getPCMData', framesPerChannel || 1024)
        },

        // Balance
        balance: {
            set: (value) => ipcRenderer.invoke('audio:setBalance', value),
            get: () => ipcRenderer.invoke('audio:getBalance')
        },

        // ArDali Module
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
        softEcho: {
            enable: (enabled) => ipcRenderer.invoke('audio:enableSoftEchoEffect', enabled),
            setDelay: (delayMs) => ipcRenderer.invoke('audio:setSoftEchoDelay', delayMs),
            setFeedback: (feedback) => ipcRenderer.invoke('audio:setSoftEchoFeedback', feedback),
            setWetMix: (wetMix) => ipcRenderer.invoke('audio:setSoftEchoWetMix', wetMix),
            setDryMix: (dryMix) => ipcRenderer.invoke('audio:setSoftEchoDryMix', dryMix),
            setStereoMode: (stereo) => ipcRenderer.invoke('audio:setSoftEchoStereoMode', stereo),
            setHighCut: (freq) => ipcRenderer.invoke('audio:setSoftEchoHighCut', freq),
            reset: () => ipcRenderer.invoke('audio:resetSoftEchoEffect')
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
        surround: {
            enable: (enabled) => ipcRenderer.invoke('audio:enableSurroundVirtualizer', enabled),
            setCenter: (dB) => ipcRenderer.invoke('audio:setSurroundCenterLevel', dB),
            setSurround: (dB) => ipcRenderer.invoke('audio:setSurroundSideLevel', dB),
            setLfe: (dB) => ipcRenderer.invoke('audio:setSurroundLfeLevel', dB),
            setCrossover: (hz) => ipcRenderer.invoke('audio:setSurroundCrossover', hz),
            setDelay: (ms) => ipcRenderer.invoke('audio:setSurroundRearDelay', ms),
            setMix: (percent) => ipcRenderer.invoke('audio:setSurroundMix', percent),
            reset: () => ipcRenderer.invoke('audio:resetSurroundVirtualizer')
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
const ardaliAPI = {
    // Dosya Sistemi
    openFile: () => ipcRenderer.invoke('dialog:openFile'),
    openFolder: (opts) => ipcRenderer.invoke('dialog:openFolder', opts),
    saveFile: (opts) => ipcRenderer.invoke('dialog:saveFile', opts),
    readDirectory: (dirPath) => ipcRenderer.invoke('fs:readDirectory', dirPath),
    getSpecialPaths: () => ipcRenderer.invoke('fs:getSpecialPaths'),
    fileExists: (filePath) => ipcRenderer.invoke('fs:exists', filePath),
    isPathWritable: (filePath) => ipcRenderer.invoke('fs:isWritable', filePath),
    getFileInfo: (filePath) => ipcRenderer.invoke('fs:getFileInfo', filePath),
    getStorageStats: (targetPath) => ipcRenderer.invoke('fs:getStorageStats', targetPath),
    getSystemStats: () => ipcRenderer.invoke('app:getSystemStats'),
    readTextFile: (filePath) => ipcRenderer.invoke('fs:readText', filePath),
    writeTextFile: (filePath, text) => ipcRenderer.invoke('fs:writeText', filePath, text),
    writeBase64File: (filePath, base64Data) => ipcRenderer.invoke('fs:writeBase64', filePath, base64Data),
    writeBufferFile: (filePath, arrayBuffer) => ipcRenderer.invoke('fs:writeBuffer', filePath, arrayBuffer),
    renameItem: (sourcePath, nextName) => ipcRenderer.invoke('fs:renameItem', sourcePath, nextName),
    moveToTrash: (filePath) => ipcRenderer.invoke('fs:moveToTrash', filePath),
    openContainingFolder: (filePath) => ipcRenderer.invoke('fs:openContainingFolder', filePath),
    getPathProperties: (filePath) => ipcRenderer.invoke('fs:getPathProperties', filePath),

    // Medya Metadata
    getAlbumArt: (filePath) => ipcRenderer.invoke('media:getAlbumArt', filePath),
    getBestAlbumArt: (filePath, options) => ipcRenderer.invoke('media:getBestAlbumArt', filePath, options),
    getVideoThumbnail: (filePath) => ipcRenderer.invoke('media:getVideoThumbnail', filePath),
    getDisplayImagePath: (filePath, options) => ipcRenderer.invoke('media:getDisplayImagePath', filePath, options),
    videoTools: {
        convert: (options) => ipcRenderer.invoke('videoTools:convert', options || {}),
        onProgress: (callback) => {
            if (typeof callback !== 'function') return () => {};
            const handler = (_event, payload) => callback(payload || {});
            ipcRenderer.on('videoTools:progress', handler);
            return () => ipcRenderer.removeListener('videoTools:progress', handler);
        }
    },
    screenRecording: {
        getSources: () => ipcRenderer.invoke('screenRecording:getSources'),
        getFfmpegCapabilities: () => ipcRenderer.invoke('screenRecording:getFfmpegCapabilities'),
        getCursorPoint: () => ipcRenderer.invoke('screenRecording:getCursorPoint'),
        startSystemAudio: () => ipcRenderer.invoke('screenRecording:startSystemAudio'),
        stopSystemAudio: () => ipcRenderer.invoke('screenRecording:stopSystemAudio'),
        muxSystemAudio: (videoPath, audioPath) => ipcRenderer.invoke('screenRecording:muxSystemAudio', videoPath, audioPath),
        finalizeRecording: (inputPath, outputPath, options) => ipcRenderer.invoke('screenRecording:finalizeRecording', inputPath, outputPath, options || {}),
        repairRecording: (inputPath, outputPath, options) => ipcRenderer.invoke('screenRecording:repairRecording', inputPath, outputPath, options || {}),
        validateRecording: (filePath, options) => ipcRenderer.invoke('screenRecording:validateRecording', filePath, options || {}),
        listStudioPlugins: () => ipcRenderer.invoke('screenRecording:listStudioPlugins'),
        startLiveOutput: (options) => ipcRenderer.invoke('screenRecording:startLiveOutput', options || {}),
        writeLiveOutput: (id, chunk) => ipcRenderer.invoke('screenRecording:writeLiveOutput', id, chunk),
        stopLiveOutput: (id) => ipcRenderer.invoke('screenRecording:stopLiveOutput', id)
    },
    library: {
        getStats: (folders, metadataCache, excludedFolders, audioExtensions, performanceOptions) => ipcRenderer.invoke('library:getStats', folders, metadataCache, excludedFolders, audioExtensions, performanceOptions),
        getStatsComposite: (folders, extraFiles, metadataCache, excludedFolders, audioExtensions, performanceOptions) => ipcRenderer.invoke('library:getStatsComposite', folders, extraFiles, metadataCache, excludedFolders, audioExtensions, performanceOptions),
        refreshMetadata: (folders, options, excludedFolders, audioExtensions, performanceOptions) => ipcRenderer.invoke('library:refreshMetadata', folders, options, excludedFolders, audioExtensions, performanceOptions),
        startWatch: (folders, excludedFolders) => ipcRenderer.invoke('library:startWatch', folders, excludedFolders),
        stopWatch: () => ipcRenderer.invoke('library:stopWatch'),
        onWatchEvent: (callback) => {
            const handler = (_event, payload) => callback(payload);
            ipcRenderer.on('library:watch-event', handler);
            return () => ipcRenderer.removeListener('library:watch-event', handler);
        }
    },
    adblock: {
        openWindow: () => ipcRenderer.invoke('adblock:openWindow'),
        setConfig: (config) => ipcRenderer.invoke('adblock:setConfig', config || {}),
        getStats: () => ipcRenderer.invoke('adblock:getStats'),
        resetStats: () => ipcRenderer.invoke('adblock:resetStats'),
        listDevelopSources: () => ipcRenderer.invoke('adblock:listDevelopSources'),
        readDevelopSource: (sourceId) => ipcRenderer.invoke('adblock:readDevelopSource', sourceId),
        getScriptingInjection: (payload) => ipcRenderer.invoke('adblock:getScriptingInjection', payload || {})
    },

    // Ayarlar
    saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
    loadSettings: () => ipcRenderer.invoke('settings:load'),
    openSettingsWindow: (defaultTab) => ipcRenderer.invoke('settings:openWindow', defaultTab),
    launchContext: {
        view: preloadStandaloneView,
        tab: preloadStandaloneTab,
        scope: preloadStandaloneScope,
        perfMonitor: process?.env?.ARDALI_PERF_MONITOR === '1',
        perfMonitorIntervalMs: Number(process?.env?.ARDALI_PERF_MONITOR_INTERVAL_MS || 15000) || 15000,
        perfMonitorDelayMs: Number(process?.env?.ARDALI_PERF_MONITOR_DELAY_MS || 12000) || 12000,
        disableWebDali: process?.env?.ARDALI_DISABLE_WEB_DALI === '1' ||
            String(process?.env?.ARDALI_DISABLE_WEB_DALI || '').toLowerCase() === 'true',
        enableWebDali: process?.env?.ARDALI_ENABLE_WEB_DALI === '1' ||
            String(process?.env?.ARDALI_ENABLE_WEB_DALI || '').toLowerCase() === 'true'
    },
    onSettingsReload: (callback) => {
        const handler = (_event, payload, meta) => callback(payload, meta || {});
        ipcRenderer.on('settings:reloaded', handler);
        return () => ipcRenderer.removeListener('settings:reloaded', handler);
    },
    onSettingsNavigate: (callback) => {
        const handler = (_event, payload) => callback(payload);
        ipcRenderer.on('settings:navigate', handler);
        return () => ipcRenderer.removeListener('settings:navigate', handler);
    },
    onSettingsCloseRequest: (callback) => {
        const handler = () => callback();
        ipcRenderer.on('settings:requestClose', handler);
        return () => ipcRenderer.removeListener('settings:requestClose', handler);
    },
    onWebReloadActive: (callback) => {
        const handler = () => callback();
        ipcRenderer.on('web:reload-active', handler);
        return () => ipcRenderer.removeListener('web:reload-active', handler);
    },
    onScopedSfxLiveParam: (callback) => {
        if (typeof callback !== 'function') return () => {};
        const handler = (_event, payload) => callback(payload);
        ipcRenderer.on('sfx:scoped-live-param', handler);
        return () => ipcRenderer.removeListener('sfx:scoped-live-param', handler);
    },
    confirmSettingsClose: () => ipcRenderer.invoke('settings:confirmClose'),

    // Playlist
    savePlaylist: (playlist) => ipcRenderer.invoke('playlist:save', playlist),
    loadPlaylist: () => ipcRenderer.invoke('playlist:load'),

    // Dialog API
    dialog: {
        openFolder: (opts) => ipcRenderer.invoke('dialog:openFolder', opts),
        openFiles: (filters) => ipcRenderer.invoke('dialog:openFiles', filters),
        confirm: (opts) => ipcRenderer.invoke('dialog:confirm', opts)
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

    pulse: {
        openWindow: () => ipcRenderer.invoke('pulse:openWindow'),
        closeWindow: () => ipcRenderer.invoke('pulse:closeWindow'),
        getWindowState: () => ipcRenderer.invoke('pulse:getWindowState'),
        listDevices: () => ipcRenderer.invoke('pulse:listDevices'),
        getPreferences: () => ipcRenderer.invoke('pulse:getPreferences'),
        savePreferences: (preferences) => ipcRenderer.invoke('pulse:savePreferences', preferences || {}),
        getPreferredDevice: () => ipcRenderer.invoke('pulse:getPreferredDevice'),
        getStatus: () => ipcRenderer.invoke('pulse:getStatus'),
        setContextMetadata: (metadata) => ipcRenderer.invoke('pulse:setContextMetadata', metadata || {}),
        startListening: (options) => ipcRenderer.invoke('pulse:startListening', options || {}),
        stopListening: () => ipcRenderer.invoke('pulse:stopListening'),
        startLevelPreview: (options) => ipcRenderer.invoke('pulse:startLevelPreview', options || {}),
        stopLevelPreview: () => ipcRenderer.invoke('pulse:stopLevelPreview'),
        recognizeSample: (options) => ipcRenderer.invoke('pulse:recognizeSample', options || {}),
        openExternalSearch: (payload) => ipcRenderer.invoke('pulse:openExternalSearch', payload || {}),
        openQueryInApp: (payload) => ipcRenderer.invoke('pulse:openQueryInApp', payload || {}),
        onWindowState: (callback) => {
            if (typeof callback !== 'function') return () => {};
            const handler = (_event, payload) => callback(payload || {});
            ipcRenderer.on('pulse:window-state', handler);
            return () => ipcRenderer.removeListener('pulse:window-state', handler);
        },
        onState: (callback) => {
            if (typeof callback !== 'function') return () => {};
            const handler = (_event, payload) => callback(payload || {});
            ipcRenderer.on('pulse:state', handler);
            return () => ipcRenderer.removeListener('pulse:state', handler);
        },
        onVolume: (callback) => {
            if (typeof callback !== 'function') return () => {};
            const handler = (_event, payload) => callback(payload || {});
            ipcRenderer.on('pulse:volume', handler);
            return () => ipcRenderer.removeListener('pulse:volume', handler);
        },
        onPreviewVolume: (callback) => {
            if (typeof callback !== 'function') return () => {};
            const handler = (_event, payload) => callback(payload || {});
            ipcRenderer.on('pulse:preview-volume', handler);
            return () => ipcRenderer.removeListener('pulse:preview-volume', handler);
        },
        onResult: (callback) => {
            if (typeof callback !== 'function') return () => {};
            const handler = (_event, payload) => callback(payload || {});
            ipcRenderer.on('pulse:result', handler);
            return () => ipcRenderer.removeListener('pulse:result', handler);
        },
        onUncertain: (callback) => {
            if (typeof callback !== 'function') return () => {};
            const handler = (_event, payload) => callback(payload || {});
            ipcRenderer.on('pulse:uncertain', handler);
            return () => ipcRenderer.removeListener('pulse:uncertain', handler);
        },
        onOpenQuery: (callback) => {
            if (typeof callback !== 'function') return () => {};
            const handler = (_event, payload) => callback(payload || {});
            ipcRenderer.on('pulse:open-query', handler);
            return () => ipcRenderer.removeListener('pulse:open-query', handler);
        }
    },

    systemAudio: {
        getState: () => ipcRenderer.invoke('systemAudio:getState'),
        setVolume: (percent) => ipcRenderer.invoke('systemAudio:setVolume', percent),
        setAllowOverdrive: (enabled) => ipcRenderer.invoke('systemAudio:setAllowOverdrive', enabled),
        setOutput: (outputId) => ipcRenderer.invoke('systemAudio:setOutput', outputId)
    },

    system: {
        getHardwareHints: () => ipcRenderer.invoke('system:getHardwareHints')
    },

    // Web Security / Privacy helpers
    webSecurity: {
        openExternal: (url) => ipcRenderer.invoke('web:openExternal', url),
        clearData: (options) => ipcRenderer.invoke('web:clearData', options),
        reloadActive: () => ipcRenderer.invoke('web:reloadActive'),
        getSecurityState: () => ipcRenderer.invoke('web:getSecurityState'),
        exportCookies: (filePath) => ipcRenderer.invoke('web:exportCookies', filePath),
        importCookies: (filePath) => ipcRenderer.invoke('web:importCookies', filePath)
    },


    diagnostics: {
        getPerformanceSnapshot: () => ipcRenderer.invoke('diagnostics:getPerformanceSnapshot')
    },

    // C++ AUDIO ENGINE API (IPC-Based)
    audio: createAudioAPI(),

    // IPC AUDIO API (Sound Effects Window için - alias)
    ipcAudio: createAudioAPI(),


    diagnostics: {
        getPerformanceSnapshot: () => ipcRenderer.invoke('diagnostics:getPerformanceSnapshot')
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
        selectEQPreset: (filename) => ipcRenderer.invoke('eqPresets:select', filename),
        previewEQPreset: (filename) => ipcRenderer.invoke('eqPresets:preview', filename),
        revertEQPresetPreview: (filename) => ipcRenderer.invoke('eqPresets:revertPreview', filename)
    },

    // SES EFEKTLERİ PENCERESİ API
    soundEffects: {
        openWindow: (scopeOrOptions) => {
            const rawScope = typeof scopeOrOptions === 'string'
                ? scopeOrOptions
                : (scopeOrOptions && typeof scopeOrOptions === 'object' ? scopeOrOptions.scope : undefined);
            const normalizedScope = ['music', 'video', 'web'].includes(String(rawScope || '').toLowerCase())
                ? String(rawScope).toLowerCase()
                : 'music';
            return ipcRenderer.invoke('soundEffects:openWindow', { scope: normalizedScope });
        },
        closeWindow: () => ipcRenderer.invoke('soundEffects:closeWindow'),
        applyInMainWindow: (script) => ipcRenderer.invoke('soundEffects:applyInMainWindow', String(script || '')),
        emitScopedLiveParam: (payload) => ipcRenderer.send('soundEffects:scopedLiveParam', payload || {}),
        getWebSpectrum: (numBands, options = {}) => ipcRenderer.invoke('soundEffects:getWebSpectrum', numBands || 128, options || {}),
        getWebNoiseGateStatus: () => ipcRenderer.invoke('soundEffects:getWebNoiseGateStatus'),
        getWebTruePeakStatus: () => ipcRenderer.invoke('soundEffects:getWebTruePeakStatus'),
        getWebDynamicEqStatus: () => ipcRenderer.invoke('soundEffects:getWebDynamicEqStatus'),
        getWebPerfStatus: () => ipcRenderer.invoke('soundEffects:getWebPerfStatus')
    },

    // ARDALI DAWLOD PENCERESİ API
    downloader: {
        openWindow: (payload) => {
            if (payload && typeof payload === 'object') {
                return ipcRenderer.invoke('downloader:openWindow', {
                    url: String(payload.url || ''),
                    titleHint: String(payload.titleHint || payload.title || '')
                });
            }
            return ipcRenderer.invoke('downloader:openWindow', String(payload || ''));
        },
        getSettings: () => ipcRenderer.invoke('downloader:getSettings'),
        getDependencyStatus: () => ipcRenderer.invoke('downloader:getDependencyStatus'),
        ensureDependencies: () => ipcRenderer.invoke('downloader:ensureDependencies'),
        saveSettings: (settings) => ipcRenderer.invoke('downloader:saveSettings', settings || {}),
        readClipboard: () => ipcRenderer.invoke('downloader:readClipboard'),
        chooseFolder: () => ipcRenderer.invoke('downloader:chooseFolder'),
        chooseOutputFolder: () => ipcRenderer.invoke('downloader:chooseOutputFolder'),
        chooseConfigFile: () => ipcRenderer.invoke('downloader:chooseConfigFile'),
        getPendingUrl: () => ipcRenderer.invoke('downloader:getPendingUrl'),
        getPendingNotice: () => ipcRenderer.invoke('downloader:getPendingNotice'),
        getPathForFile: (file) => {
            try {
                if (!file) return '';
                if (webUtils && typeof webUtils.getPathForFile === 'function') {
                    return String(webUtils.getPathForFile(file) || '').trim();
                }
                return String(file.path || '').trim();
            } catch {
                return '';
            }
        },
        getInfo: (url) => ipcRenderer.invoke('downloader:getInfo', String(url || '')),
        start: (options) => ipcRenderer.invoke('downloader:start', options || {}),
        cancel: (id) => ipcRenderer.invoke('downloader:cancel', String(id || '')),
        startCompression: (options) => ipcRenderer.invoke('downloader:startCompression', options || {}),
        cancelCompression: (id) => ipcRenderer.invoke('downloader:cancelCompression', String(id || '')),
        getFileThumbnail: (filePath) => ipcRenderer.invoke('downloader:getFileThumbnail', String(filePath || '')),
        showFile: (filePath) => ipcRenderer.invoke('downloader:showFile', String(filePath || '')),
        getHistory: () => ipcRenderer.invoke('downloader:getHistory'),
        exportHistory: (format) => ipcRenderer.invoke('downloader:exportHistory', String(format || 'json')),
        clearHistory: () => ipcRenderer.invoke('downloader:clearHistory'),
        removeHistoryItem: (id) => ipcRenderer.invoke('downloader:removeHistoryItem', String(id || '')),
        onJobUpdate: (callback) => {
            if (typeof callback !== 'function') return () => {};
            const handler = (_event, payload) => callback(payload || {});
            ipcRenderer.on('downloader:job-update', handler);
            return () => ipcRenderer.removeListener('downloader:job-update', handler);
        },
        onLoadUrl: (callback) => {
            if (typeof callback !== 'function') return () => {};
            const handler = (_event, payload) => callback(payload || {});
            ipcRenderer.on('downloader:load-url', handler);
            return () => ipcRenderer.removeListener('downloader:load-url', handler);
        }
    },

    // ELECTRON PENCERE KONTROL API
    electronAPI: {
        minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
        maximizeWindow: () => ipcRenderer.invoke('window:maximize'),
        closeWindow: () => ipcRenderer.invoke('window:close'),
        isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
        isFullscreen: () => ipcRenderer.invoke('window:isFullscreen'),
        setFullscreen: (enabled) => ipcRenderer.invoke('window:setFullscreen', !!enabled),
        toggleFullscreen: () => ipcRenderer.invoke('window:toggleFullscreen'),
        onFullscreenChanged: (callback) => {
            if (typeof callback !== 'function') return () => {};
            const handler = (_event, payload) => {
                callback(payload?.fullscreen === true);
            };
            ipcRenderer.on('window:fullscreen-changed', handler);
            return () => ipcRenderer.removeListener('window:fullscreen-changed', handler);
        }
    },

    // APP CONTROL
    app: {
        relaunch: () => ipcRenderer.invoke('app:relaunch'),
        consumePendingOpenMediaFiles: () => ipcRenderer.invoke('app:consumePendingOpenMediaFiles'),
        notifyMediaOpenReady: () => ipcRenderer.send('app:renderer-media-open-ready'),
        getVersionInfo: () => ipcRenderer.invoke('app:getVersionInfo'),
        setStudioShortcuts: (shortcuts) => ipcRenderer.invoke('app:setStudioShortcuts', shortcuts || {}),
        updater: {
            getState: () => ipcRenderer.invoke('app:update:getState'),
            check: (options = {}) => ipcRenderer.invoke('app:update:check', options),
            download: () => ipcRenderer.invoke('app:update:download'),
            install: () => ipcRenderer.invoke('app:update:install'),
            launchArDaliBinUpdate: () => ipcRenderer.invoke('app:update:launchArDaliBinUpdate'),
            onStatus: (callback) => {
                if (typeof callback !== 'function') return () => {};
                const handler = (_event, payload) => callback(payload || {});
                ipcRenderer.on('app:update-status', handler);
                return () => ipcRenderer.removeListener('app:update-status', handler);
            }
        }
    },

    onOpenMediaFiles: (callback) => {
        if (typeof callback !== 'function') return () => {};
        const handler = (_event, payload) => {
            callback(payload?.paths || []);
        };
        ipcRenderer.on('app:open-media-files', handler);
        return () => ipcRenderer.removeListener('app:open-media-files', handler);
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
    
    // İndirmeler API
    downloads: {
        getHistory: () => ipcRenderer.invoke('downloads:getHistory'),
        clearHistory: () => ipcRenderer.invoke('downloads:clearHistory'),
        removeItem: (id) => ipcRenderer.invoke('downloads:removeItem', id),
        pause: (id) => ipcRenderer.invoke('downloads:pause', id),
        resume: (id) => ipcRenderer.invoke('downloads:resume', id),
        cancel: (id) => ipcRenderer.invoke('downloads:cancel', id),
        checkExists: (filePath) => ipcRenderer.invoke('downloads:checkExists', filePath),
        showInFolder: (filePath) => ipcRenderer.invoke('downloads:showInFolder', filePath),
        openDownloadsFolder: () => ipcRenderer.invoke('downloads:openDownloadsFolder'),
        onProgress: (callback) => {
            ipcRenderer.on('download-progress', (event, data) => callback(data));
        },
        onDone: (callback) => {
            ipcRenderer.on('download-done', (event, data) => callback(data));
        }
    },
    
    // System Yollar API
    getHomeDir: () => os.homedir(),
    getUserName: () => os.userInfo().username,
    
    // Yol utilities
    path: {
        join: (...args) => path.join(...args),
        basename: (p) => path.basename(p),
        dirname: (p) => path.dirname(p),
        resolve: (...args) => path.resolve(...args),
        getPathForFile: (file) => {
            try {
                if (!file) return '';
                if (typeof file.path === 'string' && file.path.trim()) {
                    return file.path.trim();
                }
                if (webUtils && typeof webUtils.getPathForFile === 'function') {
                    const resolved = webUtils.getPathForFile(file);
                    return String(resolved || '').trim();
                }
            } catch {
                // yoksay
            }
            return '';
        },
        toFileUrl: (p) => {
            try {
                return pathToFileURL(String(p || '')).toString();
            } catch {
                return '';
            }
        }
    }
};

preloadLog('[PRELOAD] ardaliAPI objesi olusturuldu');
preloadLog('[PRELOAD] API anahtarlari:', Object.keys(ardaliAPI));

// Global fallback
try {
    globalThis.ardali = ardaliAPI;
    preloadLog('[PRELOAD] globalThis.ardali atandi');
} catch (e) {
    console.error('[PRELOAD] globalThis hata:', e.message);
}

// contextBridge ile güvenli expose
try {
    contextBridge.exposeInMainWorld('ardali', ardaliAPI);
    preloadLog('[PRELOAD] contextBridge.exposeInMainWorld basarili');
} catch (e) {
    console.error('[PRELOAD] contextBridge hata:', e.message);
}

// Görselleştirici API (projectM native çalıştırılabilir)
const appAPI = {
    visualizer: {
        toggle: () => ipcRenderer.invoke('visualizer:toggle'),
        pushVideoSpectrum: (bands, isPlaying, options = {}) => ipcRenderer.send('visualizer:videoSpectrum', {
            bands: Array.isArray(bands) ? bands : [],
            isPlaying: !!isPlaying,
            targetFps: Math.max(20, Math.min(60, Number(options?.targetFps) || 30)),
            sourceMode: String(options?.sourceMode || '').trim().toLowerCase(),
            ts: Date.now()
        })
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
