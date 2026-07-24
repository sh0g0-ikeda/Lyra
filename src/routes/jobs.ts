import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  generationJobSchema,
  generationJobsResponseSchema,
} from '../../packages/api-contract/src/mobileApiSchemas.js';
import { ConfigurationError, ValidationError } from '../domain/errors/index.js';
import type { GenerationJob, GenerationJobStatus, GenerationJobType } from '../domain/types/job.js';
import { signImageCdnUrl } from '../infrastructure/aws/CloudFrontImageUrlSigner.js';
import { env } from '../lib/env.js';
import { createReferenceCandidateToken } from '../services/entity/ReferenceCandidateToken.js';
import type { JobServicePort } from '../services/job/JobService.js';
import type { AppEnv } from '../types/app.js';
import { assertMobileResponseContract } from './mobileResponseContract.js';
import { parseOptionalOrganizationId } from './organizationRouteHelpers.js';

const uuidParamSchema = z.string().uuid();

export interface JobRouteDependencies {
  authMiddleware: MiddlewareHandler<AppEnv>;
  rateLimitMiddleware: MiddlewareHandler<AppEnv>;
  jobService: JobServicePort;
}

export function createJobRoutes(dependencies: JobRouteDependencies): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use('*', dependencies.authMiddleware);
  app.use('*', dependencies.rateLimitMiddleware);

  app.get('/jobs', async (c) => {
    const user = c.get('user');
    if (dependencies.jobService.listJobs === undefined) {
      throw new ConfigurationError('Generation job list service is not configured');
    }
    const organizationId = parseOptionalOrganizationId(c);
    const query = parseJobListQuery(c);
    const page = await dependencies.jobService.listJobs({
      userId: user.id,
      organizationId,
      limit: query.limit,
      cursor: query.cursor,
      statuses: query.statuses,
      jobTypes: query.jobTypes,
    });

    const payload = {
      jobs: await Promise.all(page.jobs.map(toJobResponse)),
      next_cursor: page.nextCursor,
    };
    return c.json(assertMobileResponseContract(generationJobsResponseSchema, payload));
  });

  app.post('/jobs/:id/cancel', async (c) => {
    const user = c.get('user');
    if (dependencies.jobService.cancelJob === undefined) {
      throw new ConfigurationError('Generation job cancellation service is not configured');
    }
    const jobId = parseUuidParam(c, 'id');
    const organizationId = parseOptionalOrganizationId(c);
    const job = await dependencies.jobService.cancelJob(user.id, jobId, organizationId);

    const payload = await toJobResponse(job);
    return c.json(assertMobileResponseContract(generationJobSchema, payload));
  });

  app.delete('/jobs/:id', async (c) => {
    const user = c.get('user');
    if (dependencies.jobService.hideJobFromHistory === undefined) {
      throw new ConfigurationError('Generation job history service is not configured');
    }
    const jobId = parseUuidParam(c, 'id');
    const organizationId = parseOptionalOrganizationId(c);
    await dependencies.jobService.hideJobFromHistory(user.id, jobId, organizationId);

    return c.body(null, 204);
  });

  app.get('/jobs/:id', async (c) => {
    const user = c.get('user');
    const jobId = parseUuidParam(c, 'id');
    const organizationId = parseOptionalOrganizationId(c);
    const job = await dependencies.jobService.getJob(user.id, jobId, organizationId);

    const payload = await toJobResponse(job);
    return c.json(assertMobileResponseContract(generationJobSchema, payload));
  });

  return app;
}

const JOB_LIST_STATUSES: readonly GenerationJobStatus[] = [
  'queued',
  'processing',
  'completed',
  'failed',
  'canceled',
];
const JOB_LIST_TYPES: readonly GenerationJobType[] = [
  'page_generate',
  'entity_generate',
  'episode_story_autofill',
  'episode_page_skeleton',
];

function parseJobListQuery(c: Context<AppEnv>): {
  limit: number;
  cursor: string | null;
  statuses: GenerationJobStatus[];
  jobTypes: GenerationJobType[];
} {
  const rawLimit = c.req.query('limit');
  const limit = rawLimit === undefined || rawLimit.trim().length === 0
    ? 25
    : Number(rawLimit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new ValidationError('limit must be an integer between 1 and 100');
  }

  const rawCursor = c.req.query('cursor');
  if (rawCursor !== undefined && (rawCursor.trim().length === 0 || rawCursor.length > 512)) {
    throw new ValidationError('cursor must be between 1 and 512 characters');
  }

  return {
    limit,
    cursor: rawCursor ?? null,
    statuses: parseJobFilter(c.req.query('status'), JOB_LIST_STATUSES, 'status'),
    jobTypes: parseJobFilter(c.req.query('type'), JOB_LIST_TYPES, 'type'),
  };
}

