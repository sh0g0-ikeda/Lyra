import {
  EPISODE_EXPORT_MAX_ARTIFACT_BYTES,
  EPISODE_EXPORT_MAX_SOURCE_IMAGE_BYTES,
  buildEpisodeExportArtifactKey,
  inferEpisodeExportImageMimeType,
  type EpisodeExportFormat,
  type EpisodeExportImageMimeType,
} from './episodeExportJob.js';

export const EPISODE_EXPORT_MAX_INPUT_PIXELS = 40_000_000;
export const EPISODE_EXPORT_IMAGE_DECODE_TIMEOUT_SECONDS = 30;
export const EPISODE_EXPORT_STORAGE_TIMEOUT_MS = 30_000;
export const EPISODE_EXPORT_STORAGE_MAX_ATTEMPTS = 3;
export const EPISODE_EXPORT_STORAGE_RETRY_DELAY_MS = 250;
export const EPISODE_EXPORT_ARTIFACT_CACHE_CONTROL =
  'private, max-age=0, no-store';

export type EpisodeExportArtifactMimeType =
  | 'application/pdf'
  | 'application/zip';

export class EpisodeExportProcessingError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
    public readonly retryable: boolean,
    public readonly leaseLost = false,
  ) {
    super(message);
    this.name = 'EpisodeExportProcessingError';
  }
}

export interface EpisodeExportArtifactIdentity {
  userId: string;
  organizationId: string | null;
  episodeId: string;
  jobId: string;
  format: EpisodeExportFormat;
  s3Key: string;
  mimeType: EpisodeExportArtifactMimeType;
}

export function assertEpisodeExportSourceImage(
  s3Key: string,
  mimeType: EpisodeExportImageMimeType,
  imageData?: Buffer,
): void {
  try {
    if (inferEpisodeExportImageMimeType(s3Key) !== mimeType) {
      throw new Error('MIME mismatch');
    }
  } catch {
    throw permanentSourceError();
  }

  if (imageData === undefined) {
    return;
  }
  if (
    imageData.length < 1
    || imageData.length > EPISODE_EXPORT_MAX_SOURCE_IMAGE_BYTES
    || !hasExpectedImageSignature(imageData, mimeType)
  ) {
    throw permanentSourceError();
  }
}

export function assertEpisodeExportArtifactIdentity(
  input: EpisodeExportArtifactIdentity,
  artifactData?: Buffer,
): void {
  let expectedKey: string;
  try {
    expectedKey = buildEpisodeExportArtifactKey(input);
  } catch {
    throw permanentStorageError();
  }
  if (
    input.s3Key !== expectedKey
    || input.mimeType !== episodeExportArtifactMimeType(input.format)
    || (
      artifactData !== undefined
      && (
        artifactData.length < 1
        || artifactData.length > EPISODE_EXPORT_MAX_ARTIFACT_BYTES
      )
    )
  ) {
    throw permanentStorageError();
  }
}

export function episodeExportArtifactMimeType(
  format: EpisodeExportFormat,
): EpisodeExportArtifactMimeType {
  return format === 'pdf' ? 'application/pdf' : 'application/zip';
}

export function isEpisodeExportProcessingError(
  error: unknown,
): error is EpisodeExportProcessingError {
  return error instanceof EpisodeExportProcessingError;
}

export function permanentSourceError(): EpisodeExportProcessingError {
  return new EpisodeExportProcessingError(
    'EXPORT_SOURCE_INVALID',
    'One or more page images are unavailable for export',
    false,
  );
}

export function permanentSourceUnavailableError(): EpisodeExportProcessingError {
  return new EpisodeExportProcessingError(
    'EXPORT_SOURCE_UNAVAILABLE',
    'One or more page images are unavailable for export',
    false,
  );
}

export function permanentStorageError(): EpisodeExportProcessingError {
  return new EpisodeExportProcessingError(
    'EXPORT_STORAGE_FAILED',
    'The episode export artifact could not be stored',
    false,
  );
}

export function temporaryExportError(): EpisodeExportProcessingError {
  return new EpisodeExportProcessingError(
    'EXPORT_TEMPORARY_FAILURE',
    'Episode export is temporarily unavailable',
    true,
  );
}

function hasExpectedImageSignature(
  imageData: Buffer,
  mimeType: EpisodeExportImageMimeType,
): boolean {
  if (mimeType === 'image/png') {
    return imageData.length >= 8
      && imageData.subarray(0, 8).equals(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      );
  }
  if (mimeType === 'image/jpeg') {
    return imageData.length >= 3
      && imageData[0] === 0xff
      && imageData[1] === 0xd8
      && imageData[2] === 0xff;
  }
  return imageData.length >= 12
    && imageData.subarray(0, 4).toString('ascii') === 'RIFF'
    && imageData.subarray(8, 12).toString('ascii') === 'WEBP';
}
