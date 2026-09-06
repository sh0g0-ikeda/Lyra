import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PanelEditorSections } from '@/components/PanelEditorSections';

const { platform, focus } = vi.hoisted(() => ({
  focus: vi.fn(),
  platform: { OS: 'ios' as 'ios' | 'android' }
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-native', () => ({
  AccessibilityInfo: { setAccessibilityFocus: focus },
  findNodeHandle: () => 71,
  KeyboardAvoidingView: 'keyboard-avoiding-view',
  Modal: ({ children, visible, ...props }: { children: React.ReactNode; visible: boolean }) => visible ? React.createElement('modal', props, children) : null,
  Platform: platform,
  Pressable: ({ children, onPress, ...props }: { children: React.ReactNode; onPress: () => void }) => React.createElement('button', { ...props, onClick: onPress }, children),
  ScrollView: 'scroll-view',
  StyleSheet: { create: (styles: unknown) => styles },
  Text: 'text',
  View: 'view'
}));

vi.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }: { children: React.ReactNode }) => React.createElement('safe-area-provider', null, children),
  SafeAreaView: ({ children, ...props }: { children: React.ReactNode }) => React.createElement('safe-area-view', props, children)
}));

vi.mock('lucide-react-native', () => ({
  ChevronRight: () => React.createElement('chevron-right')
}));

const sections = {
  characters: React.createElement('content', { testID: 'characters' }, 'characters-content'),
  compositionAndCamera: React.createElement('content', { testID: 'composition' }, 'composition-content'),
  dialogue: React.createElement('content', { testID: 'dialogue' }, 'dialogue-content'),
  effectsAndNotes: React.createElement('content', { testID: 'effects' }, 'effects-content'),
  situationAndBackground: React.createElement('content', { testID: 'situation' }, 'situation-content')
};

