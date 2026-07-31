import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { z } from 'zod';
import {
  generationJobHistoryResponseSchema,
  generationJobResponseSchema,
} from '../../packages/api-contract/src/mobileApiSchemas.js';
import { ValidationError } from '../domain/errors/index.js';
import {
  decodeGenerationJobHistoryCursor,
  encodeGenerationJobHistoryCursor,
} from '../domain/pagination.js';
import type { GenerationJob } from '../domain/types/job.js';
import { signImageCdnUrl } from '../infrastructure/aws/CloudFrontImageUrlSigner.js';
import { env } from '../lib/env.js';
import { createReferenceCandidateToken } from '../services/entity/ReferenceCandidateToken.js';
import type { JobServicePort } from '../services/job/JobService.js';
import type { AppEnv } from '../types/app.js';
import {
  parseOptionalOrganizationId,
  requireOrganizationCapability,
  type OrganizationRouteDependencies,
} from './organizationRouteHelpers.js';
import { assertMobileResponseContract } from './mobileResponseContract.js';

const uuidParamSchema = z.string().uuid();
const DEFAULT_JOB_HISTORY_LIMIT = 25;
const MAX_JOB_HISTORY_LIMIT = 100;

export interface JobRouteDependencies extends OrganizationRouteDependencies {
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
    const organizationId = parseOptionalOrganizationId(c);
    await requireOrganizationCapability(c, dependencies, organizationId, 'view_work');
    const limit = parseJobHistoryLimit(c.req.query('limit'));
    const encodedCursor = c.req.query('cursor');
    const cursor = encodedCursor === undefined
      ? null
      : decodeGenerationJobHistoryCursor(encodedCursor);
    const page = await dependencies.jobService.listJobHistory(user.id, {
      organizationId,
      limit,
      cursor,
    });

    const payload = {
      jobs: await Promise.all(page.jobs.map(toJobResponse)),
      next_cursor:
        page.nextCursor === null
          ? null
          : encodeGenerationJobHistoryCursor(page.nextCursor),
    };
    return c.json(
      assertMobileResponseContract(generationJobHistoryResponseSchema, payload),
    );
  });

  app.get('/jobs/:id', async (c) => {
    const user = c.get('user');
    const jobId = parseUuidParam(c, 'id');
    const organizationId = parseOptionalOrganizationId(c);
    await requireOrganizationCapability(c, dependencies, organizationId, 'view_work');
    const job = await dependencies.jobService.getJob(user.id, jobId, organizationId);

    const payload = await toJobResponse(job);
    return c.json(assertMobileResponseContract(generationJobResponseSchema, payload));
  });

  app.delete('/jobs/:id', async (c) => {
    const user = c.get('user');
    const jobId = parseUuidParam(c, 'id');
    const organizationId = parseOptionalOrganizationId(c);
    await requireOrganizationCapability(c, dependencies, organizationId, 'view_work');
    await dependencies.jobService.hideJobFromHistory(user.id, jobId, organizationId);
    return c.body(null, 204);
  });

  app.post('/jobs/:id/cancel', async (c) => {
    const user = c.get('user');
    const jobId = parseUuidParam(c, 'id');
    const organizationId = parseOptionalOrganizationId(c);
    await requireOrganizationCapability(c, dependencies, organizationId, 'edit_work');
    const job = await dependencies.jobService.cancelJob(user.id, jobId, organizationId);

    const payload = await toJobResponse(job);
    return c.json(assertMobileResponseContract(generationJobResponseSchema, payload));
  });

  return app;
}

function parseJobHistoryLimit(rawLimit: string | undefined): number {
  if (rawLimit === undefined) {
    return DEFAULT_JOB_HISTORY_LIMIT;
  }

  if (!/^[0-9]+$/u.test(rawLimit)) {
    throw new ValidationError('limit must be an integer from 1 to 100');
  }

  const limit = Number(rawLimit);
  if (
    !Number.isSafeInteger(limit)
    || limit < 1
    || limit > MAX_JOB_HISTORY_LIMIT
  ) {
    throw new ValidationError('limit must be an integer from 1 to 100');
  }

  return limit;
}

function parseUuidParam(c: Context<AppEnv>, name: string): string {
  const result = uuidParamSchema.safeParse(c.req.param(name));
  if (!result.success) {
    throw new ValidationError(`${name} must be a valid UUID`);
  }

  return result.data;
}

async function toJobResponse(job: GenerationJob): Promise<Record<string, unknown>> {
  return {
    id: job.id,
    job_type: job.jobType,
    status: job.status,
    generation_mode: job.generationMode,
    credit_cost: job.creditCost,
    params: toJobParamsResponse(job),
    result: await toJobResultResponse(job),
    error_message: job.errorMessage,
    retry_count: job.retryCount,
    created_at: job.createdAt.toISOString(),
    started_at: job.startedAt?.toISOString() ?? null,
    completed_at: job.completedAt?.toISOString() ?? null,
    expires_at: job.expiresAt?.toISOString() ?? null,
    cancel_requested_at: job.cancelRequestedAt?.toISOString() ?? null,
    cancelled_at: job.cancelledAt?.toISOString() ?? null,
    commit_started_at: job.commitStartedAt?.toISOString() ?? null,
  };
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
    'compiler_error',
    'progress_stage',
    'progress_message',
    'progress_current_chunk',
    'progress_total_chunks',
    'progress_started_at',
    'progress_updated_at',
  ]);
}

function toEpisodePageSkeletonResultResponse(result: Record<string, unknown>): Record<string, unknown> {
  return pickKnownFields(result, [
    'pages_created',
    'panels_created',
    'replaced_existing',
    'story_plan_applied',
    'story_plan_result',
    'progress_stage',
    'progress_message',
    'progress_current_chunk',
    'progress_total_chunks',
    'progress_started_at',
    'progress_updated_at',
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
