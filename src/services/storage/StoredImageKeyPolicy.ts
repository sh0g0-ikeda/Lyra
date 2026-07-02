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
  if (!s3Key.startsWith(sessionPrefix) && !isOwnedFinalPageImageKey(s3Key, userId, pageId)) {
    throw new ConfigurationError(`${fieldName} is outside the owner scope`);
  }
}

export function ensurePageImageKeyForPage(
  s3Key: string,
  pageId: string,
  fieldName = 'page image key',
): void {
  ensureSafeImageKey(s3Key, fieldName);

  if (isPageSessionImageKey(s3Key, pageId) || isFinalPageImageKey(s3Key, pageId)) {
    return;
  }

  throw new ConfigurationError(`${fieldName} is outside the page scope`);
}

function isOwnedFinalPageImageKey(s3Key: string, userId: string, pageId: string): boolean {
  const savedFinalPrefix = `saved/${userId}/pages/${pageId}_final.`;
  if (!s3Key.startsWith(savedFinalPrefix)) {
    return false;
  }

  const extension = s3Key.slice(savedFinalPrefix.length).toLowerCase();
  return extension === 'png' || extension === 'jpg' || extension === 'jpeg' || extension === 'webp';
}

function isPageSessionImageKey(s3Key: string, pageId: string): boolean {
  const segments = s3Key.split('/');
  return (
    segments.length >= 5 &&
    segments[0] === 'session' &&
    segments[2] === 'pages' &&
    segments[3] === pageId
  );
}

function isFinalPageImageKey(s3Key: string, pageId: string): boolean {
  const savedFinalMarker = `/pages/${pageId}_final.`;
  if (!s3Key.startsWith('saved/') || !s3Key.includes(savedFinalMarker)) {
    return false;
  }

  const extension = s3Key.slice(s3Key.indexOf(savedFinalMarker) + savedFinalMarker.length).toLowerCase();
  return extension === 'png' || extension === 'jpg' || extension === 'jpeg' || extension === 'webp';
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
