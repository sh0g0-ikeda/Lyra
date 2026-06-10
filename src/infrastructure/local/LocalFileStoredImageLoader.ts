import type {
  LoadedStoredImage,
  StoredImageLoaderPort,
} from '../aws/S3StoredImageLoader.js';
import { ConfigurationError } from '../../domain/errors/index.js';
import {
  inferImageMimeTypeFromKey,
  readLocalAsset,
  type LocalAssetConfig,
} from './LocalAssetFiles.js';

export class LocalFileStoredImageLoader implements StoredImageLoaderPort {
  public constructor(private readonly config: LocalAssetConfig) {}

  public async loadByS3Key(s3Key: string): Promise<LoadedStoredImage> {
    const imageData = await readLocalAsset(this.config.rootDir, s3Key);
    if (imageData.length === 0) {
      throw new ConfigurationError('Stored image body is empty');
    }

    return {
      imageData,
      mimeType: inferImageMimeTypeFromKey(s3Key),
    };
  }
}

