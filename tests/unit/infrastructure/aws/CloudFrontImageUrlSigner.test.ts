import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ConfigurationError } from '../../../../src/domain/errors/index.js';
import { CloudFrontImageUrlSigner } from '../../../../src/infrastructure/aws/CloudFrontImageUrlSigner.js';

describe('CloudFrontImageUrlSigner', () => {
  it('CloudFront署名パラメータ付きURLを生成する', () => {
    const signer = new CloudFrontImageUrlSigner({
      cdnBaseUrl: 'https://img.lyra.test',
      keyPairId: 'K1234567890',
      privateKey: buildPrivateKey(),
      ttlSeconds: 300,
      now: () => new Date('2026-06-11T00:00:00.000Z'),
    });

    const signedUrl = signer.sign('https://img.lyra.test/saved/user-1/pages/page-1.png');
    if (signedUrl === null) {
      throw new Error('signed URL was not generated');
    }

    const url = new URL(signedUrl);
    expect(url.origin).toBe('https://img.lyra.test');
    expect(url.searchParams.get('Key-Pair-Id')).toBe('K1234567890');
    expect(url.searchParams.get('Expires')).toBe(String(1_781_136_300));
    expect(url.searchParams.get('Signature')).toBeTruthy();
  });

  it('設定外originの画像URLは署名しない', () => {
    const signer = new CloudFrontImageUrlSigner({
      cdnBaseUrl: 'https://img.lyra.test',
      keyPairId: 'K1234567890',
      privateKey: buildPrivateKey(),
      ttlSeconds: 300,
      now: () => new Date('2026-06-11T00:00:00.000Z'),
    });

    expect(() => signer.sign('https://evil.example/saved/user-1/pages/page-1.png')).toThrow(ConfigurationError);
  });
});

function buildPrivateKey(): string {
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: {
      format: 'pem',
      type: 'pkcs8',
    },
    publicKeyEncoding: {
      format: 'pem',
      type: 'spki',
    },
  });

  return privateKey;
}
