import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('minimal release metadata query', () => {
  it('読取専用transactionと短いtimeoutで履歴と集計だけを取得する', async () => {
    const sql = await readFile(join(process.cwd(), 'ops/release/readOnlyReleaseMetadata.sql'), 'utf8');
    const statements = sql.replace(/^--.*$/gmu, '').split(';').map((entry) => entry.trim()).filter(Boolean);
    expect(statements[0]).toBe('BEGIN TRANSACTION READ ONLY');
    expect(statements.at(-1)).toBe('COMMIT');
    expect(statements.filter((entry) => entry.startsWith('SELECT'))).toHaveLength(2);
    expect(statements.every((entry) => /^(BEGIN TRANSACTION READ ONLY|SET LOCAL|SELECT|COMMIT)\b/u.test(entry))).toBe(true);
    expect(sql).toContain("lock_timeout = '1s'");
    expect(sql).toContain("statement_timeout = '5s'");
    expect(sql).not.toMatch(/SELECT\s+\*/iu);
    expect(sql).not.toContain('get-secret-value');
    expect(sql).toContain('n_live_tup AS estimated_rows');
  });
});
