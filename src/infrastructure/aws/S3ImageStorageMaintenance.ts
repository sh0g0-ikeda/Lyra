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
    if (prefix.trim().length === 0) {
      throw new ConfigurationError('S3 image object prefix is required');
    }

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
    if (key.trim().length === 0) {
      throw new ConfigurationError('S3 image object key is required');
    }

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
