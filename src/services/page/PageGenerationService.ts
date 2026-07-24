import { randomUUID } from 'node:crypto';
import { AppError, ConfigurationError, ConflictError, NotFoundError, ValidationError } from '../../domain/errors/index.js';
import type { PageGenerationContext } from '../../domain/types/page.js';
import type { PageGenerationInputSnapshotReference, PageGenerationRequestKind } from '../../domain/types/pageGeneration.js';
import type { CreditServicePort } from '../credit/CreditService.js';
import type { OrganizationServicePort } from '../organization/OrganizationService.js';
import {
  isUniqueViolation,
  type GenerationJobRepository,
} from '../../repositories/GenerationJobRepository.js';
import type { EntityRepository } from '../../repositories/EntityRepository.js';
import type { PageRepository } from '../../repositories/PageRepository.js';
import { ModeSelector } from './ModeSelector.js';
import type { PageGenerationQueuePort } from './PageGenerationQueue.js';
import {
  DEFAULT_GENERATION_CAPACITY_LIMITS,
  type GenerationCapacityLimits,
} from '../generation/GenerationCapacityGuard.js';
import {
  NoopPageGenerationRecoveryService,
  type PageGenerationRecoveryServicePort,
} from './PageGenerationRecoveryService.js';
import {
  PageGenerationReadinessEvaluator,
  type PageGenerationBlocker,
} from './PageGenerationReadiness.js';
import {
  isPageAtomicGenerationRepository,
  type SaveAndGeneratePageInput,
} from './PageSaveAndGenerate.js';

export interface EnqueuePageGenerationResult {
  jobId: string;
}

export interface PageGenerationReadinessResult {
  ready: boolean;
  blockers: PageGenerationBlocker[];
  warnings: [];
  estimatedCreditCost: number;
  pageRevision: string;
}

export type { SaveAndGeneratePageInput } from './PageSaveAndGenerate.js';

export interface SaveAndGeneratePageResult {
  jobId: string;
  pageRevision: string;
}

export interface PageGenerationServicePort {
  enqueuePageGeneration(
    userId: string,
    pageId: string,
    organizationId?: string | null,
  ): Promise<EnqueuePageGenerationResult>;
  getGenerationReadiness(
    userId: string,
    pageId: string,
    organizationId?: string | null,
  ): Promise<PageGenerationReadinessResult>;
  saveAndGenerate(
    userId: string,
    pageId: string,
    input: SaveAndGeneratePageInput,
    organizationId?: string | null,
  ): Promise<SaveAndGeneratePageResult>;
}

/**
 * Validates page generation preconditions, charges credits, persists the queued
 * job, and hands off to the queue adapter.
 */
export class PageGenerationService implements PageGenerationServicePort {
  public constructor(
    private readonly pageRepository: PageRepository,
    private readonly entityRepository: EntityRepository,
    private readonly generationJobRepository: GenerationJobRepository,
    private readonly creditService: CreditServicePort,
    private readonly pageGenerationQueue: PageGenerationQueuePort,
    private readonly modeSelector: ModeSelector,
    private readonly recoveryService: PageGenerationRecoveryServicePort = new NoopPageGenerationRecoveryService(),
    private readonly capacityLimits: GenerationCapacityLimits = DEFAULT_GENERATION_CAPACITY_LIMITS,
    private readonly generationEnabled = true,
    private readonly organizationService?: OrganizationServicePort,
  ) {}

