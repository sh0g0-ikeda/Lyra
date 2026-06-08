import { ValidationError } from '../../domain/errors/index.js';

export function ensureAllowedReferenceSourceKey(
  sourceS3Key: string,
  userId: string,
  entityId: string,
  fieldName = 'selected_s3_keys',
): void {
  const allowedPrefixes = [
    `tmp/${userId}/entities/imports/`,
    `session/${userId}/entities/${entityId}/`,
  ];

  if (!allowedPrefixes.some((prefix) => sourceS3Key.startsWith(prefix))) {
    throw new ValidationError(`${fieldName} contains an invalid image source`);
  }

  if (!hasAllowedImageExtension(sourceS3Key)) {
    throw new ValidationError(`${fieldName} contains an unsupported image source`);
  }
}

function hasAllowedImageExtension(s3Key: string): boolean {
  return /\.(?:png|jpe?g|webp)$/iu.test(s3Key);
}
