import { assessSavedPageGeneration, type PageGenerationReadinessResult } from './PageGenerationReadiness.js';
import { randomUUID } from 'node:crypto';
import { ConflictError, NotFoundError, PageReferenceModelIncompatibleError, PageStaleError, ValidationError } from '../../domain/errors/index.js';
import { fingerprintQuoteInput } from '../../domain/generation/GenerationQuotePolicy.js';
import type { GenerationQuotePlanResolver } from '../../repositories/GenerationQuotePlanResolver.js';
import type { DatabaseClient, TransactionRunner } from '../../lib/db.js';
import { PostgresGenerationQuoteRepository } from '../../repositories/GenerationQuoteRepository.js';
import { PostgresGenerationJobRepository } from '../../repositories/GenerationJobRepository.js';
import { PostgresPageRepository } from '../../repositories/PageRepository.js';
import { PostgresPanelRepository } from '../../repositories/PanelRepository.js';
import { PostgresPanelFrameRepository } from '../../repositories/PanelFrameRepository.js';
import { PostgresPanelEntityAssignmentRepository } from '../../repositories/PanelEntityAssignmentRepository.js';
import { PostgresEntityRepository } from '../../repositories/EntityRepository.js';
import { PostgresCompositionGalleryRepository } from '../../repositories/CompositionGalleryRepository.js';
import { PostgresOrganizationRepository } from '../../repositories/OrganizationRepository.js';
import { bindTransaction } from '../../repositories/TransactionBoundDatabase.js';
import { lockStoryEpisodeAdmission } from '../../repositories/StoryEpisodeAdmissionLock.js';
import { OrganizationService } from '../organization/OrganizationService.js';
import { GenerationQuoteService, type GenerationQuoteDispatcherPort } from '../generation/GenerationQuoteService.js';
import type { GenerationCapacityLimits } from '../generation/GenerationCapacityGuard.js';
import type { StyleReferenceCompilerPort } from '../style/StyleReferenceCompiler.js';
import { resolveStyleReferenceForPersistence } from '../style/styleReferencePersistence.js';
import { buildNextPageLayoutConfig } from './PageService.js';
import { PanelService } from './PanelService.js';
import { PanelFrameService } from './PanelFrameService.js';
import { PanelEntityAssignmentService } from './PanelEntityAssignmentService.js';
import type { SaveAndGeneratePageInput, SaveAndGeneratePageResult } from './PageSaveAndGenerate.js';
import type { PageSummary, UpdatePageSettingsInput } from '../../domain/types/page.js';

export interface PageAtomicGenerationServicePort {
  getGenerationReadiness(userId: string, pageId: string, organizationId?: string | null): Promise<PageGenerationReadinessResult>;
  saveAndGenerate(userId: string, pageId: string, input: SaveAndGeneratePageInput, organizationId?: string | null): Promise<SaveAndGeneratePageResult>;
}
interface Dependencies {
  database: DatabaseClient & TransactionRunner;
  resolver: GenerationQuotePlanResolver;
  generationEnabled: boolean;
  capacityLimits?: GenerationCapacityLimits;
  dispatcher?: GenerationQuoteDispatcherPort;
  styleCompiler?: StyleReferenceCompilerPort;
}
interface Receipt extends SaveAndGeneratePageResult { quoteId: string; bodyHash: string }

/**
 * Restores the shipped direct action, without enabling public quotes. Drafts,
 * saved-input validation, debit, immutable snapshot and durable dispatch receipt
 * share ONE transaction. Only the true outer commit may trigger dispatch.
 */
export class PageAtomicGenerationService implements PageAtomicGenerationServicePort {
  public constructor(private readonly dependencies: Dependencies) {}

  public async getGenerationReadiness(userId: string, pageId: string, organizationId: string | null = null): Promise<PageGenerationReadinessResult> {
    return assessSavedPageGeneration(this.dependencies.database, userId, pageId, organizationId, this.dependencies.generationEnabled);
  }

