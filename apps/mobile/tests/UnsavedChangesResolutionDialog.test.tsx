import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { UnsavedChangesResolutionDialog } from '@/components/UnsavedChangesResolutionDialog';

vi.mock('react-native', () => ({ Modal: 'modal', Pressable: 'pressable', ScrollView: 'scroll-view', StyleSheet: { create: (style: unknown) => style }, Text: 'text', View: 'view' }));
vi.mock('react-native-safe-area-context', () => ({ SafeAreaProvider: 'safe-area-provider', SafeAreaView: 'safe-area-view' }));
vi.mock('@/components/PrimaryButton', () => ({ PrimaryButton: (props: unknown) => React.createElement('button', props as Record<string, unknown>) }));

describe('UnsavedChangesResolutionDialog', () => {
  it.each(['en', 'ja'] as const)('各ボタンの結果を%sで明示し、cancelは破棄しない', (language) => {
    const onSelect = vi.fn();
    let renderer: ReturnType<typeof create>;
    act(() => { renderer = create(<UnsavedChangesResolutionDialog language={language} onSelect={onSelect} visible />); });
    expect(renderer!.root.findByProps({ testID: 'dirty-resolution-save' }).props.label).toBe(language === 'en' ? 'Save and continue' : '保存して続ける');
    expect(renderer!.root.findByProps({ testID: 'dirty-resolution-discard' }).props.label).toBe(language === 'en' ? 'Discard changes and continue' : '変更を破棄して続ける');
    expect(renderer!.root.findByProps({ testID: 'dirty-resolution-cancel' }).props.label).toBe(language === 'en' ? 'Go back' : '戻る');
    act(() => { renderer!.root.findByType('modal').props.onRequestClose(); });
    expect(onSelect).toHaveBeenCalledWith('cancel');
    expect(onSelect).not.toHaveBeenCalledWith('discard');
    expect(renderer!.root.findByType('scroll-view')).toBeDefined();
  });
});
