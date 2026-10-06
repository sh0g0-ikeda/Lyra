import { describe, expect, it } from 'vitest';
import { ConfigurationError } from '../../../src/domain/errors/index.js';
import type { DatabaseClient } from '../../../src/lib/db.js';
import { PostgresStoryRepository } from '../../../src/repositories/StoryRepository.js';

describe('PostgresStoryRepository legacy schema profile', () => {
  it('legacy profile は startingEntityStates を SQL 前に拒否する', async () => {
    const client = { query: async () => { throw new Error('SQL must not run'); } } as unknown as DatabaseClient;
    const repository = new PostgresStoryRepository(client, undefined, 'legacy_2debe_v1');
    await expect(repository.updateEpisode('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', {
      startingEntityStates: [],
    })).rejects.toBeInstanceOf(ConfigurationError);
  });
});
