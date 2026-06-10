import { ValidationError } from '../../domain/errors/index.js';

export function ensureAllowedReferenceSourceKey(
  sourceS3Key: string,
  userId: string,
  entityId: string,
  fieldName = 'selected_s3_keys',
): void {
  if (hasUnsafePathSyntax(sourceS3Key)) {
    throw new ValidationError(`${fieldName} contains an invalid image source`);
  }

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

function hasUnsafePathSyntax(s3Key: string): boolean {
  if (s3Key.includes('\\') || s3Key.includes('\0')) {
    return true;
  }

  return s3Key.split('/').some((segment) => (
    segment.length === 0 ||
    segment === '.' ||
    segment === '..'
  ));
}
