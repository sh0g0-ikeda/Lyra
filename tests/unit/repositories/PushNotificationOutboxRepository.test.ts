import type { QueryResult, QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';

import type { DatabaseClient, TransactionRunner } from '../../../src/lib/db.js';
import { PostgresPushNotificationOutboxRepository } from '../../../src/repositories/PushNotificationOutboxRepository.js';

class RecordingDatabase implements DatabaseClient, TransactionRunner {
  public queries: Array<{ text: string; values: readonly unknown[] | undefined }> = [];
  public responses: Array<{ rows: QueryResultRow[]; rowCount?: number }> = [];

  public async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<T>> {
    this.queries.push({ text, values });
    const response = this.responses.shift() ?? { rows: [] };
    return {
      command: 'SELECT',
      rowCount: response.rowCount ?? response.rows.length,
      oid: 0,
      fields: [],
      rows: response.rows as T[],
    };
  }

  public async transaction<T>(work: (client: DatabaseClient) => Promise<T>): Promise<T> {
    return work(this);
  }
}

const ids = {
  delivery: '11111111-1111-4111-8111-111111111111',
  token: '22222222-2222-4222-8222-222222222222',
  lease: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  job: '33333333-3333-4333-8333-333333333333',
  user: '44444444-4444-4444-8444-444444444444',
  organization: '55555555-5555-4555-8555-555555555555',
  work: '66666666-6666-4666-8666-666666666666',
  chapter: '77777777-7777-4777-8777-777777777777',
  episode: '88888888-8888-4888-8888-888888888888',
  page: '99999999-9999-4999-8999-999999999999',
};

describe('PostgresPushNotificationOutboxRepository', () => {
  it('pending delivery をleaseしてページ階層と暗号化tokenだけを返す', async () => {
    const database = new RecordingDatabase();
    database.responses.push({
      rows: [{
        delivery_id: ids.delivery,
        push_token_id: ids.token,
        lease_token: ids.lease,
        user_id: ids.user,
        platform: 'android',
        locale: 'ja',
        token_ciphertext: 'v1.opaque-ciphertext',
        encryption_key_id: 'push-key-v1',
        job_id: ids.job,
        organization_id: ids.organization,
        job_type: 'page_generate',
        terminal_status: 'completed',
        work_id: ids.work,
        chapter_id: ids.chapter,
        episode_id: ids.episode,
        page_id: ids.page,
        entity_id: null,
        attempt_count: 1,
      }],
    });
    const repository = new PostgresPushNotificationOutboxRepository(database, database);

    await expect(repository.claimPending(25)).resolves.toEqual([{
      deliveryId: ids.delivery,
      pushTokenId: ids.token,
      leaseToken: ids.lease,
      userId: ids.user,
      platform: 'android',
      locale: 'ja',
      tokenCiphertext: 'v1.opaque-ciphertext',
      encryptionKeyId: 'push-key-v1',
      jobStatus: 'completed',
      attemptCount: 1,
      navigation: {
        job_id: ids.job,
        organization_id: ids.organization,
        target_tab: 'Pages',
        work_id: ids.work,
        chapter_id: ids.chapter,
        episode_id: ids.episode,
        page_id: ids.page,
      },
    }]);

    const sql = database.queries[0]?.text ?? '';
    expect(sql).toContain('FOR UPDATE SKIP LOCKED');
    expect(sql).toContain("status = 'processing'");
    expect(sql).toContain('locked_at');
    expect(sql).toContain('available_at');
    expect(sql).toContain('generation_jobs');
    expect(sql).toContain('pages');
    expect(sql).toContain('entities');
    expect(database.queries[0]?.values).toEqual([25]);
  });

  it('成功・再試行・永久失敗をdelivery IDで更新し、無効tokenだけを削除する', async () => {
    const database = new RecordingDatabase();
    database.responses.push(
      { rows: [], rowCount: 1 },
      { rows: [], rowCount: 1 },
      { rows: [], rowCount: 1 },
      { rows: [], rowCount: 1 },
    );
    const repository = new PostgresPushNotificationOutboxRepository(database, database);
    const retryAt = new Date('2026-07-25T00:05:00.000Z');

    await repository.markSent(ids.delivery, ids.lease);
    await repository.markRetry(ids.delivery, ids.lease, 'provider_unavailable', retryAt);
    await repository.markDead(ids.delivery, ids.lease, 'invalid_token');
    await repository.deletePushToken(ids.token);

    expect(database.queries[0]?.text).toContain("status = 'sent'");
    expect(database.queries[0]?.text).toContain('lease_token = $2::uuid');
    expect(database.queries[1]?.text).toContain("status = 'pending'");
    expect(database.queries[1]?.text).toContain('available_at = $4');
    expect(database.queries[1]?.values).toEqual([
      ids.delivery,
      ids.lease,
      'provider_unavailable',
      retryAt,
    ]);
    expect(database.queries[2]?.text).toContain("status = 'dead'");
    expect(database.queries[3]?.text).toContain('DELETE FROM mobile_push_tokens');
    expect(database.queries[3]?.text).toContain('id = $1');
  });
});
