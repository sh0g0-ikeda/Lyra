import type { QueryResultRow } from 'pg';
import {
  assertExportImageMimeType,
  type ExportFormat,
  type ExportJob,
  type ExportJobStatus,
  type ExportPageSnapshot,
} from '../domain/exportJob.js';
import { ConflictError, NotFoundError, ValidationError } from '../domain/errors/index.js';
import type { DatabaseClient, TransactionRunner } from '../lib/db.js';

export interface CreateExportJobInput {
  userId: string;
  organizationId: string | null;
  episodeId: string;
  pageIds: string[];
  format: ExportFormat;
  filename: string;
  requestFingerprint: string;
  idempotencyKey: string;
  expiresAt: Date;
}

export interface ExportJobRepository {
  createOrGet(input: CreateExportJobInput): Promise<{ job: ExportJob; created: boolean }>;
  findForScope(input: { userId: string; organizationId: string | null; jobId: string }): Promise<ExportJob | null>;
  findForWorker(jobId: string): Promise<ExportJob | null>;
  claim(jobId: string): Promise<ExportJob | null>;
  updateProgress(jobId: string, stage: string, percent: number): Promise<void>;
  complete(input: { jobId: string; artifactS3Key: string; artifactMimeType: string; artifactSizeBytes: number }): Promise<void>;
  fail(jobId: string, errorCode: string, errorMessage: string): Promise<void>;
  markDispatched(jobId: string, messageId: string | null): Promise<void>;
  markDispatchFailure(jobId: string, message: string): Promise<void>;
  listUndispatched(limit: number): Promise<ExportJob[]>;
  listExpiredArtifacts(limit: number): Promise<Array<{ id: string; artifactS3Key: string }>>;
  markArtifactDeleted(jobId: string): Promise<void>;
}

interface ExportJobRow extends QueryResultRow {
  id: string;
  user_id: string;
  organization_id: string | null;
  episode_id: string;
  format: ExportFormat;
  filename: string;
  page_ids: string[];
  page_snapshot: unknown;
  request_fingerprint: string;
  status: ExportJobStatus;
  progress_stage: string;
  progress_percent: number;
  artifact_s3_key: string | null;
  artifact_mime_type: string | null;
  artifact_size_bytes: string | number | null;
  error_code: string | null;
  error_message: string | null;
  created_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
  expires_at: Date;
}

interface SnapshotRow extends QueryResultRow {
  page_id: string;
  page_number: number;
  s3_key: string;
  mime_type: string;
}

export class PostgresExportJobRepository implements ExportJobRepository {
  public constructor(
    private readonly client: DatabaseClient,
    private readonly transactionRunner: TransactionRunner = { transaction: async (work) => work(client) },
  ) {}

  public async createOrGet(input: CreateExportJobInput): Promise<{ job: ExportJob; created: boolean }> {
    return this.transactionRunner.transaction(async (transaction) => {
      const existing = await this.findByIdempotencyKey(transaction, input);
      if (existing !== null) {
        assertIdempotencyRequestMatches(existing, input);
        return { job: existing, created: false };
      }

      const snapshot = await this.loadAuthorizedSnapshot(transaction, input);
      if (snapshot.length !== input.pageIds.length) {
        throw new NotFoundError('One or more export pages were not found');
      }

      try {
        const result = await transaction.query<ExportJobRow>(
          `
          INSERT INTO export_jobs (
            user_id, organization_id, episode_id, format, filename, page_ids,
            page_snapshot, request_fingerprint, idempotency_key, expires_at
          )
          VALUES ($1, $2, $3, $4, $5, $6::uuid[], $7::jsonb, $8, $9, $10)
          RETURNING *
          `,
          [
            input.userId,
            input.organizationId,
            input.episodeId,
            input.format,
            input.filename,
            input.pageIds,
            JSON.stringify(snapshot),
            input.requestFingerprint,
            input.idempotencyKey,
            input.expiresAt,
          ],
        );
        const row = result.rows[0];
        if (row === undefined) {
          throw new ConflictError('Unable to create export job');
        }
        await transaction.query(
          'INSERT INTO export_job_outbox (export_job_id) VALUES ($1)',
          [row.id],
        );
        return { job: mapExportJobRow(row), created: true };
      } catch (error) {
        if (!isUniqueViolation(error)) {
          throw error;
        }
        const current = await this.findByIdempotencyKey(transaction, input);
        if (current !== null) {
          assertIdempotencyRequestMatches(current, input);
          return { job: current, created: false };
        }
        throw new ConflictError('An identical export is already active');
      }
    });
  }