  public async saveAndGenerate(userId: string, pageId: string, input: SaveAndGeneratePageInput, organizationId: string | null = null): Promise<SaveAndGeneratePageResult> {
    validateInputShape(input);
    const bodyHash = fingerprintQuoteInput(input);
    const initialPage = await new PostgresPageRepository(this.dependencies.database).findPageByIdAndUserId(pageId, userId, organizationId);
    if (!initialPage) throw new NotFoundError('Page not found');
    // A replay never recompiles style or checks the obsolete expected revision.
    const previous = await findReceipt(this.dependencies.database, userId, pageId, organizationId, input.requestId);
    if (previous && previous.bodyHash !== bodyHash) throw new ConflictError('Idempotency key was already used for different page inputs');
    if (!previous && !this.dependencies.generationEnabled) throw new ConflictError('Generation is temporarily disabled');
    if (!previous && initialPage.updatedAt.getTime() !== new Date(input.expectedUpdatedAt).getTime()) throw new PageStaleError();
    const pageInput = previous ? input.page : await this.prepareStyle(initialPage, input.page);
    const receipt = await this.dependencies.database.transaction(async (client): Promise<Receipt> => {
      const bound = bindTransaction(client);
      await new PostgresGenerationQuoteRepository(bound).lockActor(client, userId);
      await requireScope(client, userId, organizationId);
      const pageRepository = new PostgresPageRepository(bound);
      const accessible = await pageRepository.findPageByIdAndUserId(pageId, userId, organizationId);
      if (!accessible) throw new NotFoundError('Page not found');
      const existing = await findReceipt(client, userId, pageId, organizationId, input.requestId);
      if (existing) {
        if (existing.bodyHash !== bodyHash) throw new ConflictError('Idempotency key was already used for different page inputs');
        return existing;
      }
      if (!this.dependencies.generationEnabled) throw new ConflictError('Generation is temporarily disabled');
      // Legacy job admission takes capacity -> episode -> page. Preserve this order.
      await new PostgresGenerationJobRepository(bound).lockCapacityForAtomicAdmission(client, userId, organizationId);
      if (organizationId !== null) {
        await client.query('SELECT id FROM organizations WHERE id=$1::uuid FOR SHARE', [organizationId]);
        await client.query('SELECT user_id FROM organization_members WHERE organization_id=$1::uuid AND user_id=$2::uuid FOR SHARE', [organizationId, userId]);
        await requireScope(client, userId, organizationId);
      }
      await lockStoryEpisodeAdmission(client, accessible.episodeId);
      await client.query('SELECT id FROM episodes WHERE id=$1::uuid FOR UPDATE', [accessible.episodeId]);
      await client.query('SELECT id FROM pages WHERE id=$1::uuid FOR UPDATE', [pageId]);
      await client.query('SELECT id FROM panels WHERE page_id=$1::uuid ORDER BY id FOR UPDATE', [pageId]);
      await client.query('SELECT id FROM panel_frames WHERE page_id=$1::uuid ORDER BY id FOR UPDATE', [pageId]);
      const current = await pageRepository.findPageByIdAndUserId(pageId, userId, organizationId);
      if (!current) throw new NotFoundError('Page not found');
      if (current.updatedAt.getTime() !== new Date(input.expectedUpdatedAt).getTime()) throw new PageStaleError();
      if (current.status === 'confirmed' || current.status === 'generating') throw new ConflictError('Page must be editable before generation');
      await this.saveDrafts(client, userId, pageId, organizationId, current, {...input, page: pageInput});
      const readiness = await assessSavedPageGeneration(client, userId, pageId, organizationId, true, false);
      if (readiness.blockers.some((blocker) => blocker.code === 'CHARACTER_REFERENCE_MODEL_INCOMPATIBLE')) {
        throw new PageReferenceModelIncompatibleError();
      }
      if (!readiness.ready) throw new ValidationError(`Page generation is blocked: ${readiness.blockers.map(blocker=>blocker.code).join(', ')}`);
      // The shared substrate performs canonical/state-reference resolution and
      // actual pricing against these transaction-visible saved inputs.
      const quotes = new GenerationQuoteService({database: bound, resolver: this.dependencies.resolver, enabled: true, capacityLimits: this.dependencies.capacityLimits});
      const issued = await quotes.issue(userId, {operation: current.generatedImage === null ? 'page_generate' : 'page_regenerate', targetId: pageId, renderStyle: input.renderStyle}, organizationId);
      const accepted = await quotes.accept(userId, issued.quote.id, issued.quoteToken, randomUUID(), organizationId);
      const jobId = accepted.quote.acceptedJobId;
      if (!jobId) throw new ConflictError('Generation receipt could not be committed');
      // The editor revision advances past the original page even if its clock
      // was ahead. Persist the exact receipt revision, never recompute on replay.
      const revision = await client.query<{updated_at: Date}>(`UPDATE pages SET updated_at=GREATEST(date_trunc('milliseconds',clock_timestamp()),date_trunc('milliseconds',$2::timestamptz)+INTERVAL '1 millisecond') WHERE id=$1::uuid RETURNING updated_at`, [pageId, current.updatedAt]);
      const pageRevision = revision.rows[0]?.updated_at.toISOString();
      if (!pageRevision) throw new ConflictError('Saved page revision is unavailable');
      const savedReceipt = await client.query(`UPDATE generation_jobs SET params=params || $2::jsonb WHERE id=$1::uuid RETURNING id`, [jobId, JSON.stringify({save_and_generate_request_id: input.requestId, save_and_generate_body_hash: bodyHash, expected_page_revision: input.expectedUpdatedAt, page_revision: pageRevision, language: input.language})]);
      if (savedReceipt.rows.length !== 1) throw new ConflictError('Atomic page receipt could not be saved');
      return {jobId, pageRevision, quoteId: issued.quote.id, bodyHash};
    });
    try { await this.dependencies.dispatcher?.dispatchQuote(receipt.quoteId); } catch { /* Durable dispatch remains pending; an uncertain queue response is never a second charge. */ }
    return {jobId: receipt.jobId, pageRevision: receipt.pageRevision};
  }

