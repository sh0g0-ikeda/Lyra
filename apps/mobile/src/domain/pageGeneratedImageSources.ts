import type { RemoteImageSource } from './entityReferenceImageSources';

interface PageGeneratedImageSourceInput {
  apiBaseUrl: string;
  authorizationHeader: string | null;
  cdnUrl?: string | null;
  episodeId: string;
  generatedAt: string | null;
  organizationId: string | null;
  pageId: string;
  sessionKey: string;
}

export interface PageGeneratedImageSources {
  identity: string;
  protectedSource: RemoteImageSource | null;
  publicSource: RemoteImageSource | null;
}

export function buildPageGeneratedImageSources(
  input: PageGeneratedImageSourceInput,
): PageGeneratedImageSources {
  const identity = [
    'page-generated-image',
    input.sessionKey,
    input.organizationId ?? 'personal',
    input.episodeId,
    input.pageId,
    input.generatedAt ?? 'unknown-revision',
  ].map(encodeURIComponent).join(':');

  return {
    identity,
    publicSource: publicHttpsSource(input.cdnUrl, identity),
    protectedSource: input.authorizationHeader === null
      ? null
      : protectedPageSource(input, identity),
  };
}

export function refreshPageGeneratedImageSource(
  source: RemoteImageSource,
  authorizationHeader: string,
): RemoteImageSource {
  return {
    ...source,
    cacheKey: source.cacheKey === undefined
      ? undefined
      : `${source.cacheKey}:refreshed`,
    headers: { Authorization: authorizationHeader },
  };
}

function publicHttpsSource(
  value: string | null | undefined,
  identity: string,
): RemoteImageSource | null {
  if (value === undefined || value === null || value.trim().length === 0) {
    return null;
  }
  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      ? { uri: url.toString(), cacheKey: `${identity}:public` }
      : null;
  } catch {
    return null;
  }
}

function protectedPageSource(
  input: PageGeneratedImageSourceInput,
  identity: string,
): RemoteImageSource | null {
  try {
    const baseUrl = input.apiBaseUrl.replace(/\/+$/u, '');
    const url = new URL(
      `${baseUrl}/api/pages/${encodeURIComponent(input.pageId)}/export-image`,
    );
    if (input.organizationId !== null) {
      url.searchParams.set('organization_id', input.organizationId);
    }
    return {
      uri: url.toString(),
      cacheKey: identity,
      headers: { Authorization: input.authorizationHeader! },
    };
  } catch {
    return null;
  }
}
