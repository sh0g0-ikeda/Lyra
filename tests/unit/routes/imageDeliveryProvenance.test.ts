import { PageThumbnailService } from '../../../src/services/page/PageThumbnailService.js';
import { afterEach,describe,expect,it,vi } from 'vitest';
import type { Hono,MiddlewareHandler } from 'hono';
import { AppError,ForbiddenError } from '../../../src/domain/errors/index.js';
import type { AppEnv } from '../../../src/types/app.js';
import { env } from '../../../src/lib/env.js';
import { createPageRoutes,type PageRouteDependencies } from '../../../src/routes/pages.js';
import { createEntityRoutes,type EntityRouteDependencies } from '../../../src/routes/entities.js';
import { PageExportService } from '../../../src/services/page/PageExportService.js';
import { EntityReferenceImageExportService } from '../../../src/services/entity/EntityReferenceImageExportService.js';
import { createReferenceCandidateToken } from '../../../src/services/entity/ReferenceCandidateToken.js';
const userId='11111111-1111-4111-8111-111111111111', pageId='22222222-2222-4222-8222-222222222222',entityId='33333333-3333-4333-8333-333333333333',jobId='44444444-4444-4444-8444-444444444444',orgId='55555555-5555-4555-8555-555555555555';
const user={id:userId,supabaseId:'fixture',email:'fixture@example.invalid',displayName:null,planCode:'free'};
const oldAllowlist=env.WEB_IMAGE_DELIVERY_COGNITO_CLIENT_IDS;
const oldSignerConfig={mode:env.IMAGE_DELIVERY_MODE,enabled:env.IMAGE_CDN_SIGNING_ENABLED,keyPair:env.CLOUDFRONT_KEY_PAIR_ID};
afterEach(()=>{env.WEB_IMAGE_DELIVERY_COGNITO_CLIENT_IDS=oldAllowlist;env.IMAGE_DELIVERY_MODE=oldSignerConfig.mode;env.IMAGE_CDN_SIGNING_ENABLED=oldSignerConfig.enabled;env.CLOUDFRONT_KEY_PAIR_ID=oldSignerConfig.keyPair;vi.clearAllMocks();});
const passthrough:MiddlewareHandler<AppEnv>=async(_c,next)=>{await next()};
const auth=(client?:string):MiddlewareHandler<AppEnv>=>async(c,next)=>{c.set('user',user);if(client)c.set('authenticatedClientId',client);await next();};
function handleErrors(app:Hono<AppEnv>):Hono<AppEnv>{app.onError((error,c)=>error instanceof AppError?c.json({code:error.code},error.statusCode):c.json({code:'INTERNAL'},500));return app;}
function pageRoutes(model:string|undefined,client?:string){
 const page={id:pageId,episodeId:pageId,pageNumber:1,layoutConfig:{},storySourceSceneIds:[],storyPagePurpose:null,storyContinuityNote:null,dialogueMode:'mixed',pageDialogueToggle:true,generationMode:'standard',generatedImage:{s3Key:`session/${userId}/pages/${pageId}/${jobId}.png`,cdnUrl:'https://images.example.invalid/image',generationMode:'standard',generatedAt:'2026-10-01T00:00:00Z',...(model?{imageModel:model}:{})},status:'generated',panelCount:1,frameCount:1,balloonCount:0,createdAt:new Date(),updatedAt:new Date()};
 const loadByS3Key=vi.fn(async()=>({imageData:Buffer.from('image'),mimeType:'image/png' as const}));
 const service=new PageExportService({findPageByIdAndUserId:async()=>page} as never,{loadByS3Key});
 const app=handleErrors(createPageRoutes({authMiddleware:auth(client),rateLimitMiddleware:passthrough,pageQueryService:{listEpisodePages:async()=>[page],getPage:async()=>page},pageExportService:service,pageThumbnailService:new PageThumbnailService({findPageByIdAndUserId:async()=>page} as never,{loadByS3Key},{render:async()=>({imageData:Buffer.from('webp'),mimeType:'image/webp'})})} as unknown as PageRouteDependencies));
 return {app,loadByS3Key,page};
}
describe('provenance routes',()=>{
 it('Mobile page一覧はWeb限定metadataを返しCDN署名を作らない',async()=>{
  // If this route even resolves the signer, the intentionally incomplete local
  // config throws. A successful metadata-only response proves it was bypassed.
  env.IMAGE_DELIVERY_MODE='cloudfront_signed';env.IMAGE_CDN_SIGNING_ENABLED=true;env.CLOUDFRONT_KEY_PAIR_ID=undefined;
  const {app}=pageRoutes('hy4-preview');const response=await app.request(`/episodes/${pageId}/pages`);expect(response.status).toBe(200);
  const body=await response.json();expect(body).toMatchObject({pages:[{generated_image:{image_model:'hy4-preview',mobile_access:'web_only'}}]});expect(body.pages[0].generated_image).not.toHaveProperty('cdn_url');expect(body.pages[0].generated_image).not.toHaveProperty('s3_key');
 });
 it('共通画像口と偽platformは拒否し認可Web口だけbytesを返す',async()=>{
  env.WEB_IMAGE_DELIVERY_COGNITO_CLIENT_IDS='web-client';
  for(const client of [undefined,'mobile-client']){const {app,loadByS3Key}=pageRoutes('hy4-preview',client);expect((await app.request(`/web/pages/${pageId}/image`,{headers:{'X-Client-Platform':'web','X-Client-Id':'web-client'}})).status).toBe(403);expect(loadByS3Key).not.toHaveBeenCalled();}
  const web=pageRoutes('hy4-preview','web-client');expect((await web.app.request(`/pages/${pageId}/export-image`)).status).toBe(403);expect((await web.app.request(`/web/pages/${pageId}/image`)).status).toBe(200);expect(web.loadByS3Key).toHaveBeenCalledTimes(1);
  const unknown=pageRoutes('unregistered','web-client');expect((await unknown.app.request(`/web/pages/${pageId}/image`)).status).toBe(403);expect(unknown.loadByS3Key).not.toHaveBeenCalled();
 });
 it('availability literalはUUID routeより先に解決し組織候補画像queryでも実認可する',async()=>{
  const requireMembership=vi.fn(async()=>undefined),exportCandidateImage=vi.fn(async(_user:string,_entity:string,_key:string,_organizationId?:string|null)=>({imageData:Buffer.from('x'),mimeType:'image/png'}));
  const app=handleErrors(createEntityRoutes({authMiddleware:auth(),rateLimitMiddleware:passthrough,organizationService:{requireMembership},entityReferenceImageExportService:{exportCandidateImage}} as unknown as EntityRouteDependencies));
  const availability=await app.request(`/entities/reference-generation-availability?organization_id=${orgId}`);expect(availability.status).toBe(200);expect(await availability.json()).toHaveProperty('enabled');
  const url=`/entities/${entityId}/reference-candidate-image?organization_id=${orgId}&s3_key=${encodeURIComponent(`tmp/${userId}/entities/imports/image.png`)}`;
  expect((await app.request(url)).status).toBe(200);expect(requireMembership).toHaveBeenCalledWith(orgId,userId,'view_work');expect(exportCandidateImage.mock.calls[0]?.[3]).toBe(orgId);
  requireMembership.mockRejectedValueOnce(new ForbiddenError());expect((await app.request(url)).status).toBe(403);expect(exportCandidateImage).toHaveBeenCalledTimes(1);
 });
 it('raw keyと既発行candidate tokenの両方でrestricted/state出力を基本画像口から遮断する',async()=>{
  const key=`session/${userId}/entities/${entityId}/${jobId}-0.png`;
  const loadByS3Key=vi.fn(async()=>({imageData:Buffer.from('x'),mimeType:'image/png' as const}));
  const context={entityId,userId,referenceSet:{images:[]}};
  const findByIdAndUserId=vi.fn();const exporter=new EntityReferenceImageExportService({findReferenceContextByIdAndUserId:async()=>context} as never,{loadByS3Key},{findByIdAndUserId});
  const app=handleErrors(createEntityRoutes({authMiddleware:auth(),rateLimitMiddleware:passthrough,entityReferenceImageExportService:exporter} as unknown as EntityRouteDependencies));
  const token=createReferenceCandidateToken({userId,entityId,s3Key:key},{secret:env.REFERENCE_CANDIDATE_TOKEN_SECRET??env.SUPABASE_JWT_SECRET??'development-reference-candidate-token-secret'});
  findByIdAndUserId.mockResolvedValue({id:jobId,userId,organizationId:null,jobType:'entity_generate',status:'completed',params:{entity_id:entityId},result:{image_model:'gpt-image-2',candidates:[{s3_key:key}]}});
  expect((await app.request(`/entities/${entityId}/reference-candidate-image?candidate_token=${encodeURIComponent(token)}`)).status).toBe(200);
  loadByS3Key.mockClear();
  for(const target of [undefined,'entity_state']){
   findByIdAndUserId.mockResolvedValue({id:jobId,userId,organizationId:null,jobType:'entity_generate',status:'completed',params:{entity_id:entityId,...(target?{target}:{})},result:{image_model:target?'gpt-image-2':'hy4-preview',candidates:[{s3_key:key}]}});
   for(const query of [`s3_key=${encodeURIComponent(key)}`,`candidate_token=${encodeURIComponent(token)}`])expect((await app.request(`/entities/${entityId}/reference-candidate-image?${query}`)).status).toBe(target ? 404 : 403);
  }
  expect(loadByS3Key).not.toHaveBeenCalled();
 });
});


