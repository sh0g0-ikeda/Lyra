import { NotFoundError, ResourceStaleError, ValidationError } from '../../domain/errors/index.js';
import type { ListPage, ListPageRequest } from '../../domain/pagination.js';
import type {
  Chapter,
  CreateChapterInput,
  CreateEpisodeInput,
  CreateWorkInput,
  Episode,
  StoryItemMoveDirection,
  UpdateChapterInput,
  UpdateEpisodeInput,
  UpdateWorkInput,
  Work,
} from '../../domain/types/story.js';
import type { StoryRepository } from '../../repositories/StoryRepository.js';
import type { EntityReferenceReader } from '../../repositories/EntityRepository.js';

interface StoryPaginationReader {
  findWorksPageByUserId(userId: string, request: ListPageRequest, organizationId?: string | null): Promise<ListPage<Work>>;
}

export type {
  Chapter,
  CreateChapterInput as CreateChapterRequest,
  CreateEpisodeInput as CreateEpisodeRequest,
  CreateWorkInput as CreateWorkRequest,
  Episode,
  UpdateChapterInput as UpdateChapterRequest,
  UpdateEpisodeInput as UpdateEpisodeRequest,
  UpdateWorkInput as UpdateWorkRequest,
  Work,
};

export interface StoryServicePort {
  listWorks(userId: string, organizationId?: string | null): Promise<Work[]>;
  listWorksPage(userId: string, request: ListPageRequest, organizationId?: string | null): Promise<ListPage<Work>>;
  createWork(userId: string, input: CreateWorkInput): Promise<Work>;
  getWork(userId: string, workId: string, organizationId?: string | null): Promise<Work>;
  updateWork(userId: string, workId: string, input: UpdateWorkInput, organizationId?: string | null): Promise<Work>;
  createChapter(userId: string, workId: string, input: CreateChapterInput, organizationId?: string | null): Promise<Chapter>;
  listChapters(userId: string, workId: string, organizationId?: string | null): Promise<Chapter[]>;
  updateChapter(userId: string, chapterId: string, input: UpdateChapterInput, organizationId?: string | null): Promise<Chapter>;
  deleteChapter(userId: string, chapterId: string, organizationId?: string | null): Promise<void>;
  moveChapter(userId: string, chapterId: string, direction: StoryItemMoveDirection, organizationId?: string | null): Promise<Chapter>;
  createEpisode(userId: string, chapterId: string, input: CreateEpisodeInput, organizationId?: string | null): Promise<Episode>;
  listEpisodes(userId: string, chapterId: string, organizationId?: string | null): Promise<Episode[]>;
  getEpisode(userId: string, episodeId: string, organizationId?: string | null): Promise<Episode>;
  updateEpisode(userId: string, episodeId: string, input: UpdateEpisodeInput, organizationId?: string | null): Promise<Episode>;
  deleteEpisode(userId: string, episodeId: string, organizationId?: string | null): Promise<void>;
  moveEpisode(
    userId: string,
    episodeId: string,
    direction: StoryItemMoveDirection,
    organizationId?: string | null,
    crossChapter?: boolean,
  ): Promise<Episode>;
}

export class StoryService implements StoryServicePort {
  public constructor(
    private readonly storyRepository: StoryRepository,
    private readonly entityReferenceReader: EntityReferenceReader,
  ) {}

  public async createWork(userId: string, input: CreateWorkInput): Promise<Work> {
    if (input.mainEntityIds.length > 0) {
      throw new ValidationError('mainEntityIds cannot be set while creating a work');
    }

    return this.storyRepository.createWork(userId, input);
  }

  public async listWorks(userId: string, organizationId: string | null = null): Promise<Work[]> {
    return this.storyRepository.findWorksByUserId(userId, organizationId);
  }

  public async listWorksPage(
    userId: string,
    request: ListPageRequest,
    organizationId: string | null = null,
  ): Promise<ListPage<Work>> {
    return (this.storyRepository as StoryRepository & StoryPaginationReader)
      .findWorksPageByUserId(userId, request, organizationId);
  }

  public async getWork(userId: string, workId: string, organizationId: string | null = null): Promise<Work> {
    const work = await this.storyRepository.findWorkByIdAndUserId(workId, userId, organizationId);
    if (work === null) {
      throw new NotFoundError('Work not found');
    }

    return work;
  }

  public async updateWork(
    userId: string,
    workId: string,
    input: UpdateWorkInput,
    organizationId: string | null = null,
  ): Promise<Work> {
    await this.ensureWorkOwnedByUser(userId, workId, organizationId);

    if (input.mainEntityIds !== undefined) {
      await this.ensureEntitiesBelongToWork(userId, workId, input.mainEntityIds, organizationId);
    }

    const work = await this.storyRepository.updateWork(workId, userId, input, organizationId);
    if (work === null) {
      const currentWork = await this.storyRepository.findWorkByIdAndUserId(workId, userId, organizationId);
      if (currentWork === null) {
        throw new NotFoundError('Work not found');
      }
      throw new ResourceStaleError();
    }

    return work;
  }

  public async createChapter(
    userId: string,
    workId: string,
    input: CreateChapterInput,
    organizationId: string | null = null,
  ): Promise<Chapter> {
    await this.ensureWorkOwnedByUser(userId, workId, organizationId);
    await this.ensureEntitiesBelongToWork(userId, workId, input.entitiesInvolved, organizationId);
    return this.storyRepository.createChapter(workId, input);
  }

  public async listChapters(userId: string, workId: string, organizationId: string | null = null): Promise<Chapter[]> {
    await this.ensureWorkOwnedByUser(userId, workId, organizationId);
    return this.storyRepository.findChaptersByWorkIdAndUserId(workId, userId, organizationId);
  }

