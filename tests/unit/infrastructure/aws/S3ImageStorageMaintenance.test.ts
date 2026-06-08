import { DeleteObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { describe, expect, it } from 'vitest';
import { ConfigurationError } from '../../../../src/domain/errors/index.js';
import { S3ImageStorageMaintenance } from '../../../../src/infrastructure/aws/S3ImageStorageMaintenance.js';

type S3MaintenanceCommand = DeleteObjectCommand | ListObjectsV2Command;

class FakeS3Client {
  public commands: S3MaintenanceCommand[] = [];
  public responses: unknown[] = [];
  public error: Error | null = null;

  public async send(command: S3MaintenanceCommand): Promise<unknown> {
    this.commands.push(command);

    if (this.error !== null) {
      throw this.error;
    }

    return this.responses.shift() ?? {};
  }
}

describe('S3ImageStorageMaintenance', () => {
  it('lists objects across paginated responses', async () => {
    const client = new FakeS3Client();
    client.responses = [
      {
        Contents: [
          { Key: 'tmp/a.png', LastModified: new Date('2026-06-01T00:00:00.000Z') },
          {},
        ],
        IsTruncated: true,
        NextContinuationToken: 'next-page',
      },
      {
        Contents: [
          { Key: 'tmp/b.png' },
        ],
        IsTruncated: false,
      },
    ];
    const storage = new S3ImageStorageMaintenance(client, 'lyra-images');

    await expect(storage.listObjects('tmp/')).resolves.toEqual([
      { key: 'tmp/a.png', lastModified: new Date('2026-06-01T00:00:00.000Z') },
      { key: 'tmp/b.png', lastModified: null },
    ]);

    expect(client.commands).toHaveLength(2);
    expect(client.commands[0]).toBeInstanceOf(ListObjectsV2Command);
    expect(client.commands[0]?.input).toMatchObject({
      Bucket: 'lyra-images',
      Prefix: 'tmp/',
    });
    expect(client.commands[1]?.input).toMatchObject({
      ContinuationToken: 'next-page',
    });
  });

  it('wraps list failures as configuration errors', async () => {
    const client = new FakeS3Client();
    client.error = new Error('list failed');
    const storage = new S3ImageStorageMaintenance(client, 'lyra-images');

    await expect(storage.listObjects('tmp/')).rejects.toEqual(new ConfigurationError('list failed'));
  });

  it('rejects truncated list responses without continuation tokens', async () => {
    const client = new FakeS3Client();
    client.responses = [
      {
        IsTruncated: true,
      },
    ];
    const storage = new S3ImageStorageMaintenance(client, 'lyra-images');

    await expect(storage.listObjects('tmp/')).rejects.toEqual(
      new ConfigurationError('S3 image object listing was truncated without a continuation token'),
    );
  });

  it('deletes one object key', async () => {
    const client = new FakeS3Client();
    const storage = new S3ImageStorageMaintenance(client, 'lyra-images');

    await expect(storage.deleteObject('tmp/a.png')).resolves.toBeUndefined();

    expect(client.commands).toHaveLength(1);
    expect(client.commands[0]).toBeInstanceOf(DeleteObjectCommand);
    expect(client.commands[0]?.input).toMatchObject({
      Bucket: 'lyra-images',
      Key: 'tmp/a.png',
    });
  });

  it('wraps delete failures as configuration errors', async () => {
    const client = new FakeS3Client();
    client.error = new Error('delete failed');
    const storage = new S3ImageStorageMaintenance(client, 'lyra-images');

    await expect(storage.deleteObject('tmp/a.png')).rejects.toEqual(new ConfigurationError('delete failed'));
  });

  it('S3 メンテナンス失敗時の外部エラー文は機密値を伏せる', async () => {
    const client = new FakeS3Client();
    const fakeApiKey = ['sk', 'test-secret'].join('-');
    client.error = new Error(`list failed Authorization: Bearer ${fakeApiKey} ${'x'.repeat(600)}`);
    const storage = new S3ImageStorageMaintenance(client, 'lyra-images');

    await expect(storage.listObjects('tmp/')).rejects.toMatchObject({
      code: 'CONFIGURATION_ERROR',
      message: expect.stringContaining('Bearer [redacted]'),
    });

    await expect(storage.listObjects('tmp/')).rejects.not.toMatchObject({
      message: expect.stringContaining(fakeApiKey),
    });
  });

  it('rejects empty bucket names, prefixes, and keys before calling S3', async () => {
    expect(() => new S3ImageStorageMaintenance(new FakeS3Client(), '   ')).toThrow(
      new ConfigurationError('S3 image bucket name is required'),
    );

    const client = new FakeS3Client();
    const storage = new S3ImageStorageMaintenance(client, 'lyra-images');

    await expect(storage.listObjects('')).rejects.toEqual(
      new ConfigurationError('S3 image object prefix is required'),
    );
    await expect(storage.deleteObject('')).rejects.toEqual(
      new ConfigurationError('S3 image object key is required'),
    );
    expect(client.commands).toHaveLength(0);
  });
});
