import { CopyObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { ConfigurationError } from '../../domain/errors/index.js';
import type { GeneratedPageImage } from '../../domain/types/page.js';

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
  cdnBaseUrl: string;
}

export class S3FinalPageImageStorage implements FinalPageImageStoragePort {
  public constructor(
    private readonly client: S3FinalPageImageStorageClient,
    private readonly options: S3FinalPageImageStorageOptions,
  ) {}

  public async finalizePageImage(input: FinalizePageImageInput): Promise<GeneratedPageImage> {
    const extension = readExtension(input.sourceS3Key);
    const destinationKey = `saved/${input.userId}/pages/${input.pageId}_final.${extension}`;
    if (input.sourceS3Key === destinationKey) {
      return input.generatedImage;
    }

    try {
      await this.client.send(
        new CopyObjectCommand({
          Bucket: this.options.bucketName,
          Key: destinationKey,
          CopySource: `${this.options.bucketName}/${input.sourceS3Key}`,
          CacheControl: 'public, max-age=31536000, immutable',
          MetadataDirective: 'REPLACE',
          ContentType: guessContentType(extension),
          ServerSideEncryption: 'AES256',
        }),
      );
    } catch (error) {
      throw new ConfigurationError(error instanceof Error ? error.message : 'Failed to finalize page image');
    }

    return {
      ...input.generatedImage,
      s3Key: destinationKey,
      cdnUrl: buildCdnUrl(this.options.cdnBaseUrl, destinationKey),
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
          CacheControl: 'public, max-age=31536000, immutable',
          ServerSideEncryption: 'AES256',
        }),
      );
    } catch (error) {
      throw new ConfigurationError(
        error instanceof Error ? error.message : 'Failed to store final page image',
      );
    }

    return {
      ...input.generatedImage,
      s3Key: destinationKey,
      cdnUrl: buildCdnUrl(this.options.cdnBaseUrl, destinationKey),
    };
  }
}

function buildCdnUrl(baseUrl: string, key: string): string {
  return new URL(key, `${baseUrl.replace(/\/+$/u, '')}/`).toString();
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
