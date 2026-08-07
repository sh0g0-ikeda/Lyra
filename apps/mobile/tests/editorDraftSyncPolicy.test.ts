import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  editorDraftHasUnsavedChanges,
  shouldHydrateEditorDraft
} from '@/domain/editorDraftSyncPolicy';

describe('editor draft synchronization', () => {
  it('StoryとCharactersは初回取得中の見かけ上の差分を未保存登録しない', () => {
    const storySource = readFileSync(
      resolve(process.cwd(), 'src/screens/StoryScreen.tsx'),
      'utf8'
    );
    const characterSource = readFileSync(
      resolve(process.cwd(), 'src/screens/CharactersScreen.tsx'),
      'utf8'
    );

    expect(storySource).toContain("from '@/domain/editorDraftSyncPolicy'");
    expect(storySource.match(/editorDraftHasUnsavedChanges\(\{/g)).toHaveLength(2);
    expect(storySource.match(/shouldHydrateEditorDraft\(\{/g)).toHaveLength(2);
    expect(characterSource).toContain("from '@/domain/editorDraftSyncPolicy'");
    expect(characterSource.match(/editorDraftHasUnsavedChanges\(\{/g)).toHaveLength(1);
    expect(characterSource.match(/shouldHydrateEditorDraft\(\{/g)).toHaveLength(1);
  });

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

  it('別ページのdraftが一時的に残っていても未保存扱いにしない', () => {
    expect(
      editorDraftHasUnsavedChanges({
        hasServerSnapshot: true,
        lastResourceId: 'page-1',
        resourceId: 'page-2',
        valuesDiffer: true
      })
    ).toBe(false);
  });

  it('新しいページのサーバー値を待つ間は未保存扱いにしない', () => {
    expect(
      editorDraftHasUnsavedChanges({
        hasServerSnapshot: false,
        lastResourceId: 'page-1',
        resourceId: 'page-2',
        valuesDiffer: true
      })
    ).toBe(false);
  });

  it('同期済みの同じページを編集した場合だけ未保存扱いにする', () => {
    expect(
      editorDraftHasUnsavedChanges({
        hasServerSnapshot: true,
        lastResourceId: 'page-2',
        resourceId: 'page-2',
        valuesDiffer: true
      })
    ).toBe(true);
  });
});
