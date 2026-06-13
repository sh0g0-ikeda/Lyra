import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { ConfigurationError } from '../../domain/errors/index.js';
import type {
  PageImageStoragePort,
  StorePageImageInput,
  StoredPageImage,
} from '../../services/page/PageGenerationWorkerService.js';
import { toSanitizedAwsErrorMessage } from './AwsErrorMessage.js';
import { SESSION_IMAGE_CACHE_CONTROL } from './S3ImageCacheControl.js';
import { buildStoredImageUrl } from './S3StoredImageUrl.js';

export interface S3PageImageStorageOptions {
  bucketName: string;
  cdnBaseUrl?: string;
}

interface S3PutObjectClient {
  send(command: PutObjectCommand): Promise<unknown>;
}

export class S3PageImageStorage implements PageImageStoragePort {
  public constructor(
    private readonly client: S3PutObjectClient,
    private readonly options: S3PageImageStorageOptions,
  ) {}

  public async store(input: StorePageImageInput): Promise<StoredPageImage> {
    const extension = mimeTypeToExtension(input.mimeType);
    if (extension === null) {
      throw new ConfigurationError(`Unsupported page image mime type: ${input.mimeType}`);
    }

    const s3Key = `session/${input.userId}/pages/${input.pageId}/${input.jobId}.${extension}`;

    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.options.bucketName,
          Key: s3Key,
          Body: input.imageData,
          ContentType: input.mimeType,
          CacheControl: SESSION_IMAGE_CACHE_CONTROL,
          ServerSideEncryption: 'AES256',
        }),
      );
    } catch (error) {
      throw new ConfigurationError(toSanitizedAwsErrorMessage(error, 'Failed to store page image'));
    }

    return {
      s3Key,
      cdnUrl: buildStoredImageUrl(this.options, s3Key),
    };
  }
}

export function createPageImageStorageClient(region?: string): S3Client {
  return new S3Client(region === undefined ? {} : { region });
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
