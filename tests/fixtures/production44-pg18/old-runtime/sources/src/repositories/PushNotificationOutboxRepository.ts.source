import type { QueryResultRow } from 'pg';

import { buildPushNavigationPayload } from '../domain/pushNotification.js';
import type {
  PushNotificationDelivery,
  PushNotificationJobStatus,
  PushNotificationLocale,
} from '../domain/pushNotification.js';
import type { PushPlatform } from '../domain/pushToken.js';
import type { GenerationJobType } from '../domain/types/job.js';
import type { DatabaseClient, TransactionRunner } from '../lib/db.js';

const MAX_CLAIM_LIMIT = 100;
const LEASE_TIMEOUT_MINUTES = 5;
const INVALID_CONTEXT_ERROR_CODE = 'missing_navigation_context';

export interface PushNotificationOutboxRepository {
  claimPending(limit: number): Promise<PushNotificationDelivery[]>;
  markSent(deliveryId: string, leaseToken: string): Promise<boolean>;
  markRetry(
    deliveryId: string,
    leaseToken: string,
    errorCode: string,
    availableAt: Date,
  ): Promise<boolean>;
  markDead(deliveryId: string, leaseToken: string, errorCode: string): Promise<boolean>;
  deletePushToken(pushTokenId: string): Promise<void>;
}

interface PushNotificationDeliveryRow extends QueryResultRow {
  delivery_id: string;
  push_token_id: string | null;
  lease_token: string;
  user_id: string;
  platform: PushPlatform;
  locale: PushNotificationLocale;
  token_ciphertext: string;
  encryption_key_id: string;
  job_id: string;
  organization_id: string | null;
  job_type: GenerationJobType;
  terminal_status: PushNotificationJobStatus;
  work_id: string | null;
  chapter_id: string | null;
  episode_id: string | null;
  page_id: string | null;
  entity_id: string | null;
  attempt_count: number;
}

export class PostgresPushNotificationOutboxRepository implements PushNotificationOutboxRepository {
  public constructor(
    private readonly client: DatabaseClient,
    private readonly transactionRunner: TransactionRunner,
  ) {}

  public async claimPending(limit: number): Promise<PushNotificationDelivery[]> {
    const boundedLimit = normalizeClaimLimit(limit);

    return this.transactionRunner.transaction(async (transaction) => {
      const result = await transaction.query<PushNotificationDeliveryRow>(
        buildClaimQuery(),
        [boundedLimit],
      );
      const deliveries: PushNotificationDelivery[] = [];

      for (const row of result.rows) {
        const delivery = mapClaimedDelivery(row);
        if (delivery !== null) {
          deliveries.push(delivery);
          continue;
        }

        await transaction.query(
          `
          UPDATE mobile_push_notification_deliveries
          SET
            status = 'dead',
            error_code = $2,
            locked_at = NULL,
            lease_token = NULL,
            updated_at = NOW()
          WHERE id = $1::uuid
            AND status = 'processing'
          `,
          [row.delivery_id, INVALID_CONTEXT_ERROR_CODE],
        );
      }

      return deliveries;
    });
  }

  public async markSent(deliveryId: string, leaseToken: string): Promise<boolean> {
    const result = await this.client.query(
      `
      UPDATE mobile_push_notification_deliveries
      SET
        status = 'sent',
        sent_at = NOW(),
        locked_at = NULL,
        lease_token = NULL,
        error_code = NULL,
        updated_at = NOW()
      WHERE id = $1::uuid
        AND lease_token = $2::uuid
        AND status = 'processing'
      `,
      [deliveryId, leaseToken],
    );
    return (result.rowCount ?? 0) > 0;
  }

  public async markRetry(
    deliveryId: string,
    leaseToken: string,
    errorCode: string,
    availableAt: Date,
  ): Promise<boolean> {
    const result = await this.client.query(
      `
      UPDATE mobile_push_notification_deliveries
      SET
        status = 'pending',
        error_code = $3,
        available_at = $4,
        locked_at = NULL,
        lease_token = NULL,
        updated_at = NOW()
      WHERE id = $1::uuid
        AND lease_token = $2::uuid
        AND status = 'processing'
      `,
      [deliveryId, leaseToken, errorCode, availableAt],
    );
    return (result.rowCount ?? 0) > 0;
  }

