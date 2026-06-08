import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { z } from 'zod';
import { ValidationError } from '../domain/errors/index.js';
import type { GenerationJob } from '../domain/types/job.js';
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
    params: job.params,
    result: toJobResultResponse(job),
    openai_request_id: job.openaiRequestId,
    error_message: job.errorMessage,
    retry_count: job.retryCount,
    created_at: job.createdAt.toISOString(),
    started_at: job.startedAt?.toISOString() ?? null,
    completed_at: job.completedAt?.toISOString() ?? null,
    expires_at: job.expiresAt?.toISOString() ?? null,
  };
}

function toJobResultResponse(job: GenerationJob): Record<string, unknown> | null {
  if (job.result === null) {
    return null;
  }

  return job.jobType === 'entity_generate'
    ? toEntityGenerationResultResponse(job.result)
    : toPageGenerationResultResponse(job.result);
}

function toPageGenerationResultResponse(result: Record<string, unknown>): Record<string, unknown> {
  return pickKnownFields(result, [
    's3_key',
    'cdn_url',
    'generated_image',
    'generation_mode',
    'request_kind',
    'cost_usd',
    'compiled_prompt_used',
    'prompt_compiler_provider',
    'compiler_model',
    'compiler_prompt_version',
    'compiler_error',
  ]);
}

function toEntityGenerationResultResponse(result: Record<string, unknown>): Record<string, unknown> {
  return pickKnownFields(result, [
    'candidates',
    'cost_usd',
    'compiled_prompt_used',
    'prompt_compiler_provider',
    'compiler_model',
    'compiler_prompt_version',
    'compiler_error',
    'image_model',
    'image_params',
    'created_at',
  ]);
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
