import { CopyObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { describe, expect, it } from 'vitest';
import { S3EntityImageStorage } from '../../../../src/infrastructure/aws/S3EntityImageStorage.js';

class FakeS3Client {
  public commands: Array<PutObjectCommand | CopyObjectCommand> = [];

  public async send(command: PutObjectCommand | CopyObjectCommand): Promise<unknown> {
    this.commands.push(command);
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
});
