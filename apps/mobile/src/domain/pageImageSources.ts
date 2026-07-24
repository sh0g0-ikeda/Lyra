import {
  buildPageImageCacheKey,
  resolvePageImageDelivery,
  withPageImageRevision,
} from '@/domain/pageImageCache';
import type { PageRecord } from '@/domain/types';

export interface PageImageSource {
  uri: string;
  cacheKey: string;
  headers?: Record<string, string>;
}

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
  const revision =
    input.page.generated_image?.generated_at ?? input.page.updated_at;
  const cacheKey = buildPageImageCacheKey({
    sessionKey: input.sessionKey,
    organizationId: input.organizationId,
    pageId: input.page.id,
    revision,
    variant: 'full',
  });
  const delivery = resolvePageImageDelivery({
    cdnUrl: input.page.generated_image?.cdn_url,
    authenticatedFallbackUrl: buildAuthenticatedImageUrl(
      input.apiBaseUrl,
      input.page.id,
      'export-image',
      input.organizationId,
    ),
  });
  if (!delivery.requiresAuthentication) {
    return {
      uri: delivery.uri,
      cacheKey,
    };
  }

  return {
    uri: withPageImageRevision(delivery.uri, revision, cacheKey),
    cacheKey,
    ...authorizationHeaders(input.authorizationHeader),
  };
}

export function buildPageThumbnailImageSource(
  input: PageImageSourceInput,
): PageImageSource {
  const revision =
    input.page.generated_image?.generated_at ?? input.page.updated_at;
  const cacheKey = buildPageImageCacheKey({
    sessionKey: input.sessionKey,
    organizationId: input.organizationId,
    pageId: input.page.id,
    revision,
    variant: 'thumbnail',
  });
  const uri = buildAuthenticatedImageUrl(
    input.apiBaseUrl,
    input.page.id,
    'thumbnail',
    input.organizationId,
  );

  return {
    uri: withPageImageRevision(uri, revision, cacheKey),
    cacheKey,
    ...authorizationHeaders(input.authorizationHeader),
  };
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
