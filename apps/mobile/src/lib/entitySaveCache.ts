import type { InfiniteData, QueryClient } from '@tanstack/react-query';

import type { EntityRecord } from '@/domain/types';
import { entitiesInfiniteQueryKey, entityDetailQueryKey } from '@/lib/queryKeys';

interface EntityPage {
  entities: EntityRecord[];
  next_cursor: string | null;
}

const newerEntity = (current: EntityRecord | undefined, saved: EntityRecord): EntityRecord => {
  if (current === undefined) {
    return saved;
  }
  const currentRevision = Date.parse(current.updated_at);
  const savedRevision = Date.parse(saved.updated_at);
  return Number.isFinite(currentRevision) &&
    (!Number.isFinite(savedRevision) || currentRevision > savedRevision)
    ? current
    : saved;
};

export const syncSavedEntity = async (input: {
  queryClient: QueryClient;
  sessionKey: string;
  organizationId: string | null;
  entity: EntityRecord;
}): Promise<void> => {
  const { queryClient, sessionKey, organizationId, entity } = input;
  const detailKey = entityDetailQueryKey(sessionKey, entity.id, organizationId);
  const listKey = entitiesInfiniteQueryKey(sessionKey, entity.work_id, organizationId);
  const latestCached = (saved: EntityRecord): EntityRecord => {
    let latest = newerEntity(queryClient.getQueryData<EntityRecord>(detailKey), saved);
    const list = queryClient.getQueryData<InfiniteData<EntityPage>>(listKey);
    for (const page of list?.pages ?? []) {
      latest = newerEntity(page.entities.find(record => record.id === entity.id), latest);
    }
    return latest;
  };

  // A read started before the PUT must not overwrite its response, even if generation fails next.
  const beforeCancellation = latestCached(entity);
  await Promise.all([
    queryClient.cancelQueries({ queryKey: detailKey, exact: true }),
    queryClient.cancelQueries({ queryKey: listKey, exact: true }),
  ]);
  const latest = latestCached(beforeCancellation);
  queryClient.setQueryData(detailKey, latest);
  queryClient.setQueryData<InfiniteData<EntityPage>>(listKey, current => {
    if (current === undefined) {
      return undefined;
    }
    let changed = false;
    const pages = current.pages.map(page => {
      if (!page.entities.some(record => record.id === entity.id)) {
        return page;
      }
      changed = true;
      return { ...page, entities: page.entities.map(record => record.id === entity.id ? latest : record) };
    });
    return changed ? { ...current, pages } : current;
  });
};
