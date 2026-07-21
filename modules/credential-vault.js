'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const VAULT_VERSION = 2;
const SCRYPT = Object.freeze({ N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 });
const MAX_RECORDS = 1000;
const ID_RE = /^[a-f0-9]{32}$/;
const NOTICE_VERSION = 1;
const ACTIVATION_VERSION = 1;
const DEFAULT_LOCK_TIMEOUT_MS = 5 * 60 * 1000;
const ALLOWED_LOCK_TIMEOUTS_MS = Object.freeze([60_000, 5 * 60_000, 15 * 60_000, 30 * 60_000]);
const MAX_VAULT_BYTES = 16 * 1024 * 1024;
const BASE64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function b64(value) { return Buffer.from(value).toString('base64'); }
function fromB64(value) { return Buffer.from(String(value || ''), 'base64'); }
function cleanString(value, max) { return String(value || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max); }
function isStrongMasterPassword(value) {
    return typeof value === 'string' && value.length >= 12 && value.length <= 256 &&
        /[a-z]/.test(value) && /[A-Z]/.test(value) && /[0-9]/.test(value) && /[^A-Za-z0-9\s]/.test(value);
}
function validOrigin(value) {
    try {
        const parsed = new URL(String(value || ''));
        if (parsed.protocol !== 'https:' || parsed.origin !== String(value)) return '';
        if (parsed.username || parsed.password || !parsed.hostname || parsed.hostname.length > 253) return '';
        // URL canonicalization converts Unicode host names to ASCII/Punycode. Keeping
        // that canonical origin makes look-alike domains distinct by exact match.
        return parsed.origin;
    } catch (_) { return ''; }
}
function scryptAsync(password, salt) {
    return new Promise((resolve, reject) => crypto.scrypt(password, salt, 32, SCRYPT, (error, key) => error ? reject(error) : resolve(key)));
}
function seal(key, plaintext, aad, erasePlaintext = false) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(aad));
    const input = Buffer.isBuffer(plaintext) ? plaintext : Buffer.from(plaintext);
    try {
        const data = Buffer.concat([cipher.update(input), cipher.final()]);
        return { iv: b64(iv), tag: b64(cipher.getAuthTag()), data: b64(data) };
    } finally {
        if (erasePlaintext) input.fill(0);
    }
}
function open(key, envelope, aad) {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, fromB64(envelope.iv));
    decipher.setAAD(Buffer.from(aad));
    decipher.setAuthTag(fromB64(envelope.tag));
    return Buffer.concat([decipher.update(fromB64(envelope.data)), decipher.final()]);
}
function validEnvelope(value, maxDataLength) {
    return value && typeof value === 'object' && !Array.isArray(value) &&
        typeof value.iv === 'string' && value.iv.length === 16 && BASE64_RE.test(value.iv) &&
        typeof value.tag === 'string' && value.tag.length === 24 && BASE64_RE.test(value.tag) &&
        typeof value.data === 'string' && value.data.length > 0 && value.data.length <= maxDataLength && BASE64_RE.test(value.data);
}

class CredentialVault {
    constructor({ userDataPath, safeStorage, platform = process.platform }) {
        this.safeStorage = safeStorage;
        this.platform = platform;
        this.root = path.join(userDataPath, 'credential-vault');
        this.vaultPath = path.join(this.root, 'vault-v1.json');
        this.backupPath = path.join(this.root, 'vault-v1.backup.json');
        this.devicePath = path.join(this.root, 'device-secret.bin');
        this.enabledPath = path.join(this.root, 'experimental-enabled-v1');
        this.activationPath = path.join(this.root, 'activation-v1.json');
        this.dataKey = null;
        this.vault = null;
        this.lastActivity = 0;
        this.tokens = new Map();
        this.lockTimeoutMs = DEFAULT_LOCK_TIMEOUT_MS;
        this.failedUnlocks = 0;
        this.nextUnlockAt = 0;
        this.verificationInFlight = false;
        this.lockTimer = setInterval(() => {
            if (this.dataKey && Date.now() - this.lastActivity >= this.lockTimeoutMs) this.lock();
            this.pruneTokens();
        }, 15000);
        this.lockTimer.unref?.();
    }

