import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FormField } from '@/components/FormField';
import { Notice } from '@/components/Notice';
import { PageSceneAutofillAction } from '@/components/PageSceneAutofillAction';
import { PrimaryButton } from '@/components/PrimaryButton';
import { RecordPicker } from '@/components/RecordPicker';
import { Screen } from '@/components/Screen';
import { Section } from '@/components/Section';
import { StoryCollaborationPanel } from '@/components/StoryCollaborationPanel';
import { composite, contrastRatio, parseColor, renderedColors, renderedContrast, renderedStyle } from './helpers/renderedContrast';

// U19 / design/05 §§1,7: measure actual rendered text and essential input
// boundaries over their ancestors, including alpha and pressed-state opacity.
// These local color checks do not certify device rendering, scaling or WCAG.
// Disabled controls are not text-contrast acceptance targets; active help is.
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock('react-native', () => ({
  AccessibilityInfo: { setAccessibilityFocus: vi.fn() }, findNodeHandle: () => null,
  ActivityIndicator: 'spinner', FlatList: 'flat-list', KeyboardAvoidingView: 'keyboard-avoiding-view',
  Modal: ({ visible, children }: { visible: boolean; children: React.ReactNode }) => visible ? React.createElement('modal', null, children) : null,
  Platform: { OS: 'android' }, Pressable: 'pressable', RefreshControl: 'refresh-control',
  ScrollView: 'scroll-view', StatusBar: 'status-bar', Text: 'text', TextInput: 'input', View: 'view',
  StyleSheet: { create: <T,>(styles: T): T => styles }
}));
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'safe-area-view' }));
vi.mock('@/state/appState', () => ({ useOptionalAppState: () => ({ session: null }) }));
vi.mock('@/state/networkStatus', () => ({ useNetworkStatus: () => ({ language: 'en', online: true, setLanguage: vi.fn() }) }));
vi.mock('@/components/CreditBalanceBadge', () => ({ CreditBalanceBadge: () => null }));
vi.mock('@/components/AiContentReportButton', () => ({ AiContentReportButton: () => null }));
vi.mock('@/lib/storage', () => ({ loadSectionCollapsed: vi.fn(), saveSectionCollapsed: vi.fn() }));

const renderers: ReactTestRenderer[] = [];
function render(children: React.ReactNode, tone: 'default' | 'highlight' | 'subtle' = 'default'): ReactTestRenderer {
  let renderer!: ReactTestRenderer;
  act(() => { renderer = create(<Screen title="Story"><Section title="Details" tone={tone}>{children}</Section></Screen>); });
  renderers.push(renderer);
  return renderer;
}
function textNode(renderer: ReactTestRenderer, value: string): ReactTestInstance {
  return renderer.root.findAllByType('text').find((node) => node.children.join('') === value)!;
}
function inputBoundary(input: ReactTestInstance): void {
  const border = renderedStyle(input.props.style).borderColor;
  expect(typeof border).toBe('string');
  const pixels = renderedColors(input, border as string);
  expect(contrastRatio(pixels.foreground, pixels.background)).toBeGreaterThanOrEqual(3);
  const outside = renderedColors(input.parent!, '#FFFFFF').background;
  expect(contrastRatio(pixels.foreground, outside)).toBeGreaterThanOrEqual(3);
}
afterEach(() => {
  for (const renderer of renderers.splice(0)) act(() => renderer.unmount());
});

