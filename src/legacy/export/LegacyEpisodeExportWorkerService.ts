import {
  LEGACY_EXPORT_EXTERNAL_OPERATION_TIMEOUT_MS,
  MAX_LEGACY_EXPORT_ARTIFACT_BYTES,
  MAX_LEGACY_EXPORT_SOURCE_IMAGE_BYTES,
  MAX_LEGACY_EXPORT_TOTAL_SOURCE_BYTES,
  LegacyExportExternalTimeoutError,
  type LegacyExportFormat,
  type LegacyExportImageMimeType,
  type LegacyExportJob,
  withLegacyExportExternalTimeout,
} from './LegacyEpisodeExportJob.js';
import { PayloadTooLargeError, ValidationError } from '../../domain/errors/index.js';
import type { LegacyExportJobRepositoryPort } from './LegacyEpisodeExportJobRepository.js';

export interface LegacyExportArtifactSource {
  pageId: string;
  imageData: Buffer;
  mimeType: LegacyExportImageMimeType;
}
export interface LegacyBuiltExportArtifact {
  data: Buffer;
  mimeType: 'application/pdf' | 'application/zip';
  extension: LegacyExportFormat;
}
export interface LegacyExportArtifactBuilderPort {
  build(sources: LegacyExportArtifactSource[]): Promise<LegacyBuiltExportArtifact>;
}
export interface LegacyExportStoragePort {
  planArtifactTarget(input: { job: LegacyExportJob; artifact: LegacyBuiltExportArtifact }): string;
  loadPageImage(input: { s3Key: string; mimeType: LegacyExportImageMimeType }): Promise<Buffer>;
  storeArtifact(input: { jobId: string; s3Key: string; artifact: LegacyBuiltExportArtifact; expiresAt: Date }): Promise<void>;
  deleteArtifact(s3Key: string): Promise<void>;
}
export interface LegacyExportWorkerAccessGuardPort {
  assertLoadAllowed(input: { job: LegacyExportJob }): Promise<void>;
  assertPublishAllowed(input: {
    job: LegacyExportJob;
    artifactS3Key: string;
    artifactMimeType: LegacyBuiltExportArtifact['mimeType'];
    artifactSizeBytes: number;
  }): Promise<void>;
}
export interface ProcessLegacyExportJobResult {
  status: 'completed' | 'failed' | 'skipped' | 'retry';
  jobStatus?: 'completed' | 'failed';
  reason?: string;
}
export interface LegacyEpisodeExportWorkerPort { processJob(jobId: string): Promise<ProcessLegacyExportJobResult>; }
export interface LegacyEpisodeExportWorkerLimits { maxTotalSourceBytes?: number; externalOperationTimeoutMs?: number; }

export class LegacyEpisodeExportWorkerService implements LegacyEpisodeExportWorkerPort {
  public constructor(
    private readonly repository: LegacyExportJobRepositoryPort,
    private readonly storage: LegacyExportStoragePort,
    private readonly accessGuard: LegacyExportWorkerAccessGuardPort,
    private readonly artifactBuilderFactory: (format: LegacyExportJob['format']) => LegacyExportArtifactBuilderPort,
    private readonly limits: LegacyEpisodeExportWorkerLimits = {},
  ) {}

