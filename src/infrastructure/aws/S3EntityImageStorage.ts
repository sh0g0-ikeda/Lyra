import { CopyObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { randomUUID } from 'node:crypto';
import { ConfigurationError } from '../../domain/errors/index.js';
import { buildEntityStateReferenceImageKey } from '../../domain/state/StateReferenceImageKey.js';
import { toSanitizedAwsErrorMessage } from './AwsErrorMessage.js';
import { SAVED_IMAGE_CACHE_CONTROL, SESSION_IMAGE_CACHE_CONTROL } from './S3ImageCacheControl.js';
import { buildStoredImageUrl } from './S3StoredImageUrl.js';

const STATE_REFERENCE_COPY_TIMEOUT_MS = 15_000;

export interface StoredEntityImage {
  s3Key: string;
  cdnUrl: string;
}

export interface StoreImportedEntityImageInput {
  userId: string;
  imageData: Buffer;
  mimeType: string;
}

export interface StoreGeneratedEntityCandidateInput extends StoreImportedEntityImageInput {
  entityId: string;
  jobId: string;
  candidateIndex: number;
}

export interface FinalizeEntityReferenceImageInput {
  userId: string;
  entityId: string;
  refId: string;
  sourceS3Key: string;
}

export interface FinalizeEntityStateReferenceImageInput extends FinalizeEntityReferenceImageInput {
  stateId: string;
}

export interface EntityImageStoragePort {
  storeImportedImage(input: StoreImportedEntityImageInput): Promise<StoredEntityImage>;
  storeGeneratedCandidate(input: StoreGeneratedEntityCandidateInput): Promise<StoredEntityImage>;
  finalizeReferenceImage(input: FinalizeEntityReferenceImageInput): Promise<StoredEntityImage>;
  finalizeStateReferenceImage?(
    input: FinalizeEntityStateReferenceImageInput,
  ): Promise<StoredEntityImage>;
}

export interface S3EntityImageStorageOptions {
  bucketName: string;
  cdnBaseUrl?: string;
}

interface S3EntityImageStorageClient {
  send(command: PutObjectCommand | CopyObjectCommand, options?: { abortSignal: AbortSignal }): Promise<unknown>;
}

export class S3EntityImageStorage implements EntityImageStoragePort {
  public constructor(
    private readonly client: S3EntityImageStorageClient,
    private readonly options: S3EntityImageStorageOptions,
    private readonly stateReferenceCopyClient?: S3EntityImageStorageClient,
  ) {}

  public async storeImportedImage(input: StoreImportedEntityImageInput): Promise<StoredEntityImage> {
    const extension = mimeTypeToExtension(input.mimeType);
    if (extension === null) {
      throw new ConfigurationError(`Unsupported entity image mime type: ${input.mimeType}`);
    }

    const s3Key = `tmp/${input.userId}/entities/imports/${randomUUID()}.${extension}`;
    return this.putObject(s3Key, input.imageData, input.mimeType);
  }

  public async storeGeneratedCandidate(input: StoreGeneratedEntityCandidateInput): Promise<StoredEntityImage> {
    const extension = mimeTypeToExtension(input.mimeType);
    if (extension === null) {
      throw new ConfigurationError(`Unsupported entity image mime type: ${input.mimeType}`);
    }

    const s3Key = `session/${input.userId}/entities/${input.entityId}/${input.jobId}-${input.candidateIndex}.${extension}`;
    return this.putObject(s3Key, input.imageData, input.mimeType);
  }

  public async finalizeReferenceImage(input: FinalizeEntityReferenceImageInput): Promise<StoredEntityImage> {
    const extension = readExtension(input.sourceS3Key);
    const destinationKey = `saved/${input.userId}/entities/${input.entityId}/${input.refId}.${extension}`;
    ensureAllowedEntityReferenceSourceKey(input.sourceS3Key, input.userId, input.entityId);

    try {
      await this.client.send(
        new CopyObjectCommand({
          Bucket: this.options.bucketName,
          Key: destinationKey,
          CopySource: `${this.options.bucketName}/${input.sourceS3Key}`,
          CacheControl: SAVED_IMAGE_CACHE_CONTROL,
          MetadataDirective: 'REPLACE',
          ContentType: extensionToMimeType(extension),
          ServerSideEncryption: 'AES256',
        }),
      );
    } catch (error) {
      throw new ConfigurationError(
        toSanitizedAwsErrorMessage(error, 'Failed to finalize entity reference image'),
      );
    }

    return {
      s3Key: destinationKey,
      cdnUrl: buildStoredImageUrl(this.options, destinationKey),
    };
  }

  public async finalizeStateReferenceImage(
    input: FinalizeEntityStateReferenceImageInput,
  ): Promise<StoredEntityImage> {
    const extension = readExtension(input.sourceS3Key);
    const destinationKey = buildEntityStateReferenceImageKey(input);
    // Design: only a single SDK attempt with a complete success response can
    // settle this durable copy attempt. Timeout/abort is an ambiguous outcome,
    // never proof that the remote write stopped. Keep ordinary copies unchanged.
    const client = this.stateReferenceCopyClient;
    if (client === undefined) {
      throw new ConfigurationError('Single-attempt state reference storage is not configured');
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), STATE_REFERENCE_COPY_TIMEOUT_MS);
    try {
      const response = await client.send(
        new CopyObjectCommand({
          Bucket: this.options.bucketName,
          Key: destinationKey,
          CopySource: `${this.options.bucketName}/${input.sourceS3Key}`,
          CacheControl: SAVED_IMAGE_CACHE_CONTROL,
          MetadataDirective: 'REPLACE',
          ContentType: extensionToMimeType(extension),
          ServerSideEncryption: 'AES256',
        }),
        { abortSignal: controller.signal },
      );
      requireSingleAttemptCopySuccess(response);
    } catch (error) {
      throw new ConfigurationError(
        toSanitizedAwsErrorMessage(error, 'Failed to finalize entity state reference image'),
      );
    } finally {
      clearTimeout(timeout);
    }

    return {
      s3Key: destinationKey,
      cdnUrl: buildStoredImageUrl(this.options, destinationKey),
    };
  }

  private async putObject(
    s3Key: string,
    imageData: Buffer,
    mimeType: string,
  ): Promise<StoredEntityImage> {
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.options.bucketName,
          Key: s3Key,
          Body: imageData,
          ContentType: mimeType,
          CacheControl: SESSION_IMAGE_CACHE_CONTROL,
          ServerSideEncryption: 'AES256',
        }),
      );
    } catch (error) {
      throw new ConfigurationError(
        toSanitizedAwsErrorMessage(error, 'Failed to store entity image'),
      );
    }

    return {
      s3Key,
      cdnUrl: buildStoredImageUrl(this.options, s3Key),
    };
  }
}

