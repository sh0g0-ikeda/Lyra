import { GetObjectCommand } from '@aws-sdk/client-s3';
import { describe, expect, it } from 'vitest';
import { ConfigurationError } from '../../../../src/domain/errors/index.js';
import { S3StoredImageLoader } from '../../../../src/infrastructure/aws/S3StoredImageLoader.js';

class FakeS3Client {
  public calls: GetObjectCommand[] = [];
  public shouldThrow = false;
  public errorMessage = 's3 unavailable';
  public contentType: string | undefined = 'image/png';
  public body = {
    async transformToByteArray(): Promise<Uint8Array> {
      return Uint8Array.from(Buffer.from('image-bytes'));
    },
  };

  public async send(command: GetObjectCommand) {
    this.calls.push(command);

    if (this.shouldThrow) {
      throw new Error(this.errorMessage);
    }

    return {
      Body: this.body,
      ContentType: this.contentType,
    };
  }
}

describe('S3StoredImageLoader', () => {
  it('s3_keyから画像バイト列を読み込む', async () => {
    const client = new FakeS3Client();
    const loader = new S3StoredImageLoader(client, 'lyra-images');

    const result = await loader.loadByS3Key('saved/user-1/entities/entity-1/ref_1.png');

    expect(result).toEqual({
      imageData: Buffer.from('image-bytes'),
      mimeType: 'image/png',
    });
    expect(client.calls[0]).toBeInstanceOf(GetObjectCommand);
    expect(client.calls[0]?.input).toMatchObject({
      Bucket: 'lyra-images',
      Key: 'saved/user-1/entities/entity-1/ref_1.png',
    });
  });

  it('contentType欠落時はConfigurationErrorを投げる', async () => {
    const client = new FakeS3Client();
    client.contentType = undefined;
    const loader = new S3StoredImageLoader(client, 'lyra-images');

    await expect(
      loader.loadByS3Key('saved/user-1/entities/entity-1/ref_1.png'),
    ).rejects.toEqual(new ConfigurationError('Stored image content type is missing'));
  });

  it('未対応のcontentTypeはConfigurationErrorを投げる', async () => {
    const client = new FakeS3Client();
    client.contentType = 'image/gif';
    const loader = new S3StoredImageLoader(client, 'lyra-images');

    await expect(
      loader.loadByS3Key('saved/user-1/entities/entity-1/ref_1.png'),
    ).rejects.toEqual(new ConfigurationError('Unsupported stored image content type: image/gif'));
  });

  it('危険なs3_keyはS3へ送らずに拒否する', async () => {
    const client = new FakeS3Client();
    const loader = new S3StoredImageLoader(client, 'lyra-images');

    await expect(
      loader.loadByS3Key('saved/user-1/entities/../ref_1.png'),
    ).rejects.toEqual(new ConfigurationError('Stored image key is invalid'));
    await expect(
      loader.loadByS3Key('saved\\user-1\\entities\\ref_1.png'),
    ).rejects.toEqual(new ConfigurationError('Stored image key is invalid'));
    await expect(
      loader.loadByS3Key('saved/user-1/entities/ref_1.txt'),
    ).rejects.toEqual(new ConfigurationError('Unsupported stored image key extension: saved/user-1/entities/ref_1.txt'));

    expect(client.calls).toEqual([]);
  });

  it('S3 読込失敗時の外部エラー文は機密値を伏せる', async () => {
    const client = new FakeS3Client();
    client.shouldThrow = true;
    const fakeApiKey = ['sk', 'test-secret'].join('-');
    client.errorMessage = `s3 failed Authorization: Bearer ${fakeApiKey} ${'x'.repeat(600)}`;
    const loader = new S3StoredImageLoader(client, 'lyra-images');

    await expect(
      loader.loadByS3Key('saved/user-1/entities/entity-1/ref_1.png'),
    ).rejects.toMatchObject({
      code: 'CONFIGURATION_ERROR',
      message: expect.stringContaining('Bearer [redacted]'),
    });

    await expect(
      loader.loadByS3Key('saved/user-1/entities/entity-1/ref_2.png'),
    ).rejects.not.toMatchObject({
      message: expect.stringContaining(fakeApiKey),
    });
  });
});
