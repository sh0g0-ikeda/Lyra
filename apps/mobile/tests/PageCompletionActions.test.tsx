import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import {
  PageCompletionActions,
  PageConfirmationAction,
  PageGenerationStartActions
} from '@/components/PageCompletionActions';

vi.mock('react-native', () => ({ View: 'view', StyleSheet: { create: <T,>(styles: T): T => styles } }));
vi.mock('@/components/PrimaryButton', () => ({ PrimaryButton: (props: Record<string, unknown>) => React.createElement('button', props) }));

const labels = (): string[] => {
  let renderer: ReturnType<typeof create>;
  act(() => {
    renderer = create(
      <PageCompletionActions
        exportSection={React.createElement('section', { label: 'export' })}
        generationSection={React.createElement('section', { label: 'generation' })}
      />
    );
  });
  return renderer!.root.findAllByType('section').map((node) => node.props.label as string);
};

describe('PageCompletionActions', () => {
  it('ページ状態にかかわらず生成の後に書き出しを表示する', () => {
    expect(labels()).toEqual(['generation', 'export']);
  });

  it('画像生成とページ確定を別の配置へ分けても既存actionを保つ', () => {
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(<>
        <PageGenerationStartActions canGenerate language="ja" onGenerate={() => undefined} onGenerateMonochrome={() => undefined} />
        <PageConfirmationAction canConfirm confirmed={false} language="ja" onConfirm={() => undefined} onReopen={() => undefined} />
      </>);
    });
    expect(renderer!.root.findAllByType('button').map((node) => node.props.testID)).toEqual([
      'page-generation-action',
      'page-monochrome-generation-action',
      'page-confirm-action'
    ]);
  });
});
