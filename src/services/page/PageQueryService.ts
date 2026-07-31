import { ConfigurationError, NotFoundError } from '../../domain/errors/index.js';
import type { PageSummary } from '../../domain/types/page.js';
import type {
  PageListCursor,
  PageListPage,
  PageListPaginationRepository,
  PageRepository,
} from '../../repositories/PageRepository.js';
import type { StoryRepository } from '../../repositories/StoryRepository.js';

export interface PageQueryServicePort {
  listEpisodePages(userId: string, episodeId: string, organizationId?: string | null): Promise<PageSummary[]>;
  listEpisodePagesPage(
    userId: string,
    episodeId: string,
    input: { limit: number; cursor: PageListCursor | null },
    organizationId?: string | null,
  ): Promise<PageListPage>;
}

export class PageQueryService implements PageQueryServicePort {
  public constructor(
    private readonly pageRepository:
      Pick<PageRepository, 'findPagesByEpisodeIdAndUserId'>
      & Partial<PageListPaginationRepository>,
    private readonly storyRepository:
      Pick<StoryRepository, 'findEpisodeByIdAndUserId'>,
  ) {}

  public async listEpisodePages(
    userId: string,
    episodeId: string,
    organizationId: string | null = null,
  ): Promise<PageSummary[]> {
    const episode = await this.storyRepository.findEpisodeByIdAndUserId(episodeId, userId, organizationId);
    if (episode === null) {
      throw new NotFoundError('Episode not found');
    }

    return this.pageRepository.findPagesByEpisodeIdAndUserId(episodeId, userId, organizationId);
  }

  public async listEpisodePagesPage(
    userId: string,
    episodeId: string,
    input: { limit: number; cursor: PageListCursor | null },
    organizationId: string | null = null,
  ): Promise<PageListPage> {
    const episode = await this.storyRepository.findEpisodeByIdAndUserId(
      episodeId,
      userId,
      organizationId,
    );
    if (episode === null) {
      throw new NotFoundError('Episode not found');
    }

    const paginationRepository = requirePageListPaginationRepository(
      this.pageRepository,
    );
    return paginationRepository.findPagesPageByEpisodeIdAndUserId(
      episodeId,
      userId,
      input,
      organizationId,
    );
  }
}

function requirePageListPaginationRepository(
  repository:
    Pick<PageRepository, 'findPagesByEpisodeIdAndUserId'>
    & Partial<PageListPaginationRepository>,
): PageListPaginationRepository {
  if (typeof repository.findPagesPageByEpisodeIdAndUserId !== 'function') {
    throw new ConfigurationError(
      'Page list pagination repository is not configured',
    );
  }

  return repository as PageListPaginationRepository;
}
