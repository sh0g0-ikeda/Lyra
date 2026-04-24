import { CopyObjectCommand } from '@aws-sdk/client-s3';
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
}

interface S3CopyObjectClient {
  send(command: CopyObjectCommand): Promise<unknown>;
}

export interface S3FinalPageImageStorageOptions {
  bucketName: string;
  cdnBaseUrl: string;
}

export class S3FinalPageImageStorage implements FinalPageImageStoragePort {
  public constructor(
    private readonly client: S3CopyObjectClient,
    private readonly options: S3FinalPageImageStorageOptions,
  ) {}

  public async finalizePageImage(input: FinalizePageImageInput): Promise<GeneratedPageImage> {
    const extension = readExtension(input.sourceS3Key);
    const destinationKey = `saved/${input.userId}/pages/${input.pageId}_final.${extension}`;

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
}

function buildCdnUrl(baseUrl: string, key: string): string {
  return new URL(key, `${baseUrl.replace(/\/+$/u, '')}/`).toString();
}

function readExtension(s3Key: string): 'png' | 'jpeg' | 'webp' {
  if (s3Key.endsWith('.jpeg') || s3Key.endsWith('.jpg')) {
    return 'jpeg';
  }

  if (s3Key.endsWith('.webp')) {
    return 'webp';
  }

  return 'png';
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
