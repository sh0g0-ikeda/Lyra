interface PageImageCacheIdentity {
  sessionKey: string;
  organizationId: string | null;
  pageId: string;
  revision: string;
  variant?: 'full' | 'thumbnail';
}

export interface PageImageDelivery {
  uri: string;
  requiresAuthentication: boolean;
}

export function resolvePageImageDelivery(input: {
  cdnUrl: string | null | undefined;
  authenticatedFallbackUrl: string;
}): PageImageDelivery {
  const cdnUrl = normalizeHttpsUrl(input.cdnUrl);
  if (cdnUrl !== null) {
    return {
      uri: cdnUrl,
      requiresAuthentication: false
    };
  }
  return {
    uri: input.authenticatedFallbackUrl,
    requiresAuthentication: true
  };
}

export function buildPageImageCacheKey(identity: PageImageCacheIdentity): string {
  return [
    'page-image',
    identity.variant ?? 'full',
    identity.sessionKey,
    identity.organizationId ?? 'personal',
    identity.pageId,
    identity.revision
  ].map(encodeURIComponent).join(':');
}

export function withPageImageRevision(uri: string, revision: string, cacheIdentity: string): string {
  const url = new URL(uri);
  url.searchParams.set('image_revision', revision);
  url.searchParams.set('image_scope', hashCacheIdentity(cacheIdentity));
  return url.toString();
}

function normalizeHttpsUrl(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value.trim().length === 0) {
    return null;
  }
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? value : null;
  } catch {
    return null;
  }
}

function hashCacheIdentity(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
