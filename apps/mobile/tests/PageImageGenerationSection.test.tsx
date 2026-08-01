import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  hasActivePageImageJobForPages,
  PageImageGenerationSection,
} from '../src/components/PageImageGenerationSection';
import {
  ApiError,
  type GenerationJobRecord,
  type PageRecord,
} from '../src/lib/api';

vi.mock('react-native', () => ({
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

vi.mock('../src/components/ResilientAuthenticatedImage', () => ({
  ResilientAuthenticatedImage: (props: {
    identity: string;
    onExhausted(): void;
    protectedSource: unknown;
    publicSource: unknown;
  }) => React.createElement('page-image', props),
}));

const episodeId = '11111111-1111-4111-8111-111111111111';
const pageId = '22222222-2222-4222-8222-222222222222';
const otherPageId = '33333333-3333-4333-8333-333333333333';
const jobId = '44444444-4444-4444-8444-444444444444';
const organizationId = '55555555-5555-4555-8555-555555555555';
const timestamp = '2026-08-01T00:00:00.000Z';

describe('PageImageGenerationSection', () => {
  const mounted: ReactTestRenderer[] = [];
  const api = {
    generatePage: vi.fn(),
    getJob: vi.fn(),
    getJobs: vi.fn(),
    refreshImageAuthorizationHeader: vi.fn(),
  };

  beforeEach(() => {
    vi.resetAllMocks();
    api.generatePage.mockResolvedValue({ job_id: jobId });
    api.getJob.mockResolvedValue(buildPageJob('processing'));
    api.getJobs.mockResolvedValue({ jobs: [], next_cursor: null });
    api.refreshImageAuthorizationHeader.mockResolvedValue('Bearer refreshed-token');
  });

  afterEach(async () => {
    await act(async () => {
      for (const renderer of mounted.splice(0)) {
        renderer.unmount();
      }
    });
  });

  async function renderSection({
    externalOperationActive = false,
    onOperationActiveChange = vi.fn(),
    page = buildPage(),
    prepareForGeneration = vi.fn().mockResolvedValue(page),
    refreshPages = vi.fn().mockResolvedValue([page]),
  }: {
    externalOperationActive?: boolean;
    onOperationActiveChange?: (operationId: string, active: boolean) => void;
    page?: PageRecord;
    prepareForGeneration?: (targetPageId: string) => Promise<PageRecord | null>;
    refreshPages?: () => Promise<readonly PageRecord[]>;
  } = {}): Promise<{
    onOperationActiveChange: (operationId: string, active: boolean) => void;
    prepareForGeneration: (targetPageId: string) => Promise<PageRecord | null>;
    queryClient: QueryClient;
    refreshPages: () => Promise<readonly PageRecord[]>;
    renderer: ReactTestRenderer;
  }> {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let renderer: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <QueryClientProvider client={queryClient}>
          <PageImageGenerationSection
            api={api}
            episodeId={episodeId}
            externalOperationActive={externalOperationActive}
            imageApiBaseUrl="https://api.example.com"
            imageAuthorizationHeader="Bearer id-token"
            jobPollIntervalMs={10}
            language="ja"
            onOperationActiveChange={onOperationActiveChange}
            organizationId={organizationId}
            pageListReady
            pages={[page]}
            prepareForGeneration={prepareForGeneration}
            refreshPages={refreshPages}
            sessionKey="session-user"
          />
        </QueryClientProvider>,
      );
    });
    await act(flushQueries);
    mounted.push(renderer!);
    return {
      onOperationActiveChange,
      prepareForGeneration,
      queryClient,
      refreshPages,
      renderer: renderer!,
    };
  }

  it('保存済みPageを選び3クレジット以上を明示してexact jobを1件だけ開始する', async () => {
    const prepareForGeneration = vi.fn().mockResolvedValue(buildPage());
    const onOperationActiveChange = vi.fn();
    const { renderer } = await renderSection({
      onOperationActiveChange,
      prepareForGeneration,
    });

    const action = findButton(renderer, 'ページ画像を生成（3クレジット以上）');
    await act(async () => {
      action.props.onClick();
      action.props.onClick();
      await flushQueries();
    });

    expect(prepareForGeneration).toHaveBeenCalledOnce();
    expect(prepareForGeneration).toHaveBeenCalledWith(pageId);
    expect(api.generatePage).toHaveBeenCalledOnce();
    expect(api.generatePage).toHaveBeenCalledWith(pageId, organizationId);
    expect(api.getJob).toHaveBeenCalledWith(jobId, organizationId);
    expect(onOperationActiveChange).toHaveBeenCalledWith(expect.stringContaining(pageId), true);
  });

  it('dirty解決がcancelまたは失敗した場合は生成POSTを送らない', async () => {
    const prepareForGeneration = vi.fn().mockResolvedValue(null);
    const { renderer } = await renderSection({ prepareForGeneration });

    await act(async () => {
      findButton(renderer, 'ページ画像を生成（3クレジット以上）').props.onClick();
      await flushQueries();
    });

    expect(api.generatePage).not.toHaveBeenCalled();
  });

  it('dirty解決の待機開始時点から親画面へoperation lockを通知する', async () => {
    const prepared = deferred<PageRecord | null>();
    const onOperationActiveChange = vi.fn();
    const { renderer } = await renderSection({
      onOperationActiveChange,
      prepareForGeneration: vi.fn().mockReturnValue(prepared.promise),
    });

    await act(async () => {
      findButton(renderer, 'ページ画像を生成（3クレジット以上）').props.onClick();
      await Promise.resolve();
    });

    expect(onOperationActiveChange).toHaveBeenLastCalledWith(expect.stringContaining(pageId), true);
    expect(api.generatePage).not.toHaveBeenCalled();

    await act(async () => {
      prepared.resolve(null);
      await flushQueries();
    });
    expect(onOperationActiveChange).toHaveBeenLastCalledWith(expect.stringContaining(pageId), false);
  });

  it('現在EpisodeのPageに一致するactive page_generateだけを画面lock対象にする', () => {
    expect(hasActivePageImageJobForPages(
      [buildPageJob('processing'), buildPageJob('completed')],
      [buildPage()],
    )).toBe(true);
    expect(hasActivePageImageJobForPages(
      [buildPageJob('processing', otherPageId)],
      [buildPage()],
    )).toBe(false);
  });

  it.each([
    ['確定済み', buildPage({ status: 'confirmed' }), '確定済みページは再オープンしてから再生成してください。'],
    ['生成中', buildPage({ status: 'generating' }), 'このページの画像生成はすでに進行中です。'],
    ['コマなし', buildPage({ panel_count: 0, frame_count: 0 }), 'ページ画像を作る前にコマ内容とコマ割りを設定してください。'],
    ['件数不一致', buildPage({ panel_count: 2, frame_count: 1 }), 'コマ内容とコマ割りの数を一致させてください。'],
  ])('%sのPageでは生成開始を無効にする', async (_label, page, message) => {
    const { renderer } = await renderSection({ page });

    expect(findButton(renderer, page.generated_image === null
      ? 'ページ画像を生成（3クレジット以上）'
      : 'ページ画像を再生成（3クレジット以上）').props.disabled).toBe(true);
    expect(renderer.root.findAllByType('notice').some(
      (notice) => String(notice.children.join('')).includes(message),
    )).toBe(true);
    expect(api.generatePage).not.toHaveBeenCalled();
  });

  it('completed job後はrefetchしたPageのgenerated_imageだけを表示する', async () => {
    const completedPage = buildPage({
      generated_image: {
        cdn_url: 'https://cdn.example.com/generated.png',
        generated_at: '2026-08-01T01:00:00.000Z',
        generation_mode: 'standard',
      },
      generation_mode: 'standard',
      status: 'generated',
    });
    api.getJob.mockResolvedValue(buildPageJob('completed', pageId, {
      generated_image: {
        generated_at: completedPage.generated_image!.generated_at,
        generation_mode: 'standard',
      },
      generation_mode: 'standard',
      request_kind: 'initial',
    }));
    const refreshPages = vi.fn().mockResolvedValue([completedPage]);
    const { renderer } = await renderSection({ refreshPages });

    await act(async () => {
      findButton(renderer, 'ページ画像を生成（3クレジット以上）').props.onClick();
      await flushQueries();
    });

    expect(refreshPages).toHaveBeenCalled();
    expect(renderer.root.findByType('page-image').props.publicSource).toEqual(
      expect.objectContaining({ uri: completedPage.generated_image!.cdn_url }),
    );
    expect(allText(renderer)).toContain('ページ画像を生成しました。');
  });

  it('accepted jobが別Pageを指す場合は成功扱いせずPOSTを再送しない', async () => {
    api.getJob.mockResolvedValue(buildPageJob('processing', otherPageId));
    const { renderer } = await renderSection();

    await act(async () => {
      findButton(renderer, 'ページ画像を生成（3クレジット以上）').props.onClick();
      await flushQueries();
    });

    expect(api.generatePage).toHaveBeenCalledOnce();
    expect(allText(renderer)).toContain('生成結果を安全に確認できません。生成を自動再送せず、状態確認が必要です。');
  });

  it('POST応答消失後は同じPageのactive jobだけを復旧し生成POSTを再送しない', async () => {
    api.generatePage.mockRejectedValue(new ApiError('NETWORK_ERROR', 0, 'raw network'));
    api.getJobs
      .mockResolvedValueOnce({ jobs: [], next_cursor: null })
      .mockResolvedValueOnce({ jobs: [], next_cursor: null })
      .mockResolvedValueOnce({ jobs: [buildPageJob('queued')], next_cursor: null });
    const { renderer } = await renderSection();

    await act(async () => {
      findButton(renderer, 'ページ画像を生成（3クレジット以上）').props.onClick();
      await flushQueries();
    });

    expect(api.generatePage).toHaveBeenCalledOnce();
    expect(api.getJob).toHaveBeenCalledWith(jobId, organizationId);
    expect(allText(renderer)).toContain('ページ画像の生成を受け付けました。');
  });

  it('応答消失後に一致jobがない場合は明示確認でもPOSTを再送しない', async () => {
    api.generatePage.mockRejectedValue(new ApiError('INVALID_API_RESPONSE', 502, 'raw'));
    const onOperationActiveChange = vi.fn();
    const { renderer } = await renderSection({ onOperationActiveChange });

    await act(async () => {
      findButton(renderer, 'ページ画像を生成（3クレジット以上）').props.onClick();
      await flushQueries();
    });
    expect(allText(renderer)).toContain('生成受付の結果を確認できません。重複を防ぐため自動再送はしていません。');

    await act(async () => {
      findButton(renderer, '生成状況を確認').props.onClick();
      await flushQueries();
    });

    expect(api.generatePage).toHaveBeenCalledOnce();
    expect(allText(renderer)).toContain('新しい生成受付は確認されませんでした。必要ならもう一度生成できます。');
    expect(onOperationActiveChange).toHaveBeenLastCalledWith(expect.stringContaining(pageId), false);
  });

  it('生成POST待機中に画面を離れた場合は操作lockを解除して遅延応答を追跡しない', async () => {
    const accepted = deferred<{ job_id: string }>();
    api.generatePage.mockReturnValue(accepted.promise);
    const onOperationActiveChange = vi.fn();
    const { renderer } = await renderSection({ onOperationActiveChange });

    await act(async () => {
      findButton(renderer, 'ページ画像を生成（3クレジット以上）').props.onClick();
      await flushQueries();
    });
    expect(api.generatePage).toHaveBeenCalledOnce();
    expect(onOperationActiveChange).toHaveBeenLastCalledWith(expect.stringContaining(pageId), true);

    await act(async () => renderer.unmount());
    mounted.splice(mounted.indexOf(renderer), 1);
    expect(onOperationActiveChange).toHaveBeenLastCalledWith(expect.stringContaining(pageId), false);

    await act(async () => {
      accepted.resolve({ job_id: jobId });
      await flushQueries();
    });
    expect(api.getJob).not.toHaveBeenCalled();
    expect(onOperationActiveChange).toHaveBeenLastCalledWith(expect.stringContaining(pageId), false);
  });

  it('画像読込失敗の再試行はPage情報だけを再取得して再生成しない', async () => {
    const generatedPage = buildPage({
      generated_image: {
        cdn_url: 'https://cdn.example.com/generated.png',
        generated_at: '2026-08-01T01:00:00.000Z',
        generation_mode: 'standard',
      },
      status: 'generated',
    });
    const refreshPages = vi.fn().mockResolvedValue([generatedPage]);
    const { renderer } = await renderSection({ page: generatedPage, refreshPages });

    await act(async () => {
      renderer.root.findByType('page-image').props.onExhausted();
    });
    await act(async () => {
      findButton(renderer, '画像を再読み込み').props.onClick();
      await flushQueries();
    });

    expect(refreshPages).toHaveBeenCalledOnce();
    expect(api.generatePage).not.toHaveBeenCalled();
  });
});

