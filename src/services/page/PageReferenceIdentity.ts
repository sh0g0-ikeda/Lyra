import type {
  EntityReferenceAssignment,
  EntityResolvedReferenceImage,
} from '../../repositories/EntityRepository.js';

type ResolvedPageReferenceImage = EntityResolvedReferenceImage & { refId: string; s3Key: string };

export interface PageReferenceImage {
  reference: ResolvedPageReferenceImage;
  assignments: EntityReferenceAssignment[];
}

/**
 * Generation compatibility (Spec §§6–7): legacy note-only states resolve to the
 * base image. Billing, prompt labels, snapshots, and attachments must share that
 * image identity, while confirmed variant states stay separate. Callers validate
 * every original assignment and storage owner before using these canonical groups.
 */
export function pageReferenceImageKey(reference: EntityResolvedReferenceImage): string {
  return JSON.stringify([
    reference.entityId,
    reference.stateDescription === null ? null : reference.stateId,
    reference.refId,
    reference.s3Key,
  ]);
}

export function collectPageReferenceImages(
  assignments: EntityReferenceAssignment[],
  references: EntityResolvedReferenceImage[],
): PageReferenceImage[] {
  const images = new Map<string, PageReferenceImage>();
  for (const assignment of assignments) {
    const reference = references.find((candidate) => (
      candidate.entityId === assignment.entityId && candidate.stateId === assignment.stateId
    ));
    if (reference === undefined || reference.refId === null || reference.s3Key === null) {
      continue;
    }
    const key = pageReferenceImageKey(reference);
    const existing = images.get(key);
    if (existing !== undefined) {
      existing.assignments.push(assignment);
      continue;
    }
    images.set(key, {
      reference: {
        ...reference,
        refId: reference.refId,
        s3Key: reference.s3Key,
        stateId: reference.stateDescription === null ? null : reference.stateId,
        stateName: reference.stateDescription === null ? null : reference.stateName,
      },
      assignments: [assignment],
    });
  }
  return Array.from(images.values());
}

export function buildPageReferenceSubjectLabel(
  canonicalName: string,
  reference: EntityResolvedReferenceImage,
  images: PageReferenceImage[],
): string {
  const hasVariant = images.some((image) => (
    image.reference.entityId === reference.entityId && image.reference.stateId !== null
  ));
  if (reference.stateName === null && !hasVariant) {
    return canonicalName;
  }
  return `${canonicalName} / ${reference.stateName ?? 'default'}`;
}
