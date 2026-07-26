'use strict';

const { EventEmitter } = require('events');
const path = require('path');
const fs = require('fs');
const { Worker } = require('worker_threads');
const { PulseAudioCapture, listPulseDevices } = require('./audioCapture');
const { SlidingPcmBuffer, createSignatureFromSamples } = require('./fingerprint');
const { recognizeSignature } = require('./shazamClient');

const DEFAULT_PREFERENCES = Object.freeze({
    enable_notifications: false,
    enable_mpris: false,
    enable_systray: false,
    no_duplicates: true,
    web_metadata_fallback_enabled: true,
    auto_stop_on_result: true,
    auto_open_on_result: false,
    remember_audio_device: true,
    request_interval_secs_v3: 6,
    buffer_size_secs: 12,
    current_device_name: '',
    open_platform: 'youtube',
    recognition_engine: 'songrec_only',
    acoustid_api_key: ''
});
const RECOGNITION_SNAPSHOT_SECONDS = 14;
const FINGERPRINT_WORKER_TIMEOUT_MS = 12000;
const WEB_CONTEXT_TTL_MS = 2 * 60 * 1000;
const PULSE_DEBUG =
    process.env.ARDALI_DEV === '1' ||
    process.env.ARDALI_PULSE_DEBUG === '1';

function pulseDebug(...args) {
    if (!PULSE_DEBUG) return;
    console.log('[PULSE]', ...args);
}

