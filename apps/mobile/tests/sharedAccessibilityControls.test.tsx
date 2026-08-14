import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { ImagePreviewModal } from '@/components/ImagePreviewModal';
import { FormField } from '@/components/FormField';
import { PrimaryButton } from '@/components/PrimaryButton';
import { RecordPicker } from '@/components/RecordPicker';
import { ResponsiveContentFrame } from '@/components/ResponsiveContentFrame';
import { Screen } from '@/components/Screen';
import { Section } from '@/components/Section';
import { mobileContentMaxWidth } from '@/constants/theme';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { setAccessibilityFocus } = vi.hoisted(() => ({
  setAccessibilityFocus: vi.fn()
}));

vi.mock('react-native', () => ({
  AccessibilityInfo: { setAccessibilityFocus },
  ActivityIndicator: 'activity-indicator',
  FlatList: ({
    data,
    renderItem,
    ...props
  }: {
    data: { id: string }[];
    renderItem: (input: { item: { id: string }; index: number }) => React.ReactNode;
  }) =>
    React.createElement(
      'flat-list',
      props,
      data.slice(0, 2).map((item, index) => renderItem({ item, index }))
    ),
  Image: 'image',
  KeyboardAvoidingView: ({ children, ...props }: { children: React.ReactNode }) => React.createElement('keyboard-avoiding-view', props, children),
  Modal: ({ children, visible, ...props }: { children: React.ReactNode; visible: boolean }) =>
    visible ? React.createElement('modal', props, children) : null,
  Platform: { OS: 'android' },
  Pressable: ({ children, onPress, ...props }: { children: React.ReactNode; onPress?: () => void }) =>
    React.createElement('pressable', { ...props, onPress }, children),
  RefreshControl: 'refresh-control',
  ScrollView: ({ children, ...props }: { children: React.ReactNode }) => React.createElement('scroll-view', props, children),
  StatusBar: 'status-bar',
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'text',
  TextInput: ({ onChangeText, ...props }: { onChangeText?: (value: string) => void }) => React.createElement('text-input', { ...props, onChangeText }),
  View: 'view',
  findNodeHandle: () => 42,
  useWindowDimensions: () => ({ height: 800, width: 400 })
}));

vi.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children, ...props }: { children: React.ReactNode }) => React.createElement('safe-area-view', props, children)
}));

vi.mock('expo-file-system/legacy', () => ({
  cacheDirectory: null,
  deleteAsync: vi.fn(),
  downloadAsync: vi.fn()
}));

vi.mock('expo-image', () => ({
  Image: (props: Record<string, unknown>) => React.createElement('expo-image', props)
}));

vi.mock('expo-sharing', () => ({
  default: { isAvailableAsync: vi.fn(), shareAsync: vi.fn() },
  isAvailableAsync: vi.fn(),
  shareAsync: vi.fn()
}));

vi.mock('@/components/Notice', () => ({
  Notice: ({ message }: { message: string }) => React.createElement('notice', null, message)
}));

vi.mock('@/lib/storage', () => ({
  loadSectionCollapsed: vi.fn().mockResolvedValue(null),
  saveSectionCollapsed: vi.fn().mockResolvedValue(undefined)
}));

vi.mock('@/state/networkStatus', () => ({
  useNetworkStatus: () => ({ language: 'en', online: true })
}));

