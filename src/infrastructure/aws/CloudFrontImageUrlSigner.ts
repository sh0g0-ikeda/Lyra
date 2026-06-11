import { getSignedUrl } from '@aws-sdk/cloudfront-signer';
import { ConfigurationError } from '../../domain/errors/index.js';
import { env } from '../../lib/env.js';

export interface ImageCdnUrlSigner {
  sign(cdnUrl: string | null | undefined): string | null;
}

export interface CloudFrontImageUrlSignerOptions {
  cdnBaseUrl: string;
  keyPairId: string;
  privateKey: string;
  ttlSeconds: number;
  now?: () => Date;
}

/**
 * Signs only Lyra image CDN URLs. Persisted DB values stay as stable CDN URLs;
 * callers use this at response time so signed URLs can stay short-lived.
 */
export class CloudFrontImageUrlSigner implements ImageCdnUrlSigner {
  private readonly cdnBaseUrl: URL;
  private readonly privateKey: string;
  private readonly now: () => Date;

  public constructor(private readonly options: CloudFrontImageUrlSignerOptions) {
    this.cdnBaseUrl = new URL(normalizeBaseUrl(options.cdnBaseUrl));
    this.privateKey = normalizePrivateKey(options.privateKey);
    this.now = options.now ?? (() => new Date());
  }

  public sign(cdnUrl: string | null | undefined): string | null {
    if (cdnUrl === null || cdnUrl === undefined || cdnUrl.trim().length === 0) {
      return null;
    }

    const url = new URL(cdnUrl);
    if (!isSameCdnOrigin(this.cdnBaseUrl, url)) {
      throw new ConfigurationError('Image CDN URL is outside the configured CloudFront origin');
    }

    const expiresAt = new Date(this.now().getTime() + this.options.ttlSeconds * 1000);
    return getSignedUrl({
      url: url.toString(),
      keyPairId: this.options.keyPairId,
      privateKey: this.privateKey,
      dateLessThan: expiresAt.toISOString(),
    });
  }
}

export function resolveImageCdnUrlSigner(): ImageCdnUrlSigner | null {
  if (!env.IMAGE_CDN_SIGNING_ENABLED) {
    return null;
  }

  if (
    env.IMAGES_CDN_BASE_URL === undefined ||
    env.CLOUDFRONT_KEY_PAIR_ID === undefined ||
    env.CLOUDFRONT_PRIVATE_KEY === undefined
  ) {
    throw new ConfigurationError('CloudFront image URL signing is not configured');
  }

  return new CloudFrontImageUrlSigner({
    cdnBaseUrl: env.IMAGES_CDN_BASE_URL,
    keyPairId: env.CLOUDFRONT_KEY_PAIR_ID,
    privateKey: env.CLOUDFRONT_PRIVATE_KEY,
    ttlSeconds: env.CLOUDFRONT_SIGNED_URL_TTL_SECONDS,
  });
}

export function signImageCdnUrl(cdnUrl: string | null | undefined): string | null {
  const signer = resolveImageCdnUrlSigner();
  if (signer === null) {
    return null;
  }

  try {
    return signer.sign(cdnUrl);
  } catch (error) {
    if (error instanceof ConfigurationError) {
      return null;
    }

    throw error;
  }
}

function normalizeBaseUrl(value: string): string {
  return `${value.replace(/\/+$/u, '')}/`;
}

function normalizePrivateKey(value: string): string {
  return value.replace(/\\n/gu, '\n');
}

function isSameCdnOrigin(expectedBaseUrl: URL, candidateUrl: URL): boolean {
  return candidateUrl.protocol === expectedBaseUrl.protocol &&
    candidateUrl.hostname === expectedBaseUrl.hostname &&
    candidateUrl.port === expectedBaseUrl.port;
}
