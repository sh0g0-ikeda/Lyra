import { PutObjectCommand } from '@aws-sdk/client-s3';
import { describe, expect, it } from 'vitest';
import { ConfigurationError } from '../../../../src/domain/errors/index.js';
import { S3PageImageStorage } from '../../../../src/infrastructure/aws/S3PageImageStorage.js';

class FakeS3Client {
  public calls: PutObjectCommand[] = [];
  public shouldThrow = false;
  public errorMessage = 's3 unavailable';

  public async send(command: PutObjectCommand): Promise<void> {
    this.calls.push(command);

    if (this.shouldThrow) {
      throw new Error(this.errorMessage);
    }
  }
}

describe('S3PageImageStorage', () => {
  it('session 配下に生成画像を保存して cdn_url を返す', async () => {
    const client = new FakeS3Client();
    const storage = new S3PageImageStorage(client, {
      bucketName: 'lyra-images',
      cdnBaseUrl: 'https://img.lyra.app',
    });

    const result = await storage.store({
      jobId: 'job-1',
      userId: 'user-1',
      pageId: 'page-1',
      imageData: Buffer.from('png-bytes'),
      mimeType: 'image/png',
    });

    expect(result).toEqual({
      s3Key: 'session/user-1/pages/page-1/job-1.png',
      cdnUrl: 'https://img.lyra.app/session/user-1/pages/page-1/job-1.png',
    });
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]).toBeInstanceOf(PutObjectCommand);
    expect(client.calls[0]?.input).toMatchObject({
      Bucket: 'lyra-images',
      Key: 'session/user-1/pages/page-1/job-1.png',
      Body: Buffer.from('png-bytes'),
      ContentType: 'image/png',
      CacheControl: 'private, max-age=604800, immutable',
      ServerSideEncryption: 'AES256',
    });
  });

  it('未対応の mimeType は ConfigurationError として扱う', async () => {
    const storage = new S3PageImageStorage(new FakeS3Client(), {
      bucketName: 'lyra-images',
      cdnBaseUrl: 'https://img.lyra.app',
    });

    await expect(
      storage.store({
        jobId: 'job-1',
        userId: 'user-1',
        pageId: 'page-1',
        imageData: Buffer.from('data'),
        mimeType: 'application/json',
      }),
    ).rejects.toEqual(new ConfigurationError('Unsupported page image mime type: application/json'));
  });

  it('S3 保存失敗時は ConfigurationError に変換する', async () => {
    const client = new FakeS3Client();
    client.shouldThrow = true;
    const storage = new S3PageImageStorage(client, {
      bucketName: 'lyra-images',
      cdnBaseUrl: 'https://img.lyra.app',
    });

    await expect(
      storage.store({
        jobId: 'job-1',
        userId: 'user-1',
        pageId: 'page-1',
        imageData: Buffer.from('png-bytes'),
        mimeType: 'image/png',
      }),
    ).rejects.toEqual(new ConfigurationError('s3 unavailable'));
  });

  it('S3 保存失敗時の外部エラー文は機密値を伏せる', async () => {
    const client = new FakeS3Client();
    client.shouldThrow = true;
    const fakeApiKey = ['sk', 'test-secret'].join('-');
    client.errorMessage = `s3 failed Authorization: Bearer ${fakeApiKey} ${'x'.repeat(600)}`;
    const storage = new S3PageImageStorage(client, {
      bucketName: 'lyra-images',
      cdnBaseUrl: 'https://img.lyra.app',
    });

    await expect(
      storage.store({
        jobId: 'job-1',
        userId: 'user-1',
        pageId: 'page-1',
        imageData: Buffer.from('png-bytes'),
        mimeType: 'image/png',
      }),
    ).rejects.toMatchObject({
      code: 'CONFIGURATION_ERROR',
      message: expect.stringContaining('Bearer [redacted]'),
    });

    await expect(
      storage.store({
        jobId: 'job-2',
        userId: 'user-1',
        pageId: 'page-1',
        imageData: Buffer.from('png-bytes'),
        mimeType: 'image/png',
      }),
    ).rejects.not.toMatchObject({
      message: expect.stringContaining(fakeApiKey),
    });
  });
});
