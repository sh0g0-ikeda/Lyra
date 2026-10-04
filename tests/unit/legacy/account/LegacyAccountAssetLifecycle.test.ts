import { describe, expect, it } from 'vitest';
import {
  LegacyAccountAssetLifecycle,
  type LegacyAccountAssetLifecycleClient,
  type LegacyAccountAssetTag,
} from '../../../../src/legacy/account/LegacyAccountAssetLifecycle.js';

class RecordingTagClient implements LegacyAccountAssetLifecycleClient {
  public existing: readonly LegacyAccountAssetTag[] = [];
  public puts: Array<readonly LegacyAccountAssetTag[]> = [];
  public getError: Error | null = null;

  public async getObjectTags(): Promise<readonly LegacyAccountAssetTag[]> {
    if (this.getError !== null) throw this.getError;
    return this.existing;
  }

  public async putObjectTags(input: {
    tags: readonly LegacyAccountAssetTag[];
  }): Promise<void> {
    this.puts.push(input.tags);
  }
}

describe('LegacyAccountAssetLifecycle', () => {
  it('既存tagを保持して旧lifecycle pending tagだけを追加する', async () => {
    const client = new RecordingTagClient();
    client.existing = [{ Key: 'owner', Value: 'kept' }];
    const lifecycle = new LegacyAccountAssetLifecycle(client, { bucketName: 'images' });

    await lifecycle.scheduleDeletion('saved/user/page.png', callContext());

    expect(client.puts).toEqual([[
      { Key: 'owner', Value: 'kept' },
      { Key: 'lyra-deletion-state', Value: 'pending' },
    ]]);
  });

  it('既にscheduledのobjectはtagを書き直さず物理削除もしない', async () => {
    const client = new RecordingTagClient();
    client.existing = [{ Key: 'lyra-deletion-state', Value: 'pending' }];
    const lifecycle = new LegacyAccountAssetLifecycle(client, { bucketName: 'images' });

    await lifecycle.scheduleDeletion('saved/user/page.webp', callContext());

    expect(client.puts).toEqual([]);
    expect('deleteExactObject' in lifecycle).toBe(false);
  });

  it('存在しないobjectは旧契約どおりscheduled完了として扱う', async () => {
    const client = new RecordingTagClient();
    const missing = new Error('missing');
    missing.name = 'NoSuchKey';
    client.getError = missing;

    await new LegacyAccountAssetLifecycle(client, { bucketName: 'images' })
      .scheduleDeletion('saved/user/missing.jpg', callContext());

    expect(client.puts).toEqual([]);
  });

  it('照合はpending tagまたは不存在だけを適用済みとしtag無しをunknownに保つ', async () => {
    const client = new RecordingTagClient();
    const lifecycle = new LegacyAccountAssetLifecycle(client, { bucketName: 'images' });
    expect(await lifecycle.reconcileDeletionSchedule('saved/user/page.png', callContext())).toBe('unknown');
    client.existing = [{ Key: 'lyra-deletion-state', Value: 'pending' }];
    expect(await lifecycle.reconcileDeletionSchedule('saved/user/page.png', callContext())).toBe('applied');
    const missing = new Error('missing');
    missing.name = 'NoSuchKey';
    client.getError = missing;
    expect(await lifecycle.reconcileDeletionSchedule('saved/user/page.png', callContext())).toBe('applied');
  });
});

function callContext(): { signal: AbortSignal; deadlineAt: number } {
  return { signal: new AbortController().signal, deadlineAt: Date.now() + 1_000 };
}
