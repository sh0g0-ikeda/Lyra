import { describe, expect, it } from 'vitest';
import { inferPageCreationStep, nextPageInSequence } from '@/domain/pageCreationWorkflow';

describe('ページ制作工程と次ページの選択', () => {
  it('ページ未作成は設計、骨格のみは設定、保存済み設定や画像は作成から再開する', () => {
    expect(inferPageCreationStep({ hasPage: false, hasFrames: false, hasSettings: false, hasImage: false })).toBe('design');
    expect(inferPageCreationStep({ hasPage: true, hasFrames: true, hasSettings: false, hasImage: false })).toBe('settings');
    expect(inferPageCreationStep({ hasPage: true, hasFrames: true, hasSettings: true, hasImage: false })).toBe('create');
    expect(inferPageCreationStep({ hasPage: true, hasFrames: false, hasSettings: false, hasImage: true })).toBe('create');
  });
  it('次ページは並び順から決め、最後のページで勝手に追加しない', () => {
    const pages = [{ id: 'three', page_number: 3 }, { id: 'one', page_number: 1 }, { id: 'two', page_number: 2 }];
    expect(nextPageInSequence(pages, 'one')).toEqual(pages[2]);
    expect(nextPageInSequence(pages, 'three')).toBeNull();
    expect(nextPageInSequence(pages, 'missing')).toBeNull();
    expect(pages[0].id).toBe('three');
  });
});
