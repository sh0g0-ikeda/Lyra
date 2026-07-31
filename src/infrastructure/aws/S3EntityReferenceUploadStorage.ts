import {
  CopyObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  ENTITY_REFERENCE_UPLOAD_MAX_TTL_SECONDS,
  ENTITY_REFERENCE_UPLOAD_SAFE_READ_ATTEMPTS,
  ENTITY_REFERENCE_UPLOAD_SAFE_READ_RETRY_DELAY_MS,
  ENTITY_REFERENCE_UPLOAD_SAFE_READ_TIMEOUT_MS,
  extensionForEntityReferenceUploadMimeType,
  isEntityReferenceUploadSize,
  type EntityReferenceUploadMimeType,
} from '../../domain/constants/entityReferenceUpload.js';
import { ConfigurationError } from '../../domain/errors/index.js';
import type {
  EntityReferenceUploadStoragePort,
  LoadedEntityReferenceUploadImage,
} from '../../services/entity/EntityReferenceUploadStorage.js';
import { SESSION_IMAGE_CACHE_CONTROL } from './S3ImageCacheControl.js';
import { buildStoredImageUrl } from './S3StoredImageUrl.js';

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
      !Number.isInteger(input.expiresInSeconds)
      || input.expiresInSeconds <= 0
      || input.expiresInSeconds > this.options.uploadUrlTtlSeconds
      || input.expiresInSeconds > ENTITY_REFERENCE_UPLOAD_MAX_TTL_SECONDS
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
    if (!isEntityReferenceUploadSize(input.sizeBytes)) {
      throw new ConfigurationError('Entity reference upload size is invalid');
    }

    const head = await this.executeSafeOperation((abortSignal) => this.client.send(
      new HeadObjectCommand({
        Bucket: this.options.bucketName,
        Key: input.s3Key,
      }),
      { abortSignal },
    ));
    if (
      head === null
      || head.ContentLength !== input.sizeBytes
      || head.ContentType !== input.mimeType
      || !isSafeETag(head.ETag)
    ) {
      return null;
    }
    const verifiedETag = head.ETag;

    return this.executeSafeOperation(async (abortSignal) => {
      const object = await this.client.send(
        new GetObjectCommand({
          Bucket: this.options.bucketName,
          Key: input.s3Key,
          Range: `bytes=0-${input.sizeBytes - 1}`,
        }),
        { abortSignal },
      );
      if (
        object.ContentType !== input.mimeType
        || object.ContentLength !== input.sizeBytes
        || !contentRangeMatchesSize(object.ContentRange, input.sizeBytes)
        || object.ETag !== verifiedETag
        || !hasByteArrayBody(object.Body)
      ) {
        return null;
      }

      const imageData = Buffer.from(await object.Body.transformToByteArray());
      if (imageData.length !== input.sizeBytes) {
        return null;
      }

      return {
        imageData,
        mimeType: input.mimeType,
        eTag: verifiedETag,
        cdnUrl: buildStoredImageUrl(this.options, input.s3Key),
      };
    });
  }

  public async stabilizeUploadedImage(input: {
    sourceS3Key: string;
    destinationS3Key: string;
    mimeType: EntityReferenceUploadMimeType;
    eTag: string;
  }): Promise<{ s3Key: string; cdnUrl: string }> {
    validateTemporaryUploadKey(input.sourceS3Key, input.mimeType);
    validateTemporaryUploadKey(input.destinationS3Key, input.mimeType);
    if (input.sourceS3Key === input.destinationS3Key || !isSafeETag(input.eTag)) {
      throw new ConfigurationError('Entity reference upload stabilization is invalid');
    }

    const copied = await this.executeSafeOperation((abortSignal) => this.client.send(
      new CopyObjectCommand({
        Bucket: this.options.bucketName,
        Key: input.destinationS3Key,
        CopySource: `${this.options.bucketName}/${input.sourceS3Key}`,
        CopySourceIfMatch: input.eTag,
        CacheControl: SESSION_IMAGE_CACHE_CONTROL,
        ContentType: input.mimeType,
        MetadataDirective: 'REPLACE',
        ServerSideEncryption: 'AES256',
      }),
      { abortSignal },
    ));
    if (copied === null) {
      throw new ConfigurationError('Unable to stabilize uploaded image');
    }

    return {
      s3Key: input.destinationS3Key,
      cdnUrl: buildStoredImageUrl(this.options, input.destinationS3Key),
    };
  }

  private async executeSafeOperation<T>(
    operation: (abortSignal: AbortSignal) => Promise<T>,
  ): Promise<T | null> {
    const attempts = this.options.maxSafeReadAttempts
      ?? ENTITY_REFERENCE_UPLOAD_SAFE_READ_ATTEMPTS;
    const retryDelayMs = this.options.retryDelayMs
      ?? ENTITY_REFERENCE_UPLOAD_SAFE_READ_RETRY_DELAY_MS;
    if (!Number.isInteger(attempts) || attempts < 1 || attempts > 3) {
      throw new ConfigurationError('Entity reference upload retry configuration is invalid');
    }

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
  return getSignedUrl(client, command, {
    expiresIn: expiresInSeconds,
    signableHeaders: new Set(['content-type']),
  });
}

