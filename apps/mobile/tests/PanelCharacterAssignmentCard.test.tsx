import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { PanelCharacterAssignmentCard } from '@/components/PanelCharacterAssignmentCard';

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
    create: <T,>(styles: T): T => styles
  },
  Text: 'text',
  View: 'view'
}));

vi.mock('lucide-react-native', () => ({
  ChevronDown: () => React.createElement('chevron-down'),
  ChevronUp: () => React.createElement('chevron-up')
}));

describe('PanelCharacterAssignmentCard', () => {
  it('折りたたみ時はキャラ名と役割・位置・表情の要約だけを表示する', () => {
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        <PanelCharacterAssignmentCard
          disabled={false}
          expanded={false}
          name="ユナ"
          onRemove={vi.fn()}
          onToggle={vi.fn()}
          removeLabel="このキャラを外す"
          summary="主役・中央・決意"
          toggleLabel="ユナの設定を展開"
        >
          <content>assignment-details</content>
        </PanelCharacterAssignmentCard>
      );
    });

    const rendered = JSON.stringify(renderer!.toJSON());
    expect(rendered).toContain('ユナ');
    expect(rendered).toContain('主役・中央・決意');
    expect(rendered).not.toContain('assignment-details');
    expect(rendered).not.toContain('このキャラを外す');
  });

  it('見出しは展開状態を通知し44pt以上の押下領域で切り替える', () => {
    const onToggle = vi.fn();
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        <PanelCharacterAssignmentCard
          disabled={false}
          expanded
          name="ユナ"
          onRemove={vi.fn()}
          onToggle={onToggle}
          removeLabel="このキャラを外す"
          summary="主役・中央・決意"
          toggleLabel="ユナの設定を折りたたむ"
        >
          <content>assignment-details</content>
        </PanelCharacterAssignmentCard>
      );
    });

    const toggle = renderer!.root
      .findAllByType('button')
      .find((button) => button.props.accessibilityLabel === 'ユナの設定を折りたたむ');
    expect(toggle).toBeDefined();
    expect(toggle!.props.accessibilityState).toEqual({ expanded: true });
    expect(toggle!.props.style.minHeight).toBeGreaterThanOrEqual(44);
    act(() => toggle!.props.onClick());
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(renderer!.toJSON())).toContain('assignment-details');
  });

  it('展開時だけ削除操作を表示し、無効状態を尊重する', () => {
    const onRemove = vi.fn();
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        <PanelCharacterAssignmentCard
          disabled
          expanded
          name="ユナ"
          onRemove={onRemove}
          onToggle={vi.fn()}
          removeLabel="このキャラを外す"
          summary="主役・中央・決意"
          toggleLabel="ユナの設定を折りたたむ"
        >
          <content>assignment-details</content>
        </PanelCharacterAssignmentCard>
      );
    });

    const remove = renderer!.root
      .findAllByType('button')
      .find((button) => button.props.accessibilityLabel === 'このキャラを外す');
    expect(remove).toBeDefined();
    expect(remove!.props.accessibilityState).toEqual({ disabled: true });
    expect(remove!.props.disabled).toBe(true);
  });
});
