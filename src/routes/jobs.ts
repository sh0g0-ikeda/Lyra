import { requireWebImageDeliveryAccess } from './webImageDelivery.js';
import { imageMobileAccess, publicImageProvenance, readImageProvenance, readGenerationImageProvenance, type ImageDeliveryAudience } from '../domain/generation/ImageAccessPolicy.js';
import { toJobPresentation } from '../services/job/JobPresentation.js';
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { z } from 'zod';
import {
  generationJobHistoryResponseSchema,
  generationJobResponseSchema,
} from '../../packages/api-contract/src/mobileApiSchemas.js';
import { NotFoundError, ValidationError } from '../domain/errors/index.js';
import {
  decodeGenerationJobHistoryCursor,
  encodeGenerationJobHistoryCursor,
} from '../domain/pagination.js';
import type { GenerationJob, GenerationJobStatus, GenerationJobType } from '../domain/types/job.js';
import { signImageCdnUrl } from '../infrastructure/aws/CloudFrontImageUrlSigner.js';
import { env } from '../lib/env.js';
import {
  createDraftReferenceCandidateToken,
  createReferenceCandidateToken,
  createStateReferenceCandidateToken,
} from '../services/entity/ReferenceCandidateToken.js';
import type { JobServicePort } from '../services/job/JobService.js';
import type { AppEnv } from '../types/app.js';
import {
  parseOptionalOrganizationId,
  requireOrganizationCapability,
  type OrganizationRouteDependencies,
} from './organizationRouteHelpers.js';
import { assertMobileResponseContract } from './mobileResponseContract.js';

