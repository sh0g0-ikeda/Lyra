import {
  deduplicateImageSources,
  publicHttpsImageSource,
  type RemoteImageSource
} from '@/domain/imageSourceCandidates';
import { withPageImageRevision } from '@/domain/pageImageCache';
import type { EntityReferenceImageRecord } from '@/domain/types';

interface EntityReferenceImageSourceInput {
  apiBaseUrl: string;
  authorizationHeader: string | null;
  entityId: string;
  organizationId: string | null;
  reference: EntityReferenceImageRecord;
  revision: string;
  sessionKey: string;
}

export function buildEntityReferenceImageSources(
  input: EntityReferenceImageSourceInput
): RemoteImageSource[] {
  const baseUrl = input.apiBaseUrl.replace(/\/+$/u, '');
  const url = new URL(
    `${baseUrl}/api/entities/${encodeURIComponent(input.entityId)}` +
      `/reference/${encodeURIComponent(input.reference.ref_id)}/image`
  );
  if (input.organizationId !== null) {
    url.searchParams.set('organization_id', input.organizationId);
  }
  const cacheKey = [
    'entity-reference-image',
    input.sessionKey,
    input.organizationId ?? 'personal',
    input.entityId,
    input.reference.ref_id,
    input.revision
  ].map(encodeURIComponent).join(':');

  return deduplicateImageSources([
    publicHttpsImageSource(input.reference.cdn_url),
    {
      uri: withPageImageRevision(
        url.toString(),
        input.revision,
        cacheKey
      ),
      cacheKey,
      ...(input.authorizationHeader === null
        ? {}
        : {
            headers: {
              Authorization: input.authorizationHeader
            }
          })
    }
  ]);
}
