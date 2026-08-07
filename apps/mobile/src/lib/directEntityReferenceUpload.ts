import type {
  CreateEntityReferenceUploadPayload,
  EntityReferenceUploadMimeType
} from '@/domain/payloads';
import type { EntityType } from '@/domain/types';
import { ApiError } from '@/lib/api';

export type DirectEntityUploadStage = 'presign' | 'upload' | 'finalize';
export type DirectEntityUploadErrorCode =
  | 'PRESIGN_FAILED'
  | 'PRESIGN_MISMATCH'
  | 'UPLOAD_CANCELED'
  | 'UPLOAD_FAILED'
  | 'FINALIZE_UNCERTAIN';

export interface BinaryUploadResult {
  body: string;
  headers: Record<string, string>;
  status: number;
}

export interface BinaryUploadTask {
  uploadAsync: () => Promise<BinaryUploadResult>;
  cancel: () => void;
  release: () => void;
}

export interface BinaryUploadSource {
  createUploadTask: (input: {
    url: string;
    headers: Record<string, string>;
    mimeType: EntityReferenceUploadMimeType;
    signal?: AbortSignal;
    onProgress: (input: { bytesSent: number; totalBytes: number }) => void;
  }) => BinaryUploadTask;
}

export interface EntityReferenceUploadPresignResult {
  upload_url: string;
  upload_token: string;
  expires_at: string;
  upload_headers: {
    'Content-Type': EntityReferenceUploadMimeType;
    'x-amz-server-side-encryption': 'AES256';
  };
}

interface UploadAndImportEntityReferenceInput<Result> {
  source: BinaryUploadSource;
  mimeType: EntityReferenceUploadMimeType;
  sizeBytes: number;
  entityType: EntityType;
  entityId: string | null;
  signal?: AbortSignal;
  createPresignedUpload: (
    payload: CreateEntityReferenceUploadPayload
  ) => Promise<EntityReferenceUploadPresignResult>;
  finalizeImport: (uploadToken: string) => Promise<Result>;
  legacyImport?: () => Promise<Result>;
  onFinalizeTokenReady?: (uploadToken: string) => void;
  onProgress: (percent: number) => void;
  onStageChange: (stage: DirectEntityUploadStage) => void;
  resumeFinalizeToken?: string | null;
}

export class DirectEntityUploadError extends Error {
  public readonly code: DirectEntityUploadErrorCode;
  public readonly retryable: boolean;
  public readonly stage: DirectEntityUploadStage;

  public constructor(
    code: DirectEntityUploadErrorCode,
    stage: DirectEntityUploadStage,
    retryable: boolean,
    message: string
  ) {
    super(message);
    this.name = 'DirectEntityUploadError';
    this.code = code;
    this.stage = stage;
    this.retryable = retryable;
  }
}

