import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { ExcessPanelDeletionPlan } from '@/components/ExcessPanelDeletionPlan';

vi.mock('react-native', () => ({
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'text',
  View: 'view',
}));

vi.mock('@/components/Notice', () => ({
  Notice: ({ message }: { message: string }) =>
    React.createElement('notice', null, message),
}));

vi.mock('@/components/PrimaryButton', () => ({
  PrimaryButton: ({
    label,
    onPress,
  }: {
    label: string;
    onPress: () => void;
  }) => React.createElement('button', { onClick: onPress }, label),
}));

describe('ExcessPanelDeletionPlan', () => {
  it('削除対象の内容を要約し明示操作までは削除しない', () => {
    const onReviewDelete = vi.fn();
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        <ExcessPanelDeletionPlan
          language="ja"
          onReviewDelete={onReviewDelete}
          panels={[
            {
              dialogueCount: 2,
              entityCount: 1,
              id: 'panel-3',
              order: 3,
              situation: '主人公が扉を開ける',
            },
          ]}
          targetPanelCount={2}
        />,
      );
    });

    const rendered = JSON.stringify(renderer!.toJSON());
    expect(rendered).toContain('主人公が扉を開ける');
    expect(rendered).toContain('キャラ1件');
    expect(rendered).toContain('セリフ2件');
    expect(onReviewDelete).not.toHaveBeenCalled();

    act(() => {
      renderer!.root.findByType('button').props.onClick();
    });
    expect(onReviewDelete).toHaveBeenCalledWith('panel-3');
  });
});
