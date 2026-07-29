import { describe, expect, it } from 'vitest';

import { selectionStorageKey } from '@/lib/storageKeys';

describe('selectionStorageKey', () => {
  it('同じ利用者でも個人と法人の選択状態を別領域に保存する', () => {
    expect(selectionStorageKey('user-1', null)).not.toBe(
      selectionStorageKey('user-1', 'organization-1')
    );
  });

  it('法人ごとの選択状態を別領域に保存する', () => {
    expect(selectionStorageKey('user-1', 'organization-1')).not.toBe(
      selectionStorageKey('user-1', 'organization-2')
    );
  });
});
