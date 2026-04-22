import { describe, expect, it } from 'vitest';
import type { AppError } from '../../../../src/domain/errors/index.js';
import type {
  Chapter,
  CreateChapterInput,
  CreateEpisodeInput,
  CreateWorkInput,
  Episode,
  StoryRepository,
  UpdateChapterInput,
  UpdateEpisodeInput,
  UpdateWorkInput,
  Work,
} from '../../../../src/repositories/StoryRepository.js';
import { StoryService } from '../../../../src/services/story/StoryService.js';

const now = new Date('2026-04-22T00:00:00.000Z');

class FakeStoryRepository implements StoryRepository {
  private readonly works = new Map<string, Work>();
  private readonly chapters = new Map<string, Chapter>();
  private readonly episodes = new Map<string, Episode>();

  public async createWork(userId: string, input: CreateWorkInput): Promise<Work> {
    const work: Work = {
      id: `work-${this.works.size + 1}`,
      userId,
      title: input.title,
      genre: input.genre,
      worldSetting: input.worldSetting,
      theme: input.theme,
      mainEntityIds: input.mainEntityIds,
      startingPoint: input.startingPoint,
      endingPoint: input.endingPoint,
      overallFlow: input.overallFlow,
      version: 1,
      editHistory: [],
      status: 'draft',
      createdAt: now,
      updatedAt: now,
    };
    this.works.set(work.id, work);
    return work;
  }

  public async findWorkByIdAndUserId(id: string, userId: string): Promise<Work | null> {
    const work = this.works.get(id);
    return work?.userId === userId ? work : null;
  }

  public async updateWork(id: string, userId: string, input: UpdateWorkInput): Promise<Work | null> {
    const work = await this.findWorkByIdAndUserId(id, userId);
    if (work === null) {
      return null;
    }

    const updatedWork: Work = {
      ...work,
      title: input.title ?? work.title,
      genre: input.genre === undefined ? work.genre : input.genre,
      worldSetting: input.worldSetting === undefined ? work.worldSetting : input.worldSetting,
      theme: input.theme === undefined ? work.theme : input.theme,
      mainEntityIds: input.mainEntityIds ?? work.mainEntityIds,
      startingPoint: input.startingPoint === undefined ? work.startingPoint : input.startingPoint,
      endingPoint: input.endingPoint === undefined ? work.endingPoint : input.endingPoint,
      overallFlow: input.overallFlow === undefined ? work.overallFlow : input.overallFlow,
      status: input.status ?? work.status,
      version: work.version + 1,
      updatedAt: now,
    };
    this.works.set(id, updatedWork);
    return updatedWork;
  }

  public async createChapter(workId: string, input: CreateChapterInput): Promise<Chapter> {
    const chapter: Chapter = {
      id: `chapter-${this.chapters.size + 1}`,
      workId,
      order: input.order,
      title: input.title,
      purpose: input.purpose,
      startingState: input.startingState,
      endingState: input.endingState,
      emotionCurve: input.emotionCurve,
      entitiesInvolved: input.entitiesInvolved,
      keyBeats: input.keyBeats,
      version: 1,
      editHistory: [],
      status: 'draft',
      createdAt: now,
      updatedAt: now,
    };
    this.chapters.set(chapter.id, chapter);
    return chapter;
  }

  public async findChaptersByWorkIdAndUserId(workId: string, userId: string): Promise<Chapter[]> {
    const work = await this.findWorkByIdAndUserId(workId, userId);
    if (work === null) {
      return [];
    }

    return [...this.chapters.values()].filter((chapter) => chapter.workId === workId);
  }

  public async findChapterByIdAndUserId(id: string, userId: string): Promise<Chapter | null> {
    const chapter = this.chapters.get(id);
    if (chapter === undefined) {
      return null;
    }

    const work = await this.findWorkByIdAndUserId(chapter.workId, userId);
    return work === null ? null : chapter;
  }

  public async updateChapter(id: string, userId: string, input: UpdateChapterInput): Promise<Chapter | null> {
    const chapter = await this.findChapterByIdAndUserId(id, userId);
    if (chapter === null) {
      return null;
    }

    const updatedChapter: Chapter = {
      ...chapter,
      order: input.order ?? chapter.order,
      title: input.title === undefined ? chapter.title : input.title,
      purpose: input.purpose === undefined ? chapter.purpose : input.purpose,
      startingState: input.startingState === undefined ? chapter.startingState : input.startingState,
      endingState: input.endingState === undefined ? chapter.endingState : input.endingState,
      emotionCurve: input.emotionCurve === undefined ? chapter.emotionCurve : input.emotionCurve,
      entitiesInvolved: input.entitiesInvolved ?? chapter.entitiesInvolved,
      keyBeats: input.keyBeats ?? chapter.keyBeats,
      status: input.status ?? chapter.status,
      version: chapter.version + 1,
      updatedAt: now,
    };
    this.chapters.set(id, updatedChapter);
    return updatedChapter;
  }

  public async deleteChapter(id: string, userId: string): Promise<boolean> {
    const chapter = await this.findChapterByIdAndUserId(id, userId);
    return chapter === null ? false : this.chapters.delete(id);
  }

  public async createEpisode(chapterId: string, input: CreateEpisodeInput): Promise<Episode> {
    const episode: Episode = {
      id: `episode-${this.episodes.size + 1}`,
      chapterId,
      order: input.order,
      title: input.title,
      purpose: input.purpose,
      introduction: input.introduction,
      middle: input.middle,
      climax: input.climax,
      endingHook: input.endingHook,
      estimatedPages: input.estimatedPages,
      entitiesInvolved: input.entitiesInvolved,
      pageSkeletonGenerated: false,
      version: 1,
      editHistory: [],
      status: 'draft',
      createdAt: now,
      updatedAt: now,
    };
    this.episodes.set(episode.id, episode);
    return episode;
  }

