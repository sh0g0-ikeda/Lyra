import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { ImagePreviewModal } from '@/components/ImagePreviewModal';
import { FormField } from '@/components/FormField';
import { RecordPicker } from '@/components/RecordPicker';
import { Screen } from '@/components/Screen';
import { Section } from '@/components/Section';

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

vi.mock('expo-sharing', () => ({
  default: { isAvailableAsync: vi.fn(), shareAsync: vi.fn() },
  isAvailableAsync: vi.fn(),
  shareAsync: vi.fn()
}));

vi.mock('@/components/Notice', () => ({
  Notice: ({ message }: { message: string }) => React.createElement('notice', null, message)
}));

vi.mock('@/components/AiContentReportButton', () => ({
  AiContentReportButton: () => React.createElement('report-button', {
    accessibilityLabel: 'Report AI-generated content'
  })
}));

vi.mock('@/lib/storage', () => ({
  loadSectionCollapsed: vi.fn().mockResolvedValue(null),
  saveSectionCollapsed: vi.fn().mockResolvedValue(undefined)
}));

const setLanguageMock = vi.fn();

vi.mock('@/state/networkStatus', () => ({
  useNetworkStatus: () => ({ language: 'en', online: true, setLanguage: setLanguageMock })
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

  it('makes the image preview dismissible from its backdrop and exposes modal and button semantics', () => {
    const onClose = vi.fn();
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(<ImagePreviewModal language="en" onClose={onClose} uri="https://cdn.example.test/page.png" />);
    });

    expect(renderer!.root.findByProps({ accessibilityViewIsModal: true })).toBeDefined();
    const backdrop = renderer!.root.findByProps({ accessibilityLabel: 'Close image preview' });
    act(() => {
      backdrop.props.onPress();
    });
    expect(onClose).toHaveBeenCalledOnce();

    const close = renderer!.root.findByProps({ accessibilityLabel: 'Close image preview dialog' });
    expect(close.props.style.minHeight).toBeGreaterThanOrEqual(44);
    const share = renderer!.root.findByProps({ accessibilityLabel: 'Share or save image' });
    expect(share.props.style.minHeight).toBeGreaterThanOrEqual(44);
  });

  it('keeps screen content in safe areas and resizes for the Android keyboard', () => {
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(<Screen title="Story">Content</Screen>);
    });

    const safeArea = renderer!.root.findByType('safe-area-view');
    expect(safeArea.props.edges).toEqual(['top', 'bottom']);
    expect(renderer!.root.findByType('keyboard-avoiding-view').props.behavior).toBe('height');
    const scrollView = renderer!.root.findByType('scroll-view');
    expect(scrollView.props.automaticallyAdjustKeyboardInsets).toBe(true);
  });

  it('shows an accessible compact language switch even when the screen header is hidden', () => {
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(<Screen showHeader={false} title="Sign in">Content</Screen>);
    });

    const japanese = renderer!.root.findByProps({ accessibilityLabel: '日本語' });
    const english = renderer!.root.findByProps({ accessibilityLabel: 'English' });
    expect(japanese.props.accessibilityRole).toBe('radio');
    expect(english.props.accessibilityState).toEqual({ checked: true });
    expect(japanese.props.style.minHeight).toBeGreaterThanOrEqual(44);
    act(() => japanese.props.onPress());
    expect(setLanguageMock).toHaveBeenCalledWith('ja');
  });
});
