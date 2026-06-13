import { CopyObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { ConfigurationError } from '../../domain/errors/index.js';
import type { GeneratedPageImage } from '../../domain/types/page.js';
import { toSanitizedAwsErrorMessage } from './AwsErrorMessage.js';
import { FINAL_PAGE_IMAGE_CACHE_CONTROL } from './S3ImageCacheControl.js';
import { buildStoredImageUrl } from './S3StoredImageUrl.js';

export interface FinalizePageImageInput {
  userId: string;
  pageId: string;
  sourceS3Key: string;
  generatedImage: GeneratedPageImage;
}

export interface FinalPageImageStoragePort {
  finalizePageImage(input: FinalizePageImageInput): Promise<GeneratedPageImage>;
  storeFinalPageImage(input: {
    userId: string;
    pageId: string;
    imageData: Buffer;
    mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
    generatedImage: GeneratedPageImage;
  }): Promise<GeneratedPageImage>;
}

interface S3FinalPageImageStorageClient {
  send(command: CopyObjectCommand | PutObjectCommand): Promise<unknown>;
}

export interface S3FinalPageImageStorageOptions {
  bucketName: string;
  cdnBaseUrl?: string;
}

export class S3FinalPageImageStorage implements FinalPageImageStoragePort {
  public constructor(
    private readonly client: S3FinalPageImageStorageClient,
    private readonly options: S3FinalPageImageStorageOptions,
  ) {}

  public async finalizePageImage(input: FinalizePageImageInput): Promise<GeneratedPageImage> {
    const extension = readExtension(input.sourceS3Key);
    const destinationKey = `saved/${input.userId}/pages/${input.pageId}_final.${extension}`;
    ensureAllowedFinalPageSourceKey(input.sourceS3Key, input.userId, input.pageId, destinationKey);
    if (input.sourceS3Key === destinationKey) {
      return input.generatedImage;
    }

    try {
      await this.client.send(
        new CopyObjectCommand({
          Bucket: this.options.bucketName,
          Key: destinationKey,
          CopySource: `${this.options.bucketName}/${input.sourceS3Key}`,
          CacheControl: FINAL_PAGE_IMAGE_CACHE_CONTROL,
          MetadataDirective: 'REPLACE',
          ContentType: guessContentType(extension),
          ServerSideEncryption: 'AES256',
        }),
      );
    } catch (error) {
      throw new ConfigurationError(toSanitizedAwsErrorMessage(error, 'Failed to finalize page image'));
    }

    return {
      ...input.generatedImage,
      s3Key: destinationKey,
      cdnUrl: buildStoredImageUrl(this.options, destinationKey),
    };
  }

  public async storeFinalPageImage(input: {
    userId: string;
    pageId: string;
    imageData: Buffer;
    mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
    generatedImage: GeneratedPageImage;
  }): Promise<GeneratedPageImage> {
    const extension = mimeTypeToExtension(input.mimeType);
    const destinationKey = `saved/${input.userId}/pages/${input.pageId}_final.${extension}`;

    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.options.bucketName,
          Key: destinationKey,
          Body: input.imageData,
          ContentType: input.mimeType,
          CacheControl: FINAL_PAGE_IMAGE_CACHE_CONTROL,
          ServerSideEncryption: 'AES256',
        }),
      );
    } catch (error) {
      throw new ConfigurationError(
        toSanitizedAwsErrorMessage(error, 'Failed to store final page image'),
      );
    }

    return {
      ...input.generatedImage,
      s3Key: destinationKey,
      cdnUrl: buildStoredImageUrl(this.options, destinationKey),
    };
  }
}

function ensureAllowedFinalPageSourceKey(
  sourceS3Key: string,
  userId: string,
  pageId: string,
  destinationKey: string,
): void {
  if (sourceS3Key === destinationKey) {
    return;
  }

  const sessionPrefix = `session/${userId}/pages/${pageId}/`;
  if (hasUnsafeImageKeySyntax(sourceS3Key) || !sourceS3Key.startsWith(sessionPrefix)) {
    throw new ConfigurationError('Final page source image key is outside the page owner scope');
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

  throw new ConfigurationError(`Unsupported final page source image extension: ${s3Key}`);
}

function guessContentType(extension: 'png' | 'jpeg' | 'webp'): 'image/png' | 'image/jpeg' | 'image/webp' {
  if (extension === 'jpeg') {
    return 'image/jpeg';
  }

  if (extension === 'webp') {
    return 'image/webp';
  }

  return 'image/png';
}

function mimeTypeToExtension(mimeType: 'image/png' | 'image/jpeg' | 'image/webp'): 'png' | 'jpeg' | 'webp' {
  if (mimeType === 'image/jpeg') {
    return 'jpeg';
  }

  if (mimeType === 'image/webp') {
    return 'webp';
  }

  return 'png';
}