  public async processJob(jobId: string): Promise<ProcessLegacyExportJobResult> {
    const job = await this.repository.claim(jobId);
    if (job === null) {
      const expired = await this.repository.expireQueued(jobId);
      return expired ? { status: 'skipped', reason: 'EXPORT_EXPIRED' } : { status: 'skipped' };
    }

    let artifactTarget: string | null = null;
    let storedArtifact: LegacyBuiltExportArtifact | null = null;
    try {
      const timeoutMs = timeoutFor(this.limits);
      await withLegacyExportExternalTimeout(
        () => this.accessGuard.assertLoadAllowed({ job }),
        timeoutMs,
      );
      const sourceImages: LegacyExportArtifactSource[] = [];
      let totalSourceBytes = 0;
      const maxTotalSourceBytes = this.limits.maxTotalSourceBytes ?? MAX_LEGACY_EXPORT_TOTAL_SOURCE_BYTES;
      for (let index = 0; index < job.pageSnapshot.length; index += 1) {
        const page = job.pageSnapshot[index] as LegacyExportJob['pageSnapshot'][number];
        const imageData = await withLegacyExportExternalTimeout(
          () => this.storage.loadPageImage({ s3Key: page.s3Key, mimeType: page.mimeType }),
          timeoutMs,
        );
        if (imageData.length > MAX_LEGACY_EXPORT_SOURCE_IMAGE_BYTES) throw new PayloadTooLargeError('Export source image is too large');
        totalSourceBytes += imageData.length;
        if (totalSourceBytes > maxTotalSourceBytes) throw new PayloadTooLargeError('Export source images are too large');
        sourceImages.push({ pageId: page.pageId, imageData, mimeType: page.mimeType });
        if (!await this.repository.updateProgress(job.id, 'loading_images', Math.max(1, Math.floor(((index + 1) / job.pageSnapshot.length) * 50)))) {
          return { status: 'skipped', reason: 'EXPORT_SUPERSEDED' };
        }
      }
      if (!await this.repository.updateProgress(job.id, 'building_artifact', 65)) return { status: 'skipped', reason: 'EXPORT_SUPERSEDED' };
      const artifact = await this.artifactBuilderFactory(job.format).build(sourceImages);
      if (artifact.data.length > MAX_LEGACY_EXPORT_ARTIFACT_BYTES) throw new PayloadTooLargeError('Export artifact is too large');
      if (!await this.repository.updateProgress(job.id, 'storing_artifact', 90)) return { status: 'skipped', reason: 'EXPORT_SUPERSEDED' };

      artifactTarget = this.storage.planArtifactTarget({ job, artifact });
      assertArtifactTarget(artifactTarget);
      if (!await this.repository.registerArtifactTarget(job.id, artifactTarget)) return { status: 'skipped', reason: 'EXPORT_SUPERSEDED' };
      try {
        await withLegacyExportExternalTimeout(
          () => this.storage.storeArtifact({ jobId: job.id, s3Key: artifactTarget as string, artifact, expiresAt: job.expiresAt }),
          timeoutMs,
        );
      } catch {
        // Neither a timeout nor an SDK rejection proves that the remote write
        // failed. Keep the processing row and registered inventory until an
        // operator can reconcile the eventual result.
        return { status: 'retry', reason: 'EXPORT_STORE_UNKNOWN' };
      }
      storedArtifact = artifact;
      await withLegacyExportExternalTimeout(
        () => this.accessGuard.assertPublishAllowed({
          job,
          artifactS3Key: artifactTarget as string,
          artifactMimeType: artifact.mimeType,
          artifactSizeBytes: artifact.data.length,
        }),
        timeoutMs,
      );

      try {
        if (await this.repository.complete({
          jobId: job.id,
          artifactS3Key: artifactTarget,
          artifactMimeType: artifact.mimeType,
          artifactSizeBytes: artifact.data.length,
        })) return { status: 'completed', jobStatus: 'completed' };
      } catch {
        // A committed update can lose its response. Reconcile before cleanup.
      }
      return this.reconcileCompletion(job.id, artifactTarget, artifact, timeoutMs);
    } catch (error) {
      const failure = classifyExportFailure(error);
      let failed: boolean;
      try {
        failed = await this.repository.fail(job.id, failure.code, failure.message);
      } catch {
        return this.reconcileFailure(job.id, artifactTarget, storedArtifact, timeoutFor(this.limits));
      }
      if (!failed) return this.reconcileFailure(job.id, artifactTarget, storedArtifact, timeoutFor(this.limits));
      if (artifactTarget !== null && storedArtifact !== null) {
        await this.deleteUnusedArtifact(job.id, artifactTarget, timeoutFor(this.limits));
      }
      return { status: 'failed', jobStatus: 'failed', reason: failure.code };
    }
  }

