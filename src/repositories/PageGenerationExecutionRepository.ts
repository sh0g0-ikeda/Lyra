import type { QueryResultRow } from 'pg';
import type { PageStatus } from '../domain/types/page.js';
import type { GenerationJob } from '../domain/types/job.js';
import type { PageGenerationInputSnapshot, PageGenerationMode } from '../domain/types/pageGeneration.js';
import type { DatabaseClient, TransactionRunner } from '../lib/db.js';
import { sanitizePersistedErrorMessage } from '../lib/errorSanitizer.js';
import { buildPersistedPromptDiagnostics } from '../lib/promptDiagnostics.js';
import type {
  PageGenerationStageTimingsMs,
  PagePromptCompilationMetadata,
} from '../services/page/PageGenerationWorkerService.js';

export interface CompletePageGenerationInput {
  jobId: string;
  userId: string;
  pageId: string;
  generationMode: PageGenerationMode;
  requestKind: 'initial' | 'regenerate';
  s3Key: string;
  cdnUrl: string;
  generatedAt: string;
  costUsd: number | null;
  openaiRequestId: string | null;
  promptMetadata: PagePromptCompilationMetadata;
  stageTimingsMs?: PageGenerationStageTimingsMs;
}

export interface FailPageGenerationInput {
  jobId: string;
  userId: string;
  errorMessage: string;
  pageId?: string;
  previousStatus?: PageStatus;
  previousGenerationMode?: PageGenerationMode | null;
}

export interface TouchPageGenerationProgressInput {
  jobId: string;
  userId: string;
  message: string;
  updatedAt: string;
}

export interface SavePageGenerationInputSnapshotInput {
  jobId: string;
  userId: string;
  snapshot: PageGenerationInputSnapshot;
  savedAt: string;
}

export interface PageGenerationExecutionRepository {
  claimQueuedPageGenerationJob(jobId: string): Promise<GenerationJob | null>;
  findPageGenerationJob(jobId: string): Promise<GenerationJob | null>;
  touchPageGenerationProgress(input: TouchPageGenerationProgressInput): Promise<boolean>;
  savePageGenerationInputSnapshot(input: SavePageGenerationInputSnapshotInput): Promise<boolean>;
  completePageGeneration(input: CompletePageGenerationInput): Promise<boolean>;
  failPageGeneration(input: FailPageGenerationInput): Promise<boolean>;
}

interface GenerationJobRow extends QueryResultRow {
  id: string;
  user_id: string;
  job_type: GenerationJob['jobType'];
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

interface PageUpdateRow extends QueryResultRow {
  id: string;
}

export class PostgresPageGenerationExecutionRepository implements PageGenerationExecutionRepository {
  public constructor(private readonly client: DatabaseClient & TransactionRunner) {}

  public async claimQueuedPageGenerationJob(jobId: string): Promise<GenerationJob | null> {
    const result = await this.client.query<GenerationJobRow>(
      `
      UPDATE generation_jobs
      SET status = 'processing',
          started_at = COALESCE(started_at, NOW()),
          error_message = NULL
      WHERE id = $1
        AND job_type = 'page_generate'
        AND status = 'queued'
      RETURNING *
      `,
      [jobId],
    );

    return result.rows[0] === undefined ? null : mapGenerationJobRow(result.rows[0]);
  }

  public async findPageGenerationJob(jobId: string): Promise<GenerationJob | null> {
    const result = await this.client.query<GenerationJobRow>(
      `
      SELECT *
      FROM generation_jobs
      WHERE id = $1
        AND job_type = 'page_generate'
      `,
      [jobId],
    );

    return result.rows[0] === undefined ? null : mapGenerationJobRow(result.rows[0]);
  }

  public async touchPageGenerationProgress(input: TouchPageGenerationProgressInput): Promise<boolean> {
    const result = await this.client.query<GenerationJobRow>(
      `
      UPDATE generation_jobs
      SET result = COALESCE(result, '{}'::jsonb) || jsonb_build_object(
            'progress_message', $3::text,
            'progress_updated_at', $4::text
          )
      WHERE id = $1
        AND user_id = $2
        AND job_type = 'page_generate'
        AND status = 'processing'
      RETURNING *
      `,
      [input.jobId, input.userId, input.message, input.updatedAt],
    );

    return (result.rowCount ?? 0) > 0;
  }

  public async savePageGenerationInputSnapshot(input: SavePageGenerationInputSnapshotInput): Promise<boolean> {
    const result = await this.client.query<GenerationJobRow>(
      `
      UPDATE generation_jobs
      SET result = COALESCE(result, '{}'::jsonb) || jsonb_build_object(
            'input_snapshot', $3::jsonb,
            'input_snapshot_saved_at', $4::text
          )
      WHERE id = $1
        AND user_id = $2
        AND job_type = 'page_generate'
        AND status = 'processing'
      RETURNING *
      `,
      [input.jobId, input.userId, JSON.stringify(input.snapshot), input.savedAt],
    );

    return (result.rowCount ?? 0) > 0;
  }

