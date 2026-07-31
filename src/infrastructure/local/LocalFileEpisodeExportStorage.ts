import { createHash } from 'node:crypto';
import { unlink } from 'node:fs/promises';
import {
  assertEpisodeExportArtifactIdentity,
  assertEpisodeExportSourceImage,
  isEpisodeExportProcessingError,
  permanentSourceError,
  permanentSourceUnavailableError,
  permanentStorageError,
} from '../../domain/episodeExportProcessing.js';
import type {
  EpisodeExportArtifactStorageIdentity,
  EpisodeExportArtifactStoragePort,
  EpisodeExportSourceImageLoaderPort,
  LoadedEpisodeExportSourceImage,
  StoreEpisodeExportArtifactInput,
} from '../../services/export/EpisodeExportStorage.js';
import {
  readLocalAsset,
  resolveLocalAssetPath,
  writeLocalAsset,
} from './LocalAssetFiles.js';

export interface LocalFileEpisodeExportStorageOptions {
  rootDir: string;
}

export class LocalFileEpisodeExportSourceImageLoader
implements EpisodeExportSourceImageLoaderPort {
  public constructor(
    private readonly options: LocalFileEpisodeExportStorageOptions,
  ) {}

  public async load(
    input: Parameters<EpisodeExportSourceImageLoaderPort['load']>[0],
  ): Promise<LoadedEpisodeExportSourceImage> {
    try {
      assertEpisodeExportSourceImage(input.s3Key, input.mimeType);
      const imageData = await readLocalAsset(
        this.options.rootDir,
        input.s3Key,
      );
      assertEpisodeExportSourceImage(
        input.s3Key,
        input.mimeType,
        imageData,
      );
      return {
        imageData,
        mimeType: input.mimeType,
        eTag: createHash('sha256').update(imageData).digest('hex'),
      };
    } catch (error) {
      if (isEpisodeExportProcessingError(error)) {
        throw error;
      }
      if (isMissingFileError(error)) {
        throw permanentSourceUnavailableError();
      }
      throw permanentSourceError();
    }
  }
}

export class LocalFileEpisodeExportArtifactStorage
implements EpisodeExportArtifactStoragePort {
  public constructor(
    private readonly options: LocalFileEpisodeExportStorageOptions,
  ) {}

  public async store(input: StoreEpisodeExportArtifactInput): Promise<void> {
    try {
      assertEpisodeExportArtifactIdentity(input, input.artifactData);
      await writeLocalAsset(
        this.options.rootDir,
        input.s3Key,
        input.artifactData,
      );
    } catch (error) {
      if (isEpisodeExportProcessingError(error)) {
        throw error;
      }
      throw permanentStorageError();
    }
  }

  public async delete(
    input: EpisodeExportArtifactStorageIdentity,
  ): Promise<void> {
    try {
      assertEpisodeExportArtifactIdentity(input);
      await unlink(resolveLocalAssetPath(this.options.rootDir, input.s3Key));
    } catch (error) {
      if (isEpisodeExportProcessingError(error)) {
        throw error;
      }
      if (isMissingFileError(error)) {
        return;
      }
      throw permanentStorageError();
    }
  }
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === 'ENOENT';
}
