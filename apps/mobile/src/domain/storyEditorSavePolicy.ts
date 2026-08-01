import type { EpisodeRecord, SceneRecord } from '@/domain/types';

interface EpisodesResponse {
  episodes: EpisodeRecord[];
}

interface ScenesResponse {
  scenes: SceneRecord[];
}

export function replaceEpisodeInResponse(
  current: EpisodesResponse | undefined,
  updated: EpisodeRecord
): EpisodesResponse | undefined {
  if (current === undefined || !current.episodes.some((episode) => episode.id === updated.id)) {
    return current;
  }
  return {
    episodes: current.episodes.map((episode) => episode.id === updated.id ? updated : episode)
  };
}

export function upsertSceneInResponse(
  current: ScenesResponse | undefined,
  updated: SceneRecord
): ScenesResponse | undefined {
  if (current === undefined) {
    return current;
  }
  if (!current.scenes.some((scene) => scene.id === updated.id)) {
    return { scenes: [...current.scenes, updated] };
  }
  return {
    scenes: current.scenes.map((scene) => scene.id === updated.id ? updated : scene)
  };
}

export function shouldSaveEpisodeBeforeStoryAi(input: {
  episodeDirty: boolean;
  selectedEpisodeId: string | null;
}): boolean {
  return input.episodeDirty && input.selectedEpisodeId !== null;
}

export async function saveEpisodeBeforeStoryAi(input: {
  episodeDirty: boolean;
  save: () => Promise<void>;
  selectedEpisodeId: string | null;
}): Promise<void> {
  if (!shouldSaveEpisodeBeforeStoryAi(input)) {
    return;
  }
  await input.save();
}

export async function runStoryAiAfterEpisodeSave<Result>(input: {
  episodeDirty: boolean;
  request: () => Promise<Result>;
  save: () => Promise<void>;
  selectedEpisodeId: string | null;
}): Promise<Result> {
  await saveEpisodeBeforeStoryAi(input);
  return input.request();
}
