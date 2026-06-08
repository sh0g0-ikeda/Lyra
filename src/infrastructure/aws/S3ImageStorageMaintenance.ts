import {
  DeleteObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3';
import { ConfigurationError } from '../../domain/errors/index.js';
import type {
  ImageStorageMaintenancePort,
  StoredImageObject,
} from '../../services/storage/ImageStoragePruningService.js';

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
  ) {}

  public async listObjects(prefix: string): Promise<StoredImageObject[]> {
    const objects: StoredImageObject[] = [];
    let continuationToken: string | undefined;

    do {
      const response = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucketName,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        }),
      ) as ListObjectsResponse;

      for (const item of response.Contents ?? []) {
        if (item.Key === undefined) {
          continue;
        }

        objects.push({
          key: item.Key,
          lastModified: item.LastModified ?? null,
        });
      }

      continuationToken = response.IsTruncated === true ? response.NextContinuationToken : undefined;
    } while (continuationToken !== undefined);

    return objects;
  }

  public async deleteObject(key: string): Promise<void> {
    try {
      await this.client.send(
        new DeleteObjectCommand({
          Bucket: this.bucketName,
          Key: key,
        }),
      );
    } catch (error) {
      throw new ConfigurationError(error instanceof Error ? error.message : 'Failed to delete image object');
    }
  }
}

export function createImageStorageMaintenanceClient(region?: string): S3Client {
  return new S3Client(region === undefined ? {} : { region });
}