export async function uploadAndImportEntityReference<Result>(
  input: UploadAndImportEntityReferenceInput<Result>
): Promise<Result> {
  if (input.resumeFinalizeToken !== undefined && input.resumeFinalizeToken !== null) {
    return finalizeEntityReference(input, input.resumeFinalizeToken);
  }

  assertNotCanceled(input.signal, 'presign');
  input.onStageChange('presign');

  let presign: EntityReferenceUploadPresignResult;
  try {
    presign = await input.createPresignedUpload({
      mime_type: input.mimeType,
      size_bytes: input.sizeBytes,
      ...(input.entityId === null ? {} : { entity_id: input.entityId })
    });
  } catch (error) {
    if (isAbortError(error) || input.signal?.aborted === true) {
      throw canceledError('presign');
    }
    if (isLegacyPresignUnavailable(error) && input.legacyImport !== undefined) {
      return finalizeLegacyEntityReference(input);
    }
    throw new DirectEntityUploadError(
      'PRESIGN_FAILED',
      'presign',
      isRetryableTransportError(error),
      'The upload could not be prepared.'
    );
  }

  if (presign.upload_headers['Content-Type'] !== input.mimeType) {
    throw new DirectEntityUploadError(
      'PRESIGN_MISMATCH',
      'presign',
      false,
      'The upload contract did not match the selected file.'
    );
  }

  assertNotCanceled(input.signal, 'upload');
  input.onStageChange('upload');
  let lastProgress = 0;
  const task = input.source.createUploadTask({
    url: presign.upload_url,
    headers: presign.upload_headers,
    mimeType: input.mimeType,
    ...(input.signal === undefined ? {} : { signal: input.signal }),
    onProgress: ({ bytesSent, totalBytes }) => {
      const denominator = totalBytes > 0 ? totalBytes : input.sizeBytes;
      const progress = denominator <= 0 ? 0 : clampPercent(Math.round((bytesSent / denominator) * 100));
      lastProgress = Math.max(lastProgress, progress);
      input.onProgress(lastProgress);
    }
  });
  const cancelTask = (): void => task.cancel();
  input.signal?.addEventListener('abort', cancelTask, { once: true });

  try {
    const uploadResult = await task.uploadAsync();
    if (uploadResult.status < 200 || uploadResult.status >= 300) {
      throw new DirectEntityUploadError(
        'UPLOAD_FAILED',
        'upload',
        isRetryableUploadStatus(uploadResult.status),
        'The image upload failed.'
      );
    }
    if (lastProgress < 100) {
      input.onProgress(100);
    }
  } catch (error) {
    if (error instanceof DirectEntityUploadError) {
      throw error;
    }
    if (isAbortError(error) || input.signal?.aborted === true) {
      throw canceledError('upload');
    }
    throw new DirectEntityUploadError(
      'UPLOAD_FAILED',
      'upload',
      isRetryableTransportError(error),
      'The image upload failed.'
    );
  } finally {
    input.signal?.removeEventListener('abort', cancelTask);
    task.release();
  }

  input.onFinalizeTokenReady?.(presign.upload_token);
  return finalizeEntityReference(input, presign.upload_token);
}

async function finalizeEntityReference<Result>(
  input: UploadAndImportEntityReferenceInput<Result>,
  uploadToken: string
): Promise<Result> {
  assertNotCanceled(input.signal, 'finalize');
  input.onStageChange('finalize');
  try {
    return await input.finalizeImport(uploadToken);
  } catch (error) {
    if (isAbortError(error) || input.signal?.aborted === true) {
      throw canceledError('finalize');
    }
    throw new DirectEntityUploadError(
      'FINALIZE_UNCERTAIN',
      'finalize',
      isRetryableTransportError(error),
      'The import result could not be confirmed.'
    );
  }
}

async function finalizeLegacyEntityReference<Result>(
  input: UploadAndImportEntityReferenceInput<Result>,
): Promise<Result> {
  const legacyImport = input.legacyImport;
  if (legacyImport === undefined) {
    throw new DirectEntityUploadError(
      'FINALIZE_UNCERTAIN',
      'finalize',
      false,
      'The import result could not be confirmed.',
    );
  }

  assertNotCanceled(input.signal, 'finalize');
  input.onStageChange('finalize');
  try {
    return await legacyImport();
  } catch (error) {
    if (isAbortError(error) || input.signal?.aborted === true) {
      throw canceledError('finalize');
    }
    throw new DirectEntityUploadError(
      'FINALIZE_UNCERTAIN',
      'finalize',
      isRetryableTransportError(error),
      'The import result could not be confirmed.',
    );
  }
}

function assertNotCanceled(
  signal: AbortSignal | undefined,
  stage: DirectEntityUploadStage
): void {
  if (signal?.aborted === true) {
    throw canceledError(stage);
  }
}

function canceledError(stage: DirectEntityUploadStage): DirectEntityUploadError {
  return new DirectEntityUploadError(
    'UPLOAD_CANCELED',
    stage,
    false,
    'The image upload was canceled.'
  );
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value));
}

function isAbortError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && Reflect.get(error, 'name') === 'AbortError';
}

function isRetryableTransportError(error: unknown): boolean {
  if (error instanceof TypeError) {
    return true;
  }
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const status = Reflect.get(error, 'status');
  return typeof status === 'number' && isRetryableUploadStatus(status);
}

function isRetryableUploadStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function isLegacyPresignUnavailable(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 404 || error.status === 405);
}
