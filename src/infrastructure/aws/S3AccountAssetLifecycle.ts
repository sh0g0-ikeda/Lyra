import {
  GetObjectTaggingCommand,
  PutObjectTaggingCommand,
  S3Client,
  type Tag,
} from '@aws-sdk/client-s3';
import { ConfigurationError } from '../../domain/errors/index.js';
import type { AccountAssetLifecyclePort } from '../../services/account/AccountDeletionService.js';
import { toSanitizedAwsErrorMessage } from './AwsErrorMessage.js';

const DEFAULT_S3_LIFECYCLE_TIMEOUT_MS = 30_000;
const MAX_S3_OBJECT_KEY_BYTES = 1_024;
const MAX_S3_OBJECT_TAGS = 10;
const IMAGE_OBJECT_KEY_EXTENSION_PATTERN = /\.(?:jpe?g|png|webp)$/iu;
const DELETION_TAG: Required<Tag> = {
  Key: 'lyra-deletion-state',
  Value: 'pending',
};

interface S3RequestOptions {
  abortSignal?: AbortSignal;
}

export interface S3AccountAssetLifecycleClient {
  send(
    command: GetObjectTaggingCommand | PutObjectTaggingCommand,
    options?: S3RequestOptions,
  ): Promise<unknown>;
}

export interface S3AccountAssetLifecycleOptions {
  bucketName: string;
  timeoutMs?: number;
}

/**
 * Marks one exact personal asset for deletion. The bucket lifecycle rule owns
 * physical deletion, which keeps this step reversible until DB anonymization
 * and identity deletion have completed.
 */
export class S3AccountAssetLifecycle implements AccountAssetLifecyclePort {
  private readonly timeoutMs: number;
  private readonly bucketName: string;

  public constructor(
    private readonly client: S3AccountAssetLifecycleClient,
    options: S3AccountAssetLifecycleOptions,
  ) {
    this.bucketName = options.bucketName.trim();
    if (this.bucketName.length === 0) {
      throw new ConfigurationError('S3 image bucket name is required');
    }
    this.timeoutMs = resolveTimeoutMs(options.timeoutMs);
  }

  public async scheduleDeletion(key: string): Promise<void> {
    assertAccountAssetKey(key);

    try {
      const response = await this.client.send(
        new GetObjectTaggingCommand({
          Bucket: this.bucketName,
          Key: key,
        }),
        { abortSignal: AbortSignal.timeout(this.timeoutMs) },
      );
      const existingTags = readTagSet(response);
      if (existingTags.some((tag) => tag.Key === DELETION_TAG.Key && tag.Value === DELETION_TAG.Value)) {
        return;
      }
      if (existingTags.length >= MAX_S3_OBJECT_TAGS) {
        throw new ConfigurationError('S3 account asset has no free lifecycle tag slot');
      }
      await this.client.send(
        new PutObjectTaggingCommand({
          Bucket: this.bucketName,
          Key: key,
          Tagging: {
            TagSet: [...existingTags, DELETION_TAG],
          },
        }),
        { abortSignal: AbortSignal.timeout(this.timeoutMs) },
      );
    } catch (error) {
      if (isMissingS3Object(error)) {
        return;
      }
      throw new ConfigurationError(
        toSanitizedKeySafeAwsErrorMessage(
          error,
          'Failed to schedule account asset deletion',
          [key, this.bucketName],
        ),
      );
    }
  }
}

export function createS3AccountAssetLifecycleClient(region?: string): S3Client {
  return new S3Client(region === undefined ? {} : { region });
}

function resolveTimeoutMs(timeoutMs: number | undefined): number {
  const resolved = timeoutMs ?? DEFAULT_S3_LIFECYCLE_TIMEOUT_MS;
  if (!Number.isInteger(resolved) || resolved < 1_000 || resolved > 600_000) {
    throw new ConfigurationError('S3 account asset deletion timeout is invalid');
  }
  return resolved;
}

function readTagSet(response: unknown): Required<Tag>[] {
  if (
    typeof response !== 'object' ||
    response === null ||
    !('TagSet' in response) ||
    !Array.isArray(response.TagSet)
  ) {
    return [];
  }

  return response.TagSet.flatMap((tag) =>
    typeof tag === 'object' &&
    tag !== null &&
    'Key' in tag &&
    'Value' in tag &&
    typeof tag.Key === 'string' &&
    typeof tag.Value === 'string'
      ? [{ Key: tag.Key, Value: tag.Value }]
      : [],
  );
}

function isMissingS3Object(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error.name === 'NoSuchKey' || error.name === 'NotFound')
  );
}

function assertAccountAssetKey(key: string): void {
  if (
    key.trim().length === 0 ||
    Buffer.byteLength(key, 'utf8') > MAX_S3_OBJECT_KEY_BYTES ||
    !key.startsWith('saved/') ||
    !IMAGE_OBJECT_KEY_EXTENSION_PATTERN.test(key) ||
    !hasSafeStoragePathSyntax(key)
  ) {
    throw new ConfigurationError('S3 account asset key is invalid');
  }
}

function hasSafeStoragePathSyntax(value: string): boolean {
  if (
    value.startsWith('/') ||
    value.includes('\\') ||
    value.includes('//') ||
    /[\u0000-\u001F\u007F]/u.test(value)
  ) {
    return false;
  }

  return value.split('/').every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
}

function toSanitizedKeySafeAwsErrorMessage(
  error: unknown,
  fallbackMessage: string,
  identifiers: string[],
): string {
  const source = error instanceof Error ? error.message : fallbackMessage;
  const withoutIdentifiers = identifiers.reduce(
    (message, identifier) => message.replaceAll(identifier, '[redacted]'),
    source,
  );
  return toSanitizedAwsErrorMessage(new Error(withoutIdentifiers), fallbackMessage);
}
