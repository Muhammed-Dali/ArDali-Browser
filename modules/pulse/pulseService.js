'use strict';

const { EventEmitter } = require('events');
const path = require('path');
const fs = require('fs');
const { PulseAudioCapture, listPulseDevices } = require('./audioCapture');
const { SlidingPcmBuffer, createSignatureFromSamples } = require('./fingerprint');
const { recognizeSignature } = require('./shazamClient');

const DEFAULT_PREFERENCES = Object.freeze({
    enable_notifications: false,
    enable_mpris: false,
    enable_systray: false,
    no_duplicates: true,
    request_interval_secs_v3: 4,
    buffer_size_secs: 14,
    current_device_name: '',
    open_platform: 'youtube',
    recognition_engine: 'songrec_only',
    acoustid_api_key: ''
});

function sanitizePreferences(input = {}) {
    const raw = input && typeof input === 'object' ? input : {};
    return {
        enable_notifications: typeof raw.enable_notifications === 'boolean' ? raw.enable_notifications : DEFAULT_PREFERENCES.enable_notifications,
        enable_mpris: typeof raw.enable_mpris === 'boolean' ? raw.enable_mpris : DEFAULT_PREFERENCES.enable_mpris,
        enable_systray: typeof raw.enable_systray === 'boolean' ? raw.enable_systray : DEFAULT_PREFERENCES.enable_systray,
        no_duplicates: typeof raw.no_duplicates === 'boolean' ? raw.no_duplicates : DEFAULT_PREFERENCES.no_duplicates,
        request_interval_secs_v3: Math.max(1, Math.min(120, Number(raw.request_interval_secs_v3) || DEFAULT_PREFERENCES.request_interval_secs_v3)),
        buffer_size_secs: Math.max(4, Math.min(30, Number(raw.buffer_size_secs) || DEFAULT_PREFERENCES.buffer_size_secs)),
        current_device_name: typeof raw.current_device_name === 'string' ? raw.current_device_name : DEFAULT_PREFERENCES.current_device_name,
        open_platform: ['youtube', 'ytmusic'].includes(String(raw.open_platform || '').trim().toLowerCase())
            ? String(raw.open_platform).trim().toLowerCase()
            : DEFAULT_PREFERENCES.open_platform,
        recognition_engine: DEFAULT_PREFERENCES.recognition_engine,
        acoustid_api_key: ''
    };
}

class PulseService extends EventEmitter {
    constructor({ app }) {
        super();
        this.app = app;
        this.capture = null;
        this.preferences = sanitizePreferences();
        this.buffer = new SlidingPcmBuffer({ seconds: this.preferences.buffer_size_secs });
        this.status = {
            running: false,
            searching: false,
            audioDevice: '',
            lastError: '',
            warning: '',
            levelPercent: 0,
            startedAt: 0,
            capturedBytes: 0,
            bufferFilledSamples: 0,
            bufferFillPercent: 0
        };
        this.recognitionTimer = null;
        this.volumeTimer = null;
        this.deviceTimer = null;
        this.processing = false;
        this.lastTrackKey = '';
        this.recentResultKeys = new Map();
        this.duplicateWindowMs = 10 * 60 * 1000;
        this.lastUncertainAtByReason = new Map();
        this.backoffUntil = 0;
        this.consecutiveNoSignal = 0;
        this.consecutiveNoMatch = 0;
        this.autoSwitchOutputMonitor = true;
    }

    get preferencesPath() {
        const base = this.app?.getPath ? this.app.getPath('userData') : process.cwd();
        return path.join(base, 'aurivo-pulse-preferences.json');
    }

    loadPreferences() {
        try {
            const parsed = JSON.parse(fs.readFileSync(this.preferencesPath, 'utf8'));
            this.preferences = sanitizePreferences(parsed);
        } catch {
            this.preferences = sanitizePreferences();
        }
        this.buffer = new SlidingPcmBuffer({ seconds: this.preferences.buffer_size_secs });
        return this.preferences;
    }

