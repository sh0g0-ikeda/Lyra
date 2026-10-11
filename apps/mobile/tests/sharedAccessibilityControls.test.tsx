import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { ImagePreviewModal } from '@/components/ImagePreviewModal';
import { FormField } from '@/components/FormField';
import { RecordPicker } from '@/components/RecordPicker';
import { EmbeddedScreenProvider, Screen } from '@/components/Screen';
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

const screenState = vi.hoisted(() => ({ providerAvailable: true, session: null as null | { user: { id: string } } }));
vi.mock('@/state/appState', () => ({ useOptionalAppState: () => screenState.providerAvailable ? screenState : null }));
vi.mock('@/components/CreditBalanceBadge', () => ({ CreditBalanceBadge: () => React.createElement('credit-balance-badge') }));

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

  // Android needs explicit responder handling because ScrollView zoom props are not a cross-platform pinch contract.
  it('keeps an explicit pinch, pan, and double-tap reset surface for image preview on Android', () => {
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(<ImagePreviewModal language="en" onClose={vi.fn()} uri="https://cdn.example.test/page.png" />);
    });

    const surface = renderer!.root.findByProps({ testID: 'image-preview-zoom-surface' });
    expect(surface.props.onResponderGrant).toEqual(expect.any(Function));
    expect(surface.props.onResponderMove).toEqual(expect.any(Function));
    expect(surface.props.onResponderRelease).toEqual(expect.any(Function));

    const event = (touches: readonly { pageX: number; pageY: number }[]) => ({ nativeEvent: { touches } });
    act(() => {
      surface.props.onResponderGrant(event([{ pageX: 0, pageY: 0 }, { pageX: 10, pageY: 0 }]));
      surface.props.onResponderMove(event([{ pageX: 0, pageY: 0 }, { pageX: 100, pageY: 0 }]));
      surface.props.onResponderRelease();
    });
    const image = renderer!.root.findByType('image');
    expect(image.props.style[1].transform).toContainEqual({ scale: 4 });

    const now = vi.spyOn(Date, 'now');
    now.mockReturnValueOnce(1_000).mockReturnValueOnce(1_100);
    const doubleTapSurface = renderer!.root.findByProps({ testID: 'image-preview-zoom-surface' });
    act(() => {
      doubleTapSurface.props.onResponderGrant(event([{ pageX: 10, pageY: 10 }]));
      doubleTapSurface.props.onResponderRelease();
      doubleTapSurface.props.onResponderGrant(event([{ pageX: 10, pageY: 10 }]));
      doubleTapSurface.props.onResponderRelease();
    });
    expect(renderer!.root.findByType('image').props.style[1].transform).toContainEqual({ scale: 1 });
    now.mockRestore();
  });

  it('reclamps a panned preview after pinch zoom-out and resets it for a different image', async () => {
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(<ImagePreviewModal language="en" onClose={vi.fn()} uri="https://cdn.example.test/first.png" />);
    });
    const event = (touches: readonly { pageX: number; pageY: number }[]) => ({ nativeEvent: { touches } });
    const surface = renderer!.root.findByProps({ testID: 'image-preview-zoom-surface' });
    act(() => {
      surface.props.onResponderGrant(event([{ pageX: 0, pageY: 0 }, { pageX: 10, pageY: 0 }]));
      surface.props.onResponderMove(event([{ pageX: 0, pageY: 0 }, { pageX: 100, pageY: 0 }]));
      surface.props.onResponderRelease();
      surface.props.onResponderGrant(event([{ pageX: 0, pageY: 0 }]));
      surface.props.onResponderMove(event([{ pageX: 1_000, pageY: 1_000 }]));
      surface.props.onResponderRelease();
      surface.props.onResponderGrant(event([{ pageX: 0, pageY: 0 }, { pageX: 100, pageY: 0 }]));
      surface.props.onResponderMove(event([{ pageX: 0, pageY: 0 }, { pageX: 50, pageY: 0 }]));
      surface.props.onResponderRelease();
    });
    const zoomedOut = renderer!.root.findByType('image').props.style[1].transform;
    expect(zoomedOut).toContainEqual({ scale: 2 });
    const { width: viewportWidth } = surface.props.style[1] as { width: number };
    expect(zoomedOut).toContainEqual({ translateX: viewportWidth / 2 });

    act(() => {
      renderer!.update(<ImagePreviewModal language="en" onClose={vi.fn()} uri="https://cdn.example.test/second.png" />);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(renderer!.root.findByType('image').props.style[1].transform).toEqual([
      { translateX: 0 },
      { translateY: 0 },
      { scale: 1 }
    ]);
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

  it('shows the pre-login language switch even when the screen header is hidden', () => {
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
  it('ログイン後は言語をマイページへ集約し残高をscroll外に固定する', () => {
    screenState.session = { user: { id: 'user-one' } };
    let renderer: ReturnType<typeof create>;
    act(() => { renderer = create(<Screen title="Story">Content</Screen>); });
    expect(renderer!.root.findAllByProps({ accessibilityLabel: 'English' })).toHaveLength(0);
    expect(renderer!.root.findByType('credit-balance-badge')).toBeDefined();
    expect(renderer!.root.findByType('scroll-view').findAllByType('credit-balance-badge')).toHaveLength(0);
    act(() => renderer!.unmount());
    screenState.session = null;
  });

  it('providerがない設定エラー画面でも案内を表示できる', () => {
    screenState.providerAvailable = false;
    let renderer: ReturnType<typeof create>;
    act(() => { renderer = create(<Screen title="Lyra Mobile">Configuration support code</Screen>); });
    expect(JSON.stringify(renderer!.toJSON())).toContain('Configuration support code');
    expect(renderer!.root.findAllByType('credit-balance-badge')).toHaveLength(0);
    act(() => renderer!.unmount());
    screenState.providerAvailable = true;
  });

  it('制作shellに埋め込んだScreenではtop/bottom safe areaを二重に適用しない', () => {
    let renderer: ReturnType<typeof create>;
    act(() => { renderer = create(<EmbeddedScreenProvider><Screen title="Story">Content</Screen></EmbeddedScreenProvider>); });
    expect(renderer!.root.findByType('safe-area-view').props.edges).toEqual([]);
    act(() => renderer!.unmount());
  });

});
