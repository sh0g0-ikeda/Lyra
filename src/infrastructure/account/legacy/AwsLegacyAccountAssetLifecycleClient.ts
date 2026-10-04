import { GetObjectTaggingCommand, PutObjectTaggingCommand } from '@aws-sdk/client-s3';
import { ConfigurationError, ValidationError } from '../../../domain/errors/index.js';
import type {
  LegacyAccountAssetLifecycleClient,
  LegacyAccountAssetTag,
} from '../../../legacy/account/LegacyAccountAssetLifecycle.js';

type LegacyS3Command = GetObjectTaggingCommand | PutObjectTaggingCommand;

interface LegacyS3Client {
  send(
    command: LegacyS3Command,
    options: { abortSignal: AbortSignal },
  ): Promise<{ TagSet?: Array<{ Key?: string; Value?: string }> }>;
}

/**
 * Legacy account assets are scheduled by tag mutation only. Physical deletion
 * remains outside this adapter and is never requested through this client.
 */
export class AwsLegacyAccountAssetLifecycleClient implements LegacyAccountAssetLifecycleClient {
  private readonly bucketName: string;

  public constructor(
    private readonly client: LegacyS3Client,
    options: { bucketName?: string } = {},
  ) {
    this.bucketName = options.bucketName === undefined ? '' : validateBucketName(options.bucketName);
  }

  public async getObjectTags(input: {
    bucketName: string;
    key: string;
    signal: AbortSignal;
  }): Promise<readonly LegacyAccountAssetTag[]> {
    const bucketName = this.resolveBucketName(input.bucketName);
    validateKey(input.key);
    if (input.signal.aborted) throw new ConfigurationError('Legacy account asset tag read cancelled');
    try {
      const response = await this.client.send(
        new GetObjectTaggingCommand({ Bucket: bucketName, Key: input.key }),
        { abortSignal: input.signal },
      );
      return (response.TagSet ?? []).flatMap((tag) => (
        typeof tag.Key === 'string' && typeof tag.Value === 'string'
          ? [{ Key: tag.Key, Value: tag.Value }]
          : []
      ));
    } catch (error: unknown) {
      throw normalizeS3Error(error, 'Legacy account asset tag read failed');
    }
  }

  public async putObjectTags(input: {
    bucketName: string;
    key: string;
    tags: readonly LegacyAccountAssetTag[];
    signal: AbortSignal;
  }): Promise<void> {
    const bucketName = this.resolveBucketName(input.bucketName);
    validateKey(input.key);
    validateTags(input.tags);
    if (input.signal.aborted) throw new ConfigurationError('Legacy account asset tag write cancelled');
    try {
      await this.client.send(
        new PutObjectTaggingCommand({
          Bucket: bucketName,
          Key: input.key,
          Tagging: { TagSet: input.tags.map((tag) => ({ Key: tag.Key, Value: tag.Value })) },
        }),
        { abortSignal: input.signal },
      );
    } catch (error: unknown) {
      throw normalizeS3Error(error, 'Legacy account asset tag write failed');
    }
  }

  private resolveBucketName(bucketName: string): string {
    const normalized = validateBucketName(bucketName);
    if (this.bucketName.length > 0 && normalized !== this.bucketName) {
      throw new ValidationError('Legacy account asset bucket is invalid');
    }
    return normalized;
  }
}

function validateBucketName(bucketName: string): string {
  const normalized = bucketName.trim();
  if (
    normalized !== bucketName
    || normalized.length < 3
    || normalized.length > 63
    || !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/u.test(normalized)
  ) {
    throw new ValidationError('Legacy account asset bucket is invalid');
  }
  return normalized;
}

function validateKey(key: string): void {
  if (key.length === 0 || key.length > 1_024 || /[\u0000-\u001F\u007F]/u.test(key)) {
    throw new ValidationError('Legacy account asset key is invalid');
  }
}

function validateTags(tags: readonly LegacyAccountAssetTag[]): void {
  if (tags.length > 10 || tags.some((tag) => (
    tag.Key.length === 0 || tag.Key.length > 128 || tag.Value.length > 256
  ))) {
    throw new ValidationError('Legacy account asset tags are invalid');
  }
}

function normalizeS3Error(error: unknown, message: string): Error {
  if (typeof error === 'object' && error !== null && 'name' in error
    && (error.name === 'NoSuchKey' || error.name === 'NotFound')) {
    const missing = new Error(message);
    missing.name = error.name;
    return missing;
  }
  return new ConfigurationError(message);
}
