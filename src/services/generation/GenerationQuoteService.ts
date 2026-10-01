import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { ConflictError, ValidationError } from '../../domain/errors/index.js';
import { fingerprintQuoteInput, GENERATION_QUOTE_MAX_SNAPSHOT_BYTES, GENERATION_QUOTE_TTL_MS } from '../../domain/generation/GenerationQuotePolicy.js';
import type { GenerationQuote, GenerationQuoteReceipt, GenerationQuoteRequest, PreparedGenerationQuoteSource } from '../../domain/types/generationQuote.js';
import type { DatabaseClient, TransactionRunner } from '../../lib/db.js';
import { PostgresGenerationQuoteRepository } from '../../repositories/GenerationQuoteRepository.js';
import { PostgresGenerationJobRepository, isUniqueViolation } from '../../repositories/GenerationJobRepository.js';
import { PostgresCreditRepository } from '../../repositories/CreditRepository.js';
import { PostgresOrganizationRepository } from '../../repositories/OrganizationRepository.js';
import { PostgresQuotedImportExecutionRepository } from '../../repositories/QuotedImportExecutionRepository.js';
import { bindTransaction } from '../../repositories/TransactionBoundDatabase.js';
import type { GenerationQuotePlanResolver } from '../../repositories/GenerationQuotePlanResolver.js';
import { CreditService } from '../credit/CreditService.js';
import { OrganizationService } from '../organization/OrganizationService.js';
import { DEFAULT_GENERATION_CAPACITY_LIMITS, type GenerationCapacityLimits } from './GenerationCapacityGuard.js';

export interface GenerationQuoteDispatcherPort { dispatchQuote(quoteId: string): Promise<void> }
export interface GenerationQuoteServiceDependencies {
  database: DatabaseClient & TransactionRunner;
  resolver: GenerationQuotePlanResolver;
  enabled: boolean;
  capacityLimits?: GenerationCapacityLimits;
  dispatcher?: GenerationQuoteDispatcherPort;
}

