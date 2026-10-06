import React from 'react';
import { act, create } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePanelInsertion } from '@/hooks/usePanelInsertion';
import type { PanelRecord } from '@/domain/types';

const query = vi.hoisted(() => ({ cancelQueries: vi.fn(async () => undefined), invalidateQueries: vi.fn(async () => undefined), fetchQuery: vi.fn(async ({ queryFn }: { queryFn: () => Promise<unknown> }) => queryFn()) }));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => query }));
const response = { panel_ids: ['a', 'c', 'b'], created_panel_id: 'c', layout_template_id: 'top_wide_3', frames: [], balloon_reference_updated_count: 0, balloon_reference_cleared_count: 0 } as const;
const panels = [{ id: 'a', order: 1 }, { id: 'b', order: 2 }] as PanelRecord[];
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: Error) => void } {
  let resolve!: (value: T) => void; let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe('usePanelInsertion', () => {
  beforeEach(() => vi.clearAllMocks());
  const setup = () => {
    const api = { insertPanelAfter: vi.fn().mockResolvedValue(response), getPanels: vi.fn().mockResolvedValue({ panels: [...panels, { id: 'c', order: 2 }] }), getFrames: vi.fn().mockResolvedValue({ frames: [] }) };
    const select = vi.fn();
    let result!: ReturnType<typeof usePanelInsertion>;
    function Harness({ pageId = 'page', dirty = false }: { pageId?: string; dirty?: boolean }): null {
      result = usePanelInsertion({ api, sessionKey: 'session', organizationId: 'org', episodeId: 'episode', workId: 'work', pageId, selectedPanelId: 'a', panels, canEdit: true, dirty, busy: false, status: 'designing', onSelect: select });
      return null;
    }
    let renderer!: ReturnType<typeof create>;
    act(() => { renderer = create(<Harness />); });
    return { api, select, renderer, Harness, get result() { return result; } };
  };
  it('連続tapは一回の原子命令にまとめ、最新のコマ取得後だけ新コマを選択する', async () => {
    const test = setup(); const pending = deferred<typeof response>(); test.api.insertPanelAfter.mockReturnValue(pending.promise);
    let first!: Promise<void>;
    act(() => { first = test.result.insertAfter(); void test.result.insertAfter(); });
    expect(test.api.insertPanelAfter).toHaveBeenCalledTimes(1);
    expect(test.select).not.toHaveBeenCalled();
    await act(async () => { pending.resolve(response); await first; });
    expect(test.select).toHaveBeenCalledWith('c');
    expect(test.result.notice).toBeNull();
    expect(query.invalidateQueries).toHaveBeenCalledWith(expect.objectContaining({ queryKey: ['balloons', 'session', 'page', 'org'] }));
  });
  it('確認中にdirty・別ページへ変わった場合は古い確認で送信しない', async () => {
    const test = setup(); const oldConfirm = test.result.insertAfter;
    act(() => test.renderer.update(<test.Harness dirty />));
    await act(async () => { await oldConfirm(); });
    expect(test.api.insertPanelAfter).not.toHaveBeenCalled();
    act(() => test.renderer.update(<test.Harness pageId="other" />));
    await act(async () => { await oldConfirm(); });
    expect(test.api.insertPanelAfter).not.toHaveBeenCalled();
  });
  it('送信後にページが変わった場合は新しいページの選択を奪わない', async () => {
    const test = setup(); const pending = deferred<typeof response>(); test.api.insertPanelAfter.mockReturnValue(pending.promise);
    let operation!: Promise<void>; act(() => { operation = test.result.insertAfter(); });
    act(() => test.renderer.update(<test.Harness pageId="other" />));
    await act(async () => { pending.resolve(response); await operation; });
    expect(test.select).not.toHaveBeenCalled();
    expect(test.result.notice).toBeNull();
  });
  it('書込み成功後の読込失敗は追加済みとして保持しreloadで書込みを繰り返さない', async () => {
    const test = setup(); test.api.getPanels.mockRejectedValueOnce(new Error('offline'));
    await act(async () => { await test.result.insertAfter(); });
    expect(test.result.notice).toBe('refreshFailed');
    expect(test.result.blocker).toBe('busy');
    expect(test.select).not.toHaveBeenCalled();
    await act(async () => { await test.result.reload(); });
    expect(test.api.insertPanelAfter).toHaveBeenCalledTimes(1);
    expect(test.select).toHaveBeenCalledWith('c');
    expect(test.result.notice).toBeNull();
  });
  it('追加後の読込失敗中に編集した下書きをreloadで新コマへ切り替えて消さない', async () => {
    const test = setup(); test.api.getPanels.mockRejectedValueOnce(new Error('offline'));
    await act(async () => { await test.result.insertAfter(); });
    act(() => test.renderer.update(<test.Harness dirty />));
    await act(async () => { await test.result.reload(); });
    expect(test.select).not.toHaveBeenCalled();
    expect(test.result.notice).toBeNull();
  });
  it('失敗前の古い確認callbackを再実行しても二重追加しない', async () => {
    const test = setup(); const oldConfirm = test.result.insertAfter;
    test.api.insertPanelAfter.mockRejectedValue(new Error('offline'));
    await act(async () => { await oldConfirm(); });
    await act(async () => { await oldConfirm(); });
    expect(test.api.insertPanelAfter).toHaveBeenCalledTimes(1);
  });
  it('通信断で受付不明の間は再追加せずreloadまで選択を保持する', async () => {
    const test = setup(); test.api.insertPanelAfter.mockRejectedValue(new Error('offline'));
    await act(async () => { await test.result.insertAfter(); });
    expect(test.result.notice).toBe('failed');
    await act(async () => { await test.result.insertAfter(); });
    expect(test.api.insertPanelAfter).toHaveBeenCalledTimes(1);
    await act(async () => { await test.result.reload(); });
    expect(test.select).not.toHaveBeenCalled();
    expect(test.result.notice).toBeNull();
  });
});
