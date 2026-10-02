import type { ImageProvenance } from '../generation/ImageAccessPolicy.js';
import type { EntityStatus, EntityType } from './entity.js';

export interface EntityStateReferenceDescriptor extends ImageProvenance {
  refId: string;
  s3Key: string;
  storageOwnerUserId: string;
  imageModel: string;
  baseRefId: string;
  createdAt: string;
  inputFingerprint: string;
}

export interface EntityStateBaseReference {
  refId: string;
  s3Key: string;
  storageOwnerUserId: string;
}

export interface EntityStateReferenceContextCandidate {
  entityId: string;
  workId: string;
  entityOwnerUserId: string;
  entityType: EntityType;
  entityName: string;
  entityFreeDescription: string | null;
  entityStructuredFields: Record<string, unknown>;
  entityPromptSupplement: string | null;
  entityStatus: EntityStatus;
  stateId: string;
  stateName: string | null;
  stateDescription: string | null;
  stateRevision: string;
  baseReference: EntityStateBaseReference | null;
  referenceImage: EntityStateReferenceDescriptor | null;
}

export interface EntityStateReferenceContext extends EntityStateReferenceContextCandidate {
  stateName: string;
  stateDescription: string;
  baseReference: EntityStateBaseReference;
}

export interface ConfirmEntityStateReferenceInput {
  userId: string;
  organizationId: string | null;
  entityId: string;
  stateId: string;
  jobId: string;
  candidateS3Key: string;
  expectedStateRevision: string;
  descriptor: EntityStateReferenceDescriptor;
}

export interface ConfirmedEntityStateReference {
  entityId: string;
  stateId: string;
  stateRevision: string;
  referenceImage: EntityStateReferenceDescriptor;
}

export function isReadyEntityStateReferenceContext(
  context: EntityStateReferenceContextCandidate,
): context is EntityStateReferenceContext {
  return context.stateName !== null
    && context.stateName.trim().length > 0
    && context.stateDescription !== null
    && context.stateDescription.trim().length > 0
    && context.baseReference !== null;
}
