import { createHash } from 'node:crypto';
import { ValidationError } from './errors/index.js';

export const EXPORT_FORMATS = ['pdf', 'zip'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];
export const EXPORT_JOB_STATUSES = ['queued', 'processing', 'completed', 'failed', 'canceled'] as const;
export type ExportJobStatus = (typeof EXPORT_JOB_STATUSES)[number];

export const MAX_EXPORT_PAGE_COUNT = 100;
export const MAX_EXPORT_FILENAME_LENGTH = 160;
export const MAX_EXPORT_ARTIFACT_BYTES = 128 * 1024 * 1024;
export const MAX_EXPORT_SOURCE_IMAGE_BYTES = 20 * 1024 * 1024;
export const MAX_EXPORT_TOTAL_SOURCE_BYTES = 64 * 1024 * 1024;
export const EXPORT_ARTIFACT_TTL_MS = 24 * 60 * 60 * 1000;
export const EXPORT_DOWNLOAD_URL_TTL_SECONDS = 5 * 60;
export const EXPORT_EXTERNAL_OPERATION_TIMEOUT_MS = 30_000;

export interface ExportPageSnapshot {
  pageId: string;
  pageNumber: number;
  s3Key: string;
  mimeType: ExportImageMimeType;
}

export type ExportImageMimeType = 'image/png' | 'image/jpeg' | 'image/webp';

export interface ExportJob {
  id: string;
  userId: string;
  organizationId: string | null;
  episodeId: string;
  format: ExportFormat;
  filename: string;
  pageIds: string[];
  pageSnapshot: ExportPageSnapshot[];
  requestFingerprint: string;
  status: ExportJobStatus;
  progressStage: string;
  progressPercent: number;
  artifactS3Key: string | null;
  artifactMimeType: string | null;
  artifactSizeBytes: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  expiresAt: Date;
}

export function normalizeExportFilename(value: string | undefined, format: ExportFormat): string {
  const fallback = `lyra-export.${format}`;
  if (value === undefined || value.trim().length === 0) {
    return fallback;
  }
  const basename = value.trim().replace(/\\/gu, '/').split('/').at(-1) ?? '';
  const stem = basename
    .replace(/\.[A-Za-z0-9]{1,10}$/u, '')
    .replace(/[^A-Za-z0-9._ -]/gu, '-')
    .replace(/[. ]+$/gu, '')
    .slice(0, MAX_EXPORT_FILENAME_LENGTH - format.length - 1);
  if (stem.length === 0 || stem === '.' || stem === '..') {
    return fallback;
  }
  return `${stem}.${format}`;
}

export function buildExportRequestFingerprint(input: {
  episodeId: string;
  format: ExportFormat;
  pageIds: string[];
  filename: string;
}): string {
  return createHash('sha256')
    .update(JSON.stringify({ ...input, pageIds: [...input.pageIds] }))
    .digest('hex');
}

export function assertExportImageMimeType(value: string): asserts value is ExportImageMimeType {
  if (value !== 'image/png' && value !== 'image/jpeg' && value !== 'image/webp') {
    throw new ValidationError('Export source image type is not supported');
  }
}
