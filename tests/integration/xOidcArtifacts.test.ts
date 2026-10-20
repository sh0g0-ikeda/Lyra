import { randomUUID, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgresXOidcArtifactRepository } from '../../src/repositories/XOidcArtifactRepository.js';
const dbDescribe = process.env.APP_ENV === 'test' && process.env.DATABASE_URL ? describe : describe.skip;
dbDescribe('X認証artifactのDB競合と期限', () => {
  let admin: Pool, pool: Pool, repository: PostgresXOidcArtifactRepository;
  const schema = `x_oidc_${randomUUID().replaceAll('-', '')}`;
  beforeAll(async () => {
    admin = new Pool({ connectionString: process.env.DATABASE_URL });
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString: process.env.DATABASE_URL, options: `-c search_path=${schema},public` });
    await pool.query(await readFile('migrations/052_add_x_oidc_artifacts.sql', 'utf8'));
    repository = new PostgresXOidcArtifactRepository(pool);
  });
  afterAll(async () => { if (pool) await pool.end(); if (admin) { await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); } });
  it.each(['state', 'code'] as const)('%sが同時に引き換えられた場合に成功は1件だけになる', async kind => {
    const hash = freshHash();
    await repository.save({ kind, hash, bindingHash: 'browser', ciphertext: 'encrypted', expiresAt: new Date(Date.now() + 60000) });
    const results = await Promise.all(Array.from({ length: 8 }, () => repository.consume(kind, hash, 'browser')));
    expect(results.filter(Boolean)).toHaveLength(1);
  });
  it('別ブラウザーや期限切れの場合に消費できない', async () => {
    const hash = freshHash();
    await repository.save({ kind: 'state', hash, bindingHash: 'browser', ciphertext: 'encrypted', expiresAt: new Date(Date.now() + 60000) });
    expect(await repository.consume('state', hash, 'wrong')).toBeNull();
    expect(await repository.find('state', hash, 'browser')).not.toBeNull();
    await pool.query('UPDATE x_oidc_artifacts SET expires_at=NOW()-INTERVAL \'1 second\' WHERE token_hash=$1', [hash]);
    expect(await repository.consume('state', hash, 'browser')).toBeNull();
  });
  it('メール確認が同時に5回失敗した場合に正しいコードでも拒否する', async () => {
    const hash = freshHash();
    await repository.save({ kind: 'email', hash, bindingHash: 'browser', ciphertext: 'encrypted', proofHash: 'correct', expiresAt: new Date(Date.now() + 60000) });
    await Promise.all(Array.from({ length: 12 }, () => repository.consume('email', hash, 'browser', 'wrong')));
    expect((await pool.query('SELECT attempts FROM x_oidc_artifacts WHERE token_hash=$1', [hash])).rows[0].attempts).toBe(5);
    expect(await repository.consume('email', hash, 'browser', 'correct')).toBeNull();
  });
  it('同じメールへの同時送信予約を1件に制限し期限後に解放する', async () => {
    const hash = freshHash();
    expect((await Promise.all(Array.from({ length: 8 }, () => repository.reserveEmailDelivery(hash)))).filter(Boolean)).toHaveLength(1);
    await pool.query('UPDATE x_oidc_artifacts SET expires_at=NOW()-INTERVAL \'1 second\' WHERE token_hash=$1', [hash]);
    expect(await repository.reserveEmailDelivery(hash)).toBe(true);
  });
});
function freshHash(): string { return createHash('sha256').update(randomUUID()).digest('hex'); }
