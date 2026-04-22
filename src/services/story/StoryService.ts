import { NotFoundError } from '../../domain/errors/index.js';
import type {
  Chapter,
  CreateChapterInput,
  CreateEpisodeInput,
  CreateWorkInput,
  Episode,
  UpdateChapterInput,
  UpdateEpisodeInput,
  UpdateWorkInput,
  Work,
} from '../../domain/types/story.js';
import type { StoryRepository } from '../../repositories/StoryRepository.js';

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
  createWork(userId: string, input: CreateWorkInput): Promise<Work>;
  getWork(userId: string, workId: string): Promise<Work>;
  updateWork(userId: string, workId: string, input: UpdateWorkInput): Promise<Work>;
  createChapter(userId: string, workId: string, input: CreateChapterInput): Promise<Chapter>;
  listChapters(userId: string, workId: string): Promise<Chapter[]>;
  updateChapter(userId: string, chapterId: string, input: UpdateChapterInput): Promise<Chapter>;
  deleteChapter(userId: string, chapterId: string): Promise<void>;
  createEpisode(userId: string, chapterId: string, input: CreateEpisodeInput): Promise<Episode>;
  listEpisodes(userId: string, chapterId: string): Promise<Episode[]>;
  updateEpisode(userId: string, episodeId: string, input: UpdateEpisodeInput): Promise<Episode>;
  deleteEpisode(userId: string, episodeId: string): Promise<void>;
}

export class StoryService implements StoryServicePort {
  public constructor(private readonly storyRepository: StoryRepository) {}

  public async createWork(userId: string, input: CreateWorkInput): Promise<Work> {
    return this.storyRepository.createWork(userId, input);
  }

  public async getWork(userId: string, workId: string): Promise<Work> {
    const work = await this.storyRepository.findWorkByIdAndUserId(workId, userId);
    if (work === null) {
      throw new NotFoundError('Work not found');
    }

    return work;
  }

  public async updateWork(userId: string, workId: string, input: UpdateWorkInput): Promise<Work> {
    const work = await this.storyRepository.updateWork(workId, userId, input);
    if (work === null) {
      throw new NotFoundError('Work not found');
    }

    return work;
  }

  public async createChapter(userId: string, workId: string, input: CreateChapterInput): Promise<Chapter> {
    await this.ensureWorkOwnedByUser(userId, workId);
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

  public async createEpisode(
    userId: string,
    chapterId: string,
    input: CreateEpisodeInput,
  ): Promise<Episode> {
    await this.ensureChapterOwnedByUser(userId, chapterId);
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

  private async ensureWorkOwnedByUser(userId: string, workId: string): Promise<void> {
    await this.getWork(userId, workId);
  }

  private async ensureChapterOwnedByUser(userId: string, chapterId: string): Promise<void> {
    const chapter = await this.storyRepository.findChapterByIdAndUserId(chapterId, userId);
    if (chapter === null) {
      throw new NotFoundError('Chapter not found');
    }
  }
}
