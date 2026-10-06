import type { ImageProvenance } from '../generation/ImageAccessPolicy.js';
import type { EntityStatus, EntityType } from './entity.js';

export type EntityReferenceSetStatus = 'empty' | 'partial' | 'ready';
export type EntityReferenceImageSource = 'upload' | 'generated';

export interface EntityReferenceImage extends ImageProvenance {
  refId: string;
  s3Key: string;
  cdnUrl: string;
  source: EntityReferenceImageSource;
  createdAt: string;
}

export interface EntityReferenceSet {
  entityId: string;
  images: EntityReferenceImage[];
  primaryRefId: string | null;
  status: EntityReferenceSetStatus;
  updatedAt: Date;
}

export interface EntityReferenceContext {
  entityId: string;
  workId: string;
  userId: string;
  entityType: EntityType;
  name: string;
  freeDescription: string | null;
  structuredFields: Record<string, unknown>;
  promptSupplement: string | null;
  status: EntityStatus;
  referenceSet: EntityReferenceSet;
}

export interface EntityImportAnalysis {
  suggestedFields: Record<string, unknown>;
  promptSupplement: string;
  tmpImageS3Key: string;
  tmpImageCdnUrl: string;
}

export interface EntityGenerationQueuePayload {
  jobId: string;
  userId: string;
  entityId: string;
}

export interface PersistedEntityGenerationJobParams {
  entity_id: string;
  entity_type: EntityType;
  previous_entity_status: EntityStatus;
  target?: 'entity' | 'entity_state';
  source_s3_key?: string;
  entity_state_id?: string;
  base_primary_ref_id?: string;
  state_input_fingerprint?: string;
  state_revision?: string;
  state_name?: string;
  state_description?: string;
  image_model?: string;
  pricing_version?: string;
}
