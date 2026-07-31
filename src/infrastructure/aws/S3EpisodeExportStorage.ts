import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import {
  EPISODE_EXPORT_MAX_ARTIFACT_BYTES,
  EPISODE_EXPORT_MAX_SOURCE_IMAGE_BYTES,
} from '../../domain/episodeExportJob.js';
import {
  EPISODE_EXPORT_ARTIFACT_CACHE_CONTROL,
  EPISODE_EXPORT_STORAGE_MAX_ATTEMPTS,
  EPISODE_EXPORT_STORAGE_RETRY_DELAY_MS,
  EPISODE_EXPORT_STORAGE_TIMEOUT_MS,
  assertEpisodeExportArtifactIdentity,
  assertEpisodeExportSourceImage,
  isEpisodeExportProcessingError,
  permanentSourceError,
  permanentSourceUnavailableError,
  permanentStorageError,
  temporaryExportError,
} from '../../domain/episodeExportProcessing.js';
import type {
  EpisodeExportArtifactStorageIdentity,
  EpisodeExportArtifactStoragePort,
  EpisodeExportSourceImageLoaderPort,
  LoadedEpisodeExportSourceImage,
  StoreEpisodeExportArtifactInput,
} from '../../services/export/EpisodeExportStorage.js';

export interface S3EpisodeExportStorageOptions {
  bucketName: string;
  timeoutMs?: number;
  maxAttempts?: number;
  retryDelayMs?: number;
}

export class S3EpisodeExportSourceImageLoader
implements EpisodeExportSourceImageLoaderPort {
  private readonly operationOptions: ValidatedOperationOptions;

  public constructor(
    private readonly client: S3Client,
    private readonly options: S3EpisodeExportStorageOptions,
  ) {
    this.operationOptions = validateOptions(options);
  }

  public async load(
    input: Parameters<EpisodeExportSourceImageLoaderPort['load']>[0],
  ): Promise<LoadedEpisodeExportSourceImage> {
    assertEpisodeExportSourceImage(input.s3Key, input.mimeType);
    const head = await executeS3Operation(
      (abortSignal) => this.client.send(
        new HeadObjectCommand({
          Bucket: this.options.bucketName,
          Key: input.s3Key,
        }),
        { abortSignal },
      ),
      this.operationOptions,
      'source',
    );
    if (
      !Number.isSafeInteger(head.ContentLength)
      || head.ContentLength === undefined
      || head.ContentLength < 1
      || head.ContentLength > EPISODE_EXPORT_MAX_SOURCE_IMAGE_BYTES
      || head.ContentType !== input.mimeType
      || !isSafeETag(head.ETag)
    ) {
      throw permanentSourceError();
    }
    const sourceSize = head.ContentLength;
    const verifiedETag = head.ETag;

    return executeS3Operation(async (abortSignal) => {
      const object = await this.client.send(
        new GetObjectCommand({
          Bucket: this.options.bucketName,
          Key: input.s3Key,
          IfMatch: verifiedETag,
          Range: `bytes=0-${sourceSize - 1}`,
        }),
        { abortSignal },
      );
      if (
        object.ContentType !== input.mimeType
        || object.ContentLength !== sourceSize
        || object.ContentRange !== `bytes 0-${sourceSize - 1}/${sourceSize}`
        || object.ETag !== verifiedETag
        || !hasByteArrayBody(object.Body)
      ) {
        throw permanentSourceError();
      }
      const imageData = Buffer.from(await object.Body.transformToByteArray());
      if (imageData.length !== sourceSize) {
        throw permanentSourceError();
      }
      assertEpisodeExportSourceImage(
        input.s3Key,
        input.mimeType,
        imageData,
      );
      return {
        imageData,
        mimeType: input.mimeType,
        eTag: verifiedETag,
      };
    }, this.operationOptions, 'source');
  }
}

