import { describe, expect, it } from 'vitest';
import { resolveCompletedStorySave } from '../../../apps/web/src/lib/storyDraftSaveHydration.js';

describe('Web story draft save hydration', () => {
  it('話の保存中に追加入力した場合はローカル入力を保持する', () => {
    expect(resolveCompletedStorySave({
      latestDraft: {
        title: '保存後も編集中',
        story_full_draft: '保存送信後に追記した本文',
      },
      savedId: 'episode-1',
      savedVersion: 2,
      selectedId: 'episode-1',
      selectedVersion: 2,
      submittedDraft: {
        title: '保存対象',
        story_full_draft: '送信した本文',
      },
    })).toBe('preserve-local');
  });

  it('章の保存中に追加入力がない場合は保存済み状態を反映する', () => {
    const submittedDraft = {
      order: '1',
      title: '第一章',
    };

    expect(resolveCompletedStorySave({
      latestDraft: submittedDraft,
      savedId: 'chapter-1',
      savedVersion: 2,
      selectedId: 'chapter-1',
      selectedVersion: 2,
      submittedDraft,
    })).toBe('hydrate-server');
  });

  it('保存応答より再取得が古い場合は入力を維持して新しいrevisionを待つ', () => {
    expect(resolveCompletedStorySave({
      latestDraft: { title: '編集中' },
      savedId: 'chapter-1',
      savedVersion: 3,
      selectedId: 'chapter-1',
      selectedVersion: 2,
      submittedDraft: { title: '保存対象' },
    })).toBe('wait');
  });

  it('保存中に選択先が変わった場合は古い応答を別エディタへ反映しない', () => {
    expect(resolveCompletedStorySave({
      latestDraft: { title: '第二話の入力' },
      savedId: 'episode-1',
      savedVersion: 2,
      selectedId: 'episode-2',
      selectedVersion: 1,
      submittedDraft: { title: '第一話の保存対象' },
    })).toBe('discard');
  });
});
