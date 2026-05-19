'use strict';

const { parentPort } = require('worker_threads');
const { createSignatureFromSamples } = require('./fingerprint');

if (!parentPort) {
    throw new Error('fingerprintWorker requires worker_threads parentPort');
}

parentPort.on('message', (message = {}) => {
    try {
        const samples = new Float32Array(message.samples);
        parentPort.postMessage({
            id: message.id,
            result: createSignatureFromSamples(samples)
        });
    } catch (error) {
        parentPort.postMessage({
            id: message.id,
            result: {
                success: false,
                error: error?.message || String(error || 'fingerprint-worker-failed')
            }
        });
    }
});
