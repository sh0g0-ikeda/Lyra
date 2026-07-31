import React, { createRef } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

const page = {
  id: 'page-1',
  episode_id: episode.id,
  page_number: 1,
  layout_config: {},
  story_source_scene_ids: [],
  story_page_purpose: null,
  story_continuity_note: null,
  dialogue_mode: 'image_baked' as const,
  page_dialogue_toggle: true,
  generation_mode: null,
  generated_image: null,
  status: 'designing' as const,
  panel_count: 4,
  frame_count: 4,
  balloon_count: 0,
  created_at: timestamp,
  updated_at: timestamp,
};

const pageSkeletonJob = (
  status: 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled',
) => ({
  id: 'job-skeleton-1',
  job_type: 'episode_page_skeleton' as const,
  status,
  params: {
    episode_id: episode.id,
    overwrite_existing: false,
    apply_story_plan: false,
    language: 'ja' as const,
  },
  result: status === 'processing' ? {
    progress_stage: 'provider-private-stage',
    progress_message: 'provider internal detail',
    progress_current_chunk: 1,
    progress_total_chunks: 4,
  } : null,
  generation_mode: null,
  credit_cost: 0,
  error_message: status === 'failed' ? 'raw provider stack trace' : null,
  retry_count: 0,
  created_at: timestamp,
  started_at: status === 'queued' ? null : timestamp,
  completed_at: ['completed', 'failed', 'cancelled'].includes(status) ? timestamp : null,
  expires_at: null,
  cancel_requested_at: status === 'cancelled' ? timestamp : null,
  cancelled_at: status === 'cancelled' ? timestamp : null,
  commit_started_at: null,
});

