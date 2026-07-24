import { describe, expect, it, vi } from 'vitest';

import {
  applyDirtyStateChoice,
  hasSelectionChange,
  type DirtyEditorRegistration
} from '@/domain/dirtyStatePolicy';

const registration = (id: string): DirtyEditorRegistration => ({
  id,
  discard: vi.fn(),
  save: vi.fn().mockResolvedValue(undefined)
});

describe('dirty state policy', () => {
  it('保存は全editorを順番に保存して遷移を許可する', async () => {
    const order: string[] = [];
    const first = registration('story');
    const second = registration('page');
    first.save = vi.fn(async () => {
      order.push('story');
    });
    second.save = vi.fn(async () => {
      order.push('page');
    });

    await expect(applyDirtyStateChoice([first, second], 'save')).resolves.toBe(true);
    expect(order).toEqual(['story', 'page']);
    expect(first.discard).not.toHaveBeenCalled();
  });

  it('保存失敗時は残りを保存せず遷移を拒否する', async () => {
    const first = registration('story');
    const second = registration('page');
    first.save = vi.fn().mockRejectedValue(new Error('save failed'));

    await expect(applyDirtyStateChoice([first, second], 'save')).resolves.toBe(false);
    expect(second.save).not.toHaveBeenCalled();
  });

  it('破棄は全draftを戻し、キャンセルは何もしない', async () => {
    const editor = registration('story');

    await expect(applyDirtyStateChoice([editor], 'discard')).resolves.toBe(true);
    expect(editor.discard).toHaveBeenCalledOnce();
    editor.discard.mockClear();

    await expect(applyDirtyStateChoice([editor], 'cancel')).resolves.toBe(false);
    expect(editor.discard).not.toHaveBeenCalled();
    expect(editor.save).not.toHaveBeenCalled();
  });

  it('selectionの実値が変わる場合だけdirty guardを要求する', () => {
    const current = {
      organizationId: null,
      workId: 'work-1',
      chapterId: 'chapter-1',
      episodeId: null,
      pageId: null,
      entityId: null
    };

    expect(hasSelectionChange(current, { workId: 'work-1' })).toBe(false);
    expect(hasSelectionChange(current, {})).toBe(false);
    expect(hasSelectionChange(current, { chapterId: 'chapter-2' })).toBe(true);
    expect(hasSelectionChange(current, { organizationId: undefined })).toBe(false);
  });
});
