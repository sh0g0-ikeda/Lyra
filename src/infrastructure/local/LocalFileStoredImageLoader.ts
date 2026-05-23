import type {
  LoadedStoredImage,
  StoredImageLoaderPort,
} from '../aws/S3StoredImageLoader.js';
import {
  inferImageMimeTypeFromKey,
  readLocalAsset,
  type LocalAssetConfig,
} from './LocalAssetFiles.js';

export class LocalFileStoredImageLoader implements StoredImageLoaderPort {
  public constructor(private readonly config: LocalAssetConfig) {}

  public async loadByS3Key(s3Key: string): Promise<LoadedStoredImage> {
    return {
      imageData: await readLocalAsset(this.config.rootDir, s3Key),
      mimeType: inferImageMimeTypeFromKey(s3Key),
    };
  }
}

