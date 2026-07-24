import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { StoryGenerationControls } from '@/components/StoryGenerationControls';

vi.mock('react-native', () => ({
  StyleSheet: { create: <T,>(styles: T): T => styles },
  View: 'view'
}));

vi.mock('@/components/Notice', () => ({
  Notice: ({ message }: { message: string }) => React.createElement('notice', null, message)
}));

vi.mock('@/components/PrimaryButton', () => ({
  PrimaryButton: ({
    label,
    onPress
  }: {
    label: string;
    onPress: () => void;
  }) => React.createElement('button', { onClick: onPress }, label)
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

  it('ページ骨格生成と話全体反映を別の操作として表示する', () => {
    const rendered = JSON.stringify(renderControls().toJSON());
    expect(rendered).toContain('ページ骨格を生成');
    expect(rendered).toContain('話全体を反映');
  });

  it('enqueue直後は開始だけを表示しauthoritative完了前に完了と表示しない', () => {
    const rendered = JSON.stringify(renderControls({ jobEnqueued: true }).toJSON());
    expect(rendered).toContain('処理を開始しました');
    expect(rendered).not.toContain('完了しました');
  });
});