  private async reconcileCompletion(jobId: string, artifactTarget: string, artifact: LegacyBuiltExportArtifact, timeoutMs: number): Promise<ProcessLegacyExportJobResult> {
    let current: LegacyExportJob | null;
    try { current = await this.repository.findForWorker(jobId); }
    catch { return { status: 'retry', reason: 'EXPORT_COMMIT_UNKNOWN' }; }
    if (isMatchingCompletedArtifact(current, artifactTarget, artifact)) return { status: 'completed', jobStatus: 'completed' };
    if (current !== null && current.artifactS3Key === artifactTarget && (current.status === 'failed' || current.status === 'canceled')) {
      await this.deleteUnusedArtifact(jobId, artifactTarget, timeoutMs);
      return current.status === 'failed'
        ? { status: 'failed', jobStatus: 'failed', reason: current.errorCode ?? 'EXPORT_FAILED' }
        : { status: 'skipped', reason: 'EXPORT_SUPERSEDED' };
    }
    return { status: 'retry', reason: 'EXPORT_COMMIT_UNKNOWN' };
  }

  private async reconcileFailure(jobId: string, artifactTarget: string | null, artifact: LegacyBuiltExportArtifact | null, timeoutMs: number): Promise<ProcessLegacyExportJobResult> {
    let current: LegacyExportJob | null;
    try { current = await this.repository.findForWorker(jobId); }
    catch { return { status: 'retry', reason: 'EXPORT_COMMIT_UNKNOWN' }; }
    if (artifactTarget !== null && artifact !== null && isMatchingCompletedArtifact(current, artifactTarget, artifact)) {
      return { status: 'completed', jobStatus: 'completed' };
    }
    if (current?.status === 'failed' || current?.status === 'canceled') {
      if (artifactTarget !== null && artifact !== null && current.artifactS3Key === artifactTarget) {
        await this.deleteUnusedArtifact(jobId, artifactTarget, timeoutMs);
      }
      return current.status === 'failed'
        ? { status: 'failed', jobStatus: 'failed', reason: current.errorCode ?? 'EXPORT_FAILED' }
        : { status: 'skipped', reason: 'EXPORT_SUPERSEDED' };
    }
    return { status: 'retry', reason: 'EXPORT_COMMIT_UNKNOWN' };
  }

  private async deleteUnusedArtifact(jobId: string, artifactS3Key: string, timeoutMs: number): Promise<void> {
    try {
      await withLegacyExportExternalTimeout(() => this.storage.deleteArtifact(artifactS3Key), timeoutMs);
      await this.repository.markArtifactDeleted(jobId);
    } catch {
      // The registered key remains durable for the bounded expiry cleanup path.
    }
  }
}

function timeoutFor(limits: LegacyEpisodeExportWorkerLimits): number {
  return limits.externalOperationTimeoutMs ?? LEGACY_EXPORT_EXTERNAL_OPERATION_TIMEOUT_MS;
}
function assertArtifactTarget(value: string): void {
  if (value.length < 1 || value.length > 1024 || value.startsWith('/') || value.includes('\\')
    || value.includes('\0') || value.split('/').some((segment) => segment.length === 0 || segment === '.' || segment === '..')) {
    throw new ValidationError('Export artifact target is invalid');
  }
}
function isMatchingCompletedArtifact(job: LegacyExportJob | null, artifactTarget: string, artifact: LegacyBuiltExportArtifact): boolean {
  return job?.status === 'completed' && job.artifactS3Key === artifactTarget
    && job.artifactMimeType === artifact.mimeType && job.artifactSizeBytes === artifact.data.length;
}
function classifyExportFailure(error: unknown): { code: string; message: string } {
  if (error instanceof LegacyExportExternalTimeoutError) return { code: 'EXPORT_TIMEOUT', message: 'Export external operation timed out' };
  if (error instanceof PayloadTooLargeError) return { code: 'EXPORT_TOO_LARGE', message: 'Export exceeds the supported size' };
  if (error instanceof ValidationError) return { code: 'EXPORT_SOURCE_UNAVAILABLE', message: 'One or more export pages are unavailable' };
  return { code: 'EXPORT_FAILED', message: 'Export could not be completed' };
}
