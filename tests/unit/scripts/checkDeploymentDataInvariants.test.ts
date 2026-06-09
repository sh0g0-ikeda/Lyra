import { describe, expect, it } from 'vitest';
import type { QueryResult, QueryResultRow } from 'pg';
import { checkDeploymentDataInvariants } from '../../../scripts/checkDeploymentDataInvariants.js';
import type { DatabaseClient } from '../../../src/lib/db.js';

class FakeDatabase implements DatabaseClient {
  public readonly queries: string[] = [];

  public constructor(private readonly violatedCheckName: string | null = null) {}

  public async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
  ): Promise<QueryResult<T>> {
    this.queries.push(text);
    const rows = this.matchesViolatedCheck(text)
      ? [{ id: 'bad-row-1' }, { id: 'bad-row-2' }]
      : [];

    return {
      command: 'SELECT',
      rowCount: rows.length,
      oid: 0,
      fields: [],
      rows: rows as unknown as T[],
    };
  }

  private matchesViolatedCheck(text: string): boolean {
    if (this.violatedCheckName === null) {
      return false;
    }

    const [tableName, columnName] = this.violatedCheckName.split('.');
    return text.includes(`FROM ${tableName}`) && text.includes(columnName);
  }
}

describe('checkDeploymentDataInvariants', () => {
  it('DB 不変条件の違反がなければ ok を返す', async () => {
    const database = new FakeDatabase();

    const report = await checkDeploymentDataInvariants(database);

    expect(report.ok).toBe(true);
    expect(report.violations).toEqual([]);
    expect(report.checkedCount).toBeGreaterThan(20);
    expect(database.queries.some((query) => query.includes('generation_jobs'))).toBe(true);
    expect(database.queries.some((query) => query.includes('credit_ledger'))).toBe(true);
    expect(database.queries.some((query) => query.includes("type = 'consume' AND amount < 0"))).toBe(true);
    expect(database.queries.some((query) => query.includes('incomplete_expired'))).toBe(true);
    expect(
      database.queries.some((query) =>
        query.includes('(stripe_checkout_session_id IS NULL) = (stripe_invoice_id IS NULL)'),
      ),
    ).toBe(true);
  });

  it('違反行があればチェック名とサンプル ID を返す', async () => {
    const database = new FakeDatabase('pages.status');

    const report = await checkDeploymentDataInvariants(database);

    expect(report.ok).toBe(false);
    expect(report.violations).toEqual([
      {
        name: 'pages.status',
        sampleIds: ['bad-row-1', 'bad-row-2'],
      },
    ]);
  });
});