function parseJobFilter<T extends string>(
  raw: string | undefined,
  allowed: readonly T[],
  name: string,
): T[] {
  if (raw === undefined || raw.trim().length === 0) {
    return [];
  }
  const values = raw.split(',').map((value) => value.trim());
  if (values.some((value) => value.length === 0) || values.some((value) => !allowed.includes(value as T))) {
    throw new ValidationError(`${name} contains an unsupported value`);
  }
  return [...new Set(values)] as T[];
}

function parseUuidParam(c: Context<AppEnv>, name: string): string {
  const result = uuidParamSchema.safeParse(c.req.param(name));
  if (!result.success) {
    throw new ValidationError(`${name} must be a valid UUID`);
  }

  return result.data;
}

async function toJobResponse(job: GenerationJob): Promise<Record<string, unknown>> {
  const progress = toJobProgress(job);
  const error = toSafeJobError(job);
  return {
    id: job.id,
    job_type: job.jobType,
    status: job.status,
    generation_mode: job.generationMode,
    credit_cost: job.creditCost,
    ...(job.creditSettlement === undefined
      ? {}
      : {
        credit_settlement: {
          charged_credits: job.creditSettlement.chargedCredits,
          refunded_credits: job.creditSettlement.refundedCredits,
          net_credits: job.creditSettlement.netCredits,
          status: job.creditSettlement.status,
        },
      }),
    params: toJobParamsResponse(job),
    result: await toJobResultResponse(job),
    // Keep this field for existing clients, but never expose the raw persisted error.
    error_message: error.message,
    error_code: error.code,
    message_key: error.messageKey,
    retryable: error.retryable,
    support_id: error.supportId,
    progress_stage: progress.stage,
    progress_percent: progress.percent,
    progress_updated_at: progress.updatedAt?.toISOString() ?? null,
    updated_at: progress.updatedAt?.toISOString() ?? job.completedAt?.toISOString() ?? job.startedAt?.toISOString() ?? job.createdAt.toISOString(),
    actions: toJobActions(job),
    retry_count: job.retryCount,
    created_at: job.createdAt.toISOString(),
    started_at: job.startedAt?.toISOString() ?? null,
    completed_at: job.completedAt?.toISOString() ?? null,
    expires_at: job.expiresAt?.toISOString() ?? null,
  };
}

type JobProgressStage =
  | 'queued'
  | 'compiling'
  | 'preparing_references'
  | 'generating'
  | 'saving'
  | 'completed';

interface JobProgressResponse {
  stage: JobProgressStage | null;
  percent: number | null;
  updatedAt: Date | null;
}

interface SafeJobErrorResponse {
  code: string | null;
  messageKey: string | null;
  retryable: boolean;
  supportId: string | null;
  message: string | null;
}

function toJobProgress(job: GenerationJob): JobProgressResponse {
  if (job.status === 'queued') {
    return { stage: 'queued', percent: 0, updatedAt: job.createdAt };
  }
  if (job.status === 'completed') {
    return { stage: 'completed', percent: 100, updatedAt: job.completedAt ?? job.createdAt };
  }
  if (job.status !== 'processing') {
    return { stage: null, percent: null, updatedAt: readResultTimestamp(job.result, 'progress_updated_at') };
  }

  const directPercent = readResultNumber(job.result, 'progress_percent');
  const currentChunk = readResultNumber(job.result, 'progress_current_chunk');
  const totalChunks = readResultNumber(job.result, 'progress_total_chunks');
  const chunkPercent =
    currentChunk === null || totalChunks === null || totalChunks <= 0
      ? null
      : Math.round((Math.min(Math.max(currentChunk, 0), totalChunks) / totalChunks) * 100);
  return {
    stage: normalizeJobProgressStage(readResultString(job.result, 'progress_stage')),
    percent: directPercent === null ? chunkPercent : Math.round(Math.min(100, Math.max(0, directPercent))),
    updatedAt: readResultTimestamp(job.result, 'progress_updated_at') ?? job.startedAt ?? job.createdAt,
  };
}

