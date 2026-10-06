import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { createGenerationQuoteRoutes, type GenerationQuoteServicePort } from '../../../src/routes/generationQuotes.js';
import { AppError, UnauthorizedError } from '../../../src/domain/errors/index.js';
import type { AppEnv } from '../../../src/types/app.js';
import type { GenerationQuote, GenerationQuoteRequest } from '../../../src/domain/types/generationQuote.js';
import { hashQuoteToken } from '../../../src/services/generation/GenerationQuoteService.js';
import { createReferenceCandidateToken } from '../../../src/services/entity/ReferenceCandidateToken.js';
import { env } from '../../../src/lib/env.js';

const id='11111111-1111-4111-8111-111111111111';
function fixture():{app:Hono<AppEnv>;requests:GenerationQuoteRequest[]}{
  const requests:GenerationQuoteRequest[]=[];
  const quote:GenerationQuote={id,userId:id,organizationId:null,request:{operation:'page_generate',targetId:id},expiresAt:new Date('2026-10-01T23:00:00Z'),acceptedJobId:null,requestKey:null,acceptedAt:null,
    plan:{operation:'page_generate',targetId:id,workId:id,inputRevision:'a'.repeat(64),imageModel:'gpt-image-2',providerModelId:'gpt-image-2',quality:'medium',renderStyle:'color',referenceCount:0,amountCredits:3,pricingVersion:'v1',generationMode:'standard',jobParams:{},
      snapshot:{kind:'page',layoutConfig:{},prompt:{workId:id,draftPrompt:'PRIVATE PROMPT',compilerBrief:'PRIVATE BRIEF',inputSnapshot:{pageId:id,requestKind:'initial',generationMode:'standard',panelCount:1,panels:[]}}}}};
  const service:GenerationQuoteServicePort={
    issue:async(_userId,request)=>{requests.push(request);return {quote,quoteToken:'quote-secret'};},
    accept:async()=>({quote:{...quote,acceptedJobId:id,acceptedAt:new Date('2026-10-01T22:00:00Z')},jobStatus:'queued',chargedCredits:3,refundedCredits:0}),
    receipt:async()=>({quote,jobStatus:null,chargedCredits:0,refundedCredits:0}),
  };
  const app=new Hono<AppEnv>();
  app.onError((error,c)=>error instanceof AppError ? c.json({error:{code:error.code}},error.statusCode):c.json({error:{code:'INTERNAL'}},500));
  app.route('/api',createGenerationQuoteRoutes({generationQuoteService:service,authMiddleware:async(c,next)=>{
    if(c.req.header('Authorization')!=='Bearer test') throw new UnauthorizedError();
    c.set('user',{id,supabaseId:'test',email:'test@example.invalid',displayName:null,planCode:'free'});await next();
  },rateLimitMiddleware:async(_c,next)=>next()}));
  return {app,requests};
}
function post(body:unknown):RequestInit{return {method:'POST',headers:{Authorization:'Bearer test','Content-Type':'application/json'},body:JSON.stringify(body)};}

describe('generation quote route',()=>{
  it('認証を必須としpublic quoteにpromptや内部snapshotを出さない',async()=>{
    const {app}=fixture();
    expect((await app.request('/api/generation-quotes',{method:'POST'})).status).toBe(401);
    const response=await app.request('/api/generation-quotes',post({operation:'page_generate',target_id:id,render_style:'monochrome'}));
    expect(response.status).toBe(200);
    const payload=await response.text();expect(payload).toContain('amount_credits');expect(payload).not.toContain('PRIVATE');expect(payload).not.toContain('snapshot');
  });
  it.each([
    {operation:'page_generate',target_id:id,amount_credits:1},
    {operation:'page_generate',target_id:id,quality:'high'},
    {operation:'page_generate'},
    {operation:'entity_import_analysis',image_base64:'not accepted'},
  ])('無許可の料金・quality・不完全な入力を拒否する: %j',async(body)=>{
    const {app,requests}=fixture();expect((await app.request('/api/generation-quotes',post(body))).status).toBe(422);expect(requests).toEqual([]);
  });
  it('importのupload credentialを保存要求へそのまま渡さない',async()=>{
    const {app,requests}=fixture();
    const response=await app.request('/api/generation-quotes',post({operation:'entity_import_analysis',upload_token:'temporary-upload-secret',entity_type:'object'}));
    expect(response.status).toBe(200);expect(requests[0]?.uploadTokenHash).toBe(hashQuoteToken('temporary-upload-secret'));
    expect(JSON.stringify(requests)).not.toContain('temporary-upload-secret');
  });
  it('受付と未受付receiptを安定した追加契約で返す',async()=>{
    const {app}=fixture();
    const accepted=await app.request(`/api/generation-quotes/${id}/accept`,post({quote_token:'quote-secret',request_key:id}));
    expect(accepted.status).toBe(200);expect(await accepted.json()).toMatchObject({job_id:id,status:'queued',charged_credits:3,refunded_credits:0});
    const pending=await app.request(`/api/generation-quotes/${id}`,{headers:{Authorization:'Bearer test'}});
    expect(pending.status).toBe(200);expect(await pending.json()).toMatchObject({job_id:null,status:null,charged_credits:0});
  });
  it('候補tokenは同じactorとentityのみ受理しbearerを保存入力へ渡さない',async()=>{
    const {app,requests}=fixture();
    const secret=env.REFERENCE_CANDIDATE_TOKEN_SECRET ?? env.SUPABASE_JWT_SECRET ?? env.STRIPE_WEBHOOK_SECRET ?? 'development-reference-candidate-token-secret';
    const token=createReferenceCandidateToken({userId:id,entityId:id,s3Key:`tmp/${id}/entities/imports/source.png`},{secret});
    const response=await app.request('/api/generation-quotes',post({operation:'entity_preview',target_id:id,source_candidate_token:token}));
    expect(response.status).toBe(200);expect(requests[0]?.sourceCandidate?.s3Key).toContain('/imports/source.png');
    expect(JSON.stringify(requests)).not.toContain(token);
    const unbound=createReferenceCandidateToken({userId:id,entityId:'',s3Key:`tmp/${id}/entities/imports/source.png`},{secret});
    expect((await app.request('/api/generation-quotes',post({operation:'entity_preview',target_id:id,source_candidate_token:unbound}))).status).toBe(422);
    expect((await app.request('/api/generation-quotes',post({operation:'entity_preview',target_id:id,source_candidate_token:`${token}tampered`}))).status).toBe(422);
  });
});
