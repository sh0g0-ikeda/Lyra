import { Hono, type MiddlewareHandler } from 'hono';
import { z } from 'zod';
import { generationQuoteRequestSchema, generationQuoteAcceptanceSchema, generationQuoteResponseSchema, generationQuoteReceiptSchema } from '../../packages/api-contract/src/mobileApiSchemas.js';
import { ValidationError } from '../domain/errors/index.js';
import type { GenerationQuoteReceipt, GenerationQuoteRequest } from '../domain/types/generationQuote.js';
import { formatZodValidationError } from '../lib/validationErrorFormatter.js';
import type { AppEnv } from '../types/app.js';
import type { GenerationQuoteService } from '../services/generation/GenerationQuoteService.js';
import { hashQuoteToken } from '../services/generation/GenerationQuoteService.js';
import { parseReferenceCandidateTokenDetails } from '../services/entity/ReferenceCandidateToken.js';
import { env } from '../lib/env.js';
import type { OrganizationServicePort } from '../services/organization/OrganizationService.js';
import { parseOptionalOrganizationId, requireOrganizationCapability } from './organizationRouteHelpers.js';
import { assertMobileResponseContract } from './mobileResponseContract.js';
import { readJsonBody, REQUEST_BODY_LIMITS } from './requestBody.js';

export type GenerationQuoteServicePort=Pick<GenerationQuoteService,'issue'|'accept'|'receipt'>;
export function createGenerationQuoteRoutes(dependencies:{authMiddleware:MiddlewareHandler<AppEnv>;rateLimitMiddleware:MiddlewareHandler<AppEnv>;
  generationQuoteService:GenerationQuoteServicePort;organizationService?:OrganizationServicePort}):Hono<AppEnv>{
  const app=new Hono<AppEnv>();app.use('*',dependencies.authMiddleware);app.use('*',dependencies.rateLimitMiddleware);
  app.post('/generation-quotes',async(c)=>{
    const organizationId=parseOptionalOrganizationId(c);
    await requireOrganizationCapability(c,dependencies,organizationId,'generate');
    const parsed=generationQuoteRequestSchema.safeParse(await readJsonBody(c,{maxBytes:REQUEST_BODY_LIMITS.SMALL_JSON_BYTES,description:'Generation quote'}));
    if(!parsed.success) throw new ValidationError(formatZodValidationError(parsed.error));
    const body=parsed.data;
    const request:GenerationQuoteRequest={operation:body.operation,targetId:body.target_id,entityId:body.entity_id,
      uploadTokenHash:body.upload_token===undefined ? undefined:hashQuoteToken(body.upload_token),entityType:body.entity_type,
      sourceRefId:body.source_ref_id,imageModel:body.image_model,quality:body.quality,renderStyle:body.render_style,expectedRevision:body.expected_revision};
    if(body.source_candidate_token!==undefined){
      request.sourceCandidate=parseReferenceCandidateTokenDetails(body.source_candidate_token,{userId:c.get('user').id,entityId:body.target_id!},{
        secret:env.REFERENCE_CANDIDATE_TOKEN_SECRET ?? env.SUPABASE_JWT_SECRET ?? env.STRIPE_WEBHOOK_SECRET ?? 'development-reference-candidate-token-secret',
      });
    }
    const {quote,quoteToken}=await dependencies.generationQuoteService.issue(c.get('user').id,request,organizationId);
    const plan=quote.plan;
    return c.json(assertMobileResponseContract(generationQuoteResponseSchema,{quote_id:quote.id,quote_token:quoteToken,operation:plan.operation,target_id:plan.targetId,
      billing_scope:{kind:organizationId===null?'personal':'organization',organization_id:organizationId},image_model:plan.imageModel,quality:plan.quality,
      render_style:plan.renderStyle,reference_count:plan.referenceCount,amount_credits:plan.amountCredits,pricing_version:plan.pricingVersion,
      input_revision:plan.inputRevision,expires_at:quote.expiresAt.toISOString(),blockers:[]}));
  });
  app.post('/generation-quotes/:id/accept',async(c)=>{
    const organizationId=parseOptionalOrganizationId(c);
    await requireOrganizationCapability(c,dependencies,organizationId,'generate');
    const parsed=generationQuoteAcceptanceSchema.safeParse(await readJsonBody(c,{maxBytes:REQUEST_BODY_LIMITS.SMALL_JSON_BYTES,description:'Generation quote acceptance'}));
    if(!parsed.success) throw new ValidationError(formatZodValidationError(parsed.error));
    const result=await dependencies.generationQuoteService.accept(c.get('user').id,quoteId(c.req.param('id')),parsed.data.quote_token,parsed.data.request_key,organizationId);
    return c.json(assertMobileResponseContract(generationQuoteReceiptSchema,receiptResponse(result)));
  });
  app.get('/generation-quotes/:id',async(c)=>{
    const organizationId=parseOptionalOrganizationId(c);
    await requireOrganizationCapability(c,dependencies,organizationId,'generate');
    const result=await dependencies.generationQuoteService.receipt(c.get('user').id,quoteId(c.req.param('id')),organizationId);
    return c.json(assertMobileResponseContract(generationQuoteReceiptSchema,receiptResponse(result)));
  });
  return app;
}
function quoteId(value:string):string{const parsed=z.string().uuid().safeParse(value);if(!parsed.success) throw new ValidationError('Invalid quote id');return parsed.data;}
function receiptResponse(result:GenerationQuoteReceipt):Record<string,unknown>{
  return {quote_id:result.quote.id,job_id:result.quote.acceptedJobId,status:result.jobStatus,amount_credits:result.quote.plan.amountCredits,
    charged_credits:result.chargedCredits,refunded_credits:result.refundedCredits,accepted_at:result.quote.acceptedAt?.toISOString() ?? null,expires_at:result.quote.expiresAt.toISOString()};
}
