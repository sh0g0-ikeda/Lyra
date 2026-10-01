import { createHash } from 'node:crypto';
import { ConflictError, NotFoundError, ValidationError } from '../domain/errors/index.js';
import { calculateQuotePrice, fingerprintQuoteInput, GENERATION_QUOTE_PRICING_VERSION, validateQuoteSelection } from '../domain/generation/GenerationQuotePolicy.js';
import { ENTITY_REFERENCE_UPLOAD_PURPOSE, imageDataMatchesEntityReferenceUploadMimeType } from '../domain/constants/entityReferenceUpload.js';
import { computeStateReferenceFingerprint } from '../domain/state/StateReferenceFingerprint.js';
import { isReadyEntityStateReferenceContext } from '../domain/types/entityStateReference.js';
import type { GenerationQuote, GenerationQuotePlan, GenerationQuoteRequest, GenerationQuoteSnapshot, PreparedGenerationQuoteSource, QuotedImportSource, QuotedCandidateSource } from '../domain/types/generationQuote.js';
import { OPENAI_INPUT_IMAGE_MAX_BYTES } from '../domain/constants/imageInput.js';
import type { StoredImageLoaderPort } from '../infrastructure/aws/S3StoredImageLoader.js';
import type { DatabaseClient } from '../lib/db.js';
import { ModeSelector } from '../services/page/ModeSelector.js';
import { PromptBuilder } from '../services/page/PromptBuilder.js';
import { OrganizationService } from '../services/organization/OrganizationService.js';
import type { EntityReferenceUploadStoragePort } from '../services/entity/EntityReferenceUploadStorage.js';
import { ensureAllowedReferenceSourceKey } from '../services/entity/EntityReferenceSourceKeyPolicy.js';
import { ensureOwnedEntityReferenceImageKey } from '../services/storage/StoredImageKeyPolicy.js';
import { PostgresPageRepository } from './PageRepository.js';
import { PostgresPanelRepository } from './PanelRepository.js';
import { PostgresEntityRepository } from './EntityRepository.js';
import { PostgresEntityStateReferenceRepository } from './EntityStateReferenceRepository.js';
import { PostgresCompositionGalleryRepository } from './CompositionGalleryRepository.js';
import { PostgresOrganizationRepository } from './OrganizationRepository.js';
import { PostgresEntityReferenceUploadTokenRepository } from './EntityReferenceUploadTokenRepository.js';
import { lockStoryEpisodeAdmission } from './StoryEpisodeAdmissionLock.js';
import { bindTransaction } from './TransactionBoundDatabase.js';

export interface GenerationQuotePlanResolver {
  prepare(client: DatabaseClient,userId:string,organizationId:string|null,request:GenerationQuoteRequest):Promise<PreparedGenerationQuoteSource>;
  resolve(client:DatabaseClient,userId:string,organizationId:string|null,request:GenerationQuoteRequest,prepared:PreparedGenerationQuoteSource):Promise<GenerationQuotePlan>;
  persistAdmission(client:DatabaseClient,quote:GenerationQuote,jobId:string):Promise<void>;
}
export interface GenerationQuotePlanResolverOptions {
  imageModel:string; generationEnabled:boolean; stateGenerationEnabled:boolean; importEnabled:boolean;
  pageGenerationEnabled?:boolean; entityGenerationEnabled?:boolean;
  uploadStorage?:EntityReferenceUploadStoragePort;
  candidateImageLoader?:StoredImageLoaderPort;
}