export class S3EpisodeExportArtifactStorage
implements EpisodeExportArtifactStoragePort {
  private readonly operationOptions: ValidatedOperationOptions;

  public constructor(
    private readonly client: S3Client,
    private readonly options: S3EpisodeExportStorageOptions,
  ) {
    this.operationOptions = validateOptions(options);
  }

  public async store(input: StoreEpisodeExportArtifactInput): Promise<void> {
    assertEpisodeExportArtifactIdentity(input, input.artifactData);
    if (input.artifactData.length > EPISODE_EXPORT_MAX_ARTIFACT_BYTES) {
      throw permanentStorageError();
    }
    await executeS3Operation(
      (abortSignal) => this.client.send(
        new PutObjectCommand({
          Bucket: this.options.bucketName,
          Key: input.s3Key,
          Body: input.artifactData,
          ContentType: input.mimeType,
          ContentLength: input.artifactData.length,
          CacheControl: EPISODE_EXPORT_ARTIFACT_CACHE_CONTROL,
          ServerSideEncryption: 'AES256',
        }),
        { abortSignal },
      ),
      this.operationOptions,
      'storage',
    );
  }

  public async delete(
    input: EpisodeExportArtifactStorageIdentity,
  ): Promise<void> {
    assertEpisodeExportArtifactIdentity(input);
    await executeS3Operation(
      (abortSignal) => this.client.send(
        new DeleteObjectCommand({
          Bucket: this.options.bucketName,
          Key: input.s3Key,
        }),
        { abortSignal },
      ),
      this.operationOptions,
      'storage',
    );
  }
}

interface ValidatedOperationOptions {
  timeoutMs: number;
  maxAttempts: number;
  retryDelayMs: number;
}

async function executeS3Operation<T>(
  operation: (abortSignal: AbortSignal) => Promise<T>,
  options: ValidatedOperationOptions,
  operationKind: 'source' | 'storage',
): Promise<T> {
  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    try {
      return await runWithTimeout(operation, options.timeoutMs);
    } catch (error) {
      if (isEpisodeExportProcessingError(error)) {
        throw error;
      }
      const statusCode = readHttpStatusCode(error);
      if (statusCode === 404 || statusCode === 412) {
        throw operationKind === 'source'
          ? permanentSourceUnavailableError()
          : permanentStorageError();
      }
      if (isRetryableS3Error(error)) {
        if (attempt === options.maxAttempts) {
          throw temporaryExportError();
        }
        await delay(options.retryDelayMs);
        continue;
      }
      throw operationKind === 'source'
        ? permanentSourceUnavailableError()
        : permanentStorageError();
    }
  }
  throw temporaryExportError();
}

async function runWithTimeout<T>(
  operation: (abortSignal: AbortSignal) => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      const error = new Error('Episode export storage operation timed out');
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

function validateOptions(
  options: S3EpisodeExportStorageOptions,
): ValidatedOperationOptions {
  if (
    options.bucketName.trim().length < 3
    || options.bucketName.length > 255
    || options.bucketName.includes('\r')
    || options.bucketName.includes('\n')
  ) {
    throw new Error('Episode export bucket configuration is invalid');
  }
  return {
    timeoutMs: boundedInteger(
      options.timeoutMs ?? EPISODE_EXPORT_STORAGE_TIMEOUT_MS,
      1,
      60_000,
      'Episode export timeout configuration is invalid',
    ),
    maxAttempts: boundedInteger(
      options.maxAttempts ?? EPISODE_EXPORT_STORAGE_MAX_ATTEMPTS,
      1,
      3,
      'Episode export retry configuration is invalid',
    ),
    retryDelayMs: boundedInteger(
      options.retryDelayMs ?? EPISODE_EXPORT_STORAGE_RETRY_DELAY_MS,
      0,
      10_000,
      'Episode export retry delay configuration is invalid',
    ),
  };
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

function isRetryableS3Error(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const name = readStringProperty(error, 'name');
  const code = readStringProperty(error, 'code');
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

function readHttpStatusCode(error: unknown): number | null {
  if (
    typeof error !== 'object'
    || error === null
    || !('$metadata' in error)
    || typeof error.$metadata !== 'object'
    || error.$metadata === null
    || !('httpStatusCode' in error.$metadata)
    || typeof error.$metadata.httpStatusCode !== 'number'
  ) {
    return null;
  }
  return error.$metadata.httpStatusCode;
}

function readStringProperty(
  value: object,
  property: 'name' | 'code',
): string {
  if (property === 'name' && 'name' in value && typeof value.name === 'string') {
    return value.name;
  }
  if (property === 'code' && 'code' in value && typeof value.code === 'string') {
    return value.code;
  }
  return '';
}

function boundedInteger(
  value: number,
  minimum: number,
  maximum: number,
  message: string,
): number {
  if (
    !Number.isSafeInteger(value)
    || value < minimum
    || value > maximum
  ) {
    throw new Error(message);
  }
  return value;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}
