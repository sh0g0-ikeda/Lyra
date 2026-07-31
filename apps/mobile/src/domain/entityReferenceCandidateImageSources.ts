import type { RemoteImageSource } from './entityReferenceImageSources';

interface EntityReferenceCandidateImageSourceInput {
  apiBaseUrl: string;
  authorizationHeader: string | null;
  candidateToken: string;
  entityId: string;
  organizationId: string | null;
  revision: string;
  sessionKey: string;
}

export interface EntityReferenceCandidateImageSource {
  identity: string;
  protectedSource: RemoteImageSource | null;
}

export function buildEntityReferenceCandidateImageSource(
  input: EntityReferenceCandidateImageSourceInput,
): EntityReferenceCandidateImageSource {
  const identity = [
    'entity-reference-candidate-image',
    input.sessionKey,
    input.organizationId ?? 'personal',
    input.entityId,
    input.revision,
  ].map(encodeURIComponent).join(':');

  if (input.authorizationHeader === null) {
    return { identity, protectedSource: null };
  }
  try {
    const baseUrl = input.apiBaseUrl.replace(/\/+$/u, '');
    const url = new URL(
      `${baseUrl}/api/entities/${encodeURIComponent(input.entityId)}`
        + '/reference-candidate-image',
    );
    url.searchParams.set('candidate_token', input.candidateToken);
    if (input.organizationId !== null) {
      url.searchParams.set('organization_id', input.organizationId);
    }
    return {
      identity,
      protectedSource: {
        uri: url.toString(),
        cacheKey: identity,
        headers: { Authorization: input.authorizationHeader },
      },
    };
  } catch {
    return { identity, protectedSource: null };
  }
}
