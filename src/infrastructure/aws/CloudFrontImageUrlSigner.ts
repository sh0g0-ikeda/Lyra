import { getSignedUrl as getCloudFrontSignedUrl } from '@aws-sdk/cloudfront-signer';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl as getS3SignedUrl } from '@aws-sdk/s3-request-presigner';
import { ConfigurationError } from '../../domain/errors/index.js';
import { env } from '../../lib/env.js';
import { createPageImageStorageClient } from './S3PageImageStorage.js';
import { parseS3StoredImageUrl } from './S3StoredImageUrl.js';

export interface ImageCdnUrlSigner {
  sign(cdnUrl: string | null | undefined): string | null;
}

export interface ImageUrlSignTarget {
  cdnUrl?: string | null;
  s3Key?: string | null;
}

export interface AsyncImageUrlSigner {
  sign(target: ImageUrlSignTarget): Promise<string | null>;
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
    return getCloudFrontSignedUrl({
      url: url.toString(),
      keyPairId: this.options.keyPairId,
      privateKey: this.privateKey,
      dateLessThan: expiresAt.toISOString(),
    });
  }
}

export interface S3PresignedImageUrlSignerOptions {
  client: S3Client;
  bucketName: string;
  ttlSeconds: number;
}

export class S3PresignedImageUrlSigner implements AsyncImageUrlSigner {
  public constructor(private readonly options: S3PresignedImageUrlSignerOptions) {}

  public async sign(target: ImageUrlSignTarget): Promise<string | null> {
    const key = resolveS3ObjectKey(target, this.options.bucketName);
    if (key === null) {
      return null;
    }

    return getS3SignedUrl(
      this.options.client,
      new GetObjectCommand({
        Bucket: this.options.bucketName,
        Key: key,
      }),
      {
        expiresIn: this.options.ttlSeconds,
      },
    );
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

export function resolveImageUrlSigner(): AsyncImageUrlSigner | null {
  if (env.IMAGE_DELIVERY_MODE === 's3_presigned') {
    if (env.S3_BUCKET_IMAGES === undefined) {
      throw new ConfigurationError('S3 presigned image delivery is not configured');
    }

    return new S3PresignedImageUrlSigner({
      client: createPageImageStorageClient(env.AWS_REGION),
      bucketName: env.S3_BUCKET_IMAGES,
      ttlSeconds: env.S3_PRESIGNED_URL_TTL_SECONDS,
    });
  }

  const signer = resolveImageCdnUrlSigner();
  if (signer === null) {
    return null;
  }

  return {
    async sign(target: ImageUrlSignTarget): Promise<string | null> {
      return signer.sign(target.cdnUrl);
    },
  };
}

export async function signImageCdnUrl(
  cdnUrl: string | null | undefined,
  s3Key?: string | null,
): Promise<string | null> {
  const signer = resolveImageUrlSigner();
  if (signer === null) {
    return null;
  }

  try {
    return await signer.sign({ cdnUrl, s3Key });
  } catch (error) {
    if (error instanceof ConfigurationError) {
      return null;
    }

    throw error;
  }
}

function resolveS3ObjectKey(target: ImageUrlSignTarget, expectedBucketName: string): string | null {
  if (target.s3Key !== null && target.s3Key !== undefined && target.s3Key.trim().length > 0) {
    const key = target.s3Key.trim();
    if (hasUnsafeImageKeySyntax(key)) {
      throw new ConfigurationError('S3 image key has unsafe syntax');
    }

    return key;
  }

  if (target.cdnUrl === null || target.cdnUrl === undefined || target.cdnUrl.trim().length === 0) {
    return null;
  }

  const parsed = parseS3StoredImageUrl(target.cdnUrl);
  if (parsed === null) {
    return null;
  }

  if (parsed.bucketName !== expectedBucketName) {
    throw new ConfigurationError('S3 image URL is outside the configured bucket');
  }

  return parsed.key;
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
