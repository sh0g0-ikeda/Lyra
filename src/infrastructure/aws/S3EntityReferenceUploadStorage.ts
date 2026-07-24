import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  ENTITY_REFERENCE_UPLOAD_SAFE_READ_ATTEMPTS,
  ENTITY_REFERENCE_UPLOAD_SAFE_READ_RETRY_DELAY_MS,
  ENTITY_REFERENCE_UPLOAD_SAFE_READ_TIMEOUT_MS,
  isEntityReferenceUploadSize,
  type EntityReferenceUploadMimeType,
} from '../../domain/constants/entityReferenceUpload.js';
import { ConfigurationError } from '../../domain/errors/index.js';
import { SESSION_IMAGE_CACHE_CONTROL } from './S3ImageCacheControl.js';
import { buildStoredImageUrl } from './S3StoredImageUrl.js';

export interface EntityReferenceUploadStoragePort {
  createPresignedPutUrl(input: {
    s3Key: string;
    mimeType: EntityReferenceUploadMimeType;
    sizeBytes: number;
    expiresInSeconds: number;
  }): Promise<string>;
  loadUploadedImage(input: {
    s3Key: string;
    mimeType: EntityReferenceUploadMimeType;
    sizeBytes: number;
  }): Promise<LoadedEntityReferenceUploadImage | null>;
}

export interface LoadedEntityReferenceUploadImage {
  imageData: Buffer;
  mimeType: EntityReferenceUploadMimeType;
  cdnUrl: string;
}

export interface S3EntityReferenceUploadStorageOptions {
  bucketName: string;
  cdnBaseUrl?: string;
  uploadUrlTtlSeconds: number;
  safeReadTimeoutMs?: number;
  maxSafeReadAttempts?: number;
  retryDelayMs?: number;
}

export type EntityReferenceUploadPresigner = (
  client: S3Client,
  command: PutObjectCommand,
  expiresInSeconds: number,
) => Promise<string>;

/**
 * Only S3 reads are retried. The API does not perform the client PUT, so an
 * upload cannot be duplicated by server retry behavior.
 */
export class S3EntityReferenceUploadStorage implements EntityReferenceUploadStoragePort {
  public constructor(
    private readonly client: S3Client,
    private readonly options: S3EntityReferenceUploadStorageOptions,
    private readonly presignPutUrl: EntityReferenceUploadPresigner = defaultPresignPutUrl,
  ) {}

  public async createPresignedPutUrl(input: {
    s3Key: string;
    mimeType: EntityReferenceUploadMimeType;
    sizeBytes: number;
    expiresInSeconds: number;
  }): Promise<string> {
    validateTemporaryUploadKey(input.s3Key, input.mimeType);
    if (!isEntityReferenceUploadSize(input.sizeBytes)) {
      throw new ConfigurationError('Entity reference upload size is invalid');
    }
    if (
      !Number.isInteger(input.expiresInSeconds) ||
      input.expiresInSeconds <= 0 ||
      input.expiresInSeconds > this.options.uploadUrlTtlSeconds
    ) {
      throw new ConfigurationError('Entity reference upload URL expiry is invalid');
    }

    try {
      return await this.presignPutUrl(
        this.client,
        new PutObjectCommand({
          Bucket: this.options.bucketName,
          Key: input.s3Key,
          ContentType: input.mimeType,
          ContentLength: input.sizeBytes,
          CacheControl: SESSION_IMAGE_CACHE_CONTROL,
          ServerSideEncryption: 'AES256',
        }),
        input.expiresInSeconds,
      );
    } catch {
      throw new ConfigurationError('Unable to create upload URL');
    }
  }

  public async loadUploadedImage(input: {
    s3Key: string;
    mimeType: EntityReferenceUploadMimeType;
    sizeBytes: number;
  }): Promise<LoadedEntityReferenceUploadImage | null> {
    validateTemporaryUploadKey(input.s3Key, input.mimeType);
    if (!Number.isInteger(input.sizeBytes) || input.sizeBytes <= 0) {
      throw new ConfigurationError('Entity reference upload size is invalid');
    }

    const head = await this.executeSafeRead((abortSignal) => this.client.send(
      new HeadObjectCommand({
        Bucket: this.options.bucketName,
        Key: input.s3Key,
      }),
      { abortSignal },
    ));
    if (head === null || head.ContentLength !== input.sizeBytes || head.ContentType !== input.mimeType) {
      return null;
    }

    return this.executeSafeRead(async (abortSignal) => {
      const object = await this.client.send(
        new GetObjectCommand({
          Bucket: this.options.bucketName,
          Key: input.s3Key,
        }),
        { abortSignal },
      );
      if (object.ContentType !== input.mimeType || !hasByteArrayBody(object.Body)) {
        return null;
      }

      const imageData = Buffer.from(await object.Body.transformToByteArray());
      if (imageData.length !== input.sizeBytes) {
        return null;
      }

      return {
        imageData,
        mimeType: input.mimeType,
        cdnUrl: buildStoredImageUrl(this.options, input.s3Key),
      };
    });
  }

