import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { ConfirmedPageSummary } from '@/components/ConfirmedPageSummary';
import type { PageRecord } from '@/domain/types';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-native', () => ({
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'text',
  View: 'view'
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

const page: PageRecord = {
  id: 'page-1',
  episode_id: 'episode-1',
  page_number: 3,
  layout_config: {},
  story_source_scene_ids: ['scene-1'],
  story_page_purpose: '主人公の決意を見せる',
  story_continuity_note: '前ページの夜から継続',
  dialogue_mode: 'image_baked',
  page_dialogue_toggle: true,
  generation_mode: 'standard',
  generated_image: {
    cdn_url: 'https://cdn.lyra.test/page.png',
    generation_mode: 'standard',
    generated_at: '2026-07-25T00:00:00.000Z'
  },
  status: 'confirmed',
  panel_count: 4,
  frame_count: 4,
  balloon_count: 2,
  created_at: '2026-07-25T00:00:00.000Z',
  updated_at: '2026-07-25T00:00:00.000Z'
};

describe('ConfirmedPageSummary', () => {
  it('確定ページを編集フォームではなく要約として表示する', () => {
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        <ConfirmedPageSummary
          language="ja"
          page={page}
          sourceSceneLabels={['場面1 夜の駅']}
        />
      );
    });

    const output = JSON.stringify(renderer!.toJSON());
    expect(output).toContain('確定済みページ');
    expect(output).toContain('3ページ');
    expect(output).toContain('場面1 夜の駅');
    expect(output).toContain('主人公の決意を見せる');
    expect(output).toContain('コマ 4 / 枠 4 / セリフ 2');
    expect(output).toContain('編集・ページ生成するには下書きに戻してください');
    expect(renderer!.root.findAllByType('button')).toHaveLength(0);
  });
});
