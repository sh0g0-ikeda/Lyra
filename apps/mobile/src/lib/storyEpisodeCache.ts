import type { QueryClient, QueryKey } from '@tanstack/react-query';

import type { EpisodeRecord } from '@/domain/types';

interface EpisodeListResponse {
  episodes: EpisodeRecord[];
}

export interface EpisodeEditorSnapshot {
  draft: string;
  episodeId: string | null;
  estimatedPages: string;
  title: string;
}

export interface EpisodeSaveRequest {
  editor: EpisodeEditorSnapshot;
  episode: EpisodeRecord;
}

interface EpisodeSaveResult {
  editor: EpisodeEditorSnapshot;
  episode: EpisodeRecord;
}

export interface EpisodeSaveQueue {
  enqueue(
    request: EpisodeSaveRequest,
    persist: (request: EpisodeSaveRequest) => Promise<EpisodeRecord>,
  ): Promise<EpisodeRecord>;
}

interface EpisodeReader {
  getEpisodes(
    chapterId: string,
    organizationId?: string | null,
  ): Promise<EpisodeListResponse>;
}

export const replaceEpisodeInResponse = (
  current: EpisodeListResponse | undefined,
  updated: EpisodeRecord,
): EpisodeListResponse => {
  if (current === undefined) {
    return { episodes: [updated] };
  }

  const hasEpisode = current.episodes.some((episode) => episode.id === updated.id);
  return {
    episodes: hasEpisode
      ? current.episodes.map((episode) => episode.id === updated.id ? updated : episode)
      : [...current.episodes, updated],
  };
};

export const episodeEditorSnapshotMatches = (
  current: EpisodeEditorSnapshot,
  submitted: EpisodeEditorSnapshot,
): boolean =>
  current.episodeId === submitted.episodeId &&
  current.title === submitted.title &&
  current.draft === submitted.draft &&
  current.estimatedPages === submitted.estimatedPages;

export const createEpisodeSaveQueue = (): EpisodeSaveQueue => {
  const tails = new Map<string, Promise<EpisodeSaveResult>>();

  return {
    enqueue: (request, persist) => {
      const episodeId = request.episode.id;
      const previous = tails.get(episodeId) ?? null;
      const current = (async (): Promise<EpisodeSaveResult> => {
        const previousResult = previous === null ? null : await previous;
        if (
          previousResult !== null &&
          previousResult.episode.id === request.episode.id &&
          episodeEditorSnapshotMatches(previousResult.editor, request.editor)
        ) {
          return previousResult;
        }

        const nextRequest =
          previousResult !== null && previousResult.episode.id === request.episode.id
            ? { ...request, episode: previousResult.episode }
            : request;
        const episode = await persist(nextRequest);
        return { editor: nextRequest.editor, episode };
      })();
      tails.set(episodeId, current);
      void current.then(
        () => {
          if (tails.get(episodeId) === current) {
            tails.delete(episodeId);
          }
        },
        () => {
          if (tails.get(episodeId) === current) {
            tails.delete(episodeId);
          }
        },
      );
      return current.then((result) => result.episode);
    },
  };
};

export const fetchFreshEpisode = async (input: {
  api: EpisodeReader;
  chapterId: string;
  episodeId: string;
  organizationId: string | null;
  queryClient: QueryClient;
  queryKey: QueryKey;
}): Promise<EpisodeRecord | null> => {
  const response = await input.api.getEpisodes(input.chapterId, input.organizationId);
  input.queryClient.setQueryData(input.queryKey, response);
  return response.episodes.find((episode) => episode.id === input.episodeId) ?? null;
};
