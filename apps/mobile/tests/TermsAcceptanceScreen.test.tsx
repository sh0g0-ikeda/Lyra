import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { TermsAcceptanceScreen } from '@/screens/TermsAcceptanceScreen';

vi.mock('react-native', () => ({
  Linking: { openURL: vi.fn().mockResolvedValue(undefined) },
  Pressable: ({ children, onPress }: { children: React.ReactNode; onPress: () => void }) =>
    React.createElement('link', { onClick: onPress }, children),
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Switch: ({ onValueChange, value }: { onValueChange: (value: boolean) => void; value: boolean }) =>
    React.createElement('switch', { checked: value, onChange: onValueChange }),
  Text: 'Text',
  View: 'View'
}));

vi.mock('@/components/Notice', () => ({ Notice: () => React.createElement('notice') }));
vi.mock('@/components/Screen', () => ({
  Screen: ({ children }: { children: React.ReactNode }) => React.createElement('screen', null, children)
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

describe('TermsAcceptanceScreen', () => {
  it('明示チェック前は同意できず、チェック後だけ同意処理を実行する', async () => {
    const onAccept = vi.fn().mockResolvedValue(undefined);
    let renderer: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(
        <TermsAcceptanceScreen language="en" onAccept={onAccept} onSignOut={vi.fn()} />
      );
    });

    const acceptButton = renderer!.root
      .findAllByType('button')
      .find((button) => button.children.includes('Agree and continue'));
    expect(acceptButton?.props.disabled).toBe(true);

    act(() => renderer!.root.findByType('switch').props.onChange(true));
    const enabledAcceptButton = renderer!.root
      .findAllByType('button')
      .find((button) => button.children.includes('Agree and continue'));
    expect(enabledAcceptButton?.props.disabled).toBe(false);
    await act(async () => {
      enabledAcceptButton?.props.onClick();
      await Promise.resolve();
    });

    expect(onAccept).toHaveBeenCalledOnce();
  });

  it('同意しない場合もログアウトできる', async () => {
    const onSignOut = vi.fn().mockResolvedValue(undefined);
    let renderer: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(
        <TermsAcceptanceScreen language="en" onAccept={vi.fn()} onSignOut={onSignOut} />
      );
    });

    const signOutButton = renderer!.root
      .findAllByType('button')
      .find((button) => button.children.includes('Decline and sign out'));
    await act(async () => signOutButton?.props.onClick());

    expect(onSignOut).toHaveBeenCalledOnce();
  });
});
