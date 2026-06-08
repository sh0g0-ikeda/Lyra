import type { QueryResultRow } from 'pg';
import type { GenerationJob, GenerationJobType } from '../domain/types/job.js';
import type { PageGenerationMode } from '../domain/types/pageGeneration.js';
import { ConflictError } from '../domain/errors/index.js';
import type { DatabaseClient, TransactionRunner } from '../lib/db.js';

export type { GenerationJob };

export interface CreateGenerationJobInput {
  id?: string;
  userId: string;
  jobType: GenerationJobType;
  generationMode: PageGenerationMode | null;
  creditCost: number;
  params: Record<string, unknown>;
  capacityLimits?: {
    perUser: number;
    global: number;
  };
}

export interface GenerationJobRepository {
  create(input: CreateGenerationJobInput): Promise<GenerationJob>;
  findById(jobId: string): Promise<GenerationJob | null>;
  findByIdAndUserId(jobId: string, userId: string): Promise<GenerationJob | null>;
  findActivePageGenerationJob(userId: string, pageId: string): Promise<GenerationJob | null>;
  findActiveEntityGenerationJob(userId: string, entityId: string): Promise<GenerationJob | null>;
  countActiveGenerationJobsByUser(userId: string): Promise<number>;
  countActiveGenerationJobs(): Promise<number>;
  attachQueueMessageId(jobId: string, messageId: string): Promise<boolean>;
  markFailed(jobId: string, errorMessage: string): Promise<boolean>;
  prepareRetry(jobId: string, maxRetryCount: number): Promise<boolean>;
}

interface GenerationJobRow extends QueryResultRow {
  id: string;
  user_id: string;
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
}

export class PostgresGenerationJobRepository implements GenerationJobRepository {
  private static readonly advisoryLockNamespace = 81_527;

  public constructor(private readonly client: DatabaseClient & Partial<TransactionRunner>) {}

