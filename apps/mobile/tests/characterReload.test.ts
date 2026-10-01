import { describe, expect, it, vi } from 'vitest';
import { reloadCharacterSnapshot } from '@/domain/characterReload';
describe('explicit character reload', () => {
  it('サーバーが同じobjectを返した場合も明示reloadで全draftを一回適用する', async () => {
    const snapshot = { id: 'same', name: 'server' }; const apply = vi.fn();
    expect(await reloadCharacterSnapshot({ scope: 'scope', getCurrentScope: () => 'scope', load: async () => snapshot, apply })).toBe(true);
    expect(apply).toHaveBeenCalledExactlyOnceWith(snapshot);
  });
  it('読込中に対象が変わった場合は別キャラクターのdraftへ適用しない', async () => {
    const apply = vi.fn();
    expect(await reloadCharacterSnapshot({ scope: 'before', getCurrentScope: () => 'after', load: async () => ({ id: 'before' }), apply })).toBe(false);
    expect(apply).not.toHaveBeenCalled();
  });
  it('取得が失敗した場合は入力を消さない', async () => {
    const apply = vi.fn();
    await expect(reloadCharacterSnapshot({ scope: 'scope', getCurrentScope: () => 'scope', load: async () => { throw new Error('offline'); }, apply })).rejects.toThrow('offline');
    expect(apply).not.toHaveBeenCalled();
  });
});
