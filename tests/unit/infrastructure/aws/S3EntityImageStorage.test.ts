import { CopyObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { describe, expect, it } from 'vitest';
import { ConfigurationError } from '../../../../src/domain/errors/index.js';
import { S3EntityImageStorage } from '../../../../src/infrastructure/aws/S3EntityImageStorage.js';

class FakeS3Client {
  public commands: Array<PutObjectCommand | CopyObjectCommand> = [];
  public error: Error | null = null;

  public async send(command: PutObjectCommand | CopyObjectCommand): Promise<unknown> {
    this.commands.push(command);
    if (this.error !== null) {
      throw this.error;
    }

    return {};
  }
}

describe('S3EntityImageStorage', () => {
  it('import image を tmp 配下へ保存する', async () => {
    const client = new FakeS3Client();
    const storage = new S3EntityImageStorage(client, {
      bucketName: 'bucket',
      cdnBaseUrl: 'https://cdn.lyra.test',
    });

    const result = await storage.storeImportedImage({
      userId: 'user-1',
      imageData: Buffer.from('abc'),
      mimeType: 'image/png',
    });

    const command = client.commands[0] as PutObjectCommand;
    expect(command.input.Key).toContain('tmp/user-1/entities/imports/');
    expect(command.input.CacheControl).toBe('private, max-age=604800, immutable');
    expect(result.s3Key).toContain('tmp/user-1/entities/imports/');
  });

  it('confirm 時は saved 配下へコピーする', async () => {
    const client = new FakeS3Client();
    const storage = new S3EntityImageStorage(client, {
      bucketName: 'bucket',
      cdnBaseUrl: 'https://cdn.lyra.test',
    });

    const result = await storage.finalizeReferenceImage({
      userId: 'user-1',
      entityId: 'entity-1',
      refId: 'ref-1',
      sourceS3Key: 'tmp/user-1/entities/imports/source.png',
    });

    const command = client.commands[0] as CopyObjectCommand;
    expect(command.input.Key).toBe('saved/user-1/entities/entity-1/ref-1.png');
    expect(command.input.CacheControl).toBe('private, max-age=31536000, immutable');
    expect(result.cdnUrl).toBe('https://cdn.lyra.test/saved/user-1/entities/entity-1/ref-1.png');
  });

  it('rejects unsupported source image extensions before copying', async () => {
    const client = new FakeS3Client();
    const storage = new S3EntityImageStorage(client, {
      bucketName: 'bucket',
      cdnBaseUrl: 'https://cdn.lyra.test',
    });

    await expect(
      storage.finalizeReferenceImage({
        userId: 'user-1',
        entityId: 'entity-1',
        refId: 'ref-1',
        sourceS3Key: 'tmp/user-1/entities/imports/source.txt',
      }),
    ).rejects.toMatchObject({ code: 'CONFIGURATION_ERROR' });

    expect(client.commands).toHaveLength(0);
  });

  it('rejects source keys outside the entity owner scope before copying', async () => {
    const client = new FakeS3Client();
    const storage = new S3EntityImageStorage(client, {
      bucketName: 'bucket',
      cdnBaseUrl: 'https://cdn.lyra.test',
    });

    await expect(
      storage.finalizeReferenceImage({
        userId: 'user-1',
        entityId: 'entity-1',
        refId: 'ref-1',
        sourceS3Key: 'tmp/user-2/entities/imports/source.png',
      }),
    ).rejects.toMatchObject({ code: 'CONFIGURATION_ERROR' });

    expect(client.commands).toHaveLength(0);
  });

  it('S3 保存失敗時の外部エラー文は機密値を伏せる', async () => {
    const client = new FakeS3Client();
    const fakeApiKey = ['sk', 'test-secret'].join('-');
    client.error = new Error(`s3 failed Authorization: Bearer ${fakeApiKey} ${'x'.repeat(600)}`);
    const storage = new S3EntityImageStorage(client, {
      bucketName: 'bucket',
      cdnBaseUrl: 'https://cdn.lyra.test',
    });

    await expect(
      storage.storeGeneratedCandidate({
        userId: 'user-1',
        entityId: 'entity-1',
        jobId: 'job-1',
        candidateIndex: 0,
        imageData: Buffer.from('abc'),
        mimeType: 'image/png',
      }),
    ).rejects.toMatchObject({
      code: 'CONFIGURATION_ERROR',
      message: expect.stringContaining('Bearer [redacted]'),
    });

    await expect(
      storage.storeGeneratedCandidate({
        userId: 'user-1',
        entityId: 'entity-1',
        jobId: 'job-2',
        candidateIndex: 0,
        imageData: Buffer.from('abc'),
        mimeType: 'image/png',
      }),
    ).rejects.not.toEqual(
      new ConfigurationError(`s3 failed Authorization: Bearer ${fakeApiKey} ${'x'.repeat(600)}`),
    );
  });
});
