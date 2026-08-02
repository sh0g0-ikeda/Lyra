import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { StoryGenerationControls } from '@/components/StoryGenerationControls';

vi.mock('react-native', () => ({
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'text',
  View: 'view'
}));

vi.mock('@/components/Notice', () => ({
  Notice: ({ message }: { message: string }) => React.createElement('notice', null, message)
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
  }) => React.createElement('button', { disabled, onClick: onPress }, label)
}));

const renderControls = (overrides: Partial<React.ComponentProps<typeof StoryGenerationControls>> = {}) => {
  let renderer: ReturnType<typeof create>;
  act(() => {
    renderer = create(
      <StoryGenerationControls
        canGenerate
        estimatedPagesInvalid={false}
        jobEnqueued={false}
        language="ja"
        onApplyStory={vi.fn()}
        onGenerateSkeleton={vi.fn()}
        overwrite={false}
        pagesLoading={false}
        selectedEpisode
        {...overrides}
      />
    );
  });
  return renderer!;
};

describe('StoryGenerationControls', () => {
  it('初回と既存ページありで骨格生成ラベルを明確に切り替える', () => {
    expect(JSON.stringify(renderControls().toJSON())).toContain('ページ骨格を生成');
    expect(JSON.stringify(renderControls({ overwrite: true }).toJSON())).toContain(
      'ページ骨格を上書き再生成'
    );
  });

  it('ページ設計の二段階を説明し、それぞれを別の操作として表示する', () => {
    const rendered = JSON.stringify(renderControls().toJSON());
    expect(rendered).toContain('入力したストーリーをコマへ反映する2段階の操作です。');
    expect(rendered).toContain('1. ページ骨格を上書き再生成');
    expect(rendered).toContain('ページとコマの配分・全体の流れを組み立てます。');
    expect(rendered).toContain('2. ストーリーから設定を自動入力');
    expect(rendered).toContain('各コマの登場人物・状況・構図・セリフを自動入力します。');
    expect(rendered).toContain('ページ骨格を生成');
    expect(rendered).toContain('ストーリーから設定を自動入力');
    expect(rendered).toContain('20分程度かかる可能性があります');
  });

  it('enqueue直後は開始だけを表示しauthoritative完了前に完了と表示しない', () => {
    const rendered = JSON.stringify(renderControls({ jobEnqueued: true }).toJSON());
    expect(rendered).toContain('処理を開始しました');
    expect(rendered).not.toContain('完了しました');
  });

  it('話単位の設計ジョブ進行中は両方の操作を無効化する', () => {
    const buttons = renderControls({ hasActiveJob: true }).root.findAllByType('button');

    expect(buttons).toHaveLength(2);
    expect(buttons.every((button) => button.props.disabled === true)).toBe(true);
  });

  it('どちらかの受付処理中はもう一方も含めて操作を無効化する', () => {
    const buttons = renderControls({ skeletonLoading: true }).root.findAllByType('button');

    expect(buttons.every((button) => button.props.disabled === true)).toBe(true);
  });
});
