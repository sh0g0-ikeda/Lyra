import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('entity state variants migration 040', () => {
  it('既存のnote-only状態を保持しながら追加列と未検証制約を加える', async () => {
    const sql = await readFile(
      join(process.cwd(), 'migrations', '040_add_entity_state_variants.sql'),
      'utf8',
    );

    expect(sql).toContain('ADD COLUMN IF NOT EXISTS name TEXT');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS description TEXT');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS reference_image JSONB');
    expect(sql).toContain('updated_at TIMESTAMPTZ DEFAULT NOW()');
    expect(sql).not.toContain('UPDATE entity_states');
    expect(sql).not.toContain('SET NOT NULL');
    expect(sql).toContain('entity_states_variant_name_description_check');
    expect(sql).toContain(') NOT VALID;');
    expect(sql).toContain("jsonb_typeof(reference_image) = 'object'");
  });
});
