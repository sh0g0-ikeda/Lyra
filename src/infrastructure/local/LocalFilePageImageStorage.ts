import { ConfigurationError } from '../../domain/errors/index.js';
import type {
  PageImageStoragePort,
  StorePageImageInput,
  StoredPageImage,
} from '../../services/page/PageGenerationWorkerService.js';
import {
  buildLocalAssetUrl,
  type LocalAssetConfig,
  writeLocalAsset,
} from './LocalAssetFiles.js';

export class LocalFilePageImageStorage implements PageImageStoragePort {
  public constructor(private readonly config: LocalAssetConfig) {}

  public async store(input: StorePageImageInput): Promise<StoredPageImage> {
    const extension = mimeTypeToExtension(input.mimeType);
    if (extension === null) {
      throw new ConfigurationError(`Unsupported page image mime type: ${input.mimeType}`);
    }

    const s3Key = `session/${input.userId}/pages/${input.pageId}/${input.jobId}.${extension}`;
    await writeLocalAsset(this.config.rootDir, s3Key, input.imageData);

    return {
      s3Key,
      cdnUrl: buildLocalAssetUrl(this.config, s3Key),
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

