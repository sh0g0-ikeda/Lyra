import { ConfigurationError, NotFoundError } from '../../domain/errors/index.js';
import { createHash } from 'node:crypto';
import { OPENAI_INPUT_IMAGE_MAX_BYTES } from '../../domain/constants/imageInput.js';
import { fingerprintQuoteInput, GENERATION_QUOTE_PRICING_VERSION } from '../../domain/generation/GenerationQuotePolicy.js';
import type { GenerationJob } from '../../domain/types/job.js';
import type { GenerationQuote, GenerationQuoteSnapshot } from '../../domain/types/generationQuote.js';
import type { PageGenerationInputImage } from '../../domain/types/pageGeneration.js';
import type { DatabaseClient, TransactionRunner } from '../../lib/db.js';
import { PostgresGenerationQuoteRepository } from '../../repositories/GenerationQuoteRepository.js';
import { PostgresPageRepository } from '../../repositories/PageRepository.js';
import { PostgresEntityRepository } from '../../repositories/EntityRepository.js';
import { PostgresEntityStateReferenceRepository } from '../../repositories/EntityStateReferenceRepository.js';
import type { StoredImageLoaderPort } from '../../infrastructure/aws/S3StoredImageLoader.js';
import type { LayoutGuideImageRendererPort } from '../page/LayoutGuideImageRenderer.js';
import type { PageGenerationLayoutControl } from '../../domain/types/pageGenerationLayout.js';
import type { BuiltPagePrompt } from '../page/PromptBuilder.js';
import { ensureOwnedEntityReferenceImageKey } from '../storage/StoredImageKeyPolicy.js';
import { ensureAllowedReferenceSourceKey } from '../entity/EntityReferenceSourceKeyPolicy.js';

export interface QuotedPageInputs { prompt: BuiltPagePrompt; inputImages: PageGenerationInputImage[] }
export interface QuotedEntityInputs { snapshot: Extract<GenerationQuoteSnapshot,{kind:'entity'}>; inputImages:Array<{dataUrl:string}> }
export interface QuotedGenerationInputsPort {
  page(job:GenerationJob):Promise<QuotedPageInputs>;
  entity(job:GenerationJob):Promise<QuotedEntityInputs>;
}

