import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { PanelEditorSections } from '@/components/PanelEditorSections';

vi.mock('react-native', () => ({
  Pressable: ({
    children,
    onPress,
    ...props
  }: {
    children: React.ReactNode;
    onPress: () => void;
  }) => React.createElement('button', { ...props, onClick: onPress }, children),
  StyleSheet: {
    create: <T,>(styles: T): T => styles,
    hairlineWidth: 1
  },
  Text: 'text',
  View: 'view'
}));

vi.mock('lucide-react-native', () => ({
  ChevronDown: () => React.createElement('chevron-down'),
  ChevronUp: () => React.createElement('chevron-up')
}));

const sections = {
  characters: React.createElement('content', null, 'characters-content'),
  compositionAndCamera: React.createElement('content', null, 'composition-content'),
  dialogue: React.createElement('content', null, 'dialogue-content'),
  effectsAndNotes: React.createElement('content', null, 'effects-content'),
  situationAndBackground: React.createElement('content', null, 'situation-content')
};

describe('PanelEditorSections', () => {
  it('必須の5区分を固定順で表示し空欄入力の案内を出す', () => {
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(<PanelEditorSections language="ja" sections={sections} />);
    });

    const rendered = JSON.stringify(renderer!.toJSON());
    const titles = [
      '状況・背景',
      '構図・カメラ',
      'コマ内キャラクター',
      'セリフ',
      '効果・メモ'
    ];
    expect(rendered).toContain('すべての空欄を埋める必要はありません');
    for (let index = 0; index < titles.length - 1; index += 1) {
      expect(rendered.indexOf(titles[index]!)).toBeLessThan(
        rendered.indexOf(titles[index + 1]!)
      );
    }
  });

  it('各区分を見出しから展開・折りたたみできる', () => {
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(<PanelEditorSections language="ja" sections={sections} />);
    });
    expect(JSON.stringify(renderer!.toJSON())).not.toContain('composition-content');

    const compositionToggle = renderer!.root
      .findAllByType('button')
      .find((button) => button.props.accessibilityLabel === '構図・カメラを展開');
    expect(compositionToggle).toBeDefined();
    act(() => compositionToggle!.props.onClick());
    expect(JSON.stringify(renderer!.toJSON())).toContain('composition-content');
  });
});
