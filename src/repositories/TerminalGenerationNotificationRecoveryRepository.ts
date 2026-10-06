import type { QueryResultRow } from 'pg';
import { GENERATION_RECOVERY_BATCH_LIMIT } from '../domain/constants/generation.js';
import { ConfigurationError } from '../domain/errors/index.js';
import type { DatabaseClient, TransactionRunner } from '../lib/db.js';
import { attestProduction44RuntimeSchema } from '../lib/production44RuntimeSchemaAttestation.js';
import { attestProduction44ExpandedRuntimeSchema } from '../lib/production44ExpandedRuntimeSchemaAttestation.js';
import { isProduction44RepositorySchemaProfile, type Production44RepositorySchemaProfile } from './RepositorySchemaProfile.js';
import { PostgresPushNotificationOutboxRepository } from './PushNotificationOutboxRepository.js';

interface CandidateRow extends QueryResultRow {
  id: string;
}

export interface TerminalGenerationNotificationRecoveryCandidate {
  jobId: string;
}

export type TerminalNotificationRecoveryEnqueueOutcome = 'inserted' | 'existing' | 'deferred';

export interface TerminalGenerationNotificationRecoveryRepository {
  readonly profile: Production44RepositorySchemaProfile;
  scanBatch(input: {
    cutover: string;
    afterId: string | null;
    limit: number;
  }): Promise<TerminalGenerationNotificationRecoveryCandidate[]>;
  enqueueCurrentTerminal(jobId: string): Promise<TerminalNotificationRecoveryEnqueueOutcome>;
}

/**
 * Production44 notification recovery design boundary:
 * - exact read-only schema attestation precedes every factory result;
 * - the scan only admits post-cutover, currently terminal, non-cancelled jobs;
 * - the existing outbox port re-locks registry then job and owns idempotency.
 * Runtime scheduling is intentionally outside this repository slice.
 */
export async function createTerminalGenerationNotificationRecoveryRepository(
  database: DatabaseClient & TransactionRunner,
  profile: unknown,
): Promise<TerminalGenerationNotificationRecoveryRepository> {
  if (!isProduction44RepositorySchemaProfile(profile)) {
    throw new ConfigurationError('Terminal notification recovery requires verified production44 persistence');
  }
  if (profile === 'production44_pg18_v1') await attestProduction44RuntimeSchema(database);
  else await attestProduction44ExpandedRuntimeSchema(database);
  return Object.freeze(new PostgresTerminalGenerationNotificationRecoveryRepository(
    database,
    new PostgresPushNotificationOutboxRepository(database),
    profile,
  ));
}

class PostgresTerminalGenerationNotificationRecoveryRepository
implements TerminalGenerationNotificationRecoveryRepository {
  public constructor(
    private readonly client: DatabaseClient,
    private readonly outbox: PostgresPushNotificationOutboxRepository,
    public readonly profile: Production44RepositorySchemaProfile,
  ) {}

  public async scanBatch(input: {
    cutover: string;
    afterId: string | null;
    limit: number;
  }): Promise<TerminalGenerationNotificationRecoveryCandidate[]> {
    if (!isExactUtcTimestamp(input.cutover)
      || (input.afterId !== null && !isUuid(input.afterId))
      || !Number.isSafeInteger(input.limit)
      || input.limit < 1
      || input.limit > GENERATION_RECOVERY_BATCH_LIMIT) {
      throw new ConfigurationError('Invalid terminal notification recovery batch');
    }

    const result = await this.client.query<CandidateRow>(`
      SELECT generation_jobs.id
      FROM generation_jobs
      INNER JOIN users ON users.id = generation_jobs.user_id
      WHERE generation_jobs.completed_at >= $1::timestamptz
        AND generation_jobs.status IN ('completed', 'failed')
        AND generation_jobs.job_type IN (
          'page_generate',
          'entity_generate',
          'episode_story_autofill',
          'episode_page_skeleton'
        )
        AND generation_jobs.cancel_requested_at IS NULL
        AND generation_jobs.cancelled_at IS NULL
        AND users.account_deletion_started_at IS NULL
        AND ($2::uuid IS NULL OR generation_jobs.id > $2::uuid)
        AND NOT EXISTS (
          SELECT 1
          FROM mobile_push_notification_outbox AS outbox
          WHERE outbox.generation_job_id = generation_jobs.id
            AND outbox.terminal_status = generation_jobs.status
            AND outbox.generation_retry_count = generation_jobs.retry_count
        )
      ORDER BY generation_jobs.id ASC
      LIMIT $3::int
    `, [input.cutover, input.afterId, input.limit]);
    return result.rows.map(row => ({ jobId: row.id }));
  }

  public async enqueueCurrentTerminal(jobId: string): Promise<TerminalNotificationRecoveryEnqueueOutcome> {
    if (!isUuid(jobId)) throw new ConfigurationError('Invalid terminal notification recovery job');
    const result = await this.outbox.enqueueForTerminalJob(jobId);
    if (result === null) return 'deferred';
    return result.created ? 'inserted' : 'existing';
  }
}

function isExactUtcTimestamp(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(value);
}