  public async findForScope(input: { userId: string; organizationId: string | null; jobId: string }): Promise<ExportJob | null> {
    const result = await this.client.query<ExportJobRow>(
      `
      SELECT export_jobs.*
      FROM export_jobs
      WHERE export_jobs.id = $1
        AND (
          ($3::uuid IS NULL AND export_jobs.organization_id IS NULL AND export_jobs.user_id = $2)
          OR ($3::uuid IS NOT NULL AND export_jobs.organization_id = $3::uuid AND EXISTS (
            SELECT 1 FROM organization_members
            WHERE organization_members.organization_id = export_jobs.organization_id
              AND organization_members.user_id = $2
              AND organization_members.status = 'active'
          ))
        )
      `,
      [input.jobId, input.userId, input.organizationId],
    );
    const row = result.rows[0];
    return row === undefined ? null : mapExportJobRow(row);
  }

  public async findForWorker(jobId: string): Promise<ExportJob | null> {
    const result = await this.client.query<ExportJobRow>('SELECT * FROM export_jobs WHERE id = $1', [jobId]);
    const row = result.rows[0];
    return row === undefined ? null : mapExportJobRow(row);
  }

  public async claim(jobId: string): Promise<ExportJob | null> {
    const result = await this.client.query<ExportJobRow>(
      `
      UPDATE export_jobs
      SET status = 'processing', progress_stage = 'loading_images', progress_percent = 1,
          started_at = COALESCE(started_at, NOW()), updated_at = NOW()
      WHERE id = $1 AND status = 'queued' AND expires_at > NOW()
      RETURNING *
      `,
      [jobId],
    );
    const row = result.rows[0];
    return row === undefined ? null : mapExportJobRow(row);
  }

  public async updateProgress(jobId: string, stage: string, percent: number): Promise<void> {
    await this.client.query(
      `UPDATE export_jobs SET progress_stage = $2, progress_percent = $3, updated_at = NOW()
       WHERE id = $1 AND status = 'processing'`,
      [jobId, stage, percent],
    );
  }

  public async complete(input: { jobId: string; artifactS3Key: string; artifactMimeType: string; artifactSizeBytes: number }): Promise<void> {
    await this.client.query(
      `
      UPDATE export_jobs
      SET status = 'completed', progress_stage = 'completed', progress_percent = 100,
          artifact_s3_key = $2, artifact_mime_type = $3, artifact_size_bytes = $4,
          error_code = NULL, error_message = NULL, completed_at = NOW(), updated_at = NOW()
      WHERE id = $1 AND status = 'processing'
      `,
      [input.jobId, input.artifactS3Key, input.artifactMimeType, input.artifactSizeBytes],
    );
  }

  public async fail(jobId: string, errorCode: string, errorMessage: string): Promise<void> {
    await this.client.query(
      `UPDATE export_jobs SET status = 'failed', progress_stage = 'failed', error_code = $2,
       error_message = $3, completed_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND status IN ('queued', 'processing')`,
      [jobId, errorCode, errorMessage],
    );
  }

  public async markDispatched(jobId: string, messageId: string | null): Promise<void> {
    await this.client.query(
      `UPDATE export_job_outbox SET dispatched_at = NOW(), sqs_message_id = $2,
       dispatch_attempts = dispatch_attempts + 1, last_dispatch_error = NULL WHERE export_job_id = $1`,
      [jobId, messageId],
    );
  }

  public async markDispatchFailure(jobId: string, message: string): Promise<void> {
    await this.client.query(
      `UPDATE export_job_outbox SET dispatch_attempts = dispatch_attempts + 1, last_dispatch_error = $2 WHERE export_job_id = $1`,
      [jobId, message],
    );
  }

  public async listUndispatched(limit: number): Promise<ExportJob[]> {
    const result = await this.client.query<ExportJobRow>(
      `SELECT export_jobs.* FROM export_job_outbox INNER JOIN export_jobs ON export_jobs.id = export_job_outbox.export_job_id
       WHERE export_job_outbox.dispatched_at IS NULL AND export_jobs.status = 'queued'
       ORDER BY export_job_outbox.created_at ASC LIMIT $1`,
      [Math.max(1, Math.min(limit, 100))],
    );
    return result.rows.map(mapExportJobRow);
  }

  public async listExpiredArtifacts(limit: number): Promise<Array<{ id: string; artifactS3Key: string }>> {
    const result = await this.client.query<{ id: string; artifact_s3_key: string }>(
      `SELECT id, artifact_s3_key FROM export_jobs
       WHERE expires_at <= NOW() AND artifact_s3_key IS NOT NULL AND artifact_deleted_at IS NULL
       ORDER BY expires_at ASC LIMIT $1`,
      [Math.max(1, Math.min(limit, 1000))],
    );
    return result.rows.map((row) => ({ id: row.id, artifactS3Key: row.artifact_s3_key }));
  }

  public async markArtifactDeleted(jobId: string): Promise<void> {
    await this.client.query(
      'UPDATE export_jobs SET artifact_deleted_at = NOW(), updated_at = NOW() WHERE id = $1 AND artifact_deleted_at IS NULL',
      [jobId],
    );
  }

