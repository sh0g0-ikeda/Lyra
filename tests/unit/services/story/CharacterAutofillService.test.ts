import { describe, expect, it } from 'vitest';
import { ResourceStaleError } from '../../../../src/domain/errors/index.js';
import type { Episode } from '../../../../src/domain/types/story.js';
import type {
  CharacterAutofillRepository,
  SaveCharacterAutofillCandidatesInput,
} from '../../../../src/repositories/CharacterAutofillRepository.js';
import type { StoryRepository } from '../../../../src/repositories/StoryRepository.js';
import {
  CharacterAutofillService,
  type CharacterAutofillExtractor,
} from '../../../../src/services/story/CharacterAutofillService.js';
import type { StoryAiClientPort } from '../../../../src/services/story/StoryAiClientPort.js';

describe('CharacterAutofillService', () => {
  it('抽出の前後と保存境界で同じ話versionを引き渡す', async () => {
    const repository = new FakeCharacterAutofillRepository();
    const extractor: CharacterAutofillExtractor = async (_client, episode) => ({ candidates: [{
      name: 'ミオ', entityType: 'character', freeDescription: episode.storyFullDraft,
      structuredFields: {}, changes: [],
    }], unresolved: [{quote:'目は緑色。',reason:'ambiguous_character'}] });
    const service = new CharacterAutofillService(
      storyRepository([episode(4), episode(4)]),
      {} as StoryAiClientPort,
      repository,
      extractor,
    );

    await expect(service.autofillEpisodeCharacters('user', 'episode', 4, null)).resolves.toEqual({
      version: 4,
      characters: [],
      skipped_names: [],
    });
    expect(repository.input).toMatchObject({
      userId: 'user', episodeId: 'episode', version: 4, organizationId: null,
      candidates: [{ name: 'ミオ', freeDescription: 'ミオが立つ。' }],
    });
    expect(repository.input).not.toHaveProperty('review');
  });

  it('抽出中に話が更新された場合は保存を一度も呼ばない', async () => {
    const repository = new FakeCharacterAutofillRepository();
    let extracted = 0;
    const service = new CharacterAutofillService(
      storyRepository([episode(4), episode(5)]),
      {} as StoryAiClientPort,
      repository,
      async () => {
        extracted += 1;
        return { candidates: [], unresolved: [] };
      },
    );

    await expect(service.autofillEpisodeCharacters('user', 'episode', 4, null))
      .rejects.toBeInstanceOf(ResourceStaleError);
    expect(extracted).toBe(1);
    expect(repository.input).toBeNull();
  });
  it('対応クライアントだけに同じ版の未確定の原文を引き渡す', async () => {
    const repository = new FakeCharacterAutofillRepository();
    const unresolved = [{quote:'その目は緑色。',reason:'ambiguous_character' as const}];
    const service = new CharacterAutofillService(storyRepository([episode(2),episode(2)]),
      {} as StoryAiClientPort, repository, async () => ({candidates:[],unresolved}));
    await service.autofillEpisodeCharacters('user','episode',2,null,true);
    expect(repository.input?.review).toEqual({unresolved});
  });
});

class FakeCharacterAutofillRepository implements CharacterAutofillRepository {
  public input: SaveCharacterAutofillCandidatesInput | null = null;

  public async saveCandidates(input: SaveCharacterAutofillCandidatesInput) {
    this.input = input;
    return { version: input.version, characters: [], skipped_names: [] };
  }
}

function storyRepository(episodes: Episode[]): StoryRepository {
  let index = 0;
  return {
    findEpisodeByIdAndUserId: async () => episodes[index++] ?? null,
  } as unknown as StoryRepository;
}

function episode(version: number): Episode {
  const date = new Date('2026-11-20T00:00:00.000Z');
  return {
    id: 'episode', chapterId: 'chapter', order: 1, title: null, purpose: null,
    storyInputMode: 'full', storyFullDraft: 'ミオが立つ。', introduction: null,
    middle: null, climax: null, endingHook: null, estimatedPages: 1,
    entitiesInvolved: [], pageSkeletonGenerated: false, version, editHistory: [],
    status: 'draft', createdAt: date, updatedAt: date,
  };
}
