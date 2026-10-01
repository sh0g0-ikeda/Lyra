import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MangaTutorial } from '@/components/MangaTutorial';

const mocks = vi.hoisted(() => ({
  load: vi.fn(), mark: vi.fn(), focus: vi.fn(), focused: true, dirty: false, language: 'en'
}));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock('react-native', () => ({
  AccessibilityInfo: { setAccessibilityFocus: mocks.focus }, findNodeHandle: () => 77,
  AppState: { currentState: 'active', addEventListener: () => ({ remove: vi.fn() }) },
  Modal: ({ children, visible, ...props }: { children: React.ReactNode; visible: boolean }) => visible ? React.createElement('modal', props, children) : null,
  Platform: { OS: 'android' }, Pressable: 'pressable', ScrollView: 'scroll-view',
  StyleSheet: { create: (style: unknown) => style }, Text: 'text', View: 'view'
}));
vi.mock('react-native-safe-area-context', () => ({ SafeAreaProvider: 'safe-area-provider', SafeAreaView: 'safe-area-view' }));
vi.mock('@react-navigation/native', () => ({ useIsFocused: () => mocks.focused }));
vi.mock('@/state/appState', () => ({ useAppState: () => ({ language: mocks.language }) }));
vi.mock('@/state/dirtyState', () => ({ useDirtyState: () => ({ hasDirtyEditors: mocks.dirty }) }));
vi.mock('@/lib/mangaTutorialHistory', () => ({ loadMangaTutorialHistory: mocks.load, markMangaTutorialSeen: mocks.mark }));
vi.mock('@/components/CreditBalanceBadge', () => ({ CreditBalanceBadge: () => React.createElement('credit-balance') }));
vi.mock('@/components/Notice', () => ({ Notice: ({ message }: { message: string }) => React.createElement('notice', null, message) }));
vi.mock('@/components/PrimaryButton', () => ({ PrimaryButton: ({ label, ...props }: { label: string }) => React.createElement('button', props, label) }));

const render = async (firstRun = true): Promise<ReactTestRenderer> => {
  let renderer: ReactTestRenderer;
  await act(async () => { renderer = create(<MangaTutorial firstRun={firstRun} />); });
  return renderer!;
};
const press = async (renderer: ReactTestRenderer, testID: string): Promise<void> => { await act(async () => { renderer.root.findByProps({ testID }).props.onPress(); }); };

describe('MangaTutorial', () => {
  beforeEach(() => {
    vi.clearAllMocks(); mocks.focused = true; mocks.dirty = false; mocks.language = 'en';
    mocks.load.mockResolvedValue('unseen'); mocks.mark.mockResolvedValue(true);
  });
  it('初回はsafe areaの案内を出し、skipで保存して即座に閉じ、再表示できる', async () => {
    const renderer = await render();
    expect(JSON.stringify(renderer.toJSON())).toContain('Welcome to Lyra');
    expect(renderer.root.findByType('safe-area-view').props.accessibilityViewIsModal).toBe(true);
    await press(renderer, 'manga-tutorial-skip');
    expect(mocks.mark).toHaveBeenCalledOnce();
    expect(renderer.root.findAllByType('modal')).toHaveLength(0);
    await press(renderer, 'manga-tutorial-replay');
    expect(renderer.root.findAllByType('modal')).toHaveLength(1);
    act(() => renderer.unmount());
  });
  it('既読や読取不可は自動表示せず、Guideからも手動で再表示できる', async () => {
    for (const status of ['seen', 'unavailable']) {
      mocks.load.mockResolvedValue(status);
      const renderer = await render();
      expect(renderer.root.findAllByType('modal')).toHaveLength(0);
      await press(renderer, 'manga-tutorial-replay');
      expect(renderer.root.findAllByType('modal')).toHaveLength(1);
      act(() => renderer.unmount());
    }
    const renderer = await render(false);
    expect(renderer.root.findAllByType('modal')).toHaveLength(0);
    act(() => renderer.unmount());
  });
  it('全工程の移動と完了は説明だけで、Android back・escapeも閉じる', async () => {
    const renderer = await render();
    for (let index = 0; index < 3; index += 1) await press(renderer, 'manga-tutorial-next');
    expect(JSON.stringify(renderer.toJSON())).toContain('Credits and replay');
    await press(renderer, 'manga-tutorial-finish');
    expect(mocks.mark).toHaveBeenCalledOnce();
    await press(renderer, 'manga-tutorial-replay');
    await act(async () => { renderer.root.findByType('modal').props.onRequestClose(); });
    expect(renderer.root.findAllByType('modal')).toHaveLength(0);
    await press(renderer, 'manga-tutorial-replay');
    await act(async () => { renderer.root.findByType('safe-area-view').props.onAccessibilityEscape(); });
    expect(renderer.root.findAllByType('modal')).toHaveLength(0);
    act(() => renderer.unmount());
  });
  it('遅い履歴読取は他tabやdirty dialogに割り込まない', async () => {
    let finish: (value: string) => void = () => undefined;
    mocks.load.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const renderer = await render();
    mocks.focused = false;
    await act(async () => { renderer.update(<MangaTutorial firstRun />); finish('unseen'); });
    expect(renderer.root.findAllByType('modal')).toHaveLength(0);
    mocks.focused = true; mocks.dirty = true;
    await act(async () => { renderer.update(<MangaTutorial firstRun />); });
    expect(renderer.root.findAllByType('modal')).toHaveLength(0);
    act(() => renderer.unmount());
  });
  it('履歴読込の途中で手動replayとskipを行っても遅い結果で再表示しない', async () => {
    let finish: (value: string) => void = () => undefined;
    mocks.load.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const renderer = await render();
    await press(renderer, 'manga-tutorial-replay');
    await press(renderer, 'manga-tutorial-skip');
    await act(async () => { finish('unseen'); });
    expect(renderer.root.findAllByType('modal')).toHaveLength(0);
    expect(mocks.mark).toHaveBeenCalledOnce();
    act(() => renderer.unmount());
  });
  it('保存失敗でも閉じて日英の安全なnoticeを出す', async () => {
    mocks.language = 'ja'; mocks.mark.mockResolvedValue(false);
    const renderer = await render();
    await press(renderer, 'manga-tutorial-skip');
    expect(renderer.root.findAllByType('modal')).toHaveLength(0);
    expect(JSON.stringify(renderer.toJSON())).toContain('端末に保存');
    act(() => renderer.unmount());
  });
});
