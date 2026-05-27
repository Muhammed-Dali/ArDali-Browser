'use strict';

const DATA_URI_PREFIX = 'data:audio/vnd.shazam.sig;base64,';
const SAMPLE_RATE = 16000;
const FFT_SIZE = 2048;
const FFT_STEP = 128;
const FFT_RING = 256;

class SlidingPcmBuffer {
    constructor({ sampleRate = 16000, seconds = 8 } = {}) {
        this.sampleRate = Math.max(8000, Math.min(48000, Number(sampleRate) || 16000));
        this.seconds = Math.max(4, Math.min(30, Number(seconds) || 8));
        this.capacity = this.sampleRate * this.seconds;
        this.samples = new Float32Array(this.capacity);
        this.writeIndex = 0;
        this.filled = 0;
    }

    pushF32Buffer(buffer) {
        if (!Buffer.isBuffer(buffer) || buffer.length < 4) return;
        const usableBytes = buffer.length - (buffer.length % 4);
        for (let offset = 0; offset < usableBytes; offset += 4) {
            const sample = buffer.readFloatLE(offset);
            this.samples[this.writeIndex] = Number.isFinite(sample) ? Math.max(-1, Math.min(1, sample)) : 0;
            this.writeIndex = (this.writeIndex + 1) % this.capacity;
            this.filled = Math.min(this.capacity, this.filled + 1);
        }
    }

    snapshot(maxSamples = 0) {
        const wanted = Math.max(0, Math.min(this.filled, Number(maxSamples) || this.filled));
        const out = new Float32Array(wanted);
        const start = (this.writeIndex - wanted + this.capacity) % this.capacity;
        for (let i = 0; i < wanted; i += 1) {
            out[i] = this.samples[(start + i) % this.capacity];
        }
        return out;
    }

    getRecentLevelStats(windowSamples = 1600) {
        const count = Math.min(this.filled, Math.max(1, Number(windowSamples) || 320));
        if (!count) return { peak: 0, rms: 0 };
        let peak = 0;
        let sumSquares = 0;
        for (let i = 0; i < count; i += 1) {
            const index = (this.writeIndex - 1 - i + this.capacity) % this.capacity;
            const sample = Math.abs(this.samples[index]);
            peak = Math.max(peak, sample);
            sumSquares += sample * sample;
        }
        return {
            peak,
            rms: Math.sqrt(sumSquares / count)
        };
    }

    getLevelPercent(windowSamples = 1600, gain = 1) {
        const { peak, rms } = this.getRecentLevelStats(windowSamples);
        if (!peak && !rms) return 0;
        const visualGain = Math.max(0.1, Math.min(8, Number(gain) || 1));
        const gainDb = 20 * Math.log10(visualGain);
        const rmsDb = 20 * Math.log10(Math.max(1e-6, rms)) + gainDb;
        const peakDb = 20 * Math.log10(Math.max(1e-6, peak)) + gainDb;
        const toPercent = (db, floorDb, ceilingDb) => {
            const normalized = (db - floorDb) / (ceilingDb - floorDb);
            return Math.max(0, Math.min(100, normalized * 100));
        };
        const rmsPercent = toPercent(rmsDb, -48, -2);
        const peakPercent = toPercent(peakDb, -35, -1) * 0.35;
        const linearPercent = Math.min(100, rms * visualGain * 420);
        const blended = Math.max((rmsPercent * 0.08) + (linearPercent * 0.92), peakPercent);
        return Math.max(0, Math.min(100, blended));
    }

    hasSignal(threshold = 0.003) {
        const { peak, rms } = this.getRecentLevelStats(this.sampleRate / 2);
        return Math.max(peak, rms * 1.8) >= threshold;
    }
}

function makeCrc32Table() {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i += 1) {
        let c = i;
        for (let k = 0; k < 8; k += 1) {
            c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
        }
        table[i] = c >>> 0;
    }
    return table;
}

const CRC32_TABLE = makeCrc32Table();

function crc32(buffer, start = 0) {
    let c = 0xffffffff;
    for (let i = start; i < buffer.length; i += 1) {
        c = CRC32_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
}

function writeU32LE(bytes, value) {
    bytes.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
}

function writeU16LE(bytes, value) {
    bytes.push(value & 0xff, (value >>> 8) & 0xff);
}

function hanning(index) {
    return 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / (FFT_SIZE - 1));
}

const HANNING = Float32Array.from({ length: FFT_SIZE }, (_, index) => hanning(index));

