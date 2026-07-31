import { createHash } from 'node:crypto';
import { ConfigurationError, ValidationError } from './errors/index.js';

export const EPISODE_EXPORT_FORMATS = ['pdf', 'zip'] as const;
export type EpisodeExportFormat = (typeof EPISODE_EXPORT_FORMATS)[number];

export const EPISODE_EXPORT_JOB_STATUSES = [
  'queued',
  'processing',
  'completed',
  'failed',
  'canceled',
] as const;
export type EpisodeExportJobStatus = (typeof EPISODE_EXPORT_JOB_STATUSES)[number];

export type EpisodeExportImageMimeType = 'image/png' | 'image/jpeg' | 'image/webp';

export const EPISODE_EXPORT_MAX_PAGE_COUNT = 100;
export const EPISODE_EXPORT_MAX_FILENAME_LENGTH = 160;
export const EPISODE_EXPORT_MAX_ARTIFACT_BYTES = 128 * 1024 * 1024;
export const EPISODE_EXPORT_MAX_SOURCE_IMAGE_BYTES = 20 * 1024 * 1024;
export const EPISODE_EXPORT_MAX_TOTAL_SOURCE_BYTES = 64 * 1024 * 1024;
export const EPISODE_EXPORT_ARTIFACT_TTL_MS = 24 * 60 * 60 * 1000;
export const EPISODE_EXPORT_DOWNLOAD_URL_TTL_SECONDS = 5 * 60;
export const EPISODE_EXPORT_PROCESSING_LEASE_SECONDS = 15 * 60;
export const EPISODE_EXPORT_MAX_PROCESSING_ATTEMPTS = 5;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SAFE_IMAGE_KEY_EXTENSION_PATTERN = /\.(?:png|jpe?g|webp)$/iu;

export interface EpisodeExportPageSnapshot {
  pageId: string;
  pageNumber: number;
  s3Key: string;
  mimeType: EpisodeExportImageMimeType;
}

export interface EpisodeExportJob {
  id: string;
  userId: string;
  organizationId: string | null;
  episodeId: string;
  format: EpisodeExportFormat;
  filename: string;
  pageIds: string[];
  pageSnapshot: EpisodeExportPageSnapshot[];
  requestFingerprint: string;
  idempotencyKey: string;
  status: EpisodeExportJobStatus;
  progressStage: string;
  progressPercent: number;
  artifactS3Key: string | null;
  artifactMimeType: string | null;
  artifactSizeBytes: number | null;
  artifactDeletedAt: Date | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  expiresAt: Date;
  updatedAt: Date;
  attemptCount: number;
  processingLeaseToken: string | null;
  processingLeaseExpiresAt: Date | null;
  lastHeartbeatAt: Date | null;
}

export function normalizeEpisodeExportFilename(
  value: string | undefined,
  format: EpisodeExportFormat,
): string {
  const fallback = `lyra-export.${format}`;
  if (value === undefined || value.trim().length === 0) {
    return fallback;
  }

  const basename = value
    .normalize('NFC')
    .trim()
    .replace(/\\/gu, '/')
    .split('/')
    .at(-1) ?? '';
  const withoutControlCharacters = basename.replace(/[\u0000-\u001f\u007f]/gu, '-');
  const withoutExtension = withoutControlCharacters.replace(/\.[A-Za-z0-9]{1,10}$/u, '');
  const stem = withoutExtension.replace(/[. ]+$/gu, '');
  if (stem.length === 0 || stem === '.' || stem === '..') {
    return fallback;
  }

  const maximumStemLength = EPISODE_EXPORT_MAX_FILENAME_LENGTH - format.length - 1;
  const boundedStem = Array.from(stem).slice(0, maximumStemLength).join('');
  if (boundedStem.length === 0) {
    return fallback;
  }
  return `${boundedStem}.${format}`;
}

export function buildEpisodeExportRequestFingerprint(input: {
  episodeId: string;
  format: EpisodeExportFormat;
  pageIds: string[];
  filename: string;
}): string {
  return createHash('sha256')
    .update(JSON.stringify({
      episodeId: input.episodeId,
      format: input.format,
      pageIds: [...input.pageIds],
      filename: input.filename,
    }))
    .digest('hex');
}

