import crypto from 'node:crypto';
import fs from 'node:fs';
const LOCAL_KEY_PROVIDER = 'local_envelope';
export function isCredentialVaultConfigured() {
    return readLocalMasterKey(false) !== null;
}
export function encryptCredentialPayload(payload) {
    const dataKey = crypto.randomBytes(32);
    const masterKey = readLocalMasterKey(true);
    return {
        keyProvider: LOCAL_KEY_PROVIDER,
        keyVersion: process.env.CREDENTIAL_VAULT_KEY_VERSION?.trim() || 'local-v1',
        encryptedPayload: JSON.stringify(encryptBuffer(dataKey, Buffer.from(JSON.stringify(payload), 'utf8'))),
        encryptedDataKey: JSON.stringify(encryptBuffer(masterKey, dataKey)),
    };
}
export function decryptCredentialPayload(input) {
    if (input.keyProvider !== LOCAL_KEY_PROVIDER) {
        throw new Error(`Unsupported credential vault provider: ${input.keyProvider}`);
    }
    const masterKey = readLocalMasterKey(true);
    const dataKey = decryptBuffer(masterKey, parseEnvelope(input.encryptedDataKey));
    const plaintext = decryptBuffer(dataKey, parseEnvelope(input.encryptedPayload)).toString('utf8');
    return JSON.parse(plaintext);
}
function readLocalMasterKey(required) {
    const fromFile = process.env.CREDENTIAL_VAULT_MASTER_KEY_FILE?.trim();
    const raw = fromFile
        ? readSecretFile(fromFile)
        : process.env.CREDENTIAL_VAULT_MASTER_KEY_BASE64?.trim() || '';
    if (!raw) {
        if (required) {
            throw new Error('Credential vault is not configured. Set CREDENTIAL_VAULT_MASTER_KEY_FILE or CREDENTIAL_VAULT_MASTER_KEY_BASE64.');
        }
        return null;
    }
    const key = Buffer.from(raw, 'base64');
    if (key.length !== 32) {
        throw new Error('Credential vault master key must be 32 bytes encoded as base64.');
    }
    return key;
}
function readSecretFile(filePath) {
    return fs.readFileSync(filePath, 'utf8').trim();
}
function encryptBuffer(key, plaintext) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    return {
        alg: 'A256GCM',
        iv: iv.toString('base64'),
        tag: tag.toString('base64'),
        ciphertext: ciphertext.toString('base64'),
    };
}
function decryptBuffer(key, envelope) {
    if (envelope.alg !== 'A256GCM')
        throw new Error(`Unsupported credential cipher: ${String(envelope.alg)}`);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64')), decipher.final()]);
}
function parseEnvelope(value) {
    const parsed = JSON.parse(value);
    if (parsed.alg !== 'A256GCM' ||
        typeof parsed.iv !== 'string' ||
        typeof parsed.tag !== 'string' ||
        typeof parsed.ciphertext !== 'string') {
        throw new Error('Invalid encrypted credential envelope.');
    }
    return parsed;
}
