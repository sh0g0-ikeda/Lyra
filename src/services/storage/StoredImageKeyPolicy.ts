import { ConfigurationError } from '../../domain/errors/index.js';

const IMAGE_EXTENSION_PATTERN = /\.(?:png|jpe?g|webp)$/iu;

export function ensureOwnedEntityReferenceImageKey(
  s3Key: string,
  userId: string,
  entityId: string,
  fieldName = 'entity reference image key',
): void {
  ensureSafeImageKey(s3Key, fieldName);

  const savedPrefix = `saved/${userId}/entities/${entityId}/`;
  if (!s3Key.startsWith(savedPrefix)) {
    throw new ConfigurationError(`${fieldName} is outside the owner scope`);
  }
}

export function ensureOwnedPageImageKey(
  s3Key: string,
  userId: string,
  pageId: string,
  fieldName = 'page image key',
): void {
  ensureSafeImageKey(s3Key, fieldName);

  const sessionPrefix = `session/${userId}/pages/${pageId}/`;
  const savedFinalPrefix = `saved/${userId}/pages/${pageId}_final.`;
  if (!s3Key.startsWith(sessionPrefix) && !s3Key.startsWith(savedFinalPrefix)) {
    throw new ConfigurationError(`${fieldName} is outside the owner scope`);
  }
}

function ensureSafeImageKey(s3Key: string, fieldName: string): void {
  if (s3Key.length === 0 || hasUnsafeImageKeySyntax(s3Key)) {
    throw new ConfigurationError(`${fieldName} is invalid`);
  }

  if (!IMAGE_EXTENSION_PATTERN.test(s3Key)) {
    throw new ConfigurationError(`${fieldName} has unsupported image extension`);
  }
}

function hasUnsafeImageKeySyntax(s3Key: string): boolean {
  if (s3Key.startsWith('/') || s3Key.includes('\\') || s3Key.includes('\0')) {
    return true;
  }

  return s3Key.split('/').some((segment) => (
    segment.length === 0 ||
    segment === '.' ||
    segment === '..'
  ));
}
