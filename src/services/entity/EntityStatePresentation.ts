import { imageMobileAccess, toImageProvenanceRecord } from '../../domain/generation/ImageAccessPolicy.js';
import type { EntityState } from '../../domain/types/scene.js';
import { computeStateReferenceFingerprint } from '../../domain/state/StateReferenceFingerprint.js';
import { parseStateReferenceDescriptor } from '../../repositories/EntityStateReferenceRepository.js';
import { ensureOwnedEntityReferenceImageKey } from '../storage/StoredImageKeyPolicy.js';

export interface PublicStateReference {
  reference_status: 'legacy' | 'draft' | 'confirmed' | 'stale';
  reference_image: {
    mobile_access?: 'available' | 'web_only' | 'unavailable'; ref_id: string; image_model: string; base_ref_id: string; created_at: string; input_fingerprint: string;
  } | null;
}

// Do not expose storage keys/owners. Presence alone is not readiness: an edited
// variant or changed/missing base must stay visibly stale until confirmed again.
export function presentEntityStateReference(state: EntityState): PublicStateReference {
  if (state.description === null || state.description === undefined) {
    return { reference_status: 'legacy', reference_image: null };
  }
  const descriptor = parseStateReferenceDescriptor(state.referenceImage);
  if (descriptor === null) {
    return { reference_status: state.referenceImage == null ? 'draft' : 'stale', reference_image: null };
  }
  try {
    ensureOwnedEntityReferenceImageKey(descriptor.s3Key, descriptor.storageOwnerUserId, state.entityId);
  } catch {
    return { reference_status: 'stale', reference_image: null };
  }
  if (!Number.isFinite(Date.parse(descriptor.createdAt)) || descriptor.inputFingerprint.length > 128) {
    return { reference_status: 'stale', reference_image: null };
  }
  const fresh = state.name !== null && state.baseReferenceId === descriptor.baseRefId
    && descriptor.inputFingerprint === computeStateReferenceFingerprint({
      entityId: state.entityId, stateId: state.id, name: state.name,
      description: state.description, baseRefId: descriptor.baseRefId,
    });
  return {
    reference_status: fresh ? 'confirmed' : 'stale',
    reference_image: {
      ...toImageProvenanceRecord(descriptor),
      mobile_access: imageMobileAccess(descriptor),
      ref_id: descriptor.refId, image_model: descriptor.imageModel, base_ref_id: descriptor.baseRefId,
      created_at: new Date(descriptor.createdAt).toISOString(), input_fingerprint: descriptor.inputFingerprint,
    },
  };
}
