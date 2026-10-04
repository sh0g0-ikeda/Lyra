import { createHash } from 'node:crypto';
import { ValidationError } from '../../domain/errors/index.js';

export const LEGACY_EXPORT_FORMATS = ['pdf', 'zip'] as const;
export type LegacyExportFormat = (typeof LEGACY_EXPORT_FORMATS)[number];
export const LEGACY_EXPORT_JOB_STATUSES = ['queued', 'processing', 'completed', 'failed', 'canceled'] as const;
export type LegacyExportJobStatus = (typeof LEGACY_EXPORT_JOB_STATUSES)[number];

export const MAX_LEGACY_EXPORT_PAGE_COUNT = 100;
export const MAX_LEGACY_EXPORT_FILENAME_LENGTH = 160;
export const MAX_LEGACY_EXPORT_ARTIFACT_BYTES = 128 * 1024 * 1024;
export const MAX_LEGACY_EXPORT_SOURCE_IMAGE_BYTES = 20 * 1024 * 1024;
export const MAX_LEGACY_EXPORT_TOTAL_SOURCE_BYTES = 64 * 1024 * 1024;
export const LEGACY_EXPORT_ARTIFACT_TTL_MS = 24 * 60 * 60 * 1000;
export const LEGACY_EXPORT_DOWNLOAD_URL_TTL_SECONDS = 5 * 60;
export const LEGACY_EXPORT_EXTERNAL_OPERATION_TIMEOUT_MS = 30_000;

export class LegacyExportExternalTimeoutError extends Error {
  public constructor() {
    super('Legacy export external operation timed out');
    this.name = 'LegacyExportExternalTimeoutError';
  }
}

export async function withLegacyExportExternalTimeout<T>(
  operation: () => Promise<T>,
  timeoutMs = LEGACY_EXPORT_EXTERNAL_OPERATION_TIMEOUT_MS,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const operationPromise = operation();
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => reject(new LegacyExportExternalTimeoutError()), timeoutMs);
  });
  try {
    return await Promise.race([operationPromise, timeoutPromise]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

export interface LegacyExportPageSnapshot {
  pageId: string;
  pageNumber: number;
  s3Key: string;
  mimeType: LegacyExportImageMimeType;
}

export type LegacyExportImageMimeType = 'image/png' | 'image/jpeg' | 'image/webp';

export interface LegacyExportJob {
  id: string;
  userId: string;
  organizationId: string | null;
  episodeId: string;
  format: LegacyExportFormat;
  filename: string;
  pageIds: string[];
  pageSnapshot: LegacyExportPageSnapshot[];
  requestFingerprint: string;
  status: LegacyExportJobStatus;
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

export function normalizeLegacyExportFilename(value: string | undefined, format: LegacyExportFormat): string {
  const fallback = `lyra-export.${format}`;
  if (value === undefined || value.trim().length === 0) {
    return fallback;
  }
  const basename = value.trim().replace(/\\/gu, '/').split('/').at(-1) ?? '';
  const stem = basename
    .replace(/\.[A-Za-z0-9]{1,10}$/u, '')
    .replace(/[^A-Za-z0-9._ -]/gu, '-')
    .replace(/[. ]+$/gu, '')
    .slice(0, MAX_LEGACY_EXPORT_FILENAME_LENGTH - format.length - 1);
  if (stem.length === 0 || stem === '.' || stem === '..') {
    return fallback;
  }
  return `${stem}.${format}`;
}

export function buildLegacyExportRequestFingerprint(input: {
  episodeId: string;
  format: LegacyExportFormat;
  pageIds: string[];
  filename: string;
}): string {
  return createHash('sha256')
    .update(JSON.stringify({ ...input, pageIds: [...input.pageIds] }))
    .digest('hex');
}

export function assertLegacyExportImageMimeType(value: string): asserts value is LegacyExportImageMimeType {
  if (value !== 'image/png' && value !== 'image/jpeg' && value !== 'image/webp') {
    throw new ValidationError('Export source image type is not supported');
  }
}
