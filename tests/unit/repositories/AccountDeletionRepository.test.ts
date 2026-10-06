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
  public personalStateReferenceCount = 0;

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
    } else if (text.includes('FROM state_reference_copy_attempts') && text.includes('COUNT(*)')) {
      rows = [{ count: String(this.personalStateReferenceCount) }];
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
    expect(sql).toContain('personal_entity_state_reference_images');
    expect(sql).toContain('INNER JOIN entities ON entities.id = entity_states.entity_id');
    expect(sql).toContain('jsonb_typeof(entity_states.reference_image) = \'object\'');
    expect(sql).toContain('personal_job_candidates');
    expect(sql).toContain('personal_job_input_reference_images');
    expect(sql).toContain("generation_jobs.result->'input_snapshot'->'references'");
    expect(sql).toContain("generation_jobs.job_type = 'page_generate'");
    expect(sql).toContain('personal_state_reference_copies');
    expect(sql).toContain("generation_jobs.result->'state_reference_copies'");
    expect(sql).toContain('personal_uploads');
    expect(sql).toContain('personal_exports');
    expect(sql).toContain("status NOT IN ('canceled', 'incomplete_expired')");
    expect(sql).toContain("state IN ('pending', 'active')");
  });

  it('counts personal unfenced v2 evidence separately and excludes its namespace after every inventory union', async () => {
    const database = new RecordingDatabase(); database.personalStateReferenceCount = 3;
    const repository = new PostgresAccountDeletionRepository(database, database);
    expect(await repository.getFlight('user-1')).toMatchObject({ personalStateReferenceCount: 3, activePersonalGenerationJobCount: 2 });
    const count = database.calls.find((call) => call.sql.includes('FROM state_reference_copy_attempts'));
    expect(count?.sql).toContain('(actor_user_id = $1 OR owner_user_id = $1)');
    expect(count?.sql).toContain('organization_id IS NULL');
    expect(count?.sql).toContain('history_erased_at IS NOT NULL');
    expect(count?.sql).toContain('lyra_valid_state_copy_v2_storage_revision');
    const inventory = database.calls.find((call) => call.sql.includes('WITH personal_works AS'))?.sql ?? '';
    expect(inventory.indexOf("s3_key NOT LIKE 'state-reference-v2/%'")).toBeGreaterThan(inventory.indexOf(') AS keys'));
  });

  it('finalization blocks on any pending v2 evidence and cannot scrub a partial purge', async () => {
    const database = new RecordingDatabase(); database.finalizeMode = true; database.personalStateReferenceCount = 1;
    const repository = new PostgresAccountDeletionRepository(database, database);
    expect(await repository.finalizePersonalData('user-1', '00000000-0000-4000-8000-000000000001')).toMatchObject({ kind: 'blocked' });
    expect(database.calls.some((call) => call.sql.includes('UPDATE state_reference_copy_attempts'))).toBe(false);
    expect(database.calls.some((call) => call.sql.includes('DELETE FROM works'))).toBe(false);
  });

  it('scrubs personal terminal journal data in the same finalization before clearing job data and deleting works', async () => {
    const database = new RecordingDatabase(); database.finalizeMode = true;
    const repository = new PostgresAccountDeletionRepository(database, database);
    expect(await repository.finalizePersonalData('user-1', '00000000-0000-4000-8000-000000000001')).toEqual({ kind: 'completed' });
    const scrub = database.calls.find((call) => call.sql.includes('UPDATE state_reference_copy_attempts'));
    expect(scrub).toBeDefined();
    for (const field of ['actor_user_id', 'owner_user_id', 'organization_id', 'entity_id', 'state_id', 'job_id', 'candidate_ref_id',
      'candidate_s3_key', 'expected_state_revision', 'descriptor', 'digest', 'mime_type', 'size_bytes', 'source_revision', 'image_receipt', 'deletion_processing_token']) {
      expect(scrub?.sql).toContain(`${field} = NULL`);
    }
    expect(scrub?.sql).toContain("state = 'effects_fenced'"); expect(scrub?.sql).toContain('organization_id IS NULL');
    expect(scrub?.sql).not.toContain('marker_receipt = NULL');
    expect(database.calls.indexOf(scrub!)).toBeLessThan(database.calls.findIndex((call) => call.sql.includes('UPDATE generation_jobs')));
    expect(database.calls.indexOf(scrub!)).toBeLessThan(database.calls.findIndex((call) => call.sql.includes('DELETE FROM works')));
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

  it('recovery claimはUPDATE対象aliasからrequest fieldsを返してCTEとの曖昧性を避ける', async () => {
    const database = new RecordingDatabase();
    const repository = new PostgresAccountDeletionRepository(database, database);

    await repository.claimNextRecoverable(
      '00000000-0000-4000-8000-000000000001',
    );

    const call = database.calls.at(-1);
    expect(call?.sql).toContain('requests.user_id');
    expect(call?.sql).toContain('requests.identity_id');
    expect(call?.sql).toContain('requests.processing_token');
    expect(call?.values).toEqual([
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
