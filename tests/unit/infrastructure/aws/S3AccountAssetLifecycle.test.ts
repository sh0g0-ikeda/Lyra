import { GetObjectTaggingCommand, PutObjectTaggingCommand } from '@aws-sdk/client-s3';
import { describe, expect, it } from 'vitest';
import { ConfigurationError } from '../../../../src/domain/errors/index.js';
import {
  S3AccountAssetLifecycle,
} from '../../../../src/infrastructure/aws/S3AccountAssetLifecycle.js';

class FakeS3Client {
  public commands: (GetObjectTaggingCommand | PutObjectTaggingCommand)[] = [];
  public error: Error | null = null;
  public tags: { Key?: string; Value?: string }[] = [{ Key: 'asset-kind', Value: 'page' }];

  public async send(command: GetObjectTaggingCommand | PutObjectTaggingCommand): Promise<unknown> {
    this.commands.push(command);
    if (this.error !== null) {
      throw this.error;
    }
    if (command instanceof GetObjectTaggingCommand) {
      return { TagSet: this.tags };
    }
    this.tags = command.input.Tagging?.TagSet ?? [];
    return {};
  }
}

describe('S3AccountAssetLifecycle', () => {
  it('personal asset の既存 tag を保ったまま lifecycle 削除予定 tag を付ける', async () => {
    const client = new FakeS3Client();
    const adapter = new S3AccountAssetLifecycle(client, { bucketName: 'lyra-images' });

    await adapter.scheduleDeletion('saved/user-1/pages/page-1_final.png');

    expect(client.commands).toHaveLength(2);
    expect(client.commands[0]).toBeInstanceOf(GetObjectTaggingCommand);
    expect(client.commands[0]?.input).toEqual({
      Bucket: 'lyra-images',
      Key: 'saved/user-1/pages/page-1_final.png',
    });
    expect(client.commands[1]).toBeInstanceOf(PutObjectTaggingCommand);
    expect(client.commands[1]?.input).toEqual({
      Bucket: 'lyra-images',
      Key: 'saved/user-1/pages/page-1_final.png',
      Tagging: {
        TagSet: [
          { Key: 'asset-kind', Value: 'page' },
          { Key: 'lyra-deletion-state', Value: 'pending' },
        ],
      },
    });
  });

  it('同じ key の再送では既存の削除予定 tag を更新しない', async () => {
    const client = new FakeS3Client();
    const adapter = new S3AccountAssetLifecycle(client, { bucketName: 'lyra-images' });

    await adapter.scheduleDeletion('saved/user-1/pages/page-1_final.png');
    await adapter.scheduleDeletion('saved/user-1/pages/page-1_final.png');

    expect(client.commands).toHaveLength(3);
    expect(client.commands[2]).toBeInstanceOf(GetObjectTaggingCommand);
  });

  it('既に存在しない object は lifecycle 再送を成功扱いにする', async () => {
    const client = new FakeS3Client();
    client.error = Object.assign(new Error('missing'), { name: 'NoSuchKey' });
    const adapter = new S3AccountAssetLifecycle(client, { bucketName: 'lyra-images' });

    await expect(adapter.scheduleDeletion('saved/user-1/pages/page-1_final.png')).resolves.toBeUndefined();
    expect(client.commands).toHaveLength(1);
  });

  it('tag 上限に達した object は既存 tag を破壊せず保留にする', async () => {
    const client = new FakeS3Client();
    client.tags = Array.from({ length: 10 }, (_, index) => ({
      Key: `existing-${index}`,
      Value: 'value',
    }));
    const adapter = new S3AccountAssetLifecycle(client, { bucketName: 'lyra-images' });

    await expect(adapter.scheduleDeletion('saved/user-1/pages/page-1_final.png')).rejects.toMatchObject({
      code: 'CONFIGURATION_ERROR',
    });
    expect(client.commands).toHaveLength(1);
  });

  it('空 bucket と危険な key は S3 を呼び出さず拒否する', async () => {
    expect(() => new S3AccountAssetLifecycle(new FakeS3Client(), { bucketName: ' ' })).toThrow(
      new ConfigurationError('S3 image bucket name is required'),
    );

    const client = new FakeS3Client();
    const adapter = new S3AccountAssetLifecycle(client, { bucketName: 'lyra-images' });

    await expect(adapter.scheduleDeletion('saved/user-1/../other/a.png')).rejects.toEqual(
      new ConfigurationError('S3 account asset key is invalid'),
    );
    await expect(adapter.scheduleDeletion('session/user-1/a.png')).rejects.toEqual(
      new ConfigurationError('S3 account asset key is invalid'),
    );
    await expect(adapter.scheduleDeletion('saved/user-1/pages/a.json')).rejects.toEqual(
      new ConfigurationError('S3 account asset key is invalid'),
    );
    expect(client.commands).toEqual([]);
  });

  it('S3 provider error から credential と key を露出しない', async () => {
    const client = new FakeS3Client();
    const secret = 's3-provider-secret';
    const key = 'saved/user-1/pages/page-1_final.png';
    const bucketName = 'lyra-images';
    client.error = new Error(`S3 ${bucketName} ${key} Authorization: Bearer ${secret}`);
    const adapter = new S3AccountAssetLifecycle(client, { bucketName });

    await expect(adapter.scheduleDeletion(key)).rejects.toMatchObject({
      code: 'CONFIGURATION_ERROR',
      message: expect.stringContaining('Bearer [redacted]'),
    });
    await expect(adapter.scheduleDeletion(key)).rejects.not.toMatchObject({
      message: expect.stringContaining(secret),
    });
    await expect(adapter.scheduleDeletion(key)).rejects.not.toMatchObject({
      message: expect.stringContaining(key),
    });
    await expect(adapter.scheduleDeletion(key)).rejects.not.toMatchObject({
      message: expect.stringContaining(bucketName),
    });
  });
});
