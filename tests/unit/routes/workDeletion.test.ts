import {UnauthorizedError} from '../../../src/domain/errors/index.js';
import {randomUUID} from 'node:crypto';
import {Hono,type MiddlewareHandler} from 'hono';
import {describe,it,expect,vi} from 'vitest';
import type {AppEnv} from '../../../src/types/app.js';
import {createWorkDeletionRoutes} from '../../../src/routes/workDeletion.js';
import {errorHandler} from '../../../src/middleware/errorHandler.js';
const user=randomUUID(),work=randomUUID(),deletion=randomUUID();
const auth:MiddlewareHandler<AppEnv>=async(c,next)=>{c.set('user',{id:user,supabaseId:user,email:'test@example.invalid',displayName:null,planCode:'free'});await next();};
const receipt={deletion_id:deletion,work_id:work,status:'pending' as const,blocker_code:null};
function fixture(enabled=true,completed=false){
 const service={requestDeletion:vi.fn(async()=>({...receipt,status:completed?'completed' as const:'pending' as const})),getDeletion:vi.fn(async()=>receipt),listDeletions:vi.fn(async()=>({deletions:[receipt]}))};
 const app=new Hono<AppEnv>();app.onError(errorHandler);app.route('/api',createWorkDeletionRoutes({authMiddleware:auth,rateLimitMiddleware:async(_c,next)=>next(),workDeletionService:service,admissionEnabled:enabled}));return {app,service};
}
describe('永久作品削除HTTP契約',()=>{
 it('DELETEは202receiptとscopeを返す',async()=>{const {app,service}=fixture();const org=randomUUID();const response=await app.request(`/api/works/${work}?organization_id=${org}`,{method:'DELETE'});expect(response.status).toBe(202);expect(await response.json()).toEqual(receipt);expect(service.requestDeletion).toHaveBeenCalledWith(user,work,org);expect(response.headers.get('Cache-Control')).toBe('no-store');});
 it('受付OFFでも既存receiptの取得と再開一覧は残す',async()=>{const {app,service}=fixture(false);expect((await app.request(`/api/works/${work}`,{method:'DELETE'})).status).toBe(409);expect(service.requestDeletion).not.toHaveBeenCalled();expect((await app.request(`/api/work-deletions/${deletion}`)).status).toBe(200);expect(await (await app.request('/api/work-deletions')).json()).toEqual({deletions:[receipt]});});
 it('不正なUUIDは削除serviceを呼ばない',async()=>{const {app,service}=fixture();expect((await app.request('/api/works/invalid',{method:'DELETE'})).status).toBe(422);expect(service.requestDeletion).not.toHaveBeenCalled();});
 it('完了済みDELETEの再取得では200で同じreceiptを返す',async()=>{const {app}=fixture(true,true);const response=await app.request(`/api/works/${work}`,{method:'DELETE'});expect(response.status).toBe(200);expect(await response.json()).toEqual({...receipt,status:'completed'});});
 it('未認証requestではserviceを呼ばない',async()=>{
  const {service}=fixture();const app=new Hono<AppEnv>();app.onError(errorHandler);
  app.route('/api',createWorkDeletionRoutes({authMiddleware:async()=>{throw new UnauthorizedError();},rateLimitMiddleware:async(_c,next)=>next(),workDeletionService:service,admissionEnabled:true}));
  expect((await app.request(`/api/works/${work}`,{method:'DELETE'})).status).toBe(401);expect(service.requestDeletion).not.toHaveBeenCalled();
 });
});
