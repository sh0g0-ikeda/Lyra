import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { OrganizationManagementModal } from '@/components/OrganizationManagementModal';

vi.mock('react-native', () => ({
  AccessibilityInfo: { setAccessibilityFocus: vi.fn() },
  findNodeHandle: () => null,
  Modal: ({
    children,
    visible,
    ...props
  }: {
    children: React.ReactNode;
    visible: boolean;
  }) => (visible ? React.createElement('modal', props, children) : null),
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

vi.mock('@/components/Screen', () => ({
  Screen: ({
    children,
    title
  }: {
    children: React.ReactNode;
    title: string;
  }) => React.createElement('screen', { title }, children)
}));

describe('OrganizationManagementModal', () => {
  it('閉じている間は法人管理内容をmountしない', () => {
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        <OrganizationManagementModal language="ja" onClose={vi.fn()} visible={false}>
          <organization-management />
        </OrganizationManagementModal>
      );
    });

    expect(renderer!.root.findAllByType('organization-management')).toHaveLength(0);
  });

  it('全画面で開き、閉じる操作を提供する', () => {
    const onClose = vi.fn();
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        <OrganizationManagementModal language="ja" onClose={onClose} visible>
          <organization-management />
        </OrganizationManagementModal>
      );
    });

    expect(renderer!.root.findByType('screen').props.title).toBe('法人管理');
    const close = renderer!.root.findByType('button');
    act(() => close.props.onClick());
    expect(onClose).toHaveBeenCalledOnce();
  });
});
