import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { describe, expect, it } from 'vitest';
import { ConfigurationError } from '../../../../src/domain/errors/index.js';
import { S3EntityReferenceUploadStorage } from '../../../../src/infrastructure/aws/S3EntityReferenceUploadStorage.js';

const pngBytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const uploadKey = 'tmp/user-1/entities/imports/11111111-1111-4111-8111-111111111111.png';

class FakeS3Client {
  public calls: Array<HeadObjectCommand | GetObjectCommand> = [];
  public headResponse: { ContentLength?: number; ContentType?: string } = {
    ContentLength: pngBytes.length,
    ContentType: 'image/png',
  };
  public getResponse: { Body?: { transformToByteArray(): Promise<Uint8Array> }; ContentType?: string } = {
    Body: {
      async transformToByteArray(): Promise<Uint8Array> {
        return pngBytes;
      },
    },
    ContentType: 'image/png',
  };
  public errors: Error[] = [];

  public async send(command: HeadObjectCommand | GetObjectCommand): Promise<unknown> {
    this.calls.push(command);
    const error = this.errors.shift();
    if (error !== undefined) {
      throw error;
    }

    if (command instanceof HeadObjectCommand) {
      return this.headResponse;
    }

    return this.getResponse;
  }
}

describe('S3EntityReferenceUploadStorage', () => {
  it('実際のSigV4 URLでContent-Lengthを署名対象にして申告サイズを強制する', async () => {
    const client = new (await import('@aws-sdk/client-s3')).S3Client({
      region: 'ap-northeast-1',
      credentials: {
        accessKeyId: 'AKIDEXAMPLE',
        secretAccessKey: 'test-secret-access-key',
      },
    });
    const storage = new S3EntityReferenceUploadStorage(client, {
      bucketName: 'lyra-images',
      uploadUrlTtlSeconds: 300,
    });

    const signedUrl = await storage.createPresignedPutUrl({
      s3Key: uploadKey,
      mimeType: 'image/png',
      sizeBytes: pngBytes.length,
      expiresInSeconds: 300,
    });

    expect(new URL(signedUrl).searchParams.get('X-Amz-SignedHeaders')).toContain(
      'content-length',
    );
  });

  it('server-owned key、Content-Type、短命期限を指定して PUT URL を発行する', async () => {
    const client = new FakeS3Client();
    let command: PutObjectCommand | null = null;
    const storage = new S3EntityReferenceUploadStorage(
      client as unknown as S3Client,
      { bucketName: 'lyra-images', uploadUrlTtlSeconds: 300 },
      async (_client, signedCommand, expiresInSeconds) => {
        command = signedCommand;
        expect(expiresInSeconds).toBe(300);
        return 'https://s3.example.test/upload';
      },
    );

    const url = await storage.createPresignedPutUrl({
      s3Key: uploadKey,
      mimeType: 'image/png',
      sizeBytes: pngBytes.length,
      expiresInSeconds: 300,
    });

    expect(url).toBe('https://s3.example.test/upload');
    const capturedCommand = command as PutObjectCommand | null;
    expect(capturedCommand?.input).toMatchObject({
      Bucket: 'lyra-images',
      Key: uploadKey,
      ContentType: 'image/png',
      ContentLength: pngBytes.length,
      ServerSideEncryption: 'AES256',
    });
  });

  it('HeadObject と GetObject の key、MIME、size が一致する場合だけ画像を返す', async () => {
    const client = new FakeS3Client();
    const storage = buildStorage(client);

    const result = await storage.loadUploadedImage({
      s3Key: uploadKey,
      mimeType: 'image/png',
      sizeBytes: pngBytes.length,
    });

    expect(result).toMatchObject({
      imageData: Buffer.from(pngBytes),
      mimeType: 'image/png',
      cdnUrl: `s3://lyra-images/${uploadKey}`,
    });
    expect(client.calls).toHaveLength(2);
    expect(client.calls[0]?.input).toMatchObject({
      Bucket: 'lyra-images',
      Key: uploadKey,
    });
    expect(client.calls[1]?.input).toMatchObject({
      Bucket: 'lyra-images',
      Key: uploadKey,
    });
  });

  it('missing object と MIME/size mismatch は null にして分析へ渡さない', async () => {
    const missingClient = new FakeS3Client();
    const missing = new Error(`NoSuchKey ${uploadKey}`);
    Object.assign(missing, { $metadata: { httpStatusCode: 404 } });
    missingClient.errors.push(missing);

    await expect(
      buildStorage(missingClient).loadUploadedImage({
        s3Key: uploadKey,
        mimeType: 'image/png',
        sizeBytes: pngBytes.length,
      }),
    ).resolves.toBeNull();

    const mismatchClient = new FakeS3Client();
    mismatchClient.headResponse = { ContentLength: pngBytes.length + 1, ContentType: 'image/jpeg' };
    await expect(
      buildStorage(mismatchClient).loadUploadedImage({
        s3Key: uploadKey,
        mimeType: 'image/png',
        sizeBytes: pngBytes.length,
      }),
    ).resolves.toBeNull();
  });

  it('S3 read の 4xx は再試行せず key/provider detail を含まないエラーにする', async () => {
    const client = new FakeS3Client();
    const accessDenied = new Error(`AccessDenied for ${uploadKey}`);
    Object.assign(accessDenied, { $metadata: { httpStatusCode: 403 } });
    client.errors.push(accessDenied);
    const storage = buildStorage(client, { maxSafeReadAttempts: 2 });

    await expect(
      storage.loadUploadedImage({
        s3Key: uploadKey,
        mimeType: 'image/png',
        sizeBytes: pngBytes.length,
      }),
    ).rejects.toEqual(new ConfigurationError('Unable to verify uploaded image'));
    expect(client.calls).toHaveLength(1);
  });

  it('S3 read の 5xx は安全な read 操作だけを再試行する', async () => {
    const client = new FakeS3Client();
    const unavailable = new Error('ServiceUnavailable');
    Object.assign(unavailable, { $metadata: { httpStatusCode: 503 } });
    client.errors.push(unavailable);
    const storage = buildStorage(client, { maxSafeReadAttempts: 2 });

    await expect(
      storage.loadUploadedImage({
        s3Key: uploadKey,
        mimeType: 'image/png',
        sizeBytes: pngBytes.length,
      }),
    ).resolves.toMatchObject({
      imageData: Buffer.from(pngBytes),
      mimeType: 'image/png',
    });
    expect(client.calls).toHaveLength(3);
  });
});

function buildStorage(
  client: FakeS3Client,
  options: { maxSafeReadAttempts?: number } = {},
): S3EntityReferenceUploadStorage {
  return new S3EntityReferenceUploadStorage(
    client as unknown as S3Client,
    {
      bucketName: 'lyra-images',
      uploadUrlTtlSeconds: 300,
      safeReadTimeoutMs: 1_000,
      maxSafeReadAttempts: options.maxSafeReadAttempts,
      retryDelayMs: 0,
    },
    async () => 'https://s3.example.test/upload',
  );
}