describe('PanelEditorSections', () => {
  beforeEach(() => {
    focus.mockClear();
    platform.OS = 'ios';
  });
  const render = (props: {
    disabled?: boolean;
    language?: 'ja' | 'en';
    panelId?: string | null;
    sections?: {
      characters: React.ReactElement;
      compositionAndCamera: React.ReactElement;
      dialogue: React.ReactElement;
      effectsAndNotes: React.ReactElement;
      situationAndBackground: React.ReactElement;
    };
  } = {}) => {
    let renderer: ReactTestRenderer;
    act(() => { renderer = create(<PanelEditorSections language="ja" panelId="panel-1" sections={sections} {...props} />); });
    return renderer!;
  };
  const button = (renderer: ReactTestRenderer, label: string) => renderer.root.findAllByType('button').find((candidate) => candidate.props.accessibilityLabel === label)!;

  it('5つの設定triggerを固定順で表示し、押した内容だけを1つのModalで開く', () => {
    const renderer = render();
    const rendered = JSON.stringify(renderer.toJSON());
    const labels = ['状況・背景を設定', '構図・カメラを設定', 'コマ内キャラクターを設定', 'セリフを設定', '効果・メモを設定'];
    labels.forEach((label) => expect(rendered).toContain(label));
    expect(rendered).not.toContain('situation-content');
    act(() => button(renderer, 'セリフを設定').props.onClick());
    expect(JSON.stringify(renderer.toJSON())).toContain('dialogue-content');
    expect(JSON.stringify(renderer.toJSON())).not.toContain('characters-content');
  });

  it('header close、back、accessibility escapeで閉じてtriggerへfocusを戻す', () => {
    const renderer = render();
    act(() => button(renderer, '状況・背景を設定').props.onClick());
    const modal = renderer.root.findByType('modal');
    const onDismiss = modal.props.onDismiss;
    act(() => modal.props.onShow());
    expect(focus).toHaveBeenCalledWith(71);
    focus.mockClear();
    act(() => renderer.root.findByType('safe-area-view').props.onAccessibilityEscape());
    act(() => onDismiss());
    expect(JSON.stringify(renderer.toJSON())).not.toContain('situation-content');
    expect(focus).toHaveBeenCalledWith(71);
    act(() => button(renderer, '状況・背景を設定').props.onClick());
    act(() => renderer.root.findByType('modal').props.onRequestClose());
    expect(JSON.stringify(renderer.toJSON())).not.toContain('situation-content');
  });

  it('panel scope変更とoperation lockでdialogを閉じ、triggerを無効にする', () => {
    const renderer = render();
    act(() => button(renderer, '構図・カメラを設定').props.onClick());
    act(() => renderer.update(<PanelEditorSections language="ja" panelId="panel-2" sections={sections} />));
    expect(JSON.stringify(renderer.toJSON())).not.toContain('composition-content');
    act(() => renderer.update(<PanelEditorSections disabled language="ja" panelId="panel-2" sections={sections} />));
    expect(button(renderer, '構図・カメラを設定').props.disabled).toBe(true);
  });

  it('panelIdがnullの新規コマでも設定を開ける', () => {
    const renderer = render({ panelId: null });
    act(() => button(renderer, '状況・背景を設定').props.onClick());
    expect(JSON.stringify(renderer.toJSON())).toContain('situation-content');
  });

  it('5つのtriggerはそれぞれ対応するcontentだけを開く', () => {
    const renderer = render();
    const cases: readonly (readonly [string, string])[] = [
      ['状況・背景を設定', 'situation-content'],
      ['構図・カメラを設定', 'composition-content'],
      ['コマ内キャラクターを設定', 'characters-content'],
      ['セリフを設定', 'dialogue-content'],
      ['効果・メモを設定', 'effects-content']
    ];
    for (const [label, content] of cases) {
      act(() => button(renderer, label).props.onClick());
      expect(renderer.root.findAllByType('content')).toHaveLength(1);
      expect(renderer.root.findByType('content').children).toEqual([content]);
      act(() => renderer.root.findByType('modal').props.onRequestClose());
    }
  });

  it('英語切替とcloseで親draftを保持し、modal内にsafe areaとkeyboard scrollを置く', () => {
    const draft = React.createElement('content', { testID: 'draft' }, 'draft-value');
    const renderer = render({ language: 'en', sections: { ...sections, dialogue: draft } });
    act(() => button(renderer, 'Edit Dialogue').props.onClick());
    expect(renderer.root.findByProps({ testID: 'draft' }).children).toEqual(['draft-value']);
    expect(renderer.root.findByType('safe-area-view').props.edges).toEqual(['top', 'right', 'bottom', 'left']);
    expect(renderer.root.findByType('keyboard-avoiding-view').props.behavior).toBe('padding');
    const scroll = renderer.root.findByType('scroll-view');
    expect(scroll.props.keyboardShouldPersistTaps).toBe('handled');
    expect(scroll.props.nestedScrollEnabled).toBe(true);
    expect(scroll.props.showsVerticalScrollIndicator).toBe(true);
    expect(scroll.props.indicatorStyle).toBe('white');
    expect(scroll.props.automaticallyAdjustKeyboardInsets).toBeUndefined();
    platform.OS = 'android';
    act(() => renderer.update(<PanelEditorSections language="en" panelId="panel-1" sections={{ ...sections, dialogue: draft }} />));
    expect(renderer.root.findByType('keyboard-avoiding-view').props.behavior).toBe('height');
    expect(renderer.root.findByType('scroll-view').props.keyboardDismissMode).toBe('on-drag');
  });

  it('親draftの入力はclose、reopen、language切替後も同じ値を使う', () => {
    function DraftHarness({ language }: { language: 'ja' | 'en' }): React.JSX.Element {
      const [value, setValue] = React.useState('下書き');
      return (
        <PanelEditorSections
          language={language}
          panelId="panel-1"
          sections={{
            ...sections,
            dialogue: React.createElement('draft-input', { onChangeText: setValue, value })
          }}
        />
      );
    }
    let renderer: ReactTestRenderer;
    act(() => { renderer = create(<DraftHarness language="ja" />); });
    act(() => button(renderer!, 'セリフを設定').props.onClick());
    act(() => renderer!.root.findByType('draft-input').props.onChangeText('未保存の入力'));
    act(() => renderer!.update(<DraftHarness language="en" />));
    expect(renderer!.root.findByType('draft-input').props.value).toBe('未保存の入力');
    expect(renderer!.root.findByProps({ accessibilityRole: 'header' }).children).toEqual(['Dialogue']);
    act(() => button(renderer!, 'Close').props.onClick());
    act(() => button(renderer!, 'Edit Dialogue').props.onClick());
    expect(renderer!.root.findByType('draft-input').props.value).toBe('未保存の入力');
  });

  it('操作ロックが解除された場合に閉じた設定が再表示されない', () => {
    const renderer = render({ panelId: null });
    act(() => button(renderer, '効果・メモを設定').props.onClick());
    expect(renderer.root.findAllByType('modal')).toHaveLength(1);
    act(() => renderer.update(<PanelEditorSections disabled language="ja" panelId={null} sections={sections} />));
    expect(renderer.root.findAllByType('modal')).toHaveLength(0);
    act(() => button(renderer, '効果・メモを設定').props.onClick());
    act(() => renderer.update(<PanelEditorSections language="ja" panelId={null} sections={sections} />));
    expect(renderer.root.findAllByType('modal')).toHaveLength(0);
  });

  it('iOSで閉じる途中に別設定を開いた場合に古いfocus復元が新画面を妨げない', () => {
    const renderer = render();
    act(() => button(renderer, '状況・背景を設定').props.onClick());
    const onDismiss = renderer.root.findByType('modal').props.onDismiss;
    act(() => button(renderer, '閉じる').props.onClick());
    expect(focus).not.toHaveBeenCalled();
    act(() => button(renderer, '効果・メモを設定').props.onClick());
    act(() => onDismiss());
    expect(focus).not.toHaveBeenCalled();
    expect(renderer.root.findByType('content').children).toEqual(['effects-content']);
  });

  it('Androidで戻る操作をした場合に設定を閉じて呼び出し元へfocusを戻す', () => {
    platform.OS = 'android';
    const renderer = render();
    act(() => button(renderer, '状況・背景を設定').props.onClick());
    act(() => renderer.root.findByType('modal').props.onRequestClose());
    expect(renderer.root.findAllByType('modal')).toHaveLength(0);
    expect(focus).toHaveBeenCalledWith(71);
  });
});