  public async updateChapter(
    userId: string,
    chapterId: string,
    input: UpdateChapterInput,
    organizationId: string | null = null,
  ): Promise<Chapter> {
    const currentChapter = await this.storyRepository.findChapterByIdAndUserId(chapterId, userId, organizationId);
    if (currentChapter === null) {
      throw new NotFoundError('Chapter not found');
    }
    if (input.entitiesInvolved !== undefined) {
      await this.ensureEntitiesBelongToWork(userId, currentChapter.workId, input.entitiesInvolved, organizationId);
    }

    const chapter = await this.storyRepository.updateChapter(chapterId, userId, input, organizationId);
    if (chapter === null) {
      const latestChapter = await this.storyRepository.findChapterByIdAndUserId(chapterId, userId, organizationId);
      if (latestChapter === null) {
        throw new NotFoundError('Chapter not found');
      }
      throw new ResourceStaleError();
    }

    return chapter;
  }

  public async deleteChapter(userId: string, chapterId: string, organizationId: string | null = null): Promise<void> {
    const deleted = await this.storyRepository.deleteChapter(chapterId, userId, organizationId);
    if (!deleted) {
      throw new NotFoundError('Chapter not found');
    }
  }

  public async moveChapter(
    userId: string,
    chapterId: string,
    direction: StoryItemMoveDirection,
    organizationId: string | null = null,
  ): Promise<Chapter> {
    const chapter = await this.storyRepository.moveChapter(chapterId, userId, direction, organizationId);
    if (chapter === null) {
      throw new NotFoundError('Chapter not found');
    }

    return chapter;
  }

  public async createEpisode(
    userId: string,
    chapterId: string,
    input: CreateEpisodeInput,
    organizationId: string | null = null,
  ): Promise<Episode> {
    const chapter = await this.ensureChapterOwnedByUser(userId, chapterId, organizationId);
    await this.ensureEntitiesBelongToWork(userId, chapter.workId, input.entitiesInvolved, organizationId);
    return this.storyRepository.createEpisode(chapterId, input);
  }

  public async listEpisodes(userId: string, chapterId: string, organizationId: string | null = null): Promise<Episode[]> {
    await this.ensureChapterOwnedByUser(userId, chapterId, organizationId);
    return this.storyRepository.findEpisodesByChapterIdAndUserId(chapterId, userId, organizationId);
  }

  public async getEpisode(
    userId: string,
    episodeId: string,
    organizationId: string | null = null,
  ): Promise<Episode> {
    const episode = await this.storyRepository.findEpisodeByIdAndUserId(episodeId, userId, organizationId);
    if (episode === null) {
      throw new NotFoundError('Episode not found');
    }

    return episode;
  }

  public async updateEpisode(
    userId: string,
    episodeId: string,
    input: UpdateEpisodeInput,
    organizationId: string | null = null,
  ): Promise<Episode> {
    const currentEpisode = await this.getEpisode(userId, episodeId, organizationId);
    if (input.entitiesInvolved !== undefined) {
      const chapter = await this.ensureChapterOwnedByUser(userId, currentEpisode.chapterId, organizationId);
      await this.ensureEntitiesBelongToWork(userId, chapter.workId, input.entitiesInvolved, organizationId);
    }

    const episode = await this.storyRepository.updateEpisode(episodeId, userId, input, organizationId);
    if (episode === null) {
      const latestEpisode = await this.storyRepository.findEpisodeByIdAndUserId(episodeId, userId, organizationId);
      if (latestEpisode === null) {
        throw new NotFoundError('Episode not found');
      }
      throw new ResourceStaleError();
    }

    return episode;
  }

  public async deleteEpisode(userId: string, episodeId: string, organizationId: string | null = null): Promise<void> {
    const deleted = await this.storyRepository.deleteEpisode(episodeId, userId, organizationId);
    if (!deleted) {
      throw new NotFoundError('Episode not found');
    }
  }

  public async moveEpisode(
    userId: string,
    episodeId: string,
    direction: StoryItemMoveDirection,
    organizationId: string | null = null,
    crossChapter = false,
  ): Promise<Episode> {
    const episode = await this.storyRepository.moveEpisode(
      episodeId,
      userId,
      direction,
      organizationId,
      crossChapter,
    );
    if (episode === null) {
      throw new NotFoundError('Episode not found');
    }

    return episode;
  }

  private async ensureWorkOwnedByUser(userId: string, workId: string, organizationId: string | null): Promise<void> {
    await this.getWork(userId, workId, organizationId);
  }

  private async ensureChapterOwnedByUser(
    userId: string,
    chapterId: string,
    organizationId: string | null,
  ): Promise<Chapter> {
    const chapter = await this.storyRepository.findChapterByIdAndUserId(chapterId, userId, organizationId);
    if (chapter === null) {
      throw new NotFoundError('Chapter not found');
    }

    return chapter;
  }

  private async ensureEntitiesBelongToWork(
    userId: string,
    workId: string,
    entityIds: string[],
    organizationId: string | null,
  ): Promise<void> {
    const uniqueEntityIds = [...new Set(entityIds)];
    if (uniqueEntityIds.length === 0) {
      return;
    }

    const matchedEntityCount =
      organizationId === null || this.entityReferenceReader.countByIdsAndWorkId === undefined
        ? await this.entityReferenceReader.countByIdsAndWorkIdAndUserId(uniqueEntityIds, workId, userId)
        : await this.entityReferenceReader.countByIdsAndWorkId(uniqueEntityIds, workId);
    if (matchedEntityCount !== uniqueEntityIds.length) {
      throw new ValidationError('All referenced entities must belong to the work');
    }
  }
}
