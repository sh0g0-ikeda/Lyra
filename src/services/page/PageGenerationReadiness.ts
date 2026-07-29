import type { EntityRepository } from '../../repositories/EntityRepository.js';
import type { PageGenerationInputSnapshotReference } from '../../domain/types/pageGeneration.js';
import type { PageGenerationContext } from '../../domain/types/page.js';
import { PAGE_GENERATION_INPUT_IMAGE_LIMITS } from '../../domain/constants/generation.js';

export type PageGenerationBlockerCode =
  | 'GENERATION_DISABLED'
  | 'FRAME_REQUIRED'
  | 'PANEL_REQUIRED'
  | 'FRAME_PANEL_MISMATCH'
  | 'PANEL_ORDER_INVALID'
  | 'DIALOGUE_SPEAKER_REQUIRED'
  | 'DIALOGUE_SPEAKER_NOT_IN_PANEL'
  | 'ASSIGNED_ENTITY_INVALID'
  | 'PAGE_GENERATING'
  | 'PAGE_REOPEN_REQUIRED'
  | 'CHARACTER_REFERENCE_REQUIRED'
  | 'REFERENCE_IMAGE_LIMIT_EXCEEDED'
  | 'ACTIVE_GENERATION_JOB'
  | 'INSUFFICIENT_CREDITS';

export type PageGenerationBlockerAction =
  | 'open_layout'
  | 'open_panels'
  | 'open_characters'
  | 'reopen_page'
  | 'wait_for_generation'
  | 'none';

export interface PageGenerationBlocker {
  code: PageGenerationBlockerCode;
  entityId: string | null;
  field: 'generation' | 'frames' | 'panels' | 'entities' | 'dialogue' | 'status';
  action: PageGenerationBlockerAction;
  messageKey: string;
}

export interface PageGenerationReadinessAssessment {
  blockers: PageGenerationBlocker[];
  billableReferenceCount: number;
  firstFailureMessage: string | null;
  entityNames: ReadonlyMap<string, string>;
  references: PageGenerationInputSnapshotReference[];
}

/**
 * The API readiness response and the enqueue path share this assessment so a
 * button can never be enabled by a client-side approximation of the rules.
 */
export class PageGenerationReadinessEvaluator {
  public constructor(private readonly entityRepository: EntityRepository) {}

