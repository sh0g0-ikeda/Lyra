import { ENTITY_IMPORT_MAX_FILE_SIZE_BYTES } from './entityReference.js';

export const ENTITY_REFERENCE_UPLOAD_PURPOSE = 'entity_reference_import' as const;
export const ENTITY_REFERENCE_UPLOAD_MAX_SIZE_BYTES = ENTITY_IMPORT_MAX_FILE_SIZE_BYTES;
export const ENTITY_REFERENCE_UPLOAD_MAX_TTL_SECONDS = 10 * 60;
export const ENTITY_REFERENCE_UPLOAD_PRESIGN_TTL_SECONDS = 5 * 60;
export const ENTITY_REFERENCE_UPLOAD_TOKEN_BYTES = 32;
export const ENTITY_REFERENCE_UPLOAD_MAX_TOKEN_LENGTH = 512;
export const ENTITY_REFERENCE_UPLOAD_SAFE_READ_TIMEOUT_MS = 10_000;
export const ENTITY_REFERENCE_UPLOAD_SAFE_READ_ATTEMPTS = 2;
export const ENTITY_REFERENCE_UPLOAD_SAFE_READ_RETRY_DELAY_MS = 200;

export const ENTITY_REFERENCE_UPLOAD_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

export type EntityReferenceUploadMimeType = (typeof ENTITY_REFERENCE_UPLOAD_MIME_TYPES)[number];

export function isEntityReferenceUploadMimeType(
  value: string,
): value is EntityReferenceUploadMimeType {
  return ENTITY_REFERENCE_UPLOAD_MIME_TYPES.includes(
    value as EntityReferenceUploadMimeType,
  );
}

export function isEntityReferenceUploadSize(sizeBytes: number): boolean {
  return Number.isInteger(sizeBytes)
    && sizeBytes > 0
    && sizeBytes <= ENTITY_REFERENCE_UPLOAD_MAX_SIZE_BYTES;
}

export function extensionForEntityReferenceUploadMimeType(
  mimeType: EntityReferenceUploadMimeType,
): 'png' | 'jpeg' | 'webp' {
  if (mimeType === 'image/jpeg') {
    return 'jpeg';
  }
  if (mimeType === 'image/webp') {
    return 'webp';
  }
  return 'png';
}

export function imageDataMatchesEntityReferenceUploadMimeType(
  imageData: Buffer,
  mimeType: EntityReferenceUploadMimeType,
): boolean {
  if (mimeType === 'image/png') {
    return startsWithBytes(imageData, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  }
  if (mimeType === 'image/jpeg') {
    return startsWithBytes(imageData, [0xff, 0xd8, 0xff]);
  }
  return imageData.length >= 12
    && imageData.subarray(0, 4).toString('ascii') === 'RIFF'
    && imageData.subarray(8, 12).toString('ascii') === 'WEBP';
}

function startsWithBytes(value: Buffer, expectedBytes: number[]): boolean {
  return value.length >= expectedBytes.length
    && expectedBytes.every((expectedByte, index) => value[index] === expectedByte);
}
