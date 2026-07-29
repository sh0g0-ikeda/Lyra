import { NotFoundError } from '../../domain/errors/index.js';
import type { ListPage, ListPageRequest } from '../../domain/pagination.js';
import type { PageSummary } from '../../domain/types/page.js';
import type { PageRepository } from '../../repositories/PageRepository.js';
import type { StoryRepository } from '../../repositories/StoryRepository.js';

interface PagePaginationReader {
  findPagesPageByEpisodeIdAndUserId(
    episodeId: string,
    userId: string,
    request: ListPageRequest,
    organizationId?: string | null,
  ): Promise<ListPage<PageSummary>>;
}

export interface PageQueryServicePort {
  listEpisodePages(userId: string, episodeId: string, organizationId?: string | null): Promise<PageSummary[]>;
  listEpisodePagesPage(userId: string, episodeId: string, request: ListPageRequest, organizationId?: string | null): Promise<ListPage<PageSummary>>;
  getPage(userId: string, pageId: string, organizationId?: string | null): Promise<PageSummary>;
}

export class PageQueryService implements PageQueryServicePort {
  public constructor(
    private readonly pageRepository: PageRepository,
    private readonly storyRepository: StoryRepository,
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
    request: ListPageRequest,
    organizationId: string | null = null,
  ): Promise<ListPage<PageSummary>> {
    const episode = await this.storyRepository.findEpisodeByIdAndUserId(episodeId, userId, organizationId);
    if (episode === null) {
      throw new NotFoundError('Episode not found');
    }

    return (this.pageRepository as PageRepository & PagePaginationReader)
      .findPagesPageByEpisodeIdAndUserId(episodeId, userId, request, organizationId);
  }

  public async getPage(
    userId: string,
    pageId: string,
    organizationId: string | null = null,
  ): Promise<PageSummary> {
    const page = await this.pageRepository.findPageByIdAndUserId(pageId, userId, organizationId);
    if (page === null) {
      throw new NotFoundError('Page not found');
    }

    return page;
  }
}
