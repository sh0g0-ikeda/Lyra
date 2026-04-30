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
    workTitle: 'Lyra',
    chapterTitle: 'Chapter 1',
    episodeTitle: 'Episode 1',
    payload: {
      purpose: 'Introduce the rivalry',
      estimated_pages: 16,
    },
    entities: [
      {
        id: '11111111-1111-4111-8111-111111111111',
        name: 'Aki',
        entityType: 'character',
        freeDescription: 'Black-haired swordswoman',
      },
    ],
    sceneSummaries: ['Scene 1: Rooftop / night / tense'],
  };

  public async findWorksByUserId(): Promise<Work[]> {
    return [];
  }

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
  public collaborationChunks = ['chunk-one', 'chunk-two'];

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
  it('builds a collaboration prompt with scenes and entity context', async () => {
    const repository = new FakeStoryRepository();
    const client = new FakeStoryAiClient();
    const service = new StoryCollaborationService(repository, client);

    const stream = await service.collaborate('user-1', {
      layer: 'episode',
      targetId: '33333333-3333-4333-8333-333333333333',
      instruction: 'Tighten the confrontation.',
      context: {
        currentDraft: 'Aki reaches the rooftop.',
        selectedText: null,
        userNotes: 'Keep the emotional temperature high.',
        focusPoints: ['rival reveal'],
        constraints: ['preserve continuity'],
      },
    });

    const chunks: string[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual(['chunk-one', 'chunk-two']);
    expect(client.lastRequest?.systemPrompt).toContain('Target layer: episode');
    expect(client.lastRequest?.userPrompt).toContain('Aki');
    expect(client.lastRequest?.userPrompt).toContain('Scene 1: Rooftop / night / tense');
    expect(client.lastRequest?.userPrompt).toContain('rival reveal');
  });

  it('throws NOT_FOUND when the target does not exist', async () => {
    const repository = new FakeStoryRepository();
    repository.collaborationTarget = null;
    const service = new StoryCollaborationService(repository, new FakeStoryAiClient());

    await expect(
      service.collaborate('user-1', {
        layer: 'episode',
        targetId: '33333333-3333-4333-8333-333333333333',
        instruction: 'Revise this.',
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

  it('rejects oversized input context', async () => {
    const service = new StoryCollaborationService(new FakeStoryRepository(), new FakeStoryAiClient());

    await expect(
      service.collaborate('user-1', {
        layer: 'episode',
        targetId: '33333333-3333-4333-8333-333333333333',
        instruction: 'Revise this.',
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

  it('rejects oversized streamed output', async () => {
    const client = new FakeStoryAiClient();
    client.collaborationChunks = ['a'.repeat(25000)];
    const service = new StoryCollaborationService(new FakeStoryRepository(), client);

    const stream = await service.collaborate('user-1', {
      layer: 'episode',
      targetId: '33333333-3333-4333-8333-333333333333',
      instruction: 'Revise this.',
      context: {
        currentDraft: null,
        selectedText: null,
        userNotes: null,
        focusPoints: [],
        constraints: [],
      },
    });

    await expect(
      (async () => {
        for await (const _chunk of stream) {
          // no-op
        }
      })(),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});
