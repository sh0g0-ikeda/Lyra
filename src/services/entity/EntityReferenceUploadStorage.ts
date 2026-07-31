import type { EntityReferenceUploadMimeType } from '../../domain/constants/entityReferenceUpload.js';

export interface LoadedEntityReferenceUploadImage {
  imageData: Buffer;
  mimeType: EntityReferenceUploadMimeType;
  eTag: string;
  cdnUrl: string;
}

export interface StabilizedEntityReferenceUploadImage {
  s3Key: string;
  cdnUrl: string;
}

export interface EntityReferenceUploadStoragePort {
  createPresignedPutUrl(input: {
    s3Key: string;
    mimeType: EntityReferenceUploadMimeType;
    sizeBytes: number;
    expiresInSeconds: number;
  }): Promise<string>;
  loadUploadedImage(input: {
    s3Key: string;
    mimeType: EntityReferenceUploadMimeType;
    sizeBytes: number;
  }): Promise<LoadedEntityReferenceUploadImage | null>;
  stabilizeUploadedImage(input: {
    sourceS3Key: string;
    destinationS3Key: string;
    mimeType: EntityReferenceUploadMimeType;
    eTag: string;
  }): Promise<StabilizedEntityReferenceUploadImage>;
}
