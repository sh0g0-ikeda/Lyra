import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { StoryCollaborationPanel } from '@/components/StoryCollaborationPanel';

vi.mock('react-native', () => ({
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'text',
  View: 'view'
}));

vi.mock('@/components/FormField', () => ({
  FormField: ({ editable = true, label, value }: { editable?: boolean; label: string; value: string }) =>
    React.createElement('field', { editable, value }, label)
}));

vi.mock('@/components/Notice', () => ({
  Notice: ({ message }: { message: string }) => React.createElement('notice', null, message)
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

const renderPanel = (
  overrides: Partial<React.ComponentProps<typeof StoryCollaborationPanel>> = {}
): ReturnType<typeof create> => {
  let renderer: ReturnType<typeof create>;
  act(() => {
    renderer = create(
      <StoryCollaborationPanel
        canEdit
        error={null}
        instruction="対立が自然につながる案をください"
        language="ja"
        loading={false}
        onApply={vi.fn()}
        onCancel={vi.fn()}
        onInstructionChange={vi.fn()}
        onRequest={vi.fn()}
        proposal="改善案の本文"
        selectedEpisode
        {...overrides}
      />
    );
  });
  return renderer!;
};

describe('StoryCollaborationPanel', () => {
  it('相談案は読み取り専用で、本文への反映は別の明示操作にする', () => {
    const onApply = vi.fn();
    const rendered = renderPanel({ onApply });

    const proposal = rendered.root.findAllByType('field').find((field) => field.props.value === '改善案の本文');
    expect(proposal?.props.editable).toBe(false);
    expect(JSON.stringify(rendered.toJSON())).toContain('相談案を本文へ反映');
    expect(JSON.stringify(rendered.toJSON())).not.toContain('自動で本文へ反映');

    act(() => rendered.root.findAllByType('button').find((button) => button.children.includes('相談案を本文へ反映'))!.props.onClick());
    expect(onApply).toHaveBeenCalledOnce();
  });

  it('ストリーム中は停止操作を表示し、失敗時も既存の相談案を残す', () => {
    const onCancel = vi.fn();
    const rendered = renderPanel({
      error: '通信が中断されました。',
      loading: true,
      onCancel
    });

    const tree = JSON.stringify(rendered.toJSON());
    expect(tree).toContain('相談を停止');
    expect(tree).toContain('改善案の本文');
    expect(tree).toContain('通信が中断されました。');
    act(() => rendered.root.findAllByType('button').find((button) => button.children.includes('相談を停止'))!.props.onClick());
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('編集権限・話の選択・空の指示がない場合は相談を開始できない', () => {
    const rendered = renderPanel({ canEdit: false, instruction: '', selectedEpisode: false });
    const requestButton = rendered.root.findAllByType('button').find((button) => button.children.includes('相談案を作成'));
    expect(requestButton?.props.disabled).toBe(true);
  });
});
