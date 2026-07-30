import { describe, expect, it } from 'vitest';
import { ConfigurationError } from '../../../../src/domain/errors/index.js';
import { AesGcmPushTokenCipher } from '../../../../src/infrastructure/crypto/AesGcmPushTokenCipher.js';

const encryptionKeyBase64 = Buffer.alloc(32, 1).toString('base64');
const hashKeyBase64 = Buffer.alloc(32, 2).toString('base64');
const token = 'native-device-token-value';

describe('AesGcmPushTokenCipher', () => {
  it('tokenをversioned AES-GCM envelopeへ暗号化して復号できる', async () => {
    const cipher = buildCipher();

    const encrypted = await cipher.encrypt(token);

    expect(encrypted.ciphertext).not.toContain(token);
    expect(encrypted.ciphertext).toMatch(
      /^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{22}$/u,
    );
    expect(encrypted.keyId).toBe('push-key:v1');
    await expect(cipher.decrypt(encrypted)).resolves.toBe(token);
  });

  it('同じtokenでもrandom IVにより異なるciphertextを返す', async () => {
    const cipher = buildCipher();

    const first = await cipher.encrypt(token);
    const second = await cipher.encrypt(token);

    expect(first.ciphertext).not.toBe(second.ciphertext);
  });

  it('lookup hashは同じtokenへ同じlowercase hex HMACを返す', async () => {
    const cipher = buildCipher();

    const first = await cipher.deterministicHash(token);
    const second = await cipher.deterministicHash(token);

    expect(first).toMatch(/^[0-9a-f]{64}$/u);
    expect(second).toBe(first);
    await expect(cipher.deterministicHash(`${token}-other`)).resolves.not.toBe(first);
  });

  it('ciphertext改ざんを安定したConfigurationErrorとして拒否する', async () => {
    const cipher = buildCipher();
    const encrypted = await cipher.encrypt(token);
    const replacement = encrypted.ciphertext.endsWith('A') ? 'B' : 'A';
    const tampered = `${encrypted.ciphertext.slice(0, -1)}${replacement}`;

    await expect(cipher.decrypt({
      ciphertext: tampered,
      keyId: encrypted.keyId,
    })).rejects.toEqual(new ConfigurationError('Push token decryption failed'));
  });

  it('異なるkey IDでの復号を拒否する', async () => {
    const cipher = buildCipher();
    const encrypted = await cipher.encrypt(token);

    await expect(cipher.decrypt({
      ciphertext: encrypted.ciphertext,
      keyId: 'push-key:v2',
    })).rejects.toEqual(new ConfigurationError('Push token decryption key is unavailable'));
  });

  it('暗号化keyとhash keyが同じ設定を拒否する', () => {
    expect(() => new AesGcmPushTokenCipher({
      encryptionKeyBase64,
      hashKeyBase64: encryptionKeyBase64,
      keyId: 'push-key:v1',
    })).toThrow('Push token encryption and hash keys must differ');
  });

  it('canonicalでないkeyまたは不正なkey IDを拒否する', () => {
    expect(() => new AesGcmPushTokenCipher({
      encryptionKeyBase64: 'not-base64',
      hashKeyBase64,
      keyId: 'push-key:v1',
    })).toThrow('Push token encryption key must be canonical base64');
    expect(() => new AesGcmPushTokenCipher({
      encryptionKeyBase64,
      hashKeyBase64,
      keyId: 'bad key',
    })).toThrow('Push token encryption key ID is invalid');
  });
});

function buildCipher(): AesGcmPushTokenCipher {
  return new AesGcmPushTokenCipher({
    encryptionKeyBase64,
    hashKeyBase64,
    keyId: 'push-key:v1',
  });
}
