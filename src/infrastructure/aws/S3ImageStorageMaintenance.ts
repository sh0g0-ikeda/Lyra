import {
  DeleteObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3';
import { ConfigurationError } from '../../domain/errors/index.js';
import type {
  ListedStoredImageObjects,
  ListStoredImageObjectsOptions,
  ImageStorageMaintenancePort,
  StoredImageObject,
} from '../../services/storage/ImageStoragePruningService.js';
import { toSanitizedAwsErrorMessage } from './AwsErrorMessage.js';

type S3MaintenanceCommand = ListObjectsV2Command | DeleteObjectCommand;

interface S3ImageStorageMaintenanceClient {
  send(command: S3MaintenanceCommand): Promise<unknown>;
}

interface ListObjectsResponse {
  Contents?: Array<{
    Key?: string;
    LastModified?: Date;
  }>;
  IsTruncated?: boolean;
  NextContinuationToken?: string;
}

const IMAGE_OBJECT_KEY_EXTENSION_PATTERN = /\.(?:jpe?g|png|webp)$/iu;

export class S3ImageStorageMaintenance implements ImageStorageMaintenancePort {
  public constructor(
    private readonly client: S3ImageStorageMaintenanceClient,
    private readonly bucketName: string,
  ) {
    if (bucketName.trim().length === 0) {
      throw new ConfigurationError('S3 image bucket name is required');
    }
  }

  public async listObjects(
    prefix: string,
    options: ListStoredImageObjectsOptions = {},
  ): Promise<ListedStoredImageObjects> {
    validateS3ImageObjectPrefix(prefix);

    const objects: StoredImageObject[] = [];
    let continuationToken: string | undefined;
    let truncatedByLimit = false;

    do {
      const remainingLimit =
        options.maxObjects === undefined ? undefined : Math.max(0, options.maxObjects - objects.length);
      if (remainingLimit !== undefined && remainingLimit <= 0) {
        truncatedByLimit = true;
        break;
      }
      const objectCountBeforePage = objects.length;

      let response: ListObjectsResponse;
      try {
        response = await this.client.send(
          new ListObjectsV2Command({
            Bucket: this.bucketName,
            Prefix: prefix,
            ContinuationToken: continuationToken,
            MaxKeys: remainingLimit,
          }),
        ) as ListObjectsResponse;
      } catch (error) {
        throw new ConfigurationError(toSanitizedAwsErrorMessage(error, 'Failed to list image objects'));
      }

      for (const item of response.Contents ?? []) {
        if (item.Key === undefined) {
          continue;
        }

        if (
          remainingLimit !== undefined &&
          objects.length - objectCountBeforePage >= remainingLimit
        ) {
          truncatedByLimit = true;
          break;
        }

        objects.push({
          key: item.Key,
          lastModified: item.LastModified ?? null,
        });
      }

      if (response.IsTruncated === true && response.NextContinuationToken === undefined) {
        throw new ConfigurationError('S3 image object listing was truncated without a continuation token');
      }

      continuationToken =
        !truncatedByLimit && response.IsTruncated === true ? response.NextContinuationToken : undefined;
      if (truncatedByLimit || (options.maxObjects !== undefined && objects.length >= options.maxObjects)) {
        truncatedByLimit = truncatedByLimit || response.IsTruncated === true || continuationToken !== undefined;
        continuationToken = undefined;
      }
    } while (continuationToken !== undefined);

    return {
      objects,
      truncated: truncatedByLimit,
    };
  }

  public async deleteObject(key: string): Promise<void> {
    validateS3ImageObjectKey(key);

    try {
      await this.client.send(
        new DeleteObjectCommand({
          Bucket: this.bucketName,
          Key: key,
        }),
      );
    } catch (error) {
      throw new ConfigurationError(toSanitizedAwsErrorMessage(error, 'Failed to delete image object'));
    }
  }
}

export function createImageStorageMaintenanceClient(region?: string): S3Client {
  return new S3Client(region === undefined ? {} : { region });
}

function validateS3ImageObjectPrefix(prefix: string): void {
  if (prefix.trim().length === 0) {
    throw new ConfigurationError('S3 image object prefix is required');
  }

  if (!prefix.endsWith('/') || !hasSafeStoragePathSyntax(prefix, { allowTrailingSlash: true })) {
    throw new ConfigurationError('S3 image object prefix is invalid');
  }
}

function validateS3ImageObjectKey(key: string): void {
  if (key.trim().length === 0) {
    throw new ConfigurationError('S3 image object key is required');
  }

  if (!hasSafeStoragePathSyntax(key, { allowTrailingSlash: false })) {
    throw new ConfigurationError('S3 image object key is invalid');
  }

  if (!IMAGE_OBJECT_KEY_EXTENSION_PATTERN.test(key)) {
    throw new ConfigurationError(`Unsupported S3 image object key extension: ${key}`);
  }
}

function hasSafeStoragePathSyntax(
  value: string,
  options: { allowTrailingSlash: boolean },
): boolean {
  if (
    value.length === 0 ||
    value.startsWith('/') ||
    value.includes('\\') ||
    value.includes('//') ||
    /[\u0000-\u001F\u007F]/u.test(value)
  ) {
    return false;
  }

  const segments = value.split('/');
  const finalIndex = segments.length - 1;
  return segments.every((segment, index) => {
    if (segment === '.' || segment === '..') {
      return false;
    }

    if (segment.length > 0) {
      return true;
    }

    return options.allowTrailingSlash && index === finalIndex;
  });
}
