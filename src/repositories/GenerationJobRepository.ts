import type { QueryResultRow } from 'pg';
import type {
  GenerationJob,
  GenerationJobCreditSettlement,
  GenerationJobStatus,
  GenerationJobType,
} from '../domain/types/job.js';
import { createGenerationJobCreditSettlement } from '../domain/types/job.js';
import type { PageGenerationMode } from '../domain/types/pageGeneration.js';
import { ConfigurationError, ConflictError, ValidationError } from '../domain/errors/index.js';
import type { DatabaseClient, TransactionRunner } from '../lib/db.js';
import { sanitizePersistedErrorMessage } from '../lib/errorSanitizer.js';

export type { GenerationJob };

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

export type GenerationJobAccessCapability = 'view_work' | 'generate';

export interface GenerationJobAccessScope {
  userId: string;
  organizationId: string | null;
  capability: GenerationJobAccessCapability;
}

export interface FindGenerationJobForScopeInput extends GenerationJobAccessScope {
  jobId: string;
}

export interface GenerationJobListCursor {
  activeRank: 0 | 1;
  createdAt: Date;
  id: string;
}

export interface ListGenerationJobsForScopeInput extends GenerationJobAccessScope {
  limit: number;
  cursor: GenerationJobListCursor | null;
  statuses: readonly GenerationJobStatus[];
  jobTypes: readonly GenerationJobType[];
}

export interface GenerationJobListPage {
  jobs: GenerationJob[];
  nextCursor: GenerationJobListCursor | null;
}

export type CancelQueuedGenerationJobResult =
  | { kind: 'not_found' }
  | { kind: 'processing'; job: GenerationJob }
  | { kind: 'terminal'; job: GenerationJob }
  | { kind: 'canceled'; job: GenerationJob; refundedCredits: number };

export type CancelGenerationJobResult =
  | { kind: 'not_found' }
  | { kind: 'terminal'; job: GenerationJob }
  | { kind: 'requested'; job: GenerationJob }
  | { kind: 'canceled'; job: GenerationJob; refundedCredits: number };

export interface GenerationJobCancellationCheckpointPort {
  finalizeCancellationIfRequested(jobId: string): Promise<boolean>;
}

export type HideGenerationJobHistoryResult =
  | { kind: 'not_found' }
  | { kind: 'active'; job: GenerationJob }
  | { kind: 'hidden'; job: GenerationJob };

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
  findByIdForScope?(input: FindGenerationJobForScopeInput): Promise<GenerationJob | null>;
  listForScope?(input: ListGenerationJobsForScopeInput): Promise<GenerationJobListPage>;
  cancelQueuedForScope?(input: FindGenerationJobForScopeInput): Promise<CancelQueuedGenerationJobResult>;
  cancelForScope?(input: FindGenerationJobForScopeInput): Promise<CancelGenerationJobResult>;
  finalizeCancellationIfRequested?(jobId: string): Promise<boolean>;
  hideFromHistory?(input: FindGenerationJobForScopeInput): Promise<HideGenerationJobHistoryResult>;
}

export interface GenerationJobCancellationRepository {
  requestCancellation(
    jobId: string,
    userId: string,
    organizationId?: string | null,
  ): Promise<GenerationJob | null>;
  finalizeCancellation(jobId: string): Promise<boolean>;
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
  cancel_requested_at: Date | null;
  cancel_requested_by: string | null;
  cancelled_at: Date | null;
  commit_started_at: Date | null;
  retry_count: number;
  created_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
  expires_at: Date | null;
  charged_credits?: string | number;
  refunded_credits?: string | number;
}

interface GenerationJobListRow extends GenerationJobRow {
  active_rank: 0 | 1;
}

interface CreditLedgerSummaryRow extends QueryResultRow {
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

interface LockedCreditBalanceRow extends QueryResultRow {
  monthly_credits: number;
  purchased_credits: number;
  monthly_expires_at: Date | null;
}

const DEFAULT_CAPACITY_JOB_TYPES: readonly GenerationJobType[] = [
  'page_generate',
  'entity_generate',
];

export class PostgresGenerationJobRepository
  implements GenerationJobRepository, GenerationJobCancellationRepository
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

