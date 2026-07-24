import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { PageThumbnailPicker } from '@/components/PageThumbnailPicker';
import type { PageRecord } from '@/domain/types';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-native', () => ({
  FlatList: ({
    data,
    renderItem,
    ...props
  }: {
    data: PageRecord[];
    renderItem: (input: { item: PageRecord }) => React.ReactNode;
  }) => React.createElement('flat-list', props, data.map((item) => renderItem({ item }))),
  Platform: { OS: 'android' },
  Pressable: ({
    children,
    onPress,
    ...props
  }: {
    children: React.ReactNode;
    onPress?: () => void;
  }) => React.createElement('button', { ...props, onClick: onPress }, children),
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'text',
  View: 'view'
}));

vi.mock('expo-image', () => ({
  Image: (props: Record<string, unknown>) => React.createElement('expo-image', props)
}));

const page = (id: string, pageNumber: number, generated: boolean): PageRecord => ({
  id,
  episode_id: 'episode-1',
  page_number: pageNumber,
  layout_config: {},
  story_source_scene_ids: [],
  story_page_purpose: null,
  story_continuity_note: null,
  dialogue_mode: 'image_baked',
  page_dialogue_toggle: true,
  generation_mode: generated ? 'standard' : null,
  generated_image: generated
    ? {
        cdn_url: `https://cdn.lyra.test/${id}.png`,
        generation_mode: 'standard',
        generated_at: '2026-07-25T00:00:00.000Z'
      }
    : null,
  status: generated ? 'generated' : 'designing',
  panel_count: 4,
  frame_count: 4,
  balloon_count: 0,
  created_at: '2026-07-25T00:00:00.000Z',
  updated_at: '2026-07-25T00:00:00.000Z'
});

describe('PageThumbnailPicker', () => {
  it('FlatListで固定寸法のページサムネイルと状態を表示する', () => {
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        <PageThumbnailPicker
          emptyLabel="ページなし"
          imageSourceFor={(item) => ({ uri: item.generated_image?.cdn_url ?? '' })}
          language="ja"
          onSelect={vi.fn()}
          pages={[page('page-1', 1, true), page('page-2', 2, false)]}
          selectedId="page-1"
          statusLabelFor={(status) => status}
        />
      );
    });

    const list = renderer!.root.findByType('flat-list');
    expect(list.props.horizontal).toBe(true);
    expect(list.props.initialNumToRender).toBeLessThanOrEqual(8);
    expect(renderer!.root.findAllByType('expo-image')).toHaveLength(1);
    expect(JSON.stringify(renderer!.toJSON())).toContain('1ページ');
    expect(JSON.stringify(renderer!.toJSON())).toContain('designing');
  });

  it('選択したページIDを返す', () => {
    const onSelect = vi.fn();
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        <PageThumbnailPicker
          emptyLabel="No pages"
          imageSourceFor={() => ({ uri: 'https://cdn.lyra.test/page.png' })}
          language="en"
          onSelect={onSelect}
          pages={[page('page-1', 1, true)]}
          selectedId={null}
          statusLabelFor={(status) => status}
        />
      );
    });

    act(() => {
      renderer!.root.findByProps({ accessibilityLabel: 'Page 1, generated' }).props.onPress();
    });
    expect(onSelect).toHaveBeenCalledWith('page-1');
  });

  it('一覧末尾で次のページを一度だけ要求できる', () => {
    const onEndReached = vi.fn();
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        <PageThumbnailPicker
          emptyLabel="No pages"
          hasNextPage
          imageSourceFor={() => null}
          isFetchingNextPage={false}
          language="en"
          onEndReached={onEndReached}
          onSelect={vi.fn()}
          pages={[page('page-1', 1, false)]}
          selectedId={null}
          statusLabelFor={(status) => status}
        />,
      );
    });

    act(() => {
      renderer!.root.findByType('flat-list').props.onEndReached();
    });
    expect(onEndReached).toHaveBeenCalledTimes(1);
  });
});
