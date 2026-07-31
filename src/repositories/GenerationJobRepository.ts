import type { QueryResultRow } from 'pg';
import type { GenerationJob, GenerationJobType } from '../domain/types/job.js';
import type { PageGenerationMode } from '../domain/types/pageGeneration.js';
import { ConfigurationError, ConflictError } from '../domain/errors/index.js';
import type { GenerationJobHistoryCursor } from '../domain/pagination.js';
import type { DatabaseClient, TransactionRunner } from '../lib/db.js';
import { sanitizePersistedErrorMessage } from '../lib/errorSanitizer.js';

export type { GenerationJob };
export type { GenerationJobHistoryCursor };

export interface GenerationJobCapacityLimits {
  perUser: number;
  global: number;
  jobTypes?: readonly GenerationJobType[];
}

interface GenerationCapacityScope {
  userId: string;
  organizationId: string | null;
}

export interface CreateGenerationJobInput {
  id?: string;
  userId: string;
  organizationId?: string | null;
  jobType: GenerationJobType;
  generationMode: PageGenerationMode | null;
  creditCost: number;
  params: Record<string, unknown>;
  capacityLimits?: GenerationJobCapacityLimits;
}

export interface PrepareGenerationJobRetryOptions {
  userId: string;
  organizationId?: string | null;
  capacityLimits: GenerationJobCapacityLimits;
}

export interface PruneExpiredGenerationJobsInput {
  maxDeletes: number;
  dryRun: boolean;
}

export interface PruneExpiredGenerationJobsResult {
  dryRun: boolean;
  candidateCount: number;
  deletedCount: number;
  candidateIds: string[];
  truncated: boolean;
}

export interface GenerationJobRepository {
  create(input: CreateGenerationJobInput): Promise<GenerationJob>;
  findByIdAndUserId(
    jobId: string,
    userId: string,
    organizationId?: string | null,
  ): Promise<GenerationJob | null>;
  findActivePageGenerationJob(
    userId: string,
    pageId: string,
    organizationId?: string | null,
  ): Promise<GenerationJob | null>;
  findActiveEntityGenerationJob(
    userId: string,
    entityId: string,
    organizationId?: string | null,
  ): Promise<GenerationJob | null>;
  countActiveGenerationJobsByUser(
    userId: string,
    jobTypes?: readonly GenerationJobType[],
  ): Promise<number>;
  countActiveGenerationJobs(jobTypes?: readonly GenerationJobType[]): Promise<number>;
  attachQueueMessageId(jobId: string, messageId: string): Promise<boolean>;
  markFailed(jobId: string, errorMessage: string): Promise<boolean>;
  prepareRetry(
    jobId: string,
    maxRetryCount: number,
    options?: PrepareGenerationJobRetryOptions,
  ): Promise<boolean>;
}

export interface GenerationJobCancellationRepository {
  requestCancellation(
    jobId: string,
    userId: string,
    organizationId?: string | null,
  ): Promise<GenerationJob | null>;
  finalizeCancellation(jobId: string): Promise<boolean>;
}

export interface GenerationJobCancellationControlRepository
  extends GenerationJobCancellationRepository {
  beginCommit(jobId: string): Promise<boolean>;
}

export interface ListGenerationJobHistoryInput {
  userId: string;
  organizationId?: string | null;
  limit: number;
  cursor: GenerationJobHistoryCursor | null;
}

export interface GenerationJobHistoryPage {
  jobs: GenerationJob[];
  nextCursor: GenerationJobHistoryCursor | null;
}

export type HideGenerationJobHistoryResult =
  | { kind: 'not_found' }
  | { kind: 'active' }
  | { kind: 'hidden' };

export interface GenerationJobHistoryRepository {
  listHistory(input: ListGenerationJobHistoryInput): Promise<GenerationJobHistoryPage>;
  hideFromHistory(
    userId: string,
    jobId: string,
    organizationId?: string | null,
  ): Promise<HideGenerationJobHistoryResult>;
}

interface GenerationJobRow extends QueryResultRow {
  id: string;
  user_id: string;
  organization_id: string | null;
  job_type: GenerationJobType;
  status: GenerationJob['status'];
  generation_mode: string | null;
  credit_cost: number;
  params: unknown;
  result: unknown;
  sqs_message_id: string | null;
  openai_request_id: string | null;
  error_message: string | null;
  retry_count: number;
  created_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
  expires_at: Date | null;
  cancel_requested_at: Date | null;
  cancel_requested_by: string | null;
  cancelled_at: Date | null;
  commit_started_at: Date | null;
}

interface GenerationJobHistoryRow extends GenerationJobRow {
  active_rank: number;
}

interface GenerationJobStatusRow extends QueryResultRow {
  status: GenerationJob['status'];
}

interface CancellationBalanceRow extends QueryResultRow {
  monthly_credits: number;
  purchased_credits: number;
  monthly_expires_at: Date | null;
  monthly_expired?: boolean;
}

interface CancellationLedgerSummaryRow extends QueryResultRow {
  consumed_amount: string;
  refunded_amount: string;
  consumed_monthly_delta: string;
  consumed_purchased_delta: string;
  refunded_monthly_delta: string;
  refunded_purchased_delta: string;
  consumed_entry_count: string;
  refunded_entry_count: string;
  consumed_complete_entry_count: string;
  refunded_complete_entry_count: string;
}

const DEFAULT_CAPACITY_JOB_TYPES: readonly GenerationJobType[] = [
  'page_generate',
  'entity_generate',
];

