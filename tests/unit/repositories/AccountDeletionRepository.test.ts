import type { QueryResult, QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';
import type { DatabaseClient, TransactionRunner } from '../../../src/lib/db.js';
import { PostgresAccountDeletionRepository } from '../../../src/repositories/AccountDeletionRepository.js';

class RecordingDatabase implements DatabaseClient, TransactionRunner {
  public readonly calls: Array<{
    sql: string;
    values: readonly unknown[];
  }> = [];
  public finalizeMode = false;

  public async transaction<T>(
    work: (client: DatabaseClient) => Promise<T>,
  ): Promise<T> {
    return work(this);
  }

  public async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<QueryResult<T>> {
    this.calls.push({ sql: text, values });
    let rows: QueryResultRow[] = [];
    if (this.finalizeMode && text.includes('SELECT account_deletion_started_at')) {
      rows = [{
        account_deletion_started_at: new Date('2026-07-31T00:00:00.000Z'),
        account_deleted_at: null,
      }];
    } else if (
      this.finalizeMode
      && text.includes('FROM account_deletion_requests')
      && text.includes('FOR UPDATE')
    ) {
      rows = [{
        user_id: 'user-1',
        identity_id: 'cognito-sub-1',
        status: 'processing',
        processing_token: '00000000-0000-4000-8000-000000000001',
        cancelled_subscription_ids: [],
        scheduled_asset_keys: [],
        data_anonymized_at: null,
        identity_disabled_at: null,
        identity_deleted_at: null,
      }];
    } else if (this.finalizeMode && text.includes('SELECT email FROM users')) {
      rows = [{ email: 'owner@example.com' }];
    } else if (
      text.includes('FROM organization_members')
      && text.includes('LIMIT 25')
      && !this.finalizeMode
    ) {
      rows = [{ id: 'org-1', name: 'Studio' }];
    } else if (text.includes('SELECT stripe_subscription_id') && !this.finalizeMode) {
      rows = [{ stripe_subscription_id: 'sub-1' }];
    } else if (text.includes('FROM mobile_store_purchases') && !this.finalizeMode) {
      rows = [
        {
          store: 'apple',
          expires_at: new Date('2026-08-31T00:00:00.000Z'),
          auto_renew_enabled: true,
        },
      ];
    } else if (
      text.includes('FROM generation_jobs')
      && text.includes("status IN ('queued', 'processing')")
      && !this.finalizeMode
    ) {
      rows = [{ count: '2' }];
    } else if (
      text.includes('FROM episode_export_jobs')
      && text.includes("status IN ('queued', 'processing')")
      && !this.finalizeMode
    ) {
      rows = [{ count: '1' }];
    } else if (text.includes('WITH personal_works AS') && !this.finalizeMode) {
      rows = [{ s3_key: 'users/u1/pages/p1.webp' }];
    }
    return {
      command: text.trimStart().split(/\s+/u)[0] ?? 'SELECT',
      rowCount: text.includes('UPDATE account_deletion_requests') ? 1 : rows.length,
      oid: 0,
      fields: [],
      rows: rows as T[],
    };
  }
}

describe('PostgresAccountDeletionRepository', () => {
  it('previewはpersonal scopeの購読・job・全asset sourceだけを集計する', async () => {
    const database = new RecordingDatabase();
    const repository = new PostgresAccountDeletionRepository(database, database);

    const flight = await repository.getFlight('user-1');

    expect(flight).toMatchObject({
      activePersonalStripeSubscriptionIds: ['sub-1'],
      activePersonalGenerationJobCount: 2,
      activePersonalExportJobCount: 1,
      personalAssetKeys: ['users/u1/pages/p1.webp'],
    });
    const sql = database.calls.map((call) => call.sql).join('\n');
    expect(sql).toContain('subscriptions');
    expect(sql).toContain('organization_id IS NULL');
    expect(sql).toContain('personal_page_images');
    expect(sql).toContain('personal_reference_images');
    expect(sql).toContain('personal_job_candidates');
    expect(sql).toContain('personal_uploads');
    expect(sql).toContain('personal_exports');
    expect(sql).toContain("status NOT IN ('canceled', 'incomplete_expired')");
    expect(sql).toContain("state IN ('pending', 'active')");
  });

  it('checkpoint更新はuser・processing token・exact valueでfenceする', async () => {
    const database = new RecordingDatabase();
    const repository = new PostgresAccountDeletionRepository(database, database);

    await repository.markAssetDeleted(
      'user-1',
      '00000000-0000-4000-8000-000000000001',
      'users/u1/pages/p1.webp',
    );

    const call = database.calls.at(-1);
    expect(call?.sql).toContain('processing_token = $2::uuid');
    expect(call?.sql).not.toContain('users/u1/pages/p1.webp');
    expect(call?.values).toEqual([
      'user-1',
      '00000000-0000-4000-8000-000000000001',
      'users/u1/pages/p1.webp',
    ]);
  });

  it('continuation releaseはretry回数を増やさず即時recovery可能にする', async () => {
    const database = new RecordingDatabase();
    const repository = new PostgresAccountDeletionRepository(database, database);

    await repository.releaseForContinuation(
      'user-1',
      '00000000-0000-4000-8000-000000000001',
    );

    const call = database.calls.at(-1);
    expect(call?.sql).toContain("status = 'pending_external_action'");
    expect(call?.sql).toContain('next_retry_at = NOW()');
    expect(call?.sql).not.toContain('retry_count = retry_count + 1');
    expect(call?.values).toEqual([
      'user-1',
      '00000000-0000-4000-8000-000000000001',
    ]);
  });

  it('identity guard lookupはHMAC keyだけをparameter bindingする', async () => {
    const database = new RecordingDatabase();
    const repository = new PostgresAccountDeletionRepository(database, database);

    await repository.hasBlockedIdentityKey('a'.repeat(43));

    expect(database.calls.at(-1)?.values).toEqual(['a'.repeat(43)]);
    expect(database.calls.at(-1)?.sql).toContain(
      "status IN ('processing', 'pending_external_action', 'completed')",
    );
  });

  it('完了時は外部処理checkpointを消してidentity tombstoneだけを残す', async () => {
    const database = new RecordingDatabase();
    const repository = new PostgresAccountDeletionRepository(database, database);

    await repository.markCompleted(
      'user-1',
      '00000000-0000-4000-8000-000000000001',
    );

    const call = database.calls.at(-1);
    expect(call?.sql).toContain("cancelled_subscription_ids = '{}'");
    expect(call?.sql).toContain("scheduled_asset_keys = '{}'");
    expect(call?.sql).toContain("identity_id = 'deleted:' || user_id::text");
  });

  it('personal data確定はpush token registryを直列化して未送信deliveryを停止する', async () => {
    const database = new RecordingDatabase();
    database.finalizeMode = true;
    const repository = new PostgresAccountDeletionRepository(database, database);

    const result = await repository.finalizePersonalData(
      'user-1',
      '00000000-0000-4000-8000-000000000001',
    );

    expect(result).toEqual({ kind: 'completed' });
    const sql = database.calls.map((call) => call.sql).join('\n');
    expect(sql).toContain('pg_advisory_xact_lock');
    expect(sql).toContain('UPDATE mobile_push_notification_deliveries');
    expect(sql).toContain("status = 'canceled'");
    expect(sql.indexOf('pg_advisory_xact_lock')).toBeLessThan(
      sql.indexOf('DELETE FROM mobile_push_tokens'),
    );
  });
});
