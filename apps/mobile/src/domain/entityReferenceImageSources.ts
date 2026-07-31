export interface RemoteImageSource {
  uri: string;
  cacheKey?: string;
  headers?: Record<string, string>;
}

interface EntityReferenceImageSourceInput {
  apiBaseUrl: string;
  authorizationHeader: string | null;
  cdnUrl?: string;
  entityId: string;
  organizationId: string | null;
  refId: string;
  revision: string;
  sessionKey: string;
}

export interface EntityReferenceImageSources {
  identity: string;
  protectedSource: RemoteImageSource | null;
  publicSource: RemoteImageSource | null;
}

export function buildEntityReferenceImageSources(
  input: EntityReferenceImageSourceInput,
): EntityReferenceImageSources {
  const identity = [
    'entity-reference-image',
    input.sessionKey,
    input.organizationId ?? 'personal',
    input.entityId,
    input.refId,
    input.revision,
  ].map(encodeURIComponent).join(':');

  return {
    identity,
    publicSource: publicHttpsSource(input.cdnUrl, identity),
    protectedSource: input.authorizationHeader === null
      ? null
      : protectedReferenceSource(input, identity),
  };
}

export function refreshProtectedImageSource(
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
  value: string | undefined,
  identity: string,
): RemoteImageSource | null {
  if (value === undefined || value.trim().length === 0) {
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

function protectedReferenceSource(
  input: EntityReferenceImageSourceInput,
  identity: string,
): RemoteImageSource | null {
  try {
    const baseUrl = input.apiBaseUrl.replace(/\/+$/u, '');
    const url = new URL(
      `${baseUrl}/api/entities/${encodeURIComponent(input.entityId)}`
        + `/reference/${encodeURIComponent(input.refId)}/image`,
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
