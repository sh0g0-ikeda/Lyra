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

    if (this.violatedCheckName === 'payment_records.checkout_session_kind_status_unique') {
      return (
        text.includes('FROM payment_records') &&
        text.includes('stripe_checkout_session_id') &&
        text.includes('GROUP BY stripe_checkout_session_id, kind, status') &&
        text.includes('HAVING COUNT(*) > 1')
      );
    }

    if (this.violatedCheckName === 'generation_jobs.failed_page_missing_refund') {
      return (
        text.includes('FROM generation_jobs') &&
        text.includes("generation_jobs.job_type = 'page_generate'") &&
        text.includes("generation_jobs.status = 'failed'") &&
        text.includes('generation_jobs.credit_cost > 0') &&
        text.includes('FROM credit_ledger') &&
        text.includes("credit_ledger.type = 'consume'") &&
        text.includes("credit_ledger.type = 'refund'")
      );
    }

    if (this.violatedCheckName === 'generation_jobs.failed_entity_missing_refund') {
      return (
        text.includes('FROM generation_jobs') &&
        text.includes("generation_jobs.job_type = 'entity_generate'") &&
        text.includes("generation_jobs.status = 'failed'") &&
        text.includes('generation_jobs.credit_cost > 0') &&
        text.includes('FROM credit_ledger') &&
        text.includes("credit_ledger.type = 'consume'") &&
        text.includes("credit_ledger.type = 'refund'")
      );
    }

    if (this.violatedCheckName === 'generation_jobs.failed_page_under_refunded') {
      return (
        text.includes('FROM generation_jobs') &&
        text.includes("generation_jobs.job_type = 'page_generate'") &&
        text.includes("generation_jobs.status = 'failed'") &&
        text.includes("FILTER (WHERE credit_ledger.type = 'consume')") &&
        text.includes("FILTER (WHERE credit_ledger.type = 'refund'") &&
        text.includes('ABS(ledger.consumed_amount) > ledger.refunded_amount')
      );
    }

    if (this.violatedCheckName === 'generation_jobs.failed_entity_under_refunded') {
      return (
        text.includes('FROM generation_jobs') &&
        text.includes("generation_jobs.job_type = 'entity_generate'") &&
        text.includes("generation_jobs.status = 'failed'") &&
        text.includes("FILTER (WHERE credit_ledger.type = 'consume')") &&
        text.includes("FILTER (WHERE credit_ledger.type = 'refund'") &&
        text.includes('ABS(ledger.consumed_amount) > ledger.refunded_amount')
      );
    }

    if (this.violatedCheckName === 'credit_ledger.job_refund_over_consumed') {
      return (
        text.includes('FROM credit_ledger') &&
        text.includes('job_id IS NOT NULL') &&
        text.includes("FILTER (WHERE type = 'refund')") &&
        text.includes("FILTER (WHERE type = 'consume')") &&
        text.includes('refunded_amount > consumed_amount')
      );
    }

    if (this.violatedCheckName === 'generation_jobs.active_episode_story_autofill_resource_unique') {
      return (
        text.includes('FROM generation_jobs') &&
        text.includes("job_type = 'episode_story_autofill'") &&
        text.includes("status IN ('queued', 'processing')") &&
        text.includes("params ? 'episode_id'") &&
        text.includes("GROUP BY params->>'episode_id'") &&
        text.includes('HAVING COUNT(*) > 1')
      );
    }

    if (this.violatedCheckName === 'generation_jobs.active_episode_page_skeleton_resource_unique') {
      return (
        text.includes('FROM generation_jobs') &&
        text.includes("job_type = 'episode_page_skeleton'") &&
        text.includes("status IN ('queued', 'processing')") &&
        text.includes("params ? 'episode_id'") &&
        text.includes("GROUP BY params->>'episode_id'") &&
        text.includes('HAVING COUNT(*) > 1')
      );
    }

    if (this.violatedCheckName === 'database.invalid_indexes') {
      return text.includes('FROM pg_index') && text.includes('NOT pg_index.indisvalid');
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
    expect(
      database.queries.some((query) =>
        query.includes("type IN ('consume', 'purchase_reversal')") &&
        query.includes('amount < 0'),
      ),
    ).toBe(true);
    expect(database.queries.some((query) => query.includes('incomplete_expired'))).toBe(true);
    expect(
      database.queries.some((query) =>
        query.includes('(stripe_checkout_session_id IS NULL) = (stripe_invoice_id IS NULL)'),
      ),
    ).toBe(true);
    expect(
      database.queries.some((query) =>
        query.includes("job_type = 'page_generate'") &&
        query.includes("status IN ('queued', 'processing')") &&
        query.includes("GROUP BY params->>'page_id'"),
      ),
    ).toBe(true);
    expect(
      database.queries.some((query) =>
        query.includes(
          "job_type NOT IN ('page_generate', 'entity_generate', 'episode_story_autofill', 'episode_page_skeleton')",
        ),
      ),
    ).toBe(true);
    expect(
      database.queries.some((query) =>
        query.includes("job_type = 'episode_story_autofill'") &&
        query.includes("status IN ('queued', 'processing')") &&
        query.includes("GROUP BY params->>'episode_id'"),
      ),
    ).toBe(true);
    expect(
      database.queries.some((query) =>
        query.includes("job_type = 'episode_page_skeleton'") &&
        query.includes("status IN ('queued', 'processing')") &&
        query.includes("GROUP BY params->>'episode_id'"),
      ),
    ).toBe(true);
    expect(
      database.queries.some((query) =>
        query.includes('GROUP BY stripe_event_id') && query.includes('HAVING COUNT(*) > 1'),
      ),
    ).toBe(true);
    expect(
      database.queries.some((query) =>
        query.includes('FROM credit_ledger') &&
        query.includes('job_id IS NOT NULL') &&
        query.includes("FILTER (WHERE type = 'refund')") &&
        query.includes("FILTER (WHERE type = 'consume')") &&
        query.includes('refunded_amount > consumed_amount'),
      ),
    ).toBe(true);
    expect(
      database.queries.some((query) =>
        query.includes('GROUP BY stripe_checkout_session_id, kind, status') &&
        query.includes('HAVING COUNT(*) > 1'),
      ),
    ).toBe(true);
    expect(database.queries.some((query) => query.includes('MIN(id::text)'))).toBe(true);
    expect(database.queries.some((query) => query.includes('MIN(id)::text'))).toBe(false);
    expect(database.queries.some((query) => query.includes('ORDER BY MIN(id)'))).toBe(false);
    expect(
      database.queries.some((query) =>
        query.includes("generation_jobs.job_type = 'page_generate'") &&
        query.includes("generation_jobs.status = 'failed'") &&
        query.includes('generation_jobs.credit_cost > 0') &&
        query.includes("credit_ledger.type = 'consume'") &&
        query.includes('credit_ledger.job_id = generation_jobs.id') &&
        query.includes("credit_ledger.type = 'refund'"),
      ),
    ).toBe(true);
    expect(
      database.queries.some((query) =>
        query.includes("generation_jobs.job_type = 'entity_generate'") &&
        query.includes("generation_jobs.status = 'failed'") &&
        query.includes('generation_jobs.credit_cost > 0') &&
        query.includes("credit_ledger.type = 'consume'") &&
        query.includes('credit_ledger.job_id = generation_jobs.id') &&
        query.includes("credit_ledger.type = 'refund'"),
      ),
    ).toBe(true);
    expect(
      database.queries.some((query) =>
        query.includes("generation_jobs.job_type = 'page_generate'") &&
        query.includes("generation_jobs.status = 'failed'") &&
        query.includes("FILTER (WHERE credit_ledger.type = 'consume')") &&
        query.includes("FILTER (WHERE credit_ledger.type = 'refund'") &&
        query.includes('ABS(ledger.consumed_amount) > ledger.refunded_amount'),
      ),
    ).toBe(true);
    expect(
      database.queries.some((query) =>
        query.includes("generation_jobs.job_type = 'entity_generate'") &&
        query.includes("generation_jobs.status = 'failed'") &&
        query.includes("FILTER (WHERE credit_ledger.type = 'consume')") &&
        query.includes("FILTER (WHERE credit_ledger.type = 'refund'") &&
        query.includes('ABS(ledger.consumed_amount) > ledger.refunded_amount'),
      ),
    ).toBe(true);
    const failedJobLedgerQueries = database.queries.filter(
      (query) =>
        query.includes('FROM generation_jobs') &&
        query.includes("generation_jobs.status = 'failed'") &&
        query.includes('FROM credit_ledger'),
    );
    expect(failedJobLedgerQueries).toHaveLength(4);
    for (const query of failedJobLedgerQueries) {
      expect(query).toContain('generation_jobs.organization_id IS NULL');
      expect(query).toContain('credit_ledger.organization_id IS NULL');
      expect(query).toContain('credit_ledger.user_id = generation_jobs.user_id');
      expect(query).toContain('generation_jobs.organization_id IS NOT NULL');
      expect(query).toContain('credit_ledger.organization_id = generation_jobs.organization_id');
    }
    const refundOverConsumedQuery = database.queries.find(
      (query) =>
        query.includes('FROM credit_ledger') &&
        query.includes('refunded_amount > consumed_amount'),
    );
    expect(refundOverConsumedQuery).toBeDefined();
    expect(refundOverConsumedQuery).toContain('organization_id IS NULL');
    expect(refundOverConsumedQuery).toContain('GROUP BY user_id, job_id');
    expect(refundOverConsumedQuery).toContain('organization_id IS NOT NULL');
    expect(refundOverConsumedQuery).toContain('GROUP BY organization_id, job_id');
    expect(database.queries.some((query) => query.includes('FROM pg_index'))).toBe(true);
    expect(
      database.queries.some((query) =>
        query.includes('FROM mobile_store_purchases') &&
        query.includes("state NOT IN ('pending', 'active', 'cancelled', 'expired', 'refunded', 'revoked', 'failed')"),
      ),
    ).toBe(true);
    expect(
      database.queries.some((query) =>
        query.includes('FROM mobile_store_purchases') &&
        query.includes("kind = 'subscription'") &&
        query.includes("kind = 'credit_pack'"),
      ),
    ).toBe(true);
    expect(
      database.queries.some((query) =>
        query.includes('FROM mobile_store_purchase_events') &&
        query.includes("operation NOT IN ('observe', 'grant', 'reverse')"),
      ),
    ).toBe(true);
    expect(
      database.queries.some((query) =>
        query.includes('FROM credit_ledger') &&
        query.includes("'purchase_reversal'") &&
        query.includes('amount < 0'),
      ),
    ).toBe(true);
    expect(
      database.queries.some((query) =>
        query.includes('GROUP BY mobile_store_event_key') &&
        query.includes('HAVING COUNT(*) > 1'),
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

  it('unique index を壊す重複行があれば migration 前に検出する', async () => {
    const database = new FakeDatabase('payment_records.checkout_session_kind_status_unique');

    const report = await checkDeploymentDataInvariants(database);

    expect(report.ok).toBe(false);
    expect(report.violations).toContainEqual({
      name: 'payment_records.checkout_session_kind_status_unique',
      sampleIds: ['bad-row-1', 'bad-row-2'],
    });
  });

  it.each([
    'generation_jobs.failed_page_missing_refund',
    'generation_jobs.failed_entity_missing_refund',
    'generation_jobs.failed_page_under_refunded',
    'generation_jobs.failed_entity_under_refunded',
    'credit_ledger.job_refund_over_consumed',
    'generation_jobs.active_episode_story_autofill_resource_unique',
    'generation_jobs.active_episode_page_skeleton_resource_unique',
  ])('%s を検出する', async (checkName) => {
    const database = new FakeDatabase(checkName);

    const report = await checkDeploymentDataInvariants(database);

    expect(report.ok).toBe(false);
    expect(report.violations).toContainEqual({
      name: checkName,
      sampleIds: ['bad-row-1', 'bad-row-2'],
    });
  });

  it('CONCURRENTLY 失敗後の invalid index を検出する', async () => {
    const database = new FakeDatabase('database.invalid_indexes');

    const report = await checkDeploymentDataInvariants(database);

    expect(report.ok).toBe(false);
    expect(report.violations).toContainEqual({
      name: 'database.invalid_indexes',
      sampleIds: ['bad-row-1', 'bad-row-2'],
    });
  });
});
