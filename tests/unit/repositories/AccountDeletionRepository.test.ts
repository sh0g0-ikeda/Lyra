import { describe, expect, it } from 'vitest';
import type { QueryResult, QueryResultRow } from 'pg';
import { PostgresAccountDeletionRepository } from '../../../src/repositories/AccountDeletionRepository.js';
import type { DatabaseClient, TransactionRunner } from '../../../src/lib/db.js';

describe('PostgresAccountDeletionRepository', () => {
  it('flight は唯一 owner、個人 subscription、個人の確定済みアセットだけを照会する', async () => {
    const database = new RecordingDatabase();
    database.responses = [
      [{ id: 'org-1', name: 'Lyra Studio' }],
      [{ stripe_subscription_id: 'sub_123' }],
      [{ active_mobile_subscription_count: '1' }],
      [
        { s3_key: 'saved/user-1/entities/entity-1/ref-1.png' },
        { s3_key: 'saved/user-1/pages/page-1_final.png' },
      ],
    ];
    const repository = new PostgresAccountDeletionRepository(database, database);

    const flight = await repository.getFlight('user-1');

    expect(flight).toEqual({
      uniqueOwnerOrganizations: [{ id: 'org-1', name: 'Lyra Studio' }],
      activePersonalSubscriptionIds: ['sub_123'],
      activeMobileStoreSubscriptionCount: 1,
      confirmedAssetCount: 2,
      personalAssetKeys: [
        'saved/user-1/entities/entity-1/ref-1.png',
        'saved/user-1/pages/page-1_final.png',
      ],
    });
    expect(database.queries[0]).toContain("organization_members.role = 'owner'");
    expect(database.queries[0]).toContain("owner_members.status = 'active'");
    expect(database.queries[1]).toContain('organization_id IS NULL');
    expect(database.queries[2]).toContain('FROM mobile_store_purchases');
    expect(database.queries[2]).toContain("kind = 'subscription'");
    expect(database.queries[2]).toContain("state = 'active'");
    expect(database.queries[2]).toContain("state = 'cancelled'");
    expect(database.queries[2]).toContain('expires_at > NOW()');
    expect(database.queries[3]).toContain('works.organization_id IS NULL');
    expect(database.queries[3]).toContain("reference_sets.status IN ('partial', 'ready')");
    expect(database.queries[3]).toContain("pages.generated_image->>'s3_key'");
  });

  it('匿名化は個人作品だけを削除し、法人作品を削除せず user row を匿名化する', async () => {
    const database = new RecordingDatabase();
    const repository = new PostgresAccountDeletionRepository(database, database);

    await repository.anonymizePersonalData('user-1');

    expect(database.transactionCalls).toBe(1);
    expect(database.queries[0]).toContain('DELETE FROM works');
    expect(database.queries[0]).toContain('organization_id IS NULL');
    expect(database.queries).toContain('DELETE FROM organization_members WHERE user_id = $1');
    expect(database.queries.some((query) => query.includes('DELETE FROM users'))).toBe(false);
    expect(database.queries.some((query) => query.includes("supabase_id = 'deleted:' || id::text"))).toBe(true);
    expect(database.queries.some((query) => query.includes("email = 'deleted+' || id::text || '@invalid.local'"))).toBe(true);
  });
});

class RecordingDatabase implements DatabaseClient, TransactionRunner {
  public queries: string[] = [];
  public responses: Array<QueryResultRow[]> = [];
  public transactionCalls = 0;

  public async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    _values?: readonly unknown[],
  ): Promise<QueryResult<T>> {
    this.queries.push(text);
    const rows = (this.responses.shift() ?? []) as T[];
    return {
      command: 'SELECT',
      rowCount: rows.length,
      oid: 0,
      fields: [],
      rows,
    };
  }

  public async transaction<T>(work: (client: DatabaseClient) => Promise<T>): Promise<T> {
    this.transactionCalls += 1;
    return work(this);
  }
}
