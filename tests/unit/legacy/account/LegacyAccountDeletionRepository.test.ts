import type { QueryResult, QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';
import type { DatabaseClient, TransactionRunner } from '../../../../src/lib/db.js';
import { PostgresLegacyAccountDeletionRepository } from '../../../../src/legacy/account/LegacyAccountDeletionRepository.js';

class RecordingDatabase implements DatabaseClient, TransactionRunner {
  public readonly queries: Array<{ text: string; values: readonly unknown[] }> = [];
  public rows: QueryResultRow[] = [];
  public responses: QueryResultRow[][] = [];

  public async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<QueryResult<T>> {
    this.queries.push({ text, values });
    const rows = (this.responses.length > 0 ? this.responses.shift() ?? [] : this.rows.splice(0)) as T[];
    return { command: 'SELECT', rowCount: rows.length, oid: 0, fields: [], rows };
  }

  public async transaction<T>(work: (client: DatabaseClient) => Promise<T>): Promise<T> {
    return work(this);
  }
}

/**
 * Spec 11 design contract: old 027 remains the only persistence authority.
 * Candidate writes use the old claim protocol plus token CAS; they neither
 * reclaim processing rows nor reinterpret scheduled_asset_keys as deletion.
 */
describe('PostgresLegacyAccountDeletionRepository', () => {
  it('匿名化はusersからrequestの順にlockしてtoken CASを維持する', async () => {
    const database = new RecordingDatabase();
    database.responses = [
      [{ id: '11111111-1111-4111-8111-111111111111' }],
      [{ scheduled_asset_keys: [] }],
      [],
      [],
      [],
      [],
      [],
      [{ updated: true }],
    ];
    const repository = new PostgresLegacyAccountDeletionRepository(database, database);

    expect(await repository.anonymizePersonalData(
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
    )).toBe(true);

    expect(database.queries[0]?.text).toContain('FROM users WHERE id = $1::uuid FOR UPDATE');
    expect(database.queries[1]?.text).toContain('account_deletion_requests');
    expect(database.queries[1]?.text).toContain('processing_token = $2::uuid');
    expect(database.queries[1]?.text).toContain('FOR UPDATE');
  });

  it('claimはusersからrequestをlockしてからfresh flightを読む', async () => {
    const database = new RecordingDatabase();
    database.responses = [[], [], [], [], [], [], [], [], [], [{ count: '0' }], [], [], []];
    const repository = new PostgresLegacyAccountDeletionRepository(database, database);

    await repository.claimRequest({
      userId: '11111111-1111-4111-8111-111111111111',
      identityId: 'identity-user-1',
      processingToken: '22222222-2222-4222-8222-222222222222',
      acknowledgePersonalSubscriptions: true,
      acknowledgeStoreBilling: true,
      acknowledgePersonalAssets: true,
    });

    expect(database.queries[0]?.text).toContain('FROM users WHERE id = $1::uuid FOR NO KEY UPDATE');
    expect(database.queries[1]?.text).toContain('account_deletion_requests WHERE user_id = $1::uuid FOR UPDATE');
    expect(database.queries[2]?.text).toContain('FROM organization_members');
  });

  it('blockedの再記録はprocessingやcompletedをblockedへ戻さない', async () => {
    const database = new RecordingDatabase();
    database.rows = [{ updated: true }];
    const repository = new PostgresLegacyAccountDeletionRepository(database, database);

    await repository.recordBlocked('11111111-1111-4111-8111-111111111111', ['ACTIVE_PERSONAL_JOB']);

    const sql = database.queries.at(-1)?.text ?? '';
    expect(sql).toContain("account_deletion_requests.status = 'blocked'");
    expect(sql).not.toContain('next_retry_at');
    expect(sql).not.toContain('identity_key');
  });

  it('候補checkpointはprocessing token一致時だけ進める', async () => {
    const database = new RecordingDatabase();
    database.rows = [{ updated: true }];
    const repository = new PostgresLegacyAccountDeletionRepository(database, database);

    expect(await repository.markAssetScheduled(
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      'saved/user/page.png',
    )).toBe(true);

    const sql = database.queries.at(-1)?.text ?? '';
    expect(sql).toContain('processing_token = $2::uuid');
    expect(sql).toContain("status = 'processing'");
    expect(sql).toContain('scheduled_asset_keys');
    expect(sql).not.toContain('deleted_asset');
  });

  it('自動recoveryはpendingだけをclaimし10分超processingを再claimしない', async () => {
    const database = new RecordingDatabase();
    const repository = new PostgresLegacyAccountDeletionRepository(database, database);

    expect(await repository.claimNextPending('22222222-2222-4222-8222-222222222222')).toBeNull();

    const sql = database.queries.at(-1)?.text ?? '';
    expect(sql).toContain("status = 'pending_external_action'");
    expect(sql).toContain('NOT (user_id = ANY($2::uuid[]))');
    expect(sql).not.toContain("INTERVAL '10 minutes'");
    expect(sql).not.toContain("OR status = 'processing'");
  });
});