  public async findByIdForScope(input: FindGenerationJobForScopeInput): Promise<GenerationJob | null> {
    return this.findScopedJobWithClient(this.client, input, false);
  }

  public async listForScope(input: ListGenerationJobsForScopeInput): Promise<GenerationJobListPage> {
    if (!Number.isSafeInteger(input.limit) || input.limit <= 0 || input.limit > 100) {
      throw new ValidationError('Job list limit must be between 1 and 100');
    }

    const scopeSql = buildGenerationJobScopeSql('generation_jobs', input.capability, 1, 2);
    const result = await this.client.query<GenerationJobListRow>(
      `
      WITH visible_jobs AS (
        SELECT
          generation_jobs.*,
          CASE WHEN generation_jobs.status IN ('queued', 'processing') THEN 0 ELSE 1 END AS active_rank
        FROM generation_jobs
        WHERE ${scopeSql}
          AND NOT EXISTS (
            SELECT 1
            FROM generation_job_history_hides
            WHERE generation_job_history_hides.generation_job_id = generation_jobs.id
              AND generation_job_history_hides.user_id = $1
          )
          AND (cardinality($3::text[]) = 0 OR generation_jobs.status = ANY($3::text[]))
          AND (cardinality($4::text[]) = 0 OR generation_jobs.job_type = ANY($4::text[]))
      ),
      settled_jobs AS (
        SELECT
          visible_jobs.*,
          credit_settlement.charged_credits,
          credit_settlement.refunded_credits
        FROM visible_jobs
        ${buildGenerationJobCreditSettlementLateralJoin('visible_jobs')}
      )
      SELECT *
      FROM settled_jobs
      WHERE (
        $5::int IS NULL
        OR active_rank > $5::int
        OR (
          active_rank = $5::int
          AND (
            created_at < $6::timestamptz
            OR (created_at = $6::timestamptz AND id < $7::uuid)
          )
        )
      )
      ORDER BY active_rank ASC, created_at DESC, id DESC
      LIMIT $8
      `,
      [
        input.userId,
        input.organizationId,
        [...input.statuses],
        [...input.jobTypes],
        input.cursor?.activeRank ?? null,
        input.cursor?.createdAt ?? null,
        input.cursor?.id ?? null,
        input.limit + 1,
      ],
    );

    const hasMore = result.rows.length > input.limit;
    const rows = hasMore ? result.rows.slice(0, input.limit) : result.rows;
    const lastRow = rows.at(-1);
    return {
      jobs: rows.map(mapGenerationJobRow),
      nextCursor:
        hasMore && lastRow !== undefined
          ? {
              activeRank: lastRow.active_rank,
              createdAt: lastRow.created_at,
              id: lastRow.id,
            }
          : null,
    };
  }

  public async cancelQueuedForScope(
    input: FindGenerationJobForScopeInput,
  ): Promise<CancelQueuedGenerationJobResult> {
    const transactionRunner = this.requireTransactionRunnerForJobManagement();
    return transactionRunner.transaction(async (client) => {
      const candidate = await this.findScopedJobWithClient(client, input, false);
      if (candidate === null) {
        return { kind: 'not_found' };
      }

      // Generation producers and the late-consume trigger lock the balance first,
      // then the job row. Keep the same order to avoid cancellation/refund races.
      if (candidate.creditCost > 0) {
        await this.lockCreditBalanceForJob(client, candidate);
      }

      const job = await this.findScopedJobWithClient(client, input, true);
      if (job === null) {
        return { kind: 'not_found' };
      }
      if (job.status === 'processing') {
        return { kind: 'processing', job };
      }
      if (job.status !== 'queued') {
        return { kind: 'terminal', job };
      }

      const canceledResult = await client.query<GenerationJobRow>(
        `
        UPDATE generation_jobs
        SET status = 'cancelled',
            cancel_requested_at = COALESCE(cancel_requested_at, NOW()),
            cancel_requested_by = COALESCE(cancel_requested_by, $2::uuid),
            cancelled_at = COALESCE(cancelled_at, NOW()),
            completed_at = NOW(),
            error_message = NULL
        WHERE id = $1
          AND status = 'queued'
        RETURNING *
        `,
        [job.id, input.userId],
      );
      const canceledRow = canceledResult.rows[0];
      if (canceledRow === undefined) {
        const current = await this.findScopedJobWithClient(client, input, true);
        return current === null || current.status === 'queued'
          ? { kind: 'not_found' }
          : current.status === 'processing'
            ? { kind: 'processing', job: current }
            : { kind: 'terminal', job: current };
      }

      const canceledJob = mapGenerationJobRow(canceledRow);
      const refundedCredits = await this.refundCanceledJobCredits(client, canceledJob, input.userId);
      await this.recordOrganizationCancellation(client, canceledJob, input.userId, refundedCredits);
      const settledCanceledJob = await this.findScopedJobWithClient(client, input, false);
      return {
        kind: 'canceled',
        job: settledCanceledJob ?? canceledJob,
        refundedCredits,
      };
    });
  }

