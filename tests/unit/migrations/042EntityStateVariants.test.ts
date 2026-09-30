import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('042_add_entity_state_variants migration', () => {
  it('legacy stateを保ったままvariant列とupdated_atを追加する', async () => {
    const migration = await readFile(
      resolve(process.cwd(), 'migrations/042_add_entity_state_variants.sql'),
      'utf8',
    );

    expect(migration).toContain('ADD COLUMN IF NOT EXISTS name TEXT');
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS description TEXT');
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS reference_image JSONB');
    expect(migration).toContain('SET updated_at = created_at');
    expect(migration).toContain('entity_states_variant_name_description_check');
    expect(migration).toContain('name IS NOT NULL AND description IS NOT NULL');
  });
});