  private async prepareStyle(current: PageSummary, input: UpdatePageSettingsInput): Promise<UpdatePageSettingsInput> {
    if (input.styleReference === undefined) return input;
    const styleReference = await resolveStyleReferenceForPersistence({nextStyleReference: input.styleReference === null ? null : {...input.styleReference}, currentStyleReference: current.layoutConfig.style_reference, target: 'manga_page', compiler: this.dependencies.styleCompiler});
    return {...input, styleReference};
  }

  private async saveDrafts(client: DatabaseClient, userId: string, pageId: string, organizationId: string | null, current: PageSummary, input: SaveAndGeneratePageInput): Promise<void> {
    const bound = bindTransaction(client);
    const panels = new PostgresPanelRepository(bound);
    const frames = new PostgresPanelFrameRepository(bound);
    const entities = new PostgresEntityRepository(bound);
    const service = new PanelService(panels, entities, frames, new PostgresCompositionGalleryRepository(bound));
    const currentPanels = await panels.findPanelsByPageIdAndUserId(pageId,userId,organizationId);
    const requested = new Set(input.panels.map(panel=>panel.id));
    if (currentPanels.length !== requested.size || currentPanels.some(panel=>!requested.has(panel.id))) throw new ValidationError('Save and generate must include every current panel exactly once');
    const ordered = [...input.panels].sort((a,b)=>a.order-b.order);
    await service.reorderPanels(userId,pageId,ordered.map(panel=>panel.id),organizationId);
    const assignments = new PanelEntityAssignmentService(new PostgresPanelEntityAssignmentRepository(bound));
    for (const panel of ordered) {
      const {id,entities: selectedEntities,...fields} = panel;
      await service.updatePanel(userId,id,fields,organizationId);
      await assignments.replacePanelEntityAssignments(userId,id,selectedEntities,organizationId);
    }
    const layoutConfig = buildNextPageLayoutConfig(current,input.page);
    const saved = await new PostgresPageRepository(bound).updatePageSettings(pageId,userId,{...input.page,...(layoutConfig === undefined ? {} : {layoutConfig})},organizationId);
    if (!saved) throw new NotFoundError('Page not found');
    await new PanelFrameService(frames).replacePageFrames(userId,pageId,input.frames,organizationId);
  }
}

async function findReceipt(client: DatabaseClient, userId: string, pageId: string, organizationId: string | null, key: string): Promise<Receipt | null> {
  const found = await client.query<{id:string;params:Record<string,unknown>}>(`SELECT id,params FROM generation_jobs WHERE user_id=$1::uuid AND organization_id IS NOT DISTINCT FROM $2::uuid AND job_type='page_generate' AND params->>'page_id'=$3 AND params->>'save_and_generate_request_id'=$4 ORDER BY created_at DESC LIMIT 1`, [userId,organizationId,pageId,key]);
  const row = found.rows[0];
  if (!row) return null;
  const {page_revision,quote_id,save_and_generate_body_hash}=row.params;
  if (typeof page_revision !== 'string' || typeof quote_id !== 'string' || typeof save_and_generate_body_hash !== 'string') throw new ConflictError('Existing atomic receipt is incompatible; reload its generation job');
  return {jobId:row.id,pageRevision:page_revision,quoteId:quote_id,bodyHash:save_and_generate_body_hash};
}
async function requireScope(client: DatabaseClient, userId: string, organizationId: string | null): Promise<void> {
  if (organizationId === null) return;
  const bound=bindTransaction(client); const service=new OrganizationService(new PostgresOrganizationRepository(bound,bound));
  await service.requireMembership(organizationId,userId,'edit_work',client);
  await service.requireMembership(organizationId,userId,'generate',client);
}
function validateInputShape(input: SaveAndGeneratePageInput): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/u.test(input.requestId)) throw new ValidationError('Idempotency-Key must contain 8 to 128 valid characters');
  if (!Number.isFinite(new Date(input.expectedUpdatedAt).getTime())) throw new ValidationError('expected_updated_at must be a timestamp');
  const panels=[...input.panels].sort((a,b)=>a.order-b.order);
  if (panels.length===0 || panels.length>20 || !panels.every((panel,index)=>panel.order===index+1) || new Set(panels.map(panel=>panel.id)).size!==panels.length) throw new ValidationError('Panels must be complete and use contiguous order values');
  const panelIds=new Set(panels.map(panel=>panel.id)); const framePanels=new Set(input.frames.map(frame=>frame.panelId));
  if(input.frames.length!==panels.length || framePanels.size!==panels.length || input.frames.some(frame=>frame.panelId===null || !panelIds.has(frame.panelId))) throw new ValidationError('Every panel requires exactly one frame');
}