    async storageStatus() {
        let available = false;
        try {
            available = typeof this.safeStorage?.isAsyncEncryptionAvailable === 'function'
                ? !!(await Promise.resolve(this.safeStorage.isAsyncEncryptionAvailable()))
                : !!this.safeStorage?.isEncryptionAvailable?.();
        } catch (_) { available = false; }
        const backend = this.platform === 'linux' ? String(this.safeStorage?.getSelectedStorageBackend?.() || 'unknown') : 'system';
        return { available: available && backend !== 'basic_text', backend, unsafeFallback: backend === 'basic_text' };
    }

    async status() {
        const storage = await this.storageStatus();
        const activation = this.readActivation();
        if (ALLOWED_LOCK_TIMEOUTS_MS.includes(activation?.lockTimeoutMs)) this.lockTimeoutMs = activation.lockTimeoutMs;
        return {
            supported: storage.available,
            backend: storage.backend,
            unsafeFallback: storage.unsafeFallback,
            enabled: this.isEnabled(),
            experimental: true,
            exists: fs.existsSync(this.vaultPath),
            locked: !this.dataKey,
            noticeVersion: NOTICE_VERSION,
            activationVersion: ACTIVATION_VERSION,
            noticeAcknowledged: activation?.noticeVersion === NOTICE_VERSION,
            lockTimeoutMs: this.lockTimeoutMs
        };
    }

    readActivation() {
        try {
            const value = JSON.parse(fs.readFileSync(this.activationPath, 'utf8'));
            if (!value || value.version !== ACTIVATION_VERSION || value.noticeVersion !== NOTICE_VERSION ||
                typeof value.acceptedAt !== 'number' || !Number.isFinite(value.acceptedAt) ||
                typeof value.featureEnabled !== 'boolean' ||
                (value.lockTimeoutMs !== undefined && !ALLOWED_LOCK_TIMEOUTS_MS.includes(value.lockTimeoutMs))) return null;
            return value;
        } catch (_) { return null; }
    }

    writeActivation(value) {
        fs.mkdirSync(this.root, { recursive: true, mode: 0o700 });
        const temporary = path.join(this.root, `.activation-${process.pid}-${crypto.randomBytes(6).toString('hex')}.tmp`);
        fs.writeFileSync(temporary, JSON.stringify(value), { mode: 0o600, flag: 'wx' });
        fs.renameSync(temporary, this.activationPath);
        try { fs.chmodSync(this.activationPath, 0o600); } catch (_) {}
    }

    setEnabled(enabled, acceptance = null) {
        if (enabled === true) {
            if (acceptance?.noticeVersion !== NOTICE_VERSION ||
                acceptance?.activationVersion !== ACTIVATION_VERSION ||
                acceptance?.noticeAcknowledged !== true || acceptance?.activationConfirmed !== true) {
                throw new Error('activation-consent-required');
            }
            this.writeActivation({
                version: ACTIVATION_VERSION,
                noticeVersion: NOTICE_VERSION,
                acceptedAt: Date.now(),
                featureEnabled: true,
                lockTimeoutMs: this.lockTimeoutMs
            });
            // Önceki deneysel işaret yalnızca geriye dönük temizlik için tutulur.
            try { fs.unlinkSync(this.enabledPath); } catch (_) {}
        } else {
            this.lock();
            try { fs.unlinkSync(this.enabledPath); } catch (_) {}
            const current = this.readActivation();
            if (current) this.writeActivation({ ...current, featureEnabled: false });
        }
        return enabled === true;
    }

    isEnabled() { return this.readActivation()?.featureEnabled === true; }

    setLockTimeout(timeoutMs) {
        const value = Number(timeoutMs);
        if (!ALLOWED_LOCK_TIMEOUTS_MS.includes(value)) throw new Error('invalid-lock-timeout');
        this.lockTimeoutMs = value;
        this.touch();
        const activation = this.readActivation();
        if (activation) this.writeActivation({ ...activation, lockTimeoutMs: value });
        return value;
    }

