'use strict';

const { EventEmitter } = require('events');
const { spawn, spawnSync } = require('child_process');

const DEFAULT_SAMPLE_RATE = 16000;
const DEFAULT_CHANNELS = 1;

function cleanString(value) {
    return String(value || '').trim();
}

function runPactl(args) {
    try {
        const result = spawnSync('pactl', args, {
            encoding: 'utf8',
            timeout: 2500,
            windowsHide: true
        });
        if (result.status !== 0) return '';
        return String(result.stdout || '').trim();
    } catch {
        return '';
    }
}

function getDefaultPulseSourceName() {
    const info = runPactl(['info']);
    const line = info.split(/\r?\n/).find((entry) => /^Default Source:/i.test(entry));
    return cleanString(line ? line.split(':').slice(1).join(':') : '');
}

function getDefaultPulseSinkName() {
    const info = runPactl(['info']);
    const line = info.split(/\r?\n/).find((entry) => /^Default Sink:/i.test(entry));
    return cleanString(line ? line.split(':').slice(1).join(':') : '');
}

function parseDetailedSourceDescriptions(text) {
    const descriptions = new Map();
    const blocks = String(text || '').split(/\n(?=Source #)/);
    for (const block of blocks) {
        const name = cleanString((block.match(/^\s*Name:\s*(.+)$/m) || [])[1]);
        if (!name) continue;
        const description = cleanString((block.match(/^\s*Description:\s*(.+)$/m) || [])[1]);
        const driver = cleanString((block.match(/^\s*Driver:\s*(.+)$/m) || [])[1]);
        const monitorOf = cleanString((block.match(/^\s*Monitor of Sink:\s*(.+)$/m) || [])[1]);
        descriptions.set(name, {
            description,
            driver,
            isMonitor: !!monitorOf && monitorOf.toLowerCase() !== 'n/a'
        });
    }
    return descriptions;
}

function parsePactlSources(text) {
    const defaultSource = getDefaultPulseSourceName();
    const defaultSinkMonitor = `${getDefaultPulseSinkName()}.monitor`;
    const detailed = parseDetailedSourceDescriptions(runPactl(['list', 'sources']));
    return String(text || '')
        .split(/\r?\n/)
        .map((line) => line.split('\t'))
        .filter((parts) => parts.length >= 2)
        .map((parts) => {
            const id = cleanString(parts[1]);
            const detail = detailed.get(id) || {};
            const driver = cleanString(detail.driver || parts[2]);
            const description = cleanString(detail.description || id);
            const isMonitor = detail.isMonitor === true || /\.monitor$/i.test(id) || /monitor/i.test(description);
            return {
                id,
                name: id,
                label: description,
                driver,
                isDefault: id === defaultSource,
                isDefaultMonitor: id === defaultSinkMonitor,
                isMonitor,
                backend: 'pulse'
            };
        })
        .filter((device) => device.id);
}

function listPulseDevices() {
    if (process.platform !== 'linux') {
        return {
            success: false,
            devices: [],
            error: 'unsupported-platform'
        };
    }

    const shortList = runPactl(['list', 'short', 'sources']);
    const devices = parsePactlSources(shortList);
    devices.sort((a, b) => {
        if (a.isDefaultMonitor !== b.isDefaultMonitor) return a.isDefaultMonitor ? -1 : 1;
        if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
        if (a.isMonitor !== b.isMonitor) return a.isMonitor ? 1 : -1;
        return a.label.localeCompare(b.label, 'tr');
    });

    return {
        success: devices.length > 0,
        devices,
        error: devices.length ? '' : 'no-pulse-sources'
    };
}

function pickAudioDeviceId(devices, preferredId = '') {
    const list = Array.isArray(devices)
        ? devices
        : (Array.isArray(devices?.devices) ? devices.devices : []);
    const wanted = cleanString(preferredId);
    if (wanted) {
        const exact = list.find((device) => device.id === wanted || device.label === wanted);
        if (exact) return exact.id;
    }
    return (
        list.find((device) => device.isDefaultMonitor)?.id ||
        list.find((device) => device.isMonitor)?.id ||
        list.find((device) => device.isDefault)?.id ||
        list[0]?.id ||
        ''
    );
}

function shouldIgnoreFfmpegStderr(message) {
    const text = cleanString(message);
    if (!text) return true;
    return /Guessed Channel Layout/i.test(text);
}

class PulseAudioCapture extends EventEmitter {
    constructor(options = {}) {
        super();
        this.sampleRate = Number(options.sampleRate) || DEFAULT_SAMPLE_RATE;
        this.channels = Number(options.channels) || DEFAULT_CHANNELS;
        this.process = null;
        this.audioDevice = '';
        this.bytesSeen = 0;
    }

    get running() {
        return !!(this.process && !this.process.killed);
    }

    start(options = {}) {
        if (this.running) return { success: true, alreadyRunning: true, audioDevice: this.audioDevice };

        const devicesResult = listPulseDevices();
        const devices = devicesResult.devices || [];
        const audioDevice = pickAudioDeviceId(devices, options.audioDevice);
        if (!audioDevice) {
            return { success: false, error: devicesResult.error || 'no-audio-device' };
        }

        const args = [
            '-hide_banner',
            '-loglevel', 'warning',
            '-f', 'pulse',
            '-i', audioDevice,
            '-ac', String(this.channels),
            '-ar', String(this.sampleRate),
            '-f', 'f32le',
            'pipe:1'
        ];

        const child = spawn(options.ffmpegPath || 'ffmpeg', args, {
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe']
        });

        this.process = child;
        this.audioDevice = audioDevice;
        this.bytesSeen = 0;

        child.stdout.on('data', (chunk) => {
            this.bytesSeen += chunk.length;
            this.emit('samples', chunk);
        });

        child.stderr.on('data', (chunk) => {
            const message = cleanString(chunk.toString('utf8'));
            if (message && !shouldIgnoreFfmpegStderr(message)) this.emit('warning', message);
        });

        child.once('error', (error) => {
            this.emit('error', error);
        });

        child.once('close', (code, signal) => {
            const wasCurrent = this.process === child;
            if (wasCurrent) {
                this.process = null;
                this.audioDevice = '';
            }
            this.emit('close', { code, signal, wasCurrent });
        });

        return { success: true, audioDevice, devices };
    }

    stop() {
        const child = this.process;
        this.process = null;
        this.audioDevice = '';
        if (!child) return { success: true, stopped: false };
        try {
            if (!child.killed) child.kill('SIGTERM');
        } catch {
            // best effort
        }
        return { success: true, stopped: true };
    }
}

module.exports = {
    DEFAULT_SAMPLE_RATE,
    listPulseDevices,
    pickAudioDeviceId,
    shouldIgnoreFfmpegStderr,
    PulseAudioCapture
};
