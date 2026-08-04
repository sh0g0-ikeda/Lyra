import {
  buildPageImageCacheKey,
  resolvePageImageDelivery,
  withPageImageRevision,
} from '@/domain/pageImageCache';
import {
  deduplicateImageSources,
  type RemoteImageSource,
} from '@/domain/imageSourceCandidates';
import type { PageRecord } from '@/domain/types';

export type PageImageSource = RemoteImageSource & { cacheKey: string };

interface PageImageSourceInput {
  apiBaseUrl: string;
  authorizationHeader: string | null;
  organizationId: string | null;
  page: PageRecord;
  sessionKey: string;
}

export function buildFullPageImageSource(
  input: PageImageSourceInput,
): PageImageSource {
  const source = buildFullPageImageSources(input)[0];
  if (source === undefined || source.cacheKey === undefined) {
    throw new Error('A page image source could not be built.');
  }
  return { ...source, cacheKey: source.cacheKey };
}

export function buildFullPageImageSources(
  input: PageImageSourceInput,
): RemoteImageSource[] {
  const revision =
    input.page.generated_image?.generated_at ?? input.page.updated_at;
  const fullCacheKey = buildPageImageCacheKey({
    sessionKey: input.sessionKey,
    organizationId: input.organizationId,
    pageId: input.page.id,
    revision,
    variant: 'full',
  });
  const thumbnailCacheKey = buildPageImageCacheKey({
    sessionKey: input.sessionKey,
    organizationId: input.organizationId,
    pageId: input.page.id,
    revision,
    variant: 'thumbnail',
  });
  const authenticatedFullUrl = buildAuthenticatedImageUrl(
    input.apiBaseUrl,
    input.page.id,
    'export-image',
    input.organizationId,
  );
  const authenticatedThumbnailUrl = buildAuthenticatedImageUrl(
    input.apiBaseUrl,
    input.page.id,
    'thumbnail',
    input.organizationId,
  );
  const delivery = resolvePageImageDelivery({
    cdnUrl: input.page.generated_image?.cdn_url,
    authenticatedFallbackUrl: authenticatedFullUrl,
  });
  return deduplicateImageSources([
    delivery.requiresAuthentication
      ? null
      : {
          uri: delivery.uri,
          cacheKey: fullCacheKey,
        },
    {
      uri: withPageImageRevision(
        authenticatedFullUrl,
        revision,
        fullCacheKey,
      ),
      cacheKey: fullCacheKey,
      ...authorizationHeaders(input.authorizationHeader),
    },
    {
      uri: withPageImageRevision(
        authenticatedThumbnailUrl,
        revision,
        thumbnailCacheKey,
      ),
      cacheKey: thumbnailCacheKey,
      ...authorizationHeaders(input.authorizationHeader),
    },
  ]);
}

export function buildPageImageDownloadSources(
  input: PageImageSourceInput,
): RemoteImageSource[] {
  const revision =
    input.page.generated_image?.generated_at ?? input.page.updated_at;
  const fullCacheKey = buildPageImageCacheKey({
    sessionKey: input.sessionKey,
    organizationId: input.organizationId,
    pageId: input.page.id,
    revision,
    variant: 'full',
  });
  const authenticatedFullUrl = buildAuthenticatedImageUrl(
    input.apiBaseUrl,
    input.page.id,
    'export-image',
    input.organizationId,
  );
  return deduplicateImageSources([
    {
      uri: withPageImageRevision(
        authenticatedFullUrl,
        revision,
        fullCacheKey,
      ),
      cacheKey: fullCacheKey,
      ...authorizationHeaders(input.authorizationHeader),
    },
  ]);
}

export function buildPageThumbnailImageSource(
  input: PageImageSourceInput,
): PageImageSource {
  const source = buildPageThumbnailImageSources(input)[0];
  if (source === undefined || source.cacheKey === undefined) {
    throw new Error('A page thumbnail source could not be built.');
  }
  return { ...source, cacheKey: source.cacheKey };
}

export function buildPageThumbnailImageSources(
  input: PageImageSourceInput,
): RemoteImageSource[] {
  const revision =
    input.page.generated_image?.generated_at ?? input.page.updated_at;
  const thumbnailCacheKey = buildPageImageCacheKey({
    sessionKey: input.sessionKey,
    organizationId: input.organizationId,
    pageId: input.page.id,
    revision,
    variant: 'thumbnail',
  });
  const fullCacheKey = buildPageImageCacheKey({
    sessionKey: input.sessionKey,
    organizationId: input.organizationId,
    pageId: input.page.id,
    revision,
    variant: 'full',
  });
  const authenticatedThumbnailUrl = buildAuthenticatedImageUrl(
    input.apiBaseUrl,
    input.page.id,
    'thumbnail',
    input.organizationId,
  );
  const authenticatedFullUrl = buildAuthenticatedImageUrl(
    input.apiBaseUrl,
    input.page.id,
    'export-image',
    input.organizationId,
  );
  const delivery = resolvePageImageDelivery({
    cdnUrl: input.page.generated_image?.cdn_url,
    authenticatedFallbackUrl: authenticatedFullUrl,
  });
  return deduplicateImageSources([
    {
      uri: withPageImageRevision(
        authenticatedThumbnailUrl,
        revision,
        thumbnailCacheKey,
      ),
      cacheKey: thumbnailCacheKey,
      ...authorizationHeaders(input.authorizationHeader),
    },
    delivery.requiresAuthentication
      ? null
      : {
          uri: delivery.uri,
          cacheKey: fullCacheKey,
        },
    {
      uri: withPageImageRevision(
        authenticatedFullUrl,
        revision,
        fullCacheKey,
      ),
      cacheKey: fullCacheKey,
      ...authorizationHeaders(input.authorizationHeader),
    },
  ]);
}

function buildAuthenticatedImageUrl(
  apiBaseUrl: string,
  pageId: string,
  variant: 'export-image' | 'thumbnail',
  organizationId: string | null,
): string {
  const baseUrl = apiBaseUrl.replace(/\/+$/u, '');
  const url = new URL(
    `${baseUrl}/api/pages/${encodeURIComponent(pageId)}/${variant}`,
  );
  if (organizationId !== null) {
    url.searchParams.set('organization_id', organizationId);
  }
  return url.toString();
}

function authorizationHeaders(
  authorizationHeader: string | null,
): { headers?: Record<string, string> } {
  return authorizationHeader === null
    ? {}
    : { headers: { Authorization: authorizationHeader } };
}