    savePreferences(patch = {}) {
        const previous = this.preferences;
        this.preferences = sanitizePreferences({ ...this.preferences, ...(patch || {}) });
        try {
            fs.mkdirSync(path.dirname(this.preferencesPath), { recursive: true });
            fs.writeFileSync(this.preferencesPath, JSON.stringify(this.preferences, null, 2));
        } catch (error) {
            this.status.lastError = error?.message || String(error);
        }
        const bufferSizeChanged = Number(previous.buffer_size_secs) !== Number(this.preferences.buffer_size_secs);
        const requestIntervalChanged = Number(previous.request_interval_secs_v3) !== Number(this.preferences.request_interval_secs_v3);
        if (!this.status.running || bufferSizeChanged) {
            this.buffer = new SlidingPcmBuffer({ seconds: this.preferences.buffer_size_secs });
            this.updateBufferStatus();
        }
        if (this.status.running && requestIntervalChanged) {
            this.scheduleLoops();
        }
        this.emitState();
        return this.preferences;
    }

    listDevices() {
        return listPulseDevices();
    }

    getPreferredOutputMonitor() {
        const devices = this.listDevices().devices || [];
        return {
            devices,
            audioDevice: devices.find((device) => device.isDefaultMonitor)?.id || ''
        };
    }

    getStatus() {
        return {
            ...this.status,
            running: !!this.capture?.running,
            preferences: this.preferences
        };
    }

    emitState() {
        this.emit('state', this.getStatus());
    }

    updateBufferStatus() {
        this.status.bufferFilledSamples = this.buffer.filled;
        this.status.bufferFillPercent = this.buffer.capacity > 0
            ? Math.max(0, Math.min(100, Math.round((this.buffer.filled / this.buffer.capacity) * 100)))
            : 0;
    }

    emitUncertain(reason, payload = {}, minIntervalMs = 6000) {
        const key = String(reason || 'uncertain').trim() || 'uncertain';
        const now = Date.now();
        const lastAt = Number(this.lastUncertainAtByReason.get(key) || 0);
        if (lastAt && (now - lastAt) < minIntervalMs) return false;
        this.lastUncertainAtByReason.set(key, now);
        this.emit('uncertain', {
            reason: key,
            candidates: [],
            ...payload,
            at: now
        });
        return true;
    }

    normalizeResultKeyPart(value) {
        return String(value || '')
            .normalize('NFKC')
            .toLocaleLowerCase('tr-TR')
            .replace(/[^\p{L}\p{N}]+/gu, ' ')
            .trim()
            .replace(/\s+/g, ' ');
    }

    getResultKeys(result = {}) {
        const title = this.normalizeResultKeyPart(result.title);
        const artist = this.normalizeResultKeyPart(result.artist);
        const keys = [];
        if (result.trackKey) keys.push(`track:${String(result.trackKey).trim()}`);
        if (title || artist) keys.push(`song:${artist}|${title}`);
        return keys.filter(Boolean);
    }

    rememberResult(result = {}) {
        const now = Date.now();
        for (const [key, at] of this.recentResultKeys.entries()) {
            if (now - at > this.duplicateWindowMs) this.recentResultKeys.delete(key);
        }
        const keys = this.getResultKeys(result);
        const duplicate = keys.some((key) => this.recentResultKeys.has(key));
        if (!duplicate) {
            for (const key of keys) this.recentResultKeys.set(key, now);
        }
        return { duplicate, keys };
    }

    clearRecognizedHistory() {
        this.lastTrackKey = '';
        this.recentResultKeys.clear();
    }

    startListening(options = {}) {
        if (this.capture?.running) {
            this.emitState();
            return { success: true, status: this.getStatus(), alreadyRunning: true };
        }

        const requestedDevice = String(options.audioDevice || '').trim();
        const preferredMonitor = this.getPreferredOutputMonitor();
        const audioDevice = requestedDevice || preferredMonitor.audioDevice || '';
        this.autoSwitchOutputMonitor = options.autoSwitchOutputMonitor !== false;
        this.capture = new PulseAudioCapture();
        this.buffer = new SlidingPcmBuffer({ seconds: this.preferences.buffer_size_secs });
        const started = this.capture.start({ audioDevice });
        if (!started.success) {
            this.status = {
                ...this.status,
                running: false,
                searching: false,
                audioDevice: '',
                lastError: started.error || 'capture-start-failed',
                warning: started.error || 'capture-start-failed'
            };
            this.emitState();
            return { success: false, error: this.status.lastError, status: this.getStatus() };
        }

        this.status = {
            ...this.status,
            running: true,
            searching: true,
            audioDevice: started.audioDevice,
            lastError: '',
            warning: '',
            levelPercent: 0,
            startedAt: Date.now(),
            capturedBytes: 0,
            bufferFilledSamples: 0,
            bufferFillPercent: 0
        };
        this.backoffUntil = 0;
        this.consecutiveNoSignal = 0;
        this.consecutiveNoMatch = 0;
        this.clearRecognizedHistory();
        this.lastUncertainAtByReason.clear();
        this.savePreferences({ current_device_name: started.audioDevice });

        this.attachCaptureListeners(this.capture);

        this.scheduleLoops();
        this.emitState();
        return { success: true, status: this.getStatus(), devices: started.devices || [] };
    }

