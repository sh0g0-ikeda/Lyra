import React, { createRef } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  StoryScreen,
  type StoryScreenHandle,
} from '../src/screens/StoryScreen';

vi.mock('react-native', () => ({
  Alert: { alert: vi.fn() },
  ActivityIndicator: 'activity-indicator',
  Pressable: ({
    children,
    onPress,
    ...props
  }: {
    children: React.ReactNode | ((state: { pressed: boolean }) => React.ReactNode);
    onPress?: () => void;
  }) => React.createElement(
    'button',
    { ...props, onClick: onPress },
    typeof children === 'function' ? children({ pressed: false }) : children,
  ),
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'text',
  TextInput: ({
    onChangeText,
    ...props
  }: {
    onChangeText: (value: string) => void;
  }) => React.createElement('input', { ...props, onChange: onChangeText }),
  View: 'view',
}));

vi.mock('../src/components/LoadingState', () => ({
  LoadingState: ({ label }: { label: string }) => React.createElement('loading', null, label),
}));

vi.mock('../src/components/Notice', () => ({
  Notice: ({ message, tone }: { message: string; tone?: string }) =>
    React.createElement('notice', { tone }, message),
}));

vi.mock('../src/components/PrimaryButton', () => ({
  PrimaryButton: ({
    disabled,
    label,
    loading,
    onPress,
  }: {
    disabled?: boolean;
    label: string;
    loading?: boolean;
    onPress: () => void;
  }) => React.createElement(
    'button',
    { disabled: disabled || loading, onClick: onPress },
    label,
  ),
}));

const timestamp = '2026-07-01T00:00:00.000Z';

const work = (id: string, title: string) => ({
  id,
  organization_id: null,
  title,
  genre: null,
  world_setting: null,
  theme: null,
  main_entity_ids: [],
  starting_point: null,
  ending_point: null,
  overall_flow: null,
  version: 1,
  status: 'draft' as const,
  created_at: timestamp,
  updated_at: timestamp,
});

const chapter = (id: string, workId: string, title: string) => ({
  id,
  work_id: workId,
  order: 1,
  title,
  purpose: null,
  starting_state: null,
  ending_state: null,
  emotion_curve: null,
  entities_involved: [],
  key_beats: [],
  version: 1,
  status: 'draft' as const,
  created_at: timestamp,
  updated_at: timestamp,
});

const episode = (id: string, chapterId: string, title: string, story = '本文') => ({
  id,
  chapter_id: chapterId,
  order: id === 'episode-1' ? 1 : 2,
  title,
  purpose: null,
  story_input_mode: 'full' as const,
  story_full_draft: story,
  introduction: null,
  middle: null,
  climax: null,
  ending_hook: null,
  estimated_pages: 4,
  entities_involved: [],
  page_skeleton_generated: false,
  version: 1,
  status: 'draft' as const,
  created_at: timestamp,
  updated_at: timestamp,
});