/** A quote check and legacy enqueue are NOT atomic; all accepted writes share one client here. */
export class GenerationQuoteService {
  private readonly repository: PostgresGenerationQuoteRepository;
  public constructor(private readonly dependencies: GenerationQuoteServiceDependencies) {
    this.repository=new PostgresGenerationQuoteRepository(dependencies.database);
  }
  public async issue(userId: string, request: GenerationQuoteRequest, organizationId: string | null = null): Promise<{quote: GenerationQuote; quoteToken: string}> {
    this.ensureEnabled();
    await this.requireScope(this.dependencies.database,userId,organizationId);
    const prepared=await this.dependencies.resolver.prepare(this.dependencies.database,userId,organizationId,request);
    const quoteToken=randomBytes(32).toString('base64url');
    const quote=await this.dependencies.database.transaction(async(client)=>{
      await this.repository.lockActor(client,userId);
      const plan=await this.dependencies.resolver.resolve(client,userId,organizationId,request,prepared);
      if(request.expectedRevision !== undefined && request.expectedRevision !== plan.inputRevision) throw new ConflictError('Generation inputs changed; request a new quote');
      if(Buffer.byteLength(JSON.stringify(plan),'utf8')>GENERATION_QUOTE_MAX_SNAPSHOT_BYTES) throw new ValidationError('Generation quote snapshot is too large');
      const {expectedRevision: _expectedRevision,...storedRequest}=request;
      return this.repository.create(client,{id:randomUUID(),tokenHash:hashQuoteToken(quoteToken),userId,organizationId,
        request:storedRequest,plan,expiresAt:new Date(Math.min(Date.now()+GENERATION_QUOTE_TTL_MS,plan.snapshot.kind==='entity' && plan.snapshot.sourceImage!==undefined ? plan.snapshot.sourceImage.expiresAt : Infinity))});
    });
    return {quote,quoteToken};
  }
  public async accept(userId: string, quoteId: string, quoteToken: string, requestKey: string, organizationId: string | null = null): Promise<GenerationQuoteReceipt> {
    const initial=await this.repository.find(this.dependencies.database,userId,organizationId,quoteId,{tokenHash:hashQuoteToken(quoteToken)});
    let prepared:PreparedGenerationQuoteSource=null;
    if(initial.acceptedJobId===null){
      this.ensureEnabled();
      if(initial.expiresAt.getTime()<=Date.now()) throw new ConflictError('Generation quote expired; request a new quote');
      try{
        prepared=await this.dependencies.resolver.prepare(this.dependencies.database,userId,organizationId,initial.request);
      }catch(error){
        const current=await this.repository.find(this.dependencies.database,userId,organizationId,quoteId,{tokenHash:hashQuoteToken(quoteToken)});
        if(current.acceptedJobId===null || current.requestKey!==requestKey) throw error;
      }
    }
    let result: GenerationQuoteReceipt;
    try {
      result=await this.dependencies.database.transaction(async(client)=>{
        await this.repository.lockActor(client,userId);
        const quote=await this.repository.find(client,userId,organizationId,quoteId,{lock:true,tokenHash:hashQuoteToken(quoteToken)});
        await this.requireScope(client,userId,organizationId);
        if(quote.acceptedJobId !== null){
          if(quote.requestKey !== requestKey) throw new ConflictError('Quote already accepted; reconcile its existing receipt');
          return this.repository.receipt(client,userId,organizationId,quoteId);
        }
        this.ensureEnabled();
        if(quote.expiresAt.getTime()<=Date.now()) throw new ConflictError('Generation quote expired; request a new quote');
        await this.repository.assertUnusedRequestKey(client,quote,requestKey);
        await this.admit(client,quote,prepared,requestKey);
        return this.repository.receipt(client,userId,organizationId,quoteId);
      });
    } catch(error) {
      if(isUniqueViolation(error)) throw new ConflictError('Generation request is already admitted');
      throw error;
    }
    await this.dispatchSafely(quoteId);
    return result;
  }
  public async receipt(userId: string, quoteId: string, organizationId: string | null = null): Promise<GenerationQuoteReceipt> {
    let result=await this.dependencies.database.transaction(async(client)=>{
      await this.requireScope(client,userId,organizationId);
      return this.repository.receipt(client,userId,organizationId,quoteId);
    });
    if(result.quote.plan.operation==='entity_import_analysis' && result.quote.acceptedJobId!==null){
      await new PostgresQuotedImportExecutionRepository(this.dependencies.database).recoverExpired(1,result.quote.acceptedJobId);
      result=await this.repository.receipt(this.dependencies.database,userId,organizationId,quoteId);
    }
    if(result.quote.acceptedJobId !== null) await this.dispatchSafely(quoteId);
    return result;
  }
  private async admit(client: DatabaseClient, quote: GenerationQuote, prepared: PreparedGenerationQuoteSource, requestKey: string): Promise<void> {
    const bound=bindTransaction(client);
    const plan=quote.plan;
    const jobType=plan.operation === 'entity_import_analysis' ? 'entity_import_analysis'
      : plan.operation === 'page_generate' || plan.operation === 'page_regenerate' ? 'page_generate' : 'entity_generate';
    const job=await new PostgresGenerationJobRepository(bound).createWithAdmission({
      id:randomUUID(),userId:quote.userId,organizationId:quote.organizationId,jobType,
      generationMode:plan.generationMode,creditCost:plan.amountCredits,
      capacityLimits:this.dependencies.capacityLimits ?? DEFAULT_GENERATION_CAPACITY_LIMITS,
      params:{...plan.jobParams,quote_id:quote.id,image_model:plan.imageModel,provider_model_id:plan.providerModelId,
        pricing_version:plan.pricingVersion,quoted_input_revision:plan.inputRevision},
    },async(transactionClient)=>{
      const current=await this.dependencies.resolver.resolve(transactionClient,quote.userId,quote.organizationId,quote.request,prepared);
      if(quote.expiresAt.getTime()<=Date.now()) throw new ConflictError('Generation quote expired; request a new quote');
      if(fingerprintQuoteInput(current)!==fingerprintQuoteInput(plan)) throw new ConflictError('Generation inputs or price changed; request a new quote');
    });
    const description=`Quoted ${plan.operation}`;
    if(quote.organizationId === null){
      await new CreditService(new PostgresCreditRepository(bound,bound)).consumeCredits({userId:quote.userId,cost:plan.amountCredits,description,jobId:job.id});
    }else{
      await new OrganizationService(new PostgresOrganizationRepository(bound,bound)).consumeCredits({userId:quote.userId,organizationId:quote.organizationId,
        workId:plan.workId,cost:plan.amountCredits,description,jobId:job.id,eventType:plan.operation==='entity_import_analysis' ? 'entity_import.started' : jobType==='page_generate' ? 'generation.started' : 'entity_generation.started'});
    }
    await this.dependencies.resolver.persistAdmission(client,quote,job.id);
    await this.repository.markAccepted(client,quote.id,job.id,requestKey);
  }
  private async requireScope(client: DatabaseClient,userId: string,organizationId: string|null): Promise<void> {
    if(organizationId!==null){const bound=bindTransaction(client);await new OrganizationService(new PostgresOrganizationRepository(bound,bound)).requireMembership(organizationId,userId,'generate',client);}
  }
  private ensureEnabled():void {if(!this.dependencies.enabled) throw new ConflictError('Generation quotes are temporarily disabled');}
  private async dispatchSafely(quoteId:string):Promise<void>{
    try{await this.dependencies.dispatcher?.dispatchQuote(quoteId);}catch{/* Durable intent is retried; never roll back or refund a committed acceptance on queue uncertainty. */}
  }
}
export function hashQuoteToken(token:string):string{return createHash('sha256').update(token).digest('hex');}