  public async cancelForScope(
    input: FindGenerationJobForScopeInput,
  ): Promise<CancelGenerationJobResult> {
    const immediate = await this.cancelQueuedForScope(input);
    if (immediate.kind !== 'processing') {
      return immediate;
    }

    const result = await this.client.query<GenerationJobRow>(
      `
      UPDATE generation_jobs
      SET cancel_requested_at = COALESCE(cancel_requested_at, NOW()),
          cancel_requested_by = COALESCE(cancel_requested_by, $2::uuid)
      WHERE id = $1
        AND status = 'processing'
        AND commit_started_at IS NULL
        AND ${buildGenerationJobScopeSql('generation_jobs', input.capability, 2, 3)}
      RETURNING *
      `,
      [input.jobId, input.userId, input.organizationId],
    );
    const requested = result.rows[0];
    if (requested !== undefined) {
      const settled = await this.findScopedJobWithClient(this.client, input, false);
      return {
        kind: 'requested',
        job: settled ?? mapGenerationJobRow(requested),
      };
    }

    const current = await this.findScopedJobWithClient(this.client, input, false);
    return current === null
      ? { kind: 'not_found' }
      : { kind: 'terminal', job: current };
  }

  public async finalizeCancellationIfRequested(jobId: string): Promise<boolean> {
    const transactionRunner = this.requireTransactionRunnerForJobManagement();
    return transactionRunner.transaction(async (client) => {
      const candidate = await this.findJobByIdWithClient(client, jobId, false);
      if (
        candidate === null ||
        candidate.status !== 'processing' ||
        candidate.cancelRequestedAt === null ||
        candidate.cancelRequestedAt === undefined
      ) {
        return false;
      }

      // Credit producers and the queued-cancel path acquire the balance before
      // the job row. Keep this order for processing cancellation as well.
      if (candidate.creditCost > 0) {
        await this.lockCreditBalanceForJob(client, candidate);
      }

      const job = await this.findJobByIdWithClient(client, jobId, true);
      if (
        job === null ||
        job.status !== 'processing' ||
        job.cancelRequestedAt === null ||
        job.cancelRequestedAt === undefined
      ) {
        return false;
      }

      const canceledResult = await client.query<GenerationJobRow>(
        `
        UPDATE generation_jobs
        SET status = 'cancelled',
            cancelled_at = COALESCE(cancelled_at, NOW()),
            completed_at = NOW(),
            error_message = NULL
        WHERE id = $1
          AND status = 'processing'
          AND cancel_requested_at IS NOT NULL
          AND commit_started_at IS NULL
        RETURNING *
        `,
        [job.id],
      );
      const canceledRow = canceledResult.rows[0];
      if (canceledRow === undefined) {
        return false;
      }

      const canceledJob = mapGenerationJobRow(canceledRow);
      const actorUserId = canceledJob.cancelRequestedBy ?? canceledJob.userId;
      const refundedCredits = await this.refundCanceledJobCredits(client, canceledJob, actorUserId);
      await this.recordOrganizationCancellation(client, canceledJob, actorUserId, refundedCredits);
      return true;
    });
  }