  public async findEpisodesByChapterIdAndUserId(chapterId: string, userId: string): Promise<Episode[]> {
    const chapter = await this.findChapterByIdAndUserId(chapterId, userId);
    if (chapter === null) {
      return [];
    }

    return [...this.episodes.values()].filter((episode) => episode.chapterId === chapterId);
  }

  public async findEpisodeByIdAndUserId(id: string, userId: string): Promise<Episode | null> {
    const episode = this.episodes.get(id);
    if (episode === undefined) {
      return null;
    }

    const chapter = await this.findChapterByIdAndUserId(episode.chapterId, userId);
    return chapter === null ? null : episode;
  }

  public async updateEpisode(id: string, userId: string, input: UpdateEpisodeInput): Promise<Episode | null> {
    const episode = await this.findEpisodeByIdAndUserId(id, userId);
    if (episode === null) {
      return null;
    }

    const updatedEpisode: Episode = {
      ...episode,
      order: input.order ?? episode.order,
      title: input.title === undefined ? episode.title : input.title,
      purpose: input.purpose === undefined ? episode.purpose : input.purpose,
      introduction: input.introduction === undefined ? episode.introduction : input.introduction,
      middle: input.middle === undefined ? episode.middle : input.middle,
      climax: input.climax === undefined ? episode.climax : input.climax,
      endingHook: input.endingHook === undefined ? episode.endingHook : input.endingHook,
      estimatedPages: input.estimatedPages ?? episode.estimatedPages,
      entitiesInvolved: input.entitiesInvolved ?? episode.entitiesInvolved,
      status: input.status ?? episode.status,
      version: episode.version + 1,
      updatedAt: now,
    };
    this.episodes.set(id, updatedEpisode);
    return updatedEpisode;
  }

  public async deleteEpisode(id: string, userId: string): Promise<boolean> {
    const episode = await this.findEpisodeByIdAndUserId(id, userId);
    return episode === null ? false : this.episodes.delete(id);
  }
}

describe('StoryService', () => {
  it('作品を作成できる', async () => {
    const service = new StoryService(new FakeStoryRepository());

    const work = await service.createWork('user-1', {
      title: '黒月の騎士',
      genre: 'fantasy',
      worldSetting: null,
      theme: null,
      mainEntityIds: [],
      startingPoint: null,
      endingPoint: null,
      overallFlow: null,
    });

    expect(work.userId).toBe('user-1');
    expect(work.version).toBe(1);
    expect(work.status).toBe('draft');
  });

  it('作品更新の場合にversionが増える', async () => {
    const service = new StoryService(new FakeStoryRepository());
    const work = await service.createWork('user-1', {
      title: '黒月の騎士',
      genre: null,
      worldSetting: null,
      theme: null,
      mainEntityIds: [],
      startingPoint: null,
      endingPoint: null,
      overallFlow: null,
    });

    const updatedWork = await service.updateWork('user-1', work.id, {
      title: '黒月の騎士 改',
    });

    expect(updatedWork.title).toBe('黒月の騎士 改');
    expect(updatedWork.version).toBe(2);
  });

  it('所有していない作品への章追加の場合にNOT_FOUNDになる', async () => {
    const service = new StoryService(new FakeStoryRepository());

    await expect(
      service.createChapter('user-2', 'work-1', {
        order: 1,
        title: '第一章',
        purpose: null,
        startingState: null,
        endingState: null,
        emotionCurve: null,
        entitiesInvolved: [],
        keyBeats: [],
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' } satisfies Partial<AppError>);
  });

  it('所有している章へ話を追加できる', async () => {
    const service = new StoryService(new FakeStoryRepository());
    const work = await service.createWork('user-1', {
      title: '黒月の騎士',
      genre: null,
      worldSetting: null,
      theme: null,
      mainEntityIds: [],
      startingPoint: null,
      endingPoint: null,
      overallFlow: null,
    });
    const chapter = await service.createChapter('user-1', work.id, {
      order: 1,
      title: '第一章',
      purpose: null,
      startingState: null,
      endingState: null,
      emotionCurve: null,
      entitiesInvolved: [],
      keyBeats: [],
    });

    const episode = await service.createEpisode('user-1', chapter.id, {
      order: 1,
      title: '出会い',
      purpose: null,
      introduction: null,
      middle: null,
      climax: null,
      endingHook: null,
      estimatedPages: 16,
      entitiesInvolved: [],
    });

    expect(episode.chapterId).toBe(chapter.id);
    expect(episode.pageSkeletonGenerated).toBe(false);
  });

  it('別ユーザーの話更新の場合にNOT_FOUNDになる', async () => {
    const service = new StoryService(new FakeStoryRepository());
    const work = await service.createWork('user-1', {
      title: '黒月の騎士',
      genre: null,
      worldSetting: null,
      theme: null,
      mainEntityIds: [],
      startingPoint: null,
      endingPoint: null,
      overallFlow: null,
    });
    const chapter = await service.createChapter('user-1', work.id, {
      order: 1,
      title: null,
      purpose: null,
      startingState: null,
      endingState: null,
      emotionCurve: null,
      entitiesInvolved: [],
      keyBeats: [],
    });
    const episode = await service.createEpisode('user-1', chapter.id, {
      order: 1,
      title: null,
      purpose: null,
      introduction: null,
      middle: null,
      climax: null,
      endingHook: null,
      estimatedPages: 16,
      entitiesInvolved: [],
    });

    await expect(
      service.updateEpisode('user-2', episode.id, {
        title: '盗み見',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' } satisfies Partial<AppError>);
  });
});