function buildPage(overrides: Partial<PageRecord> = {}): PageRecord {
  return {
    balloon_count: 0,
    created_at: timestamp,
    dialogue_mode: 'mixed',
    episode_id: episodeId,
    frame_count: 1,
    generated_image: null,
    generation_mode: null,
    id: pageId,
    layout_config: {},
    page_dialogue_toggle: true,
    page_number: 1,
    panel_count: 1,
    status: 'designing',
    story_continuity_note: null,
    story_page_purpose: null,
    story_source_scene_ids: [],
    updated_at: timestamp,
    ...overrides,
  };
}

function buildPageJob(
  status: GenerationJobRecord['status'],
  targetPageId = pageId,
  result: Extract<GenerationJobRecord, { job_type: 'page_generate' }>['result'] = null,
): Extract<GenerationJobRecord, { job_type: 'page_generate' }> {
  return {
    cancel_requested_at: null,
    cancelled_at: status === 'cancelled' ? timestamp : null,
    commit_started_at: null,
    completed_at: status === 'queued' || status === 'processing' ? null : timestamp,
    created_at: timestamp,
    credit_cost: 3,
    error_message: status === 'failed' ? 'raw provider error' : null,
    expires_at: null,
    generation_mode: 'standard',
    id: jobId,
    job_type: 'page_generate',
    params: {
      generation_mode: 'standard',
      page_id: targetPageId,
      quality: 'medium',
      request_kind: 'initial',
      requires_planner: false,
    },
    result,
    retry_count: 0,
    started_at: status === 'queued' ? null : timestamp,
    status,
  };
}

function findButton(renderer: ReactTestRenderer, label: string): ReturnType<ReactTestRenderer['root']['findByType']> {
  return renderer.root.findAllByType('button').find(
    (button) => button.children.join('') === label,
  )!;
}

function allText(renderer: ReactTestRenderer): string {
  return renderer.root.findAllByType('text').flatMap((node) => node.children).join(' ')
    + renderer.root.findAllByType('notice').flatMap((node) => node.children).join(' ');
}

async function flushQueries(): Promise<void> {
  for (let index = 0; index < 8; index += 1) {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
