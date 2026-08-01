import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { PanelOrderList } from '@/components/PanelOrderList';
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

  it('各コマの順序・役割・状況要約と三点メニューを同じ行に表示する', () => {
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
    expect(rendered).toContain('街の全景から物語が始まる');
    expect(renderer!.root.findByProps({ accessibilityLabel: '1コマ目の操作' })).toBeDefined();
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