function fftInPlace(real, imag) {
    const n = real.length;
    for (let i = 1, j = 0; i < n; i += 1) {
        let bit = n >> 1;
        for (; j & bit; bit >>= 1) j ^= bit;
        j ^= bit;
        if (i < j) {
            const tr = real[i];
            const ti = imag[i];
            real[i] = real[j];
            imag[i] = imag[j];
            real[j] = tr;
            imag[j] = ti;
        }
    }

    for (let len = 2; len <= n; len <<= 1) {
        const angle = -2 * Math.PI / len;
        const wlenR = Math.cos(angle);
        const wlenI = Math.sin(angle);
        for (let i = 0; i < n; i += len) {
            let wr = 1;
            let wi = 0;
            for (let j = 0; j < (len >> 1); j += 1) {
                const uR = real[i + j];
                const uI = imag[i + j];
                const vIndex = i + j + (len >> 1);
                const vR = real[vIndex] * wr - imag[vIndex] * wi;
                const vI = real[vIndex] * wi + imag[vIndex] * wr;
                real[i + j] = uR + vR;
                imag[i + j] = uI + vI;
                real[vIndex] = uR - vR;
                imag[vIndex] = uI - vI;
                const nextWr = wr * wlenR - wi * wlenI;
                wi = wr * wlenI + wi * wlenR;
                wr = nextWr;
            }
        }
    }
}

function createEmptyPeakBands() {
    return [[], [], [], []];
}

function bandForFrequency(frequencyHz) {
    if (frequencyHz >= 250 && frequencyHz <= 519) return 0;
    if (frequencyHz >= 520 && frequencyHz <= 1449) return 1;
    if (frequencyHz >= 1450 && frequencyHz <= 3499) return 2;
    if (frequencyHz >= 3500 && frequencyHz <= 5500) return 3;
    return -1;
}

class SignatureGenerator {
    constructor(numberSamples) {
        this.ringSamples = new Float32Array(FFT_SIZE);
        this.ringIndex = 0;
        this.fftOutputs = Array.from({ length: FFT_RING }, () => new Float32Array(1025));
        this.fftIndex = 0;
        this.spreadOutputs = Array.from({ length: FFT_RING }, () => new Float32Array(1025));
        this.spreadIndex = 0;
        this.numSpreadFfts = 0;
        this.bands = createEmptyPeakBands();
        this.numberSamples = numberSamples;
    }

    process(samples) {
        const roundedLength = samples.length - (samples.length % FFT_STEP);
        for (let offset = 0; offset < roundedLength; offset += FFT_STEP) {
            this.doFft(samples, offset);
            this.doPeakSpreading();
            this.numSpreadFfts += 1;
            if (this.numSpreadFfts >= 46) this.doPeakRecognition();
        }
        return {
            sampleRateHz: SAMPLE_RATE,
            numberSamples: this.numberSamples,
            bands: this.bands
        };
    }

    doFft(samples, offset) {
        for (let i = 0; i < FFT_STEP; i += 1) {
            this.ringSamples[(this.ringIndex + i) & (FFT_SIZE - 1)] = samples[offset + i] || 0;
        }
        this.ringIndex = (this.ringIndex + FFT_STEP) & (FFT_SIZE - 1);

        const real = new Float32Array(FFT_SIZE);
        const imag = new Float32Array(FFT_SIZE);
        for (let i = 0; i < FFT_SIZE; i += 1) {
            real[i] = this.ringSamples[(i + this.ringIndex) & (FFT_SIZE - 1)] * HANNING[i] * 32768;
        }
        fftInPlace(real, imag);

        const out = this.fftOutputs[this.fftIndex];
        for (let i = 0; i <= 1024; i += 1) {
            out[i] = Math.max(((real[i] * real[i]) + (imag[i] * imag[i])) / (1 << 17), 1e-10);
        }
        this.fftIndex = (this.fftIndex + 1) & (FFT_RING - 1);
    }

    doPeakSpreading() {
        const real = this.fftOutputs[(this.fftIndex - 1 + FFT_RING) & (FFT_RING - 1)];
        const spread = this.spreadOutputs[this.spreadIndex];
        spread.set(real);
        for (let pos = 0; pos <= 1022; pos += 1) {
            spread[pos] = Math.max(spread[pos], spread[pos + 1], spread[pos + 2]);
        }

        const copy = new Float32Array(spread);
        for (let pos = 0; pos <= 1024; pos += 1) {
            for (const former of [1, 3, 6]) {
                const formerOut = this.spreadOutputs[(this.spreadIndex - former + FFT_RING) & (FFT_RING - 1)];
                formerOut[pos] = Math.max(formerOut[pos], copy[pos]);
            }
        }
        this.spreadIndex = (this.spreadIndex + 1) & (FFT_RING - 1);
    }

