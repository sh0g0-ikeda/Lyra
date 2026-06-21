import { NotFoundError, ValidationError } from '../../domain/errors/index.js';
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
  listWorks(userId: string): Promise<Work[]>;
  createWork(userId: string, input: CreateWorkInput): Promise<Work>;
  getWork(userId: string, workId: string): Promise<Work>;
  updateWork(userId: string, workId: string, input: UpdateWorkInput): Promise<Work>;
  createChapter(userId: string, workId: string, input: CreateChapterInput): Promise<Chapter>;
  listChapters(userId: string, workId: string): Promise<Chapter[]>;
  updateChapter(userId: string, chapterId: string, input: UpdateChapterInput): Promise<Chapter>;
  deleteChapter(userId: string, chapterId: string): Promise<void>;
  moveChapter(userId: string, chapterId: string, direction: StoryItemMoveDirection): Promise<Chapter>;
  createEpisode(userId: string, chapterId: string, input: CreateEpisodeInput): Promise<Episode>;
  listEpisodes(userId: string, chapterId: string): Promise<Episode[]>;
  updateEpisode(userId: string, episodeId: string, input: UpdateEpisodeInput): Promise<Episode>;
  deleteEpisode(userId: string, episodeId: string): Promise<void>;
  moveEpisode(userId: string, episodeId: string, direction: StoryItemMoveDirection): Promise<Episode>;
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

  public async listWorks(userId: string): Promise<Work[]> {
    return this.storyRepository.findWorksByUserId(userId);
  }

  public async getWork(userId: string, workId: string): Promise<Work> {
    const work = await this.storyRepository.findWorkByIdAndUserId(workId, userId);
    if (work === null) {
      throw new NotFoundError('Work not found');
    }

    return work;
  }

  public async updateWork(userId: string, workId: string, input: UpdateWorkInput): Promise<Work> {
    await this.ensureWorkOwnedByUser(userId, workId);

    if (input.mainEntityIds !== undefined) {
      await this.ensureEntitiesBelongToWork(userId, workId, input.mainEntityIds);
    }

    const work = await this.storyRepository.updateWork(workId, userId, input);
    if (work === null) {
      throw new NotFoundError('Work not found');
    }

    return work;
  }

  public async createChapter(userId: string, workId: string, input: CreateChapterInput): Promise<Chapter> {
    await this.ensureWorkOwnedByUser(userId, workId);
    await this.ensureEntitiesBelongToWork(userId, workId, input.entitiesInvolved);
    return this.storyRepository.createChapter(workId, input);
  }

  public async listChapters(userId: string, workId: string): Promise<Chapter[]> {
    await this.ensureWorkOwnedByUser(userId, workId);
    return this.storyRepository.findChaptersByWorkIdAndUserId(workId, userId);
  }

  public async updateChapter(
    userId: string,
    chapterId: string,
    input: UpdateChapterInput,
  ): Promise<Chapter> {
    const currentChapter = await this.storyRepository.findChapterByIdAndUserId(chapterId, userId);
    if (currentChapter === null) {
      throw new NotFoundError('Chapter not found');
    }
    if (input.entitiesInvolved !== undefined) {
      await this.ensureEntitiesBelongToWork(userId, currentChapter.workId, input.entitiesInvolved);
    }

    const chapter = await this.storyRepository.updateChapter(chapterId, userId, input);
    if (chapter === null) {
      throw new NotFoundError('Chapter not found');
    }

    return chapter;
  }

  public async deleteChapter(userId: string, chapterId: string): Promise<void> {
    const deleted = await this.storyRepository.deleteChapter(chapterId, userId);
    if (!deleted) {
      throw new NotFoundError('Chapter not found');
    }
  }

  public async moveChapter(
    userId: string,
    chapterId: string,
    direction: StoryItemMoveDirection,
  ): Promise<Chapter> {
    const chapter = await this.storyRepository.moveChapter(chapterId, userId, direction);
    if (chapter === null) {
      throw new NotFoundError('Chapter not found');
    }

    return chapter;
  }

  public async createEpisode(
    userId: string,
    chapterId: string,
    input: CreateEpisodeInput,
  ): Promise<Episode> {
    const chapter = await this.ensureChapterOwnedByUser(userId, chapterId);
    await this.ensureEntitiesBelongToWork(userId, chapter.workId, input.entitiesInvolved);
    return this.storyRepository.createEpisode(chapterId, input);
  }

  public async listEpisodes(userId: string, chapterId: string): Promise<Episode[]> {
    await this.ensureChapterOwnedByUser(userId, chapterId);
    return this.storyRepository.findEpisodesByChapterIdAndUserId(chapterId, userId);
  }

  public async updateEpisode(
    userId: string,
    episodeId: string,
    input: UpdateEpisodeInput,
  ): Promise<Episode> {
    const currentEpisode = await this.storyRepository.findEpisodeByIdAndUserId(episodeId, userId);
    if (currentEpisode === null) {
      throw new NotFoundError('Episode not found');
    }
    if (input.entitiesInvolved !== undefined) {
      const chapter = await this.ensureChapterOwnedByUser(userId, currentEpisode.chapterId);
      await this.ensureEntitiesBelongToWork(userId, chapter.workId, input.entitiesInvolved);
    }

    const episode = await this.storyRepository.updateEpisode(episodeId, userId, input);
    if (episode === null) {
      throw new NotFoundError('Episode not found');
    }

    return episode;
  }

  public async deleteEpisode(userId: string, episodeId: string): Promise<void> {
    const deleted = await this.storyRepository.deleteEpisode(episodeId, userId);
    if (!deleted) {
      throw new NotFoundError('Episode not found');
    }
  }

  public async moveEpisode(
    userId: string,
    episodeId: string,
    direction: StoryItemMoveDirection,
  ): Promise<Episode> {
    const episode = await this.storyRepository.moveEpisode(episodeId, userId, direction);
    if (episode === null) {
      throw new NotFoundError('Episode not found');
    }

    return episode;
  }

  private async ensureWorkOwnedByUser(userId: string, workId: string): Promise<void> {
    await this.getWork(userId, workId);
  }

  private async ensureChapterOwnedByUser(userId: string, chapterId: string): Promise<Chapter> {
    const chapter = await this.storyRepository.findChapterByIdAndUserId(chapterId, userId);
    if (chapter === null) {
      throw new NotFoundError('Chapter not found');
    }

    return chapter;
  }

  private async ensureEntitiesBelongToWork(
    userId: string,
    workId: string,
    entityIds: string[],
  ): Promise<void> {
    const uniqueEntityIds = [...new Set(entityIds)];
    if (uniqueEntityIds.length === 0) {
      return;
    }

    const matchedEntityCount = await this.entityReferenceReader.countByIdsAndWorkIdAndUserId(
      uniqueEntityIds,
      workId,
      userId,
    );
    if (matchedEntityCount !== uniqueEntityIds.length) {
      throw new ValidationError('All referenced entities must belong to the work');
    }
  }
}