  public async markDead(
    deliveryId: string,
    leaseToken: string,
    errorCode: string,
  ): Promise<boolean> {
    const result = await this.client.query(
      `
      UPDATE mobile_push_notification_deliveries
      SET
        status = 'dead',
        error_code = $3,
        locked_at = NULL,
        lease_token = NULL,
        updated_at = NOW()
      WHERE id = $1::uuid
        AND lease_token = $2::uuid
        AND status = 'processing'
      `,
      [deliveryId, leaseToken, errorCode],
    );
    return (result.rowCount ?? 0) > 0;
  }

  public async deletePushToken(pushTokenId: string): Promise<void> {
    await this.client.query(
      `
      DELETE FROM mobile_push_tokens
      WHERE id = $1::uuid
      `,
      [pushTokenId],
    );
  }
}

function normalizeClaimLimit(limit: number): number {
  if (!Number.isInteger(limit) || limit < 1) {
    return 1;
  }
  return Math.min(limit, MAX_CLAIM_LIMIT);
}

function mapClaimedDelivery(row: PushNotificationDeliveryRow): PushNotificationDelivery | null {
  if (!isPushPlatform(row.platform) || !isPushNotificationLocale(row.locale)) {
    return null;
  }
  if (!isGenerationJobType(row.job_type) || !isTerminalStatus(row.terminal_status)) {
    return null;
  }
  if (!Number.isSafeInteger(row.attempt_count) || row.attempt_count < 1) {
    return null;
  }
  if (row.push_token_id === null) {
    return null;
  }

  const navigation = buildPushNavigationPayload({
    jobId: row.job_id,
    organizationId: row.organization_id,
    jobType: row.job_type,
    workId: row.work_id,
    chapterId: row.chapter_id,
    episodeId: row.episode_id,
    pageId: row.page_id,
    entityId: row.entity_id,
  });
  if (navigation === null) {
    return null;
  }

  return {
    deliveryId: row.delivery_id,
    pushTokenId: row.push_token_id,
    leaseToken: row.lease_token,
    userId: row.user_id,
    platform: row.platform,
    locale: row.locale,
    tokenCiphertext: row.token_ciphertext,
    encryptionKeyId: row.encryption_key_id,
    jobStatus: row.terminal_status,
    attemptCount: row.attempt_count,
    navigation,
  };
}

function isPushPlatform(value: unknown): value is PushPlatform {
  return value === 'ios' || value === 'android';
}

function isPushNotificationLocale(value: unknown): value is PushNotificationLocale {
  return value === 'ja' || value === 'en';
}

function isGenerationJobType(value: unknown): value is GenerationJobType {
  return value === 'page_generate'
    || value === 'entity_generate'
    || value === 'episode_story_autofill'
    || value === 'episode_page_skeleton';
}

function isTerminalStatus(value: unknown): value is PushNotificationJobStatus {
  return value === 'completed' || value === 'failed';
}

