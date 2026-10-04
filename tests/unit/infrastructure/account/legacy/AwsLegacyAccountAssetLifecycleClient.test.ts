import { GetObjectTaggingCommand, PutObjectTaggingCommand } from '@aws-sdk/client-s3';
import { describe, expect, it } from 'vitest';
import { AwsLegacyAccountAssetLifecycleClient } from '../../../../../src/infrastructure/account/legacy/AwsLegacyAccountAssetLifecycleClient.js';
import { LegacyAccountAssetLifecycle } from '../../../../../src/legacy/account/LegacyAccountAssetLifecycle.js';

class FakeS3Client {
  public readonly commands: unknown[] = [];
  public tags = [{ Key: 'owner', Value: 'kept' }];
  public async send(command: unknown, _options: { abortSignal: AbortSignal }): Promise<{ TagSet?: Array<{ Key?: string; Value?: string }> }> {
    this.commands.push(command);
    if (command instanceof GetObjectTaggingCommand) return { TagSet: this.tags };
    return {};
  }
}

describe('AwsLegacyAccountAssetLifecycleClient', () => {
  it('既存tagを保持してGetObjectTaggingとPutObjectTaggingだけでpendingを追加する', async () => {
    const client = new FakeS3Client();
    const lifecycle = new LegacyAccountAssetLifecycle(new AwsLegacyAccountAssetLifecycleClient(client), { bucketName: 'legacy-images' });
    await lifecycle.scheduleDeletion('saved/user/page.png', context());
    expect(client.commands[0]).toBeInstanceOf(GetObjectTaggingCommand);
    expect(client.commands[1]).toBeInstanceOf(PutObjectTaggingCommand);
    expect(client.commands[1]).toMatchObject({ input: { Bucket: 'legacy-images', Key: 'saved/user/page.png', Tagging: { TagSet: [{ Key: 'owner', Value: 'kept' }, { Key: 'lyra-deletion-state', Value: 'pending' }] } } });
    expect(client.commands).toHaveLength(2);
  });

  it('不正なbucket又はabort済みcontextではSDKを呼ばない', async () => {
    const client = new FakeS3Client();
    expect(() => new AwsLegacyAccountAssetLifecycleClient(client, { bucketName: ' BAD ' })).toThrow('bucket');
    const lifecycle = new LegacyAccountAssetLifecycle(new AwsLegacyAccountAssetLifecycleClient(client), { bucketName: 'legacy-images' });
    const controller = new AbortController();
    controller.abort();
    await expect(lifecycle.scheduleDeletion('saved/user/page.png', {
      signal: controller.signal,
      deadlineAt: Date.now() + 1_000,
    })).rejects.toThrow('Legacy account asset tag read cancelled');
    expect(client.commands).toEqual([]);
  });
});

function context(deadlineAt = Date.now() + 1_000): { signal: AbortSignal; deadlineAt: number } {
  return { signal: new AbortController().signal, deadlineAt };
}