describe('dark UI の局所コントラスト', () => {
  it('既知の白黒・灰色と半透明の場合にsRGB式を検証する', () => {
    expect(contrastRatio(parseColor('#FFFFFF'), parseColor('#000000'))).toBe(21);
    expect(contrastRatio(parseColor('#777777'), parseColor('#FFFFFF'))).toBeCloseTo(4.478, 3);
    const gray = composite(parseColor('rgba(255, 255, 255, 0.5)'), parseColor('#000000'));
    expect(gray).toEqual({ red: 127.5, green: 127.5, blue: 127.5, alpha: 1 });
    expect(contrastRatio(gray, parseColor('#000000'))).toBeCloseTo(5.281, 3);
  });

  it('親opacityがある場合に文字だけでなく背景も合成する', () => {
    let renderer!: ReactTestRenderer;
    act(() => { renderer = create(React.createElement('view', { style: { backgroundColor: '#000000' } },
      React.createElement('view', { style: { backgroundColor: '#FFFFFF', opacity: 0.5 } },
        React.createElement('text', { style: { color: '#000000' } }, 'Alpha')))); });
    renderers.push(renderer);
    expect(renderedContrast(textNode(renderer, 'Alpha'))).toBeCloseTo(5.281, 3);
  });

  it.each(['default', 'highlight', 'subtle'] as const)('%s sectionの場合に入力help・counter・labelが4.5:1以上になる', (tone) => {
    const renderer = render(<FormField label="Title" help="Writing help" helpDisclosureLabel="Hints" maxLength={200} onChangeText={vi.fn()} value="" />, tone);
    act(() => renderer.root.findAllByType('pressable').find((node) => node.props.accessibilityLabel === 'Hints')!.props.onPress());
    for (const value of ['Title', 'Writing help', 'Hints', '0/200']) {
      expect(renderedContrast(textNode(renderer, value)), value).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each([false, true])('focus=%sの場合に有効placeholderが4.5:1以上で入力境界が3:1以上になる', (focused) => {
    const renderer = render(<FormField label="Title" onChangeText={vi.fn()} placeholder="A short example" value="" />);
    const input = renderer.root.findByType('input');
    if (focused) act(() => input.props.onFocus());
    expect(input.props.editable).toBe(true);
    expect(renderedContrast(input, input.props.placeholderTextColor)).toBeGreaterThanOrEqual(4.5);
    expect(renderedContrast(input)).toBeGreaterThanOrEqual(4.5);
    inputBoundary(input);
  });

  it('選択listを開いた場合に検索placeholderと入力境界が読める', () => {
    const renderer = render(<RecordPicker emptyLabel="Choose" items={[{ id: 'one' }]} labelForItem={(item) => item.id} language="en" onSelect={vi.fn()} selectedId={null} />);
    act(() => renderer.root.findAllByType('pressable').find((node) => node.props.accessibilityLabel === 'Choose')!.props.onPress());
    const input = renderer.root.findByType('input');
    expect(renderedContrast(input, input.props.placeholderTextColor)).toBeGreaterThanOrEqual(4.5);
    inputBoundary(input);
  });

  it('本文AIとシーン反映の操作が有効な場合に説明文が4.5:1以上になる', () => {
    const renderer = render(<>
      <StoryCollaborationPanel canEdit error={null} instruction="A suggestion" language="en" loading={false} onApply={vi.fn()} onCancel={vi.fn()} onInstructionChange={vi.fn()} onRequest={vi.fn()} proposal="" selectedEpisode />
      <PageSceneAutofillAction canEdit hasActiveJob={false} isEditableDraft language="en" loading={false} onPress={vi.fn()} pageNumber={1} sourceSceneLabels={['Scene 1']} />
    </>);
    for (const component of [StoryCollaborationPanel, PageSceneAutofillAction]) {
      const description = renderer.root.findByType(component).findAllByType('text')[0];
      expect(renderedContrast(description)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each(['primary', 'secondary', 'ghost', 'danger'] as const)('%s buttonの場合に通常・押下labelが4.5:1以上になる', (variant) => {
    const renderer = render(<PrimaryButton label="Continue" onPress={vi.fn()} variant={variant} />);
    const label = textNode(renderer, 'Continue');
    for (const pressed of [false, true]) expect(renderedContrast(label, undefined, pressed)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(['info', 'warning', 'danger', 'success'] as const)('%s noticeの場合に本文と通常・押下actionが4.5:1以上になる', (tone) => {
    const renderer = render(<Notice message="Status" actionLabel="Retry" onAction={vi.fn()} tone={tone} />);
    expect(renderedContrast(textNode(renderer, 'Status'))).toBeGreaterThanOrEqual(4.5);
    for (const pressed of [false, true]) expect(renderedContrast(textNode(renderer, 'Retry'), undefined, pressed)).toBeGreaterThanOrEqual(4.5);
  });
});
