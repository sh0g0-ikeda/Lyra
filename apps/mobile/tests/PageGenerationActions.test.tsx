import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { PageGenerationActions } from '@/components/PageGenerationActions';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-native', () => ({
  StyleSheet: { create: <T,>(styles: T): T => styles },
  View: 'view'
}));

vi.mock('@/components/PrimaryButton', () => ({
  PrimaryButton: ({
    disabled,
    label,
    onPress
  }: {
    disabled?: boolean;
    label: string;
    onPress: () => void;
  }) => React.createElement(
    'button',
    { disabled, onClick: disabled ? undefined : onPress },
    label,
  )
}));

const renderActions = (
  confirmed: boolean,
  callbacks: {
    onConfirm?: () => void;
    onGenerate?: () => void;
    onReopen?: () => void;
  } = {},
): ReturnType<typeof create> => {
  let renderer: ReturnType<typeof create>;
  act(() => {
    renderer = create(
      <PageGenerationActions
        canConfirm
        confirmDisabledReason={undefined}
        confirmed={confirmed}
        confirmLoading={false}
        generateDisabled={confirmed}
        generateDisabledReason={confirmed ? '再編集してください' : undefined}
        generateLoading={false}
        language="ja"
        onConfirm={callbacks.onConfirm ?? vi.fn()}
        onGenerate={callbacks.onGenerate ?? vi.fn()}
        onReopen={callbacks.onReopen ?? vi.fn()}
        reopenLoading={false}
      />
    );
  });
  return renderer!;
};

const labels = (confirmed: boolean): string[] => {
  return renderActions(confirmed).root
    .findAllByType('button')
    .map((node) => String(node.children[0]));
};

describe('PageGenerationActions', () => {
  it('初回生成と生成済み更新で共通のページ生成操作を表示する', () => {
    expect(labels(false)).toEqual(['ページ生成', 'ページ確定']);
  });

  it('確定済みページではページ生成の隣に再編集を表示する', () => {
    expect(labels(true)).toEqual(['ページ生成', '再編集']);
  });

  it('確定済みページでは生成を無効化して再編集だけを実行できる', () => {
    const onGenerate = vi.fn();
    const onReopen = vi.fn();
    const renderer = renderActions(true, { onGenerate, onReopen });
    const [generateButton, reopenButton] = renderer.root.findAllByType('button');

    expect(generateButton?.props.disabled).toBe(true);
    expect(generateButton?.props.onClick).toBeUndefined();
    act(() => reopenButton?.props.onClick());
    expect(onGenerate).not.toHaveBeenCalled();
    expect(onReopen).toHaveBeenCalledOnce();
  });

  it('編集中ページではページ生成とページ確定をそれぞれ実行する', () => {
    const onConfirm = vi.fn();
    const onGenerate = vi.fn();
    const renderer = renderActions(false, { onConfirm, onGenerate });
    const [generateButton, confirmButton] = renderer.root.findAllByType('button');

    act(() => generateButton?.props.onClick());
    act(() => confirmButton?.props.onClick());
    expect(onGenerate).toHaveBeenCalledOnce();
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});