export class PostgresGenerationQuotePlanResolver implements GenerationQuotePlanResolver {
  public constructor(private readonly options:GenerationQuotePlanResolverOptions){}
  public async prepare(client:DatabaseClient,userId:string,organizationId:string|null,request:GenerationQuoteRequest):Promise<PreparedGenerationQuoteSource>{
    if(request.operation==='entity_preview' && request.sourceCandidate!==undefined){
      const candidate=request.sourceCandidate;
      if(candidate.expiresAt<=Date.now() || !this.options.candidateImageLoader) throw new ValidationError('Source candidate expired or is unavailable');
      const entityId=requireTarget(request);
      if(!await new PostgresEntityRepository(client).findReferenceContextByIdAndUserId(entityId,userId,organizationId)) throw new NotFoundError('Entity not found');
      ensureAllowedReferenceSourceKey(candidate.s3Key,userId,entityId);
      const image=await this.options.candidateImageLoader.loadByS3Key(candidate.s3Key);
      if((image.mimeType!=='image/png' && image.mimeType!=='image/jpeg' && image.mimeType!=='image/webp') || image.imageData.length===0
        || image.imageData.length>OPENAI_INPUT_IMAGE_MAX_BYTES || !imageDataMatchesEntityReferenceUploadMimeType(image.imageData,image.mimeType)) throw new ValidationError('Source candidate image is invalid');
      return {kind:'candidate',s3Key:candidate.s3Key,expiresAt:candidate.expiresAt,mimeType:image.mimeType,sizeBytes:image.imageData.length,sha256:createHash('sha256').update(image.imageData).digest('hex')};
    }
    if(request.operation!=='entity_import_analysis') return null;
    if(!this.options.importEnabled || !this.options.uploadStorage) throw new ConflictError('Quoted import analysis is unavailable');
    if(!request.uploadTokenHash || !request.entityType) throw new ValidationError('A verified upload token and entity type are required');
    const token=await new PostgresEntityReferenceUploadTokenRepository(client).inspect({tokenHash:request.uploadTokenHash,userId,organizationId,purpose:ENTITY_REFERENCE_UPLOAD_PURPOSE});
    if(!token || (request.entityId!==undefined && request.entityId!==token.entityId)) throw new NotFoundError('Import upload not found');
    ensureAllowedReferenceSourceKey(token.s3Key,userId,token.entityId ?? '');
    const loaded=await this.options.uploadStorage.loadUploadedImage({s3Key:token.s3Key,mimeType:token.mimeType,sizeBytes:token.sizeBytes});
    if(!loaded || loaded.imageData.length!==token.sizeBytes || loaded.mimeType!==token.mimeType || !imageDataMatchesEntityReferenceUploadMimeType(loaded.imageData,loaded.mimeType)) {
      throw new ValidationError('Import upload does not match its approved metadata');
    }
    return {uploadId:token.id,tokenHash:token.tokenHash,s3Key:token.s3Key,mimeType:token.mimeType,sizeBytes:token.sizeBytes,eTag:loaded.eTag,
      sha256:createHash('sha256').update(loaded.imageData).digest('hex'),entityId:token.entityId};
  }
  public async resolve(client:DatabaseClient,userId:string,organizationId:string|null,request:GenerationQuoteRequest,prepared:PreparedGenerationQuoteSource):Promise<GenerationQuotePlan>{
    try {
      await this.lockScope(client,userId,organizationId);
      const selection=validateQuoteSelection(request,this.options.imageModel);
      if(request.operation==='entity_import_analysis') return await this.resolveImport(client,userId,organizationId,request,prepared!==null && 'uploadId' in prepared ? prepared:null,selection);
      if(!this.options.generationEnabled) throw new ConflictError('Generation is temporarily disabled');
      if(request.operation==='page_generate' || request.operation==='page_regenerate') return await this.resolvePage(client,userId,organizationId,request,selection);
      return await this.resolveEntity(client,userId,organizationId,request,selection,prepared!==null && 'kind' in prepared ? prepared:null);
    } catch(error) {
      if(typeof error==='object' && error!==null && 'code' in error && (error.code==='55P03' || error.code==='40P01')) {
        throw new ConflictError('Generation inputs are being edited; request a fresh quote');
      }
      throw error;
    }
  }
  private async resolvePage(client:DatabaseClient,userId:string,organizationId:string|null,request:GenerationQuoteRequest,selection:Selection):Promise<GenerationQuotePlan>{
    if(this.options.pageGenerationEnabled===false) throw new ConflictError('Page generation is temporarily disabled');
    const targetId=requireTarget(request);
    const initial=await client.query<{episode_id:string}>(`SELECT p.episode_id FROM pages p JOIN episodes e ON e.id=p.episode_id JOIN chapters c ON c.id=e.chapter_id JOIN works w ON w.id=c.work_id
      WHERE p.id=$1::uuid AND (($3::uuid IS NULL AND w.user_id=$2::uuid AND w.organization_id IS NULL) OR ($3::uuid IS NOT NULL AND w.organization_id=$3::uuid))`,[targetId,userId,organizationId]);
    const episodeId=initial.rows[0]?.episode_id;
    if(!episodeId) throw new NotFoundError('Page not found');
    await lockStoryEpisodeAdmission(client,episodeId);
    await client.query('SELECT id FROM episodes WHERE id=$1::uuid FOR UPDATE',[episodeId]);
    await client.query('SELECT id FROM pages WHERE id=$1::uuid FOR UPDATE',[targetId]);
    await client.query('SELECT id FROM panels WHERE page_id=$1::uuid ORDER BY id FOR UPDATE',[targetId]);
    await client.query('SELECT id FROM panel_frames WHERE page_id=$1::uuid ORDER BY id FOR SHARE',[targetId]);
    await client.query('SELECT id FROM scenes WHERE episode_id=$1::uuid ORDER BY id FOR SHARE',[episodeId]);
    const bound=bindTransaction(client); const pageRepository=new PostgresPageRepository(bound);
    const page=await pageRepository.findGenerationContextByIdAndUserId(targetId,userId,organizationId);
    if(!page) throw new NotFoundError('Page not found');
    const savedPanels=await new PostgresPanelRepository(bound).findPanelsByPageIdAndUserId(targetId,userId,organizationId);
    page.panels=savedPanels.map((panel)=>({panelId:panel.id,entities:panel.entities}));
    await this.lockWorkInputs(client,page.workId);
    if(page.status==='generating' || page.status==='confirmed') throw new ConflictError('Page is not editable for generation');
    if(page.panels.length===0 || page.frameCount!==page.panels.length) throw new ValidationError('Page panels and frames must match before generation');
    if((request.operation==='page_regenerate') !== (page.generatedImage!==null)) throw new ConflictError('Page generation kind changed; request a new quote');
    const active=await client.query(`SELECT id FROM generation_jobs WHERE status IN ('queued','processing') AND
      ((job_type='page_generate' AND params->>'page_id'=$1) OR (job_type IN ('episode_story_autofill','episode_page_skeleton') AND params->>'episode_id'=$2))`,[targetId,episodeId]);
    if(active.rows.length) throw new ConflictError('Page or episode generation is already active');
    const entities=new PostgresEntityRepository(bound);
    const profile=new ModeSelector().selectProfile({entityCount:new Set(page.panels.flatMap((panel)=>panel.entities.map((assignment)=>assignment.entityId))).size,
      panelCount:page.panels.length,requestKind:request.operation==='page_regenerate'?'regenerate':'initial',billableReferenceCount:0});
    const prompt=await new PromptBuilder(pageRepository,new PostgresPanelRepository(bound),entities,new PostgresCompositionGalleryRepository(bound)).buildPagePrompt({
      userId,organizationId,pageId:targetId,requestKind:profile.requestKind,generationMode:profile.mode,renderStyle:selection.renderStyle ?? 'color'});
    const references=prompt.inputSnapshot.references ?? [];
    const assignments=Array.from(new Map(page.panels.flatMap((panel)=>panel.entities.map((assignment)=>[
      `${assignment.entityId}:${assignment.stateId ?? 'default'}`,{entityId:assignment.entityId,stateId:assignment.stateId},
    ] as const))).values());
    const resolvedReferences=await entities.findResolvedReferenceImagesByAssignmentsAndUserId(assignments,page.workId,userId,organizationId);
    for(const reference of resolvedReferences){
      if(reference.s3Key!==null && reference.refId!==null){
        if(reference.ownerUserId===null) throw new ValidationError('Reference storage owner is unavailable');
        ensureOwnedEntityReferenceImageKey(reference.s3Key,reference.ownerUserId,reference.entityId);
      }
    }
    const assigned=new Set(page.panels.flatMap((panel)=>panel.entities.map((assignment)=>assignment.entityId)));
    const characters=(await entities.findByWorkIdAndUserId(page.workId,userId,organizationId)).filter((entity)=>entity.entityType==='character' && assigned.has(entity.id));
    if(characters.some((entity)=>!references.some((reference)=>reference.entityId===entity.id))) throw new ValidationError('Confirm assigned character references before generation');
    const snapshot:GenerationQuoteSnapshot={kind:'page',prompt,layoutConfig:page.layoutConfig};
    return plan(request,selection,{targetId,workId:page.workId,referenceCount:references.length,generationMode:profile.mode,snapshot,
      jobParams:{page_id:targetId,work_id:page.workId,request_kind:profile.requestKind,generation_mode:profile.mode,quality:selection.quality,
        requires_planner:profile.requiresPlanner,previous_page_status:page.status,previous_generation_mode:page.generationMode,render_style:selection.renderStyle}});
  }
  private async resolveEntity(client:DatabaseClient,userId:string,organizationId:string|null,request:GenerationQuoteRequest,selection:Selection,candidate:QuotedCandidateSource|null):Promise<GenerationQuotePlan>{
    if(this.options.entityGenerationEnabled===false) throw new ConflictError('Entity generation is temporarily disabled');
    const statePreview=request.operation==='entity_state_preview';
    if(statePreview && !this.options.stateGenerationEnabled) throw new ConflictError('State reference generation is temporarily disabled');
    const targetId=requireTarget(request);
    let entityId=targetId;
    if(statePreview){
      const state=await client.query<{entity_id:string}>('SELECT entity_id FROM entity_states WHERE id=$1::uuid',[targetId]);
      if(!state.rows[0] || (request.entityId!==undefined && request.entityId!==state.rows[0].entity_id)) throw new NotFoundError('Entity state not found');
      entityId=state.rows[0].entity_id;
    }
    const bound=bindTransaction(client); const entityRepository=new PostgresEntityRepository(bound);
    const initial=await entityRepository.findReferenceContextByIdAndUserId(entityId,userId,organizationId);
    if(!initial) throw new NotFoundError('Entity not found');
    await this.lockWorkInputs(client,initial.workId);
    const entity=await entityRepository.findReferenceContextByIdAndUserId(entityId,userId,organizationId);
    if(!entity) throw new NotFoundError('Entity not found');
    const active=await client.query(`SELECT id FROM generation_jobs WHERE job_type='entity_generate' AND params->>'entity_id'=$1 AND status IN ('queued','processing')`,[entityId]);
    if(active.rows.length) throw new ConflictError('Entity reference generation is already active');
    if(request.sourceCandidate!==undefined){
      if(statePreview || candidate===null || candidate.expiresAt<=Date.now() || candidate.s3Key!==request.sourceCandidate.s3Key) throw new ConflictError('Source candidate changed or expired');
      ensureAllowedReferenceSourceKey(candidate.s3Key,userId,entityId);
      return plan(request,selection,{targetId,workId:entity.workId,referenceCount:1,generationMode:null,
        snapshot:{kind:'entity',entity,state:null,sourceS3Key:candidate.s3Key,sourceImage:candidate},
        jobParams:{entity_id:entityId,entity_type:entity.entityType,previous_entity_status:entity.status,source_s3_key:candidate.s3Key}});
    }
    if(statePreview){
      const state=await new PostgresEntityStateReferenceRepository(bound).findContextByIdAndUserId(entityId,targetId,userId,organizationId);
      if(!state || !isReadyEntityStateReferenceContext(state)) throw new ConflictError('Confirm a base reference and complete the state before preview');
      ensureOwnedEntityReferenceImageKey(state.baseReference.s3Key,state.baseReference.storageOwnerUserId,entityId);
      return plan(request,selection,{targetId,workId:entity.workId,referenceCount:1,generationMode:null,
        snapshot:{kind:'entity',entity,state,sourceS3Key:null},jobParams:{target:'entity_state',entity_id:entityId,entity_type:entity.entityType,
          previous_entity_status:entity.status,entity_state_id:targetId,base_primary_ref_id:state.baseReference.refId,
          state_input_fingerprint:computeStateReferenceFingerprint({entityId,stateId:targetId,name:state.stateName,description:state.stateDescription,baseRefId:state.baseReference.refId}),
          state_revision:state.stateRevision,state_name:state.stateName,state_description:state.stateDescription}});
    }
    const source=request.sourceRefId===undefined ? null : entity.referenceSet.images.find((image)=>image.refId===request.sourceRefId);
    if(source===undefined) throw new ValidationError('Selected source reference is not confirmed for this entity');
    if(source) ensureOwnedEntityReferenceImageKey(source.s3Key,entity.userId,entityId);
    return plan(request,selection,{targetId,workId:entity.workId,referenceCount:source ? 1:0,generationMode:null,
      snapshot:{kind:'entity',entity,state:null,sourceS3Key:source?.s3Key ?? null},jobParams:{entity_id:entityId,entity_type:entity.entityType,previous_entity_status:entity.status,
        ...(source ? {source_s3_key:source.s3Key}: {})}});
  }
  private async resolveImport(client:DatabaseClient,userId:string,organizationId:string|null,request:GenerationQuoteRequest,source:QuotedImportSource|null,selection:Selection):Promise<GenerationQuotePlan>{
    if(!this.options.importEnabled || !source || !request.entityType) throw new ConflictError('Quoted import analysis is unavailable');
    await client.query('SELECT id FROM entity_reference_upload_tokens WHERE id=$1::uuid FOR UPDATE',[source.uploadId]);
    const upload=await new PostgresEntityReferenceUploadTokenRepository(client).inspect({tokenHash:source.tokenHash,userId,organizationId,purpose:ENTITY_REFERENCE_UPLOAD_PURPOSE});
    if(!upload || upload.id!==source.uploadId || upload.s3Key!==source.s3Key || upload.sizeBytes!==source.sizeBytes || upload.mimeType!==source.mimeType) throw new ConflictError('Import upload changed or expired');
    let workId:string|null=null;
    if(upload.entityId!==null){
      const entityRepository=new PostgresEntityRepository(bindTransaction(client));
      const initial=await entityRepository.findReferenceContextByIdAndUserId(upload.entityId,userId,organizationId);
      if(!initial) throw new NotFoundError('Entity not found');
      await this.lockWorkInputs(client,initial.workId);
      const entity=await entityRepository.findReferenceContextByIdAndUserId(upload.entityId,userId,organizationId);
      if(!entity || entity.entityType!==request.entityType) throw new ConflictError('Import entity changed');
      workId=entity.workId;
    }
    return plan(request,selection,{targetId:source.uploadId,workId,referenceCount:1,generationMode:null,
      snapshot:{kind:'import',source,entityType:request.entityType},jobParams:{upload_id:source.uploadId,entity_id:source.entityId,entity_type:request.entityType,source_s3_key:source.s3Key}});
  }
  public async persistAdmission(client:DatabaseClient,quote:GenerationQuote,jobId:string):Promise<void>{
    const snapshot=quote.plan.snapshot;
    if(snapshot.kind==='page'){
      const result=await client.query(`UPDATE pages SET status='generating',generation_mode=$2,updated_at=NOW() WHERE id=$1::uuid AND status=$3 RETURNING id`,
        [quote.plan.targetId,quote.plan.generationMode,quote.plan.jobParams.previous_page_status]);
      if(result.rows.length!==1) throw new ConflictError('Page state changed during generation admission');
      await client.query(`UPDATE generation_jobs SET result=jsonb_build_object('input_snapshot',$2::jsonb) WHERE id=$1::uuid`,[jobId,JSON.stringify(snapshot.prompt.inputSnapshot)]);
    }else if(snapshot.kind==='import'){
      const result=await new PostgresEntityReferenceUploadTokenRepository(client).consume({tokenHash:snapshot.source.tokenHash,userId:quote.userId,organizationId:quote.organizationId,purpose:ENTITY_REFERENCE_UPLOAD_PURPOSE});
      if(!result || result.id!==snapshot.source.uploadId) throw new ConflictError('Import upload was already consumed');
    }
  }
  private async lockScope(client:DatabaseClient,userId:string,organizationId:string|null):Promise<void>{
    if(organizationId===null) return;
    await client.query('SELECT id FROM organizations WHERE id=$1::uuid FOR SHARE',[organizationId]);
    await client.query('SELECT user_id FROM organization_members WHERE organization_id=$1::uuid AND user_id=$2::uuid FOR SHARE',[organizationId,userId]);
    const bound=bindTransaction(client);
    await new OrganizationService(new PostgresOrganizationRepository(bound,bound)).requireMembership(organizationId,userId,'generate',client);
  }
  private async lockWorkInputs(client:DatabaseClient,workId:string):Promise<void>{
    // Legacy reference confirmation locks reference_set before entity, while
    // deletion takes the reverse order. Fail closed instead of waiting in a cycle.
    await client.query('SELECT id FROM works WHERE id=$1::uuid FOR SHARE NOWAIT',[workId]);
    await client.query('SELECT id FROM entities WHERE work_id=$1::uuid ORDER BY id FOR UPDATE NOWAIT',[workId]);
    await client.query('SELECT r.entity_id FROM reference_sets r JOIN entities e ON e.id=r.entity_id WHERE e.work_id=$1::uuid ORDER BY r.entity_id FOR SHARE OF r NOWAIT',[workId]);
    await client.query('SELECT s.id FROM entity_states s JOIN entities e ON e.id=s.entity_id WHERE e.work_id=$1::uuid ORDER BY s.id FOR SHARE OF s NOWAIT',[workId]);
  }
}
type Selection=Pick<GenerationQuotePlan,'imageModel'|'providerModelId'|'quality'|'renderStyle'>;
function plan(request:GenerationQuoteRequest,selection:Selection,details:Pick<GenerationQuotePlan,'targetId'|'workId'|'referenceCount'|'generationMode'|'snapshot'|'jobParams'>):GenerationQuotePlan{
  return {...details,...selection,operation:request.operation,inputRevision:fingerprintQuoteInput(details.snapshot),pricingVersion:GENERATION_QUOTE_PRICING_VERSION,
    amountCredits:calculateQuotePrice(request.operation,details.referenceCount)};
}
function requireTarget(request:GenerationQuoteRequest):string{if(!request.targetId) throw new ValidationError('Generation target is required');return request.targetId;}