  public async enqueuePageGeneration(
    userId: string,
    pageId: string,
    organizationId: string | null = null,
  ): Promise<EnqueuePageGenerationResult> {
    await this.recoveryService.recoverStaleJobsForPage(userId, pageId, organizationId);
    if (organizationId !== null) {
      await this.getOrganizationService().requireMembership(organizationId, userId, 'generate');
    }

    const page = await this.pageRepository.findGenerationContextByIdAndUserId(pageId, userId, organizationId);
    if (page === null) {
      throw new NotFoundError('Page not found');
    }

    const pageOrganizationId = page.organizationId ?? null;
    const readiness = await this.assessReadiness(userId, page, pageOrganizationId);
    this.throwIfNotReady(readiness);
    const billableReferenceCount = readiness.billableReferenceCount;

    const requestKind: PageGenerationRequestKind =
      page.generatedImage === null ? 'initial' : 'regenerate';
    const selection = this.modeSelector.selectProfile({
      entityCount: countUniqueAssignedEntities(page),
      panelCount: page.panels.length,
      requestKind,
      billableReferenceCount,
    });

    let creditsConsumed = false;
    let pageStateUpdated = false;
    const reservedJobId = randomUUID();
    let createdJobId: string | null = null;

    try {
      const job = await this.generationJobRepository.create({
        id: reservedJobId,
        userId,
        organizationId: pageOrganizationId,
        jobType: 'page_generate',
        generationMode: selection.mode,
        creditCost: selection.creditCost,
        capacityLimits: this.capacityLimits,
        params: {
          page_id: page.pageId,
          work_id: page.workId,
          request_kind: selection.requestKind,
          generation_mode: selection.mode,
          quality: selection.quality,
          requires_planner: selection.requiresPlanner,
          previous_page_status: page.status,
          previous_generation_mode: page.generationMode,
        },
      });
      createdJobId = job.id;

      await this.consumeCredits({
        userId,
        organizationId: pageOrganizationId,
        workId: page.workId,
        cost: selection.creditCost,
        description: describeGeneration(selection.requestKind, selection.mode),
        jobId: job.id,
      });
      creditsConsumed = true;

      const pageUpdated = await this.pageRepository.updateGenerationState(
        page.pageId,
        userId,
        {
          status: 'generating',
          generationMode: selection.mode,
          expectedStatus: page.status,
        },
        pageOrganizationId,
      );
      if (!pageUpdated) {
        throw new ConflictError('Page generation state changed before enqueue');
      }
      pageStateUpdated = true;

      const enqueueResult = await this.pageGenerationQueue.enqueue({
        jobId: job.id,
        userId,
        pageId: page.pageId,
        requestKind: selection.requestKind,
        generationMode: selection.mode,
        quality: selection.quality,
        creditCost: selection.creditCost,
        requiresPlanner: selection.requiresPlanner,
        previousPageStatus: page.status,
        previousGenerationMode: page.generationMode,
      });

      if (enqueueResult.messageId !== null) {
        await this.persistQueueMessageId(job.id, enqueueResult.messageId);
      }

      return { jobId: job.id };
    } catch (error) {
      let compensationError: unknown = null;

      if (createdJobId !== null) {
        try {
          await this.generationJobRepository.markFailed(createdJobId, 'Failed to enqueue page generation job');
        } catch (markError) {
          compensationError ??= markError;
        }
      }

      if (pageStateUpdated) {
        try {
          await this.pageRepository.updateGenerationState(
            page.pageId,
            userId,
            {
              status: page.status,
              generationMode: page.generationMode,
            },
            pageOrganizationId,
          );
        } catch (restoreError) {
          compensationError ??= restoreError;
        }
      }

      if (creditsConsumed) {
        try {
          await this.refundCredits({
            userId,
            organizationId: pageOrganizationId,
            amount: selection.creditCost,
            description: 'Refund for failed page generation enqueue',
            jobId: createdJobId ?? reservedJobId,
          });
        } catch (refundError) {
          compensationError ??= refundError;
        }
      }

      if (compensationError !== null) {
        logPageGenerationCompensationFailure('page_generation_enqueue_compensation_failed', compensationError, {
          job_id: createdJobId ?? reservedJobId,
          page_id: page.pageId,
        });
      }

      if (error instanceof AppError) {
        throw error;
      }

      if (isUniqueViolation(error)) {
        throw new ConflictError('Page generation is already queued or processing');
      }

      throw new ConfigurationError('Failed to enqueue page generation job');
    }
  }

  public async getGenerationReadiness(
    userId: string,
    pageId: string,
    organizationId: string | null = null,
  ): Promise<PageGenerationReadinessResult> {
    if (organizationId !== null) {
      await this.getOrganizationService().requireMembership(organizationId, userId, 'generate');
    }
    const page = await this.pageRepository.findGenerationContextByIdAndUserId(pageId, userId, organizationId);
    if (page === null) {
      throw new NotFoundError('Page not found');
    }
    const readiness = await this.assessReadiness(userId, page, page.organizationId ?? null);
    const requestKind: PageGenerationRequestKind = page.generatedImage === null ? 'initial' : 'regenerate';
    const selection = this.modeSelector.selectProfile({
      entityCount: countUniqueAssignedEntities(page),
      panelCount: page.panels.length,
      requestKind,
      billableReferenceCount: readiness.billableReferenceCount,
    });
    const creditBlocker = await this.getCreditReadinessBlocker(userId, page.organizationId ?? null, selection.creditCost);
    const blockers = creditBlocker === null ? readiness.blockers : [...readiness.blockers, creditBlocker];
    const summary = await this.pageRepository.findPageByIdAndUserId(pageId, userId, organizationId);
    if (summary === null) {
      throw new NotFoundError('Page not found');
    }
    return {
      ready: blockers.length === 0,
      blockers,
      warnings: [],
      estimatedCreditCost: selection.creditCost,
      pageRevision: summary.updatedAt.toISOString(),
    };
  }

