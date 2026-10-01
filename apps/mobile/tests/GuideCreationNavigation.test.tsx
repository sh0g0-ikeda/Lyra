import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GuideScreen } from '@/screens/GuideScreen';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let canViewWork = true;
const navigate = vi.fn();
const resolveDirtyEditors = vi.fn<() => Promise<boolean>>();
let root: ReactTestRenderer | undefined;
vi.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate }) }));
vi.mock('react-native', () => ({ Text: 'text', View: 'view', StyleSheet: { create: <T,>(styles: T): T => styles } }));
vi.mock('@/components/Screen', () => ({ Screen: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('@/components/Section', () => ({ Section: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('@/components/PrimaryButton', () => ({ PrimaryButton: (props: Record<string, unknown>) => React.createElement('button', props) }));
vi.mock('@/components/MangaTutorial', () => ({ MangaTutorial: () => React.createElement('tutorial') }));
vi.mock('@/state/appState', () => ({ useAppState: () => ({ language: 'ja', hasCapability: () => canViewWork }) }));
vi.mock('@/state/dirtyState', () => ({ useDirtyState: () => ({ resolveDirtyEditors }) }));

describe('ガイドから各制作工程への導線', () => {
  beforeEach(() => { canViewWork = true; navigate.mockReset(); resolveDirtyEditors.mockReset().mockResolvedValue(true); });
  afterEach(async () => { await act(async () => { root?.unmount(); }); });
  it('3つの既存ガイドを対応する漫画工程へ接続する', async () => {
    await act(async () => { root = create(<GuideScreen />); });
    for (const [index, step] of ['story', 'characters', 'pages'].entries()) {
      await act(async () => { root?.root.findAllByType('button')[index].props.onPress(); });
      expect(navigate).toHaveBeenLastCalledWith('Story', { step, requestId: expect.any(Number) });
    }
    expect(root?.root.findAllByType('tutorial')).toHaveLength(1);
  });
  it('ガイドのCTAでもdirty確認キャンセル時には移動しない', async () => {
    resolveDirtyEditors.mockResolvedValue(false);
    await act(async () => { root = create(<GuideScreen />); });
    await act(async () => { root?.root.findAllByType('button')[2].props.onPress(); });
    expect(navigate).not.toHaveBeenCalled();
  });
  it('billing専用では制作CTAを無効にして再表示ガイドを残す', async () => {
    canViewWork = false;
    await act(async () => { root = create(<GuideScreen />); });
    expect(root?.root.findAllByType('button').every((node) => node.props.disabled)).toBe(true);
    expect(root?.root.findAllByType('tutorial')).toHaveLength(1);
    await act(async () => root?.root.findAllByType('button')[0].props.onPress());
    expect(navigate).not.toHaveBeenCalled();
  });

});
