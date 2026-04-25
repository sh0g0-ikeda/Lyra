import { NotFoundError } from '../../domain/errors/index.js';
import type { PageSummary } from '../../domain/types/page.js';
import type { PageRepository } from '../../repositories/PageRepository.js';
import type { StoryRepository } from '../../repositories/StoryRepository.js';

export interface PageQueryServicePort {
  listEpisodePages(userId: string, episodeId: string): Promise<PageSummary[]>;
}

export class PageQueryService implements PageQueryServicePort {
  public constructor(
    private readonly pageRepository: PageRepository,
    private readonly storyRepository: StoryRepository,
  ) {}

  public async listEpisodePages(userId: string, episodeId: string): Promise<PageSummary[]> {
    const episode = await this.storyRepository.findEpisodeByIdAndUserId(episodeId, userId);
    if (episode === null) {
      throw new NotFoundError('Episode not found');
    }

    return this.pageRepository.findPagesByEpisodeIdAndUserId(episodeId, userId);
  }
}
