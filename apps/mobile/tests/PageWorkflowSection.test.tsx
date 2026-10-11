import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { PageJobHistory, PageStoryAutofillAction } from '@/components/PageCreationWorkflow';

vi.mock('react-native', () => ({ View: 'view', Text: 'text', Pressable: 'button', StyleSheet: { create: <T,>(styles: T): T => styles } }));
vi.mock('@/components/Notice', () => ({ Notice: (props: Record<string, unknown>) => React.createElement('notice', props) }));
vi.mock('@/components/PrimaryButton', () => ({ PrimaryButton: (props: Record<string, unknown>) => React.createElement('primary-button', props) }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('統合したページ自動入力導線', () => {
  it('上部に単一のストーリー自動入力ボタンだけを出す', async () => {
    let root: ReactTestRenderer;
    await act(async () => {
      root = create(<PageStoryAutofillAction canGenerate hasActiveJob={false} jobEnqueued={false} language="ja" loading={false} onPress={vi.fn()} pagesLoading={false} selectedEpisode />);
    });

    const button = root!.root.findByType('primary-button');
    expect(button.props).toMatchObject({ label: 'ストーリーから設定を自動入力', testID: 'page-story-autofill-primary', variant: 'primary' });
  });

  it('履歴を閉じてもジョブ監視をunmountせず読み上げから除外する', async () => {
    const mount = vi.fn();
    const unmount = vi.fn();
    function Monitor(): React.JSX.Element {
      React.useEffect(() => { mount(); return unmount; }, []);
      return React.createElement('monitor');
    }
    let root: ReactTestRenderer;
    await act(async () => { root = create(<PageJobHistory title="ページ設計の履歴"><Monitor /></PageJobHistory>); });

    const content = (): ReactTestRenderer['root'] => root!.root.findByProps({ testID: 'page-job-history-content' });
    expect(root!.root.findByType('monitor')).toBeDefined();
    expect(content().props).toMatchObject({ accessibilityElementsHidden: true, importantForAccessibility: 'no-hide-descendants', style: { display: 'none' } });
    await act(async () => root!.root.findByProps({ testID: 'page-job-history-toggle' }).props.onPress());
    expect(root!.root.findByType('monitor')).toBeDefined();
    expect(content().props.style).not.toMatchObject({ display: 'none' });
    expect(mount).toHaveBeenCalledOnce();
    expect(unmount).not.toHaveBeenCalled();
    await act(async () => root!.unmount());
  });
});
