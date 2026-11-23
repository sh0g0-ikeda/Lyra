import { describe, expect, it } from 'vitest';

import {
  acknowledgeSavedPageDraftRevision,
  isSavedPageDraftRevisionCurrent,
} from '@/domain/pageQuoteDraftRevision';

describe('ページ画像見積の保存済みdraft revision', () => {
  it('保存後のdirty表示が遅れても送信したrevisionが同じなら見積を継続する', () => {
    const receipt = acknowledgeSavedPageDraftRevision('page-1:draft-a');

    expect(isSavedPageDraftRevisionCurrent(receipt, 'page-1:draft-a')).toBe(true);
  });

  it('保存待ちの間に入力またはページが変わった場合は見積を無効にする', () => {
    const receipt = acknowledgeSavedPageDraftRevision('page-1:draft-a');

    expect(isSavedPageDraftRevisionCurrent(receipt, 'page-1:draft-b')).toBe(false);
    expect(isSavedPageDraftRevisionCurrent(receipt, 'page-2:draft-a')).toBe(false);
    expect(isSavedPageDraftRevisionCurrent(null, 'page-1:draft-a')).toBe(false);
  });
});
