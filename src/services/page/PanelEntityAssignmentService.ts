import { NotFoundError, ValidationError } from '../../domain/errors/index.js';
import type {
  PanelEntityAssignment,
  PanelEntityStateReference,
} from '../../domain/types/panelEntityAssignment.js';
import type { PanelEntityAssignmentRepository } from '../../repositories/PanelEntityAssignmentRepository.js';

export type { PanelEntityAssignment };

export interface PanelEntityAssignmentServicePort {
  replacePanelEntityAssignments(
    userId: string,
    panelId: string,
    assignments: PanelEntityAssignment[],
  ): Promise<PanelEntityAssignment[]>;
}

/**
 * Coordinates Panel entity assignment writes so panel ownership, work
 * membership, and optional entity_state references are checked before saving.
 */
export class PanelEntityAssignmentService implements PanelEntityAssignmentServicePort {
  public constructor(private readonly panelEntityAssignmentRepository: PanelEntityAssignmentRepository) {}

  public async replacePanelEntityAssignments(
    userId: string,
    panelId: string,
    assignments: PanelEntityAssignment[],
  ): Promise<PanelEntityAssignment[]> {
    const normalizedAssignments = normalizeAssignments(assignments);

    const panelContext = await this.panelEntityAssignmentRepository.findPanelContextByIdAndUserId(
      panelId,
      userId,
    );
    if (panelContext === null) {
      throw new NotFoundError('Panel not found');
    }

    ensureUniqueEntityAssignments(normalizedAssignments);
    await this.ensureEntitiesBelongToWork(userId, panelContext.workId, normalizedAssignments);
    await this.ensureEntityStatesMatchAssignments(userId, panelContext.workId, normalizedAssignments);

    const savedAssignments = await this.panelEntityAssignmentRepository.updatePanelEntityAssignments(
      panelId,
      userId,
      normalizedAssignments,
    );
    if (savedAssignments === null) {
      throw new NotFoundError('Panel not found');
    }

    return normalizeAssignments(savedAssignments);
  }

  private async ensureEntitiesBelongToWork(
    userId: string,
    workId: string,
    assignments: PanelEntityAssignment[],
  ): Promise<void> {
    const entityIds = [...new Set(assignments.map((assignment) => assignment.entityId))];
    if (entityIds.length === 0) {
      return;
    }

    const matchedEntityCount =
      await this.panelEntityAssignmentRepository.countEntitiesByIdsAndWorkIdAndUserId(
        entityIds,
        workId,
        userId,
      );
    if (matchedEntityCount !== entityIds.length) {
      throw new ValidationError('All assigned entities must belong to the panel work');
    }
  }

  private async ensureEntityStatesMatchAssignments(
    userId: string,
    workId: string,
    assignments: PanelEntityAssignment[],
  ): Promise<void> {
    const pairs = uniqueStateReferences(assignments);
    if (pairs.length === 0) {
      return;
    }

    const matchedPairCount =
      await this.panelEntityAssignmentRepository.countEntityStatePairsByWorkIdAndUserId(
        pairs,
        workId,
        userId,
      );
    if (matchedPairCount !== pairs.length) {
      throw new ValidationError('All state_id values must belong to their assigned entity');
    }
  }
}

function uniqueStateReferences(assignments: PanelEntityAssignment[]): PanelEntityStateReference[] {
  const seen = new Set<string>();
  const pairs: PanelEntityStateReference[] = [];

  for (const assignment of assignments) {
    if (assignment.stateId === null) {
      continue;
    }

    const key = `${assignment.entityId}:${assignment.stateId}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    pairs.push({ entityId: assignment.entityId, stateId: assignment.stateId });
  }

  return pairs;
}

function ensureUniqueEntityAssignments(assignments: PanelEntityAssignment[]): void {
  const seen = new Set<string>();

  for (const assignment of assignments) {
    if (seen.has(assignment.entityId)) {
      throw new ValidationError('Each entity can only be assigned once per panel');
    }

    seen.add(assignment.entityId);
  }
}

function normalizeAssignments(assignments: PanelEntityAssignment[]): PanelEntityAssignment[] {
  return assignments.map((assignment) => normalizeAssignment(assignment));
}

function normalizeAssignment(assignment: PanelEntityAssignment): PanelEntityAssignment {
  return {
    ...assignment,
    customExpression: assignment.expression === 'custom' ? assignment.customExpression : null,
    customAction: assignment.action === 'custom' ? assignment.customAction : null,
    effectNote: assignment.effectNote?.trim() ?? null,
  };
}