    async encryptDeviceSecret(secret) {
        if (typeof this.safeStorage.encryptStringAsync === 'function') return Promise.resolve(this.safeStorage.encryptStringAsync(b64(secret)));
        return this.safeStorage.encryptString(b64(secret));
    }

    async decryptDeviceSecret(payload) {
        if (typeof this.safeStorage.decryptStringAsync === 'function') {
            const result = await Promise.resolve(this.safeStorage.decryptStringAsync(payload));
            return fromB64(result.result);
        }
        return fromB64(this.safeStorage.decryptString(payload));
    }

    async getDeviceSecret(create = false) {
        const storage = await this.storageStatus();
        if (!storage.available) throw new Error('secure-storage-unavailable');
        if (fs.existsSync(this.devicePath)) return this.decryptDeviceSecret(fs.readFileSync(this.devicePath));
        if (!create) throw new Error('device-secret-missing');
        const secret = crypto.randomBytes(32);
        fs.mkdirSync(this.root, { recursive: true, mode: 0o700 });
        fs.writeFileSync(this.devicePath, await this.encryptDeviceSecret(secret), { mode: 0o600, flag: 'wx' });
        return secret;
    }

    async wrappingKey(masterPassword, salt, deviceSecret) {
        const masterKey = await scryptAsync(masterPassword, salt);
        try { return Buffer.from(crypto.hkdfSync('sha256', masterKey, deviceSecret, Buffer.from('ardali-credential-vault-v1'), 32)); }
        finally { masterKey.fill(0); }
    }