function ensureAllowedEntityReferenceSourceKey(sourceS3Key: string, userId: string, entityId: string): void {
  const allowedPrefixes = [
    `tmp/${userId}/entities/imports/`,
    `session/${userId}/entities/${entityId}/`,
  ];

  if (
    hasUnsafeImageKeySyntax(sourceS3Key) ||
    !allowedPrefixes.some((prefix) => sourceS3Key.startsWith(prefix))
  ) {
    throw new ConfigurationError('Entity reference source image key is outside the entity owner scope');
  }
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

function mimeTypeToExtension(mimeType: string): 'png' | 'jpeg' | 'webp' | null {
  if (mimeType === 'image/png') {
    return 'png';
  }

  if (mimeType === 'image/jpeg') {
    return 'jpeg';
  }

  if (mimeType === 'image/webp') {
    return 'webp';
  }

  return null;
}

function readExtension(s3Key: string): 'png' | 'jpeg' | 'webp' {
  if (s3Key.endsWith('.png')) {
    return 'png';
  }

  if (s3Key.endsWith('.jpeg') || s3Key.endsWith('.jpg')) {
    return 'jpeg';
  }

  if (s3Key.endsWith('.webp')) {
    return 'webp';
  }

  throw new ConfigurationError(`Unsupported entity reference source image extension: ${s3Key}`);
}

function extensionToMimeType(extension: 'png' | 'jpeg' | 'webp'): string {
  if (extension === 'jpeg') {
    return 'image/jpeg';
  }

  if (extension === 'webp') {
    return 'image/webp';
  }

  return 'image/png';
}

// Explicit constructor configuration wins over AWS_MAX_ATTEMPTS/profile defaults.
export function createStateReferenceCopyClient(region?: string): S3Client {
  return new S3Client({ ...(region === undefined ? {} : { region }), maxAttempts: 1 });
}

function requireSingleAttemptCopySuccess(response: unknown): void {
  const result = asRecord(response);
  const metadata = asRecord(result?.$metadata);
  const copy = asRecord(result?.CopyObjectResult);
  if (metadata?.attempts !== 1 || metadata.httpStatusCode !== 200
    || typeof copy?.ETag !== 'string' || copy.ETag.length === 0) {
    throw new ConfigurationError('State reference copy outcome is not a verified single-attempt success');
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}