export function buildEpisodeExportArtifactKey(input: {
  userId: string;
  organizationId: string | null;
  episodeId: string;
  jobId: string;
  format: EpisodeExportFormat;
}): string {
  assertUuid(input.userId, 'Export user ID');
  if (input.organizationId !== null) {
    assertUuid(input.organizationId, 'Export organization ID');
  }
  assertUuid(input.episodeId, 'Export episode ID');
  assertUuid(input.jobId, 'Export job ID');
  const scopeOwnerId = input.organizationId ?? input.userId;
  return `exports/${scopeOwnerId}/episodes/${input.episodeId}/${input.jobId}.${input.format}`;
}

export function inferEpisodeExportImageMimeType(
  s3Key: string,
): EpisodeExportImageMimeType {
  assertSafeEpisodeExportImageKey(s3Key);
  const normalized = s3Key.toLowerCase();
  if (normalized.endsWith('.png')) {
    return 'image/png';
  }
  if (normalized.endsWith('.jpg') || normalized.endsWith('.jpeg')) {
    return 'image/jpeg';
  }
  return 'image/webp';
}

export function parseEpisodeExportPageSnapshot(
  value: unknown,
): EpisodeExportPageSnapshot[] {
  if (
    !Array.isArray(value)
    || value.length < 1
    || value.length > EPISODE_EXPORT_MAX_PAGE_COUNT
  ) {
    throw new ValidationError('Episode export page snapshot is invalid');
  }

  const parsed = value.map((entry): EpisodeExportPageSnapshot => {
    if (!isRecord(entry)) {
      throw new ValidationError('Episode export page snapshot is invalid');
    }
    const pageId = entry.page_id;
    const pageNumber = entry.page_number;
    const s3Key = entry.s3_key;
    const mimeType = entry.mime_type;
    if (
      typeof pageId !== 'string'
      || !UUID_PATTERN.test(pageId)
      || typeof pageNumber !== 'number'
      || !Number.isInteger(pageNumber)
      || pageNumber < 1
      || typeof s3Key !== 'string'
      || typeof mimeType !== 'string'
      || !isEpisodeExportImageMimeType(mimeType)
    ) {
      throw new ValidationError('Episode export page snapshot is invalid');
    }
    assertSafeEpisodeExportImageKey(s3Key);
    if (inferEpisodeExportImageMimeType(s3Key) !== mimeType) {
      throw new ValidationError('Episode export page snapshot is invalid');
    }
    return { pageId, pageNumber, s3Key, mimeType };
  });

  if (new Set(parsed.map((page) => page.pageId)).size !== parsed.length) {
    throw new ValidationError('Episode export page snapshot is invalid');
  }
  return parsed;
}

export function toPersistedEpisodeExportPageSnapshot(
  pages: EpisodeExportPageSnapshot[],
): Array<{
  page_id: string;
  page_number: number;
  s3_key: string;
  mime_type: EpisodeExportImageMimeType;
}> {
  return pages.map((page) => ({
    page_id: page.pageId,
    page_number: page.pageNumber,
    s3_key: page.s3Key,
    mime_type: page.mimeType,
  }));
}

function isEpisodeExportImageMimeType(
  value: string,
): value is EpisodeExportImageMimeType {
  return value === 'image/png' || value === 'image/jpeg' || value === 'image/webp';
}

function assertSafeEpisodeExportImageKey(s3Key: string): void {
  if (
    s3Key.length === 0
    || s3Key.length > 1024
    || s3Key.startsWith('/')
    || s3Key.includes('\\')
    || s3Key.includes('\0')
    || s3Key.split('/').some((segment) => (
      segment.length === 0 || segment === '.' || segment === '..'
    ))
    || !SAFE_IMAGE_KEY_EXTENSION_PATTERN.test(s3Key)
  ) {
    throw new ValidationError('Episode export page snapshot is invalid');
  }
}

function assertUuid(value: string, fieldName: string): void {
  if (!UUID_PATTERN.test(value)) {
    throw new ConfigurationError(`${fieldName} is invalid`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
