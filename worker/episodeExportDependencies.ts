import { ConfigurationError } from '../src/domain/errors/index.js';
import {
  S3EpisodeExportArtifactStorage,
  S3EpisodeExportSourceImageLoader,
} from '../src/infrastructure/aws/S3EpisodeExportStorage.js';
import { createPageImageStorageClient } from '../src/infrastructure/aws/S3PageImageStorage.js';
import {
  LocalFileEpisodeExportArtifactStorage,
  LocalFileEpisodeExportSourceImageLoader,
} from '../src/infrastructure/local/LocalFileEpisodeExportStorage.js';
import { resolveLocalAssetConfig } from '../src/infrastructure/local/LocalAssetFiles.js';
import { db } from '../src/lib/db.js';
import { env } from '../src/lib/env.js';
import {
  PostgresEpisodeExportJobRepository,
  type EpisodeExportJobRepository,
} from '../src/repositories/EpisodeExportJobRepository.js';
import {
  EpisodeExportArtifactBuilder,
  type EpisodeExportArtifactBuilderPort,
} from '../src/services/export/EpisodeExportArtifactBuilder.js';
import type {
  EpisodeExportArtifactStoragePort,
  EpisodeExportSourceImageLoaderPort,
} from '../src/services/export/EpisodeExportStorage.js';
import {
  EpisodeExportWorkerService,
} from '../src/services/export/EpisodeExportWorkerService.js';
import type {
  EpisodeExportWorkerDependencies,
  EpisodeExportWorkerPort,
} from './episodeExport.js';

export interface ResolvedEpisodeExportWorkerDependencies
extends EpisodeExportWorkerDependencies {
  repository: EpisodeExportJobRepository;
  artifactStorage: EpisodeExportArtifactStoragePort;
}

export interface EpisodeExportWorkerDependencyOverrides {
  repository?: EpisodeExportJobRepository;
  sourceLoader?: EpisodeExportSourceImageLoaderPort;
  artifactBuilder?: EpisodeExportArtifactBuilderPort;
  artifactStorage?: EpisodeExportArtifactStoragePort;
  episodeExportWorkerService?: EpisodeExportWorkerPort;
}

export function resolveEpisodeExportWorkerDependencies(
  overrides: EpisodeExportWorkerDependencyOverrides = {},
): ResolvedEpisodeExportWorkerDependencies {
  const repository =
    overrides.repository ?? new PostgresEpisodeExportJobRepository(db, db);
  const storage = resolveStorage();
  const sourceLoader = overrides.sourceLoader ?? storage.sourceLoader;
  const artifactStorage = overrides.artifactStorage ?? storage.artifactStorage;
  const artifactBuilder =
    overrides.artifactBuilder ?? new EpisodeExportArtifactBuilder();
  const episodeExportWorkerService =
    overrides.episodeExportWorkerService
    ?? new EpisodeExportWorkerService(
      repository,
      sourceLoader,
      artifactBuilder,
      artifactStorage,
    );

  return {
    episodeExportWorkerService,
    repository,
    artifactStorage,
  };
}

function resolveStorage(): {
  sourceLoader: EpisodeExportSourceImageLoaderPort;
  artifactStorage: EpisodeExportArtifactStoragePort;
} {
  const localConfig = resolveLocalAssetConfig(
    env.LOCAL_FILE_STORAGE_DIR,
    env.LOCAL_ASSET_BASE_URL,
    env.PORT,
  );
  if (localConfig !== null) {
    return {
      sourceLoader: new LocalFileEpisodeExportSourceImageLoader(localConfig),
      artifactStorage: new LocalFileEpisodeExportArtifactStorage(localConfig),
    };
  }
  if (env.S3_BUCKET_IMAGES === undefined) {
    throw new ConfigurationError(
      'S3_BUCKET_IMAGES is required for episode export worker storage',
    );
  }
  const client = createPageImageStorageClient(env.AWS_REGION);
  const options = { bucketName: env.S3_BUCKET_IMAGES };
  return {
    sourceLoader: new S3EpisodeExportSourceImageLoader(client, options),
    artifactStorage: new S3EpisodeExportArtifactStorage(client, options),
  };
}