    readVault() {
        const parse = (file) => {
            const stat = fs.statSync(file);
            if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_VAULT_BYTES) throw new Error('invalid-vault');
            const value = JSON.parse(fs.readFileSync(file, 'utf8'));
            if (![1, VAULT_VERSION].includes(value?.version) || !Array.isArray(value.records) || value.records.length > MAX_RECORDS) throw new Error('invalid-vault');
            if (value.kdf?.name !== 'scrypt' || value.kdf?.N !== SCRYPT.N || value.kdf?.r !== SCRYPT.r || value.kdf?.p !== SCRYPT.p ||
                typeof value.kdf?.salt !== 'string' || value.kdf.salt.length !== 24 || !BASE64_RE.test(value.kdf.salt) ||
                !validEnvelope(value.wrappedKey, 64)) throw new Error('invalid-vault');
            const ids = new Set();
            for (const record of value.records) {
                if (!record || !ID_RE.test(String(record.id || '')) || ids.has(record.id) ||
                    !Number.isFinite(record.createdAt) || !Number.isFinite(record.updatedAt) ||
                    !validEnvelope(record.secret, 8192)) throw new Error('invalid-vault');
                if (value.version === VAULT_VERSION && ('origin' in record || 'username' in record || 'password' in record)) throw new Error('invalid-vault');
                ids.add(record.id);
            }
            return value;
        };
        try { return parse(this.vaultPath); } catch (error) {
            if (fs.existsSync(this.backupPath)) return parse(this.backupPath);
            throw error;
        }
    }

    writeVault(vault) {
        fs.mkdirSync(this.root, { recursive: true, mode: 0o700 });
        const temporary = path.join(this.root, `.vault-${process.pid}-${crypto.randomBytes(6).toString('hex')}.tmp`);
        fs.writeFileSync(temporary, JSON.stringify(vault), { mode: 0o600, flag: 'wx' });
        if (fs.existsSync(this.vaultPath)) fs.copyFileSync(this.vaultPath, this.backupPath);
        fs.renameSync(temporary, this.vaultPath);
        try { fs.chmodSync(this.vaultPath, 0o600); } catch (_) {}
    }

    async create(masterPassword) {
        if (!this.isEnabled()) throw new Error('feature-disabled');
        if (!isStrongMasterPassword(masterPassword)) throw new Error('weak-master-password');
        if (fs.existsSync(this.vaultPath)) throw new Error('vault-exists');
        const device = await this.getDeviceSecret(true);
        const salt = crypto.randomBytes(16);
        const wrapKey = await this.wrappingKey(masterPassword, salt, device);
        const dataKey = crypto.randomBytes(32);
        try {
            const vault = { version: VAULT_VERSION, kdf: { name: 'scrypt', salt: b64(salt), N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p }, wrappedKey: seal(wrapKey, dataKey, 'vault-key-v1'), records: [], createdAt: Date.now(), updatedAt: Date.now() };
            this.writeVault(vault);
            this.vault = vault;
            this.dataKey = dataKey;
            this.touch();
            return this.status();
        } finally { wrapKey.fill(0); device.fill(0); }
    }

    async verifyMaster(masterPassword, keepUnlocked = false) {
        if (typeof masterPassword !== 'string' || masterPassword.length > 256) throw new Error('invalid-master-password');
        if (this.verificationInFlight) throw new Error('verification-busy');
        if (Date.now() < this.nextUnlockAt) throw new Error('unlock-rate-limited');
        this.verificationInFlight = true;
        let device = null;
        let wrapKey = null;
        try {
            const vault = this.readVault();
            device = await this.getDeviceSecret(false);
            wrapKey = await this.wrappingKey(masterPassword, fromB64(vault.kdf.salt), device);
            const key = open(wrapKey, vault.wrappedKey, 'vault-key-v1');
            if (key.length !== 32) throw new Error('invalid-vault-key');
            if (keepUnlocked) {
                this.lock();
                this.dataKey = key;
                this.vault = vault;
                if (vault.version === 1) this.migrateLegacyVault();
                this.touch();
            } else key.fill(0);
            this.failedUnlocks = 0;
            this.nextUnlockAt = 0;
            return true;
        } catch (_) {
            this.failedUnlocks = Math.min(this.failedUnlocks + 1, 8);
            this.nextUnlockAt = Date.now() + Math.min(30_000, 500 * (2 ** (this.failedUnlocks - 1)));
            throw new Error('invalid-master-password');
        } finally {
            wrapKey?.fill?.(0);
            device?.fill?.(0);
            this.verificationInFlight = false;
        }
    }

    async unlock(masterPassword) { await this.verifyMaster(masterPassword, true); return this.status(); }
    touch() { this.lastActivity = Date.now(); }
    lock() { this.dataKey?.fill?.(0); this.dataKey = null; this.vault = null; this.lastActivity = 0; this.tokens.clear(); }
    ensureUnlocked() { if (!this.dataKey || !this.vault) throw new Error('vault-locked'); this.touch(); }
    pruneTokens() { for (const [token, item] of this.tokens) if (item.expiresAt <= Date.now()) this.tokens.delete(token); }

    async authorize(masterPassword) {
        await this.verifyMaster(masterPassword, false);
        const token = crypto.randomBytes(24).toString('hex');
        this.tokens.set(token, { expiresAt: Date.now() + 30000 });
        return token;
    }

    consumeToken(token) {
        this.pruneTokens();
        const item = this.tokens.get(String(token || ''));
        if (!item) throw new Error('authorization-required');
        this.tokens.delete(String(token));
    }

    listMetadata(origin = '') {
        this.ensureUnlocked();
        const target = origin ? validOrigin(origin) : '';
        return this.vault.records.map((record) => ({ record, value: this.decryptRecord(record) }))
            .filter(({ value }) => !target || value.origin === target)
            .map(({ record, value }) => ({ id: record.id, origin: value.origin, username: value.username, createdAt: record.createdAt, updatedAt: record.updatedAt }));
    }

    decryptRecord(record) {
        const legacy = this.vault?.version === 1;
        const plaintext = open(this.dataKey, record.secret, legacy ? `record:${record.id}:${record.origin}` : `record:${record.id}`);
        let value;
        try { value = JSON.parse(plaintext.toString('utf8')); }
        finally { plaintext.fill(0); }
        const origin = validOrigin(value.origin || record.origin);
        const username = cleanString(value.username, 320);
        const password = String(value.password || '');
        if (!origin || !username || !password || password.length > 4096) throw new Error('invalid-vault-record');
        return { origin, username, password };
    }

    migrateLegacyVault() {
        if (!this.dataKey || !this.vault || this.vault.version !== 1) return false;
        const migrated = this.vault.records.map((record) => {
            const value = this.decryptRecord(record);
            return {
                id: record.id,
                createdAt: record.createdAt,
                updatedAt: record.updatedAt,
                secret: seal(this.dataKey, Buffer.from(JSON.stringify(value)), `record:${record.id}`, true)
            };
        });
        this.vault.records = migrated;
        this.vault.version = VAULT_VERSION;
        this.vault.updatedAt = Date.now();
        this.writeVault(this.vault);
        return true;
    }

    save({ origin, username, password }) {
        this.ensureUnlocked();
        const site = validOrigin(origin);
        const user = cleanString(username, 320);
        if (!site || !user || typeof password !== 'string' || !password || password.length > 4096) throw new Error('invalid-credential');
        let record = this.vault.records.find((item) => {
            const value = this.decryptRecord(item);
            return value.origin === site && value.username === user;
        });
        const now = Date.now();
        if (!record) {
            if (this.vault.records.length >= MAX_RECORDS) throw new Error('vault-full');
            record = { id: crypto.randomBytes(16).toString('hex'), createdAt: now, updatedAt: now, secret: null };
            this.vault.records.push(record);
        }
        record.updatedAt = now;
        record.secret = seal(this.dataKey, Buffer.from(JSON.stringify({ origin: site, username: user, password })), `record:${record.id}`, true);
        this.vault.updatedAt = now;
        this.writeVault(this.vault);
        return { id: record.id, origin: site, username: user, createdAt: record.createdAt, updatedAt: now };
    }

    reveal(id, token) {
        this.ensureUnlocked(); this.consumeToken(token);
        const record = this.vault.records.find((item) => item.id === id && ID_RE.test(item.id));
        if (!record) throw new Error('record-not-found');
        return this.decryptRecord(record);
    }

    update(id, values, token) {
        this.ensureUnlocked(); this.consumeToken(token);
        const index = this.vault.records.findIndex((item) => item.id === id && ID_RE.test(item.id));
        if (index < 0) throw new Error('record-not-found');
        const current = this.decryptRecord(this.vault.records[index]);
        const record = this.vault.records[index];
        const username = cleanString(values?.username ?? current.username, 320);
        const password = String(values?.password ?? current.password);
        if (!username || !password || password.length > 4096) throw new Error('invalid-credential');
        record.updatedAt = Date.now();
        record.secret = seal(this.dataKey, Buffer.from(JSON.stringify({ origin: current.origin, username, password })), `record:${record.id}`, true);
        this.vault.updatedAt = Date.now(); this.writeVault(this.vault);
        return this.listMetadata().find((item) => item.id === id);
    }

    delete(id, token) {
        this.ensureUnlocked(); this.consumeToken(token);
        const before = this.vault.records.length;
        this.vault.records = this.vault.records.filter((item) => item.id !== id);
        if (this.vault.records.length === before) throw new Error('record-not-found');
        this.vault.updatedAt = Date.now(); this.writeVault(this.vault); return true;
    }

    async changeMasterPassword(oldPassword, newPassword, token) {
        this.ensureUnlocked(); this.consumeToken(token);
        if (!isStrongMasterPassword(newPassword)) throw new Error('weak-master-password');
        await this.verifyMaster(oldPassword, false);
        const device = await this.getDeviceSecret(false); const salt = crypto.randomBytes(16);
        const wrapKey = await this.wrappingKey(newPassword, salt, device);
        try {
            this.vault.kdf = { name: 'scrypt', salt: b64(salt), N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p };
            this.vault.wrappedKey = seal(wrapKey, this.dataKey, 'vault-key-v1');
            this.vault.updatedAt = Date.now(); this.writeVault(this.vault); return true;
        } finally { wrapKey.fill(0); device.fill(0); }
    }

    reset(token) {
        this.consumeToken(token); this.lock();
        for (const file of [this.vaultPath, this.backupPath, this.devicePath]) { try { fs.unlinkSync(file); } catch (_) {} }
        return true;
    }

    close() { clearInterval(this.lockTimer); this.lock(); }
}

module.exports = { CredentialVault, validOrigin, isStrongMasterPassword, NOTICE_VERSION, ACTIVATION_VERSION, ALLOWED_LOCK_TIMEOUTS_MS };
