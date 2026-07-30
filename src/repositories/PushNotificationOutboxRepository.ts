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

export class PostgresPushNotificationOutboxRepository
implements PushNotificationOutboxRepository {
  public constructor(private readonly transactionRunner: TransactionRunner) {}

  public async enqueueForTerminalJob(
    jobId: string,
  ): Promise<PushNotificationOutboxEnqueueResult | null> {
    return this.transactionRunner.transaction(async (transaction) => {
      const job = await lockGenerationJob(transaction, jobId);
      if (job === null || !isNotifiableTerminalStatus(job.status)) {
        return null;
      }

      await lockPushTokenRegistry(transaction);
      const inserted = await transaction.query<PushNotificationOutboxRow>(
        `
        INSERT INTO mobile_push_notification_outbox (
          generation_job_id,
          user_id,
          organization_id,
          terminal_status
        )
        VALUES ($1::uuid, $2::uuid, $3::uuid, $4)
        ON CONFLICT (generation_job_id, terminal_status) DO NOTHING
        RETURNING id, terminal_status
        `,
        [job.id, job.user_id, job.organization_id, job.status],
      );

      const createdOutbox = inserted.rows[0];
      if (createdOutbox === undefined) {
        const existing = await findOutbox(
          transaction,
          job.id,
          job.status,
        );
        return existing === null
          ? null
          : toEnqueueResult(existing, false, 0);
      }

      const deliveries = await transaction.query(
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
    });
  }
}

async function lockGenerationJob(
  client: DatabaseClient,
  jobId: string,
): Promise<GenerationJobNotificationRow | null> {
  const result = await client.query<GenerationJobNotificationRow>(
    `
    SELECT id, user_id, organization_id, status
    FROM generation_jobs
    WHERE id = $1::uuid
    FOR UPDATE
    `,
    [jobId],
  );
  return result.rows[0] ?? null;
}

async function lockPushTokenRegistry(client: DatabaseClient): Promise<void> {
  await client.query(
    `
    SELECT pg_advisory_xact_lock(hashtextextended($1, 0))
    `,
    [MOBILE_PUSH_TOKEN_REGISTRY_LOCK_KEY],
  );
}

async function findOutbox(
  client: DatabaseClient,
  jobId: string,
  terminalStatus: PushNotificationTerminalStatus,
): Promise<PushNotificationOutboxRow | null> {
  const result = await client.query<PushNotificationOutboxRow>(
    `
    SELECT id, terminal_status
    FROM mobile_push_notification_outbox
    WHERE generation_job_id = $1::uuid
      AND terminal_status = $2
    `,
    [jobId, terminalStatus],
  );
  return result.rows[0] ?? null;
}

function isNotifiableTerminalStatus(
  value: string,
): value is PushNotificationTerminalStatus {
  return value === 'completed' || value === 'failed';
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
