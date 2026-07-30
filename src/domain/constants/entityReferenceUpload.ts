import { ENTITY_IMPORT_MAX_FILE_SIZE_BYTES } from './entityReference.js';

export const ENTITY_REFERENCE_UPLOAD_PURPOSE = 'entity_reference_import' as const;
export const ENTITY_REFERENCE_UPLOAD_MAX_SIZE_BYTES = ENTITY_IMPORT_MAX_FILE_SIZE_BYTES;
export const ENTITY_REFERENCE_UPLOAD_MAX_TTL_SECONDS = 10 * 60;

export const ENTITY_REFERENCE_UPLOAD_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

export type EntityReferenceUploadMimeType = (typeof ENTITY_REFERENCE_UPLOAD_MIME_TYPES)[number];