const flushQueries = async (): Promise<void> => {
  for (let index = 0; index < 4; index += 1) {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

function textOf(renderer: ReactTestRenderer): string {
  return JSON.stringify(renderer.toJSON());
}

describe('StoryScreen', () => {
  const api = {
    getWorksPage: vi.fn(),
    getChapters: vi.fn(),
    getEpisodes: vi.fn(),
    updateEpisode: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    api.getWorksPage.mockResolvedValue({
      works: [work('work-1', '作品A')],
      next_cursor: null,
    });
    api.getChapters.mockResolvedValue({
      chapters: [chapter('chapter-1', 'work-1', '第一章')],
    });
    api.getEpisodes.mockResolvedValue({
      episodes: [
        episode('episode-1', 'chapter-1', '第一話'),
        episode('episode-2', 'chapter-1', '第二話', '別の本文'),
      ],
    });
    api.updateEpisode.mockImplementation(async (_id: string, body: Record<string, unknown>) => ({
      ...episode('episode-1', 'chapter-1', String(body.title ?? '第一話')),
      story_full_draft: body.story_full_draft ?? '本文',
      estimated_pages: body.estimated_pages ?? 4,
    }));
  });

  const renderScreen = async (overrides: Partial<React.ComponentProps<typeof StoryScreen>> = {}) => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    let renderer: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <QueryClientProvider client={queryClient}>
          <StoryScreen
            api={api}
            language="ja"
            organizationId={null}
            sessionKey="session-1"
            {...overrides}
          />
        </QueryClientProvider>,
      );
    });
    await act(async () => {
      await flushQueries();
    });
    return renderer!;
  };

  const selectEpisode = async (renderer: ReactTestRenderer, label = '第一話を選択') => {
    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: '作品Aを選択' }).props.onPress();
      await Promise.resolve();
    });
    await act(async () => {
      await flushQueries();
    });
    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: '第一章を選択' }).props.onPress();
      await Promise.resolve();
    });
    await act(async () => {
      await flushQueries();
    });
    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: label }).props.onPress();
    });
  };

  it('作品0件は正常なempty stateだけを表示する', async () => {
    api.getWorksPage.mockResolvedValue({ works: [], next_cursor: null });
    const renderer = await renderScreen();

    expect(textOf(renderer)).toContain('作品はまだありません。');
    expect(renderer.root.findAllByType('notice').some(
      (notice) => notice.props.tone === 'danger',
    )).toBe(false);
  });

  it('作品取得の実エラーだけを表示し、再取得成功後は古いエラーを消す', async () => {
    api.getWorksPage
      .mockRejectedValueOnce(new Error('network detail'))
      .mockResolvedValueOnce({ works: [], next_cursor: null });
    const renderer = await renderScreen();

    expect(textOf(renderer)).toContain('作品を読み込めませんでした。');
    expect(textOf(renderer)).not.toContain('作品はまだありません。');
    expect(textOf(renderer)).not.toContain('network detail');

    const retry = renderer.root
      .findAllByType('button')
      .find((button) => button.children.join('') === '再試行');
    await act(async () => {
      retry?.props.onClick();
    });
    await act(async () => {
      await flushQueries();
    });

    expect(textOf(renderer)).toContain('作品はまだありません。');
    expect(renderer.root.findAllByType('notice').some(
      (notice) => notice.props.tone === 'danger',
    )).toBe(false);
  });

  it('話を選んで編集し、既存APIへ最小payloadで保存する', async () => {
    const renderer = await renderScreen();
    await selectEpisode(renderer);

    const storyInput = renderer.root.findByProps({ accessibilityLabel: 'ストーリー本文' });
    await act(async () => {
      storyInput.props.onChangeText('更新した本文');
    });
    const save = renderer.root
      .findAllByType('button')
      .find((button) => button.children.join('') === '保存');
    await act(async () => {
      save?.props.onClick();
      await flushQueries();
    });

    expect(api.updateEpisode).toHaveBeenCalledWith(
      'episode-1',
      {
        title: '第一話',
        story_input_mode: 'full',
        story_full_draft: '更新した本文',
        estimated_pages: 4,
      },
      null,
    );
    expect(textOf(renderer)).toContain('保存しました。');
  });

  it('保存UIをStory AI案内より前に配置する', async () => {
    const renderer = await renderScreen();
    await selectEpisode(renderer);
    const rendered = textOf(renderer);

    expect(rendered.indexOf('保存')).toBeGreaterThan(-1);
    expect(rendered.indexOf('保存')).toBeLessThan(rendered.indexOf('Story AI'));
  });

  it('dirtyな話切替をキャンセルした場合はdraftと選択を保持する', async () => {
    const resolveDirtyAction = vi.fn().mockResolvedValue('cancel');
    const renderer = await renderScreen({ resolveDirtyAction });
    await selectEpisode(renderer);
    await act(async () => {
      renderer.root
        .findByProps({ accessibilityLabel: 'ストーリー本文' })
        .props.onChangeText('未保存の本文');
    });
    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: '第二話を選択' }).props.onPress();
      await flushQueries();
    });

    expect(resolveDirtyAction).toHaveBeenCalledOnce();
    expect(renderer.root.findByProps({ accessibilityLabel: 'ストーリー本文' }).props.value)
      .toBe('未保存の本文');
    expect(api.updateEpisode).not.toHaveBeenCalled();
  });

  it('dirtyな話切替で破棄を選んだ場合は保存せず次の話へ移る', async () => {
    const resolveDirtyAction = vi.fn().mockResolvedValue('discard');
    const renderer = await renderScreen({ resolveDirtyAction });
    await selectEpisode(renderer);
    await act(async () => {
      renderer.root
        .findByProps({ accessibilityLabel: 'ストーリー本文' })
        .props.onChangeText('破棄する本文');
    });
    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: '第二話を選択' }).props.onPress();
      await Promise.resolve();
    });

    expect(api.updateEpisode).not.toHaveBeenCalled();
    expect(renderer.root.findByProps({ accessibilityLabel: 'ストーリー本文' }).props.value)
      .toBe('別の本文');
  });

  it('dirtyな話切替で保存を選んだ場合は保存成功後だけ次の話へ移る', async () => {
    const resolveDirtyAction = vi.fn().mockResolvedValue('save');
    const renderer = await renderScreen({ resolveDirtyAction });
    await selectEpisode(renderer);
    await act(async () => {
      renderer.root
        .findByProps({ accessibilityLabel: 'ストーリー本文' })
        .props.onChangeText('保存する本文');
    });
    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: '第二話を選択' }).props.onPress();
      await flushQueries();
    });

    expect(api.updateEpisode).toHaveBeenCalledOnce();
    expect(renderer.root.findByProps({ accessibilityLabel: 'ストーリー本文' }).props.value)
      .toBe('別の本文');
  });

  it('保存処理中の話切替は同じ保存完了を待ち、二重保存や古い話への巻き戻りを起こさない', async () => {
    let resolveUpdate: ((value: ReturnType<typeof episode>) => void) | undefined;
    api.updateEpisode.mockReturnValue(new Promise((resolve) => {
      resolveUpdate = resolve;
    }));
    const resolveDirtyAction = vi.fn().mockResolvedValue('discard');
    const renderer = await renderScreen({ resolveDirtyAction });
    await selectEpisode(renderer);
    await act(async () => {
      renderer.root
        .findByProps({ accessibilityLabel: 'ストーリー本文' })
        .props.onChangeText('保存待ちの本文');
    });
    const save = renderer.root
      .findAllByType('button')
      .find((button) => button.children.join('') === '保存');
    await act(async () => {
      save?.props.onClick();
      await Promise.resolve();
    });
    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: '第二話を選択' }).props.onPress();
      await Promise.resolve();
    });

    expect(api.updateEpisode).toHaveBeenCalledOnce();
    resolveUpdate?.({
      ...episode('episode-1', 'chapter-1', '第一話', '保存待ちの本文'),
    });
    await act(async () => {
      await flushQueries();
    });

    expect(resolveDirtyAction).not.toHaveBeenCalled();
    expect(renderer.root.findByProps({ accessibilityLabel: 'ストーリー本文' }).props.value)
      .toBe('別の本文');
  });

  it('保存失敗ではdraftを保持し、画面離脱を止める', async () => {
    api.updateEpisode.mockRejectedValue(new Error('provider detail'));
    const resolveDirtyAction = vi.fn().mockResolvedValue('save');
    const ref = createRef<StoryScreenHandle>();
    const renderer = await renderScreen({ ref, resolveDirtyAction });
    await selectEpisode(renderer);
    await act(async () => {
      renderer.root
        .findByProps({ accessibilityLabel: 'ストーリー本文' })
        .props.onChangeText('消してはいけない下書き');
    });

    let canLeave = true;
    await act(async () => {
      canLeave = await ref.current!.prepareToLeave();
      await flushQueries();
    });

    expect(canLeave).toBe(false);
    expect(renderer.root.findByProps({ accessibilityLabel: 'ストーリー本文' }).props.value)
      .toBe('消してはいけない下書き');
    expect(textOf(renderer)).toContain('保存できませんでした。入力内容は保持されています。');
    expect(textOf(renderer)).not.toContain('provider detail');
  });
});
