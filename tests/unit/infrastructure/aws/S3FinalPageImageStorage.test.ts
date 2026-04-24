import { CopyObjectCommand } from '@aws-sdk/client-s3';
import { describe, expect, it } from 'vitest';
import { ConfigurationError } from '../../../../src/domain/errors/index.js';
import { S3FinalPageImageStorage } from '../../../../src/infrastructure/aws/S3FinalPageImageStorage.js';

class FakeS3Client {
  public calls: CopyObjectCommand[] = [];
  public shouldThrow = false;

  public async send(command: CopyObjectCommand): Promise<void> {
    this.calls.push(command);
    if (this.shouldThrow) {
      throw new Error('copy failed');
    }
  }
}

describe('S3FinalPageImageStorage', () => {
  it('session画像をsaved配下へcopyする', async () => {
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

    expect(client.calls[0]?.input).toMatchObject({
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

  it('copy失敗時はConfigurationErrorを投げる', async () => {
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
});