  public async completePageGeneration(input: CompletePageGenerationInput): Promise<boolean> {
    return this.client.transaction(async (transactionClient) => {
      const pageUpdate = await transactionClient.query<PageUpdateRow>(
        `
        UPDATE pages
        SET generated_image = jsonb_build_object(
              's3_key', $3::text,
              'cdn_url', $4::text,
              'generation_mode', $5::text,
              'generated_at', $6::text
            ),
            generation_mode = $5::text,
            status = 'generated',
            updated_at = NOW()
        FROM episodes
        INNER JOIN chapters ON chapters.id = episodes.chapter_id
        INNER JOIN works ON works.id = chapters.work_id
        WHERE pages.id = $1
          AND pages.episode_id = episodes.id
          AND works.user_id = $2
        RETURNING pages.id
        `,
        [
          input.pageId,
          input.userId,
          input.s3Key,
          input.cdnUrl,
          input.generationMode,
          input.generatedAt,
        ],
      );

      if ((pageUpdate.rowCount ?? 0) === 0) {
        return false;
      }

      const jobUpdate = await transactionClient.query<GenerationJobRow>(
        `
        UPDATE generation_jobs
        SET status = 'completed',
            result = COALESCE(result, '{}'::jsonb) || $3::jsonb,
            openai_request_id = $4::text,
            completed_at = NOW()
        WHERE id = $1
          AND user_id = $2
          AND status = 'processing'
        RETURNING *
        `,
        [
          input.jobId,
          input.userId,
          JSON.stringify({
            s3_key: input.s3Key,
            cdn_url: input.cdnUrl,
            generation_mode: input.generationMode,
            request_kind: input.requestKind,
            cost_usd: input.costUsd,
            ...buildPromptMetadataDiagnostics(input.promptMetadata),
            compiled_prompt_used: input.promptMetadata.compiledPromptUsed,
            prompt_compiler_provider: input.promptMetadata.promptCompilerProvider,
            compiler_model: input.promptMetadata.compilerModel,
            compiler_prompt_version: input.promptMetadata.compilerPromptVersion,
            compiler_error: input.promptMetadata.compilerError,
            stage_timings_ms: input.stageTimingsMs ?? null,
          }),
          input.openaiRequestId,
        ],
      );

      if ((jobUpdate.rowCount ?? 0) === 0) {
        throw new Error('Failed to update generation job completion state');
      }

      return true;
    });
  }

  public async failPageGeneration(input: FailPageGenerationInput): Promise<boolean> {
    const persistedErrorMessage = sanitizePersistedErrorMessage(input.errorMessage, 'Page generation failed');
    return this.client.transaction(async (transactionClient) => {
      const jobUpdate = await transactionClient.query<GenerationJobRow>(
        `
        UPDATE generation_jobs
        SET status = 'failed',
            error_message = $3,
            completed_at = NOW()
        WHERE id = $1
          AND user_id = $2
          AND status IN ('queued', 'processing')
        RETURNING *
        `,
        [input.jobId, input.userId, persistedErrorMessage],
      );

      if ((jobUpdate.rowCount ?? 0) === 0) {
        return false;
      }

      if (
        input.pageId !== undefined &&
        input.previousStatus !== undefined &&
        input.previousGenerationMode !== undefined
      ) {
        await transactionClient.query<PageUpdateRow>(
          `
          UPDATE pages
          SET status = $3::text,
              generation_mode = $4::text,
              updated_at = NOW()
          FROM episodes
          INNER JOIN chapters ON chapters.id = episodes.chapter_id
          INNER JOIN works ON works.id = chapters.work_id
          WHERE pages.id = $1
            AND pages.episode_id = episodes.id
            AND works.user_id = $2
          RETURNING pages.id
          `,
          [input.pageId, input.userId, input.previousStatus, input.previousGenerationMode],
        );
      }

      return true;
    });
  }
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

function buildPromptMetadataDiagnostics(
  metadata: PagePromptCompilationMetadata,
): Record<string, string | number> {
  const draftPrompt = buildPersistedPromptDiagnostics(metadata.draftPrompt);
  const compiledBrief = buildPersistedPromptDiagnostics(metadata.compilerBrief);
  const compiledPrompt = buildPersistedPromptDiagnostics(metadata.compiledPrompt);

  return {
    draft_prompt_sha256: draftPrompt.sha256,
    draft_prompt_bytes: draftPrompt.bytes,
    compiled_brief_sha256: compiledBrief.sha256,
    compiled_brief_bytes: compiledBrief.bytes,
    compiled_prompt_sha256: compiledPrompt.sha256,
    compiled_prompt_bytes: compiledPrompt.bytes,
  };
}
