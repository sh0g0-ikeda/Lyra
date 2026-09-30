import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('043_add_episode_starting_entity_states migration', () => {
  it('既存episodeを空の開始状態として保持し最大件数を制限する', async () => {
    const sql = await readFile(
      resolve(process.cwd(), 'migrations/043_add_episode_starting_entity_states.sql'),
      'utf8',
    );

    expect(sql).toContain('starting_entity_states JSONB NOT NULL DEFAULT');
    expect(sql).toContain("jsonb_typeof(starting_entity_states) = 'array'");
    expect(sql).toContain('jsonb_array_length(starting_entity_states) <= 100');
  });
});
