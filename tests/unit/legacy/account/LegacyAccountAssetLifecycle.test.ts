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
  public gets: string[] = [];
  public putKeys: string[] = [];

  public async getObjectTags(input: { key: string }): Promise<readonly LegacyAccountAssetTag[]> {
    this.gets.push(input.key);
    if (this.getError !== null) throw this.getError;
    return this.existing;
  }

  public async putObjectTags(input: {
    tags: readonly LegacyAccountAssetTag[];
    key: string;
  }): Promise<void> {
    this.putKeys.push(input.key);
    this.puts.push(input.tags);
  }
}

describe('LegacyAccountAssetLifecycle', () => {
  // Spec 5/8/11: keep the saved lifecycle reservation contract; temporary keys
  // come from personal token inventory. A tag is not proof of physical deletion or late-PUT safety.
  it.each(['jpeg', 'png', 'webp'])('旧/current生成形式の一時%s keyはexact keyへ削除予約する', async (extension) => {
    const client = new RecordingTagClient();
    client.existing = [{ Key: 'owner', Value: 'kept' }];
    const lifecycle = new LegacyAccountAssetLifecycle(client, { bucketName: 'images' });
    const key = temporaryKey(extension);
    await lifecycle.scheduleDeletion(key, callContext());
    expect(client.gets).toEqual([key]);
    expect(client.putKeys).toEqual([key]);
    expect(client.puts).toEqual([[{ Key: 'owner', Value: 'kept' }, { Key: 'lyra-deletion-state', Value: 'pending' }]]);
    client.existing = client.puts[0] ?? [];
    expect(await lifecycle.reconcileDeletionSchedule(key, callContext())).toBe('applied');
    await lifecycle.scheduleDeletion(key, callContext());
    expect(client.putKeys).toEqual([key]);
  });

  it.each(['NoSuchKey', 'NotFound'])('一時objectが%sの場合は旧予約契約どおり適用済みとなる', async (name) => {
    const client = new RecordingTagClient();
    client.getError = Object.assign(new Error('missing'), { name });
    const lifecycle = new LegacyAccountAssetLifecycle(client, { bucketName: 'images' });
    await lifecycle.scheduleDeletion(temporaryKey('png'), callContext());
    expect(await lifecycle.reconcileDeletionSchedule(temporaryKey('png'), callContext())).toBe('applied');
    expect(client.gets).toHaveLength(2);
    expect(client.puts).toEqual([]);
  });

  it('一時objectのtag無しはunknownとなり照合だけでは書き込まない', async () => {
    const client = new RecordingTagClient();
    const lifecycle = new LegacyAccountAssetLifecycle(client, { bucketName: 'images' });
    expect(await lifecycle.reconcileDeletionSchedule(temporaryKey('webp'), callContext())).toBe('unknown');
    expect(client.gets).toEqual([temporaryKey('webp')]);
    expect(client.puts).toEqual([]);
  });

  it.each([
    temporaryKey('jpg'), temporaryKey('gif'), temporaryKey('PNG'),
    temporaryKey('png') + '.jpeg', temporaryKey('png') + '\n',
    temporaryKey('png').replace('/entities/', '/other/'),
    temporaryKey('png').replace('/imports/', '/exports/'),
    temporaryKey('png').replace('tmp/', 'TMP/'),
    temporaryKey('png').replace('/entities/', '/../entities/'),
    temporaryKey('png').replace('/entities/', '/./entities/'),
    temporaryKey('png').replace('/entities/', '//entities/'),
    temporaryKey('png').replace('11111111-1111-4111-8111-111111111111', 'user'),
    temporaryKey('png').replace('22222222-2222-4222-8222-222222222222', 'not-a-uuid'),
    temporaryKey('png').replace('11111111', 'AAAAAAAA'),
    temporaryKey('png').replace('/entities/', '/enti\u0000ties/'),
    temporaryKey('png').replace('/entities/', '/enti\u0001ties/'),
    temporaryKey('png').replace('/imports/', '/imports\\'),
    '/' + temporaryKey('png'),
  ])('生成形式外の一時key %j は予約と照合のclient callsが0になる', async (key) => {
    const client = new RecordingTagClient();
    const lifecycle = new LegacyAccountAssetLifecycle(client, { bucketName: 'images' });
    await expect(lifecycle.scheduleDeletion(key, callContext())).rejects.toThrow('S3 account asset key is invalid');
    await expect(lifecycle.reconcileDeletionSchedule(key, callContext())).rejects.toThrow('S3 account asset key is invalid');
    expect(client.gets).toEqual([]);
    expect(client.puts).toEqual([]);
  });

  it('saved keyの既存の拡張子と大文字を許可する契約は維持する', async () => {
    const client = new RecordingTagClient();
    const lifecycle = new LegacyAccountAssetLifecycle(client, { bucketName: 'images' });
    for (const key of ['saved/user/page.jpg', 'saved/Old User/Page.JPEG', 'saved/user/Page.PNG']) {
      await lifecycle.scheduleDeletion(key, callContext());
    }
    expect(client.putKeys).toEqual(['saved/user/page.jpg', 'saved/Old User/Page.JPEG', 'saved/user/Page.PNG']);
  });
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

function temporaryKey(extension: string): string {
  return `tmp/11111111-1111-4111-8111-111111111111/entities/imports/22222222-2222-4222-8222-222222222222.${extension}`;
}