function normalizeJobProgressStage(value: string | null): JobProgressStage | null {
  switch (value) {
    case 'started':
    case 'compiling':
    case 'compiling_chunk':
      return 'compiling';
    case 'preparing_references':
    case 'reference_images':
      return 'preparing_references';
    case 'generating':
    case 'rendering':
    case 'compiled_chunk':
    case 'applying_story_plan':
      return 'generating';
    case 'saving':
    case 'applying':
    case 'rolling_back':
      return 'saving';
    default:
      return null;
  }
}

function toSafeJobError(job: GenerationJob): SafeJobErrorResponse {
  if (job.status === 'canceled') {
    return {
      code: 'JOB_CANCELLED',
      messageKey: 'job.error.cancelled',
      retryable: false,
      supportId: buildJobSupportId(job),
      message: 'The job was canceled.',
    };
  }
  if (job.status !== 'failed') {
    return { code: null, messageKey: null, retryable: false, supportId: null, message: null };
  }

  const raw = job.errorMessage?.toLowerCase() ?? '';
  if (matchesAny(raw, ['invalid', 'validation', 'missing required', 'must be', 'unsupported input'])) {
    return {
      code: 'GENERATION_INPUT_INVALID',
      messageKey: 'job.error.inputInvalid',
      retryable: false,
      supportId: buildJobSupportId(job),
      message: 'The generation input could not be processed. Review the job inputs.',
    };
  }
  if (matchesAny(raw, ['429', 'rate limit', 'timeout', 'temporar', 'unavailable', 'connection', 'provider', 'openai', 'aws', 'sqs'])) {
    return {
      code: 'GENERATION_TEMPORARILY_UNAVAILABLE',
      messageKey: 'job.error.temporarilyUnavailable',
      retryable: true,
      supportId: buildJobSupportId(job),
      message: 'Generation is temporarily unavailable. Please try again.',
    };
  }
  return {
    code: 'GENERATION_FAILED',
    messageKey: 'job.error.failed',
    retryable: true,
    supportId: buildJobSupportId(job),
    message: 'Generation failed. Please try again.',
  };
}

function buildJobSupportId(job: GenerationJob): string {
  const digest = createHash('sha256')
    .update(`${job.id}:${job.createdAt.toISOString()}`)
    .digest('hex')
    .slice(0, 16)
    .toUpperCase();
  return `J-${digest}`;
}

function matchesAny(value: string, candidates: readonly string[]): boolean {
  return candidates.some((candidate) => value.includes(candidate));
}

function toJobActions(job: GenerationJob): Record<string, unknown> {
  const terminal = job.status === 'completed' || job.status === 'failed' || job.status === 'canceled';
  const cancellationPending =
    job.status === 'processing' &&
    job.cancelRequestedAt !== null &&
    job.cancelRequestedAt !== undefined;
  return {
    cancel: {
      available: job.status === 'queued' || (job.status === 'processing' && !cancellationPending),
      reason_key:
        job.status === 'queued'
          ? null
          : cancellationPending
            ? 'job.action.cancelRequested'
          : job.status === 'processing'
            ? null
            : 'job.action.cancelOnlyActive',
    },
    hide: {
      available: terminal,
      reason_key: terminal ? null : 'job.action.hideOnlyTerminal',
    },
  };
}

