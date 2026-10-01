import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { PanelOrderList } from '@/components/PanelOrderList';
import { colors } from '@/constants/theme';
import type { PanelRecord } from '@/domain/types';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-native', () => ({
  AccessibilityInfo: { setAccessibilityFocus: vi.fn() },
  findNodeHandle: () => null,
  Modal: ({ children, visible }: { children: React.ReactNode; visible: boolean }) =>
    visible ? React.createElement('modal', null, children) : null,
  Pressable: ({
    children,
    onPress,
    ...props
  }: {
    children: React.ReactNode | ((state: { pressed: boolean }) => React.ReactNode);
    onPress?: () => void;
  }) =>
    React.createElement(
      'button',
      { ...props, onClick: onPress },
      typeof children === 'function' ? children({ pressed: false }) : children
    ),
  ScrollView: 'scroll-view',
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'text',
  View: 'view'
}));

vi.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({children}: {children:React.ReactNode}) => React.createElement('safe-provider', null, children),
  SafeAreaView: ({children,...props}: {children:React.ReactNode;[key:string]:unknown}) => React.createElement('safe-area', props, children)
}));

vi.mock('lucide-react-native', () => {
  const icon = (name: string) => {
    const Icon = (props: Record<string, unknown>) => React.createElement(name, props);
    Icon.displayName = name;
    return Icon;
  };
  return {
    ArrowDown: icon('arrow-down'),
    ArrowUp: icon('arrow-up'),
    Check: icon('check'),
    MoreHorizontal: icon('more-horizontal'),
    Pencil: icon('pencil'),
    Trash2: icon('trash'),
    X: icon('x')
  };
});

const panel = (
  id: string,
  order: number,
  panelRole: PanelRecord['panel_role'],
  situationText: string
): PanelRecord => ({
  id,
  page_id: 'page-1',
  order,
  panel_role: panelRole,
  panel_size: 'standard',
  situation_text: situationText,
  entities: [],
  composition: {
    source: 'ai_auto',
    gallery_item_id: null,
    composition_prompt: null,
    shot_type: null,
    angle: null,
    custom_note: null
  },
  dialogue_in_panel: true,
  dialogue: [],
  sfx_text: null,
  background_note: null,
  panel_notes: null,
  created_at: '2026-07-01T00:00:00.000Z',
  updated_at: '2026-07-01T00:00:00.000Z'
});

