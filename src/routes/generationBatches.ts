import { Hono, type MiddlewareHandler } from 'hono';
import { z } from 'zod';
import {
  generationBatchAcceptRequestSchema,
  generationBatchCancelResponseSchema,
  generationBatchCapabilitiesSchema,
  generationBatchQuoteRequestSchema,
  generationBatchResumeRequestSchema,
  generationBatchSchema,
  generationBatchesSchema,
} from '../../packages/api-contract/src/generationBatch.js';
import { ValidationError } from '../domain/errors/index.js';
import type {
  GenerationBatchAcceptRequestBody,
  GenerationBatchQuoteRequestBody,
  GenerationBatchResumeRequestBody,
} from '../domain/types/generationBatch.js';
import { formatZodValidationError } from '../lib/validationErrorFormatter.js';
import type { GenerationBatchService } from '../services/generation/batch/GenerationBatchService.js';
import type { OrganizationServicePort } from '../services/organization/OrganizationService.js';
import type { AppEnv } from '../types/app.js';
import { parseOptionalOrganizationId, requireOrganizationCapability } from './organizationRouteHelpers.js';
import { assertMobileResponseContract } from './mobileResponseContract.js';
import { readJsonBody, REQUEST_BODY_LIMITS } from './requestBody.js';

const listSchema=z.object({work_id:z.string().uuid(),episode_id:z.string().uuid().optional()}).strict();
const idSchema=z.string().uuid();

export type GenerationBatchServicePort=Pick<GenerationBatchService,'capabilities'|'issue'|'accept'|'get'|'list'|'cancel'|'resume'>;
export interface GenerationBatchJobCancellationPort {cancelJob(userId:string,jobId:string,organizationId?:string|null):Promise<unknown>}

export function createGenerationBatchRoutes(dependencies:{
  authMiddleware:MiddlewareHandler<AppEnv>;rateLimitMiddleware:MiddlewareHandler<AppEnv>;
  service:GenerationBatchServicePort;organizationService?:OrganizationServicePort;
  jobCancellation:GenerationBatchJobCancellationPort;
}):Hono<AppEnv>{
  const app=new Hono<AppEnv>();app.use('*',dependencies.authMiddleware);app.use('*',dependencies.rateLimitMiddleware);
  app.get('/generation-batch-capabilities',async(c)=>{
    const organizationId=parseOptionalOrganizationId(c);await requireOrganizationCapability(c,dependencies,organizationId,'generate');
    return c.json(assertMobileResponseContract(generationBatchCapabilitiesSchema,dependencies.service.capabilities()));
  });
  app.post('/generation-batch-quotes',async(c)=>{
    const organizationId=parseOptionalOrganizationId(c);await requireOrganizationCapability(c,dependencies,organizationId,'generate');
    const body=parse(generationBatchQuoteRequestSchema,await readJsonBody(c,{maxBytes:REQUEST_BODY_LIMITS.SMALL_JSON_BYTES,description:'Generation batch quote'})) as GenerationBatchQuoteRequestBody;
    return c.json(assertMobileResponseContract(generationBatchSchema,await dependencies.service.issue(c.get('user').id,body,organizationId)));
  });
  app.post('/generation-batches/:id/accept',async(c)=>{
    const organizationId=parseOptionalOrganizationId(c);await requireOrganizationCapability(c,dependencies,organizationId,'generate');
    const body=parse(generationBatchAcceptRequestSchema,await readJsonBody(c,{maxBytes:REQUEST_BODY_LIMITS.SMALL_JSON_BYTES,description:'Generation batch acceptance'})) as GenerationBatchAcceptRequestBody;
    return c.json(assertMobileResponseContract(generationBatchSchema,await dependencies.service.accept(c.get('user').id,id(c.req.param('id')),body,organizationId)));
  });
  app.post('/generation-batches/:id/resume',async(c)=>{
    const organizationId=parseOptionalOrganizationId(c);await requireOrganizationCapability(c,dependencies,organizationId,'generate');
    const body=parse(generationBatchResumeRequestSchema,await readJsonBody(c,{maxBytes:REQUEST_BODY_LIMITS.SMALL_JSON_BYTES,description:'Generation batch resume'})) as GenerationBatchResumeRequestBody;
    return c.json(assertMobileResponseContract(generationBatchSchema,await dependencies.service.resume(c.get('user').id,id(c.req.param('id')),body,organizationId)));
  });
  app.get('/generation-batches',async(c)=>{
    const organizationId=parseOptionalOrganizationId(c);await requireOrganizationCapability(c,dependencies,organizationId,'generate');
    const query=parse(listSchema,{work_id:c.req.query('work_id'),episode_id:c.req.query('episode_id')});
    return c.json(assertMobileResponseContract(generationBatchesSchema,await dependencies.service.list(c.get('user').id,query.work_id,query.episode_id??null,organizationId)));
  });
  app.get('/generation-batches/:id',async(c)=>{
    const organizationId=parseOptionalOrganizationId(c);await requireOrganizationCapability(c,dependencies,organizationId,'generate');
    return c.json(assertMobileResponseContract(generationBatchSchema,await dependencies.service.get(c.get('user').id,id(c.req.param('id')),organizationId)));
  });
  app.post('/generation-batches/:id/cancel',async(c)=>{
    const organizationId=parseOptionalOrganizationId(c);await requireOrganizationCapability(c,dependencies,organizationId,'generate');
    const userId=c.get('user').id;const batchId=id(c.req.param('id'));
    const result=await dependencies.service.cancel(userId,batchId,organizationId);
    for(const jobId of result.active_job_ids)await dependencies.jobCancellation.cancelJob(c.get('user').id,jobId,organizationId);
    const reconciled=result.active_job_ids.length===0?result:await dependencies.service.cancel(userId,batchId,organizationId);
    return c.json(assertMobileResponseContract(generationBatchCancelResponseSchema,reconciled));
  });
  return app;
}
function id(value:string):string{return parse(idSchema,value);}
function parse<T>(schema:z.ZodType<T>,value:unknown):T{const result=schema.safeParse(value);if(!result.success)throw new ValidationError(formatZodValidationError(result.error));return result.data;}
