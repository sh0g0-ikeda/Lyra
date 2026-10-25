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
  it('blockerを常時バナーや入力欄への移動actionとして表示しない', () => {
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

    expect(renderer!.toJSON()).toBeNull();
    expect(onAction).not.toHaveBeenCalled();
  });
});
