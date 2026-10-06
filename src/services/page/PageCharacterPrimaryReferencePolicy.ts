import type { Entity } from '../../domain/types/entity.js';
import type { EntityPrimaryReferenceImage } from '../../repositories/EntityRepository.js';
import { isOpenAIImageInputCompatible } from '../../domain/generation/ImageInputProviderPolicy.js';
import { PageReferenceModelIncompatibleError } from '../../domain/errors/index.js';

export function findIncompatibleAssignedCharacterPrimaryIds(
  assignedEntityIds: ReadonlySet<string>,
  entities: readonly Entity[],
  primaryReferences: readonly EntityPrimaryReferenceImage[],
): string[] {
  const assignedCharacterIds = new Set(
    entities
      .filter((entity) => entity.entityType === 'character' && assignedEntityIds.has(entity.id))
      .map((entity) => entity.id),
  );
  return primaryReferences
    .filter((reference) => (
      assignedCharacterIds.has(reference.entityId)
      && !isOpenAIImageInputCompatible(reference)
    ))
    .map((reference) => reference.entityId);
}

export function requireAssignedCharacterPrimariesCompatible(
  assignedEntityIds: ReadonlySet<string>,
  entities: readonly Entity[],
  primaryReferences: readonly EntityPrimaryReferenceImage[],
): void {
  if (findIncompatibleAssignedCharacterPrimaryIds(assignedEntityIds, entities, primaryReferences).length > 0) {
    throw new PageReferenceModelIncompatibleError();
  }
}
