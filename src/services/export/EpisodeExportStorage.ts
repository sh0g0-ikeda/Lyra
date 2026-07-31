import type {
  EpisodeExportFormat,
  EpisodeExportImageMimeType,
} from '../../domain/episodeExportJob.js';
import type {
  EpisodeExportArtifactMimeType,
} from '../../domain/episodeExportProcessing.js';

export interface LoadedEpisodeExportSourceImage {
  imageData: Buffer;
  mimeType: EpisodeExportImageMimeType;
  eTag: string;
}

export interface EpisodeExportSourceImageLoaderPort {
  load(input: {
    s3Key: string;
    mimeType: EpisodeExportImageMimeType;
  }): Promise<LoadedEpisodeExportSourceImage>;
}

export interface EpisodeExportArtifactStorageIdentity {
  userId: string;
  organizationId: string | null;
  episodeId: string;
  jobId: string;
  format: EpisodeExportFormat;
  s3Key: string;
  mimeType: EpisodeExportArtifactMimeType;
}

export interface StoreEpisodeExportArtifactInput
  extends EpisodeExportArtifactStorageIdentity {
  artifactData: Buffer;
}

export interface EpisodeExportArtifactStoragePort {
  store(input: StoreEpisodeExportArtifactInput): Promise<void>;
  delete(input: EpisodeExportArtifactStorageIdentity): Promise<void>;
}