/** Accepted quote contents are the execution input, not a hint to reread current drafts. */
export class QuotedGenerationInputs implements QuotedGenerationInputsPort {
  public constructor(private readonly database:DatabaseClient & TransactionRunner,private readonly imageModel:string,
    private readonly loader:StoredImageLoaderPort,private readonly layoutRenderer:LayoutGuideImageRendererPort){}
  public async page(job:GenerationJob):Promise<QuotedPageInputs>{
    const quote=await this.requireQuote(job);
    const snapshot=quote.plan.snapshot;
    if(snapshot.kind!=='page' || job.jobType!=='page_generate') throw new ConfigurationError('Quoted generation operation mismatch');
    if(!await new PostgresPageRepository(this.database).findGenerationContextByIdAndUserId(quote.plan.targetId,job.userId,job.organizationId ?? null)) throw new NotFoundError('Quoted page is no longer available');
    if(job.params.quality!==quote.plan.quality || job.params.render_style!==quote.plan.renderStyle || job.generationMode!==quote.plan.generationMode) throw new ConfigurationError('Quoted page options changed');
    const images:PageGenerationInputImage[]=[];
    for(const reference of snapshot.prompt.inputSnapshot.references ?? []){
      images.push({role:'entity_reference',label:reference.subjectLabel,dataUrl:await this.load(reference.s3Key,reference.entityId),
        reference:{entityId:reference.entityId,stateId:reference.stateId,refId:reference.refId,s3Key:reference.s3Key,imageModel:reference.imageModel,subjectLabel:reference.subjectLabel}});
    }
    // New quotes freeze one resolved map. Omitted control means an old quote:
    // retain its original unnumbered custom guide without reading live geometry.
    const layout=renderQuotedLayoutGuide(snapshot.prompt.layoutControl,snapshot.layoutConfig,this.layoutRenderer);
    if(layout){
      if(layout.imageData.length===0 || layout.imageData.length>OPENAI_INPUT_IMAGE_MAX_BYTES) throw new ConfigurationError('Quoted layout guide size is invalid');
      images.push({role:'layout_reference',label:'page-layout-reference',dataUrl:`data:${layout.mimeType};base64,${layout.imageData.toString('base64')}`});
    }
    return {prompt:snapshot.prompt,inputImages:images};
  }
  public async entity(job:GenerationJob):Promise<QuotedEntityInputs>{
    const quote=await this.requireQuote(job);const snapshot=quote.plan.snapshot;
    if(snapshot.kind!=='entity' || job.jobType!=='entity_generate') throw new ConfigurationError('Quoted generation operation mismatch');
    if(!await new PostgresEntityRepository(this.database).findReferenceContextByIdAndUserId(snapshot.entity.entityId,job.userId,job.organizationId ?? null)) throw new NotFoundError('Quoted entity is no longer available');
    if(snapshot.state!==null){
      const current=await new PostgresEntityStateReferenceRepository(this.database).findContextByIdAndUserId(
        snapshot.entity.entityId,snapshot.state.stateId,job.userId,job.organizationId ?? null,
      );
      if(current===null || current.stateRevision!==snapshot.state.stateRevision || current.baseReference?.refId!==snapshot.state.baseReference.refId) {
        throw new ConfigurationError('Quoted state reference changed before execution');
      }
    }
    const key=snapshot.state?.baseReference.s3Key ?? snapshot.sourceS3Key;
    if(snapshot.sourceImage!==undefined){
      const expected=snapshot.sourceImage;
      if(key!==expected.s3Key) throw new ConfigurationError('Quoted source candidate mismatch');
      ensureAllowedReferenceSourceKey(expected.s3Key,job.userId,snapshot.entity.entityId);
      const image=await this.loader.loadByS3Key(expected.s3Key);
      if(image.mimeType!==expected.mimeType || image.imageData.length!==expected.sizeBytes
        || createHash('sha256').update(image.imageData).digest('hex')!==expected.sha256) throw new ConfigurationError('Quoted source candidate changed before execution');
      return {snapshot,inputImages:[{dataUrl:`data:${image.mimeType};base64,${image.imageData.toString('base64')}`}]};
    }
    const inputImages=key===null ? []:[{dataUrl:await this.load(key,snapshot.entity.entityId)}];
    return {snapshot,inputImages};
  }
  private async requireQuote(job:GenerationJob):Promise<GenerationQuote>{
    const quote=await new PostgresGenerationQuoteRepository(this.database).findAcceptedJob(job.id);
    assertQuotedJobMatches(job,quote,this.imageModel);
    const actor=await this.database.query<{active:boolean}>(`SELECT (account_deletion_started_at IS NULL AND account_deleted_at IS NULL) AS active FROM users WHERE id=$1::uuid`,[job.userId]);
    if(actor.rows[0]?.active!==true) throw new ConfigurationError('Quoted account is no longer available');
    return quote;
  }
  private async load(key:string,entityId:string):Promise<string>{
    const owner=key.split('/')[1];
    if(!owner) throw new ConfigurationError('Quoted reference owner is unavailable');
    ensureOwnedEntityReferenceImageKey(key,owner,entityId);
    const image=await this.loader.loadByS3Key(key);
    if(image.imageData.length===0 || image.imageData.length>OPENAI_INPUT_IMAGE_MAX_BYTES) throw new ConfigurationError('Quoted reference image size is invalid');
    return `data:${image.mimeType};base64,${image.imageData.toString('base64')}`;
  }
}
export function hasGenerationQuote(job:GenerationJob):boolean{return Object.prototype.hasOwnProperty.call(job.params,'quote_id');}
export function assertQuotedJobMatches(job:GenerationJob,quote:GenerationQuote,configuredModel:string):void{
  const persistedOptions=Object.fromEntries(Object.keys(quote.plan.jobParams).map((key)=>[key,job.params[key]]));
  if(job.params.quote_id!==quote.id || quote.acceptedJobId!==job.id || quote.userId!==job.userId || quote.organizationId!==(job.organizationId ?? null)
    || fingerprintQuoteInput(persistedOptions)!==fingerprintQuoteInput(quote.plan.jobParams) || job.params.image_model!==quote.plan.imageModel
    || job.creditCost!==quote.plan.amountCredits || job.params.quoted_input_revision!==quote.plan.inputRevision
    || fingerprintQuoteInput(quote.plan.snapshot)!==quote.plan.inputRevision || job.params.provider_model_id!==quote.plan.providerModelId
    || quote.plan.providerModelId!==configuredModel || job.params.pricing_version!==quote.plan.pricingVersion
    || quote.plan.pricingVersion!==GENERATION_QUOTE_PRICING_VERSION){
    throw new ConfigurationError('Accepted generation quote is stale or unavailable; no model fallback is allowed');
  }
}

export function renderQuotedLayoutGuide(control: PageGenerationLayoutControl | null | undefined, legacyLayoutConfig: Record<string,unknown>, renderer: LayoutGuideImageRendererPort) {
  if(control===undefined) return legacyLayoutConfig.type==='custom' ? renderer.render(legacyLayoutConfig.frame_definitions) : null;
  if(control===null) return null;
  const image=renderer.render(control.frames,{numberFrames:true});
  if(image===null) throw new ConfigurationError('Quoted layout guide could not be rendered');
  return image;
}
