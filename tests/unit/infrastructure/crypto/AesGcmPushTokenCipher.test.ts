import { describe, expect, it } from 'vitest';

import { ConfigurationError } from '../../../../src/domain/errors/index.js';
import { AesGcmPushTokenCipher } from '../../../../src/infrastructure/crypto/AesGcmPushTokenCipher.js';

const encryptionKey = Buffer.alloc(32, 7).toString('base64');
const hashKey = Buffer.alloc(32, 11).toString('base64');

describe('AesGcmPushTokenCipher', () => {
  it('tokenをAES-GCMで暗号化して復号でき、HMACは決定的になる', async () => {
    const cipher = new AesGcmPushTokenCipher({
      encryptionKeyBase64: encryptionKey,
      hashKeyBase64: hashKey,
      keyId: 'push-key-2026-07'
    });

    const first = await cipher.encrypt('ExponentPushToken[device-token-123456]');
    const second = await cipher.encrypt('ExponentPushToken[device-token-123456]');

    expect(first.ciphertext).not.toContain('device-token');
    expect(first.ciphertext).not.toBe(second.ciphertext);
    await expect(cipher.decrypt(first)).resolves.toBe('ExponentPushToken[device-token-123456]');
    await expect(cipher.deterministicHash('ExponentPushToken[device-token-123456]')).resolves.toBe(
      await cipher.deterministicHash('ExponentPushToken[device-token-123456]')
    );
    await expect(cipher.deterministicHash('ExponentPushToken[another-device-456]')).resolves.not.toBe(
      await cipher.deterministicHash('ExponentPushToken[device-token-123456]')
    );
  });

  it('ciphertext改ざん・未知key ID・不正鍵をfail closedにする', async () => {
    const cipher = new AesGcmPushTokenCipher({
      encryptionKeyBase64: encryptionKey,
      hashKeyBase64: hashKey,
      keyId: 'push-key-2026-07'
    });
    const encrypted = await cipher.encrypt('ExponentPushToken[device-token-123456]');
    const tampered = `${encrypted.ciphertext.slice(0, -1)}${encrypted.ciphertext.endsWith('A') ? 'B' : 'A'}`;

    await expect(cipher.decrypt({ ...encrypted, ciphertext: tampered })).rejects.toBeInstanceOf(
      ConfigurationError
    );
    await expect(
      cipher.decrypt({ ...encrypted, keyId: 'unknown-key' })
    ).rejects.toBeInstanceOf(ConfigurationError);
    expect(
      () =>
        new AesGcmPushTokenCipher({
          encryptionKeyBase64: Buffer.alloc(16).toString('base64'),
          hashKeyBase64: hashKey,
          keyId: 'push-key-2026-07'
        })
    ).toThrow(ConfigurationError);
  });
});
