import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('030 mobile push token registry migration', () => {
  it('個人user所有・暗号化保存・token dedupeをdatabase制約にする', async () => {
    const sql = await readFile(
      join(process.cwd(), 'migrations', '033_add_mobile_push_token_registry.sql'),
      'utf8',
    );
    const normalized = sql.toLowerCase();

    expect(normalized).toContain('create table if not exists mobile_push_tokens');
    expect(normalized).toContain('user_id uuid not null references users(id) on delete cascade');
    expect(normalized).not.toContain('organization_id');
    expect(normalized).toContain('token_ciphertext text not null');
    expect(normalized).toContain('token_hash text not null');
    expect(normalized).toContain('encryption_key_id text not null');
    expect(normalized).toContain('unique (token_hash)');
    expect(normalized).toContain('unique (user_id, installation_id)');
    expect(normalized).toContain("platform in ('ios', 'android')");
    expect(normalized).toContain('octet_length(token_ciphertext)');
    expect(normalized).toContain('octet_length(token_hash)');
    expect(normalized).not.toMatch(/\bdevice_token\s+text\b/u);
  });
});
