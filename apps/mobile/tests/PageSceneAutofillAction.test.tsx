import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { PageSceneAutofillAction } from '@/components/PageSceneAutofillAction';

vi.mock('react-native', () => ({
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'text',
  View: 'view'
}));

vi.mock('@/components/PrimaryButton', () => ({
  PrimaryButton: ({
    disabled,
    label,
    onPress
  }: {
    disabled?: boolean;
    label: string;
    onPress: () => void;
  }) => React.createElement('button', { disabled, onClick: onPress }, label)
}));

const renderAction = (
  overrides: Partial<React.ComponentProps<typeof PageSceneAutofillAction>> = {}
): ReturnType<typeof create> => {
  let renderer: ReturnType<typeof create>;
  act(() => {
    renderer = create(
      <PageSceneAutofillAction
        canEdit
        hasActiveJob={false}
        isEditableDraft
        language="ja"
        loading={false}
        onPress={vi.fn()}
        pageNumber={3}
        sourceSceneLabels={['設定 1: 駅前', '設定 2: ホーム']}
        {...overrides}
      />
    );
  });
  return renderer!;
};

describe('PageSceneAutofillAction', () => {
  it('選択ページとシーン出典を表示し、明示操作だけで自動反映を開始する', () => {
    const onPress = vi.fn();
    const rendered = renderAction({ onPress });
    const text = JSON.stringify(rendered.toJSON());

    expect(text).toContain('選択中のページ: 3');
    expect(text).toContain('設定 1: 駅前');
    expect(text).toContain('背景や時間帯の設定をページに反映');
    act(() => rendered.root.findByType('button').props.onClick());
    expect(onPress).toHaveBeenCalledOnce();
  });

  it.each([
    { hasActiveJob: true, isEditableDraft: true, sourceSceneLabels: ['設定 1'] },
    { hasActiveJob: false, isEditableDraft: false, sourceSceneLabels: ['設定 1'] },
    { hasActiveJob: false, isEditableDraft: true, sourceSceneLabels: [] }
  ])('生成中・編集不可・シーン出典なしでは開始できない', (overrides) => {
    const rendered = renderAction(overrides);
    expect(rendered.root.findByType('button').props.disabled).toBe(true);
  });
});
