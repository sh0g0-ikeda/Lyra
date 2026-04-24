import { describe, expect, it } from 'vitest';
import type { StoryRepository } from '../../../../src/repositories/StoryRepository.js';
import { StoryCollaborationService } from '../../../../src/services/story/StoryCollaborationService.js';
import type { StoryAiClientPort, StoryAiModelRequest } from '../../../../src/infrastructure/anthropic/AnthropicStoryAiClient.js';
import type {
  EpisodePageSkeletonContext,
  PageSkeletonPageDraft,
  PageSkeletonPersistResult,
  StoryCollaborationLayer,
  StoryCollaborationTarget,
} from '../../../../src/domain/types/storyAi.js';
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
} from '../../../../src/repositories/StoryRepository.js';

class FakeStoryRepository implements StoryRepository {
  public collaborationTarget: StoryCollaborationTarget | null = {
    layer: 'episode',
    targetId: '33333333-3333-4333-8333-333333333333',
    workId: 'work-1',
    workTitle: '作品',
    chapterTitle: '第一章',
    episodeTitle: '第一話',
    payload: {
      purpose: '導入',
      estimated_pages: 16,
    },
    entities: [
      {
        id: '11111111-1111-4111-8111-111111111111',
        name: '主人公',
        entityType: 'character',
        freeDescription: '冷静',
      },
    ],
  };

  public async createWork(_userId: string, _input: CreateWorkInput): Promise<Work> {
    throw new Error('not implemented');
  }
  public async findWorkByIdAndUserId(_id: string, _userId: string): Promise<Work | null> {
    throw new Error('not implemented');
  }
  public async updateWork(_id: string, _userId: string, _input: UpdateWorkInput): Promise<Work | null> {
    throw new Error('not implemented');
  }
  public async createChapter(_workId: string, _input: CreateChapterInput): Promise<Chapter> {
    throw new Error('not implemented');
  }
  public async findChaptersByWorkIdAndUserId(_workId: string, _userId: string): Promise<Chapter[]> {
    throw new Error('not implemented');
  }
  public async findChapterByIdAndUserId(_id: string, _userId: string): Promise<Chapter | null> {
    throw new Error('not implemented');
  }
  public async updateChapter(_id: string, _userId: string, _input: UpdateChapterInput): Promise<Chapter | null> {
    throw new Error('not implemented');
  }
  public async deleteChapter(_id: string, _userId: string): Promise<boolean> {
    throw new Error('not implemented');
  }
  public async createEpisode(_chapterId: string, _input: CreateEpisodeInput): Promise<Episode> {
    throw new Error('not implemented');
  }
  public async findEpisodesByChapterIdAndUserId(_chapterId: string, _userId: string): Promise<Episode[]> {
    throw new Error('not implemented');
  }
  public async findEpisodeByIdAndUserId(_id: string, _userId: string): Promise<Episode | null> {
    throw new Error('not implemented');
  }
  public async updateEpisode(_id: string, _userId: string, _input: UpdateEpisodeInput): Promise<Episode | null> {
    throw new Error('not implemented');
  }
  public async deleteEpisode(_id: string, _userId: string): Promise<boolean> {
    throw new Error('not implemented');
  }
  public async findCollaborationTargetByIdAndUserId(
    _layer: StoryCollaborationLayer,
    _targetId: string,
    _userId: string,
  ): Promise<StoryCollaborationTarget | null> {
    return this.collaborationTarget;
  }
  public async findEpisodePageSkeletonContextByIdAndUserId(
    _episodeId: string,
    _userId: string,
  ): Promise<EpisodePageSkeletonContext | null> {
    throw new Error('not implemented');
  }
  public async createPageSkeleton(
    _episodeId: string,
    _userId: string,
    _pages: PageSkeletonPageDraft[],
  ): Promise<PageSkeletonPersistResult | null> {
    throw new Error('not implemented');
  }
}

class FakeStoryAiClient implements StoryAiClientPort {
  public lastRequest: StoryAiModelRequest | null = null;
  public collaborationChunks = ['前半', '後半'];

  public streamCollaboration(request: StoryAiModelRequest): AsyncIterable<string> {
    this.lastRequest = request;
    const chunks = this.collaborationChunks;

    return (async function* streamChunks(): AsyncGenerator<string, void, void> {
      for (const chunk of chunks) {
        yield chunk;
      }
    })();
  }

  public async generatePageSkeleton(_request: StoryAiModelRequest): Promise<PageSkeletonPageDraft[]> {
    throw new Error('not implemented');
  }
}

describe('StoryCollaborationService', () => {
  it('対象が存在する場合は Claude へのストリームを返す', async () => {
    const repository = new FakeStoryRepository();
    const client = new FakeStoryAiClient();
    const service = new StoryCollaborationService(repository, client);

    const stream = await service.collaborate('user-1', {
      layer: 'episode',
      targetId: '33333333-3333-4333-8333-333333333333',
      instruction: '導入を少し静かに整えて',
      context: {
        currentDraft: '主人公が廊下を歩いている。',
        selectedText: null,
        userNotes: '温度感は低め',
        focusPoints: ['静かな導入'],
        constraints: ['設定は変えない'],
      },
    });

    const chunks: string[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual(['前半', '後半']);
    expect(client.lastRequest?.systemPrompt).toContain('Target layer: episode');
    expect(client.lastRequest?.userPrompt).toContain('主人公');
    expect(client.lastRequest?.userPrompt).toContain('静かな導入');
  });

  it('対象が存在しない場合は NOT_FOUND になる', async () => {
    const repository = new FakeStoryRepository();
    repository.collaborationTarget = null;
    const service = new StoryCollaborationService(repository, new FakeStoryAiClient());

    await expect(
      service.collaborate('user-1', {
        layer: 'episode',
        targetId: '33333333-3333-4333-8333-333333333333',
        instruction: '整えて',
        context: {
          currentDraft: null,
          selectedText: null,
          userNotes: null,
          focusPoints: [],
          constraints: [],
        },
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('過大な文脈は VALIDATION_ERROR になる', async () => {
    const service = new StoryCollaborationService(new FakeStoryRepository(), new FakeStoryAiClient());

    await expect(
      service.collaborate('user-1', {
        layer: 'episode',
        targetId: '33333333-3333-4333-8333-333333333333',
        instruction: '整えて',
        context: {
          currentDraft: 'a'.repeat(28000),
          selectedText: null,
          userNotes: null,
          focusPoints: [],
          constraints: [],
        },
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('過大なストリーム出力は VALIDATION_ERROR になる', async () => {
    const client = new FakeStoryAiClient();
    client.collaborationChunks = ['a'.repeat(25000)];
    const service = new StoryCollaborationService(new FakeStoryRepository(), client);

    const stream = await service.collaborate('user-1', {
      layer: 'episode',
      targetId: '33333333-3333-4333-8333-333333333333',
      instruction: '整えて',
      context: {
        currentDraft: null,
        selectedText: null,
        userNotes: null,
        focusPoints: [],
        constraints: [],
      },
    });

    await expect((async () => {
      for await (const _chunk of stream) {
        // no-op
      }
    })()).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});
