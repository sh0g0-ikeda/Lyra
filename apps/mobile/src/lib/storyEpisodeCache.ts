import type { QueryClient, QueryKey } from '@tanstack/react-query';

import type { EpisodeRecord } from '@/domain/types';

interface EpisodeListResponse {
  episodes: EpisodeRecord[];
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
