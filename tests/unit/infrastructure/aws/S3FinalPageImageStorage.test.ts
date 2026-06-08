import { CopyObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { describe, expect, it } from 'vitest';
import { ConfigurationError } from '../../../../src/domain/errors/index.js';
import { S3FinalPageImageStorage } from '../../../../src/infrastructure/aws/S3FinalPageImageStorage.js';

class FakeS3Client {
  public calls: Array<CopyObjectCommand | PutObjectCommand> = [];
  public shouldThrow = false;

  public async send(command: CopyObjectCommand | PutObjectCommand): Promise<void> {
    this.calls.push(command);
    if (this.shouldThrow) {
      throw new Error('copy failed');
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
});
