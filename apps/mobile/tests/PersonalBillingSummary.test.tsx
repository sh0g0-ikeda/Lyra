import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { PersonalBillingSummary } from '@/components/PersonalBillingSummary';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-native', () => ({
  Pressable: ({
    children,
    onPress,
    ...props
  }: {
    children: React.ReactNode;
    onPress?: () => void;
  }) => React.createElement('button', { ...props, onClick: onPress }, children),
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'text',
  View: 'view'
}));

vi.mock('@/components/PrimaryButton', () => ({
  PrimaryButton: ({
    label,
    onPress
  }: {
    label: string;
    onPress: () => void;
  }) => React.createElement('button', { onClick: onPress }, label)
}));

describe('PersonalBillingSummary', () => {
  it('次回更新日と期間終了時の解約予約を表示する', () => {
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        <PersonalBillingSummary
          cancelAtPeriodEnd
          currentPeriodEnd="2026-08-01T00:00:00.000Z"
          language="ja"
          onManage={vi.fn()}
        />
      );
    });

    const output = JSON.stringify(renderer!.toJSON());
    expect(output).toContain('次回更新日');
    expect(output).toContain('2026年8月1日');
    expect(output).toContain('期間終了時に解約予定');
    expect(output).toContain('有料プランの変更・解約は「サブスク・請求を管理」で行ってください');
  });

  it('管理操作をstoreのsubscription管理導線へ渡す', () => {
    const onManage = vi.fn();
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        <PersonalBillingSummary
          cancelAtPeriodEnd={false}
          currentPeriodEnd={null}
          language="en"
          onManage={onManage}
        />
      );
    });

    const button = renderer!.root.findByType('button');
    act(() => button.props.onClick());
    expect(onManage).toHaveBeenCalledOnce();
    expect(JSON.stringify(renderer!.toJSON())).toContain('Not scheduled');
  });
});
