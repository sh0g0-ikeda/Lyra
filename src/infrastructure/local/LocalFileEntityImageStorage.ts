import { randomUUID } from 'node:crypto';
import { ConfigurationError } from '../../domain/errors/index.js';
import type {
  EntityImageStoragePort,
  FinalizeEntityReferenceImageInput,
  StoredEntityImage,
  StoreGeneratedEntityCandidateInput,
  StoreImportedEntityImageInput,
} from '../aws/S3EntityImageStorage.js';
import {
  buildLocalAssetUrl,
  copyLocalAsset,
  type LocalAssetConfig,
  writeLocalAsset,
} from './LocalAssetFiles.js';

export class LocalFileEntityImageStorage implements EntityImageStoragePort {
  public constructor(private readonly config: LocalAssetConfig) {}

  public async storeImportedImage(input: StoreImportedEntityImageInput): Promise<StoredEntityImage> {
    const extension = mimeTypeToExtension(input.mimeType);
    if (extension === null) {
      throw new ConfigurationError(`Unsupported entity image mime type: ${input.mimeType}`);
    }

    const s3Key = `tmp/${input.userId}/entities/imports/${randomUUID()}.${extension}`;
    await writeLocalAsset(this.config.rootDir, s3Key, input.imageData);
    return {
      s3Key,
      cdnUrl: buildLocalAssetUrl(this.config, s3Key),
    };
  }

  public async storeGeneratedCandidate(
    input: StoreGeneratedEntityCandidateInput,
  ): Promise<StoredEntityImage> {
    const extension = mimeTypeToExtension(input.mimeType);
    if (extension === null) {
      throw new ConfigurationError(`Unsupported entity image mime type: ${input.mimeType}`);
    }

    const s3Key = `session/${input.userId}/entities/${input.entityId}/${input.jobId}-${input.candidateIndex}.${extension}`;
    await writeLocalAsset(this.config.rootDir, s3Key, input.imageData);
    return {
      s3Key,
      cdnUrl: buildLocalAssetUrl(this.config, s3Key),
    };
  }

  public async finalizeReferenceImage(
    input: FinalizeEntityReferenceImageInput,
  ): Promise<StoredEntityImage> {
    const extension = readExtension(input.sourceS3Key);
    const destinationKey = `saved/${input.userId}/entities/${input.entityId}/${input.refId}.${extension}`;
    await copyLocalAsset(this.config.rootDir, input.sourceS3Key, destinationKey);
    return {
      s3Key: destinationKey,
      cdnUrl: buildLocalAssetUrl(this.config, destinationKey),
    };
  }
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

function readExtension(assetKey: string): 'png' | 'jpeg' | 'webp' {
  if (assetKey.endsWith('.jpeg') || assetKey.endsWith('.jpg')) {
    return 'jpeg';
  }

  if (assetKey.endsWith('.webp')) {
    return 'webp';
  }

  return 'png';
}

