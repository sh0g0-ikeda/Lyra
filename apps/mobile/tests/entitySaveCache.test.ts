import { QueryClient, type InfiniteData } from '@tanstack/react-query';
import { afterEach, describe, expect, it } from 'vitest';

import type { EntityRecord } from '@/domain/types';
import { syncSavedEntity } from '@/lib/entitySaveCache';
import { entitiesInfiniteQueryKey, entityDetailQueryKey } from '@/lib/queryKeys';

type EntityPage = { entities: EntityRecord[]; next_cursor: string | null };
const client = new QueryClient();
const sessionKey = 'session-one';
const organizationId = 'org-one';
const entity = (id = 'entity-one', revision = 1): EntityRecord => ({
  id, work_id: 'work-one', entity_type: 'character', name: `Character ${revision}`,
  free_description: null, prompt_supplement: null, structured_fields: {}, speech_profile: {},
  status: 'draft', created_at: '2026-09-07T00:00:00.000Z',
  updated_at: `2026-09-07T00:00:0${revision}.000Z`,
});
const detailKey = entityDetailQueryKey(sessionKey, entity().id, organizationId);
const listKey = entitiesInfiniteQueryKey(sessionKey, entity().work_id, organizationId);
const save = (saved: EntityRecord): Promise<void> => syncSavedEntity({
  queryClient: client, sessionKey, organizationId, entity: saved,
});

afterEach(() => client.clear());

describe('キャラ保存応答のキャッシュ反映', () => {
  it('後続ページのキャラを保存した場合に順序とカーソルを保ったまま詳細と一覧を更新する', async () => {
    const first = { entities: [entity('another')], next_cursor: 'page-two' };
    const pages: InfiniteData<EntityPage, string | null> = {
      pages: [first, { entities: [entity()], next_cursor: null }], pageParams: [null, 'page-two'],
    };
    client.setQueryData(listKey, pages);
    client.setQueryData(detailKey, entity());
    await save(entity('entity-one', 2));
    expect(client.getQueryData(detailKey)).toEqual(entity('entity-one', 2));
    const updated = client.getQueryData<InfiniteData<EntityPage>>(listKey);
    expect(updated?.pages[0]).toBe(first);
    expect(updated?.pages[1]).toEqual({ entities: [entity('entity-one', 2)], next_cursor: null });
    expect(updated?.pageParams).toEqual(pages.pageParams);
  });

  it('一覧に未読み込みのキャラを保存した場合に詳細を更新し任意のページへ挿入しない', async () => {
    const pages = { pages: [{ entities: [entity('another')], next_cursor: 'more' }], pageParams: [null] };
    client.setQueryData(listKey, pages);
    client.setQueryData(detailKey, entity());
    await save(entity('entity-one', 2));
    expect(client.getQueryData(detailKey)).toEqual(entity('entity-one', 2));
    expect(client.getQueryData(listKey)).toBe(pages);
  });

  it('新規キャラを保存した場合に詳細を登録し未取得の一覧を捏造しない', async () => {
    await save(entity());
    expect(client.getQueryData(detailKey)).toEqual(entity());
    expect(client.getQueryData(listKey)).toBeUndefined();
  });

  it('同じIDが別セッションや組織にある場合に現在のスコープだけを更新する', async () => {
    const otherKeys = [
      entityDetailQueryKey('another-session', entity().id, organizationId),
      entityDetailQueryKey(sessionKey, entity().id, null),
      entitiesInfiniteQueryKey(sessionKey, entity().work_id, 'another-org'),
    ];
    otherKeys.forEach(key => client.setQueryData(key, { protected: true }));
    await save(entity('entity-one', 2));
    otherKeys.forEach(key => expect(client.getQueryData(key)).toEqual({ protected: true }));
  });

  it('新しい応答が先に到着した場合に後から届く古い応答で一覧も詳細も戻さない', async () => {
    client.setQueryData(listKey, { pages: [{ entities: [entity()], next_cursor: null }], pageParams: [null] });
    await save(entity('entity-one', 3));
    await save(entity('entity-one', 2));
    expect(client.getQueryData<EntityRecord>(detailKey)?.updated_at).toBe(entity('entity-one', 3).updated_at);
    expect(client.getQueryData<InfiniteData<EntityPage>>(listKey)?.pages[0].entities[0].updated_at).toBe(entity('entity-one', 3).updated_at);
  });

  it('一覧のほうが詳細より新しい場合に遅れた応答で選択中の情報を巻き戻さない', async () => {
    client.setQueryData(detailKey, entity());
    client.setQueryData(listKey, { pages: [{ entities: [entity('entity-one', 3)], next_cursor: null }], pageParams: [null] });
    await save(entity('entity-one', 2));
    expect(client.getQueryData<EntityRecord>(detailKey)?.updated_at).toBe(entity('entity-one', 3).updated_at);
  });

  it('更新時刻が不正な応答の場合に検証済みの新しいキャッシュを上書きしない', async () => {
    client.setQueryData(detailKey, entity('entity-one', 3));
    await save({ ...entity(), updated_at: 'invalid' });
    expect(client.getQueryData(detailKey)).toEqual(entity('entity-one', 3));
  });

  it('保存前に開始した詳細取得が遅れて完了した場合に保存応答を上書きしない', async () => {
    let finishRead: (value: EntityRecord) => void = () => undefined;
    const pending = client.fetchQuery({
      queryKey: detailKey,
      queryFn: () => new Promise<EntityRecord>(resolve => { finishRead = resolve; }),
    }).catch(() => undefined);
    await save(entity('entity-one', 2));
    finishRead(entity());
    await pending;
    expect(client.getQueryData(detailKey)).toEqual(entity('entity-one', 2));
  });
});
