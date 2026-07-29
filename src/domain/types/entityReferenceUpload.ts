import type {
  EntityReferenceUploadMimeType,
  ENTITY_REFERENCE_UPLOAD_PURPOSE,
} from '../constants/entityReferenceUpload.js';

export type EntityReferenceUploadPurpose = typeof ENTITY_REFERENCE_UPLOAD_PURPOSE;

export interface EntityReferenceUploadToken {
  id: string;
  tokenHash: string;
  userId: string;
  organizationId: string | null;
  entityId: string | null;
  purpose: EntityReferenceUploadPurpose;
  mimeType: EntityReferenceUploadMimeType;
  sizeBytes: number;
  s3Key: string;
  expiresAt: Date;
  consumedAt: Date | null;
  createdAt: Date;
}
