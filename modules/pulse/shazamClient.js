'use strict';

const http = require('http');
const https = require('https');
const crypto = require('crypto');

function postJson(url, body, headers = {}) {
    return new Promise((resolve, reject) => {
        const payload = Buffer.from(JSON.stringify(body));
        const request = https.request(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': String(payload.length),
                'Content-Language': 'en_US',
                'User-Agent': 'ArDali-Pulse/1.0',
                ...headers
            },
            timeout: 20000
        }, (response) => {
            const chunks = [];
            response.on('data', (chunk) => chunks.push(chunk));
            response.on('end', () => {
                const text = Buffer.concat(chunks).toString('utf8');
                if (response.statusCode === 429) {
                    reject(new Error('rate-limited'));
                    return;
                }
                if (response.statusCode < 200 || response.statusCode >= 300) {
                    reject(new Error(`http-${response.statusCode}`));
                    return;
                }
                try {
                    resolve(JSON.parse(text || '{}'));
                } catch (error) {
                    reject(error);
                }
            });
        });
        request.on('timeout', () => {
            request.destroy(new Error('timeout'));
        });
        request.on('error', reject);
        request.end(payload);
    });
}

function fetchImageAsDataUrl(rawUrl, redirects = 0) {
    return new Promise((resolve, reject) => {
        const url = String(rawUrl || '').trim();
        if (!/^https?:\/\//i.test(url)) {
            resolve(url);
            return;
        }
        let parsed;
        try {
            parsed = new URL(url);
        } catch {
            resolve(url);
            return;
        }
        const client = parsed.protocol === 'http:' ? http : https;
        const request = client.request(parsed, {
            method: 'GET',
            timeout: 5000,
            headers: {
                Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
                'User-Agent': 'Mozilla/5.0 ArDali-Pulse/1.0'
            }
        }, (response) => {
            const statusCode = Number(response.statusCode || 0);
            const location = response.headers.location;
            if ([301, 302, 303, 307, 308].includes(statusCode) && location && redirects < 3) {
                response.resume();
                const nextUrl = new URL(location, parsed).toString();
                fetchImageAsDataUrl(nextUrl, redirects + 1).then(resolve, reject);
                return;
            }
            if (statusCode < 200 || statusCode >= 300) {
                response.resume();
                resolve(url);
                return;
            }
            const contentType = String(response.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
            if (!contentType.startsWith('image/')) {
                response.resume();
                resolve(url);
                return;
            }
            const chunks = [];
            let total = 0;
            response.on('data', (chunk) => {
                total += chunk.length;
                if (total > 3 * 1024 * 1024) {
                    request.destroy(new Error('image-too-large'));
                    return;
                }
                chunks.push(chunk);
            });
            response.on('end', () => {
                const base64 = Buffer.concat(chunks).toString('base64');
                resolve(`data:${contentType};base64,${base64}`);
            });
        });
        request.on('timeout', () => request.destroy(new Error('timeout')));
        request.on('error', () => resolve(url));
        request.end();
    });
}

async function resolveCoverUrl(rawUrl) {
    const url = String(rawUrl || '').trim();
    if (!url || url.startsWith('data:image/')) return url;
    return fetchImageAsDataUrl(url);
}

function uuid() {
    return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
}

function normalizeShazamResult(jsonObject) {
    const track = jsonObject && typeof jsonObject === 'object' ? jsonObject.track : null;
    if (!track || typeof track !== 'object') return null;
    const title = String(track.title || '').trim();
    const artist = String(track.subtitle || '').trim();
    if (!title || !artist) return null;
    return {
        title,
        artist,
        album: '',
        coverUrl: String(track.images?.coverarthq || track.images?.coverart || '').trim(),
        genre: String(track.genres?.primary || '').trim(),
        trackKey: String(track.key || '').trim(),
        raw: jsonObject
    };
}

async function recognizeSignature(signatureUri, options = {}) {
    const uri = String(signatureUri || '').trim();
    if (!uri) return { success: false, error: 'missing-signature' };

    const timestamp = Date.now();
    const endpoint = `https://amp.shazam.com/discovery/v5/en/US/android/-/tag/${uuid().toUpperCase()}/${uuid()}?sync=true&webv3=true&sampling=true&connected=&shazamapiversion=v3&sharehub=true&video=v3`;
    const body = {
        geolocation: {
            altitude: 300,
            latitude: 45,
            longitude: 2
        },
        signature: {
            samplems: Math.max(1000, Number(options.sampleMs) || 8000),
            timestamp,
            uri
        },
        timestamp,
        timezone: 'Europe/Istanbul'
    };

    const json = await postJson(endpoint, body);
    const result = normalizeShazamResult(json);
    if (!result) return { success: false, error: 'no-match', raw: json };
    result.coverUrl = await resolveCoverUrl(result.coverUrl);
    return { success: true, result };
}

module.exports = {
    recognizeSignature,
    normalizeShazamResult,
    resolveCoverUrl
};
