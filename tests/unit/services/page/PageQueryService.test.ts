import { describe, expect, it } from 'vitest';
import type { Episode } from '../../../../src/domain/types/story.js';
import type {
  PageListPage,
  PageListPageRequest,
  PageListPaginationRepository,
} from '../../../../src/repositories/PageRepository.js';
import type { StoryRepository } from '../../../../src/repositories/StoryRepository.js';
import { PageQueryService } from '../../../../src/services/page/PageQueryService.js';

const now = new Date('2026-07-31T00:00:00.000Z');

class FakeEpisodeReader
  implements Pick<StoryRepository, 'findEpisodeByIdAndUserId'>
{
  public episode: Episode | null = {
    id: '11111111-1111-4111-8111-111111111111',
    chapterId: '22222222-2222-4222-8222-222222222222',
    order: 1,
    title: '第一話',
    purpose: null,
    storyInputMode: 'structured',
    storyFullDraft: null,
    introduction: null,
    middle: null,
    climax: null,
    endingHook: null,
    estimatedPages: 12,
    entitiesInvolved: [],
    pageSkeletonGenerated: false,
    version: 1,
    editHistory: [],
    status: 'draft',
    createdAt: now,
    updatedAt: now,
  };

  public async findEpisodeByIdAndUserId(): Promise<Episode | null> {
    return this.episode;
  }
}

class FakePageReader implements PageListPaginationRepository {
  public page: PageListPage = { pages: [], nextCursor: null };
  public requests: Array<{
    episodeId: string;
    userId: string;
    request: PageListPageRequest;
    organizationId: string | null;
  }> = [];

  public async findPagesPageByEpisodeIdAndUserId(
    episodeId: string,
    userId: string,
    request: PageListPageRequest,
    organizationId: string | null = null,
  ): Promise<PageListPage> {
    this.requests.push({ episodeId, userId, request, organizationId });
    return this.page;
  }

  public async findPagesByEpisodeIdAndUserId(): Promise<[]> {
    return [];
  }
}

describe('PageQueryService', () => {
  it('アクセス可能なEpisodeのPage pageをscope・cursor付きで委譲する', async () => {
    const repository = new FakePageReader();
    const service = new PageQueryService(repository, new FakeEpisodeReader());
    const cursor = {
      pageNumber: 10,
      id: '33333333-3333-4333-8333-333333333333',
    };

    await service.listEpisodePagesPage(
      'user-1',
      '11111111-1111-4111-8111-111111111111',
      { limit: 25, cursor },
      '44444444-4444-4444-8444-444444444444',
    );

    expect(repository.requests).toEqual([
      {
        episodeId: '11111111-1111-4111-8111-111111111111',
        userId: 'user-1',
        request: { limit: 25, cursor },
        organizationId: '44444444-4444-4444-8444-444444444444',
      },
    ]);
  });

  it('アクセスできないEpisodeではRepositoryのpage queryを呼ばない', async () => {
    const repository = new FakePageReader();
    const episodeReader = new FakeEpisodeReader();
    episodeReader.episode = null;
    const service = new PageQueryService(repository, episodeReader);

    await expect(
      service.listEpisodePagesPage(
        'user-1',
        '11111111-1111-4111-8111-111111111111',
        { limit: 25, cursor: null },
      ),
    ).rejects.toThrow('Episode not found');
    expect(repository.requests).toEqual([]);
  });
});
