import type { QueryResultRow } from 'pg';
import type { EpisodePagePlanApplyResult } from '../domain/types/page.js';
import type { EpisodeUnresolvedStateTransition } from '../domain/types/episodeStateTransition.js';
import type { GenerationJob } from '../domain/types/job.js';
import type { DatabaseClient, TransactionRunner } from '../lib/db.js';
import { sanitizePersistedErrorMessage } from '../lib/errorSanitizer.js';
import {
  enqueueTerminalGenerationJobNotificationAfterRegistryLock,
  lockMobilePushTokenRegistryForTerminalSettlement,
} from './PushNotificationOutboxRepository.js';

export interface CompleteEpisodeStoryAutofillInput {
  jobId: string;
  userId: string;
  result: EpisodePagePlanApplyResult;
}

export interface UpdateEpisodeStoryAutofillProgressInput {
  jobId: string;
  userId: string;
  stage: string;
  message: string;
  currentChunk?: number | null;
  totalChunks?: number | null;
}

export interface EpisodeStoryAutofillExecutionRepository {
  claimQueuedEpisodeStoryAutofillJob(jobId: string): Promise<GenerationJob | null>;
  updateEpisodeStoryAutofillProgress(input: UpdateEpisodeStoryAutofillProgressInput): Promise<boolean>;
  isEpisodeStoryAutofillCancellationRequested(jobId: string, userId: string): Promise<boolean>;
  beginEpisodeStoryAutofillCommit(jobId: string, userId: string): Promise<boolean>;
  cancelEpisodeStoryAutofill(jobId: string, userId: string): Promise<boolean>;
  completeEpisodeStoryAutofill(input: CompleteEpisodeStoryAutofillInput): Promise<boolean>;
  failEpisodeStoryAutofill(input: {
    jobId: string;
    userId: string;
    errorMessage: string;
    stateBlocker?: EpisodeStoryAutofillStateBlocker;
  }): Promise<boolean>;
}

export interface EpisodeStoryAutofillStateBlocker {
  code: EpisodeStatePlanErrorCode;
  candidates: EpisodeUnresolvedStateTransition[];
}

type EpisodeStatePlanErrorCode =
  | 'STATE_PLAN_INVALID'
  | 'STATE_ASSIGNMENT_CONFLICT'
  | 'STATE_REFERENCE_REQUIRED'
  | 'STATE_MAPPING_AMBIGUOUS'
  | 'LIMIT_EXCEEDED';

interface GenerationJobRow extends QueryResultRow {
  id: string;
  user_id: string;
  organization_id: string | null;
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
  cancel_requested_at: Date | null;
  cancel_requested_by: string | null;
  cancelled_at: Date | null;
  commit_started_at: Date | null;
}

