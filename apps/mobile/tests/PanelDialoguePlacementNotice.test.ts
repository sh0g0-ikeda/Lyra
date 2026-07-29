import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { PanelDialoguePlacementNotice } from '@/components/PanelDialoguePlacementNotice';

vi.mock('react-native', () => ({
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'Text',
  View: 'View'
}));

vi.mock('@/components/Notice', () => ({
  Notice: ({ message }: { message: string }) => React.createElement('notice', null, message)
}));

vi.mock('@/components/PrimaryButton', () => ({
  PrimaryButton: ({ label, onPress }: { label: string; onPress: () => void }) =>
    React.createElement('button', { onClick: onPress }, label)
}));

describe('PanelDialoguePlacementNotice', () => {
  it('画像内セリフはMobile初回配布で固定され選択肢を表示しない', () => {
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        React.createElement(PanelDialoguePlacementNotice, {
          dialogueInPanel: true,
          language: 'ja',
          onOpenWeb: vi.fn()
        })
      );
    });
    const rendered = JSON.stringify(renderer!.toJSON());

    expect(rendered).toContain('セリフは画像内に含めます');
    expect(rendered).not.toContain('画像外');
    expect(renderer!.root.findAllByType('button')).toHaveLength(0);
  });

  it('既存の画像外セリフを変換せずread-only warningとWeb導線を表示する', () => {
    const onOpenWeb = vi.fn();
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        React.createElement(PanelDialoguePlacementNotice, {
          dialogueInPanel: false,
          language: 'ja',
          onOpenWeb
        })
      );
    });
    const rendered = JSON.stringify(renderer!.toJSON());
    const button = renderer!.root.findByType('button');

    expect(rendered).toContain('既存の画像外セリフ設定');
    expect(rendered).toContain('自動では変更しません');
    expect(button.children).toEqual(['Web版で編集']);
    act(() => button.props.onClick());
    expect(onOpenWeb).toHaveBeenCalledTimes(1);
  });
});
