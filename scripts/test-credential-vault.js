'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { CredentialVault, validOrigin, NOTICE_VERSION, ACTIVATION_VERSION } = require('../modules/credential-vault');

const mockSafeStorage = {
    isAsyncEncryptionAvailable: async () => true,
    getSelectedStorageBackend: () => 'gnome_libsecret',
    encryptStringAsync: async (value) => Buffer.from(`protected:${value}`, 'utf8'),
    decryptStringAsync: async (value) => ({ result: value.toString('utf8').replace(/^protected:/, ''), shouldReEncrypt: false })
};

(async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ardali-vault-test-'));
    const vault = new CredentialVault({ userDataPath: root, safeStorage: mockSafeStorage, platform: 'linux' });
    try {
        assert.equal(validOrigin('https://github.com'), 'https://github.com');
        assert.equal(validOrigin('https://github-login.com'), 'https://github-login.com');
        assert.notEqual(validOrigin('https://github.com'), validOrigin('https://github-login.com'));
        assert.equal(validOrigin('https://github.com/path'), '');
        assert.equal(validOrigin('http://github.com'), '');
        assert.equal(validOrigin('https://user:secret@github.com'), '');
        // Non-canonical Unicode look-alike origins are rejected; callers must use
        // the browser's exact canonical ASCII origin.
        assert.equal(validOrigin('https://аррӏе.com'), '');
        assert.equal((await vault.status()).exists, false);
        assert.equal((await vault.status()).enabled, false);
        await assert.rejects(() => vault.create('CorrectHorse#2026'), /feature-disabled/);
        assert.throws(() => vault.setEnabled(true), /activation-consent-required/);
        assert.throws(() => vault.setEnabled(true, {
            noticeVersion: NOTICE_VERSION,
            activationVersion: ACTIVATION_VERSION,
            noticeAcknowledged: true,
            activationConfirmed: false
        }), /activation-consent-required/);
        vault.setEnabled(true, {
            noticeVersion: NOTICE_VERSION,
            activationVersion: ACTIVATION_VERSION,
            noticeAcknowledged: true,
            activationConfirmed: true
        });
        assert.equal((await vault.status()).enabled, true);
        const activation = JSON.parse(fs.readFileSync(path.join(root, 'credential-vault', 'activation-v1.json'), 'utf8'));
        assert.equal(activation.featureEnabled, true);
        assert.equal(activation.noticeVersion, NOTICE_VERSION);
        assert.equal(Object.hasOwn(activation, 'username'), false);
        assert.equal(Object.hasOwn(activation, 'password'), false);
        await assert.rejects(() => vault.create('alllowercase#2026'), /weak-master-password/);
        await vault.create('CorrectHorse#2026');
        assert.equal(vault.setLockTimeout(60_000), 60_000);
        assert.throws(() => vault.setLockTimeout(1234), /invalid-lock-timeout/);
        const saved = vault.save({ origin: 'https://github.com', username: 'user@example.com', password: 'secret-value' });
        const rawVault = fs.readFileSync(path.join(root, 'credential-vault', 'vault-v1.json'), 'utf8');
        assert.equal(rawVault.includes('user@example.com'), false);
        assert.equal(rawVault.includes('secret-value'), false);
        assert.equal(rawVault.includes('https://github.com'), false);
        assert.equal(vault.listMetadata()[0].username, 'user@example.com');
        const token = await vault.authorize('CorrectHorse#2026');
        assert.equal(vault.reveal(saved.id, token).password, 'secret-value');
        assert.throws(() => vault.reveal(saved.id, token), /authorization-required/);
        vault.lock();
        assert.throws(() => vault.listMetadata(), /vault-locked/);
        await assert.rejects(() => vault.unlock('incorrect password value'), /authenticate|Unsupported state|invalid/i);
        await assert.rejects(() => vault.unlock('CorrectHorse#2026'), /unlock-rate-limited/);
        vault.nextUnlockAt = 0;
        await vault.unlock('CorrectHorse#2026');
        assert.equal(vault.listMetadata().length, 1);
        const auth = await vault.authorize('CorrectHorse#2026');
        await vault.changeMasterPassword('CorrectHorse#2026', 'DifferentSecure#2027', auth);
        vault.lock();
        await vault.unlock('DifferentSecure#2027');
        assert.equal(vault.listMetadata()[0].origin, 'https://github.com');
        vault.setEnabled(false);
        assert.equal((await vault.status()).enabled, false);
        assert.equal((await vault.status()).locked, true);
        assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'credential-vault', 'activation-v1.json'), 'utf8')).featureEnabled, false);
        assert.throws(() => vault.save({ origin: 'https://example.com', username: 'blocked', password: 'blocked' }), /vault-locked/);
        console.log('credential vault tests: ok');
    } finally {
        vault.close();
        fs.rmSync(root, { recursive: true, force: true });
    }
})().catch((error) => { console.error(error); process.exitCode = 1; });
