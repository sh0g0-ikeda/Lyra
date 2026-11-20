import type { CharacterAutofillResult } from '../../../packages/api-contract/src/characterAutofill.js';
import { NotFoundError, ResourceStaleError } from '../../domain/errors/index.js';
import type { Episode } from '../../domain/types/story.js';
import type { CharacterAutofillRepository } from '../../repositories/CharacterAutofillRepository.js';
import type { StoryRepository } from '../../repositories/StoryRepository.js';
import {
  extractCharacterAutofillCandidates,
  type CharacterAutofillCandidate,
} from './CharacterAutofillFields.js';
import type { StoryAiClientPort } from './StoryAiClientPort.js';

export interface CharacterAutofillServicePort {
  autofillEpisodeCharacters(
    userId: string,
    episodeId: string,
    version: number,
    organizationId?: string | null,
  ): Promise<CharacterAutofillResult>;
}

export type CharacterAutofillExtractor = (
  client: StoryAiClientPort,
  episode: Episode,
) => Promise<CharacterAutofillCandidate[]>;

/**
 * Keeps provider work outside the database transaction, then checks the episode
 * revision again before handing the result to the repository's locked save.
 */
export class CharacterAutofillService implements CharacterAutofillServicePort {
  public constructor(
    private readonly storyRepository: StoryRepository,
    private readonly storyAiClient: StoryAiClientPort,
    private readonly characterAutofillRepository: CharacterAutofillRepository,
    private readonly extractor: CharacterAutofillExtractor = extractCharacterAutofillCandidates,
  ) {}

  public async autofillEpisodeCharacters(
    userId: string,
    episodeId: string,
    version: number,
    organizationId: string | null = null,
  ): Promise<CharacterAutofillResult> {
    const episode = await this.readCurrentEpisode(userId, episodeId, organizationId);
    if (episode.version !== version) throw new ResourceStaleError();

    const candidates = await this.extractor(this.storyAiClient, episode);

    const current = await this.readCurrentEpisode(userId, episodeId, organizationId);
    if (current.version !== version) throw new ResourceStaleError();

    return this.characterAutofillRepository.saveCandidates({
      userId,
      episodeId,
      version,
      organizationId,
      candidates,
    });
  }

  private async readCurrentEpisode(
    userId: string,
    episodeId: string,
    organizationId: string | null,
  ): Promise<Episode> {
    const episode = await this.storyRepository.findEpisodeByIdAndUserId(episodeId, userId, organizationId);
    if (episode === null) throw new NotFoundError('Episode not found');
    return episode;
  }
}
