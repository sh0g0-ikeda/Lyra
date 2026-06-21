export interface S3StoredImageUrlOptions {
  bucketName: string;
  cdnBaseUrl?: string;
}

export interface ParsedS3StoredImageUrl {
  bucketName: string;
  key: string;
}

/**
 * Persists a stable image locator. CloudFront deployments keep the previous
 * CDN URL shape; temporary S3-presigned deployments store an internal s3 URI.
 */
export function buildStoredImageUrl(options: S3StoredImageUrlOptions, key: string): string {
  if (options.cdnBaseUrl !== undefined) {
    return new URL(key, `${options.cdnBaseUrl.replace(/\/+$/u, '')}/`).toString();
  }

  return `s3://${options.bucketName}/${key}`;
}

export function parseS3StoredImageUrl(value: string): ParsedS3StoredImageUrl | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  if (url.protocol !== 's3:' || url.hostname.length === 0) {
    return null;
  }

  const key = decodeURIComponent(url.pathname.replace(/^\/+/u, ''));
  if (key.length === 0 || hasUnsafeImageKeySyntax(key)) {
    return null;
  }

  return {
    bucketName: url.hostname,
    key,
  };
}

function hasUnsafeImageKeySyntax(s3Key: string): boolean {
  if (s3Key.includes('\\') || s3Key.includes('\0')) {
    return true;
  }

  return s3Key.split('/').some((segment) => (
    segment.length === 0 ||
    segment === '.' ||
    segment === '..'
  ));
}
