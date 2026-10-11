import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { PageStoryAutofillAction } from '@/components/PageCreationWorkflow';

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
});