    attachCaptureListeners(capture) {
        capture.on('samples', (chunk) => {
            this.buffer.pushF32Buffer(chunk);
            this.status.capturedBytes += chunk.length;
            this.updateBufferStatus();
        });
        capture.on('warning', (message) => {
            this.status.warning = String(message || '').slice(0, 300);
            this.emitState();
        });
        capture.on('error', (error) => {
            this.status.lastError = error?.message || String(error);
            this.status.warning = this.status.lastError;
            this.emitState();
        });
        capture.on('close', () => {
            if (this.capture !== capture) return;
            if (!this.capture?.running) {
                this.status.running = false;
                this.status.searching = false;
                this.emitState();
            }
        });
    }

    scheduleLoops() {
        clearInterval(this.recognitionTimer);
        clearInterval(this.volumeTimer);
        clearInterval(this.deviceTimer);
        const requestMs = Math.max(1000, this.preferences.request_interval_secs_v3 * 1000);
        this.recognitionTimer = setInterval(() => {
            this.processCurrentBuffer().catch((error) => {
                this.status.lastError = error?.message || String(error);
                this.status.warning = this.status.lastError;
                this.emitState();
            });
        }, requestMs);
        this.recognitionTimer.unref?.();
        this.volumeTimer = setInterval(() => {
            this.status.levelPercent = this.buffer.getLevelPercent(1600, 2.0);
            this.updateBufferStatus();
            this.emit('volume', {
                percent: this.status.levelPercent,
                bufferFillPercent: this.status.bufferFillPercent
            });
        }, 80);
        this.volumeTimer.unref?.();
        this.deviceTimer = setInterval(() => {
            this.switchToCurrentDefaultMonitorIfNeeded();
        }, 2500);
        this.deviceTimer.unref?.();
    }

    switchToCurrentDefaultMonitorIfNeeded() {
        if (!this.capture?.running || !this.autoSwitchOutputMonitor) return;
        const { audioDevice } = this.getPreferredOutputMonitor();
        if (!audioDevice || audioDevice === this.status.audioDevice) return;

        const previousCapture = this.capture;
        const nextCapture = new PulseAudioCapture();
        const started = nextCapture.start({ audioDevice });
        if (!started.success) {
            this.status.warning = started.error || 'device-switch-failed';
            this.emitState();
            return;
        }

        this.capture = nextCapture;
        this.status.audioDevice = audioDevice;
        this.status.warning = '';
        this.savePreferences({ current_device_name: audioDevice });
        this.attachCaptureListeners(nextCapture);

        try {
            previousCapture.stop();
        } catch {
            // best effort
        }
        this.emitState();
    }