async function runWithTimeout<T>(
  operation: (abortSignal: AbortSignal) => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
    throw new ConfigurationError('Entity reference upload timeout configuration is invalid');
  }

  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      const error = new Error('Entity reference upload read timed out');
      error.name = 'TimeoutError';
      reject(error);
    }, timeoutMs);
  });

  try {
    return await Promise.race([operation(controller.signal), timeoutPromise]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function contentRangeMatchesSize(value: string | undefined, sizeBytes: number): boolean {
  return value === `bytes 0-${sizeBytes - 1}/${sizeBytes}`;
}

function isSafeETag(value: string | undefined): value is string {
  return value !== undefined
    && value.length >= 3
    && value.length <= 256
    && !value.includes('\r')
    && !value.includes('\n');
}

function hasByteArrayBody(
  value: unknown,
): value is { transformToByteArray(): Promise<Uint8Array> } {
  return typeof value === 'object'
    && value !== null
    && 'transformToByteArray' in value
    && typeof value.transformToByteArray === 'function';
}

function isNotFoundError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const name = 'name' in error && typeof error.name === 'string' ? error.name : '';
  if (name === 'NoSuchKey' || name === 'NotFound') {
    return true;
  }
  return readHttpStatusCode(error) === 404;
}

function isRetryableS3ReadError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const name = 'name' in error && typeof error.name === 'string' ? error.name : '';
  const code = 'code' in error && typeof error.code === 'string' ? error.code : '';
  if (
    name === 'AbortError'
    || name === 'TimeoutError'
    || name === 'RequestTimeout'
    || name === 'NetworkingError'
    || code === 'ECONNRESET'
    || code === 'ETIMEDOUT'
    || code === 'EAI_AGAIN'
  ) {
    return true;
  }
  const statusCode = readHttpStatusCode(error);
  return statusCode === 429
    || (statusCode !== null && statusCode >= 500 && statusCode <= 599);
}

function readHttpStatusCode(error: object): number | null {
  if (
    !('$metadata' in error)
    || typeof error.$metadata !== 'object'
    || error.$metadata === null
    || !('httpStatusCode' in error.$metadata)
    || typeof error.$metadata.httpStatusCode !== 'number'
  ) {
    return null;
  }
  return error.$metadata.httpStatusCode;
}

function validateTemporaryUploadKey(
  s3Key: string,
  mimeType: EntityReferenceUploadMimeType,
): void {
  const expectedExtension = extensionForEntityReferenceUploadMimeType(mimeType);
  const segments = s3Key.split('/');
  const userId = segments[1] ?? '';
  const fileName = segments[4] ?? '';
  const uuidPattern = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
  if (
    segments.length !== 5
    || segments[0] !== 'tmp'
    || !new RegExp(`^${uuidPattern}$`, 'u').test(userId)
    || segments[2] !== 'entities'
    || segments[3] !== 'imports'
    || !new RegExp(`^${uuidPattern}\\.${expectedExtension}$`, 'u').test(fileName)
    || s3Key.includes('\\')
    || s3Key.includes('\0')
  ) {
    throw new ConfigurationError('Entity reference upload key is invalid');
  }
}
