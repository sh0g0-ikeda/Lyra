import { describe, expect, it, vi } from 'vitest';
import { PostgresXOidcArtifactRepository } from '../../../src/repositories/XOidcArtifactRepository.js';

describe('X認証の一回限りの保存', () => {
  it('引き換える場合に期限とブラウザーの一致と試行上限を同じ削除条件に含める', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    const repository = new PostgresXOidcArtifactRepository({ query });
    expect(await repository.consume('email', 'hash', 'browser', 'proof')).toBeNull();
    expect(query.mock.calls[0][0]).toContain('DELETE FROM x_oidc_artifacts');
    expect(query.mock.calls[0][0]).toContain('expires_at > NOW()');
    expect(query.mock.calls[0][0]).toContain('attempts < 5');
    expect(query.mock.calls[0][1]).toEqual(['email', 'hash', 'browser', 'proof']);
    expect(query.mock.calls[1][0]).toContain('attempts = attempts + 1');
  });
});
