import { describe, expect, it, vi } from 'vitest';
import { workSchema, chapterSchema, episodeSchema } from '../../../packages/api-contract/src/mobileApiSchemas.js';
import { ForbiddenError } from '../../../src/domain/errors/index.js';
import type { OrganizationServicePort } from '../../../src/services/organization/OrganizationService.js';
import { createWorkBootstrapRoutes } from '../../../src/routes/workBootstraps.js';
import type { WorkBootstrapServicePort } from '../../../src/services/story/WorkBootstrapService.js';
import type { WorkBootstrapResult } from '../../../src/domain/types/workBootstrap.js';

const result: WorkBootstrapResult = { mode:'one_shot', work:{id:'11111111-1111-4111-8111-111111111111',userId:'22222222-2222-4222-8222-222222222222',organizationId:null,title:'読み切り',genre:null,worldSetting:null,theme:null,mainEntityIds:[],startingPoint:null,endingPoint:null,overallFlow:null,version:1,editHistory:[],status:'draft',createdAt:new Date(0),updatedAt:new Date(0)}, chapter:{id:'33333333-3333-4333-8333-333333333333',workId:'11111111-1111-4111-8111-111111111111',order:1,title:'第1章',purpose:null,startingState:null,endingState:null,emotionCurve:null,entitiesInvolved:[],keyBeats:[],version:1,editHistory:[],status:'draft',createdAt:new Date(0),updatedAt:new Date(0)}, episode:{id:'44444444-4444-4444-8444-444444444444',chapterId:'33333333-3333-4333-8333-333333333333',order:1,title:'読み切り',purpose:null,storyInputMode:'structured',storyFullDraft:null,introduction:null,middle:null,climax:null,endingHook:null,estimatedPages:4,entitiesInvolved:[],pageSkeletonGenerated:false,version:1,editHistory:[],status:'draft',createdAt:new Date(0),updatedAt:new Date(0)}};
const service: WorkBootstrapServicePort = { create:async()=>result, listMetadata:async()=>[] };
const app = createWorkBootstrapRoutes({ authMiddleware:async (c,next)=>{ c.set('user',{id:'22222222-2222-4222-8222-222222222222',supabaseId:'subject',email:'test@example.invalid',displayName:null,planCode:'free'}); await next(); }, rateLimitMiddleware:async (_c,next)=>next(), workBootstrapService:service });
app.onError((error, c) => c.json({ message:error.message }, error instanceof Error && error.name === 'ValidationError' ? 422 : 500));
describe('work bootstraps route', () => {
  it('有効なタイトルで最初の話を返す', async () => {
    const response = await app.request('/work-bootstraps', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({title:'読み切り',mode:'one_shot',request_id:'55555555-5555-4555-8555-555555555555'}) });
    expect(response.status).toBe(201);
    const payload = await response.json() as Record<string, unknown>;
    expect(payload).toMatchObject({ mode:'one_shot', episode:{id:result.episode.id,estimated_pages:4} });
    expect(workSchema.safeParse(payload.work).success).toBe(true);
    expect(chapterSchema.safeParse(payload.chapter).success).toBe(true);
    expect(episodeSchema.safeParse(payload.episode).success).toBe(true);
  });
  it('101件のwork IDを拒否する', async () => {
    const ids = Array.from({length:101},()=> '11111111-1111-4111-8111-111111111111').join(',');
    expect((await app.request(`/work-creation-metadata?work_ids=${ids}`)).status).toBe(422);
  });
  it.each([
    { title:'', mode:'one_shot', request_id:result.work.id },
    { title:'x'.repeat(201), mode:'one_shot', request_id:result.work.id },
    { title:'title', mode:'other', request_id:result.work.id },
    { title:'title', mode:'one_shot', request_id:'bad' },
    { title:'title', mode:'one_shot', request_id:result.work.id, organization_id:result.work.id },
  ])('不正または余分な入力の場合に作成しない: %j', async body => {
    expect((await app.request('/work-bootstraps', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(body) })).status).toBe(422);
  });
  it('認証されていない場合に作成処理へ到達しない', async () => {
    const create = vi.fn();
    const unauthenticated = createWorkBootstrapRoutes({ authMiddleware:async c => c.json({code:'UNAUTHORIZED'},401), rateLimitMiddleware:async (_c,next)=>next(), workBootstrapService:{ ...service, create } });
    expect((await unauthenticated.request('/work-bootstraps',{method:'POST'})).status).toBe(401);
    expect(create).not.toHaveBeenCalled();
  });
  it('組織の編集権限がない場合に作品を作成しない', async () => {
    const create = vi.fn();
    const requireMembership = vi.fn().mockImplementation(async (_org:string,_user:string,capability:string):Promise<void> => {
      if (capability === 'edit_work') throw new ForbiddenError('Forbidden');
    });
    const organizationService = { requireMembership } as unknown as OrganizationServicePort;
    const scoped = createWorkBootstrapRoutes({ authMiddleware:async(c,next)=>{c.set('user',{id:result.work.userId,supabaseId:'subject',email:'test@example.invalid',displayName:null,planCode:'free'});await next();}, rateLimitMiddleware:async(_c,next)=>next(), organizationService, workBootstrapService:{...service,create} });
    scoped.onError((_error,c)=>c.json({code:'FORBIDDEN'},403));
    const response = await scoped.request(`/work-bootstraps?organization_id=${result.work.id}`, { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({title:'title',mode:'series',request_id:result.work.id}) });
    expect(response.status).toBe(403);
    expect(requireMembership.mock.calls.map(call=>call[2])).toEqual(['create_work','edit_work']);
    expect(create).not.toHaveBeenCalled();
  });
  it('GETの不正なIDと不正な組織IDの場合に拒否する', async () => {
    expect((await app.request('/work-creation-metadata?work_ids=bad')).status).toBe(422);
    expect((await app.request(`/work-creation-metadata?work_ids=${result.work.id}&organization_id=bad`)).status).toBe(422);
  });
});
