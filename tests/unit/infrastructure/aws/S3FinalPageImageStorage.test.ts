import { CopyObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { describe, expect, it } from 'vitest';
import { ConfigurationError } from '../../../../src/domain/errors/index.js';
import { S3FinalPageImageStorage } from '../../../../src/infrastructure/aws/S3FinalPageImageStorage.js';

class FakeS3Client {
  public calls: Array<CopyObjectCommand | PutObjectCommand> = [];
  public shouldThrow = false;
  public errorMessage = 'copy failed';

  public async send(command: CopyObjectCommand | PutObjectCommand): Promise<void> {
    this.calls.push(command);
    if (this.shouldThrow) {
      throw new Error(this.errorMessage);
    }
  }
}

describe('S3FinalPageImageStorage', () => {
  it('session 画像を saved へ copy する', async () => {
    const client = new FakeS3Client();
    const storage = new S3FinalPageImageStorage(client, {
      bucketName: 'lyra-images',
      cdnBaseUrl: 'https://img.lyra.app',
    });

    const result = await storage.finalizePageImage({
      userId: 'user-1',
      pageId: 'page-1',
      sourceS3Key: 'session/user-1/pages/page-1/job-1.png',
      generatedImage: {
        s3Key: 'session/user-1/pages/page-1/job-1.png',
        cdnUrl: 'https://img.lyra.app/session/user-1/pages/page-1/job-1.png',
        generationMode: 'standard',
        generatedAt: '2026-04-24T00:00:00.000Z',
      },
    });

    expect((client.calls[0] as CopyObjectCommand)?.input).toMatchObject({
      Bucket: 'lyra-images',
      Key: 'saved/user-1/pages/page-1_final.png',
      CopySource: 'lyra-images/session/user-1/pages/page-1/job-1.png',
      CacheControl: 'private, max-age=0, must-revalidate',
    });
    expect(result).toEqual({
      s3Key: 'saved/user-1/pages/page-1_final.png',
      cdnUrl: 'https://img.lyra.app/saved/user-1/pages/page-1_final.png',
      generationMode: 'standard',
      generatedAt: '2026-04-24T00:00:00.000Z',
    });
  });

  it('composited image を saved へ upload する', async () => {
    const client = new FakeS3Client();
    const storage = new S3FinalPageImageStorage(client, {
      bucketName: 'lyra-images',
      cdnBaseUrl: 'https://img.lyra.app',
    });

    const result = await storage.storeFinalPageImage({
      userId: 'user-1',
      pageId: 'page-1',
      imageData: Buffer.from('png'),
      mimeType: 'image/png',
      generatedImage: {
        s3Key: 'session/user-1/pages/page-1/job-1.png',
        cdnUrl: 'https://img.lyra.app/session/user-1/pages/page-1/job-1.png',
        generationMode: 'standard',
        generatedAt: '2026-04-24T00:00:00.000Z',
      },
    });

    expect((client.calls[0] as PutObjectCommand)?.input).toMatchObject({
      Bucket: 'lyra-images',
      Key: 'saved/user-1/pages/page-1_final.png',
      ContentType: 'image/png',
      CacheControl: 'private, max-age=0, must-revalidate',
    });
    expect(result.s3Key).toBe('saved/user-1/pages/page-1_final.png');
  });

  it('copy 失敗時は ConfigurationError を投げる', async () => {
    const client = new FakeS3Client();
    client.shouldThrow = true;
    const storage = new S3FinalPageImageStorage(client, {
      bucketName: 'lyra-images',
      cdnBaseUrl: 'https://img.lyra.app',
    });

    await expect(
      storage.finalizePageImage({
        userId: 'user-1',
        pageId: 'page-1',
        sourceS3Key: 'session/user-1/pages/page-1/job-1.png',
        generatedImage: {
          s3Key: 'session/user-1/pages/page-1/job-1.png',
          cdnUrl: 'https://img.lyra.app/session/user-1/pages/page-1/job-1.png',
          generationMode: 'standard',
          generatedAt: '2026-04-24T00:00:00.000Z',
        },
      }),
    ).rejects.toEqual(new ConfigurationError('copy failed'));
  });

  it('rejects unsupported source image extensions before copying', async () => {
    const client = new FakeS3Client();
    const storage = new S3FinalPageImageStorage(client, {
      bucketName: 'lyra-images',
      cdnBaseUrl: 'https://img.lyra.app',
    });

    await expect(
      storage.finalizePageImage({
        userId: 'user-1',
        pageId: 'page-1',
        sourceS3Key: 'session/user-1/pages/page-1/job-1.txt',
        generatedImage: {
          s3Key: 'session/user-1/pages/page-1/job-1.txt',
          cdnUrl: 'https://img.lyra.app/session/user-1/pages/page-1/job-1.txt',
          generationMode: 'standard',
          generatedAt: '2026-04-24T00:00:00.000Z',
        },
      }),
    ).rejects.toMatchObject({ code: 'CONFIGURATION_ERROR' });

    expect(client.calls).toHaveLength(0);
  });

  it('does not copy when the source is already the final page key', async () => {
    const client = new FakeS3Client();
    const storage = new S3FinalPageImageStorage(client, {
      bucketName: 'lyra-images',
      cdnBaseUrl: 'https://img.lyra.app',
    });

    const result = await storage.finalizePageImage({
      userId: 'user-1',
      pageId: 'page-1',
      sourceS3Key: 'saved/user-1/pages/page-1_final.png',
      generatedImage: {
        s3Key: 'saved/user-1/pages/page-1_final.png',
        cdnUrl: 'https://img.lyra.app/saved/user-1/pages/page-1_final.png',
        generationMode: 'standard',
        generatedAt: '2026-04-24T00:00:00.000Z',
      },
    });

    expect(result.s3Key).toBe('saved/user-1/pages/page-1_final.png');
    expect(client.calls).toHaveLength(0);
  });

  it('rejects source keys outside the page owner scope before copying', async () => {
    const client = new FakeS3Client();
    const storage = new S3FinalPageImageStorage(client, {
      bucketName: 'lyra-images',
      cdnBaseUrl: 'https://img.lyra.app',
    });

    await expect(
      storage.finalizePageImage({
        userId: 'user-1',
        pageId: 'page-1',
        sourceS3Key: 'session/user-2/pages/page-1/job-1.png',
        generatedImage: {
          s3Key: 'session/user-2/pages/page-1/job-1.png',
          cdnUrl: 'https://img.lyra.app/session/user-2/pages/page-1/job-1.png',
          generationMode: 'standard',
          generatedAt: '2026-04-24T00:00:00.000Z',
        },
      }),
    ).rejects.toMatchObject({ code: 'CONFIGURATION_ERROR' });

    expect(client.calls).toHaveLength(0);
  });

  it('S3 finalize 失敗時の外部エラー文は機密値を伏せる', async () => {
    const client = new FakeS3Client();
    client.shouldThrow = true;
    const fakeApiKey = ['sk', 'test-secret'].join('-');
    client.errorMessage = `copy failed Authorization: Bearer ${fakeApiKey} ${'x'.repeat(600)}`;
    const storage = new S3FinalPageImageStorage(client, {
      bucketName: 'lyra-images',
      cdnBaseUrl: 'https://img.lyra.app',
    });

    await expect(
      storage.finalizePageImage({
        userId: 'user-1',
        pageId: 'page-1',
        sourceS3Key: 'session/user-1/pages/page-1/job-1.png',
        generatedImage: {
          s3Key: 'session/user-1/pages/page-1/job-1.png',
          cdnUrl: 'https://img.lyra.app/session/user-1/pages/page-1/job-1.png',
          generationMode: 'standard',
          generatedAt: '2026-04-24T00:00:00.000Z',
        },
      }),
    ).rejects.toMatchObject({
      code: 'CONFIGURATION_ERROR',
      message: expect.stringContaining('Bearer [redacted]'),
    });

    await expect(
      storage.finalizePageImage({
        userId: 'user-1',
        pageId: 'page-1',
        sourceS3Key: 'session/user-1/pages/page-1/job-2.png',
        generatedImage: {
          s3Key: 'session/user-1/pages/page-1/job-2.png',
          cdnUrl: 'https://img.lyra.app/session/user-1/pages/page-1/job-2.png',
          generationMode: 'standard',
          generatedAt: '2026-04-24T00:00:00.000Z',
        },
      }),
    ).rejects.not.toMatchObject({
      message: expect.stringContaining(fakeApiKey),
    });
  });
});
