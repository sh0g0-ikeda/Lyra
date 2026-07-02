import { randomUUID } from 'node:crypto';
import { AppError, ConfigurationError, ConflictError, NotFoundError, ValidationError } from '../../domain/errors/index.js';
import type { PageGenerationContext } from '../../domain/types/page.js';
import type { PageGenerationRequestKind } from '../../domain/types/pageGeneration.js';
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
  assertGenerationCapacity,
  DEFAULT_GENERATION_CAPACITY_LIMITS,
  type GenerationCapacityLimits,
} from '../generation/GenerationCapacityGuard.js';
import {
  NoopPageGenerationRecoveryService,
  type PageGenerationRecoveryServicePort,
} from './PageGenerationRecoveryService.js';
import { PAGE_GENERATION_INPUT_IMAGE_LIMITS } from '../../domain/constants/generation.js';

export interface EnqueuePageGenerationResult {
  jobId: string;
}

export interface PageGenerationServicePort {
  enqueuePageGeneration(
    userId: string,
    pageId: string,
    organizationId?: string | null,
  ): Promise<EnqueuePageGenerationResult>;
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
    if (!this.generationEnabled) {
      throw new ConflictError('Generation is temporarily disabled');
    }

    if (organizationId !== null) {
      await this.getOrganizationService().requireMembership(organizationId, userId, 'generate');
    }

    const page = await this.pageRepository.findGenerationContextByIdAndUserId(pageId, userId, organizationId);
    if (page === null) {
      throw new NotFoundError('Page not found');
    }

    const pageOrganizationId = page.organizationId ?? null;
    this.ensurePageCanGenerate(page);
    const billableReferenceCount = await this.ensureAssignedReferencesAndCountBillableReferences(userId, page);
    await assertGenerationCapacity(this.generationJobRepository, userId, this.capacityLimits);
    await this.ensureNoActiveGenerationJob(userId, page.pageId, pageOrganizationId);

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
      await this.consumeCredits({
        userId,
        organizationId: pageOrganizationId,
        workId: page.workId,
        cost: selection.creditCost,
        description: describeGeneration(selection.requestKind, selection.mode),
        jobId: reservedJobId,
      });
      creditsConsumed = true;

      const job = await this.generationJobRepository.create({
        id: reservedJobId,
        userId,
        organizationId: page.organizationId,
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
      if (error instanceof AppError && !creditsConsumed) {
        throw error;
      }

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
        throw compensationError;
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

  private ensurePageCanGenerate(page: PageGenerationContext): void {
    if (page.frameCount === 0) {
      throw new ValidationError('Page must have at least one frame before generation');
    }

    if (page.panels.length === 0) {
      throw new ValidationError('Page must have at least one panel before generation');
    }

    if (page.frameCount !== page.panels.length) {
      throw new ValidationError('Page frame count must match panel count before generation');
    }

    if (page.status === 'generating') {
      throw new ConflictError('Page is already generating');
    }

    if (page.status === 'confirmed') {
      throw new ConflictError('Confirmed pages must be reopened before regeneration');
    }
  }

  private async persistQueueMessageId(jobId: string, messageId: string): Promise<void> {
    try {
      await this.generationJobRepository.attachQueueMessageId(jobId, messageId);
    } catch {
      // The queue already accepted the job. Missing metadata should not refund
      // credits or roll back page state because the worker may still run.
    }
  }

  private async ensureNoActiveGenerationJob(
    userId: string,
    pageId: string,
    organizationId: string | null,
  ): Promise<void> {
    const activeJob = await this.generationJobRepository.findActivePageGenerationJob(userId, pageId, organizationId);
    if (activeJob !== null) {
      throw new ConflictError('Page generation is already queued or processing');
    }
  }

  private async ensureAssignedReferencesAndCountBillableReferences(
    userId: string,
    page: PageGenerationContext,
  ): Promise<number> {
    const assignedEntityIds = Array.from(
      new Set(page.panels.flatMap((panel) => panel.entities.map((assignment) => assignment.entityId))),
    );
    if (assignedEntityIds.length === 0) {
      return 0;
    }

    const organizationId = page.organizationId ?? null;
    const entities = await this.entityRepository.findByWorkIdAndUserId(page.workId, userId, organizationId);
    const assignedCharacters = entities.filter(
      (entity) => entity.entityType === 'character' && assignedEntityIds.includes(entity.id),
    );

    const references = await this.entityRepository.findPrimaryReferenceImagesByEntityIdsAndUserId(
      assignedEntityIds,
      page.workId,
      userId,
      organizationId,
    );

    const referenceImageCount = new Set(references.map((reference) => reference.entityId)).size;
    if (referenceImageCount > PAGE_GENERATION_INPUT_IMAGE_LIMITS.MAX_ENTITY_REFERENCE_IMAGES) {
      throw new ValidationError(
        `Page generation supports up to ${PAGE_GENERATION_INPUT_IMAGE_LIMITS.MAX_ENTITY_REFERENCE_IMAGES} reference images per page. Reduce assigned characters or split the scene.`,
      );
    }

    if (assignedCharacters.length === 0) {
      return referenceImageCount;
    }

    const referencedCharacterIds = new Set(references.map((reference) => reference.entityId));
    const missingCharacters = assignedCharacters.filter((entity) => !referencedCharacterIds.has(entity.id));
    if (missingCharacters.length === 0) {
      return referenceImageCount;
    }

    const missingNames = missingCharacters.map((entity) => entity.name).join(', ');
    throw new ValidationError(
      `Generate requires confirmed character references for: ${missingNames}`,
    );
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

function countUniqueAssignedEntities(page: PageGenerationContext): number {
  return new Set(
    page.panels.flatMap((panel) => panel.entities.map((assignment) => assignment.entityId)),
  ).size;
}

function describeGeneration(requestKind: PageGenerationRequestKind, mode: 'standard' | 'thinking'): string {
  if (requestKind === 'regenerate') {
    return 'Page regeneration';
  }

  return mode === 'thinking' ? 'Page generation (thinking)' : 'Page generation (standard)';
}
