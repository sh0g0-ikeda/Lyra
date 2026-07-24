import { describe, expect, it } from 'vitest';

import { storyHierarchyExpansionStorageKey } from '@/lib/storageKeys';

describe('storyHierarchyExpansionStorageKey', () => {
  it('利用者とワークスペースごとに階層の開閉状態を分離する', () => {
    expect(storyHierarchyExpansionStorageKey('user-1', null)).not.toBe(
      storyHierarchyExpansionStorageKey('user-1', 'organization-1')
    );
    expect(storyHierarchyExpansionStorageKey('user-1', 'organization-1')).not.toBe(
      storyHierarchyExpansionStorageKey('user-2', 'organization-1')
    );
  });
});