const uuidParamSchema = z.string().uuid();
const entityTypeSchema = z.enum(['character', 'nonhuman', 'object']);
const DEFAULT_JOB_HISTORY_LIMIT = 25;
const MAX_JOB_HISTORY_LIMIT = 100;
const LEGACY_JOB_TYPES = ['page_generate', 'entity_generate', 'episode_story_autofill', 'episode_page_skeleton'] as const;
const V2_JOB_TYPES = [...LEGACY_JOB_TYPES, 'entity_import_analysis'] as const;
// Negotiate before querying so pagination contains only types the client can parse.
// The version changes representation only; ownership and image delivery remain independent.
type JobContractVersion = 'v1' | 'v2';
const episodeStateSourceFieldSchema = z.enum([
  'story_full_draft', 'introduction', 'middle', 'climax', 'ending_hook',
  'scene_location', 'scene_time', 'scene_atmosphere',
]);
const episodeStateTransitionResponseSchema = z.object({
  entity_id: z.string().uuid(),
  state_id: z.string().uuid().nullable(),
  starts_at_panel_id: z.string().uuid(),
  source_scene_id: z.string().uuid().nullable(),
  source_field: episodeStateSourceFieldSchema,
  source_quote: z.string().trim().min(1).max(300),
}).strict();
const episodeStateBlockerResponseSchema = z.object({
  code: z.enum([
    'STATE_PLAN_INVALID', 'STATE_ASSIGNMENT_CONFLICT', 'STATE_REFERENCE_REQUIRED',
    'STATE_MAPPING_AMBIGUOUS', 'LIMIT_EXCEEDED',
  ]),
  candidates: z.array(z.object({
    entity_id: z.string().uuid(),
    candidate_state_id: z.string().uuid().nullable(),
    starts_at_panel_id: z.string().uuid(),
    suggested_name: z.string().trim().min(1).max(100),
    suggested_description: z.string().trim().min(1).max(500),
    source_scene_id: z.string().uuid().nullable(),
    source_field: episodeStateSourceFieldSchema,
    source_quote: z.string().trim().min(1).max(300),
    reason: z.enum(['missing_reference', 'ambiguous_mapping']),
  }).strict()).max(20),
}).strict();
const episodeStatePlanResultResponseSchema = z.object({
  state_plan_version: z.literal('episode_state_plan_v1'),
  state_assignment_policy: z.enum(['preserve_existing', 'overwrite_existing']),
  state_transitions: z.array(episodeStateTransitionResponseSchema).max(512),
}).strict();
const episodeStoryAutofillV1ParamsSchema = z.object({
  state_autofill_version: z.literal('v1'),
  state_assignment_policy: z.enum(['preserve_existing', 'overwrite_existing']),
}).strict();

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
    const version = parseJobContractVersion(c);
    const allowedJobTypes = version === 'v2' ? V2_JOB_TYPES : LEGACY_JOB_TYPES;
    const requestedJobTypes = parseJobFilter(c.req.query('type'), allowedJobTypes, 'type') as GenerationJobType[];
    const limit = parseJobHistoryLimit(c.req.query('limit'));
    const encodedCursor = c.req.query('cursor');
    const cursor = encodedCursor === undefined
      ? null
      : decodeGenerationJobHistoryCursor(encodedCursor);
    const page = await dependencies.jobService.listJobHistory(user.id, {
      organizationId,
      limit,
      cursor,
      ...(c.req.query('status') === undefined ? {} : { statuses: parseJobFilter(c.req.query('status'), ['queued', 'processing', 'completed', 'failed', 'canceled', 'cancelled'], 'status').map((status) => status === 'canceled' ? 'cancelled' : status) as GenerationJobStatus[] }),
      jobTypes: requestedJobTypes.length > 0 ? requestedJobTypes : allowedJobTypes,
    });

    const canEdit = await canEditJobs(c, dependencies, organizationId);
    const payload = {
      jobs: await Promise.all(page.jobs.map((job) => toJobResponse(job, 'mobile', canEdit))),
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
    const version = parseJobContractVersion(c);
    const job = await dependencies.jobService.getJob(user.id, jobId, organizationId);
    requireSupportedJobType(job, version);

    const payload = await toJobResponse(job, 'mobile', await canEditJobs(c, dependencies, organizationId));
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
    const version = parseJobContractVersion(c);
    if (version === 'v1') {
      requireSupportedJobType(await dependencies.jobService.getJob(user.id, jobId, organizationId), version);
    }
    const job = await dependencies.jobService.cancelJob(user.id, jobId, organizationId);

    const payload = await toJobResponse(job);
    return c.json(assertMobileResponseContract(generationJobResponseSchema, payload));
  });


  app.get('/web/jobs/:id', async (c) => {
    requireWebImageDeliveryAccess(c);
    const user = c.get('user');
    const jobId = parseUuidParam(c, 'id');
    const organizationId = parseOptionalOrganizationId(c);
    await requireOrganizationCapability(c, dependencies, organizationId, 'view_work');
    const version = parseJobContractVersion(c);
    const job = await dependencies.jobService.getJob(user.id, jobId, organizationId);
    requireSupportedJobType(job, version);

    const payload = await toJobResponse(job, 'authorized_web', await canEditJobs(c, dependencies, organizationId));
    return c.json(assertMobileResponseContract(generationJobResponseSchema, payload));
  });

  return app;
}

function parseJobContractVersion(c: Context<AppEnv>): JobContractVersion {
  const raw = c.req.query('job_contract');
  if (raw === undefined || raw === 'v1') return 'v1';
  if (raw === 'v2') return 'v2';
  throw new ValidationError('job_contract must be v1 or v2');
}

function requireSupportedJobType(job: GenerationJob, version: JobContractVersion): void {
  if (version === 'v1' && job.jobType === 'entity_import_analysis') throw new NotFoundError('Job not found');
}

async function canEditJobs(c: Context<AppEnv>, dependencies: JobRouteDependencies, organizationId: string | null): Promise<boolean> {
  if (organizationId === null) return true;
  if (!env.GENERATION_JOB_CANCELLATION_ENABLED && !env.EPISODE_STORY_AUTOFILL_CANCELLATION_ENABLED) return false;
  try { await dependencies.organizationService?.requireMembership(organizationId, c.get('user').id, 'edit_work'); return dependencies.organizationService !== undefined; }
  catch { return false; }
}

