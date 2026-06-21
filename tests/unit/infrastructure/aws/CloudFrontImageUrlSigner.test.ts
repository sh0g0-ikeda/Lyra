import { generateKeyPairSync } from 'node:crypto';
import { S3Client } from '@aws-sdk/client-s3';
import { describe, expect, it } from 'vitest';
import { ConfigurationError } from '../../../../src/domain/errors/index.js';
import {
  CloudFrontImageUrlSigner,
  S3PresignedImageUrlSigner,
} from '../../../../src/infrastructure/aws/CloudFrontImageUrlSigner.js';

describe('CloudFrontImageUrlSigner', () => {
  it('CloudFront signed URL parameters are added', () => {
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

  it('CloudFront signer rejects image URLs outside the configured origin', () => {
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

describe('S3PresignedImageUrlSigner', () => {
  it('signs an owned S3 key without exposing the bucket publicly', async () => {
    const signer = new S3PresignedImageUrlSigner({
      client: createTestS3Client(),
      bucketName: 'lyra-images',
      ttlSeconds: 300,
    });

    const signedUrl = await signer.sign({
      s3Key: 'saved/user-1/pages/page-1.png',
      cdnUrl: 's3://lyra-images/saved/user-1/pages/page-1.png',
    });
    if (signedUrl === null) {
      throw new Error('signed URL was not generated');
    }

    const url = new URL(signedUrl);
    expect(url.hostname).toBe('lyra-images.s3.ap-northeast-1.amazonaws.com');
    expect(url.pathname).toBe('/saved/user-1/pages/page-1.png');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('300');
    expect(url.searchParams.get('X-Amz-Signature')).toBeTruthy();
  });

  it('can sign from a stored s3 URI when an explicit key is not provided', async () => {
    const signer = new S3PresignedImageUrlSigner({
      client: createTestS3Client(),
      bucketName: 'lyra-images',
      ttlSeconds: 300,
    });

    const signedUrl = await signer.sign({
      cdnUrl: 's3://lyra-images/session/user-1/entities/entity-1/job-1.png',
    });

    expect(signedUrl).toContain('/session/user-1/entities/entity-1/job-1.png?');
  });

  it('rejects unsafe object keys', async () => {
    const signer = new S3PresignedImageUrlSigner({
      client: createTestS3Client(),
      bucketName: 'lyra-images',
      ttlSeconds: 300,
    });

    await expect(signer.sign({ s3Key: 'saved/user-1/../page.png' })).rejects.toThrow(ConfigurationError);
  });

  it('rejects stored s3 URIs outside the configured bucket', async () => {
    const signer = new S3PresignedImageUrlSigner({
      client: createTestS3Client(),
      bucketName: 'lyra-images',
      ttlSeconds: 300,
    });

    await expect(signer.sign({ cdnUrl: 's3://other-bucket/saved/user-1/page.png' })).rejects.toThrow(
      ConfigurationError,
    );
  });
});

function createTestS3Client(): S3Client {
  return new S3Client({
    region: 'ap-northeast-1',
    credentials: {
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxCYEXAMPLEKEY',
    },
  });
}

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