const flushQueries = async (): Promise<void> => {
  for (let index = 0; index < 5; index += 1) {
    await Promise.resolve();
    if (vi.isFakeTimers()) {
      await vi.advanceTimersByTimeAsync(0);
    } else {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
};

describe('PagesScreen', () => {
  const mountedRenderers: ReactTestRenderer[] = [];
  const api = {
    createScene: vi.fn(),
    generatePageSkeleton: vi.fn(),
    getChapters: vi.fn(),
    getEpisodes: vi.fn(),
    getJob: vi.fn(),
    getJobs: vi.fn(),
    getPages: vi.fn(),
    getScenes: vi.fn(),
    getWorksPage: vi.fn(),
    updateScene: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    api.getWorksPage.mockResolvedValue({ works: [work], next_cursor: null });
    api.getChapters.mockResolvedValue({ chapters: [chapter] });
    api.getEpisodes.mockResolvedValue({ episodes: [episode] });
    api.getPages.mockResolvedValue({ pages: [] });
    api.getJobs.mockResolvedValue({ jobs: [], next_cursor: null });
    api.getJob.mockResolvedValue(pageSkeletonJob('processing'));
    api.getScenes.mockResolvedValue({ scenes: [scene('scene-1', 1, 'ローリストン・ガーデン')] });
    api.generatePageSkeleton.mockResolvedValue({
      job_id: pageSkeletonJob('queued').id,
      queued: true,
      story_plan_applied: false,
    });
    api.createScene.mockResolvedValue(scene('scene-2', 2, null));
    api.updateScene.mockImplementation(async (id: string, body: Record<string, unknown>) => ({
      ...scene(id, 1, 'ローリストン・ガーデン'),
      ...body,
    }));
  });

  afterEach(async () => {
    await act(async () => {
      for (const renderer of mountedRenderers.splice(0)) {
        renderer.unmount();
      }
    });
    vi.useRealTimers();
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
    mountedRenderers.push(renderer!);
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

  it('話を選ぶまでScene・Page・jobを取得せず0件を正常なempty stateとして扱う', async () => {
    api.getScenes.mockResolvedValue({ scenes: [] });
    const renderer = await renderScreen();
    expect(api.getScenes).not.toHaveBeenCalled();
    expect(api.getPages).not.toHaveBeenCalled();
    expect(api.getJobs).not.toHaveBeenCalled();

    await selectEpisode(renderer);

    expect(api.getScenes).toHaveBeenCalledWith(episode.id, null);
    expect(api.getPages).toHaveBeenCalledWith(episode.id, null);
    expect(api.getJobs).toHaveBeenCalledWith({ limit: 50 }, null);
    expect(JSON.stringify(renderer.toJSON())).toContain('シーンはまだありません');
    expect(JSON.stringify(renderer.toJSON())).toContain('ページはまだありません');
    expect(JSON.stringify(renderer.toJSON())).not.toContain('シーンを削除');
  });

  it('既存Pageを表示しMobileから上書き生成しない', async () => {
    api.getPages.mockResolvedValue({ pages: [page] });
    const renderer = await renderScreen();
    await selectEpisode(renderer);

    const tree = JSON.stringify(renderer.toJSON());
    expect(tree).toContain('ページ 1');
    expect(tree).toContain('4コマ');
    expect(tree).toContain('既存ページを保護');
    expect(renderer.root.findAllByProps({ label: 'ページ骨格を生成' })).toHaveLength(0);
    expect(api.generatePageSkeleton).not.toHaveBeenCalled();
  });

  it('Page一覧を取得できない場合は生成を止め再試行できる', async () => {
    api.getPages.mockRejectedValue(new Error('network'));
    const renderer = await renderScreen();
    await selectEpisode(renderer);

    expect(JSON.stringify(renderer.toJSON())).toContain('ページを読み込めませんでした');
    expect(renderer.root.findByProps({ label: 'ページ骨格を生成' }).props.disabled).toBe(true);
    await act(async () => {
      renderer.root.findByProps({ label: 'ページ一覧を再試行' }).props.onPress();
      await flushQueries();
    });
    expect(api.getPages).toHaveBeenCalledTimes(2);
  });

  it('dirty Sceneをcancelした場合は生成せずdiscardした場合だけ安全なbodyで生成する', async () => {
    const resolveDirtyAction = vi.fn().mockResolvedValueOnce('cancel').mockResolvedValueOnce('discard');
    const renderer = await renderScreen({ resolveDirtyAction });
    await selectEpisode(renderer);
    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: '場所' }).props.onChangeText('変更中');
    });

    await act(async () => {
      renderer.root.findByProps({ label: 'ページ骨格を生成' }).props.onPress();
      await flushQueries();
    });
    expect(api.generatePageSkeleton).not.toHaveBeenCalled();

    await act(async () => {
      renderer.root.findByProps({ label: 'ページ骨格を生成' }).props.onPress();
      await flushQueries();
    });
    expect(api.generatePageSkeleton).toHaveBeenCalledWith(episode.id, {
      apply_story_plan: false,
      language: 'ja',
      overwrite_existing: false,
    }, null);
    expect(renderer.root.findByProps({ accessibilityLabel: '場所' }).props.value).toBe('ローリストン・ガーデン');
  });

  it('dirty Sceneの保存に失敗した場合は骨格生成を開始しない', async () => {
    api.updateScene.mockRejectedValue(new Error('network'));
    const renderer = await renderScreen({
      resolveDirtyAction: vi.fn().mockResolvedValue('save'),
    });
    await selectEpisode(renderer);
    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: '場所' }).props.onChangeText('保存失敗の入力');
    });
    await act(async () => {
      renderer.root.findByProps({ label: 'ページ骨格を生成' }).props.onPress();
      await flushQueries();
    });

    expect(api.updateScene).toHaveBeenCalledOnce();
    expect(api.generatePageSkeleton).not.toHaveBeenCalled();
    expect(renderer.root.findByProps({ accessibilityLabel: '場所' }).props.value).toBe('保存失敗の入力');
  });

  it('queued jobは正確なIDだけを監視しactive中はScene変更と二重生成を止める', async () => {
    const renderer = await renderScreen();
    await selectEpisode(renderer);

    await act(async () => {
      const button = renderer.root.findByProps({ label: 'ページ骨格を生成' });
      button.props.onPress();
      button.props.onPress();
      await flushQueries();
    });

    expect(api.generatePageSkeleton).toHaveBeenCalledOnce();
    expect(api.getJob).toHaveBeenCalledWith(pageSkeletonJob('queued').id, null);
    expect(renderer.root.findByProps({ accessibilityLabel: '場所' }).props.editable).toBe(false);
    expect(renderer.root.findByProps({ label: 'シーンを追加' }).props.disabled).toBe(true);
    expect(renderer.root.findByProps({ label: 'ページ骨格を生成' }).props.disabled).toBe(true);
    const tree = JSON.stringify(renderer.toJSON());
    expect(tree).not.toContain('provider internal detail');
    expect(tree).not.toContain('ページ 1');
  });

  it('履歴から同じ話のactive jobを復元して正確なIDを監視する', async () => {
    api.getJobs.mockResolvedValue({ jobs: [pageSkeletonJob('processing')], next_cursor: null });
    const renderer = await renderScreen();
    await selectEpisode(renderer);

    expect(api.getJob).toHaveBeenCalledWith(pageSkeletonJob('processing').id, null);
    expect(renderer.root.findByProps({ accessibilityLabel: '場所' }).props.editable).toBe(false);
    expect(JSON.stringify(renderer.toJSON())).toContain('生成処理を実行しています');
  });

  it('Story AIのactive jobも同じ話のPage編集と骨格生成を止める', async () => {
    const storyJob = {
      ...pageSkeletonJob('processing'),
      job_type: 'episode_story_autofill' as const,
      params: { episode_id: episode.id, language: 'ja' as const },
    };
    api.getJobs.mockResolvedValue({ jobs: [storyJob], next_cursor: null });
    api.getJob.mockResolvedValue(storyJob);
    const renderer = await renderScreen();
    await selectEpisode(renderer);

    expect(renderer.root.findByProps({ accessibilityLabel: '場所' }).props.editable).toBe(false);
    expect(renderer.root.findByProps({ label: 'ページ骨格を生成' }).props.disabled).toBe(true);
    expect(api.generatePageSkeleton).not.toHaveBeenCalled();
  });

  it('表示後に他端末で開始されたactive jobを定期履歴更新で検出する', async () => {
    let externalStarted = false;
    api.getJobs.mockImplementation(async () => ({
      jobs: externalStarted ? [pageSkeletonJob('processing')] : [],
      next_cursor: null,
    }));
    api.getJob.mockResolvedValue(pageSkeletonJob('processing'));
    const renderer = await renderScreen({ jobPollIntervalMs: 10 });
    await selectEpisode(renderer);
    expect(renderer.root.findByProps({ accessibilityLabel: '場所' }).props.editable).toBe(true);
    externalStarted = true;

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      await flushQueries();
    });

    expect(api.getJobs.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(api.getJob).toHaveBeenCalledWith(pageSkeletonJob('processing').id, null);
    expect(renderer.root.findByProps({ accessibilityLabel: '場所' }).props.editable).toBe(false);
  });

  it('遅いjob履歴取得が続いても次のpollを重ねない', async () => {
    let resolveHistory: ((value: { jobs: never[]; next_cursor: null }) => void) | undefined;
    const pendingHistory = new Promise<{ jobs: never[]; next_cursor: null }>((resolve) => {
      resolveHistory = resolve;
    });
    api.getJobs
      .mockResolvedValueOnce({ jobs: [], next_cursor: null })
      .mockReturnValue(pendingHistory);
    const renderer = await renderScreen({ jobPollIntervalMs: 10 });
    await selectEpisode(renderer);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 35));
    });

    expect(api.getJobs).toHaveBeenCalledTimes(2);
    await act(async () => {
      resolveHistory?.({ jobs: [], next_cursor: null });
      await flushQueries();
    });
  });

  it('同期完了とjob完了ではPage・Episodeを再取得する', async () => {
    api.generatePageSkeleton.mockResolvedValueOnce({
      pages_created: 4,
      panels_created: 16,
      replaced_existing: false,
      story_plan_applied: false,
      story_plan_job_id: null,
    });
    const syncRenderer = await renderScreen();
    await selectEpisode(syncRenderer);
    const syncPagesCalls = api.getPages.mock.calls.length;
    const syncEpisodesCalls = api.getEpisodes.mock.calls.length;
    await act(async () => {
      syncRenderer.root.findByProps({ label: 'ページ骨格を生成' }).props.onPress();
      await flushQueries();
    });
    expect(api.getPages.mock.calls.length).toBeGreaterThan(syncPagesCalls);
    expect(api.getEpisodes.mock.calls.length).toBeGreaterThan(syncEpisodesCalls);
    expect(api.getJob).not.toHaveBeenCalled();

    vi.clearAllMocks();
    api.getWorksPage.mockResolvedValue({ works: [work], next_cursor: null });
    api.getChapters.mockResolvedValue({ chapters: [chapter] });
    api.getEpisodes.mockResolvedValue({ episodes: [episode] });
    api.getPages.mockResolvedValue({ pages: [] });
    api.getJobs.mockResolvedValue({ jobs: [], next_cursor: null });
    api.getScenes.mockResolvedValue({ scenes: [] });
    api.generatePageSkeleton.mockResolvedValue({
      job_id: pageSkeletonJob('queued').id,
      queued: true,
      story_plan_applied: false,
    });
    api.getJob.mockResolvedValue(pageSkeletonJob('completed'));
    const queuedRenderer = await renderScreen();
    await selectEpisode(queuedRenderer);
    const queuedPagesCalls = api.getPages.mock.calls.length;
    await act(async () => {
      queuedRenderer.root.findByProps({ label: 'ページ骨格を生成' }).props.onPress();
      await flushQueries();
    });
    expect(api.getPages.mock.calls.length).toBeGreaterThan(queuedPagesCalls);
    expect(JSON.stringify(queuedRenderer.toJSON())).toContain('ページ骨格を生成しました');
  });

  it('failed jobのraw errorを表示せず安定した案内を表示する', async () => {
    api.getJobs.mockResolvedValue({ jobs: [pageSkeletonJob('failed')], next_cursor: null });
    api.generatePageSkeleton.mockResolvedValue({
      job_id: pageSkeletonJob('queued').id,
      queued: true,
      story_plan_applied: false,
    });
    api.getJob.mockResolvedValue(pageSkeletonJob('failed'));
    const renderer = await renderScreen();
    await selectEpisode(renderer);
    await act(async () => {
      renderer.root.findByProps({ label: 'ページ骨格を生成' }).props.onPress();
      await flushQueries();
    });

    const tree = JSON.stringify(renderer.toJSON());
    expect(tree).toContain('ページ骨格を生成できませんでした');
    expect(tree).not.toContain('raw provider stack trace');
  });

  it('cancelled jobのraw errorを表示せず既存データ不変を案内する', async () => {
    api.getJob.mockResolvedValue({
      ...pageSkeletonJob('cancelled'),
      error_message: 'raw cancellation detail',
    });
    const renderer = await renderScreen();
    await selectEpisode(renderer);
    await act(async () => {
      renderer.root.findByProps({ label: 'ページ骨格を生成' }).props.onPress();
      await flushQueries();
    });

    const tree = JSON.stringify(renderer.toJSON());
    expect(tree).toContain('ページ骨格の生成はキャンセルされました');
    expect(tree).not.toContain('raw cancellation detail');
  });

  it('jobが404の場合はtrackingを解除してPage・Episodeを再取得する', async () => {
    api.getJob.mockRejectedValue(new ApiError('REQUEST_FAILED', 404, 'raw not found'));
    const renderer = await renderScreen();
    await selectEpisode(renderer);
    const pagesCalls = api.getPages.mock.calls.length;
    const episodesCalls = api.getEpisodes.mock.calls.length;
    await act(async () => {
      renderer.root.findByProps({ label: 'ページ骨格を生成' }).props.onPress();
      await flushQueries();
    });

    expect(api.getPages.mock.calls.length).toBeGreaterThan(pagesCalls);
    expect(api.getEpisodes.mock.calls.length).toBeGreaterThan(episodesCalls);
    expect(renderer.root.findByProps({ accessibilityLabel: '場所' }).props.editable).toBe(true);
    const tree = JSON.stringify(renderer.toJSON());
    expect(tree).toContain('生成状況を確認できませんでした');
    expect(tree).not.toContain('raw not found');
  });

  it('job監視の一時通信失敗ではlockと同じIDを保持して再試行する', async () => {
    api.getJob.mockRejectedValue(new ApiError('NETWORK_ERROR', 0, 'raw network'));
    const renderer = await renderScreen();
    await selectEpisode(renderer);
    await act(async () => {
      renderer.root.findByProps({ label: 'ページ骨格を生成' }).props.onPress();
      await flushQueries();
    });

    expect(renderer.root.findByProps({ accessibilityLabel: '場所' }).props.editable).toBe(false);
    expect(JSON.stringify(renderer.toJSON())).toContain('生成状況を確認できませんでした');
    api.getJob.mockResolvedValue(pageSkeletonJob('processing'));
    await act(async () => {
      renderer.root.findByProps({ label: '再試行' }).props.onPress();
      await flushQueries();
    });

    expect(api.getJob.mock.calls.every((call) => call[0] === pageSkeletonJob('processing').id)).toBe(true);
    expect(renderer.root.findByProps({ accessibilityLabel: '場所' }).props.editable).toBe(false);
    expect(JSON.stringify(renderer.toJSON())).not.toContain('raw network');
  });

  it('terminal到達後は単一jobのinterval pollingを停止する', async () => {
    let terminal = false;
    api.getJob.mockImplementation(async () => pageSkeletonJob(
      terminal ? 'completed' : 'processing',
    ));
    const renderer = await renderScreen({ jobPollIntervalMs: 10 });
    await selectEpisode(renderer);
    await act(async () => {
      renderer.root.findByProps({ label: 'ページ骨格を生成' }).props.onPress();
      await flushQueries();
    });
    terminal = true;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      await flushQueries();
    });
    const terminalCalls = api.getJob.mock.calls.length;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      await flushQueries();
    });

    expect(JSON.stringify(renderer.toJSON())).toContain('ページ骨格を生成しました');
    expect(api.getJob).toHaveBeenCalledTimes(terminalCalls);
  });

  it('遅い単一job取得が続いても次のpollを重ねない', async () => {
    const renderer = await renderScreen({ jobPollIntervalMs: 10 });
    await selectEpisode(renderer);
    await act(async () => {
      renderer.root.findByProps({ label: 'ページ骨格を生成' }).props.onPress();
      await flushQueries();
    });
    const callsBeforeSlowPoll = api.getJob.mock.calls.length;
    let resolveJob: ((value: ReturnType<typeof pageSkeletonJob>) => void) | undefined;
    const pendingJob = new Promise<ReturnType<typeof pageSkeletonJob>>((resolve) => {
      resolveJob = resolve;
    });
    api.getJob.mockReturnValue(pendingJob);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 35));
    });

    expect(api.getJob).toHaveBeenCalledTimes(callsBeforeSlowPoll + 1);
    await act(async () => {
      resolveJob?.(pageSkeletonJob('processing'));
      await flushQueries();
    });
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