function sanitizePreferences(input = {}) {
    const raw = input && typeof input === 'object' ? input : {};
    return {
        enable_notifications: typeof raw.enable_notifications === 'boolean' ? raw.enable_notifications : DEFAULT_PREFERENCES.enable_notifications,
        enable_mpris: typeof raw.enable_mpris === 'boolean' ? raw.enable_mpris : DEFAULT_PREFERENCES.enable_mpris,
        enable_systray: typeof raw.enable_systray === 'boolean' ? raw.enable_systray : DEFAULT_PREFERENCES.enable_systray,
        no_duplicates: typeof raw.no_duplicates === 'boolean' ? raw.no_duplicates : DEFAULT_PREFERENCES.no_duplicates,
        web_metadata_fallback_enabled: typeof raw.web_metadata_fallback_enabled === 'boolean' ? raw.web_metadata_fallback_enabled : DEFAULT_PREFERENCES.web_metadata_fallback_enabled,
        auto_stop_on_result: typeof raw.auto_stop_on_result === 'boolean' ? raw.auto_stop_on_result : DEFAULT_PREFERENCES.auto_stop_on_result,
        auto_open_on_result: typeof raw.auto_open_on_result === 'boolean' ? raw.auto_open_on_result : DEFAULT_PREFERENCES.auto_open_on_result,
        remember_audio_device: typeof raw.remember_audio_device === 'boolean' ? raw.remember_audio_device : DEFAULT_PREFERENCES.remember_audio_device,
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
        this.previewCapture = null;
        this.previewBuffer = new SlidingPcmBuffer({ seconds: 4 });
        this.previewTimer = null;
        this.previewAudioDevice = '';
        this.previewDevices = [];
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
        this.fingerprintWorker = null;
        this.fingerprintWorkerJobs = new Map();
        this.fingerprintJobSeq = 0;
        this.contextMetadata = null;
    }

    get preferencesPath() {
        const base = this.app?.getPath ? this.app.getPath('userData') : process.cwd();
        return path.join(base, 'ardali-pulse-preferences.json');
    }

    loadPreferences() {
        try {
            const parsed = JSON.parse(fs.readFileSync(this.preferencesPath, 'utf8'));
            this.preferences = sanitizePreferences(parsed);
        } catch {
            this.preferences = sanitizePreferences();
        }
        // Older defaults were aggressive enough to cause audible webview stutter on some systems.
        const hasLegacyDefault =
            (Number(this.preferences.request_interval_secs_v3) === 4 && Number(this.preferences.buffer_size_secs) === 14) ||
            (Number(this.preferences.request_interval_secs_v3) === 8 && Number(this.preferences.buffer_size_secs) === 10);
        if (hasLegacyDefault) {
            this.preferences = sanitizePreferences({
                ...this.preferences,
                request_interval_secs_v3: DEFAULT_PREFERENCES.request_interval_secs_v3,
                buffer_size_secs: DEFAULT_PREFERENCES.buffer_size_secs
            });
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

    findDeviceById(devices, deviceId) {
        const wanted = String(deviceId || '').trim();
        if (!wanted) return null;
        return (Array.isArray(devices) ? devices : []).find((device) => {
            return String(device?.id || '') === wanted || String(device?.label || '') === wanted;
        }) || null;
    }

    shouldAutoSwitchOutputMonitor(requestedDevice, activeDevice, devices) {
        if (!activeDevice) return false;
        const requested = String(requestedDevice || '').trim();
        if (!requested) return true;

        const selected = this.findDeviceById(devices, activeDevice) || this.findDeviceById(devices, requested);
        if (!selected) return false;
        return selected.isMonitor === true || selected.isDefaultMonitor === true;
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

    getFingerprintWorker() {
        if (this.fingerprintWorker) return this.fingerprintWorker;
        const workerPath = path.join(__dirname, 'fingerprintWorker.js');
        const worker = new Worker(workerPath);
        worker.on('message', (message = {}) => {
            const id = message.id;
            const job = this.fingerprintWorkerJobs.get(id);
            if (!job) return;
            clearTimeout(job.timer);
            this.fingerprintWorkerJobs.delete(id);
            job.resolve(message.result || { success: false, error: 'fingerprint-worker-empty-result' });
        });
        worker.on('error', (error) => {
            for (const [id, job] of this.fingerprintWorkerJobs.entries()) {
                clearTimeout(job.timer);
                job.reject(error);
                this.fingerprintWorkerJobs.delete(id);
            }
            this.fingerprintWorker = null;
        });
        worker.on('exit', () => {
            for (const [id, job] of this.fingerprintWorkerJobs.entries()) {
                clearTimeout(job.timer);
                job.reject(new Error('fingerprint-worker-exited'));
                this.fingerprintWorkerJobs.delete(id);
            }
            this.fingerprintWorker = null;
        });
        this.fingerprintWorker = worker;
        return worker;
    }

    createSignatureOffMainThread(samples) {
        return new Promise((resolve, reject) => {
            const id = ++this.fingerprintJobSeq;
            const timer = setTimeout(() => {
                this.fingerprintWorkerJobs.delete(id);
                reject(new Error('fingerprint-worker-timeout'));
            }, FINGERPRINT_WORKER_TIMEOUT_MS);
            this.fingerprintWorkerJobs.set(id, { resolve, reject, timer });
            try {
                this.getFingerprintWorker().postMessage({ id, samples: samples.buffer }, [samples.buffer]);
            } catch (error) {
                clearTimeout(timer);
                this.fingerprintWorkerJobs.delete(id);
                reject(error);
            }
        });
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

    setContextMetadata(metadata = {}) {
        const title = String(metadata?.title || metadata?.pendingTitle || '').trim();
        const artist = String(metadata?.artist || '').trim();
        const sourceUrl = String(metadata?.sourceUrl || '').trim();
        const coverUrl = String(metadata?.coverUrl || metadata?.artwork || '').trim();
        if (!title && !artist) {
            this.contextMetadata = null;
            return { success: true, cleared: true };
        }
        this.contextMetadata = {
            title,
            artist,
            album: String(metadata?.album || '').trim(),
            coverUrl,
            sourceUrl,
            platform: String(metadata?.platform || '').trim().toLowerCase(),
            updatedAt: Date.now()
        };
        pulseDebug('context-metadata', {
            title: this.contextMetadata.title,
            artist: this.contextMetadata.artist,
            platform: this.contextMetadata.platform,
            hasSourceUrl: !!this.contextMetadata.sourceUrl
        });
        return { success: true, metadata: this.contextMetadata };
    }

    getFreshContextMetadata() {
        if (!this.contextMetadata) return null;
        if ((Date.now() - Number(this.contextMetadata.updatedAt || 0)) > WEB_CONTEXT_TTL_MS) return null;
        const title = String(this.contextMetadata.title || '').trim();
        if (!title || /^\d{1,2}:\d{2}(?::\d{2})?$/.test(title)) return null;
        return this.contextMetadata;
    }

    emitContextFallback(reason = 'web-metadata-fallback') {
        const metadata = this.getFreshContextMetadata();
        if (!metadata) return false;
        const result = {
            title: metadata.title,
            artist: metadata.artist || metadata.platform || 'Web',
            album: metadata.album || '',
            coverUrl: metadata.coverUrl || '',
            trackKey: metadata.sourceUrl || `web:${metadata.artist || ''}:${metadata.title}`,
            source: 'web-metadata',
            confidence: 'metadata-fallback',
            reason
        };
        const remembered = this.rememberResult(result);
        if (this.preferences.no_duplicates && remembered.duplicate) {
            this.emitUncertain('duplicate-result', { result }, 15000);
            return true;
        }
        this.lastTrackKey = remembered.keys[0] || result.trackKey;
        this.consecutiveNoMatch = 0;
        this.status.warning = '';
        this.emitState();
        pulseDebug('context-fallback-result', {
            title: result.title,
            artist: result.artist,
            reason
        });
        this.emit('result', result);
        return true;
    }

    startListening(options = {}) {
        if (this.capture?.running) {
            this.emitState();
            return { success: true, status: this.getStatus(), alreadyRunning: true };
        }
        const requestedDevice = String(options.audioDevice || '').trim();
        const preferredMonitor = this.getPreferredOutputMonitor();
        const shouldFollowOutput = options.autoSwitchOutputMonitor !== false;
        // Otomatik kip her zaman o anda etkin çıkışın monitorünü izler.
        // Böylece uygulama açıkken kulaklık takıldığında eski kayıtlı hoparlör
        // monitorü yerine kulaklığın varsayılan monitorü seçilir.
        const audioDevice = shouldFollowOutput && preferredMonitor.audioDevice
            ? preferredMonitor.audioDevice
            : (requestedDevice || preferredMonitor.audioDevice || '');
        const requestedInterval = Number(options.requestIntervalSecs);
        const requestedBuffer = Number(options.bufferSizeSecs);
        if (Number.isFinite(requestedInterval) || Number.isFinite(requestedBuffer)) {
            this.preferences = sanitizePreferences({
                ...this.preferences,
                ...(Number.isFinite(requestedInterval) ? { request_interval_secs_v3: requestedInterval } : {}),
                ...(Number.isFinite(requestedBuffer) ? { buffer_size_secs: requestedBuffer } : {})
            });
        }
        this.autoSwitchOutputMonitor = shouldFollowOutput
            && this.shouldAutoSwitchOutputMonitor(requestedDevice, audioDevice, preferredMonitor.devices);
        if (options.contextMetadata && typeof options.contextMetadata === 'object') {
            this.setContextMetadata(options.contextMetadata);
        }
        const canPromotePreview = this.previewCapture?.running && this.previewAudioDevice === audioDevice;
        const promotedPreviewCapture = canPromotePreview ? this.previewCapture : null;
        const promotedDevices = canPromotePreview ? this.previewDevices : [];
        const promotedPreviewLevel = canPromotePreview
            ? this.previewBuffer.getLevelPercent(480, 2.0)
            : this.status.levelPercent;
        if (canPromotePreview) {
            clearInterval(this.previewTimer);
            this.previewTimer = null;
            this.previewCapture = null;
            this.previewAudioDevice = '';
            this.previewDevices = [];
        } else {
            this.stopLevelPreview();
        }

        this.capture = promotedPreviewCapture || new PulseAudioCapture();
        this.buffer = new SlidingPcmBuffer({ seconds: this.preferences.buffer_size_secs });
        pulseDebug('startListening', {
            requestedDevice,
            audioDevice,
            requestInterval: this.preferences.request_interval_secs_v3,
            bufferSize: this.preferences.buffer_size_secs,
            autoSwitchOutputMonitor: this.autoSwitchOutputMonitor
        });
        const started = promotedPreviewCapture
            ? { success: true, audioDevice, devices: promotedDevices }
            : this.capture.start({ audioDevice });
        if (!started.success) {
            pulseDebug('capture-start-failed', started.error || 'capture-start-failed');
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
            levelPercent: Math.max(0, Math.min(100, Number(promotedPreviewLevel) || 0)),
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
        if (this.preferences.remember_audio_device !== false) {
            this.savePreferences({ current_device_name: started.audioDevice });
        }

        this.attachCaptureListeners(this.capture);

        this.scheduleLoops();
        this.emitState();
        pulseDebug('capture-started', {
            audioDevice: started.audioDevice,
            devices: Array.isArray(started.devices) ? started.devices.length : 0
        });
        return { success: true, status: this.getStatus(), devices: started.devices || [] };
    }

    startLevelPreview(options = {}) {
        if (this.capture?.running) {
            this.stopLevelPreview();
            return { success: true, skipped: true, running: true };
        }

        const requestedDevice = String(options.audioDevice || '').trim();
        const preferredMonitor = this.getPreferredOutputMonitor();
        const audioDevice = requestedDevice || preferredMonitor.audioDevice || '';
        if (this.previewCapture?.running && this.previewAudioDevice === audioDevice) {
            return { success: true, alreadyRunning: true, audioDevice };
        }
        this.stopLevelPreview();

        const previewCapture = new PulseAudioCapture();
        const started = previewCapture.start({ audioDevice });
        if (!started.success) {
            this.emit('preview-volume', {
                percent: 0,
                audioDevice,
                error: started.error || 'preview-start-failed'
            });
            return { success: false, error: started.error || 'preview-start-failed' };
        }

        this.previewCapture = previewCapture;
        this.previewAudioDevice = started.audioDevice;
        this.previewDevices = started.devices || [];
        this.previewBuffer = new SlidingPcmBuffer({ seconds: 4 });

        previewCapture.on('samples', (chunk) => {
            this.previewBuffer.pushF32Buffer(chunk);
        });
        previewCapture.on('error', (error) => {
            this.emit('preview-volume', {
                percent: 0,
                audioDevice: this.previewAudioDevice,
                error: error?.message || String(error)
            });
        });
        previewCapture.on('close', () => {
            if (this.previewCapture !== previewCapture) return;
            this.previewCapture = null;
            this.previewAudioDevice = '';
            clearInterval(this.previewTimer);
            this.previewTimer = null;
            this.emit('preview-volume', { percent: 0, audioDevice: started.audioDevice, stopped: true });
        });

        this.previewTimer = setInterval(() => {
            this.emit('preview-volume', {
                percent: this.previewBuffer.getLevelPercent(480, 2.0),
                audioDevice: this.previewAudioDevice
            });
        }, 60);
        this.previewTimer.unref?.();

        return { success: true, audioDevice: started.audioDevice, devices: started.devices || [] };
    }

    stopLevelPreview() {
        const hadPreview = !!(this.previewCapture || this.previewTimer || this.previewAudioDevice);
        clearInterval(this.previewTimer);
        this.previewTimer = null;
        const stopped = this.previewCapture?.stop() || { success: true, stopped: false };
        const audioDevice = this.previewAudioDevice;
        this.previewCapture = null;
        this.previewAudioDevice = '';
        this.previewDevices = [];
        this.previewBuffer = new SlidingPcmBuffer({ seconds: 4 });
        if (hadPreview) this.emit('preview-volume', { percent: 0, audioDevice, stopped: true });
        return { success: true, ...stopped };
    }

    attachCaptureListeners(capture) {
        let loggedFirstSamples = false;
        capture.on('samples', (chunk) => {
            this.buffer.pushF32Buffer(chunk);
            this.status.capturedBytes += chunk.length;
            this.updateBufferStatus();
            if (!loggedFirstSamples) {
                loggedFirstSamples = true;
                pulseDebug('samples-flowing', {
                    bytes: chunk.length,
                    capturedBytes: this.status.capturedBytes,
                    bufferFillPercent: this.status.bufferFillPercent
                });
            }
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
        const requestMs = Math.max(6000, this.preferences.request_interval_secs_v3 * 1000);
        pulseDebug('scheduleLoops', {
            requestMs,
            volumeMs: 80,
            deviceMs: 2500
        });
        this.recognitionTimer = setInterval(() => {
            this.processCurrentBuffer().catch((error) => {
                this.status.lastError = error?.message || String(error);
                this.status.warning = this.status.lastError;
                this.emitState();
            });
        }, requestMs);
        this.recognitionTimer.unref?.();
        this.volumeTimer = setInterval(() => {
            this.status.levelPercent = this.buffer.getLevelPercent(800, 2.0);
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
        if (this.preferences.remember_audio_device !== false) {
            this.savePreferences({ current_device_name: audioDevice });
        }
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
            pulseDebug('recognition-wait-buffer', {
                filledSamples: this.buffer.filled,
                requiredSamples: minSamplesForRecognition,
                fillPercent: this.status.bufferFillPercent,
                levelPercent: this.status.levelPercent
            });
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
            pulseDebug('recognition-no-signal', {
                count: this.consecutiveNoSignal,
                levelPercent: this.status.levelPercent,
                fillPercent: this.status.bufferFillPercent
            });
            this.status.warning = this.consecutiveNoSignal >= 3 ? 'no-signal' : '';
            this.emitUncertain('no-signal', { count: this.consecutiveNoSignal }, 9000);
            this.emitState();
            return { success: false, error: 'no-signal' };
        }
        this.consecutiveNoSignal = 0;

        this.processing = true;
        try {
            const samples = this.buffer.snapshot(this.buffer.sampleRate * RECOGNITION_SNAPSHOT_SECONDS);
            let signature;
            const startedAt = Date.now();
            try {
                signature = await this.createSignatureOffMainThread(samples);
            } catch (error) {
                pulseDebug('fingerprint-worker-fallback', error?.message || String(error));
                signature = createSignatureFromSamples(this.buffer.snapshot(this.buffer.sampleRate * RECOGNITION_SNAPSHOT_SECONDS));
                if (!signature.success) {
                    signature.error = signature.error || error?.message || 'fingerprint-failed';
                }
            }
            pulseDebug('fingerprint-result', {
                success: !!signature.success,
                error: signature.error || '',
                pending: !!signature.pending,
                totalPeaks: signature.totalPeaks || 0,
                sampleMs: signature.sampleMs || 0,
                elapsedMs: Date.now() - startedAt
            });
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
                pulseDebug('shazam-result', {
                    success: !!recognized?.success,
                    error: recognized?.error || '',
                    title: recognized?.result?.title || '',
                    artist: recognized?.result?.artist || ''
                });
            } catch (error) {
                const message = String(error?.message || error || 'recognition-failed');
                pulseDebug('shazam-error', message);
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
                pulseDebug('recognition-no-match', {
                    reason,
                    count: this.consecutiveNoMatch
                });
                if (
                    this.preferences.web_metadata_fallback_enabled &&
                    reason === 'no-match' &&
                    this.consecutiveNoMatch >= 2 &&
                    this.emitContextFallback(reason)
                ) {
                    return { success: true, result: this.getFreshContextMetadata(), fallback: 'web-metadata' };
                }
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
