import { describe, expect, it } from 'vitest';

import { shouldHydrateEditorDraft } from '@/domain/editorDraftSyncPolicy';

describe('editor draft synchronization', () => {
  it('サーバー値の取得前は空のdraftを同期済みにしない', () => {
    expect(
      shouldHydrateEditorDraft({
        hasServerSnapshot: false,
        hasUnsavedChanges: false,
        lastResourceId: null,
        resourceId: 'page-1'
      })
    ).toBe(false);
  });

  it('初回のサーバー値到着時は見かけ上の差分があっても同期する', () => {
    expect(
      shouldHydrateEditorDraft({
        hasServerSnapshot: true,
        hasUnsavedChanges: true,
        lastResourceId: null,
        resourceId: 'page-1'
      })
    ).toBe(true);
  });

  it('同じ対象に実際の未保存変更がある場合は上書きしない', () => {
    expect(
      shouldHydrateEditorDraft({
        hasServerSnapshot: true,
        hasUnsavedChanges: true,
        lastResourceId: 'page-1',
        resourceId: 'page-1'
      })
    ).toBe(false);
  });
});