describe('production-compatible page reads',()=>{
 it('detailと19枠template一覧は既存wire形を返す',async()=>{
  const {app}=pageRoutes('hy4-preview');
  const detail=await app.request(`/pages/${pageId}`);expect(detail.status).toBe(200);expect(await detail.json()).toMatchObject({id:pageId,generated_image:{mobile_access:'web_only'}});
  const catalog=await app.request('/page-layout-templates');expect(catalog.status).toBe(200);const body=await catalog.json() as {templates:{id:string;panel_count:number;frames:unknown[];reading_direction:string}[]};expect(body.templates).toHaveLength(19);for(const template of body.templates){expect(template.frames).toHaveLength(template.panel_count);expect(template.reading_direction).toBe('right_to_left_top_to_bottom');}
 });
 it('thumbnailはWebP/private cache/ETagを返し304より前に再認可とprovenance確認する',async()=>{
  const {app,loadByS3Key,page}=pageRoutes('gpt-image-2');
  const first=await app.request(`/pages/${pageId}/thumbnail`);expect(first.status).toBe(200);expect(first.headers.get('Content-Type')).toBe('image/webp');expect(first.headers.get('Cache-Control')).toBe('private, max-age=300');expect(first.headers.get('Vary')).toBe('Authorization');
  const etag=first.headers.get('ETag')!;expect(etag).toMatch(/^"page-thumbnail-[0-9a-f]{24}"$/);expect((await app.request(`/pages/${pageId}/thumbnail`,{headers:{'If-None-Match':etag}})).status).toBe(304);expect(loadByS3Key).toHaveBeenCalledTimes(1);
  page.generatedImage.imageModel='hy4-preview';expect((await app.request(`/pages/${pageId}/thumbnail`,{headers:{'If-None-Match':etag}})).status).toBe(403);expect(loadByS3Key).toHaveBeenCalledTimes(1);
 });
});
