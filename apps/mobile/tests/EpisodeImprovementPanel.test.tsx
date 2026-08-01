import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { EpisodeImprovementPanel } from '@/components/EpisodeImprovementPanel';
import type { StoryEpisodeImprovementRecord } from '@/domain/types';

vi.mock('react-native', () => ({
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'text',
  View: 'view'
}));

vi.mock('@/components/FormField', () => ({
  FormField: ({ label, value }: { label: string; value: string }) =>
    React.createElement('field', { value }, label)
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

const improvement: StoryEpisodeImprovementRecord = {
  compiler_error: null,
  compiler_model: 'model',
  compiler_prompt_version: 'v1',
  compiler_provider: 'openai',
  draft: {
    climax: null,
    ending_hook: null,
    introduction: null,
    middle: null,
    purpose: 'UIから反映してはいけない目的',
    story_full_draft: '改善後の本文',
    story_input_mode: 'full',
    title: 'UIから反映してはいけない題名'
  }
};

describe('EpisodeImprovementPanel', () => {
  it('改善と全体本文への反映を別ボタンにしtitle/purpose反映操作を出さない', () => {
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        <EpisodeImprovementPanel
          canEdit
          improvement={improvement}
          instruction="テンポを改善"
          language="ja"
          onApply={vi.fn()}
          onImprove={vi.fn()}
          onImprovementChange={vi.fn()}
          onInstructionChange={vi.fn()}
          selectedEpisode
        />
      );
    });

    const rendered = JSON.stringify(renderer!.toJSON());
    expect(rendered).toContain('話を改善');
    expect(rendered).toContain('改善案を本文へ反映');
    expect(rendered).not.toContain('題名を反映');
    expect(rendered).not.toContain('目的を反映');
  });

  it('反映後も改善案を表示し追加改善できる操作を保つ', () => {
    const onImprove = vi.fn();
    const onApply = vi.fn();
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        <EpisodeImprovementPanel
          canEdit
          improvement={improvement}
          instruction="さらに改善"
          language="ja"
          onApply={onApply}
          onImprove={onImprove}
          onImprovementChange={vi.fn()}
          onInstructionChange={vi.fn()}
          selectedEpisode
        />
      );
    });

    const buttons = renderer!.root.findAllByType('button');
    act(() => buttons.find((button) => button.children.includes('改善案を本文へ反映'))!.props.onClick());
    act(() => buttons.find((button) => button.children.includes('話を改善'))!.props.onClick());
    expect(onApply).toHaveBeenCalledOnce();
    expect(onImprove).toHaveBeenCalledOnce();
    expect(JSON.stringify(renderer!.toJSON())).toContain('改善後の本文');
  });
});