  public async create(input: CreateGenerationJobInput): Promise<GenerationJob> {
    const capacityLimits = input.capacityLimits;
    if (capacityLimits !== undefined && isTransactionRunner(this.client)) {
      return this.client.transaction(async (transactionClient) => {
        await this.lockGenerationCapacity(transactionClient, input.userId);
        await this.assertCapacityWithinTransaction(transactionClient, input.userId, capacityLimits);
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
        job_type,
        generation_mode,
        credit_cost,
        params,
        expires_at
      )
      VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3, $4, $5, $6::jsonb, NOW() + INTERVAL '7 days')
      RETURNING *
      `,
      [
        input.id ?? null,
        input.userId,
        input.jobType,
        input.generationMode,
        input.creditCost,
        JSON.stringify(input.params),
      ],
    );

    return mapGenerationJobRow(result.rows[0]);
  }

  private async lockGenerationCapacity(client: DatabaseClient, userId: string): Promise<void> {
    await client.query(
      'SELECT pg_advisory_xact_lock($1::int, hashtext($2)::int)',
      [PostgresGenerationJobRepository.advisoryLockNamespace, 'generation_jobs:global'],
    );
    await client.query(
      'SELECT pg_advisory_xact_lock($1::int, hashtext($2)::int)',
      [PostgresGenerationJobRepository.advisoryLockNamespace, `generation_jobs:user:${userId}`],
    );
  }

  private async assertCapacityWithinTransaction(
    client: DatabaseClient,
    userId: string,
    limits: NonNullable<CreateGenerationJobInput['capacityLimits']>,
  ): Promise<void> {
    const activeForUser = await this.countActiveGenerationJobsByUserWithClient(client, userId);
    if (activeForUser >= limits.perUser) {
      throw new ConflictError('User has too many active generation jobs');
    }

    const activeGlobally = await this.countActiveGenerationJobsWithClient(client);
    if (activeGlobally >= limits.global) {
      throw new ConflictError('Generation queue is temporarily full');
    }
  }

  public async findById(jobId: string): Promise<GenerationJob | null> {
    const result = await this.client.query<GenerationJobRow>(
      `
      SELECT *
      FROM generation_jobs
      WHERE id = $1
      `,
      [jobId],
    );

    return result.rows[0] === undefined ? null : mapGenerationJobRow(result.rows[0]);
  }

  public async findByIdAndUserId(jobId: string, userId: string): Promise<GenerationJob | null> {
    const result = await this.client.query<GenerationJobRow>(
      `
      SELECT *
      FROM generation_jobs
      WHERE id = $1
        AND user_id = $2
      `,
      [jobId, userId],
    );

    return result.rows[0] === undefined ? null : mapGenerationJobRow(result.rows[0]);
  }

  public async findActivePageGenerationJob(
    userId: string,
    pageId: string,
  ): Promise<GenerationJob | null> {
    return this.findActiveResourceJob(userId, 'page_generate', 'page_id', pageId);
  }

  public async findActiveEntityGenerationJob(
    userId: string,
    entityId: string,
  ): Promise<GenerationJob | null> {
    return this.findActiveResourceJob(userId, 'entity_generate', 'entity_id', entityId);
  }

  public async countActiveGenerationJobsByUser(userId: string): Promise<number> {
    return this.countActiveGenerationJobsByUserWithClient(this.client, userId);
  }

  private async countActiveGenerationJobsByUserWithClient(
    client: DatabaseClient,
    userId: string,
  ): Promise<number> {
    const result = await client.query<{ count: string }>(
      `
      SELECT COUNT(*)::text AS count
      FROM generation_jobs
      WHERE user_id = $1
        AND job_type IN ('page_generate', 'entity_generate')
        AND status IN ('queued', 'processing')
      `,
      [userId],
    );

    return Number(result.rows[0]?.count ?? '0');
  }

  public async countActiveGenerationJobs(): Promise<number> {
    return this.countActiveGenerationJobsWithClient(this.client);
  }

  private async countActiveGenerationJobsWithClient(client: DatabaseClient): Promise<number> {
    const result = await client.query<{ count: string }>(
      `
      SELECT COUNT(*)::text AS count
      FROM generation_jobs
      WHERE job_type IN ('page_generate', 'entity_generate')
        AND status IN ('queued', 'processing')
      `,
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

  public async markFailed(jobId: string, errorMessage: string): Promise<boolean> {
    const result = await this.client.query<GenerationJobRow>(
      `
      UPDATE generation_jobs
      SET status = 'failed',
          error_message = $2,
          completed_at = NOW()
      WHERE id = $1
      RETURNING *
      `,
      [jobId, errorMessage],
    );

    return (result.rowCount ?? 0) > 0;
  }

  public async prepareRetry(jobId: string, maxRetryCount: number): Promise<boolean> {
    const result = await this.client.query<GenerationJobRow>(
      `
      UPDATE generation_jobs
      SET status = 'queued',
          retry_count = retry_count + 1,
          started_at = NULL,
          completed_at = NULL,
          error_message = NULL,
          openai_request_id = NULL,
          sqs_message_id = NULL
      WHERE id = $1
        AND status = 'failed'
        AND retry_count < $2
      RETURNING *
      `,
      [jobId, maxRetryCount],
    );

    return (result.rowCount ?? 0) > 0;
  }

  private async findActiveResourceJob(
    userId: string,
    jobType: GenerationJobType,
    resourceParamKey: 'page_id' | 'entity_id',
    resourceId: string,
  ): Promise<GenerationJob | null> {
    const result = await this.client.query<GenerationJobRow>(
      `
      SELECT *
      FROM generation_jobs
      WHERE user_id = $1
        AND job_type = $2
        AND status IN ('queued', 'processing')
        AND params->>$3 = $4
      ORDER BY created_at DESC
      LIMIT 1
      `,
      [userId, jobType, resourceParamKey, resourceId],
    );

    return result.rows[0] === undefined ? null : mapGenerationJobRow(result.rows[0]);
  }
}

function isTransactionRunner(client: DatabaseClient & Partial<TransactionRunner>): client is DatabaseClient & TransactionRunner {
  return typeof client.transaction === 'function';
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
