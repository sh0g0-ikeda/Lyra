import { Hono,type MiddlewareHandler } from 'hono';
import {describe,expect,it,vi} from 'vitest';
import {createPushTokenRoutes} from '../../../src/routes/pushTokens.js';
import {errorHandler} from '../../../src/middleware/errorHandler.js';
import type {AppEnv} from '../../../src/types/app.js';
const id='11111111-1111-4111-8111-111111111111';
function fixture(){const register=vi.fn(async(_user:string,input:{installationId:string;platform:'ios'|'android'})=>({installationId:input.installationId,platform:input.platform}));const remove=vi.fn(async()=>{});const auth:MiddlewareHandler<AppEnv>=async(c,next)=>{c.set('user',{id,supabaseId:'sub',email:'owner@example.com',displayName:null,planCode:'free'});await next();};const app=new Hono<AppEnv>();app.onError(errorHandler);app.route('/api',createPushTokenRoutes({authMiddleware:auth,rateLimitMiddleware:async(_c,next)=>next(),pushTokenRegistryService:{register,remove}}));return {app,register,remove};}
describe('deployed push token routes',()=>{
 it('registers only authenticated-user scope and never returns device token',async()=>{const f=fixture();const r=await f.app.request('/api/push-tokens',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({installation_id:id,platform:'android',device_token:'test-device-token-value',locale:'ja'})});expect(r.status).toBe(200);expect(r.headers.get('cache-control')).toBe('no-store');expect(await r.json()).toEqual({status:'registered',installation_id:id,platform:'android'});expect(f.register).toHaveBeenCalledWith(id,{installationId:id,platform:'android',deviceToken:'test-device-token-value',locale:'ja'});});
 it('rejects client-controlled owner and malformed installations before storage',async()=>{const f=fixture();const r=await f.app.request('/api/push-tokens',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({installation_id:id,platform:'android',device_token:'test-device-token-value',user_id:'another'})});expect(r.status).toBe(422);expect(f.register).not.toHaveBeenCalled();});
 it('removes only the authenticated installation and returns204',async()=>{const f=fixture();const r=await f.app.request(`/api/push-tokens/${id}`,{method:'DELETE'});expect(r.status).toBe(204);expect(r.headers.get('cache-control')).toBe('no-store');expect(f.remove).toHaveBeenCalledWith(id,id);});
});