  private async executeSafeRead<T>(operation: (abortSignal: AbortSignal) => Promise<T>): Promise<T | null> {
    const attempts = this.options.maxSafeReadAttempts ?? ENTITY_REFERENCE_UPLOAD_SAFE_READ_ATTEMPTS;
    const retryDelayMs = this.options.retryDelayMs ?? ENTITY_REFERENCE_UPLOAD_SAFE_READ_RETRY_DELAY_MS;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await runWithTimeout(
          operation,
          this.options.safeReadTimeoutMs ?? ENTITY_REFERENCE_UPLOAD_SAFE_READ_TIMEOUT_MS,
        );
      } catch (error) {
        if (isNotFoundError(error)) {
          return null;
        }
        if (!isRetryableS3ReadError(error) || attempt === attempts) {
          throw new ConfigurationError('Unable to verify uploaded image');
        }
        await delay(retryDelayMs);
      }
    }

    throw new ConfigurationError('Unable to verify uploaded image');
  }
}

async function defaultPresignPutUrl(
  client: S3Client,
  command: PutObjectCommand,
  expiresInSeconds: number,
): Promise<string> {
  return getSignedUrl(client, command, { expiresIn: expiresInSeconds });
}

async function runWithTimeout<T>(
  operation: (abortSignal: AbortSignal) => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await operation(controller.signal);
  } finally {
    clearTimeout(timeout);
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function hasByteArrayBody(value: unknown): value is { transformToByteArray(): Promise<Uint8Array> } {
  return typeof value === 'object' && value !== null && 'transformToByteArray' in value &&
    typeof value.transformToByteArray === 'function';
}

function isNotFoundError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  const name = 'name' in error && typeof error.name === 'string' ? error.name : '';
  if (name === 'NoSuchKey' || name === 'NotFound') {
    return true;
  }

  if (!('$metadata' in error) || typeof error.$metadata !== 'object' || error.$metadata === null) {
    return false;
  }

  return 'httpStatusCode' in error.$metadata && error.$metadata.httpStatusCode === 404;
}

function isRetryableS3ReadError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  const name = 'name' in error && typeof error.name === 'string' ? error.name : '';
  const code = 'code' in error && typeof error.code === 'string' ? error.code : '';
  if (
    name === 'AbortError' ||
    name === 'TimeoutError' ||
    name === 'RequestTimeout' ||
    name === 'NetworkingError' ||
    code === 'ECONNRESET' ||
    code === 'ETIMEDOUT' ||
    code === 'EAI_AGAIN'
  ) {
    return true;
  }

  if (!('$metadata' in error) || typeof error.$metadata !== 'object' || error.$metadata === null) {
    return false;
  }

  const statusCode = 'httpStatusCode' in error.$metadata
    ? error.$metadata.httpStatusCode
    : undefined;
  return typeof statusCode === 'number' && (statusCode === 429 || (statusCode >= 500 && statusCode <= 599));
}

function validateTemporaryUploadKey(s3Key: string, mimeType: EntityReferenceUploadMimeType): void {
  const segments = s3Key.split('/');
  const expectedExtension = mimeType === 'image/jpeg' ? 'jpeg' : mimeType.slice('image/'.length);
  if (
    segments.length !== 5 ||
    segments[0] !== 'tmp' ||
    segments[1] === undefined ||
    segments[1].length === 0 ||
    segments[2] !== 'entities' ||
    segments[3] !== 'imports' ||
    !new RegExp(`^[0-9a-f-]+\\.${expectedExtension}$`, 'u').test(segments[4] ?? '') ||
    s3Key.includes('\\') ||
    s3Key.includes('\0') ||
    segments.some((segment) => segment === '.' || segment === '..' || segment.length === 0)
  ) {
    throw new ConfigurationError('Entity reference upload key is invalid');
  }
}
