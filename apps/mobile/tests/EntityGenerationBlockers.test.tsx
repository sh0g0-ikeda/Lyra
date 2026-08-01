import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { EntityGenerationBlockers } from '@/components/EntityGenerationBlockers';

vi.mock('react-native', () => ({
  StyleSheet: { create: <T,>(styles: T): T => styles },
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

describe('EntityGenerationBlockers', () => {
  it('解決可能なblockerに該当sectionまたはAccountへのactionを出す', () => {
    const onAction = vi.fn();
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        <EntityGenerationBlockers
          blockers={[
            { code: 'ENTITY_SAVE_REQUIRED' },
            { code: 'IMPORT_IN_PROGRESS' },
            { code: 'INSUFFICIENT_CREDITS' },
            { code: 'ACTIVE_PREVIEW_JOB' },
            { code: 'PERMISSION_REQUIRED' },
          ]}
          language="ja"
          messageForCode={(code) => code}
          onAction={onAction}
        />,
      );
    });

    const rendered = JSON.stringify(renderer!.toJSON());
    expect(rendered).toContain('入力欄へ移動');
    expect(rendered).toContain('画像取り込みへ移動');
    expect(rendered).toContain('クレジットを確認');
    expect(rendered).toContain('ジョブを確認');
    expect(rendered).toContain('ワークスペースを確認');
    expect(renderer!.root.findAllByType('button')).toHaveLength(5);

    act(() => {
      renderer!.root
        .findAllByType('button')
        .find((button) => button.children.includes('入力欄へ移動'))!
        .props.onClick();
    });
    expect(onAction).toHaveBeenCalledWith('ENTITY_SAVE_REQUIRED');
  });
});
