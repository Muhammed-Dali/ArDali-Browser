'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SIGNATURE_SCHEMA_VERSION = 1;
const SIGNATURE_ALGORITHM = 'ed25519';
const DIGEST_ALGORITHM = 'sha256';

function ensure(condition, message) {
  if (!condition) throw new Error(`[DALI SIGNATURE] ${message}`);
}

function resolveSafePath(p) {
  return path.resolve(process.cwd(), String(p || '').trim());
}

function computeSourceDigestHex(sourceText) {
  const data = Buffer.from(String(sourceText || ''), 'utf8');
  return crypto.createHash(DIGEST_ALGORITHM).update(data).digest('hex');
}

function signSourceText(sourceText, { privateKeyPem, keyId, fileLabel }) {
  ensure(privateKeyPem, 'private key is required');
  const digestHex = computeSourceDigestHex(sourceText);
  const digestBuffer = Buffer.from(digestHex, 'hex');
  const signature = crypto.sign(null, digestBuffer, privateKeyPem).toString('base64');

  return {
    schema: SIGNATURE_SCHEMA_VERSION,
    algorithm: SIGNATURE_ALGORITHM,
    digest: {
      algorithm: DIGEST_ALGORITHM,
      hex: digestHex
    },
    keyId: String(keyId || 'default').trim() || 'default',
    file: String(fileLabel || '').trim(),
    signedAt: new Date().toISOString(),
    signature
  };
}

function verifySourceTextSignature(sourceText, signatureData, { publicKeyPem, fileLabel }) {
  ensure(publicKeyPem, 'public key is required');
  ensure(signatureData && typeof signatureData === 'object', 'signature data must be an object');
  ensure(Number(signatureData.schema) === SIGNATURE_SCHEMA_VERSION, `unsupported signature schema: ${signatureData.schema}`);
  ensure(String(signatureData.algorithm || '').toLowerCase() === SIGNATURE_ALGORITHM, `unsupported signature algorithm: ${signatureData.algorithm}`);
  ensure(signatureData.digest && typeof signatureData.digest === 'object', 'signature digest block is missing');
  ensure(String(signatureData.digest.algorithm || '').toLowerCase() === DIGEST_ALGORITHM, `unsupported digest algorithm: ${signatureData.digest.algorithm}`);
  ensure(typeof signatureData.signature === 'string' && signatureData.signature.length > 0, 'signature text is missing');

  const digestHex = computeSourceDigestHex(sourceText);
  ensure(digestHex === String(signatureData.digest.hex || '').toLowerCase(), 'source digest mismatch');

  const ok = crypto.verify(
    null,
    Buffer.from(digestHex, 'hex'),
    publicKeyPem,
    Buffer.from(signatureData.signature, 'base64')
  );
  ensure(ok, 'signature verification failed');

  if (fileLabel && signatureData.file) {
    const expected = String(fileLabel).trim();
    const recorded = String(signatureData.file).trim();
    ensure(expected === recorded, `signature file label mismatch (expected '${expected}', got '${recorded}')`);
  }

  return true;
}

function defaultSignaturePathForSource(sourcePath) {
  const abs = resolveSafePath(sourcePath);
  return `${abs}.sig.json`;
}

function readPemFile(p) {
  const abs = resolveSafePath(p);
  ensure(fs.existsSync(abs), `key file not found: ${abs}`);
  return fs.readFileSync(abs, 'utf8');
}

module.exports = {
  SIGNATURE_SCHEMA_VERSION,
  SIGNATURE_ALGORITHM,
  DIGEST_ALGORITHM,
  computeSourceDigestHex,
  signSourceText,
  verifySourceTextSignature,
  defaultSignaturePathForSource,
  readPemFile
};

