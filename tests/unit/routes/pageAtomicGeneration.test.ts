import {Hono} from 'hono';
import {describe,expect,it,vi} from 'vitest';
import {createPageRoutes,type PageRouteDependencies} from '../../../src/routes/pages.js';
import type {AppEnv} from '../../../src/types/app.js';
import {AppError} from '../../../src/domain/errors/index.js';
const id='11111111-1111-4111-8111-111111111111';
const body={expected_updated_at:'2026-10-01T12:00:00.000Z',panels:[{id,order:1,entities:[]}],frames:[{panel_id:id,reading_order:1,vertices:[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}]}],generation:{language:'ja'}};
function fixture(){
 const save=vi.fn().mockResolvedValue({jobId:id,pageRevision:'2026-10-01T12:00:00.001Z'});
 const readiness=vi.fn().mockResolvedValue({ready:false,blockers:[{code:'FRAME_REQUIRED',entityId:null,field:'frames',action:'open_layout',messageKey:'page.blocker.frameRequired'}],warnings:[],estimatedCreditCost:3,pageRevision:body.expected_updated_at});
 const app=new Hono<AppEnv>();
 app.onError((error,c)=>error instanceof AppError?c.json({error:{code:error.code}},error.statusCode):c.json({error:String(error)},500));
 const dependencies={authMiddleware:async(c,next)=>{c.set('user',{id:'user-1',supabaseId:'subject',email:'user@example.invalid',displayName:null,planCode:'free'});await next();},rateLimitMiddleware:async(_c,next)=>{await next();},pageAtomicGenerationService:{saveAndGenerate:save,getGenerationReadiness:readiness}} as Partial<PageRouteDependencies> as PageRouteDependencies;
 app.route('/api',createPageRoutes(dependencies));return{app,save,readiness};
}
describe('page atomic compatibility routes',()=>{
 it('本番payloadとkeyを一回だけServiceへ渡し202を返す',async()=>{const{app,save}=fixture();const response=await app.request(`/api/pages/${id}/save-and-generate`,{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':'stable-key-1'},body:JSON.stringify(body)});expect(response.status).toBe(202);expect(save).toHaveBeenCalledOnce();expect(save.mock.calls[0]?.[2]).toMatchObject({requestId:'stable-key-1',expectedUpdatedAt:body.expected_updated_at,renderStyle:'color',language:'ja',panels:[{id,order:1,entities:[]}],frames:[{panelId:id}]});await expect(response.json()).resolves.toEqual({job_id:id,page_revision:'2026-10-01T12:00:00.001Z'});});
 it('keyなしと不正bodyはServiceを呼ばない',async()=>{const{app,save}=fixture();for(const key of ['', 'short','invalid!key']){const response=await app.request(`/api/pages/${id}/save-and-generate`,{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify(body)});expect(response.status).toBe(422);}expect(save).not.toHaveBeenCalled();});
 it('readinessはpublic blockerとrevisionを返す',async()=>{const{app,readiness}=fixture();const response=await app.request(`/api/pages/${id}/generation-readiness`);expect(response.status).toBe(200);expect(readiness).toHaveBeenCalledOnce();await expect(response.json()).resolves.toMatchObject({ready:false,blockers:[{code:'FRAME_REQUIRED',entity_id:null,field:'frames',action:'open_layout',message_key:'page.blocker.frameRequired'}],estimated_credit_cost:3,page_revision:body.expected_updated_at});});
 it('512KiBを超えるbodyは解析前に413で止める',async()=>{const{app,save}=fixture();const response=await app.request(`/api/pages/${id}/save-and-generate`,{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':'bounded-key-1'},body:JSON.stringify({...body,padding:'x'.repeat(512*1024)})});expect(response.status).toBe(413);expect(save).not.toHaveBeenCalled();});

});