    async processCurrentBuffer() {
        if (!this.capture?.running || this.processing) return { success: false, skipped: true };
        const engine = String(this.preferences.recognition_engine || '').trim().toLowerCase();
        if (engine === 'acoustid_only') {
            this.status.warning = 'acoustid-engine-unavailable';
            this.emitState();
            this.emitUncertain('acoustid-engine-unavailable', {}, 15000);
            return { success: false, error: 'acoustid-engine-unavailable' };
        }
        if (Date.now() < this.backoffUntil) {
            const retryAfterMs = this.backoffUntil - Date.now();
            this.emitUncertain('rate-limited-waiting', { retryAfterMs }, 15000);
            return { success: false, error: 'rate-limited-waiting', retryAfterMs };
        }
        const minSamplesForRecognition = Math.min(
            this.buffer.capacity,
            Math.max(this.buffer.sampleRate * 9, Math.round(this.buffer.capacity * 0.72))
        );
        if (this.buffer.filled < minSamplesForRecognition) {
            this.updateBufferStatus();
            this.emitUncertain('not-enough-audio', {
                filledSamples: this.buffer.filled,
                requiredSamples: minSamplesForRecognition,
                fillPercent: this.status.bufferFillPercent
            }, 2500);
            this.emitState();
            return {
                success: false,
                pending: true,
                error: 'not-enough-audio',
                fillPercent: this.status.bufferFillPercent
            };
        }
        if (!this.buffer.hasSignal()) {
            this.consecutiveNoSignal += 1;
            this.status.warning = this.consecutiveNoSignal >= 3 ? 'no-signal' : '';
            this.emitUncertain('no-signal', { count: this.consecutiveNoSignal }, 9000);
            this.emitState();
            return { success: false, error: 'no-signal' };
        }
        this.consecutiveNoSignal = 0;

        this.processing = true;
        try {
            const signature = createSignatureFromSamples(this.buffer.snapshot());
            if (!signature.success) {
                this.status.warning = signature.pending ? '' : (signature.error || 'fingerprint-pending');
                this.emitUncertain(signature.error || 'fingerprint-pending', {
                    totalPeaks: signature.totalPeaks || 0
                }, signature.pending ? 8000 : 12000);
                this.emitState();
                return signature;
            }
            this.status.warning = '';
            this.emitState();
            let recognized;
            try {
                recognized = await recognizeSignature(signature.uri, { sampleMs: signature.sampleMs });
            } catch (error) {
                const message = String(error?.message || error || 'recognition-failed');
                const lowered = message.toLowerCase();
                if (lowered.includes('rate') || lowered.includes('429')) {
                    this.backoffUntil = Date.now() + 90000;
                    this.status.warning = 'rate-limited';
                    this.emitUncertain('rate-limited', { retryAfterMs: 90000 }, 30000);
                } else if (lowered.includes('timeout')) {
                    this.status.warning = 'network-timeout';
                    this.emitUncertain('network-timeout', {}, 12000);
                } else {
                    this.status.warning = message;
                    this.emitUncertain('recognition-error', { message }, 12000);
                }
                this.emitState();
                return { success: false, error: this.status.warning, message };
            }
            if (recognized.success && recognized.result) {
                const remembered = this.rememberResult(recognized.result);
                const key = remembered.keys[0] || recognized.result.trackKey || `${recognized.result.artist}|${recognized.result.title}`;
                if (!this.preferences.no_duplicates || !remembered.duplicate) {
                    this.lastTrackKey = key;
                    this.consecutiveNoMatch = 0;
                    this.status.warning = '';
                    this.emitState();
                    this.emit('result', recognized.result);
                } else {
                    this.emitUncertain('duplicate-result', { result: recognized.result }, 15000);
                }
            } else {
                this.consecutiveNoMatch += 1;
                const reason = recognized.error || 'no-match';
                this.status.warning = this.consecutiveNoMatch >= 3 ? reason : '';
                this.emitUncertain(reason, { count: this.consecutiveNoMatch }, 12000);
                this.emitState();
            }
            return recognized;
        } finally {
            this.processing = false;
        }
    }

    stopListening() {
        clearInterval(this.recognitionTimer);
        clearInterval(this.volumeTimer);
        clearInterval(this.deviceTimer);
        this.recognitionTimer = null;
        this.volumeTimer = null;
        this.deviceTimer = null;
        const stopped = this.capture?.stop() || { success: true, stopped: false };
        this.capture = null;
        this.processing = false;
        this.status = {
            ...this.status,
            running: false,
            searching: false,
            warning: '',
            levelPercent: 0,
            bufferFilledSamples: this.buffer.filled,
            bufferFillPercent: this.status.bufferFillPercent
        };
        this.emitState();
        return { success: true, status: this.getStatus(), ...stopped };
    }

    async recognizeSample(options = {}) {
        const wasRunning = !!this.capture?.running;
        if (!wasRunning) {
            const started = this.startListening({
                audioDevice: options.audioDevice,
                autoSwitchOutputMonitor: options.autoSwitchOutputMonitor !== false
            });
            if (!started.success) return started;
        }
        const durationMs = Math.max(1000, Math.min(30000, Number(options.durationSec || 8) * 1000));
        await new Promise((resolve) => setTimeout(resolve, durationMs));
        const result = await this.processCurrentBuffer();
        if (!wasRunning) this.stopListening();
        return result;
    }
}

module.exports = {
    PulseService,
    sanitizePreferences,
    DEFAULT_PREFERENCES
};