  public async saveAndGenerate(
    userId: string,
    pageId: string,
    input: SaveAndGeneratePageInput,
    organizationId: string | null = null,
  ): Promise<SaveAndGeneratePageResult> {
    if (organizationId !== null) {
      await this.getOrganizationService().requireMembership(organizationId, userId, 'edit_work');
      await this.getOrganizationService().requireMembership(organizationId, userId, 'generate');
    }
    if (!isPageAtomicGenerationRepository(this.pageRepository)) {
      throw new ConfigurationError('Atomic page save-and-generate repository is not configured');
    }
    if (!this.generationEnabled) {
      throw new ConflictError('Generation is temporarily disabled');
    }
    const page = await this.pageRepository.findGenerationContextByIdAndUserId(pageId, userId, organizationId);
    if (page === null) {
      throw new NotFoundError('Page not found');
    }
    const candidate = {
      ...page,
      layoutConfig: buildSavedLayoutConfig(page.layoutConfig, input),
      frameCount: input.frames.length,
      panels: input.panels.map((panel) => ({
        panelId: panel.id,
        order: panel.order,
        entities: panel.entities,
        dialogue: panel.dialogue,
      })),
    } satisfies PageGenerationContext;
    const readiness = await this.assessReadiness(userId, candidate, page.organizationId ?? null);
    this.throwIfNotReady(readiness);
    const requestKind: PageGenerationRequestKind = page.generatedImage === null ? 'initial' : 'regenerate';
    const selection = this.modeSelector.selectProfile({
      entityCount: countUniqueAssignedEntities(candidate),
      panelCount: candidate.panels.length,
      requestKind,
      billableReferenceCount: readiness.billableReferenceCount,
    });
    let result: SaveAndGeneratePageResult;
    try {
      result = await this.pageRepository.saveAndCreateGenerationJob({
        ...input,
        pageId,
        userId,
        organizationId: page.organizationId ?? null,
        layoutConfig: candidate.layoutConfig,
        selection,
        inputSnapshot: buildInputSnapshot(candidate, input, selection, readiness.entityNames, readiness.references),
        capacityLimits: this.capacityLimits,
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictError('Page generation is already queued or processing');
      }
      throw error;
    }
    try {
      const enqueueResult = await this.pageGenerationQueue.enqueue({
        jobId: result.jobId,
        userId,
        pageId,
        requestKind: selection.requestKind,
        generationMode: selection.mode,
        quality: selection.quality,
        creditCost: selection.creditCost,
        requiresPlanner: selection.requiresPlanner,
        previousPageStatus: page.status,
        previousGenerationMode: page.generationMode,
      });
      if (enqueueResult.messageId !== null) {
        await this.persistQueueMessageId(result.jobId, enqueueResult.messageId);
      }
    } catch (error) {
      // The durable queued job is the outbox record. Do not undo the committed
      // page revision or credit ledger; retrying the same request id dispatches it.
      logPageGenerationCompensationFailure('page_generation_outbox_delivery_deferred', error, {
        job_id: result.jobId,
        page_id: pageId,
      });
    }
    return result;
  }

  private async assessReadiness(
    userId: string,
    page: PageGenerationContext,
    organizationId: string | null,
  ) {
    const activeJob = await this.generationJobRepository.findActivePageGenerationJob(userId, page.pageId, organizationId);
    return new PageGenerationReadinessEvaluator(this.entityRepository).assess({
      userId,
      page,
      generationEnabled: this.generationEnabled,
      hasActiveGenerationJob: activeJob !== null,
    });
  }

  private throwIfNotReady(readiness: Awaited<ReturnType<PageGenerationService['assessReadiness']>>): void {
    const first = readiness.blockers[0];
    if (first === undefined) {
      return;
    }
    const message = readiness.firstFailureMessage ?? 'Page generation is not ready';
    if (first.code === 'PAGE_GENERATING' || first.code === 'PAGE_REOPEN_REQUIRED' || first.code === 'ACTIVE_GENERATION_JOB' || first.code === 'GENERATION_DISABLED') {
      throw new ConflictError(message);
    }
    throw new ValidationError(message);
  }

  private async getCreditReadinessBlocker(
    userId: string,
    organizationId: string | null,
    creditCost: number,
  ): Promise<PageGenerationBlocker | null> {
    if (organizationId !== null) {
      const balance = await this.getOrganizationService().getCreditBalance(userId, organizationId);
      return balance.monthlyCredits + balance.purchasedCredits >= creditCost
        ? null
        : insufficientCreditBlocker();
    }
    const balance = await this.creditService.getBalance(userId);
    if (balance.totalCredits >= creditCost) {
      return null;
    }
    return insufficientCreditBlocker();
  }

  private async persistQueueMessageId(jobId: string, messageId: string): Promise<void> {
    try {
      await this.generationJobRepository.attachQueueMessageId(jobId, messageId);
    } catch {
      // The queue already accepted the job. Missing metadata should not refund
      // credits or roll back page state because the worker may still run.
    }
  }

  private async consumeCredits(input: {
    userId: string;
    organizationId: string | null;
    workId: string;
    cost: number;
    description: string;
    jobId: string;
  }): Promise<void> {
    const organizationId = input.organizationId ?? null;
    if (organizationId === null) {
      await this.creditService.consumeCredits({
        userId: input.userId,
        cost: input.cost,
        description: input.description,
        jobId: input.jobId,
      });
      return;
    }

    await this.getOrganizationService().consumeCredits({
      userId: input.userId,
      organizationId,
      workId: input.workId,
      cost: input.cost,
      description: input.description,
      jobId: input.jobId,
      eventType: 'generation.started',
    });
  }

  private async refundCredits(input: {
    userId: string;
    organizationId: string | null;
    amount: number;
    description: string;
    jobId: string;
  }): Promise<void> {
    const organizationId = input.organizationId ?? null;
    if (organizationId === null) {
      await this.creditService.refundCredits({
        userId: input.userId,
        amount: input.amount,
        description: input.description,
        jobId: input.jobId,
      });
      return;
    }

    await this.getOrganizationService().refundCredits({
      organizationId,
      actorUserId: input.userId,
      amount: input.amount,
      description: input.description,
      jobId: input.jobId,
    });
  }

  private getOrganizationService(): OrganizationServicePort {
    if (this.organizationService === undefined) {
      throw new ConfigurationError('Organization service is required for enterprise generation');
    }
    return this.organizationService;
  }
}

function insufficientCreditBlocker(): PageGenerationBlocker {
  return {
    code: 'INSUFFICIENT_CREDITS',
    entityId: null,
    field: 'generation',
    action: 'none',
    messageKey: 'page.blocker.insufficientCredits',
  };
}

function countUniqueAssignedEntities(page: PageGenerationContext): number {
  return new Set(
    page.panels.flatMap((panel) => panel.entities.map((assignment) => assignment.entityId)),
  ).size;
}

function buildSavedLayoutConfig(
  existing: Record<string, unknown>,
  input: SaveAndGeneratePageInput,
): Record<string, unknown> {
  const layoutConfig: Record<string, unknown> = {
    ...existing,
    panel_count: input.panels.length,
    frame_definitions: input.frames.map((frame) => ({
      panel_id: frame.panelId,
      vertices: frame.vertices,
      border_style: frame.borderStyle,
      border_width: frame.borderWidth,
      border_color: frame.borderColor,
      z_index: frame.zIndex,
      reading_order: frame.readingOrder,
    })),
  };
  if (input.page.styleReference !== undefined) {
    layoutConfig.style_reference = input.page.styleReference;
  }
  if (input.page.storySourceSceneIds !== undefined) {
    layoutConfig.story_source_scene_ids = input.page.storySourceSceneIds;
  }
  if (input.page.storyPagePurpose !== undefined) {
    layoutConfig.story_page_purpose = input.page.storyPagePurpose;
  }
  if (input.page.storyContinuityNote !== undefined) {
    layoutConfig.story_continuity_note = input.page.storyContinuityNote;
  }
  return layoutConfig;
}

function buildInputSnapshot(
  page: PageGenerationContext,
  input: SaveAndGeneratePageInput,
  selection: ReturnType<ModeSelector['selectProfile']>,
  entityNames: ReadonlyMap<string, string>,
  references: PageGenerationInputSnapshotReference[],
) {
  return {
    pageId: page.pageId,
    requestKind: selection.requestKind,
    generationMode: selection.mode,
    panelCount: input.panels.length,
    references,
    panels: [...input.panels]
      .sort((left, right) => left.order - right.order)
      .map((panel) => ({
        panelId: panel.id,
        order: panel.order,
        entityIds: panel.entities.map((entity) => entity.entityId),
        entityNames: panel.entities.map((entity) => entityNames.get(entity.entityId) ?? entity.entityId),
        dialogue: panel.dialogue.map((dialogue) => ({
          entityId: dialogue.entityId,
          speakerName: dialogue.entityId === null ? null : entityNames.get(dialogue.entityId) ?? dialogue.entityId,
          type: dialogue.type,
          position: dialogue.position,
          text: dialogue.text,
        })),
      })),
  };
}

function logPageGenerationCompensationFailure(
  event: string,
  error: unknown,
  metadata: Record<string, unknown>,
): void {
  console.error(
    JSON.stringify({
      level: 'error',
      event,
      message: error instanceof Error ? error.message : String(error),
      ...metadata,
    }),
  );
}

function describeGeneration(requestKind: PageGenerationRequestKind, mode: 'standard' | 'thinking'): string {
  if (requestKind === 'regenerate') {
    return 'Page regeneration';
  }

  return mode === 'thinking' ? 'Page generation (thinking)' : 'Page generation (standard)';
}