function buildClaimQuery(): string {
  return `
    WITH delivery_context AS (
      SELECT
        deliveries.id AS delivery_id,
        deliveries.status AS delivery_status,
        deliveries.available_at,
        deliveries.locked_at,
        outbox.id AS outbox_id,
        outbox.terminal_status,
        jobs.id AS job_id,
        jobs.user_id,
        jobs.organization_id,
        jobs.job_type,
        tokens.id AS push_token_id,
        tokens.platform,
        tokens.locale,
        tokens.token_ciphertext,
        tokens.encryption_key_id,
        page_work.id AS page_work_id,
        page_work.user_id AS page_work_user_id,
        page_work.organization_id AS page_work_organization_id,
        (
          (jobs.organization_id IS NULL
            AND page_work.organization_id IS NULL
            AND page_work.user_id = jobs.user_id)
          OR (jobs.organization_id IS NOT NULL
            AND page_work.organization_id = jobs.organization_id)
        ) AS page_scope_matches,
        page_chapter.id AS page_chapter_id,
        page_episode.id AS page_episode_id,
        pages.id AS page_id,
        entity_work.id AS entity_work_id,
        entity_work.user_id AS entity_work_user_id,
        entity_work.organization_id AS entity_work_organization_id,
        (
          (jobs.organization_id IS NULL
            AND entity_work.organization_id IS NULL
            AND entity_work.user_id = jobs.user_id)
          OR (jobs.organization_id IS NOT NULL
            AND entity_work.organization_id = jobs.organization_id)
        ) AS entity_scope_matches,
        entities.user_id AS entity_user_id,
        entities.id AS entity_id,
        episode_work.id AS episode_work_id,
        episode_work.user_id AS episode_work_user_id,
        episode_work.organization_id AS episode_work_organization_id,
        (
          (jobs.organization_id IS NULL
            AND episode_work.organization_id IS NULL
            AND episode_work.user_id = jobs.user_id)
          OR (jobs.organization_id IS NOT NULL
            AND episode_work.organization_id = jobs.organization_id)
        ) AS episode_scope_matches,
        episode_chapter.id AS episode_chapter_id,
        episodes.id AS episode_id
      FROM mobile_push_notification_deliveries AS deliveries
      INNER JOIN mobile_push_notification_outbox AS outbox
        ON outbox.id = deliveries.outbox_id
      INNER JOIN generation_jobs AS jobs
        ON jobs.id = outbox.generation_job_id
        AND jobs.user_id = outbox.user_id
      LEFT JOIN mobile_push_tokens AS tokens
        ON tokens.id = deliveries.push_token_id
        AND tokens.user_id = outbox.user_id
      LEFT JOIN pages
        ON jobs.job_type = 'page_generate'
        AND pages.id = CASE
          WHEN jobs.params->>'page_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            THEN (jobs.params->>'page_id')::uuid
          ELSE NULL
        END
      LEFT JOIN episodes AS page_episode
        ON page_episode.id = pages.episode_id
      LEFT JOIN chapters AS page_chapter
        ON page_chapter.id = page_episode.chapter_id
      LEFT JOIN works AS page_work
        ON page_work.id = page_chapter.work_id
      LEFT JOIN entities
        ON jobs.job_type = 'entity_generate'
        AND entities.id = CASE
          WHEN jobs.params->>'entity_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            THEN (jobs.params->>'entity_id')::uuid
          ELSE NULL
        END
      LEFT JOIN works AS entity_work
        ON entity_work.id = entities.work_id
      LEFT JOIN episodes
        ON jobs.job_type IN ('episode_story_autofill', 'episode_page_skeleton')
        AND episodes.id = CASE
          WHEN jobs.params->>'episode_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            THEN (jobs.params->>'episode_id')::uuid
          ELSE NULL
        END
      LEFT JOIN chapters AS episode_chapter
        ON episode_chapter.id = episodes.chapter_id
      LEFT JOIN works AS episode_work
        ON episode_work.id = episode_chapter.work_id
    ),
    invalid_context AS (
      UPDATE mobile_push_notification_deliveries AS deliveries
      SET
        status = 'dead',
        error_code = '${INVALID_CONTEXT_ERROR_CODE}',
        locked_at = NULL,
        lease_token = NULL,
        updated_at = NOW()
      FROM delivery_context AS context
      WHERE deliveries.id = context.delivery_id
        AND deliveries.status IN ('pending', 'processing')
        AND NOT (
          (context.job_type = 'page_generate'
            AND context.push_token_id IS NOT NULL
            AND context.page_id IS NOT NULL
            AND context.page_episode_id IS NOT NULL
            AND context.page_chapter_id IS NOT NULL
            AND context.page_work_id IS NOT NULL
            AND context.page_scope_matches IS TRUE)
          OR (context.job_type = 'entity_generate'
            AND context.push_token_id IS NOT NULL
            AND context.entity_id IS NOT NULL
            AND context.entity_work_id IS NOT NULL
            AND context.entity_scope_matches IS TRUE
            AND (
              (context.organization_id IS NOT NULL
                OR context.entity_user_id = context.user_id) IS TRUE
            ))
          OR (context.job_type IN ('episode_story_autofill', 'episode_page_skeleton')
            AND context.push_token_id IS NOT NULL
            AND context.episode_id IS NOT NULL
            AND context.episode_chapter_id IS NOT NULL
            AND context.episode_work_id IS NOT NULL
            AND context.episode_scope_matches IS TRUE)
        )
      RETURNING deliveries.id
    ),
    candidates AS (
      SELECT deliveries.id AS delivery_id
      FROM mobile_push_notification_deliveries AS deliveries
      INNER JOIN delivery_context AS context
        ON context.delivery_id = deliveries.id
      WHERE (
          (deliveries.status = 'pending' AND deliveries.available_at <= NOW())
          OR (
            deliveries.status = 'processing'
            AND deliveries.locked_at < NOW() - INTERVAL '${LEASE_TIMEOUT_MINUTES} minutes'
          )
        )
        AND (
          (context.job_type = 'page_generate'
            AND context.push_token_id IS NOT NULL
            AND context.page_id IS NOT NULL
            AND context.page_episode_id IS NOT NULL
            AND context.page_chapter_id IS NOT NULL
            AND context.page_work_id IS NOT NULL
            AND context.page_scope_matches IS TRUE)
          OR (context.job_type = 'entity_generate'
            AND context.push_token_id IS NOT NULL
            AND context.entity_id IS NOT NULL
            AND context.entity_work_id IS NOT NULL
            AND context.entity_scope_matches IS TRUE
            AND (
              (context.organization_id IS NOT NULL
                OR context.entity_user_id = context.user_id) IS TRUE
            ))
          OR (context.job_type IN ('episode_story_autofill', 'episode_page_skeleton')
            AND context.push_token_id IS NOT NULL
            AND context.episode_id IS NOT NULL
            AND context.episode_chapter_id IS NOT NULL
            AND context.episode_work_id IS NOT NULL
            AND context.episode_scope_matches IS TRUE)
        )
      ORDER BY deliveries.available_at ASC, deliveries.id ASC
      LIMIT $1
      -- FOR UPDATE SKIP LOCKED is scoped to deliveries so selecting a notification
      -- cannot lock the job or its content hierarchy.
      FOR UPDATE OF deliveries SKIP LOCKED
    ),
    claimed AS (
      UPDATE mobile_push_notification_deliveries AS deliveries
      SET
        status = 'processing',
        locked_at = NOW(),
        lease_token = gen_random_uuid(),
        attempt_count = deliveries.attempt_count + 1,
        updated_at = NOW()
      FROM candidates
      WHERE deliveries.id = candidates.delivery_id
      RETURNING deliveries.id, deliveries.attempt_count, deliveries.lease_token
    )
    SELECT
      context.delivery_id,
      context.push_token_id,
      claimed.lease_token,
      context.user_id,
      context.platform,
      context.locale,
      context.token_ciphertext,
      context.encryption_key_id,
      context.job_id,
      context.organization_id,
      context.job_type,
      context.terminal_status,
      CASE WHEN context.job_type = 'page_generate' THEN context.page_work_id
           WHEN context.job_type = 'entity_generate' THEN context.entity_work_id
           ELSE context.episode_work_id END AS work_id,
      CASE WHEN context.job_type = 'page_generate' THEN context.page_chapter_id
           WHEN context.job_type IN ('episode_story_autofill', 'episode_page_skeleton')
             THEN context.episode_chapter_id
           ELSE NULL END AS chapter_id,
      CASE WHEN context.job_type = 'page_generate' THEN context.page_episode_id
           WHEN context.job_type IN ('episode_story_autofill', 'episode_page_skeleton')
             THEN context.episode_id
           ELSE NULL END AS episode_id,
      CASE WHEN context.job_type = 'page_generate' THEN context.page_id ELSE NULL END AS page_id,
      CASE WHEN context.job_type = 'entity_generate' THEN context.entity_id ELSE NULL END AS entity_id,
      claimed.attempt_count
    FROM claimed
    INNER JOIN delivery_context AS context
      ON context.delivery_id = claimed.id
  `;
}
