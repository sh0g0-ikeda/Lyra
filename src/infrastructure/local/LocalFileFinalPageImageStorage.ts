import { ConfigurationError } from '../../domain/errors/index.js';
import type { GeneratedPageImage } from '../../domain/types/page.js';
import type {
  FinalPageImageStoragePort,
  FinalizePageImageInput,
} from '../aws/S3FinalPageImageStorage.js';
import {
  buildLocalAssetUrl,
  copyLocalAsset,
  inferImageExtensionFromKey,
  type LocalAssetConfig,
  writeLocalAsset,
} from './LocalAssetFiles.js';

export class LocalFileFinalPageImageStorage implements FinalPageImageStoragePort {
  public constructor(private readonly config: LocalAssetConfig) {}

  public async finalizePageImage(input: FinalizePageImageInput): Promise<GeneratedPageImage> {
    const extension = inferImageExtensionFromKey(input.sourceS3Key);
    const destinationKey = `saved/${input.userId}/pages/${input.pageId}_final.${extension}`;
    ensureAllowedFinalPageSourceKey(input.sourceS3Key, input.userId, input.pageId, destinationKey);
    if (input.sourceS3Key === destinationKey) {
      return input.generatedImage;
    }

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

function ensureAllowedFinalPageSourceKey(
  sourceS3Key: string,
  userId: string,
  pageId: string,
  destinationKey: string,
): void {
  if (sourceS3Key === destinationKey) {
    return;
  }

  const sessionPrefix = `session/${userId}/pages/${pageId}/`;
  if (hasUnsafeImageKeySyntax(sourceS3Key) || !sourceS3Key.startsWith(sessionPrefix)) {
    throw new ConfigurationError('Final page source image key is outside the page owner scope');
  }
}

function hasUnsafeImageKeySyntax(s3Key: string): boolean {
  if (s3Key.includes('\\') || s3Key.includes('\0')) {
    return true;
  }

  return s3Key.split('/').some((segment) => (
    segment.length === 0 ||
    segment === '.' ||
    segment === '..'
  ));
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