    doPeakRecognition() {
        const fftMinus46 = this.fftOutputs[(this.fftIndex - 46 + FFT_RING) & (FFT_RING - 1)];
        const spreadMinus49 = this.spreadOutputs[(this.spreadIndex - 49 + FFT_RING) & (FFT_RING - 1)];

        for (let bin = 10; bin <= 1014; bin += 1) {
            if (fftMinus46[bin] < 1 / 64 || fftMinus46[bin] < spreadMinus49[bin - 1]) continue;

            let maxNeighbor = 0;
            for (const offset of [-10, -7, -4, -3, 1, 2, 5, 8]) {
                maxNeighbor = Math.max(maxNeighbor, spreadMinus49[bin + offset]);
            }
            if (fftMinus46[bin] <= maxNeighbor) continue;

            let maxAdjacent = maxNeighbor;
            for (const offset of [-53, -45, 165, 172, 179, 186, 193, 200, 214, 221, 228, 235, 242, 249]) {
                const other = this.spreadOutputs[(this.spreadIndex + offset + FFT_RING) & (FFT_RING - 1)];
                maxAdjacent = Math.max(maxAdjacent, other[bin - 1]);
            }
            if (fftMinus46[bin] <= maxAdjacent) continue;

            const fftPassNumber = this.numSpreadFfts - 46;
            const magnitude = Math.max(Math.log(fftMinus46[bin]), 1 / 64) * 1477.3 + 6144;
            const before = Math.max(Math.log(fftMinus46[bin - 1]), 1 / 64) * 1477.3 + 6144;
            const after = Math.max(Math.log(fftMinus46[bin + 1]), 1 / 64) * 1477.3 + 6144;
            const variation1 = magnitude * 2 - before - after;
            if (variation1 < 0) continue;
            const variation2 = (after - before) * 32 / (variation1 || 1);
            const correctedBin = Math.max(0, Math.min(65535, bin * 64 + Math.trunc(variation2)));
            const frequencyHz = correctedBin * (SAMPLE_RATE / 2 / 1024 / 64);
            const band = bandForFrequency(frequencyHz);
            if (band < 0) continue;
            this.bands[band].push({
                fftPassNumber,
                peakMagnitude: Math.max(0, Math.min(65535, Math.trunc(magnitude))),
                correctedPeakFrequencyBin: correctedBin
            });
        }
    }
}

function encodeSignature(signature) {
    const bytes = [];
    writeU32LE(bytes, 0xcafe2580);
    writeU32LE(bytes, 0);
    writeU32LE(bytes, 0);
    writeU32LE(bytes, 0x94119c00);
    writeU32LE(bytes, 0);
    writeU32LE(bytes, 0);
    writeU32LE(bytes, 0);
    writeU32LE(bytes, 3 << 27);
    writeU32LE(bytes, 0);
    writeU32LE(bytes, 0);
    writeU32LE(bytes, signature.numberSamples + Math.trunc(SAMPLE_RATE * 0.24));
    writeU32LE(bytes, (15 << 19) + 0x40000);
    writeU32LE(bytes, 0x40000000);
    writeU32LE(bytes, 0);

    for (let band = 0; band < 4; band += 1) {
        const peaks = signature.bands[band] || [];
        if (!peaks.length) continue;
        const peakBytes = [];
        let fftPassNumber = 0;
        for (const peak of peaks) {
            const delta = peak.fftPassNumber - fftPassNumber;
            if (delta >= 255) {
                peakBytes.push(0xff);
                writeU32LE(peakBytes, peak.fftPassNumber);
                fftPassNumber = peak.fftPassNumber;
            }
            peakBytes.push(Math.max(0, Math.min(254, peak.fftPassNumber - fftPassNumber)));
            writeU16LE(peakBytes, peak.peakMagnitude);
            writeU16LE(peakBytes, peak.correctedPeakFrequencyBin);
            fftPassNumber = peak.fftPassNumber;
        }
        writeU32LE(bytes, 0x60030040 + band);
        writeU32LE(bytes, peakBytes.length);
        bytes.push(...peakBytes);
        while (bytes.length % 4 !== 0) bytes.push(0);
    }

    const buffer = Buffer.from(bytes);
    buffer.writeUInt32LE(buffer.length - 48, 8);
    buffer.writeUInt32LE(buffer.length - 48, 52);
    buffer.writeUInt32LE(crc32(buffer, 8), 4);
    return buffer;
}

function createSignatureFromSamples(samples, _options = {}) {
    if (!(samples instanceof Float32Array) || samples.length < 16000 * 4) {
        return {
            success: false,
            pending: true,
            error: 'not-enough-audio'
        };
    }

    const generator = new SignatureGenerator(samples.length);
    const signature = generator.process(samples);
    const totalPeaks = signature.bands.reduce((sum, band) => sum + band.length, 0);
    if (totalPeaks < 8) {
        return {
            success: false,
            error: 'not-enough-peaks',
            totalPeaks
        };
    }
    const binary = encodeSignature(signature);
    return {
        success: true,
        uri: `${DATA_URI_PREFIX}${binary.toString('base64')}`,
        sampleMs: Math.trunc(samples.length / SAMPLE_RATE * 1000),
        totalPeaks
    };
}

module.exports = {
    SlidingPcmBuffer,
    createSignatureFromSamples,
    encodeSignature
};
