import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useStartingStatesDraft } from '@/hooks/useStartingStatesDraft';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const renderers: ReactTestRenderer[] = [];
afterEach(() => { for (const renderer of renderers.splice(0)) act(() => renderer.unmount()); });

describe('ページ画面のキャラクター開始状態', () => {
  function setup(onSave = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)) {
    let latest: ReturnType<typeof useStartingStatesDraft>;
    let input = { scope: 'user:org:episode-a', episode: { id: 'episode-a', updated_at: 'revision-a', starting_entity_states: [{ entity_id: 'hero', state_id: 'uniform' }] }, canEdit: true, enabled: true, onSave };
    function Probe(): null { latest = useStartingStatesDraft(input); return null; }
    let renderer: ReactTestRenderer;
    act(() => { renderer = create(<Probe />); });
    renderers.push(renderer!);
    return { current: () => latest!, onSave, update: (patch: Partial<typeof input>): void => { input = { ...input, ...patch }; act(() => renderer.update(<Probe />)); } };
  }

  it('開始状態を変更して保存した場合に話のrevision付きで保存し画面を開くだけでは送信しない', async () => {
    const state = setup();
    expect(state.onSave).not.toHaveBeenCalled();
    act(() => state.current().setValue([]));
    expect(state.current().dirty).toBe(true);
    await act(async () => state.current().save());
    expect(state.onSave).toHaveBeenCalledWith('episode-a', { starting_entity_states: [], expected_updated_at: 'revision-a' });
    expect(state.current().dirty).toBe(false);
  });

  it('編集中に再取得された場合に編集開始時のrevisionを保持して古い変更の上書きを防ぐ', async () => {
    const state = setup();
    act(() => state.current().setValue([]));
    state.update({ episode: { id: 'episode-a', updated_at: 'revision-b', starting_entity_states: [{ entity_id: 'hero', state_id: 'new-server-state' }] } });
    await act(async () => state.current().save());
    expect(state.onSave).toHaveBeenCalledWith('episode-a', { starting_entity_states: [], expected_updated_at: 'revision-a' });
  });

  it('保存に失敗した場合に入力を保持して再試行できる', async () => {
    const onSave = vi.fn<() => Promise<void>>().mockRejectedValueOnce(new Error('stale')).mockResolvedValue(undefined);
    const state = setup(onSave);
    act(() => state.current().setValue([]));
    await act(async () => { await state.current().save().catch(() => undefined); });
    expect(state.current().value).toEqual([]);
    expect(state.current().dirty).toBe(true);
    expect(state.current().error).toBeInstanceOf(Error);
    await act(async () => state.current().save());
    expect(onSave).toHaveBeenCalledTimes(2);
  });

  it('保存中に話を切り替えた場合に古い完了が新しい話の入力を消さない', async () => {
    let complete!: () => void;
    const state = setup(vi.fn(() => new Promise<void>((resolve) => { complete = resolve; })));
    act(() => state.current().setValue([]));
    let pending!: Promise<void>;
    act(() => { pending = state.current().save(); });
    state.update({ scope: 'user:org:episode-b', episode: { id: 'episode-b', updated_at: 'revision-b', starting_entity_states: [] } });
    act(() => state.current().setValue([{ entity_id: 'other', state_id: null }]));
    await act(async () => { complete(); await pending; });
    expect(state.current().value).toEqual([{ entity_id: 'other', state_id: null }]);
    expect(state.current().dirty).toBe(true);
    expect(state.current().saving).toBe(false);
  });

  it('保存を続けて押した場合に一つの保存要求を共有する', async () => {
    let complete!: () => void;
    const state = setup(vi.fn(() => new Promise<void>((resolve) => { complete = resolve; })));
    act(() => state.current().setValue([]));
    let first!: Promise<void>, second!: Promise<void>;
    act(() => { first = state.current().save(); second = state.current().save(); });
    expect(state.onSave).toHaveBeenCalledOnce();
    await act(async () => { complete(); await Promise.all([first, second]); });
  });

  it('能力または編集権限が無い場合に開始状態を書き込まない', async () => {
    const state = setup();
    act(() => state.current().setValue([]));
    state.update({ enabled: false });
    await act(async () => { await state.current().save().catch(() => undefined); });
    expect(state.onSave).not.toHaveBeenCalled();
    expect(state.current().dirty).toBe(true);
  });
});
