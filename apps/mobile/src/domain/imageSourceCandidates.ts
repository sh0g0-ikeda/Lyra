export interface RemoteImageSource {
  uri: string;
  cacheKey?: string;
  headers?: Record<string, string>;
}

export function imageSourceListIdentity(
  sources: readonly RemoteImageSource[]
): string {
  return sources.map(imageSourceIdentity).join('\n---\n');
}

export function deduplicateImageSources(
  sources: readonly (RemoteImageSource | null)[]
): RemoteImageSource[] {
  const seen = new Set<string>();
  return sources.flatMap((source) => {
    if (source === null || source.uri.trim().length === 0) {
      return [];
    }
    const identity = imageSourceIdentity(source);
    if (seen.has(identity)) {
      return [];
    }
    seen.add(identity);
    return [source];
  });
}

function imageSourceIdentity(source: RemoteImageSource): string {
  return [
    source.uri,
    source.cacheKey ?? '',
    JSON.stringify(source.headers ?? {})
  ].join('\n');
}

export function publicHttpsImageSource(
  uri: string | null | undefined
): RemoteImageSource | null {
  if (uri === null || uri === undefined || uri.trim().length === 0) {
    return null;
  }
  try {
    const parsed = new URL(uri);
    return parsed.protocol === 'https:' ? { uri } : null;
  } catch {
    return null;
  }
}