  public async hideFromHistory(
    input: FindGenerationJobForScopeInput,
  ): Promise<HideGenerationJobHistoryResult> {
    const transactionRunner = this.requireTransactionRunnerForJobManagement();
    return transactionRunner.transaction(async (client) => {
      const job = await this.findScopedJobWithClient(client, input, true, true);
      if (job === null) {
        return { kind: 'not_found' };
      }
      if (!isTerminalGenerationJobStatus(job.status)) {
        return { kind: 'active', job };
      }

      await client.query(
        `
        INSERT INTO generation_job_history_hides (generation_job_id, user_id)
        VALUES ($1, $2)
        ON CONFLICT (generation_job_id, user_id) DO NOTHING
        `,
        [job.id, input.userId],
      );
      return { kind: 'hidden', job };
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
    const result = await this.client.query<GenerationJobRow>(
      `
      UPDATE generation_jobs
      SET cancel_requested_at = COALESCE(cancel_requested_at, NOW()),
          cancel_requested_by = COALESCE(cancel_requested_by, $2::uuid),
          status = CASE WHEN status = 'queued' THEN 'cancelled' ELSE status END,
          cancelled_at = CASE WHEN status = 'queued' THEN NOW() ELSE cancelled_at END,
          completed_at = CASE WHEN status = 'queued' THEN NOW() ELSE completed_at END,
          result = COALESCE(result, '{}'::jsonb) || jsonb_build_object(
            'progress_stage', CASE WHEN status = 'queued' THEN 'cancelled' ELSE 'cancellation_requested' END,
            'progress_message', CASE
              WHEN status = 'queued' THEN 'Story plan autofill was stopped.'
              ELSE 'Stop requested. The current safe step will finish before stopping.'
            END,
            'progress_updated_at', NOW()
          )
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
        AND job_type = 'episode_story_autofill'
        AND status IN ('queued', 'processing')
        AND commit_started_at IS NULL
      RETURNING *
      `,
      [jobId, userId, organizationId],
    );

    return result.rows[0] === undefined ? null : mapGenerationJobRow(result.rows[0]);
  }

  public async finalizeCancellation(jobId: string): Promise<boolean> {
    const result = await this.client.query<GenerationJobRow>(
      `
      UPDATE generation_jobs
      SET status = 'cancelled',
          cancelled_at = COALESCE(cancelled_at, NOW()),
          completed_at = COALESCE(completed_at, NOW()),
          error_message = NULL,
          result = COALESCE(result, '{}'::jsonb) || jsonb_build_object(
            'progress_stage', 'cancelled',
            'progress_message', 'Story plan autofill was stopped.',
            'progress_updated_at', NOW()
          )
      WHERE id = $1
        AND job_type = 'episode_story_autofill'
        AND status = 'processing'
        AND cancel_requested_at IS NOT NULL
        AND commit_started_at IS NULL
      RETURNING *
      `,
      [jobId],
    );

    return (result.rowCount ?? 0) > 0;
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

  private async findScopedJobWithClient(
    client: DatabaseClient,
    input: FindGenerationJobForScopeInput,
    forUpdate: boolean,
    includeHistoryHidden: boolean = false,
  ): Promise<GenerationJob | null> {
    const scopeSql = buildGenerationJobScopeSql('generation_jobs', input.capability, 2, 3);
    const result = await client.query<GenerationJobRow>(
      `
      WITH scoped_job AS (
        SELECT generation_jobs.*
        FROM generation_jobs
        WHERE generation_jobs.id = $1
          AND ${scopeSql}
          ${includeHistoryHidden ? '' : `
          AND NOT EXISTS (
            SELECT 1
            FROM generation_job_history_hides
            WHERE generation_job_history_hides.generation_job_id = generation_jobs.id
              AND generation_job_history_hides.user_id = $2
          )`}
        ${forUpdate ? 'FOR UPDATE' : ''}
      )
      SELECT
        scoped_job.*,
        credit_settlement.charged_credits,
        credit_settlement.refunded_credits
      FROM scoped_job
      ${buildGenerationJobCreditSettlementLateralJoin('scoped_job')}
      `,
      [input.jobId, input.userId, input.organizationId],
    );
    return result.rows[0] === undefined ? null : mapGenerationJobRow(result.rows[0]);
  }

  private async findJobByIdWithClient(
    client: DatabaseClient,
    jobId: string,
    forUpdate: boolean,
  ): Promise<GenerationJob | null> {
    const result = await client.query<GenerationJobRow>(
      `
      SELECT *
      FROM generation_jobs
      WHERE id = $1
      ${forUpdate ? 'FOR UPDATE' : ''}
      `,
      [jobId],
    );
    return result.rows[0] === undefined ? null : mapGenerationJobRow(result.rows[0]);
  }

  private async lockCreditBalanceForJob(
    client: DatabaseClient,
    job: GenerationJob,
  ): Promise<LockedCreditBalanceRow> {
    if ((job.organizationId ?? null) === null) {
      await client.query(
        `
        INSERT INTO credit_balances (user_id, monthly_credits, purchased_credits)
        VALUES ($1, 0, 0)
        ON CONFLICT (user_id) DO NOTHING
        `,
        [job.userId],
      );
      const result = await client.query<LockedCreditBalanceRow>(
        `
        SELECT monthly_credits, purchased_credits, monthly_expires_at
        FROM credit_balances
        WHERE user_id = $1
        FOR UPDATE
        `,
        [job.userId],
      );
      const balance = result.rows[0];
      if (balance === undefined) {
        throw new ConfigurationError('Personal credit balance could not be locked');
      }
      return balance;
    }

    const organizationId = job.organizationId ?? null;
    if (organizationId === null) {
      throw new ConfigurationError('Organization generation job is missing its organization scope');
    }
    await client.query(
      `
      INSERT INTO organization_credit_balances (organization_id)
      VALUES ($1)
      ON CONFLICT (organization_id) DO NOTHING
      `,
      [organizationId],
    );
    const result = await client.query<LockedCreditBalanceRow>(
      `
      SELECT monthly_credits, purchased_credits, monthly_expires_at
      FROM organization_credit_balances
      WHERE organization_id = $1
      FOR UPDATE
      `,
      [organizationId],
    );
    const balance = result.rows[0];
    if (balance === undefined) {
      throw new ConfigurationError('Organization credit balance could not be locked');
    }
    return balance;
  }

  private async refundCanceledJobCredits(
    client: DatabaseClient,
    job: GenerationJob,
    actorUserId: string,
  ): Promise<number> {
    if (job.creditCost <= 0) {
      return 0;
    }

    const ledgerSummaryResult = await client.query<CreditLedgerSummaryRow>(
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
      WHERE job_id = $1
        AND (
          ($2::uuid IS NULL AND organization_id IS NULL AND user_id = $3)
          OR ($2::uuid IS NOT NULL AND organization_id = $2::uuid)
        )
      `,
      [job.id, job.organizationId ?? null, job.userId],
    );
    const refund = calculateCanceledJobRefund(
      ledgerSummaryResult.rows[0],
      job.creditCost,
    );
    if (refund === null) {
      return 0;
    }

    const balance = await this.lockCreditBalanceForJob(client, job);
    const monthlyExpired =
      balance.monthly_expires_at !== null && balance.monthly_expires_at.getTime() <= Date.now();
    const monthlyDelta = monthlyExpired ? 0 : refund.monthlyDelta;
    const purchasedDelta = refund.purchasedDelta + (monthlyExpired ? refund.monthlyDelta : 0);
    const nextMonthly = (monthlyExpired ? 0 : balance.monthly_credits) + monthlyDelta;
    const nextPurchased = balance.purchased_credits + purchasedDelta;
    const organizationId = job.organizationId ?? null;

    if (organizationId === null) {
      await client.query(
        `
        UPDATE credit_balances
        SET monthly_credits = $2,
            purchased_credits = $3,
            updated_at = NOW()
        WHERE user_id = $1
        `,
        [job.userId, nextMonthly, nextPurchased],
      );
    } else {
      await client.query(
        `
        UPDATE organization_credit_balances
        SET monthly_credits = $2,
            purchased_credits = $3,
            updated_at = NOW()
        WHERE organization_id = $1
        `,
        [organizationId, nextMonthly, nextPurchased],
      );
    }

    await client.query(
      `
      INSERT INTO credit_ledger (
        user_id, organization_id, type, amount, monthly_delta, purchased_delta,
        monthly_after, purchased_after, description, job_id
      )
      VALUES ($1, $2, 'refund', $3, $4, $5, $6, $7, $8, $9)
      `,
      [
        actorUserId,
        organizationId,
        refund.amount,
        monthlyDelta,
        purchasedDelta,
        nextMonthly,
        nextPurchased,
        'Refund for canceled queued generation job',
        job.id,
      ],
    );
    return refund.amount;
  }

  private async recordOrganizationCancellation(
    client: DatabaseClient,
    job: GenerationJob,
    actorUserId: string,
    refundedCredits: number,
  ): Promise<void> {
    const organizationId = job.organizationId ?? null;
    if (organizationId === null) {
      return;
    }

    await client.query(
      `
      INSERT INTO organization_usage_events (
        organization_id, user_id, generation_job_id, event_type, credit_amount, metadata
      )
      VALUES ($1, $2, $3, 'generation.canceled', 0, $4::jsonb)
      `,
      [organizationId, actorUserId, job.id, JSON.stringify({ credits_refunded: refundedCredits })],
    );
    await client.query(
      `
      INSERT INTO organization_audit_logs (
        organization_id, actor_user_id, action, target_type, target_id, metadata
      )
      VALUES ($1, $2, 'generation.canceled', 'generation_job', $3, $4::jsonb)
      `,
      [organizationId, actorUserId, job.id, JSON.stringify({ credits_refunded: refundedCredits })],
    );
  }

  private requireTransactionRunnerForCapacity(): DatabaseClient & TransactionRunner {
    if (!isTransactionRunner(this.client)) {
      throw new ConfigurationError(
        'Generation job capacity limits require a transaction-capable database client',
      );
    }

    return this.client;
  }

  private requireTransactionRunnerForJobManagement(): DatabaseClient & TransactionRunner {
    if (!isTransactionRunner(this.client)) {
      throw new ConfigurationError(
        'Generation job management requires a transaction-capable database client',
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

function buildGenerationJobScopeSql(
  tableName: 'generation_jobs',
  capability: GenerationJobAccessCapability,
  userIdParameter: number,
  organizationIdParameter: number,
): string {
  const organizationRoles = generationJobOrganizationRoles(capability)
    .map((role) => `'${role}'`)
    .join(', ');
  return `(
    ($${organizationIdParameter}::uuid IS NULL
      AND ${tableName}.user_id = $${userIdParameter}
      AND ${tableName}.organization_id IS NULL)
    OR (
      $${organizationIdParameter}::uuid IS NOT NULL
      AND ${tableName}.organization_id = $${organizationIdParameter}::uuid
      AND EXISTS (
        SELECT 1
        FROM organization_members
        WHERE organization_members.organization_id = ${tableName}.organization_id
          AND organization_members.user_id = $${userIdParameter}
          AND organization_members.status = 'active'
          AND organization_members.role IN (${organizationRoles})
      )
    )
  )`;
}

function generationJobOrganizationRoles(
  capability: GenerationJobAccessCapability,
): readonly ('owner' | 'admin' | 'editor' | 'viewer')[] {
  return capability === 'generate'
    ? ['owner', 'admin', 'editor']
    : ['owner', 'admin', 'editor', 'viewer'];
}

function isTerminalGenerationJobStatus(status: GenerationJobStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

function calculateCanceledJobRefund(
  row: CreditLedgerSummaryRow | undefined,
  requestedAmount: number,
): { amount: number; monthlyDelta: number; purchasedDelta: number } | null {
  const consumedEntryCount = Number(row?.consumed_entry_count ?? '0');
  if (consumedEntryCount === 0) {
    return null;
  }

  const consumedCompleteEntryCount = Number(row?.consumed_complete_entry_count ?? '0');
  const refundedEntryCount = Number(row?.refunded_entry_count ?? '0');
  const refundedCompleteEntryCount = Number(row?.refunded_complete_entry_count ?? '0');
  const allBucketDeltasPresent =
    consumedEntryCount === consumedCompleteEntryCount &&
    refundedEntryCount === refundedCompleteEntryCount;

  if (allBucketDeltasPresent) {
    const remainingMonthly = Math.max(
      0,
      -Number(row?.consumed_monthly_delta ?? '0') - Number(row?.refunded_monthly_delta ?? '0'),
    );
    const remainingPurchased = Math.max(
      0,
      -Number(row?.consumed_purchased_delta ?? '0') - Number(row?.refunded_purchased_delta ?? '0'),
    );
    const refundableAmount = remainingMonthly + remainingPurchased;
    if (refundableAmount <= 0) {
      return null;
    }
    const amount = Math.min(requestedAmount, refundableAmount);
    const monthlyDelta = Math.min(remainingMonthly, amount);
    return { amount, monthlyDelta, purchasedDelta: amount - monthlyDelta };
  }

  const refundableAmount = Math.max(
    0,
    Math.abs(Number(row?.consumed_amount ?? '0')) - Number(row?.refunded_amount ?? '0'),
  );
  if (refundableAmount <= 0) {
    return null;
  }
  const amount = Math.min(requestedAmount, refundableAmount);
  return { amount, monthlyDelta: 0, purchasedDelta: amount };
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
  const creditSettlement = toGenerationJobCreditSettlement(row);
  return {
    id: row.id,
    userId: row.user_id,
    organizationId: row.organization_id,
    jobType: row.job_type,
    status: row.status,
    generationMode: toPageGenerationMode(row.generation_mode),
    creditCost: row.credit_cost,
    ...(creditSettlement === undefined ? {} : { creditSettlement }),
    params: toJsonObject(row.params),
    result: row.result === null ? null : toJsonObject(row.result),
    sqsMessageId: row.sqs_message_id,
    openaiRequestId: row.openai_request_id,
    errorMessage: row.error_message,
    cancelRequestedAt: row.cancel_requested_at,
    cancelRequestedBy: row.cancel_requested_by,
    cancelledAt: row.cancelled_at,
    commitStartedAt: row.commit_started_at,
    retryCount: row.retry_count,
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    expiresAt: row.expires_at,
  };
}

function buildGenerationJobCreditSettlementLateralJoin(jobTable: string): string {
  return `
      LEFT JOIN LATERAL (
        SELECT
          GREATEST(0, -COALESCE(SUM(credit_ledger.amount) FILTER (
            WHERE credit_ledger.type = 'consume'
          ), 0))::text AS charged_credits,
          GREATEST(0, COALESCE(SUM(credit_ledger.amount) FILTER (
            WHERE credit_ledger.type = 'refund'
          ), 0))::text AS refunded_credits
        FROM credit_ledger
        WHERE credit_ledger.job_id = ${jobTable}.id
          AND (
            (${jobTable}.organization_id IS NULL
              AND credit_ledger.organization_id IS NULL
              AND credit_ledger.user_id = ${jobTable}.user_id)
            OR (
              ${jobTable}.organization_id IS NOT NULL
              AND credit_ledger.organization_id = ${jobTable}.organization_id
            )
          )
      ) AS credit_settlement ON TRUE`;
}

function toGenerationJobCreditSettlement(
  row: GenerationJobRow,
): GenerationJobCreditSettlement | undefined {
  if (row.charged_credits === undefined || row.refunded_credits === undefined) {
    return undefined;
  }
  return createGenerationJobCreditSettlement(
    row.status,
    Number(row.charged_credits),
    Number(row.refunded_credits),
  );
}

function toPageGenerationMode(value: string | null): PageGenerationMode | null {
  return value === 'standard' || value === 'thinking' ? value : null;
}

function toJsonObject(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
