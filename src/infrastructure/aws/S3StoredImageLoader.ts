import { GetObjectCommand } from '@aws-sdk/client-s3';
import { ConfigurationError } from '../../domain/errors/index.js';

export interface LoadedStoredImage {
  imageData: Buffer;
  mimeType: SupportedImageMimeType;
}

export interface StoredImageLoaderPort {
  loadByS3Key(s3Key: string): Promise<LoadedStoredImage>;
}

export type SupportedImageMimeType = 'image/png' | 'image/jpeg' | 'image/webp';

interface ByteArrayBody {
  transformToByteArray(): Promise<Uint8Array>;
}

interface S3GetObjectClient {
  send(command: GetObjectCommand): Promise<{
    Body?: ByteArrayBody;
    ContentType?: string;
  }>;
}

export class S3StoredImageLoader implements StoredImageLoaderPort {
  public constructor(
    private readonly client: S3GetObjectClient,
    private readonly bucketName: string,
  ) {}

  public async loadByS3Key(s3Key: string): Promise<LoadedStoredImage> {
    try {
      const response = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucketName,
          Key: s3Key,
        }),
      );

      if (response.Body === undefined || typeof response.Body.transformToByteArray !== 'function') {
        throw new ConfigurationError('Stored image response body is missing');
      }

      if (typeof response.ContentType !== 'string' || response.ContentType.length === 0) {
        throw new ConfigurationError('Stored image content type is missing');
      }

      if (!isSupportedImageMimeType(response.ContentType)) {
        throw new ConfigurationError(`Unsupported stored image content type: ${response.ContentType}`);
      }

      const bytes = await response.Body.transformToByteArray();
      return {
        imageData: Buffer.from(bytes),
        mimeType: response.ContentType,
      };
    } catch (error) {
      if (error instanceof ConfigurationError) {
        throw error;
      }

      throw new ConfigurationError(error instanceof Error ? error.message : 'Failed to load stored image');
    }
  }
}

function isSupportedImageMimeType(value: string): value is SupportedImageMimeType {
  return value === 'image/png' || value === 'image/jpeg' || value === 'image/webp';
}