export class PostgresEpisodeStoryAutofillExecutionRepository
  implements EpisodeStoryAutofillExecutionRepository
{
  public constructor(private readonly client: DatabaseClient & TransactionRunner) {}

  public async claimQueuedEpisodeStoryAutofillJob(jobId: string): Promise<GenerationJob | null> {
    const result = await this.client.query<GenerationJobRow>(
      `
      UPDATE generation_jobs
      SET status = 'processing',
          started_at = COALESCE(started_at, NOW()),
          error_message = NULL
      WHERE id = $1
        AND job_type = 'episode_story_autofill'
        AND status = 'queued'
        AND cancel_requested_at IS NULL
      RETURNING *
      `,
      [jobId],
    );

    return result.rows[0] === undefined ? null : mapGenerationJobRow(result.rows[0]);
  }

  public async updateEpisodeStoryAutofillProgress(
    input: UpdateEpisodeStoryAutofillProgressInput,
  ): Promise<boolean> {
    const updatedAt = new Date().toISOString();
    const progress: Record<string, unknown> = {
      progress_stage: input.stage,
      progress_message: input.message,
      progress_updated_at: updatedAt,
    };
    if (input.currentChunk !== undefined) {
      progress.progress_current_chunk = input.currentChunk;
    }
    if (input.totalChunks !== undefined) {
      progress.progress_total_chunks = input.totalChunks;
    }
    if (input.stage === 'started') {
      progress.progress_started_at = updatedAt;
    }

    const result = await this.client.query<GenerationJobRow>(
      `
      UPDATE generation_jobs
      SET result = COALESCE(result, '{}'::jsonb) || $3::jsonb
      WHERE id = $1
        AND user_id = $2
        AND job_type = 'episode_story_autofill'
        AND status = 'processing'
        AND cancel_requested_at IS NULL
      RETURNING *
      `,
      [input.jobId, input.userId, JSON.stringify(progress)],
    );

    return (result.rowCount ?? 0) > 0;
  }

  public async isEpisodeStoryAutofillCancellationRequested(
    jobId: string,
    userId: string,
  ): Promise<boolean> {
    const result = await this.client.query<{ cancellation_requested: boolean }>(
      `
      SELECT cancel_requested_at IS NOT NULL AS cancellation_requested
      FROM generation_jobs
      WHERE id = $1
        AND user_id = $2
        AND job_type = 'episode_story_autofill'
        AND status = 'processing'
      `,
      [jobId, userId],
    );

    return result.rows[0]?.cancellation_requested === true;
  }

  public async beginEpisodeStoryAutofillCommit(jobId: string, userId: string): Promise<boolean> {
    const result = await this.client.query<GenerationJobRow>(
      `
      UPDATE generation_jobs
      SET commit_started_at = NOW()
      WHERE id = $1
        AND user_id = $2
        AND job_type = 'episode_story_autofill'
        AND status = 'processing'
        AND cancel_requested_at IS NULL
        AND commit_started_at IS NULL
      RETURNING *
      `,
      [jobId, userId],
    );

    return (result.rowCount ?? 0) > 0;
  }

  public async cancelEpisodeStoryAutofill(jobId: string, userId: string): Promise<boolean> {
    const result = await this.client.query<GenerationJobRow>(
      `
      UPDATE generation_jobs
      SET status = 'cancelled',
          cancelled_at = COALESCE(cancelled_at, NOW()),
          completed_at = COALESCE(completed_at, NOW()),
          result = COALESCE(result, '{}'::jsonb) || jsonb_build_object(
            'progress_stage', 'cancelled',
            'progress_message', 'Story plan autofill was stopped.',
            'progress_updated_at', NOW()
          )
      WHERE id = $1
        AND user_id = $2
        AND job_type = 'episode_story_autofill'
        AND status IN ('processing', 'cancelled')
        AND cancel_requested_at IS NOT NULL
        AND commit_started_at IS NULL
      RETURNING *
      `,
      [jobId, userId],
    );

    return (result.rowCount ?? 0) > 0;
  }

  public async completeEpisodeStoryAutofill(
    input: CompleteEpisodeStoryAutofillInput,
  ): Promise<boolean> {
    return this.client.transaction(async (transactionClient) => {
      await lockMobilePushTokenRegistryForTerminalSettlement(transactionClient);
      const result = await transactionClient.query<GenerationJobRow>(
        `
        UPDATE generation_jobs
        SET status = 'completed',
            result = $3::jsonb,
            completed_at = NOW()
        WHERE id = $1
          AND user_id = $2
          AND status = 'processing'
          AND cancel_requested_at IS NULL
          AND cancelled_at IS NULL
          AND commit_started_at IS NOT NULL
        RETURNING *
        `,
        [
          input.jobId,
          input.userId,
          JSON.stringify({
            updated_page_count: input.result.updatedPageCount,
            updated_panel_count: input.result.updatedPanelCount,
            updated_assignment_count: input.result.updatedAssignmentCount,
            filled_field_count: input.result.filledFieldCount,
            compiler_used: input.result.compilerUsed,
            compiler_provider: input.result.compilerProvider,
            compiler_model: input.result.compilerModel,
            compiler_prompt_version: input.result.compilerPromptVersion,
            compiler_error: input.result.compilerError,
            progress_stage: 'completed',
            progress_message: 'Story plan applied to pages and panels.',
            progress_updated_at: new Date().toISOString(),
            ...toPersistedStatePlanResult(input.result),
          }),
        ],
      );
      const completedJob = result.rows[0];
      if (completedJob === undefined) {
        return false;
      }

      await enqueueTerminalGenerationJobNotificationAfterRegistryLock(
        transactionClient,
        completedJob,
        'completed',
      );
      return true;
    });
  }

  public async failEpisodeStoryAutofill(input: {
    jobId: string;
    userId: string;
    errorMessage: string;
    stateBlocker?: EpisodeStoryAutofillStateBlocker;
  }): Promise<boolean> {
    const persistedErrorMessage = sanitizePersistedErrorMessage(
      input.errorMessage,
      'Episode story autofill failed',
    );
    return this.client.transaction(async (transactionClient) => {
      await lockMobilePushTokenRegistryForTerminalSettlement(transactionClient);
      const result = await transactionClient.query<GenerationJobRow>(
        `
        UPDATE generation_jobs
        SET status = 'failed',
            error_message = $3,
            result = COALESCE(result, '{}'::jsonb) || $4::jsonb,
            completed_at = NOW()
        WHERE id = $1
          AND user_id = $2
          AND status IN ('queued', 'processing')
          AND cancel_requested_at IS NULL
          AND cancelled_at IS NULL
        RETURNING *
        `,
        [
          input.jobId,
          input.userId,
          persistedErrorMessage,
          JSON.stringify({
            progress_stage: 'failed',
            progress_message: 'Story plan autofill failed.',
            progress_updated_at: new Date().toISOString(),
            ...toPersistedStateBlocker(input.stateBlocker),
          }),
        ],
      );
      const failedJob = result.rows[0];
      if (failedJob === undefined) {
        return false;
      }

      await enqueueTerminalGenerationJobNotificationAfterRegistryLock(
        transactionClient,
        failedJob,
        'failed',
      );
      return true;
    });
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const STATE_SOURCE_FIELDS = new Set([
  'story_full_draft', 'introduction', 'middle', 'climax', 'ending_hook',
  'scene_location', 'scene_time', 'scene_atmosphere',
]);
const STATE_BLOCKER_CODES = new Set<EpisodeStatePlanErrorCode>([
  'STATE_PLAN_INVALID', 'STATE_ASSIGNMENT_CONFLICT', 'STATE_REFERENCE_REQUIRED',
  'STATE_MAPPING_AMBIGUOUS', 'LIMIT_EXCEEDED',
]);
const STATE_BLOCKER_REASONS = new Set(['missing_reference', 'ambiguous_mapping']);

function toPersistedStatePlanResult(result: EpisodePagePlanApplyResult): Record<string, unknown> {
  if (
    result.statePlanVersion !== 'episode_state_plan_v1'
    || (result.stateAssignmentPolicy !== 'preserve_existing'
      && result.stateAssignmentPolicy !== 'overwrite_existing')
  ) {
    return {};
  }
  const stateTransitions = (result.stateTransitions ?? [])
    .slice(0, 512)
    .flatMap((transition) => {
      if (
        !isUuid(transition.entityId)
        || !isUuid(transition.startsAtPanelId)
        || (transition.stateId !== null && !isUuid(transition.stateId))
        || (transition.sourceSceneId !== null && !isUuid(transition.sourceSceneId))
        || !STATE_SOURCE_FIELDS.has(transition.sourceField)
        || !isBoundedString(transition.sourceQuote, 300)
      ) {
        return [];
      }
      return [{
        entity_id: transition.entityId,
        state_id: transition.stateId,
        starts_at_panel_id: transition.startsAtPanelId,
        source_scene_id: transition.sourceSceneId,
        source_field: transition.sourceField,
        source_quote: transition.sourceQuote,
      }];
    });
  return {
    state_plan_version: 'episode_state_plan_v1',
    state_assignment_policy: result.stateAssignmentPolicy,
    state_transitions: stateTransitions,
  };
}

function toPersistedStateBlocker(
  stateBlocker: EpisodeStoryAutofillStateBlocker | undefined,
): Record<string, unknown> {
  if (stateBlocker === undefined || !STATE_BLOCKER_CODES.has(stateBlocker.code)) {
    return {};
  }
  const candidates = stateBlocker.candidates.slice(0, 20).flatMap((candidate) => {
    if (
      !isUuid(candidate.entityId)
      || !isUuid(candidate.startsAtPanelId)
      || (candidate.candidateStateId !== null && !isUuid(candidate.candidateStateId))
      || (candidate.sourceSceneId !== null && !isUuid(candidate.sourceSceneId))
      || !STATE_SOURCE_FIELDS.has(candidate.sourceField)
      || !STATE_BLOCKER_REASONS.has(candidate.reason)
      || !isBoundedString(candidate.suggestedName, 100)
      || !isBoundedString(candidate.suggestedDescription, 500)
      || !isBoundedString(candidate.sourceQuote, 300)
    ) {
      return [];
    }
    return [{
      entity_id: candidate.entityId,
      candidate_state_id: candidate.candidateStateId,
      starts_at_panel_id: candidate.startsAtPanelId,
      suggested_name: candidate.suggestedName,
      suggested_description: candidate.suggestedDescription,
      source_scene_id: candidate.sourceSceneId,
      source_field: candidate.sourceField,
      source_quote: candidate.sourceQuote,
      reason: candidate.reason,
    }];
  });
  return { state_blocker: { code: stateBlocker.code, candidates } };
}

function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

function isBoundedString(value: string, maxLength: number): boolean {
  return value.trim().length > 0 && value.length <= maxLength;
}

function mapGenerationJobRow(row: GenerationJobRow): GenerationJob {
  return {
    id: row.id,
    userId: row.user_id,
    organizationId: row.organization_id,
    jobType: row.job_type,
    status: row.status,
    generationMode: row.generation_mode === 'standard' || row.generation_mode === 'thinking'
      ? row.generation_mode
      : null,
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

function toJsonObject(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
