import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { AppError, UnauthorizedError } from '../../../src/domain/errors/index.js';
import type { GenerationBatchResponse } from '../../../src/domain/types/generationBatch.js';
import { createGenerationBatchRoutes, type GenerationBatchServicePort } from '../../../src/routes/generationBatches.js';
import type { AppEnv } from '../../../src/types/app.js';

const id='11111111-1111-4111-8111-111111111111';
const workId='22222222-2222-4222-8222-222222222222';
function fixture():{app:Hono<AppEnv>;calls:string[]}{
  const calls:string[]=[];const response=batchResponse();
  const service:GenerationBatchServicePort={capabilities:()=>({enabled:true,image_model:'gpt-image-2.5-sunburst',selections:['missing_only'],render_styles:['color','monochrome'],max_items:100,quote_ttl_seconds:300}),
    issue:async(_user,body)=>{calls.push(`issue:${body.kind}`);return response;},accept:async()=>{calls.push('accept');return{...response,status:'running'};},
    resume:async()=>{calls.push('resume');return{...response,status:'running'};},get:async()=>{calls.push('get');return response;},
    list:async()=>{calls.push('list');return{batches:[response]};},cancel:async()=>{calls.push('cancel');return{batch:{...response,status:'cancelled'},active_job_ids:[id]};}};
  const app=new Hono<AppEnv>();app.onError((error,c)=>error instanceof AppError?c.json({error:{code:error.code}},error.statusCode):c.json({error:{code:'INTERNAL'}},500));
  app.route('/api',createGenerationBatchRoutes({service,authMiddleware:async(c,next)=>{if(c.req.header('Authorization')!=='Bearer test')throw new UnauthorizedError();
    c.set('user',{id,supabaseId:'test',email:'test@example.invalid',displayName:null,planCode:'free'});await next();},rateLimitMiddleware:async(_c,next)=>next(),
    jobCancellation:{cancelJob:async()=>{calls.push('cancel-job');}}}));return{app,calls};
}
function post(body:unknown):RequestInit{return{method:'POST',headers:{Authorization:'Bearer test','Content-Type':'application/json'},body:JSON.stringify(body)};}

describe('generation batch routes',()=>{
  it('認証と明示kind/episode境界を要求する',async()=>{
    const{app,calls}=fixture();expect((await app.request('/api/generation-batch-capabilities')).status).toBe(401);
    expect((await app.request('/api/generation-batch-quotes',post({work_id:workId,kind:'pages',selection:'missing_only',render_style:'color'}))).status).toBe(422);
    expect((await app.request('/api/generation-batch-quotes',post({work_id:workId,kind:'character_references',episode_id:id,selection:'missing_only',render_style:'color'}))).status).toBe(422);
    expect(calls).toEqual([]);
  });
  it('auto_confirm同意とresume request keyを厳格に検証する',async()=>{
    const{app,calls}=fixture();
    expect((await app.request(`/api/generation-batches/${id}/accept`,post({request_key:id,auto_confirm:false}))).status).toBe(422);
    expect((await app.request(`/api/generation-batches/${id}/accept`,post({request_key:id,auto_confirm:true}))).status).toBe(200);
    expect((await app.request(`/api/generation-batches/${id}/resume`,post({request_key:id}))).status).toBe(200);
    expect(calls).toEqual(['accept','resume']);
  });
  it('GETは読取だけでcancel時だけ既存active job停止へ接続する',async()=>{
    const{app,calls}=fixture();const headers={Authorization:'Bearer test'};
    expect((await app.request(`/api/generation-batches/${id}`,{headers})).status).toBe(200);
    expect((await app.request(`/api/generation-batches?work_id=${workId}`,{headers})).status).toBe(200);
    expect(calls).toEqual(['get','list']);
    expect((await app.request(`/api/generation-batches/${id}/cancel`,{method:'POST',headers})).status).toBe(200);
    expect(calls).toEqual(['get','list','cancel','cancel-job']);
  });
});
function batchResponse():GenerationBatchResponse{return{batch_id:id,work_id:workId,kind:'character_references',episode_id:null,status:'quoted',selection:'missing_only',render_style:'color',image_model:'gpt-image-2.5-sunburst',pricing_version:'v1',maximum_credits:1,auto_confirm:false,
  expires_at:'2026-11-22T01:00:00.000Z',accepted_at:null,created_at:'2026-11-22T00:00:00.000Z',updated_at:'2026-11-22T00:00:00.000Z',
  progress:{total:1,completed:0,skipped:0,failed:0,active:0,pending:1},items:[],blockers:[],active_job_ids:[]};}
