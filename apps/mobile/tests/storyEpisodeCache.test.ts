import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

import type { EpisodeRecord } from '@/domain/types';
import {
  createEpisodeSaveQueue,
  episodeEditorSnapshotMatches,
  fetchFreshEpisode,
  replaceEpisodeInResponse,
} from '@/lib/storyEpisodeCache';

const episode = (overrides: Partial<EpisodeRecord> = {}): EpisodeRecord => ({
  id: 'episode-1',
  chapter_id: 'chapter-1',
  order: 1,
  title: '第1話',
  purpose: null,
  story_input_mode: 'full',
  story_full_draft: '本文',
  introduction: null,
  middle: null,
  climax: null,
  ending_hook: null,
  estimated_pages: 4,
  entities_involved: [],
  page_skeleton_generated: false,
  version: 1,
  status: 'draft',
  created_at: '2026-08-16T00:00:00.000Z',
  updated_at: '2026-08-16T00:00:00.000Z',
  ...overrides,
});

describe('story episode cache', () => {
  it('同じ内容の保存要求が重なってもAPI更新は一度だけ実行する', async () => {
    let resolveSave: ((value: EpisodeRecord) => void) | null = null;
    const persist = vi.fn(() => new Promise<EpisodeRecord>((resolve) => {
      resolveSave = resolve;
    }));
    const queue = createEpisodeSaveQueue();
    const request = {
      editor: {
        draft: '本文',
        episodeId: 'episode-1',
        estimatedPages: '4',
        title: '題名',
      },
      episode: episode(),
    };

    const first = queue.enqueue(request, persist);
    const second = queue.enqueue(request, persist);

    expect(persist).toHaveBeenCalledTimes(1);
    resolveSave?.(episode({ updated_at: '2026-08-16T00:00:01.000Z' }));
    await expect(first).resolves.toMatchObject({ id: 'episode-1' });
    await expect(second).resolves.toMatchObject({ id: 'episode-1' });
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it('先の保存中に内容が変わった場合は最新revisionで順番に保存する', async () => {
    let resolveFirst: ((value: EpisodeRecord) => void) | null = null;
    const persist = vi.fn()
      .mockImplementationOnce(() => new Promise<EpisodeRecord>((resolve) => {
        resolveFirst = resolve;
      }))
      .mockResolvedValueOnce(episode({ updated_at: '2026-08-16T00:00:02.000Z' }));
    const queue = createEpisodeSaveQueue();
    const initial = episode({ updated_at: '2026-08-16T00:00:00.000Z' });
    const first = queue.enqueue({
      editor: { draft: '本文1', episodeId: initial.id, estimatedPages: '4', title: '題名' },
      episode: initial,
    }, persist);
    const second = queue.enqueue({
      editor: { draft: '本文2', episodeId: initial.id, estimatedPages: '4', title: '題名' },
      episode: initial,
    }, persist);

    const firstSaved = episode({ updated_at: '2026-08-16T00:00:01.000Z' });
    resolveFirst?.(firstSaved);
    await first;
    await second;

    expect(persist).toHaveBeenCalledTimes(2);
    expect(persist.mock.calls[1]?.[0]).toMatchObject({
      editor: { draft: '本文2' },
      episode: { updated_at: firstSaved.updated_at },
    });
  });

  it('別の話へ移動した場合は先に保存した話のrecordを引き継がない', async () => {
    let resolveFirst: ((value: EpisodeRecord) => void) | null = null;
    const persist = vi.fn()
      .mockImplementationOnce(() => new Promise<EpisodeRecord>((resolve) => {
        resolveFirst = resolve;
      }))
      .mockImplementationOnce(async (request) => request.episode);
    const queue = createEpisodeSaveQueue();
    const firstEpisode = episode({ id: 'episode-1', updated_at: '2026-08-16T00:00:00.000Z' });
    const secondEpisode = episode({ id: 'episode-2', updated_at: '2026-08-16T00:00:05.000Z' });
    const first = queue.enqueue({
      editor: { draft: '話A', episodeId: firstEpisode.id, estimatedPages: '4', title: '話A' },
      episode: firstEpisode,
    }, persist);
    const second = queue.enqueue({
      editor: { draft: '話B', episodeId: secondEpisode.id, estimatedPages: '4', title: '話B' },
      episode: secondEpisode,
    }, persist);

    resolveFirst?.(episode({ id: firstEpisode.id, updated_at: '2026-08-16T00:00:01.000Z' }));
    await first;
    await second;

    expect(persist).toHaveBeenCalledTimes(2);
    expect(persist.mock.calls[1]?.[0]).toMatchObject({
      editor: { draft: '話B', episodeId: secondEpisode.id },
      episode: { id: secondEpisode.id, updated_at: secondEpisode.updated_at },
    });
  });

  it('別の話の保存失敗を待たずに現在の話を保存できる', async () => {
    let rejectFirst: ((reason: Error) => void) | null = null;
    const persist = vi.fn()
      .mockImplementationOnce(() => new Promise<EpisodeRecord>((_resolve, reject) => {
        rejectFirst = reject;
      }))
      .mockImplementationOnce(async (request) => request.episode);
    const queue = createEpisodeSaveQueue();
    const firstEpisode = episode({ id: 'episode-1' });
    const secondEpisode = episode({ id: 'episode-2' });

    const first = queue.enqueue({
      editor: { draft: '失敗する話', episodeId: firstEpisode.id, estimatedPages: '4', title: '話A' },
      episode: firstEpisode,
    }, persist);
    const second = queue.enqueue({
      editor: { draft: '保存する話', episodeId: secondEpisode.id, estimatedPages: '4', title: '話B' },
      episode: secondEpisode,
    }, persist);

    expect(persist).toHaveBeenCalledTimes(2);
    await expect(second).resolves.toMatchObject({ id: secondEpisode.id });
    rejectFirst?.(new Error('話Aの保存失敗'));
    await expect(first).rejects.toThrow('話Aの保存失敗');
  });

  it('保存開始後に選択や入力が変わった場合は古い応答で入力欄を置き換えない', () => {
    const submitted = {
      draft: '送信した本文',
      episodeId: 'episode-1',
      estimatedPages: '4',
      title: '送信した題名',
    };

    expect(episodeEditorSnapshotMatches(submitted, submitted)).toBe(true);
    expect(episodeEditorSnapshotMatches(
      { ...submitted, draft: '送信後に追記した本文' },
      submitted,
    )).toBe(false);
    expect(episodeEditorSnapshotMatches(
      { ...submitted, episodeId: 'episode-2' },
      submitted,
    )).toBe(false);
  });

  it('保存応答の話だけを一覧内で置き換える', () => {
    const current = episode();
    const other = episode({ id: 'episode-2', order: 2 });
    const updated = episode({ story_full_draft: '保存後', updated_at: '2026-08-16T00:01:00.000Z', version: 2 });

    expect(replaceEpisodeInResponse({ episodes: [current, other] }, updated)).toEqual({
      episodes: [updated, other],
    });
  });

  it('キャッシュがfreshでも最新状態はAPIから強制取得してキャッシュを更新する', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { staleTime: 60_000 } },
    });
    const queryKey = ['episodes', 'session-1', 'chapter-1', 'personal'] as const;
    const cached = episode({ story_full_draft: '古い本文' });
    const latest = episode({
      story_full_draft: '最新本文',
      updated_at: '2026-08-16T00:01:00.000Z',
      version: 2,
    });
    queryClient.setQueryData(queryKey, { episodes: [cached] });
    const getEpisodes = vi.fn().mockResolvedValue({ episodes: [latest] });

    await expect(fetchFreshEpisode({
      api: { getEpisodes },
      chapterId: 'chapter-1',
      episodeId: 'episode-1',
      organizationId: null,
      queryClient,
      queryKey,
    })).resolves.toEqual(latest);

    expect(getEpisodes).toHaveBeenCalledWith('chapter-1', null);
    expect(queryClient.getQueryData(queryKey)).toEqual({ episodes: [latest] });
  });
});