describe('PanelOrderList', () => {
  const panels = [
    panel('panel-1', 1, 'establish', '街の全景から物語が始まる'),
    panel('panel-2', 2, 'action', '主人公が走り出す')
  ];

  it('各コマの順序・役割・選択と三点メニューだけを短い行に表示する', () => {
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        <PanelOrderList
          language="ja"
          onChangeRole={vi.fn()}
          onDelete={vi.fn()}
          onMove={vi.fn()}
          onSelect={vi.fn()}
          panels={panels}
          selectedPanelId="panel-1"
        />
      );
    });

    const rendered = JSON.stringify(renderer!.toJSON());
    expect(rendered).toContain('1コマ目');
    expect(rendered).toContain('導入');
    expect(rendered).not.toContain('街の全景から物語が始まる');
    expect(rendered).toContain('選択中');
    expect(renderer!.root.findByProps({ accessibilityLabel: '1コマ目の操作' })).toBeDefined();
  });

  it.each(['ja', 'en'] as const)('%sで選択中のコマ行だけを黄色背景にして文字と操作のコントラストを保つ', (language) => {
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        <PanelOrderList language={language} onChangeRole={vi.fn()} onDelete={vi.fn()}
          onMove={vi.fn()} onSelect={vi.fn()} panels={panels} selectedPanelId="panel-1" />
      );
    });
    const buttons = renderer!.root.findAllByType('button');
    const selected = buttons.find((button) => button.props.accessibilityState?.selected === true)!;
    const unselected = buttons.find((button) => button.props.accessibilityState?.selected === false)!;
    const flatten = (styles: unknown): Record<string, unknown> => Object.assign({}, ...[styles].flat().filter(Boolean));
    expect(flatten(selected.parent!.parent!.props.style).backgroundColor).toBe(colors.primary);
    expect(flatten(unselected.parent!.parent!.props.style).backgroundColor).not.toBe(colors.primary);
    for (const node of selected.findAllByType('text')) {
      expect([colors.primaryText, colors.primary]).toContain(flatten(node.props.style).color);
    }
    const selectedMenu = selected.parent!.parent!.findByType('more-horizontal');
    expect(selectedMenu.props.color).toBe(colors.primaryText);
    act(() => {
      renderer!.update(
        <PanelOrderList language={language} onChangeRole={vi.fn()} onDelete={vi.fn()}
          onMove={vi.fn()} onSelect={vi.fn()} panels={panels} selectedPanelId="panel-2" />
      );
    });
    const updatedButtons = renderer!.root.findAllByType('button');
    const nextSelected = updatedButtons.find((button) => button.props.accessibilityState?.selected === true)!;
    const previousSelected = updatedButtons.find((button) => button.props.accessibilityState?.selected === false)!;
    expect(flatten(nextSelected.parent!.parent!.props.style).backgroundColor).toBe(colors.primary);
    expect(flatten(previousSelected.parent!.parent!.props.style).backgroundColor).not.toBe(colors.primary);

  });

  it('三点メニューから境界を守って順序変更・役割変更・削除を実行する', () => {
    const onMove = vi.fn();
    const onChangeRole = vi.fn();
    const onDelete = vi.fn();
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        <PanelOrderList
          language="ja"
          onChangeRole={onChangeRole}
          onDelete={onDelete}
          onMove={onMove}
          onSelect={vi.fn()}
          panels={panels}
          selectedPanelId="panel-1"
        />
      );
    });

    const button = (accessibilityLabel: string) =>
      renderer!.root
        .findAllByType('button')
        .find((candidate) => candidate.props.accessibilityLabel === accessibilityLabel)!;

    act(() => button('1コマ目の操作').props.onClick());
    const movePrevious = button('1つ前へ移動');
    const moveNext = button('1つ後へ移動');
    expect(movePrevious.props.disabled).toBe(true);

    act(() => moveNext.props.onClick());
    expect(onMove).toHaveBeenCalledWith('panel-1', 'down');

    act(() => button('1コマ目の操作').props.onClick());
    act(() => button('役割を変更').props.onClick());
    act(() => button('反応').props.onClick());
    expect(onChangeRole).toHaveBeenCalledWith('panel-1', 'reaction');

    act(() => button('1コマ目の操作').props.onClick());
    act(() => button('コマを削除').props.onClick());
    expect(onDelete).toHaveBeenCalledWith(panels[0]);
  });
});


describe('コマ操作sheetのModal内safe area', () => {
  it('Modal内providerと全edgeを持ち固定headerとscroll操作で下部の削除へ到達できる', () => {
    let renderer:ReturnType<typeof create>;
    act(()=>{renderer=create(<PanelOrderList language="ja" panels={[panel('a',1,'action','')]} selectedPanelId="a" onSelect={vi.fn()} onDelete={vi.fn()} onMove={vi.fn()} onChangeRole={vi.fn()}/>);});
    act(()=>renderer!.root.findAllByType('button').find(node=>node.props.accessibilityLabel==='1コマ目の操作')!.props.onClick());
    const provider=renderer!.root.findByType('safe-provider');
    const safe=provider.findByType('safe-area');
    expect(safe.props.edges).toEqual(['top','right','bottom','left']);
    expect(safe.props.style.paddingBottom).toBeGreaterThanOrEqual(8);
    const scroll=safe.findByType('scroll-view');
    expect(scroll.findByProps({accessibilityLabel:'コマを削除'})).toBeDefined();
    expect(scroll.findAllByProps({accessibilityLabel:'閉じる'})).toHaveLength(0);
  });
});
