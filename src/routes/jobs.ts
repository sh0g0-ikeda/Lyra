import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { z } from 'zod';
import { ValidationError } from '../domain/errors/index.js';
import type { GenerationJob } from '../domain/types/job.js';
import { signImageCdnUrl } from '../infrastructure/aws/CloudFrontImageUrlSigner.js';
import type { JobServicePort } from '../services/job/JobService.js';
import type { AppEnv } from '../types/app.js';

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

  app.get('/jobs/:id', async (c) => {
    const user = c.get('user');
    const jobId = parseUuidParam(c, 'id');
    const job = await dependencies.jobService.getJob(user.id, jobId);

    return c.json(toJobResponse(job));
  });

  return app;
}

function parseUuidParam(c: Context<AppEnv>, name: string): string {
  const result = uuidParamSchema.safeParse(c.req.param(name));
  if (!result.success) {
    throw new ValidationError(`${name} must be a valid UUID`);
  }

  return result.data;
}

function toJobResponse(job: GenerationJob): Record<string, unknown> {
  return {
    id: job.id,
    job_type: job.jobType,
    status: job.status,
    generation_mode: job.generationMode,
    credit_cost: job.creditCost,
    params: toJobParamsResponse(job),
    result: toJobResultResponse(job),
    error_message: job.errorMessage,
    retry_count: job.retryCount,
    created_at: job.createdAt.toISOString(),
    started_at: job.startedAt?.toISOString() ?? null,
    completed_at: job.completedAt?.toISOString() ?? null,
    expires_at: job.expiresAt?.toISOString() ?? null,
  };
}

function toJobParamsResponse(job: GenerationJob): Record<string, unknown> {
  return job.jobType === 'entity_generate'
    ? pickKnownFields(job.params, ['entity_id', 'entity_type'])
    : pickKnownFields(job.params, [
        'page_id',
        'request_kind',
        'generation_mode',
        'quality',
        'requires_planner',
      ]);
}

function toJobResultResponse(job: GenerationJob): Record<string, unknown> | null {
  if (job.result === null) {
    return null;
  }

  return job.jobType === 'entity_generate'
    ? toEntityGenerationResultResponse(job)
    : toPageGenerationResultResponse(job.result);
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

function toEntityGenerationResultResponse(job: GenerationJob): Record<string, unknown> {
  const result = job.result ?? {};
  const response: Record<string, unknown> = {};
  response.provider_result = isProviderResult(job);

  const candidates = toEntityCandidateResponse(result.candidates);
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

function toEntityCandidateResponse(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((candidate) => {
    if (!isRecord(candidate) || typeof candidate.s3_key !== 'string') {
      return [];
    }

    const signedCdnUrl = typeof candidate.cdn_url === 'string'
      ? signImageCdnUrl(candidate.cdn_url)
      : null;

    return [
      {
        s3_key: candidate.s3_key,
        ...(signedCdnUrl === null ? {} : { cdn_url: signedCdnUrl }),
      },
    ];
  });
}
