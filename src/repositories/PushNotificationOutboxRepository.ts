import type { QueryResultRow } from 'pg';
import { MOBILE_PUSH_TOKEN_REGISTRY_LOCK_KEY } from '../domain/constants/mobilePush.js';
import type {
  PushNotificationOutboxEnqueueResult,
  PushNotificationTerminalStatus,
} from '../domain/types/pushNotification.js';
import type { DatabaseClient, TransactionRunner } from '../lib/db.js';

interface GenerationJobNotificationRow extends QueryResultRow {
  id: string;
  user_id: string;
  organization_id: string | null;
  status: string;
  cancel_requested_at: Date | null;
  cancelled_at: Date | null;
  retry_count: number;
}

interface PushNotificationOutboxRow extends QueryResultRow {
  id: string;
  terminal_status: PushNotificationTerminalStatus;
}

export interface PushNotificationOutboxRepository {
  enqueueForTerminalJob(
    jobId: string,
  ): Promise<PushNotificationOutboxEnqueueResult | null>;
}

export interface TerminalGenerationJobNotificationSnapshot {
  id: string;
  user_id: string;
  organization_id: string | null;
  cancel_requested_at: Date | null;
  cancelled_at: Date | null;
  retry_count: number;
}

export class PostgresPushNotificationOutboxRepository
implements PushNotificationOutboxRepository {
  public constructor(private readonly transactionRunner: TransactionRunner) {}

  public async enqueueForTerminalJob(
    jobId: string,
  ): Promise<PushNotificationOutboxEnqueueResult | null> {
    return this.transactionRunner.transaction(async (transaction) => {
      await lockMobilePushTokenRegistryForTerminalSettlement(transaction);
      const job = await lockGenerationJob(transaction, jobId);
      if (job === null || !isNotifiableTerminalJob(job)) {
        return null;
      }
      return enqueueTerminalGenerationJobNotificationAfterRegistryLock(
        transaction,
        job,
        job.status,
      );
    });
  }
}

export async function lockMobilePushTokenRegistryForTerminalSettlement(
  client: DatabaseClient,
): Promise<void> {
  await client.query(
    `
    SELECT pg_advisory_xact_lock(hashtextextended($1, 0))
    `,
    [MOBILE_PUSH_TOKEN_REGISTRY_LOCK_KEY],
  );
}

export async function enqueueTerminalGenerationJobNotificationAfterRegistryLock(
  client: DatabaseClient,
  job: TerminalGenerationJobNotificationSnapshot,
  terminalStatus: PushNotificationTerminalStatus,
): Promise<PushNotificationOutboxEnqueueResult | null> {
  if (
    job.cancel_requested_at !== null
    || job.cancelled_at !== null
    || !Number.isSafeInteger(job.retry_count)
    || job.retry_count < 0
  ) {
    return null;
  }

  const inserted = await client.query<PushNotificationOutboxRow>(
    `
    INSERT INTO mobile_push_notification_outbox (
      generation_job_id,
      user_id,
      organization_id,
      terminal_status,
      generation_retry_count
    )
    VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5::int)
    ON CONFLICT (
      generation_job_id,
      terminal_status,
      generation_retry_count
    ) DO NOTHING
    RETURNING id, terminal_status
    `,
    [
      job.id,
      job.user_id,
      job.organization_id,
      terminalStatus,
      job.retry_count,
    ],
  );

  const createdOutbox = inserted.rows[0];
  if (createdOutbox === undefined) {
    const existing = await findOutbox(
      client,
      job.id,
      terminalStatus,
      job.retry_count,
    );
    return existing === null
      ? null
      : toEnqueueResult(existing, false, 0);
  }

  const deliveries = await client.query(
    `
    INSERT INTO mobile_push_notification_deliveries (
      outbox_id,
      push_token_id
    )
    SELECT $1::uuid, mobile_push_tokens.id
    FROM mobile_push_tokens
    WHERE mobile_push_tokens.user_id = $2::uuid
    ON CONFLICT (outbox_id, push_token_id) DO NOTHING
    `,
    [createdOutbox.id, job.user_id],
  );

  return toEnqueueResult(
    createdOutbox,
    true,
    deliveries.rowCount ?? 0,
  );
}

async function lockGenerationJob(
  client: DatabaseClient,
  jobId: string,
): Promise<GenerationJobNotificationRow | null> {
  const result = await client.query<GenerationJobNotificationRow>(
    `
    SELECT
      id,
      user_id,
      organization_id,
      status,
      cancel_requested_at,
      cancelled_at,
      retry_count
    FROM generation_jobs
    WHERE id = $1::uuid
    FOR UPDATE
    `,
    [jobId],
  );
  return result.rows[0] ?? null;
}

async function findOutbox(
  client: DatabaseClient,
  jobId: string,
  terminalStatus: PushNotificationTerminalStatus,
  retryCount: number,
): Promise<PushNotificationOutboxRow | null> {
  const result = await client.query<PushNotificationOutboxRow>(
    `
    SELECT id, terminal_status
    FROM mobile_push_notification_outbox
    WHERE generation_job_id = $1::uuid
      AND terminal_status = $2
      AND generation_retry_count = $3::int
    `,
    [jobId, terminalStatus, retryCount],
  );
  return result.rows[0] ?? null;
}

function isNotifiableTerminalJob(
  job: GenerationJobNotificationRow,
): job is GenerationJobNotificationRow & { status: PushNotificationTerminalStatus } {
  return (
    (job.status === 'completed' || job.status === 'failed')
    && job.cancel_requested_at === null
    && job.cancelled_at === null
  );
}

function toEnqueueResult(
  row: PushNotificationOutboxRow,
  created: boolean,
  deliveryCount: number,
): PushNotificationOutboxEnqueueResult {
  return {
    outboxId: row.id,
    terminalStatus: row.terminal_status,
    created,
    deliveryCount,
  };
}
