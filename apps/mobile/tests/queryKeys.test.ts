import { describe, expect, it } from 'vitest';

import {
  balanceQueryKey,
  balloonsQueryKey,
  entitiesInfiniteQueryKey,
  entityStatesQueryKey,
  pagesInfiniteQueryKey,
  worksInfiniteQueryKey,
  worksQueryKey,
} from '@/lib/queryKeys';

describe('queryKeys', () => {
  it('個人と法人の作品キャッシュが別キーになる', () => {
    expect(worksQueryKey('user-1', null)).not.toEqual(
      worksQueryKey('user-1', 'organization-1')
    );
  });

  it('吹き出しキャッシュが法人ごとに別キーになる', () => {
    expect(balloonsQueryKey('user-1', 'page-1', null)).not.toEqual(
      balloonsQueryKey('user-1', 'page-1', 'organization-1')
    );
  });

  it('残高キャッシュが個人と法人で別キーになる', () => {
    expect(balanceQueryKey('user-1', null)).not.toEqual(
      balanceQueryKey('user-1', 'organization-1')
    );
  });

  it('entity stateキャッシュが法人ごとに別キーになる', () => {
    expect(entityStatesQueryKey('user-1', 'entity-1', null)).not.toEqual(
      entityStatesQueryKey('user-1', 'entity-1', 'organization-1')
    );
  });

  it('cursor一覧は旧全件取得キャッシュと分離しworkspace scopeを保持する', () => {
    expect(worksInfiniteQueryKey('user-1', null)).not.toEqual(
      worksQueryKey('user-1', null),
    );
    expect(worksInfiniteQueryKey('user-1', null)).not.toEqual(
      worksInfiniteQueryKey('user-1', 'organization-1'),
    );
    expect(entitiesInfiniteQueryKey('user-1', 'work-1', null)).not.toEqual(
      entitiesInfiniteQueryKey('user-1', 'work-2', null),
    );
    expect(pagesInfiniteQueryKey('user-1', 'episode-1', null)).not.toEqual(
      pagesInfiniteQueryKey('user-1', 'episode-2', null),
    );
  });
});