export class PostgresGenerationJobRepository
  implements
    GenerationJobRepository,
    GenerationJobCancellationControlRepository,
    GenerationJobHistoryRepository
{
  private static readonly advisoryLockNamespace = 81_527;

  public constructor(private readonly client: DatabaseClient & Partial<TransactionRunner>) {}

  public async create(input: CreateGenerationJobInput): Promise<GenerationJob> {
    const capacityLimits = input.capacityLimits;
    if (capacityLimits !== undefined) {
      const transactionRunner = this.requireTransactionRunnerForCapacity();
      return transactionRunner.transaction(async (transactionClient) => {
        const scope = getGenerationCapacityScope(input.userId, input.organizationId ?? null);
        await this.lockGenerationCapacity(transactionClient, scope);
        await this.assertCapacityWithinTransaction(transactionClient, scope, capacityLimits);
        return this.insertJob(transactionClient, input);
      });
    }

    return this.insertJob(this.client, input);
  }

  private async insertJob(
    client: DatabaseClient,
    input: CreateGenerationJobInput,
  ): Promise<GenerationJob> {
    const result = await client.query<GenerationJobRow>(
      `
      INSERT INTO generation_jobs (
        id,
        user_id,
        organization_id,
        job_type,
        generation_mode,
        credit_cost,
        params,
        expires_at
      )
      VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3, $4, $5, $6, $7::jsonb, NOW() + INTERVAL '7 days')
      RETURNING *
      `,
      [
        input.id ?? null,
        input.userId,
        input.organizationId ?? null,
        input.jobType,
        input.generationMode,
        input.creditCost,
        JSON.stringify(input.params),
      ],
    );

    return mapGenerationJobRow(result.rows[0]);
  }

  private async lockGenerationCapacity(client: DatabaseClient, scope: GenerationCapacityScope): Promise<void> {
    await client.query(
      'SELECT pg_advisory_xact_lock($1::int, hashtext($2)::int)',
      [PostgresGenerationJobRepository.advisoryLockNamespace, 'generation_jobs:global'],
    );
    await client.query(
      'SELECT pg_advisory_xact_lock($1::int, hashtext($2)::int)',
      [PostgresGenerationJobRepository.advisoryLockNamespace, formatGenerationCapacityScopeKey(scope)],
    );
  }

  private async assertCapacityWithinTransaction(
    client: DatabaseClient,
    scope: GenerationCapacityScope,
    limits: NonNullable<CreateGenerationJobInput['capacityLimits']>,
  ): Promise<void> {
    const jobTypes = normalizeCapacityJobTypes(limits.jobTypes);
    const activeForScope = await this.countActiveGenerationJobsByScopeWithClient(
      client,
      scope,
      jobTypes,
    );
    if (activeForScope >= limits.perUser) {
      throw new ConflictError('Generation scope has too many active generation jobs');
    }

    const activeGlobally = await this.countActiveGenerationJobsWithClient(client, jobTypes);
    if (activeGlobally >= limits.global) {
      throw new ConflictError('Generation queue is temporarily full');
    }
  }

  public async findByIdAndUserId(
    jobId: string,
    userId: string,
    organizationId: string | null = null,
  ): Promise<GenerationJob | null> {
    const result = await this.client.query<GenerationJobRow>(
      `
      SELECT generation_jobs.*
      FROM generation_jobs
      WHERE id = $1
        AND (
          ($3::uuid IS NULL
            AND generation_jobs.user_id = $2
            AND generation_jobs.organization_id IS NULL)
          OR (
            $3::uuid IS NOT NULL
            AND generation_jobs.organization_id = $3::uuid
            AND EXISTS (
              SELECT 1
              FROM organization_members
              WHERE organization_members.organization_id = generation_jobs.organization_id
                AND organization_members.user_id = $2
                AND organization_members.status = 'active'
            )
          )
        )
      `,
      [jobId, userId, organizationId],
    );

    return result.rows[0] === undefined ? null : mapGenerationJobRow(result.rows[0]);
  }

  public async listHistory(
    input: ListGenerationJobHistoryInput,
  ): Promise<GenerationJobHistoryPage> {
    if (
      !Number.isSafeInteger(input.limit)
      || input.limit < 1
      || input.limit > 100
    ) {
      throw new ConfigurationError('Generation job history limit is invalid');
    }

    const organizationId = input.organizationId ?? null;
    const result = await this.client.query<GenerationJobHistoryRow>(
      `
      WITH visible_jobs AS (
        SELECT
          generation_jobs.*,
          CASE
            WHEN generation_jobs.status IN ('queued', 'processing') THEN 0
            ELSE 1
          END AS active_rank
        FROM generation_jobs
        WHERE (
          ($2::uuid IS NULL
            AND generation_jobs.user_id = $1::uuid
            AND generation_jobs.organization_id IS NULL)
          OR (
            $2::uuid IS NOT NULL
            AND generation_jobs.organization_id = $2::uuid
            AND EXISTS (
              SELECT 1
              FROM organization_members
              WHERE organization_members.organization_id = generation_jobs.organization_id
                AND organization_members.user_id = $1::uuid
                AND organization_members.status = 'active'
            )
          )
        )
        AND (
          generation_jobs.status IN ('queued', 'processing')
          OR NOT EXISTS (
            SELECT 1
            FROM generation_job_history_hides
            WHERE generation_job_history_hides.generation_job_id = generation_jobs.id
              AND generation_job_history_hides.user_id = $1::uuid
          )
        )
      )
      SELECT *
      FROM visible_jobs
      WHERE (
        $3::int IS NULL
        OR active_rank > $3::int
        OR (
          active_rank = $3::int
          AND (
            created_at < $4::timestamptz
            OR (created_at = $4::timestamptz AND id < $5::uuid)
          )
        )
      )
      ORDER BY active_rank ASC, created_at DESC, id DESC
      LIMIT $6
      `,
      [
        input.userId,
        organizationId,
        input.cursor?.activeRank ?? null,
        input.cursor?.createdAt ?? null,
        input.cursor?.id ?? null,
        input.limit + 1,
      ],
    );

    const rows = result.rows.slice(0, input.limit);
    const lastRow = rows.at(-1);
    return {
      jobs: rows.map(mapGenerationJobRow),
      nextCursor:
        result.rows.length > input.limit && lastRow !== undefined
          ? {
              activeRank: toGenerationJobHistoryActiveRank(lastRow.active_rank),
              createdAt: lastRow.created_at,
              id: lastRow.id,
            }
          : null,
    };
  }

  public async hideFromHistory(
    userId: string,
    jobId: string,
    organizationId: string | null = null,
  ): Promise<HideGenerationJobHistoryResult> {
    const transactionRunner = this.requireTransactionRunnerForHistory();
    return transactionRunner.transaction(async (transactionClient) => {
      const result = await transactionClient.query<GenerationJobStatusRow>(
        `
        SELECT generation_jobs.status
        FROM generation_jobs
        WHERE generation_jobs.id = $1::uuid
          AND (
            ($3::uuid IS NULL
              AND generation_jobs.user_id = $2::uuid
              AND generation_jobs.organization_id IS NULL)
            OR (
              $3::uuid IS NOT NULL
              AND generation_jobs.organization_id = $3::uuid
              AND EXISTS (
                SELECT 1
                FROM organization_members
                WHERE organization_members.organization_id = generation_jobs.organization_id
                  AND organization_members.user_id = $2::uuid
                  AND organization_members.status = 'active'
              )
            )
          )
        FOR UPDATE
        `,
        [jobId, userId, organizationId],
      );

      const job = result.rows[0];
      if (job === undefined) {
        return { kind: 'not_found' };
      }
      if (job.status === 'queued' || job.status === 'processing') {
        return { kind: 'active' };
      }

      await transactionClient.query(
        `
        INSERT INTO generation_job_history_hides (
          generation_job_id,
          user_id
        )
        VALUES ($1::uuid, $2::uuid)
        ON CONFLICT (generation_job_id, user_id) DO NOTHING
        `,
        [jobId, userId],
      );
      return { kind: 'hidden' };
    });
  }

  public async findActivePageGenerationJob(
    userId: string,
    pageId: string,
    organizationId: string | null = null,
  ): Promise<GenerationJob | null> {
    return this.findActiveResourceJob(userId, 'page_generate', 'page_id', pageId, organizationId);
  }

  public async findActiveEntityGenerationJob(
    userId: string,
    entityId: string,
    organizationId: string | null = null,
  ): Promise<GenerationJob | null> {
    return this.findActiveResourceJob(userId, 'entity_generate', 'entity_id', entityId, organizationId);
  }

  public async findActiveEpisodeStoryAutofillJob(
    userId: string,
    episodeId: string,
    organizationId: string | null = null,
  ): Promise<GenerationJob | null> {
    return this.findActiveResourceJob(userId, 'episode_story_autofill', 'episode_id', episodeId, organizationId);
  }

  public async findActiveEpisodePageSkeletonJob(
    userId: string,
    episodeId: string,
    organizationId: string | null = null,
  ): Promise<GenerationJob | null> {
    return this.findActiveResourceJob(userId, 'episode_page_skeleton', 'episode_id', episodeId, organizationId);
  }

  public async countActiveGenerationJobsByUser(
    userId: string,
    jobTypes: readonly GenerationJobType[] = DEFAULT_CAPACITY_JOB_TYPES,
  ): Promise<number> {
    return this.countActiveGenerationJobsByUserWithClient(
      this.client,
      userId,
      normalizeCapacityJobTypes(jobTypes),
    );
  }

  private async countActiveGenerationJobsByUserWithClient(
    client: DatabaseClient,
    userId: string,
    jobTypes: readonly GenerationJobType[],
  ): Promise<number> {
    return this.countActiveGenerationJobsByScopeWithClient(
      client,
      { userId, organizationId: null },
      jobTypes,
    );
  }

  private async countActiveGenerationJobsByScopeWithClient(
    client: DatabaseClient,
    scope: GenerationCapacityScope,
    jobTypes: readonly GenerationJobType[],
  ): Promise<number> {
    const result = await client.query<{ count: string }>(
      `
      SELECT COUNT(*)::text AS count
      FROM generation_jobs
      WHERE (
          ($1::uuid IS NULL AND user_id = $2 AND organization_id IS NULL)
          OR ($1::uuid IS NOT NULL AND organization_id = $1::uuid)
        )
        AND job_type = ANY($3::text[])
        AND status IN ('queued', 'processing')
      `,
      [scope.organizationId, scope.userId, [...jobTypes]],
    );

    return Number(result.rows[0]?.count ?? '0');
  }

  public async countActiveGenerationJobs(
    jobTypes: readonly GenerationJobType[] = DEFAULT_CAPACITY_JOB_TYPES,
  ): Promise<number> {
    return this.countActiveGenerationJobsWithClient(
      this.client,
      normalizeCapacityJobTypes(jobTypes),
    );
  }

  private async countActiveGenerationJobsWithClient(
    client: DatabaseClient,
    jobTypes: readonly GenerationJobType[],
  ): Promise<number> {
    const result = await client.query<{ count: string }>(
      `
      SELECT COUNT(*)::text AS count
      FROM generation_jobs
      WHERE job_type = ANY($1::text[])
        AND status IN ('queued', 'processing')
      `,
      [[...jobTypes]],
    );

    return Number(result.rows[0]?.count ?? '0');
  }

  public async attachQueueMessageId(jobId: string, messageId: string): Promise<boolean> {
    const result = await this.client.query<GenerationJobRow>(
      `
      UPDATE generation_jobs
      SET sqs_message_id = $2
      WHERE id = $1
      RETURNING *
      `,
      [jobId, messageId],
    );

    return (result.rowCount ?? 0) > 0;
  }

  public async requestCancellation(
    jobId: string,
    userId: string,
    organizationId: string | null = null,
  ): Promise<GenerationJob | null> {
    const candidate = await this.findCancellationCandidate(jobId, userId, organizationId);
    if (candidate === null) {
      return null;
    }
    if (candidate.status === 'processing') {
      return this.requestProcessingCancellation(this.client, jobId, userId, organizationId);
    }
    if (candidate.status !== 'queued') {
      return null;
    }

    const transactionRunner = this.requireTransactionRunnerForCancellation();
    return transactionRunner.transaction(async (transactionClient) => {
      const lockedBalance = await this.lockCancellationBalance(transactionClient, candidate);
      const lockedResult = await transactionClient.query<GenerationJobRow>(
        `
        SELECT generation_jobs.*
        FROM generation_jobs
        WHERE generation_jobs.id = $1::uuid
          AND (
            ($3::uuid IS NULL
              AND generation_jobs.user_id = $2::uuid
              AND generation_jobs.organization_id IS NULL)
            OR (
              $3::uuid IS NOT NULL
              AND generation_jobs.organization_id = $3::uuid
              AND EXISTS (
                SELECT 1
                FROM organization_members
                WHERE organization_members.organization_id = generation_jobs.organization_id
                  AND organization_members.user_id = $2::uuid
                  AND organization_members.status = 'active'
              )
            )
          )
        FOR UPDATE
        `,
        [jobId, userId, organizationId],
      );
      const lockedJobRow = lockedResult.rows[0];
      if (lockedJobRow === undefined) {
        return null;
      }
      const lockedJob = mapGenerationJobRow(lockedJobRow);
      if (lockedJob.status === 'processing') {
        return this.requestProcessingCancellation(
          transactionClient,
          jobId,
          userId,
          organizationId,
        );
      }
      if (lockedJob.status !== 'queued' || lockedJob.commitStartedAt !== null) {
        return lockedJob.status === 'cancelled' ? lockedJob : null;
      }

      const cancelledResult = await transactionClient.query<GenerationJobRow>(
        `
        UPDATE generation_jobs
        SET cancel_requested_at = COALESCE(cancel_requested_at, NOW()),
            cancel_requested_by = COALESCE(cancel_requested_by, $2::uuid),
            status = 'cancelled',
            cancelled_at = COALESCE(cancelled_at, NOW()),
            completed_at = COALESCE(completed_at, NOW()),
            error_message = NULL,
            result = COALESCE(result, '{}'::jsonb) || jsonb_build_object(
              'progress_stage', 'cancelled',
              'progress_message', 'Generation was stopped.',
              'progress_updated_at', NOW()
            )
        WHERE id = $1::uuid
          AND status = 'queued'
          AND commit_started_at IS NULL
        RETURNING *
        `,
        [jobId, userId],
      );
      const cancelledRow = cancelledResult.rows[0];
      if (cancelledRow === undefined) {
        return null;
      }
      const cancelledJob = mapGenerationJobRow(cancelledRow);
      await this.settleCancelledJob(
        transactionClient,
        cancelledJob,
        userId,
        lockedBalance,
      );
      return cancelledJob;
    });
  }

  private async findCancellationCandidate(
    jobId: string,
    userId: string,
    organizationId: string | null,
  ): Promise<GenerationJob | null> {
    const result = await this.client.query<GenerationJobRow>(
      `
      SELECT generation_jobs.*
      FROM generation_jobs
      WHERE generation_jobs.id = $1::uuid
        AND (
          ($3::uuid IS NULL
            AND generation_jobs.user_id = $2
            AND generation_jobs.organization_id IS NULL)
          OR (
            $3::uuid IS NOT NULL
            AND generation_jobs.organization_id = $3::uuid
            AND EXISTS (
              SELECT 1
              FROM organization_members
              WHERE organization_members.organization_id = generation_jobs.organization_id
                AND organization_members.user_id = $2
                AND organization_members.status = 'active'
            )
          )
        )
      `,
      [jobId, userId, organizationId],
    );
    return result.rows[0] === undefined ? null : mapGenerationJobRow(result.rows[0]);
  }

  private async requestProcessingCancellation(
    client: DatabaseClient,
    jobId: string,
    userId: string,
    organizationId: string | null,
  ): Promise<GenerationJob | null> {
    const result = await client.query<GenerationJobRow>(
      `
      UPDATE generation_jobs
      SET cancel_requested_at = COALESCE(cancel_requested_at, NOW()),
          cancel_requested_by = COALESCE(cancel_requested_by, $2::uuid),
          result = COALESCE(result, '{}'::jsonb) || jsonb_build_object(
            'progress_stage', 'cancellation_requested',
            'progress_message', 'Stop requested. The current safe step will finish before stopping.',
            'progress_updated_at', NOW()
          )
      WHERE id = $1::uuid
        AND (
          ($3::uuid IS NULL
            AND generation_jobs.user_id = $2::uuid
            AND generation_jobs.organization_id IS NULL)
          OR (
            $3::uuid IS NOT NULL
            AND generation_jobs.organization_id = $3::uuid
            AND EXISTS (
              SELECT 1
              FROM organization_members
              WHERE organization_members.organization_id = generation_jobs.organization_id
                AND organization_members.user_id = $2::uuid
                AND organization_members.status = 'active'
            )
          )
        )
        AND status = 'processing'
        AND commit_started_at IS NULL
      RETURNING *
      `,
      [jobId, userId, organizationId],
    );
    return result.rows[0] === undefined ? null : mapGenerationJobRow(result.rows[0]);
  }

  public async finalizeCancellation(jobId: string): Promise<boolean> {
    const candidateResult = await this.client.query<GenerationJobRow>(
      'SELECT * FROM generation_jobs WHERE id = $1::uuid',
      [jobId],
    );
    const candidateRow = candidateResult.rows[0];
    if (candidateRow === undefined) {
      return false;
    }
    const candidate = mapGenerationJobRow(candidateRow);
    if (candidate.status === 'cancelled') {
      return true;
    }
    if (
      candidate.status !== 'processing'
      || candidate.cancelRequestedAt === null
      || candidate.commitStartedAt !== null
    ) {
      return false;
    }

    const transactionRunner = this.requireTransactionRunnerForCancellation();
    return transactionRunner.transaction(async (transactionClient) => {
      const lockedBalance = await this.lockCancellationBalance(transactionClient, candidate);
      const lockedResult = await transactionClient.query<GenerationJobRow>(
        'SELECT * FROM generation_jobs WHERE id = $1::uuid FOR UPDATE',
        [jobId],
      );
      const lockedRow = lockedResult.rows[0];
      if (lockedRow === undefined) {
        return false;
      }
      const lockedJob = mapGenerationJobRow(lockedRow);
      if (lockedJob.status === 'cancelled') {
        return true;
      }
      if (
        lockedJob.status !== 'processing'
        || lockedJob.cancelRequestedAt === null
        || lockedJob.commitStartedAt !== null
      ) {
        return false;
      }

      const result = await transactionClient.query<GenerationJobRow>(
        `
        UPDATE generation_jobs
        SET status = 'cancelled',
            cancelled_at = COALESCE(cancelled_at, NOW()),
            completed_at = COALESCE(completed_at, NOW()),
            error_message = NULL,
            result = COALESCE(result, '{}'::jsonb) || jsonb_build_object(
              'progress_stage', 'cancelled',
              'progress_message', 'Generation was stopped.',
              'progress_updated_at', NOW()
            )
        WHERE id = $1::uuid
          AND status = 'processing'
          AND cancel_requested_at IS NOT NULL
          AND commit_started_at IS NULL
        RETURNING *
        `,
        [jobId],
      );
      const cancelledRow = result.rows[0];
      if (cancelledRow === undefined) {
        return false;
      }
      const cancelledJob = mapGenerationJobRow(cancelledRow);
      await this.settleCancelledJob(
        transactionClient,
        cancelledJob,
        cancelledJob.cancelRequestedBy ?? cancelledJob.userId,
        lockedBalance,
      );
      return true;
    });
  }

  public async beginCommit(jobId: string): Promise<boolean> {
    const result = await this.client.query<GenerationJobRow>(
      `
      UPDATE generation_jobs
      SET commit_started_at = NOW()
      WHERE id = $1::uuid
        AND status = 'processing'
        AND cancel_requested_at IS NULL
        AND commit_started_at IS NULL
      RETURNING *
      `,
      [jobId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  private async lockCancellationBalance(
    client: DatabaseClient,
    job: GenerationJob,
  ): Promise<CancellationBalanceRow | null> {
    if (job.creditCost <= 0) {
      return null;
    }

    if ((job.organizationId ?? null) === null) {
      const result = await client.query<CancellationBalanceRow>(
        `
        SELECT monthly_credits,
               purchased_credits,
               monthly_expires_at,
               monthly_expires_at IS NOT NULL AND monthly_expires_at <= NOW() AS monthly_expired
        FROM credit_balances
        WHERE user_id = $1::uuid
        FOR UPDATE
        `,
        [job.userId],
      );
      return result.rows[0] ?? null;
    }

    const result = await client.query<CancellationBalanceRow>(
      `
      SELECT monthly_credits,
             purchased_credits,
             monthly_expires_at,
             false AS monthly_expired
      FROM organization_credit_balances
      WHERE organization_id = $1::uuid
      FOR UPDATE
      `,
      [job.organizationId],
    );
    return result.rows[0] ?? null;
  }

  private async settleCancelledJob(
    client: DatabaseClient,
    job: GenerationJob,
    actorUserId: string,
    lockedBalance: CancellationBalanceRow | null,
  ): Promise<void> {
    await this.restoreCancelledPage(client, job);
    await this.refundCancelledJobCredits(client, job, actorUserId, lockedBalance);
  }

  private async restoreCancelledPage(
    client: DatabaseClient,
    job: GenerationJob,
  ): Promise<void> {
    if (job.jobType !== 'page_generate') {
      return;
    }

    await client.query(
      `
      UPDATE pages
      SET status = generation_jobs.params->>'previous_page_status',
          generation_mode = CASE
            WHEN generation_jobs.params->>'previous_generation_mode' IN ('standard', 'thinking')
              THEN generation_jobs.params->>'previous_generation_mode'
            ELSE NULL
          END,
          updated_at = NOW()
      FROM generation_jobs,
           episodes
      INNER JOIN chapters ON chapters.id = episodes.chapter_id
      INNER JOIN works ON works.id = chapters.work_id
      WHERE generation_jobs.id = $1::uuid
        AND pages.id::text = generation_jobs.params->>'page_id'
        AND pages.episode_id = episodes.id
        AND pages.status = 'generating'
        AND generation_jobs.params->>'previous_page_status' IN (
          'designing', 'generated', 'editing', 'confirmed'
        )
        AND (
          ($3::uuid IS NULL
            AND works.user_id = $2::uuid
            AND works.organization_id IS NULL)
          OR (
            $3::uuid IS NOT NULL
            AND works.organization_id = $3::uuid
          )
        )
      `,
      [job.id, job.userId, job.organizationId ?? null],
    );
  }

  private async refundCancelledJobCredits(
    client: DatabaseClient,
    job: GenerationJob,
    actorUserId: string,
    lockedBalance: CancellationBalanceRow | null,
  ): Promise<void> {
    if (job.creditCost <= 0) {
      return;
    }

    const organizationId = job.organizationId ?? null;
    const summaryResult = await client.query<CancellationLedgerSummaryRow>(
      `
      SELECT
        COALESCE(SUM(amount) FILTER (WHERE type = 'consume'), 0)::text AS consumed_amount,
        COALESCE(SUM(amount) FILTER (WHERE type = 'refund'), 0)::text AS refunded_amount,
        COALESCE(SUM(monthly_delta) FILTER (WHERE type = 'consume'), 0)::text AS consumed_monthly_delta,
        COALESCE(SUM(purchased_delta) FILTER (WHERE type = 'consume'), 0)::text AS consumed_purchased_delta,
        COALESCE(SUM(monthly_delta) FILTER (WHERE type = 'refund'), 0)::text AS refunded_monthly_delta,
        COALESCE(SUM(purchased_delta) FILTER (WHERE type = 'refund'), 0)::text AS refunded_purchased_delta,
        COUNT(*) FILTER (WHERE type = 'consume')::text AS consumed_entry_count,
        COUNT(*) FILTER (WHERE type = 'refund')::text AS refunded_entry_count,
        COUNT(*) FILTER (
          WHERE type = 'consume'
            AND monthly_delta IS NOT NULL
            AND purchased_delta IS NOT NULL
        )::text AS consumed_complete_entry_count,
        COUNT(*) FILTER (
          WHERE type = 'refund'
            AND monthly_delta IS NOT NULL
            AND purchased_delta IS NOT NULL
        )::text AS refunded_complete_entry_count
      FROM credit_ledger
      WHERE job_id = $1::uuid
        AND type IN ('consume', 'refund')
        AND (
          ($2::uuid IS NULL
            AND organization_id IS NULL
            AND user_id = $3::uuid)
          OR (
            $2::uuid IS NOT NULL
            AND organization_id = $2::uuid
          )
        )
      `,
      [job.id, organizationId, job.userId],
    );
    const summary = summaryResult.rows[0];
    const refund = calculateCancellationRefund(summary, job.creditCost);
    if (refund === null) {
      return;
    }
    if (lockedBalance === null) {
      throw new ConfigurationError('Cancellation refund balance row is missing');
    }

    let monthlyDelta = refund.monthlyDelta;
    let purchasedDelta = refund.purchasedDelta;
    const monthlyExpired = organizationId === null && lockedBalance.monthly_expired === true;
    const currentMonthlyCredits = monthlyExpired ? 0 : lockedBalance.monthly_credits;
    if (monthlyExpired && monthlyDelta > 0) {
      purchasedDelta += monthlyDelta;
      monthlyDelta = 0;
    }
    const nextMonthlyCredits = currentMonthlyCredits + monthlyDelta;
    const nextPurchasedCredits = lockedBalance.purchased_credits + purchasedDelta;
    const nextMonthlyExpiresAt = monthlyExpired ? null : lockedBalance.monthly_expires_at;

    if (organizationId === null) {
      await client.query(
        `
        UPDATE credit_balances
        SET monthly_credits = $2,
            purchased_credits = $3,
            monthly_expires_at = $4,
            updated_at = NOW()
        WHERE user_id = $1::uuid
        `,
        [job.userId, nextMonthlyCredits, nextPurchasedCredits, nextMonthlyExpiresAt],
      );
    } else {
      await client.query(
        `
        UPDATE organization_credit_balances
        SET monthly_credits = $2,
            purchased_credits = $3,
            monthly_expires_at = $4,
            updated_at = NOW()
        WHERE organization_id = $1::uuid
        `,
        [organizationId, nextMonthlyCredits, nextPurchasedCredits, nextMonthlyExpiresAt],
      );
    }

    await client.query(
      `
      INSERT INTO credit_ledger (
        user_id,
        organization_id,
        type,
        amount,
        monthly_delta,
        purchased_delta,
        monthly_after,
        purchased_after,
        description,
        job_id
      )
      VALUES ($1::uuid, $2::uuid, 'refund', $3, $4, $5, $6, $7, $8, $9::uuid)
      `,
      [
        organizationId === null ? job.userId : actorUserId,
        organizationId,
        refund.amount,
        monthlyDelta,
        purchasedDelta,
        nextMonthlyCredits,
        nextPurchasedCredits,
        'Refund for cancelled generation job',
        job.id,
      ],
    );

    if (organizationId !== null) {
      await client.query(
        `
        INSERT INTO organization_usage_events (
          organization_id,
          user_id,
          work_id,
          generation_job_id,
          event_type,
          credit_amount,
          metadata
        )
        VALUES ($1::uuid, $2::uuid, NULL, $3::uuid, 'credit.refunded', 0, $4::jsonb)
        `,
        [
          organizationId,
          actorUserId,
          job.id,
          JSON.stringify({ status: 'cancelled', credits_refunded: refund.amount }),
        ],
      );
      await client.query(
        `
        INSERT INTO organization_audit_logs (
          organization_id,
          actor_user_id,
          action,
          target_type,
          target_id,
          metadata
        )
        VALUES ($1::uuid, $2::uuid, 'credit.refunded', 'credit', $3::uuid, $4::jsonb)
        `,
        [
          organizationId,
          actorUserId,
          job.id,
          JSON.stringify({ amount: refund.amount, reason: 'generation_cancelled' }),
        ],
      );
    }
  }

  public async markFailed(jobId: string, errorMessage: string): Promise<boolean> {
    const persistedErrorMessage = sanitizePersistedErrorMessage(errorMessage, 'Generation job failed');
    const result = await this.client.query<GenerationJobRow>(
      `
      UPDATE generation_jobs
      SET status = 'failed',
          error_message = $2,
          completed_at = NOW()
      WHERE id = $1
        AND status IN ('queued', 'processing')
        AND cancel_requested_at IS NULL
      RETURNING *
      `,
      [jobId, persistedErrorMessage],
    );

    return (result.rowCount ?? 0) > 0;
  }

  public async prepareRetry(
    jobId: string,
    maxRetryCount: number,
    options?: PrepareGenerationJobRetryOptions,
  ): Promise<boolean> {
    if (options !== undefined) {
      const transactionRunner = this.requireTransactionRunnerForCapacity();
      return transactionRunner.transaction(async (transactionClient) => {
        const scope = getGenerationCapacityScope(options.userId, options.organizationId ?? null);
        await this.lockGenerationCapacity(transactionClient, scope);
        await this.assertCapacityWithinTransaction(
          transactionClient,
          scope,
          options.capacityLimits,
        );
        return this.prepareRetryWithClient(transactionClient, jobId, maxRetryCount);
      });
    }

    return this.prepareRetryWithClient(this.client, jobId, maxRetryCount);
  }

  private requireTransactionRunnerForCapacity(): DatabaseClient & TransactionRunner {
    if (!isTransactionRunner(this.client)) {
      throw new ConfigurationError(
        'Generation job capacity limits require a transaction-capable database client',
      );
    }

    return this.client;
  }

  private requireTransactionRunnerForHistory(): DatabaseClient & TransactionRunner {
    if (!isTransactionRunner(this.client)) {
      throw new ConfigurationError(
        'Generation job history management requires a transaction-capable database client',
      );
    }

    return this.client;
  }

  private requireTransactionRunnerForCancellation(): DatabaseClient & TransactionRunner {
    if (!isTransactionRunner(this.client)) {
      throw new ConfigurationError(
        'Generation job cancellation requires a transaction-capable database client',
      );
    }

    return this.client;
  }

  private async prepareRetryWithClient(
    client: DatabaseClient,
    jobId: string,
    maxRetryCount: number,
  ): Promise<boolean> {
    const result = await client.query<GenerationJobRow>(
      `
      UPDATE generation_jobs
      SET status = 'queued',
          retry_count = retry_count + 1,
          started_at = NULL,
          completed_at = NULL,
          error_message = NULL,
          openai_request_id = NULL,
          sqs_message_id = NULL,
          cancel_requested_at = NULL,
          cancel_requested_by = NULL,
          cancelled_at = NULL,
          commit_started_at = NULL
      WHERE id = $1
        AND status = 'failed'
        AND retry_count < $2
      RETURNING *
      `,
      [jobId, maxRetryCount],
    );

    return (result.rowCount ?? 0) > 0;
  }

  public async pruneExpiredTerminalJobs(
    input: PruneExpiredGenerationJobsInput,
  ): Promise<PruneExpiredGenerationJobsResult> {
    if (!Number.isSafeInteger(input.maxDeletes) || input.maxDeletes <= 0) {
      throw new Error('maxDeletes must be a positive safe integer');
    }

    const candidateIds = await this.findExpiredTerminalJobIds(input.maxDeletes + 1);
    const truncated = candidateIds.length > input.maxDeletes;
    const idsToDelete = candidateIds.slice(0, input.maxDeletes);

    if (input.dryRun || idsToDelete.length === 0) {
      return {
        dryRun: input.dryRun,
        candidateCount: idsToDelete.length,
        deletedCount: 0,
        candidateIds: idsToDelete,
        truncated,
      };
    }

    const deletedResult = await this.client.query<{ id: string }>(
      `
      DELETE FROM generation_jobs
      WHERE id = ANY($1::uuid[])
        AND expires_at IS NOT NULL
        AND expires_at < NOW()
        AND status IN ('completed', 'failed', 'cancelled')
      RETURNING id
      `,
      [idsToDelete],
    );

    return {
      dryRun: false,
      candidateCount: idsToDelete.length,
      deletedCount: deletedResult.rows.length,
      candidateIds: deletedResult.rows.map((row) => row.id),
      truncated,
    };
  }

  private async findExpiredTerminalJobIds(limit: number): Promise<string[]> {
    const result = await this.client.query<{ id: string }>(
      `
      SELECT id
      FROM generation_jobs
      WHERE expires_at IS NOT NULL
        AND expires_at < NOW()
        AND status IN ('completed', 'failed', 'cancelled')
      ORDER BY expires_at ASC, created_at ASC
      LIMIT $1
      `,
      [limit],
    );

    return result.rows.map((row) => row.id);
  }

  private async findActiveResourceJob(
    userId: string,
    jobType: GenerationJobType,
    resourceParamKey: 'page_id' | 'entity_id' | 'episode_id',
    resourceId: string,
    organizationId: string | null,
  ): Promise<GenerationJob | null> {
    const result = await this.client.query<GenerationJobRow>(
      `
      SELECT *
      FROM generation_jobs
      WHERE job_type = $2
        AND status IN ('queued', 'processing')
        AND params->>$3 = $4
        AND (
          ($5::uuid IS NULL AND user_id = $1 AND organization_id IS NULL)
          OR (
            $5::uuid IS NOT NULL
            AND organization_id = $5::uuid
            AND EXISTS (
              SELECT 1
              FROM organization_members
              WHERE organization_members.organization_id = generation_jobs.organization_id
                AND organization_members.user_id = $1
                AND organization_members.status = 'active'
            )
          )
        )
      ORDER BY created_at DESC
      LIMIT 1
      `,
      [userId, jobType, resourceParamKey, resourceId, organizationId],
    );

    return result.rows[0] === undefined ? null : mapGenerationJobRow(result.rows[0]);
  }
}

function isTransactionRunner(client: DatabaseClient & Partial<TransactionRunner>): client is DatabaseClient & TransactionRunner {
  return typeof client.transaction === 'function';
}

function normalizeCapacityJobTypes(jobTypes: readonly GenerationJobType[] | undefined): readonly GenerationJobType[] {
  const normalized = jobTypes?.filter((jobType, index, values) => values.indexOf(jobType) === index);
  return normalized === undefined || normalized.length === 0 ? DEFAULT_CAPACITY_JOB_TYPES : normalized;
}

function getGenerationCapacityScope(userId: string, organizationId: string | null): GenerationCapacityScope {
  return { userId, organizationId };
}

function formatGenerationCapacityScopeKey(scope: GenerationCapacityScope): string {
  return scope.organizationId === null
    ? `generation_jobs:user:${scope.userId}`
    : `generation_jobs:organization:${scope.organizationId}`;
}

export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === '23505'
  );
}

function mapGenerationJobRow(row: GenerationJobRow): GenerationJob {
  return {
    id: row.id,
    userId: row.user_id,
    organizationId: row.organization_id,
    jobType: row.job_type,
    status: row.status,
    generationMode: toPageGenerationMode(row.generation_mode),
    creditCost: row.credit_cost,
    params: toJsonObject(row.params),
    result: row.result === null ? null : toJsonObject(row.result),
    sqsMessageId: row.sqs_message_id,
    openaiRequestId: row.openai_request_id,
    errorMessage: row.error_message,
    retryCount: row.retry_count,
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    expiresAt: row.expires_at,
    cancelRequestedAt: row.cancel_requested_at,
    cancelRequestedBy: row.cancel_requested_by,
    cancelledAt: row.cancelled_at,
    commitStartedAt: row.commit_started_at,
  };
}

function toPageGenerationMode(value: string | null): PageGenerationMode | null {
  return value === 'standard' || value === 'thinking' ? value : null;
}

function toJsonObject(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function isGenerationJobCancellationRace(error: unknown): boolean {
  return (
    typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code: unknown }).code === 'P0001'
    && 'constraint' in error
    && (error as { constraint: unknown }).constraint === 'generation_job_credit_consume_active'
  );
}