  public async assess(input: {
    userId: string;
    page: PageGenerationContext;
    generationEnabled: boolean;
    hasActiveGenerationJob: boolean;
  }): Promise<PageGenerationReadinessAssessment> {
    const blockers: PageGenerationBlocker[] = [];
    let firstFailureMessage: string | null = null;
    const add = (blocker: PageGenerationBlocker, message: string): void => {
      blockers.push(blocker);
      firstFailureMessage ??= message;
    };

    if (!input.generationEnabled) {
      add(
        blocker('GENERATION_DISABLED', null, 'generation', 'none', 'page.blocker.generationDisabled'),
        'Generation is temporarily disabled',
      );
    }
    if (input.page.frameCount === 0) {
      add(blocker('FRAME_REQUIRED', null, 'frames', 'open_layout', 'page.blocker.frameRequired'), 'Page must have at least one frame before generation');
    }
    if (input.page.panels.length === 0) {
      add(blocker('PANEL_REQUIRED', null, 'panels', 'open_panels', 'page.blocker.panelRequired'), 'Page must have at least one panel before generation');
    }
    if (input.page.frameCount !== input.page.panels.length && getLayoutFrameCount(input.page.layoutConfig) !== input.page.panels.length) {
      add(
        blocker('FRAME_PANEL_MISMATCH', null, 'frames', 'open_layout', 'page.blocker.framePanelMismatch'),
        'Page frame count must match panel count before generation',
      );
    }
    if (!hasContiguousPanelOrder(input.page)) {
      add(
        blocker('PANEL_ORDER_INVALID', null, 'panels', 'open_panels', 'page.blocker.panelOrderInvalid'),
        'Panels must use contiguous order values before generation',
      );
    }
    if (input.page.status === 'generating') {
      add(blocker('PAGE_GENERATING', null, 'status', 'wait_for_generation', 'page.blocker.pageGenerating'), 'Page is already generating');
    }
    if (input.page.status === 'confirmed') {
      add(blocker('PAGE_REOPEN_REQUIRED', null, 'status', 'reopen_page', 'page.blocker.pageReopenRequired'), 'Confirmed pages must be reopened before regeneration');
    }
    if (input.hasActiveGenerationJob) {
      add(
        blocker('ACTIVE_GENERATION_JOB', null, 'generation', 'wait_for_generation', 'page.blocker.activeGenerationJob'),
        'Page generation is already queued or processing',
      );
    }

    for (const panel of input.page.panels) {
      const panelEntityIds = new Set(panel.entities.map((assignment) => assignment.entityId));
      for (const dialogue of panel.dialogue) {
        const requiresSpeaker = dialogue.type === 'speech' || dialogue.type === 'thought' || dialogue.type === 'shout' || dialogue.type === 'whisper';
        if (requiresSpeaker && dialogue.entityId === null) {
          add(
            blocker('DIALOGUE_SPEAKER_REQUIRED', null, 'dialogue', 'open_panels', 'page.blocker.dialogueSpeakerRequired'),
            'Speaker dialogue requires an assigned entity',
          );
          continue;
        }
        if (dialogue.entityId !== null && !panelEntityIds.has(dialogue.entityId)) {
          add(
            blocker('DIALOGUE_SPEAKER_NOT_IN_PANEL', dialogue.entityId, 'dialogue', 'open_panels', 'page.blocker.dialogueSpeakerNotInPanel'),
            'Dialogue speaker must be assigned to the same panel',
          );
        }
      }
    }

    const assignedEntityIds = Array.from(
      new Set(input.page.panels.flatMap((panel) => panel.entities.map((assignment) => assignment.entityId))),
    );
    if (assignedEntityIds.length === 0) {
      return {
        blockers,
        billableReferenceCount: 0,
        firstFailureMessage,
        entityNames: new Map(),
        references: [],
      };
    }

    const organizationId = input.page.organizationId ?? null;
    const [entities, references] = await Promise.all([
      this.entityRepository.findByWorkIdAndUserId(input.page.workId, input.userId, organizationId),
      this.entityRepository.findPrimaryReferenceImagesByEntityIdsAndUserId(
        assignedEntityIds,
        input.page.workId,
        input.userId,
        organizationId,
      ),
    ]);
    const referenceEntityIds = new Set(references.map((reference) => reference.entityId));
    const workEntityIds = new Set(entities.map((entity) => entity.id));
    for (const panel of input.page.panels) {
      const panelEntityIds = new Set(panel.entities.map((assignment) => assignment.entityId));
      for (const entityId of panelEntityIds) {
        if (!workEntityIds.has(entityId)) {
          add(
            blocker('ASSIGNED_ENTITY_INVALID', entityId, 'entities', 'open_panels', 'page.blocker.assignedEntityInvalid'),
            'Panel assignment must belong to the page work',
          );
        }
      }
    }
    const billableReferenceCount = referenceEntityIds.size;
    if (billableReferenceCount > PAGE_GENERATION_INPUT_IMAGE_LIMITS.MAX_ENTITY_REFERENCE_IMAGES) {
      add(
        blocker('REFERENCE_IMAGE_LIMIT_EXCEEDED', null, 'entities', 'open_panels', 'page.blocker.referenceImageLimit'),
        `Page generation supports up to ${PAGE_GENERATION_INPUT_IMAGE_LIMITS.MAX_ENTITY_REFERENCE_IMAGES} reference images per page. Reduce assigned characters or split the scene.`,
      );
    }

    for (const entity of entities) {
      if (entity.entityType !== 'character' || !assignedEntityIds.includes(entity.id) || referenceEntityIds.has(entity.id)) {
        continue;
      }
      add(
        blocker('CHARACTER_REFERENCE_REQUIRED', entity.id, 'entities', 'open_characters', 'page.blocker.characterReference'),
        `Generate requires confirmed character references for: ${entity.name}`,
      );
    }

    const entityNames = new Map(entities.map((entity) => [entity.id, entity.name]));
    const referenceByEntityId = new Map(references.map((reference) => [reference.entityId, reference]));
    const orderedEntityIds = collectOrderedEntityIds(input.page);
    const snapshotReferences = orderedEntityIds.flatMap((entityId, index) => {
      const reference = referenceByEntityId.get(entityId);
      const canonicalName = entityNames.get(entityId);
      if (reference === undefined || canonicalName === undefined) {
        return [];
      }
      return [{
        entityId,
        canonicalName,
        refId: reference.refId,
        s3Key: reference.s3Key,
        subjectLabel: canonicalName,
        modelInputOrder: index,
      }];
    });

    return {
      blockers,
      billableReferenceCount,
      firstFailureMessage,
      entityNames,
      references: snapshotReferences,
    };
  }
}

function collectOrderedEntityIds(page: PageGenerationContext): string[] {
  const entityIds = new Set<string>();
  for (const panel of [...page.panels].sort((left, right) => left.order - right.order)) {
    for (const assignment of panel.entities) {
      entityIds.add(assignment.entityId);
    }
  }
  return Array.from(entityIds);
}

function hasContiguousPanelOrder(page: PageGenerationContext): boolean {
  const ordered = [...page.panels].sort((left, right) => left.order - right.order);
  return ordered.every((panel, index) => panel.order === index + 1);
}

function blocker(
  code: PageGenerationBlockerCode,
  entityId: string | null,
  field: PageGenerationBlocker['field'],
  action: PageGenerationBlockerAction,
  messageKey: string,
): PageGenerationBlocker {
  return { code, entityId, field, action, messageKey };
}

function getLayoutFrameCount(layoutConfig: Record<string, unknown>): number | null {
  const frameDefinitions = layoutConfig.frame_definitions;
  return Array.isArray(frameDefinitions) ? frameDefinitions.length : null;
}