  private async findByIdempotencyKey(client: DatabaseClient, input: CreateExportJobInput): Promise<ExportJob | null> {
    const result = await client.query<ExportJobRow>(
      `SELECT * FROM export_jobs WHERE user_id = $1 AND organization_id IS NOT DISTINCT FROM $2::uuid
       AND idempotency_key = $3 ORDER BY created_at DESC LIMIT 1`,
      [input.userId, input.organizationId, input.idempotencyKey],
    );
    const row = result.rows[0];
    return row === undefined ? null : mapExportJobRow(row);
  }

  private async loadAuthorizedSnapshot(client: DatabaseClient, input: CreateExportJobInput): Promise<ExportPageSnapshot[]> {
    const result = await client.query<SnapshotRow>(
      `
      SELECT pages.id AS page_id, pages.page_number, pages.generated_image->>'s3_key' AS s3_key,
        CASE
          WHEN pages.generated_image->>'s3_key' LIKE '%.png' THEN 'image/png'
          WHEN pages.generated_image->>'s3_key' LIKE '%.jpg' OR pages.generated_image->>'s3_key' LIKE '%.jpeg' THEN 'image/jpeg'
          WHEN pages.generated_image->>'s3_key' LIKE '%.webp' THEN 'image/webp'
          ELSE ''
        END AS mime_type
      FROM pages
      INNER JOIN episodes ON episodes.id = pages.episode_id
      INNER JOIN chapters ON chapters.id = episodes.chapter_id
      INNER JOIN works ON works.id = chapters.work_id
      WHERE pages.id = ANY($1::uuid[]) AND pages.episode_id = $2
        AND pages.generated_image IS NOT NULL AND pages.generated_image->>'s3_key' IS NOT NULL
        AND (
          ($3::uuid IS NULL AND works.user_id = $4 AND works.organization_id IS NULL)
          OR ($3::uuid IS NOT NULL AND works.organization_id = $3::uuid AND EXISTS (
            SELECT 1 FROM organization_members
            WHERE organization_members.organization_id = works.organization_id
              AND organization_members.user_id = $4 AND organization_members.status = 'active'
          ))
        )
      ORDER BY array_position($1::uuid[], pages.id)
      `,
      [input.pageIds, input.episodeId, input.organizationId, input.userId],
    );
    return result.rows.map((row) => {
      if (row.s3_key.length === 0 || row.mime_type.length === 0) {
        throw new ValidationError('Export pages require supported generated images');
      }
      assertExportImageMimeType(row.mime_type);
      return { pageId: row.page_id, pageNumber: row.page_number, s3Key: row.s3_key, mimeType: row.mime_type };
    });
  }
}

function mapExportJobRow(row: ExportJobRow): ExportJob {
  const snapshot = parseSnapshot(row.page_snapshot);
  const size = row.artifact_size_bytes === null ? null : Number(row.artifact_size_bytes);
  return {
    id: row.id, userId: row.user_id, organizationId: row.organization_id, episodeId: row.episode_id,
    format: row.format, filename: row.filename, pageIds: row.page_ids, pageSnapshot: snapshot,
    requestFingerprint: row.request_fingerprint, status: row.status, progressStage: row.progress_stage,
    progressPercent: row.progress_percent, artifactS3Key: row.artifact_s3_key, artifactMimeType: row.artifact_mime_type,
    artifactSizeBytes: Number.isSafeInteger(size) ? size : null, errorCode: row.error_code, errorMessage: row.error_message,
    createdAt: row.created_at, startedAt: row.started_at, completedAt: row.completed_at, expiresAt: row.expires_at,
  };
}

function parseSnapshot(value: unknown): ExportPageSnapshot[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ValidationError('Export job snapshot is invalid');
  }
  return value.map((entry) => {
    if (typeof entry !== 'object' || entry === null) {
      throw new ValidationError('Export job snapshot is invalid');
    }
    const candidate = entry as Record<string, unknown>;
    if (typeof candidate.pageId !== 'string' || typeof candidate.pageNumber !== 'number' ||
      typeof candidate.s3Key !== 'string' || typeof candidate.mimeType !== 'string') {
      throw new ValidationError('Export job snapshot is invalid');
    }
    assertExportImageMimeType(candidate.mimeType);
    return { pageId: candidate.pageId, pageNumber: candidate.pageNumber, s3Key: candidate.s3Key, mimeType: candidate.mimeType };
  });
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

function assertIdempotencyRequestMatches(existing: ExportJob, input: CreateExportJobInput): void {
  if (existing.requestFingerprint !== input.requestFingerprint) {
    throw new ConflictError('Idempotency-Key is already used for a different export request');
  }
}
