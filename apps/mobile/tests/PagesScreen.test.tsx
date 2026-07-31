import React, { createRef } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PagesScreen,
  type PagesScreenHandle,
} from '../src/screens/PagesScreen';
import { ApiError } from '../src/lib/api';

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
  }) => React.createElement('input', {
    ...props,
    onChange: onChangeText,
    onChangeText,
  }),
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

const timestamp = '2026-07-31T00:00:00.000Z';

const work = {
  id: 'work-1',
  organization_id: null,
  title: '緋色の研究',
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
};

const chapter = {
  id: 'chapter-1',
  work_id: work.id,
  order: 1,
  title: '第一章',
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
};

const episode = {
  id: 'episode-1',
  chapter_id: chapter.id,
  order: 1,
  title: '第一話',
  purpose: null,
  story_input_mode: 'full' as const,
  story_full_draft: '本文',
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
};

const scene = (id: string, order: number, location: string | null) => ({
  id,
  episode_id: episode.id,
  order,
  location,
  time: null,
  atmosphere: null,
  involved_entity_ids: [],
  entity_states: [],
  status: 'draft' as const,
  created_at: timestamp,
  updated_at: timestamp,
});

const flushQueries = async (): Promise<void> => {
  for (let index = 0; index < 5; index += 1) {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

describe('PagesScreen', () => {
  const api = {
    createScene: vi.fn(),
    getChapters: vi.fn(),
    getEpisodes: vi.fn(),
    getScenes: vi.fn(),
    getWorksPage: vi.fn(),
    updateScene: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    api.getWorksPage.mockResolvedValue({ works: [work], next_cursor: null });
    api.getChapters.mockResolvedValue({ chapters: [chapter] });
    api.getEpisodes.mockResolvedValue({ episodes: [episode] });
    api.getScenes.mockResolvedValue({ scenes: [scene('scene-1', 1, 'ローリストン・ガーデン')] });
    api.createScene.mockResolvedValue(scene('scene-2', 2, null));
    api.updateScene.mockImplementation(async (id: string, body: Record<string, unknown>) => ({
      ...scene(id, 1, 'ローリストン・ガーデン'),
      ...body,
    }));
  });

  const renderScreen = async (
    overrides: Partial<React.ComponentProps<typeof PagesScreen>> = {},
  ): Promise<ReactTestRenderer> => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    let renderer: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <QueryClientProvider client={queryClient}>
          <PagesScreen
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

  const selectEpisode = async (renderer: ReactTestRenderer): Promise<void> => {
    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: '緋色の研究を選択' }).props.onPress();
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
      renderer.root.findByProps({ accessibilityLabel: '第一話を選択' }).props.onPress();
      await Promise.resolve();
    });
    await act(async () => {
      await flushQueries();
    });
  };

  it('話を選ぶまでSceneを取得せず0件を正常なempty stateとして扱う', async () => {
    api.getScenes.mockResolvedValue({ scenes: [] });
    const renderer = await renderScreen();
    expect(api.getScenes).not.toHaveBeenCalled();

    await selectEpisode(renderer);

    expect(api.getScenes).toHaveBeenCalledWith(episode.id, null);
    expect(JSON.stringify(renderer.toJSON())).toContain('シーンはまだありません');
    expect(JSON.stringify(renderer.toJSON())).not.toContain('シーンを削除');
  });

  it('最大orderの次に空Sceneを作り成功後だけ選択する', async () => {
    const renderer = await renderScreen();
    await selectEpisode(renderer);

    await act(async () => {
      renderer.root.findByProps({ label: 'シーンを追加' }).props.onPress();
      await Promise.resolve();
    });
    await act(async () => {
      await flushQueries();
    });

    expect(api.createScene).toHaveBeenCalledWith(episode.id, {
      atmosphere: null,
      location: null,
      order: 2,
      time: null,
    }, null);
    expect(JSON.stringify(renderer.toJSON())).toContain('シーン 2');
  });

  it('422後に最大orderが増えた場合だけ一度再試行する', async () => {
    api.getScenes
      .mockResolvedValueOnce({ scenes: [scene('scene-1', 1, '現場')] })
      .mockResolvedValueOnce({
        scenes: [scene('scene-1', 1, '現場'), scene('scene-2', 2, '同時追加')],
      });
    api.createScene
      .mockRejectedValueOnce(new ApiError('REQUEST_FAILED', 422, 'failed'))
      .mockResolvedValueOnce(scene('scene-3', 3, null));
    const renderer = await renderScreen();
    await selectEpisode(renderer);

    await act(async () => {
      renderer.root.findByProps({ label: 'シーンを追加' }).props.onPress();
      await Promise.resolve();
    });
    await act(async () => {
      await flushQueries();
    });

    expect(api.createScene).toHaveBeenCalledTimes(2);
    expect(api.createScene.mock.calls[1]?.[1]).toMatchObject({ order: 3 });
  });

  it('422後も最大orderが変わらない場合は一般validationとして再試行しない', async () => {
    api.getScenes.mockResolvedValue({ scenes: [scene('scene-1', 1, '現場')] });
    api.createScene.mockRejectedValue(new ApiError('REQUEST_FAILED', 422, 'failed'));
    const renderer = await renderScreen();
    await selectEpisode(renderer);

    await act(async () => {
      renderer.root.findByProps({ label: 'シーンを追加' }).props.onPress();
      await Promise.resolve();
    });
    await act(async () => {
      await flushQueries();
    });

    expect(api.createScene).toHaveBeenCalledOnce();
    expect(JSON.stringify(renderer.toJSON())).toContain('既存データと入力内容は変更されていません');
  });

  it('シーン追加を連打してもmutationを一度だけ実行する', async () => {
    let resolveCreate: ((value: ReturnType<typeof scene>) => void) | undefined;
    api.createScene.mockReturnValue(new Promise((resolve) => {
      resolveCreate = resolve;
    }));
    const renderer = await renderScreen();
    await selectEpisode(renderer);
    const addButton = renderer.root.findByProps({ label: 'シーンを追加' });

    await act(async () => {
      addButton.props.onPress();
      addButton.props.onPress();
      await Promise.resolve();
    });
    expect(api.createScene).toHaveBeenCalledOnce();

    await act(async () => {
      resolveCreate?.(scene('scene-2', 2, null));
      await flushQueries();
    });
  });

  it('保存失敗時はScene draftと選択を保持する', async () => {
    api.updateScene.mockRejectedValue(new Error('network'));
    const renderer = await renderScreen();
    await selectEpisode(renderer);

    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: '場所' }).props.onChangeText('ベーカー街');
    });
    await act(async () => {
      renderer.root.findByProps({ label: 'シーンを保存' }).props.onPress();
      await Promise.resolve();
    });
    await act(async () => {
      await flushQueries();
    });

    expect(renderer.root.findByProps({ accessibilityLabel: '場所' }).props.value).toBe('ベーカー街');
    expect(JSON.stringify(renderer.toJSON())).toContain('入力内容は保持されています');
    expect(renderer.root.findByProps({ accessibilityLabel: 'シーン 1 - ローリストン・ガーデンを選択' }).props.accessibilityState).toEqual({ selected: true });
  });

  it('dirty Sceneの切替でcancelとdiscardを区別し画面離脱でも確認する', async () => {
    api.getScenes.mockResolvedValue({
      scenes: [scene('scene-1', 1, '現場'), scene('scene-2', 2, 'ベーカー街')],
    });
    const resolveDirtyAction = vi.fn().mockResolvedValueOnce('cancel').mockResolvedValueOnce('discard');
    const ref = createRef<PagesScreenHandle>();
    const renderer = await renderScreen({ ref, resolveDirtyAction });
    await selectEpisode(renderer);

    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: '場所' }).props.onChangeText('変更中');
    });
    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: 'シーン 2 - ベーカー街を選択' }).props.onPress();
      await Promise.resolve();
    });
    await act(async () => {
      await flushQueries();
    });
    expect(renderer.root.findByProps({ accessibilityLabel: '場所' }).props.value).toBe('変更中');

    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: 'シーン 2 - ベーカー街を選択' }).props.onPress();
      await Promise.resolve();
    });
    await act(async () => {
      await flushQueries();
    });
    expect(renderer.root.findByProps({ accessibilityLabel: '場所' }).props.value).toBe('ベーカー街');

    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: '場所' }).props.onChangeText('未保存');
    });
    resolveDirtyAction.mockResolvedValueOnce('cancel');
    await expect(ref.current?.prepareToLeave()).resolves.toBe(false);
  });
});
