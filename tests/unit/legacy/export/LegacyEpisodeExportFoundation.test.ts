import { createHash, randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { QueryResult, QueryResultRow } from 'pg';
import type { DatabaseClient, TransactionRunner } from '../../../../src/lib/db.js';
import {
  buildLegacyExportRequestFingerprint,
  normalizeLegacyExportFilename,
} from '../../../../src/legacy/export/LegacyEpisodeExportJob.js';
import { LegacyEpisodeExportJobRepository } from '../../../../src/legacy/export/LegacyEpisodeExportJobRepository.js';
import {
  LegacySqsExportJobQueue,
  type LegacyExportQueueClient,
} from '../../../../src/legacy/export/LegacyExportJobQueue.js';
import { LegacyExportDeletionBlocker } from '../../../../src/legacy/export/LegacyExportDeletionBlocker.js';
import type { SendMessageCommand } from '@aws-sdk/client-sqs';

describe('legacy episode export foundation', () => {
  it('旧routeのproperty順を含むfingerprintとfilename正規化を保持する', () => {
    const input = {
      userId: '11111111-1111-4111-8111-111111111111',
      organizationId: null,
      episodeId: '22222222-2222-4222-8222-222222222222',
      pageIds: ['33333333-3333-4333-8333-333333333333'],
      format: 'zip' as const,
      filename: 'chapter.zip',
      idempotencyKey: 'request-1234',
    };
    const serialized = JSON.stringify({ ...input, pageIds: [...input.pageIds] });
    expect(buildLegacyExportRequestFingerprint(input)).toBe(
      createHash('sha256').update(serialized).digest('hex'),
    );
    expect(normalizeLegacyExportFilename('folder/原稿?.zip', 'zip')).toBe('---.zip');
  });

  it('旧queue envelopeだけを送信する', async () => {
    const client = new RecordingQueueClient();
    const queue = new LegacySqsExportJobQueue(client, 'https://queue.example.invalid/export');
    const jobId = randomUUID();
    expect(await queue.enqueue({ jobId })).toEqual({ messageId: 'message-1' });
    expect(client.body).toBe(JSON.stringify({ job_id: jobId, job_type: 'episode_export' }));
  });

  it('queue外部呼出しはtimeoutで有限に失敗する', async () => {
    const queue = new LegacySqsExportJobQueue(new NeverQueueClient(), 'https://queue.example.invalid/export', 5);
    let failure: unknown;
    try { await queue.enqueue({ jobId: randomUUID() }); }
    catch (error) { failure = error; }
    expect(failure).toMatchObject({ code: 'CONFIGURATION_ERROR', statusCode: 500 });
  });

  it('queuedだけをclaimしlease列を参照せず、personal active jobだけを退会blockerへ数える', async () => {
    const client = new RecordingDatabase();
    const repository = new LegacyEpisodeExportJobRepository(client, client);
    await repository.claim(randomUUID());
    expect(client.lastSql).toContain("status = 'queued'");
    expect(client.lastSql).not.toContain('lease');

    const blocker = new LegacyExportDeletionBlocker(client);
    await blocker.countActivePersonalJobs(randomUUID());
    expect(client.lastSql).toContain("status IN ('queued', 'processing')");
    expect(client.lastSql).toContain('organization_id IS NULL');

    await repository.listExpiredArtifacts(100);
    expect(client.lastSql).toContain("status <> 'processing'");
  });
});

class RecordingQueueClient implements LegacyExportQueueClient {
  public body = '';
  public async send(command: SendMessageCommand): Promise<{ MessageId?: string }> {
    this.body = String(command.input.MessageBody ?? '');
    return { MessageId: 'message-1' };
  }
}
class NeverQueueClient implements LegacyExportQueueClient {
  public async send(): Promise<{ MessageId?: string }> { return new Promise(() => undefined); }
}

class RecordingDatabase implements DatabaseClient, TransactionRunner {
  public lastSql = '';
  public async transaction<T>(work: (client: DatabaseClient) => Promise<T>): Promise<T> {
    return work(this);
  }
  public async query<Row extends QueryResultRow = QueryResultRow>(text: string): Promise<QueryResult<Row>> {
    this.lastSql = text;
    const rows = text.includes('COUNT(*)') ? [{ count: '2' } as unknown as Row] : [];
    return { command: 'SELECT', rowCount: rows.length, oid: 0, fields: [], rows };
  }
}