function parseJobFilter(raw: string | undefined, allowed: readonly string[], name: string): string[] {
  if (raw === undefined || raw.trim() === '') return [];
  if (raw.length > 256) throw new ValidationError(`${name} filter is too long`);
  const values = raw.split(',').map((value) => value.trim());
  if (values.some((value) => value === '' || !allowed.includes(value))) throw new ValidationError(`${name} contains an unsupported value`);
  return [...new Set(values)];
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

async function toJobResponse(job: GenerationJob, audience: ImageDeliveryAudience = 'mobile', canEdit = true): Promise<Record<string, unknown>> {
  return {
    id: job.id,
    job_type: job.jobType,
    status: job.status,
    generation_mode: job.generationMode,
    credit_cost: job.creditCost,
    params: toJobParamsResponse(job),
    result: await toJobResultResponse(job, audience),
    ...toJobPresentation(job, canEdit && (job.jobType === 'episode_story_autofill' ? env.EPISODE_STORY_AUTOFILL_CANCELLATION_ENABLED : env.GENERATION_JOB_CANCELLATION_ENABLED)),
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
  if (job.jobType === 'entity_import_analysis') {
    return pickKnownFields(job.params, ['entity_id', 'entity_type']);
  }
  if (job.jobType === 'entity_generate') {
    const legacy = pickKnownFields(job.params, ['entity_id', 'entity_type']);
    return job.params.target === 'entity_state'
      ? { ...legacy, target: 'entity_state', ...pickKnownFields(job.params, ['entity_state_id', 'state_revision']) }
      : legacy;
  }

  if (job.jobType === 'episode_story_autofill') {
    const legacyParams = pickKnownFields(job.params, ['episode_id', 'language']);
    const v1Params = episodeStoryAutofillV1ParamsSchema.safeParse({
      state_autofill_version: job.params.state_autofill_version,
      state_assignment_policy: job.params.state_assignment_policy,
    });
    return v1Params.success ? { ...legacyParams, ...v1Params.data } : legacyParams;
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

async function toJobResultResponse(job: GenerationJob, audience: ImageDeliveryAudience = 'mobile'): Promise<Record<string, unknown> | null> {
  if (job.result === null) {
    return null;
  }
  if (job.jobType === 'entity_import_analysis') {
    const analysis = job.result.import_analysis;
    if (typeof analysis !== 'object' || analysis === null || Array.isArray(analysis)) return null;
    const fields = analysis as Record<string, unknown>;
    if (typeof fields.tmp_image_s3_key !== 'string' || typeof fields.prompt_supplement !== 'string') return null;
    const entityId = typeof fields.entity_id === 'string' && fields.entity_id.length > 0
      ? fields.entity_id
      : null;
    const tokenOptions = { secret: getReferenceCandidateTokenSecret() };
    let candidateToken: string;
    if (entityId === null) {
      const entityType = entityTypeSchema.safeParse(job.params.entity_type);
      if (!entityType.success) return null;
      candidateToken = createDraftReferenceCandidateToken({
        userId: job.userId,
        organizationId: job.organizationId ?? null,
        entityType: entityType.data,
        s3Key: fields.tmp_image_s3_key,
      }, tokenOptions);
    } else {
      candidateToken = createReferenceCandidateToken({
        userId: job.userId,
        entityId,
        s3Key: fields.tmp_image_s3_key,
      }, tokenOptions);
    }
    return {
      suggested_fields: fields.suggested_fields,
      prompt_supplement: fields.prompt_supplement,
      tmp_image_token: candidateToken,
    };
  }

  if (job.jobType === 'entity_generate') {
    return await toEntityGenerationResultResponse(job, audience);
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
  const response = pickKnownFields(result, [
    'updated_page_count',
    'updated_panel_count',
    'updated_assignment_count',
    'filled_field_count',
    'compiler_used',
    'compiler_provider',
    'compiler_model',
    'compiler_prompt_version',
    'progress_stage',
    'progress_current_chunk',
    'progress_total_chunks',
    'progress_started_at',
    'progress_updated_at',
  ]);
  const statePlan = episodeStatePlanResultResponseSchema.safeParse({
    state_plan_version: result.state_plan_version,
    state_assignment_policy: result.state_assignment_policy,
    state_transitions: result.state_transitions,
  });
  if (statePlan.success) {
    Object.assign(response, statePlan.data);
  }
  const stateBlocker = episodeStateBlockerResponseSchema.safeParse(result.state_blocker);
  if (stateBlocker.success) {
    response.state_blocker = stateBlocker.data;
  }
  return response;
}

function toEpisodePageSkeletonResultResponse(result: Record<string, unknown>): Record<string, unknown> {
  const response = pickKnownFields(result, [
    'pages_created',
    'panels_created',
    'replaced_existing',
    'story_plan_applied',
    'story_plan_result',
    'progress_stage',
    'progress_current_chunk',
    'progress_total_chunks',
    'progress_started_at',
    'progress_updated_at',
  ]);
  if (isRecord(response.story_plan_result)) {
    response.story_plan_result = pickKnownFields(response.story_plan_result, ['updated_page_count', 'updated_panel_count', 'updated_assignment_count', 'filled_field_count', 'compiler_used', 'compiler_provider', 'compiler_model', 'compiler_prompt_version']);
  }
  return response;
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

async function toEntityGenerationResultResponse(job: GenerationJob, audience: ImageDeliveryAudience = 'mobile'): Promise<Record<string, unknown>> {
  const result = job.result ?? {};
  const response: Record<string, unknown> = {};
  const provenance = readGenerationImageProvenance(job.params, job.result);
  Object.assign(response, publicImageProvenance(provenance));
  response.provider_result = isProviderResult(job);
  const access = imageMobileAccess(provenance);
  if (access === 'unavailable' || (access === 'web_only' && audience !== 'authorized_web')) return response;

  const entityId = typeof job.params.entity_id === 'string' ? job.params.entity_id : null;
  const candidates = entityId === null
    ? []
    : await toEntityCandidateResponse(result.candidates, job, entityId, audience);
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

  const response = { ...pickKnownFields(value, ['generation_mode', 'generated_at']), ...publicImageProvenance(readImageProvenance(value)) };
  return Object.keys(response).length === 0 ? null : response;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function toEntityCandidateResponse(
  value: unknown,
  job: GenerationJob,
  entityId: string,
  audience: ImageDeliveryAudience = 'mobile',
): Promise<Array<Record<string, unknown>>> {
  if (!Array.isArray(value)) {
    return [];
  }

  const candidates: Array<Record<string, unknown> | null> = await Promise.all(value.map(async (candidate): Promise<Record<string, unknown> | null> => {
    if (!isRecord(candidate) || typeof candidate.s3_key !== 'string') {
      return null;
    }

    const access = imageMobileAccess(readImageProvenance(candidate));
    if (access === 'unavailable' || (access === 'web_only' && audience !== 'authorized_web')) return null;
    const signedCdnUrl = typeof candidate.cdn_url === 'string'
      ? await signImageCdnUrl(candidate.cdn_url, candidate.s3_key)
      : null;

    const stateId = job.params.target === 'entity_state' && typeof job.params.entity_state_id === 'string'
      ? job.params.entity_state_id
      : null;
    if (job.params.target === 'entity_state' && stateId === null) {
      return null;
    }
    const candidateToken = stateId === null
      ? createReferenceCandidateToken({
          userId: job.userId,
          entityId,
          s3Key: candidate.s3_key,
        }, {
          secret: getReferenceCandidateTokenSecret(),
        })
      : createStateReferenceCandidateToken({
          userId: job.userId,
          organizationId: job.organizationId ?? null,
          entityId,
          stateId,
          jobId: job.id,
          s3Key: candidate.s3_key,
        }, {
          secret: getReferenceCandidateTokenSecret(),
        });

    return {
      candidate_token: candidateToken,
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
