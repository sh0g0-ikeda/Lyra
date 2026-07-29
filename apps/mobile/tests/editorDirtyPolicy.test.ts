import { describe, expect, it } from 'vitest';

import {
  entityDirtySaveIntent,
  storyEditorIsDirty
} from '@/domain/editorDirtyPolicy';

describe('editor dirty policy', () => {
  it.each([
    ['作品', { work: true, chapter: false, episode: false, scene: false }],
    ['章', { work: false, chapter: true, episode: false, scene: false }],
    ['話', { work: false, chapter: false, episode: true, scene: false }],
    ['シーン', { work: false, chapter: false, episode: false, scene: true }]
  ])('%sに未保存変更がある場合はストーリー編集全体をdirtyにする', (_label, flags) => {
    expect(storyEditorIsDirty(flags)).toBe(true);
  });

  it('ストーリーの全領域が保存済みならdirtyにしない', () => {
    expect(
      storyEditorIsDirty({
        work: false,
        chapter: false,
        episode: false,
        scene: false
      })
    ).toBe(false);
  });

  it('キャラクターのdirty draftは選択状態に応じて作成または更新する', () => {
    expect(entityDirtySaveIntent({ dirty: true, selectedEntityId: null })).toBe('create');
    expect(entityDirtySaveIntent({ dirty: true, selectedEntityId: 'entity-1' })).toBe('update');
  });

  it('キャラクターが保存済みなら保存処理を実行しない', () => {
    expect(entityDirtySaveIntent({ dirty: false, selectedEntityId: 'entity-1' })).toBeNull();
  });
});