describe('shared mobile accessibility controls', () => {
  it('gives text inputs a visible border and stronger focused state', () => {
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        <FormField label="Title" onChangeText={vi.fn()} value="" />
      );
    });

    const input = renderer!.root.findByType('text-input');
    expect(input.props.style[0].borderWidth).toBeGreaterThan(1);
    act(() => {
      input.props.onFocus();
    });
    expect(renderer!.root.findByType('text-input').props.style[1].borderColor).toBe('#E5C76B');
  });

  it('認証導線向けの大ボタンを58ptかつ18pt文字で表示する', () => {
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        <PrimaryButton label="Sign in" onPress={vi.fn()} size="large" testID="large-primary" />
      );
    });

    const button = renderer!.root.findByType('pressable');
    const buttonStyles = button.props.style({ pressed: false });
    expect(buttonStyles).toContainEqual(expect.objectContaining({
      minHeight: 58,
      width: '100%'
    }));

    const label = renderer!.root.findByType('text');
    expect(label.props.style).toContainEqual(expect.objectContaining({
      fontSize: 18,
      lineHeight: 24
    }));
  });

  it('gives a collapsible section a 44pt labeled expanded-state target', () => {
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(<Section collapsible title="Story details">Content</Section>);
    });

    const toggle = renderer!.root.findByProps({ accessibilityLabel: 'Story details' });
    expect(toggle.props.accessibilityRole).toBe('button');
    expect(toggle.props.accessibilityState).toEqual({ expanded: true });
    expect(toggle.props.style.minHeight).toBeGreaterThanOrEqual(44);
    expect(renderer!.root.findByProps({ accessibilityRole: 'header' })).toBeDefined();
  });

  it('keeps requested guidance visible while a section is collapsed', () => {
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        <Section
          collapsible
          defaultCollapsed
          showSubtitleWhenCollapsed
          subtitle="Continuity guidance"
          title="Scenes"
        >
          Hidden editor
        </Section>
      );
    });

    expect(JSON.stringify(renderer!.toJSON())).toContain('Continuity guidance');
    expect(JSON.stringify(renderer!.toJSON())).not.toContain('Hidden editor');
  });

  it('gives the record picker a named trigger, modal semantics, and a 44pt close target', () => {
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        <RecordPicker
          emptyLabel="Choose a work"
          items={[{ id: 'work-1', title: 'First work' }]}
          labelForItem={(item) => item.title}
          language="en"
          onSelect={vi.fn()}
          selectedId={null}
        />
      );
    });

    const trigger = renderer!.root.findByProps({ accessibilityLabel: 'Choose a work' });
    expect(trigger.props.accessibilityHint).toBe('Open selection list');
    act(() => {
      trigger.props.onPress();
    });

    expect(renderer!.root.findByProps({ accessibilityViewIsModal: true })).toBeDefined();
    const virtualizedList = renderer!.root.findByType('flat-list');
    expect(virtualizedList.props.initialNumToRender).toBeLessThanOrEqual(12);
    expect(virtualizedList.props.maxToRenderPerBatch).toBeLessThanOrEqual(12);
    expect(virtualizedList.props.windowSize).toBeLessThanOrEqual(7);
    const close = renderer!.root.findByProps({ accessibilityLabel: 'Close selection list' });
    expect(close.props.style.minHeight).toBeGreaterThanOrEqual(44);
    expect(close.props.style.minWidth).toBeGreaterThanOrEqual(44);
    act(() => {
      close.props.onPress();
    });
    expect(setAccessibilityFocus).toHaveBeenCalledWith(42);
  });

  it('makes the image preview dismissible from its backdrop without a duplicate save action', () => {
    const onClose = vi.fn();
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(<ImagePreviewModal language="en" onClose={onClose} uri="https://cdn.example.test/page.png" />);
    });

    expect(renderer!.root.findByProps({ accessibilityViewIsModal: true })).toBeDefined();
    const previewModal = renderer!.root.findByType('modal');
    expect(previewModal.props.presentationStyle).toBe('fullScreen');
    expect(previewModal.props.transparent).toBe(false);
    const backdrop = renderer!.root.findByProps({ accessibilityLabel: 'Close image preview' });
    act(() => {
      backdrop.props.onPress();
    });
    expect(onClose).toHaveBeenCalledOnce();

    const close = renderer!.root.findByProps({ accessibilityLabel: 'Close image preview dialog' });
    expect(close.props.style.minHeight).toBeGreaterThanOrEqual(44);
    expect(renderer!.root.findAllByProps({ accessibilityLabel: 'Share or save image' })).toHaveLength(0);
  });

  it('keeps shared content readable on phone and tablet widths', () => {
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        <ResponsiveContentFrame testID="responsive-content-frame">
          Content
        </ResponsiveContentFrame>
      );
    });

    const frame = renderer!.root
      .findAllByProps({ testID: 'responsive-content-frame' })
      .find((node) => node.type === 'view');
    expect(frame).toBeDefined();
    expect(frame?.props.style[0]).toMatchObject({
      alignSelf: 'center',
      maxWidth: mobileContentMaxWidth,
      width: '100%'
    });
  });

  it('keeps screen content in all safe areas and resizes for the Android keyboard', () => {
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(<Screen title="Story">Content</Screen>);
    });

    const safeArea = renderer!.root.findByType('safe-area-view');
    expect(safeArea.props.edges).toEqual(['top', 'right', 'bottom', 'left']);
    expect(renderer!.root.findByType('keyboard-avoiding-view').props.behavior).toBe('height');
    const scrollView = renderer!.root.findByType('scroll-view');
    expect(scrollView.props.automaticallyAdjustKeyboardInsets).toBe(true);
    expect(renderer!.root.findByProps({ testID: 'screen-content-frame' })).toBeDefined();
  });
});
