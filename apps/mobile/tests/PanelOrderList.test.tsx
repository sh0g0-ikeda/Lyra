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

const safeAreaInsetsMock = { bottom: 0, left: 0, right: 0, top: 0 };

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => safeAreaInsetsMock
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

  it.each(['ja', 'en'] as const)('%sで選択コマが変わる場合に黄色の背景と読める文字・アイコンが選択行だけへ移る', (language) => {
    const onSelect = vi.fn();
    const props = { language, onChangeRole: vi.fn(), onDelete: vi.fn(), onMove: vi.fn(), onSelect, panels };
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(<PanelOrderList {...props} selectedPanelId="panel-1" />);
    });

    const assertSelection = (selectedIndex: number): void => {
      const rows = renderer!.root.findAllByType('view').filter((node) =>
        Array.isArray(node.props.style) && node.props.style[0]?.minHeight === 56
      );
      expect(rows).toHaveLength(2);
      rows.forEach((row, index) => {
        const selected = index === selectedIndex;
        const rowStyle = Object.assign({}, ...row.props.style.filter(Boolean));
        expect(rowStyle.backgroundColor).toBe(selected ? colors.primary : colors.field);
        const button = row.findAllByType('button')[0];
        expect(button.props.accessibilityState.selected).toBe(selected);
        const labels = row.findAllByType('text').slice(1);
        labels.forEach((label, labelIndex) => {
          const style = Object.assign({}, ...[label.props.style].flat().filter(Boolean));
          expect(style.color).toBe(selected ? colors.primaryText : labelIndex === 0 ? colors.inkStrong : colors.primary);
        });
        expect(row.findByType('more-horizontal').props.color).toBe(selected ? colors.primaryText : colors.ink);
      });
    };

    assertSelection(0);
    act(() => renderer!.root.findAllByType('button')[2].props.onClick());
    expect(onSelect).toHaveBeenCalledWith('panel-2');
    act(() => renderer!.update(<PanelOrderList {...props} selectedPanelId="panel-2" />));
    assertSelection(1);
    act(() => renderer!.unmount());
  });

  it('各コマを状況説明なしのコンパクトな選択行として表示する', () => {
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
    expect(renderer!.root.findByProps({ accessibilityLabel: '1コマ目の操作' })).toBeDefined();
    const editPanel = renderer!.root.findByProps({ accessibilityLabel: '1コマ目を編集' });
    expect(editPanel.props.style.minHeight).toBeGreaterThanOrEqual(44);
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

  it('選択したコマの直後へ追加する操作を表示して無効理由を支援技術へ渡す', () => {
    const onInsertAfter = vi.fn();
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        <PanelOrderList
          insertAfterDisabledReason="ページを保存してから追加してください"
          language="en"
          onChangeRole={vi.fn()}
          onDelete={vi.fn()}
          onInsertAfter={onInsertAfter}
          onMove={vi.fn()}
          onSelect={vi.fn()}
          panels={panels}
          selectedPanelId="panel-1"
        />
      );
    });

    act(() => renderer!.root.findAllByType('button').find((candidate) => candidate.props.accessibilityLabel === 'Panel 1 actions')!.props.onClick());
    const insert = renderer!.root.findAllByType('button').find((candidate) => candidate.props.accessibilityLabel === 'Add a panel after this')!;
    expect(insert.props.disabled).toBe(true);
    expect(insert.props.accessibilityHint).toBe('ページを保存してから追加してください');

    act(() => {
      renderer!.update(
        <PanelOrderList
          language="en"
          onChangeRole={vi.fn()}
          onDelete={vi.fn()}
          onInsertAfter={onInsertAfter}
          onMove={vi.fn()}
          onSelect={vi.fn()}
          panels={panels}
          selectedPanelId="panel-1"
        />
      );
    });
    act(() => renderer!.root.findAllByType('button').find((candidate) => candidate.props.accessibilityLabel === 'Add a panel after this')!.props.onClick());
    expect(onInsertAfter).toHaveBeenCalledWith('panel-1');
  });

  it.each([
    ['insetなし', 0],
    ['Androidジェスチャー', 16],
    ['Android3ボタン', 48],
    ['iOSホームインジケータ', 34]
  ])('削除を含むアクションシートに%sの下部安全領域を加算する', (_device, bottom) => {
    safeAreaInsetsMock.bottom = bottom;
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        <PanelOrderList language="ja" onChangeRole={vi.fn()} onDelete={vi.fn()} onMove={vi.fn()} onSelect={vi.fn()} panels={panels} selectedPanelId="panel-1" />
      );
    });
    act(() => renderer!.root.findAllByType('button').find((candidate) => candidate.props.accessibilityLabel === '1コマ目の操作')!.props.onClick());
    const actionList = renderer!.root.findAllByType('view').find((node) => {
      const styles = Array.isArray(node.props.style) ? node.props.style : [node.props.style];
      return styles.some((style) => style?.paddingBottom === bottom + 8);
    });
    expect(actionList).toBeDefined();
    const remove = renderer!.root.findAllByType('button').find((candidate) => candidate.props.accessibilityLabel === 'コマを削除')!;
    const removeStyles = Array.isArray(remove.props.style) ? remove.props.style : [remove.props.style];
    expect(removeStyles.some((style) => style?.minHeight >= 44)).toBe(true);
  });
});