function readResultString(result: Record<string, unknown> | null, key: string): string | null {
  const value = result?.[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function readResultNumber(result: Record<string, unknown> | null, key: string): number | null {
  const value = result?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readResultTimestamp(result: Record<string, unknown> | null, key: string): Date | null {
  const value = readResultString(result, key);
  if (value === null) {
    return null;
  }
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? null : timestamp;
}

function toJobParamsResponse(job: GenerationJob): Record<string, unknown> {
  if (job.jobType === 'entity_generate') {
    return pickKnownFields(job.params, ['entity_id', 'entity_type']);
  }

  if (job.jobType === 'episode_story_autofill') {
    return pickKnownFields(job.params, ['episode_id', 'language']);
  }

  if (job.jobType === 'episode_page_skeleton') {
    return pickKnownFields(job.params, [
      'episode_id',
      'overwrite_existing',
      'apply_story_plan',
      'language',
    ]);
  }

  return pickKnownFields(job.params, [
    'page_id',
    'request_kind',
    'generation_mode',
    'quality',
    'requires_planner',
  ]);
}

async function toJobResultResponse(job: GenerationJob): Promise<Record<string, unknown> | null> {
  if (job.result === null) {
    return null;
  }

  if (job.jobType === 'entity_generate') {
    return await toEntityGenerationResultResponse(job);
  }

  if (job.jobType === 'episode_story_autofill') {
    return toEpisodeStoryAutofillResultResponse(job.result);
  }

  if (job.jobType === 'episode_page_skeleton') {
    return toEpisodePageSkeletonResultResponse(job.result);
  }

  return toPageGenerationResultResponse(job.result);
}

function toEpisodeStoryAutofillResultResponse(result: Record<string, unknown>): Record<string, unknown> {
  return pickKnownFields(result, [
    'updated_page_count',
    'updated_panel_count',
    'updated_assignment_count',
    'filled_field_count',
    'compiler_used',
    'compiler_provider',
    'compiler_model',
    'compiler_prompt_version',
  ]);
}

function toEpisodePageSkeletonResultResponse(result: Record<string, unknown>): Record<string, unknown> {
  return pickKnownFields(result, [
    'pages_created',
    'panels_created',
    'replaced_existing',
    'story_plan_applied',
  ]);
}

function toPageGenerationResultResponse(result: Record<string, unknown>): Record<string, unknown> {
  const response = pickKnownFields(result, [
    'generation_mode',
    'request_kind',
  ]);

  const generatedImage = toGeneratedImageResponse(result.generated_image);
  if (generatedImage !== null) {
    response.generated_image = generatedImage;
  }

  return response;
}

async function toEntityGenerationResultResponse(job: GenerationJob): Promise<Record<string, unknown>> {
  const result = job.result ?? {};
  const response: Record<string, unknown> = {};
  response.provider_result = isProviderResult(job);

  const entityId = typeof job.params.entity_id === 'string' ? job.params.entity_id : null;
  const candidates = entityId === null
    ? []
    : await toEntityCandidateResponse(result.candidates, job.userId, entityId);
  if (candidates.length > 0) {
    response.candidates = candidates;
  }

  return response;
}

function isProviderResult(job: GenerationJob): boolean {
  if (job.openaiRequestId !== null) {
    return true;
  }

  const costUsd = job.result?.cost_usd;
  return typeof costUsd === 'number' && Number.isFinite(costUsd) && costUsd > 0;
}

function pickKnownFields(
  source: Record<string, unknown>,
  allowedFields: readonly string[],
): Record<string, unknown> {
  const response: Record<string, unknown> = {};
  for (const field of allowedFields) {
    if (Object.hasOwn(source, field)) {
      response[field] = source[field];
    }
  }

  return response;
}

function toGeneratedImageResponse(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) {
    return null;
  }

  const response = pickKnownFields(value, ['generation_mode', 'generated_at']);
  return Object.keys(response).length === 0 ? null : response;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function toEntityCandidateResponse(
  value: unknown,
  userId: string,
  entityId: string,
): Promise<Array<Record<string, unknown>>> {
  if (!Array.isArray(value)) {
    return [];
  }

  const candidates: Array<Record<string, unknown> | null> = await Promise.all(value.map(async (candidate): Promise<Record<string, unknown> | null> => {
    if (!isRecord(candidate) || typeof candidate.s3_key !== 'string') {
      return null;
    }

    const signedCdnUrl = typeof candidate.cdn_url === 'string'
      ? await signImageCdnUrl(candidate.cdn_url, candidate.s3_key)
      : null;

    return {
      candidate_token: createReferenceCandidateToken({
        userId,
        entityId,
        s3Key: candidate.s3_key,
      }, {
        secret: getReferenceCandidateTokenSecret(),
      }),
      ...(signedCdnUrl === null ? {} : { cdn_url: signedCdnUrl }),
    };
  }));

  return candidates.filter((candidate): candidate is Record<string, unknown> => candidate !== null);
}

function getReferenceCandidateTokenSecret(): string {
  return env.REFERENCE_CANDIDATE_TOKEN_SECRET
    ?? env.SUPABASE_JWT_SECRET
    ?? env.STRIPE_WEBHOOK_SECRET
    ?? 'development-reference-candidate-token-secret';
}
