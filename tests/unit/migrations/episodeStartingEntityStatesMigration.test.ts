import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('episode starting entity states migration', () => {
  it('開始状態を後方互換の空配列defaultと未検証constraintで追加する', async () => {
    const migration = await readFile(
      join(process.cwd(), 'migrations/041_add_episode_starting_entity_states.sql'),
      'utf8',
    );

    expect(migration).toContain('ADD COLUMN IF NOT EXISTS starting_entity_states JSONB DEFAULT \'[]\'::jsonb');
    expect(migration).toContain('jsonb_typeof(starting_entity_states) = \'array\'');
    expect(migration).toContain('jsonb_array_length(starting_entity_states) <= 100');
    expect(migration).toContain('NOT VALID');
  });
});
