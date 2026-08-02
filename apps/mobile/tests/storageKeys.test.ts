import { describe, expect, it } from 'vitest';

import { selectionStorageKey, termsAcceptanceStorageKey } from '@/lib/storageKeys';

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

describe('termsAcceptanceStorageKey', () => {
  it('利用者と規約版ごとに明示同意を別領域へ保存する', () => {
    expect(termsAcceptanceStorageKey('user-1', '2026-08-02')).not.toBe(
      termsAcceptanceStorageKey('user-2', '2026-08-02')
    );
    expect(termsAcceptanceStorageKey('user-1', '2026-08-02')).not.toBe(
      termsAcceptanceStorageKey('user-1', '2027-01-01')
    );
  });
});