function calculateCancellationRefund(
  row: CancellationLedgerSummaryRow | undefined,
  requestedAmount: number,
): { amount: number; monthlyDelta: number; purchasedDelta: number } | null {
  if (row === undefined) {
    return null;
  }

  const consumedEntryCount = Number(row.consumed_entry_count ?? '0');
  if (consumedEntryCount <= 0) {
    return null;
  }
  const refundedEntryCount = Number(row.refunded_entry_count ?? '0');
  const completeBucketDeltas =
    consumedEntryCount === Number(row.consumed_complete_entry_count ?? '0')
    && refundedEntryCount === Number(row.refunded_complete_entry_count ?? '0');

  if (!completeBucketDeltas) {
    const remaining = Math.max(
      0,
      Math.abs(Number(row.consumed_amount ?? '0')) - Number(row.refunded_amount ?? '0'),
    );
    const amount = Math.min(requestedAmount, remaining);
    return amount <= 0 ? null : { amount, monthlyDelta: 0, purchasedDelta: amount };
  }

  const remainingMonthly = Math.max(
    0,
    -Number(row.consumed_monthly_delta ?? '0') - Number(row.refunded_monthly_delta ?? '0'),
  );
  const remainingPurchased = Math.max(
    0,
    -Number(row.consumed_purchased_delta ?? '0') - Number(row.refunded_purchased_delta ?? '0'),
  );
  const amount = Math.min(requestedAmount, remainingMonthly + remainingPurchased);
  if (amount <= 0) {
    return null;
  }
  const monthlyDelta = Math.min(remainingMonthly, amount);
  return {
    amount,
    monthlyDelta,
    purchasedDelta: amount - monthlyDelta,
  };
}

function toGenerationJobHistoryActiveRank(value: number): 0 | 1 {
  if (value === 0 || value === 1) {
    return value;
  }

  throw new ConfigurationError('Generation job history active rank is invalid');
}
