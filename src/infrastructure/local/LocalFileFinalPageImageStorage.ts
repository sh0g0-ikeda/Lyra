import type { GeneratedPageImage } from '../../domain/types/page.js';
import type {
  FinalPageImageStoragePort,
  FinalizePageImageInput,
} from '../aws/S3FinalPageImageStorage.js';
import {
  buildLocalAssetUrl,
  copyLocalAsset,
  type LocalAssetConfig,
  writeLocalAsset,
} from './LocalAssetFiles.js';

export class LocalFileFinalPageImageStorage implements FinalPageImageStoragePort {
  public constructor(private readonly config: LocalAssetConfig) {}

  public async finalizePageImage(input: FinalizePageImageInput): Promise<GeneratedPageImage> {
    const extension = readExtension(input.sourceS3Key);
    const destinationKey = `saved/${input.userId}/pages/${input.pageId}_final.${extension}`;
    await copyLocalAsset(this.config.rootDir, input.sourceS3Key, destinationKey);

    return {
      ...input.generatedImage,
      s3Key: destinationKey,
      cdnUrl: buildLocalAssetUrl(this.config, destinationKey),
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
    await writeLocalAsset(this.config.rootDir, destinationKey, input.imageData);

    return {
      ...input.generatedImage,
      s3Key: destinationKey,
      cdnUrl: buildLocalAssetUrl(this.config, destinationKey),
    };
  }
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

function mimeTypeToExtension(mimeType: 'image/png' | 'image/jpeg' | 'image/webp'): 'png' | 'jpeg' | 'webp' {
  if (mimeType === 'image/jpeg') {
    return 'jpeg';
  }

  if (mimeType === 'image/webp') {
    return 'webp';
  }

  return 'png';
}

