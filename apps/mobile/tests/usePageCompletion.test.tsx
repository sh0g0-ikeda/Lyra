import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePageCompletion } from '@/hooks/usePageCompletion';
import type { PageCompletionContext } from '@/domain/pageCompletionPolicy';
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let appState: (state: string) => void = () => undefined;
vi.mock('react-native', () => ({ AppState: { currentState: 'active', addEventListener: (_event: string, listener: (state: string) => void) => { appState = listener; return { remove: vi.fn() }; } } }));
let root: ReactTestRenderer | undefined; let value: ReturnType<typeof usePageCompletion>;
let context: Omit<PageCompletionContext, 'foreground'>;
const result = { jobId: 'job', targetKey: 'scope:page', pageId: 'page', pageNumber: 1 };
function Probe(): null { const current = usePageCompletion(context); React.useLayoutEffect(() => { value = current; }, [current]); return null; }
async function render(): Promise<void> { await act(async () => { if (root) root.update(<Probe />); else root = create(<Probe />); }); }
beforeEach(() => { context = { targetKey: 'scope:page', focused: true, dirty: false, presentationBusy: false }; });
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; });
describe('生成結果の一度だけの表示', () => {
  it('同じjobのpoll再受信で閉じた結果を開き直さず手動再表示は可能', async () => {
    await render(); await act(async () => value.complete(result)); expect(value.visible).toBe(true);
    await act(async () => value.close()); await act(async () => value.complete(result)); expect(value.visible).toBe(false);
    await act(async () => value.open(result)); expect(value.visible).toBe(true);
  });
  it('dirty・購入/確認dialog・別target・別step中は割り込まない', async () => {
    for (const patch of [{ dirty: true }, { presentationBusy: true }, { focused: false }, { targetKey: 'other' }]) {
      context = { targetKey: 'scope:page', focused: true, dirty: false, presentationBusy: false, ...patch };
      await render(); await act(async () => value.complete({ ...result, jobId: JSON.stringify(patch) })); expect(value.visible).toBe(false);
    }
    context = { targetKey: 'scope:page', focused: true, dirty: false, presentationBusy: false }; await render(); expect(value.visible).toBe(false);
  });
  it('background完了は同targetのforeground復帰時に一度だけ表示する', async () => {
    await render(); await act(async () => appState('background')); await act(async () => value.complete(result)); expect(value.visible).toBe(false);
    await act(async () => appState('active')); expect(value.visible).toBe(true);
    await act(async () => value.close()); await act(async () => appState('background')); await act(async () => appState('active')); expect(value.visible).toBe(false);
  });
  it('閉じる前にtargetが変わった場合は別作品へ結果を表示しない', async () => {
    await render(); await act(async () => value.complete(result)); context = { ...context, targetKey: 'other' }; await render(); expect(value.visible).toBe(false); expect(value.result).toBeNull();
    context = { ...context, targetKey: 'scope:page' }; await render(); expect(value.visible).toBe(false);
  });
});
