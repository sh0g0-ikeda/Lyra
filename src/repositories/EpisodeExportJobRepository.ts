import type { QueryResultRow } from 'pg';
import {
  EPISODE_EXPORT_FORMATS,
  EPISODE_EXPORT_JOB_STATUSES,
  EPISODE_EXPORT_MAX_ARTIFACT_BYTES,
  EPISODE_EXPORT_MAX_PAGE_COUNT,
  inferEpisodeExportImageMimeType,
  parseEpisodeExportPageSnapshot,
  toPersistedEpisodeExportPageSnapshot,
  type EpisodeExportFormat,
  type EpisodeExportJob,
  type EpisodeExportJobStatus,
  type EpisodeExportPageSnapshot,
} from '../domain/episodeExportJob.js';
import {
  ConfigurationError,
  ConflictError,
  ValidationError,
} from '../domain/errors/index.js';
import type { DatabaseClient, TransactionRunner } from '../lib/db.js';

const MAX_PROCESSING_LEASE_SECONDS = 30 * 60;
const MAX_PROCESSING_ATTEMPTS = 100;
const MAX_PROGRESS_STAGE_LENGTH = 80;
const MAX_ERROR_CODE_LENGTH = 80;
const MAX_ERROR_MESSAGE_LENGTH = 512;
const MAX_DISPATCH_MESSAGE_ID_LENGTH = 128;
const MAX_CLEANUP_BATCH_SIZE = 1000;
const MAX_MINIMUM_REMAINING_SECONDS = 24 * 60 * 60;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/u;

export interface CreateEpisodeExportJobInput {
  userId: string;
  organizationId: string | null;
  episodeId: string;
  pageIds: string[];
  format: EpisodeExportFormat;
  filename: string;
  requestFingerprint: string;
  idempotencyKey: string;
  expiresAt: Date;
}

export interface CreateEpisodeExportJobResult {
  created: boolean;
  job: EpisodeExportJob;
}

export interface EpisodeExportJobScope {
  userId: string;
  organizationId: string | null;
  jobId: string;
}

export interface ClaimEpisodeExportJobInput {
  jobId: string;
  leaseToken: string;
  leaseDurationSeconds: number;
  maxAttempts: number;
}

export interface EpisodeExportLeaseInput {
  jobId: string;
  leaseToken: string;
}

export interface EpisodeExportHeartbeatInput extends EpisodeExportLeaseInput {
  leaseDurationSeconds: number;
}

export interface EpisodeExportProgressInput extends EpisodeExportLeaseInput {
  stage: string;
  percent: number;
}

export interface CompleteEpisodeExportJobInput extends EpisodeExportLeaseInput {
  artifactS3Key: string;
  artifactMimeType: 'application/pdf' | 'application/zip';
  artifactSizeBytes: number;
}

export interface FailEpisodeExportJobInput extends EpisodeExportLeaseInput {
  errorCode: string;
  errorMessage: string;
}

export interface FailUnclaimableEpisodeExportJobInput {
  jobId: string;
  maxAttempts: number;
  minimumRemainingSeconds: number;
  errorCode: string;
  errorMessage: string;
}

export interface EpisodeExportJobOutboxRecord {
  exportJobId: string;
  createdAt: Date;
  dispatchedAt: Date | null;
  sqsMessageId: string | null;
  dispatchAttempts: number;
  lastDispatchError: string | null;
}

export interface ExpiredEpisodeExportArtifact {
  jobId: string;
  artifactS3Key: string;
}

export interface EpisodeExportJobRepository {
  createOrGet(input: CreateEpisodeExportJobInput): Promise<CreateEpisodeExportJobResult>;
  findForScope(input: EpisodeExportJobScope): Promise<EpisodeExportJob | null>;
  findForWorker(jobId: string): Promise<EpisodeExportJob | null>;
  claim(input: ClaimEpisodeExportJobInput): Promise<EpisodeExportJob | null>;
  heartbeat(input: EpisodeExportHeartbeatInput): Promise<boolean>;
  updateProgress(input: EpisodeExportProgressInput): Promise<boolean>;
  releaseForRetry(input: EpisodeExportLeaseInput): Promise<boolean>;
  complete(input: CompleteEpisodeExportJobInput): Promise<boolean>;
  fail(input: FailEpisodeExportJobInput): Promise<boolean>;
  failUnclaimable(input: FailUnclaimableEpisodeExportJobInput): Promise<boolean>;
  findUndispatchedForJob(jobId: string): Promise<EpisodeExportJobOutboxRecord | null>;
  listUndispatched(limit: number): Promise<EpisodeExportJobOutboxRecord[]>;
  markDispatched(jobId: string, sqsMessageId: string): Promise<boolean>;
  markDispatchFailure(jobId: string, errorMessage: string): Promise<boolean>;
  listExpiredArtifacts(limit: number): Promise<ExpiredEpisodeExportArtifact[]>;
  markArtifactDeleted(jobId: string, artifactS3Key: string): Promise<boolean>;
}

interface EpisodeExportPageSnapshotRow extends QueryResultRow {
  page_id: string;
  page_number: number;
  s3_key: string;
}

interface EpisodeExportJobRow extends QueryResultRow {
  id: string;
  user_id: string;
  organization_id: string | null;
  episode_id: string;
  format: string;
  filename: string;
  page_ids: unknown;
  page_snapshot: unknown;
  request_fingerprint: string;
  idempotency_key: string;
  status: string;
  progress_stage: string;
  progress_percent: number;
  artifact_s3_key: string | null;
  artifact_mime_type: string | null;
  artifact_size_bytes: string | number | null;
  artifact_deleted_at: Date | null;
  error_code: string | null;
  error_message: string | null;
  created_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
  expires_at: Date;
  updated_at: Date;
  attempt_count: number;
  processing_lease_token: string | null;
  processing_lease_expires_at: Date | null;
  last_heartbeat_at: Date | null;
}

interface EpisodeExportJobOutboxRow extends QueryResultRow {
  export_job_id: string;
  created_at: Date;
  dispatched_at: Date | null;
  sqs_message_id: string | null;
  dispatch_attempts: number;
  last_dispatch_error: string | null;
}

interface ExpiredEpisodeExportArtifactRow extends QueryResultRow {
  job_id: string;
  artifact_s3_key: string;
}

interface UpdatedRow extends QueryResultRow {
  updated: boolean;
}

export class PostgresEpisodeExportJobRepository implements EpisodeExportJobRepository {
  public constructor(
    private readonly client: DatabaseClient,
    private readonly transactionRunner?: TransactionRunner,
  ) {}

  public async createOrGet(
    input: CreateEpisodeExportJobInput,
  ): Promise<CreateEpisodeExportJobResult> {
    const transactionRunner = this.requireTransactionRunner();
    assertCreateInput(input);

    return transactionRunner.transaction(async (client) => {
      const existing = await this.findByIdempotencyKey(client, input);
      if (existing !== null) {
        assertMatchingFingerprint(existing, input.requestFingerprint);
        return { created: false, job: existing };
      }

      const pageSnapshot = await this.lockPageSnapshot(client, input);
      const inserted = await client.query<EpisodeExportJobRow>(
        `
        INSERT INTO episode_export_jobs (
          user_id,
          organization_id,
          episode_id,
          format,
          filename,
          page_ids,
          page_snapshot,
          request_fingerprint,
          idempotency_key,
          expires_at
        )
        VALUES (
          $1::uuid,
          $2::uuid,
          $3::uuid,
          $4::text,
          $5::text,
          $6::uuid[],
          $7::jsonb,
          $8::text,
          $9::text,
          $10::timestamptz
        )
        ON CONFLICT DO NOTHING
        RETURNING *
        `,
        [
          input.userId,
          input.organizationId,
          input.episodeId,
          input.format,
          input.filename,
          input.pageIds,
          JSON.stringify(toPersistedEpisodeExportPageSnapshot(pageSnapshot)),
          input.requestFingerprint,
          input.idempotencyKey,
          input.expiresAt,
        ],
      );

      const insertedRow = inserted.rows[0];
      if (insertedRow !== undefined) {
        await client.query(
          `
          INSERT INTO episode_export_job_outbox (export_job_id)
          VALUES ($1::uuid)
          `,
          [insertedRow.id],
        );
        return { created: true, job: toEpisodeExportJob(insertedRow) };
      }

      const racedExisting = await this.findByIdempotencyKey(client, input);
      if (racedExisting !== null) {
        assertMatchingFingerprint(racedExisting, input.requestFingerprint);
        return { created: false, job: racedExisting };
      }

      throw new ConflictError('An equivalent episode export is already active');
    });
  }

  public async findForScope(
    input: EpisodeExportJobScope,
  ): Promise<EpisodeExportJob | null> {
    const result = await this.client.query<EpisodeExportJobRow>(
      `
      SELECT episode_export_jobs.*
      FROM episode_export_jobs
      WHERE episode_export_jobs.id = $1::uuid
        AND episode_export_jobs.user_id = $2::uuid
        AND (
          (
            $3::uuid IS NULL
            AND episode_export_jobs.organization_id IS NULL
          )
          OR (
            $3::uuid IS NOT NULL
            AND episode_export_jobs.organization_id = $3::uuid
            AND EXISTS (
              SELECT 1
              FROM organization_members
              WHERE organization_members.organization_id =
                    episode_export_jobs.organization_id
                AND organization_members.user_id = $2::uuid
                AND organization_members.status = 'active'
            )
          )
        )
      `,
      [input.jobId, input.userId, input.organizationId],
    );

    return result.rows[0] === undefined
      ? null
      : toEpisodeExportJob(result.rows[0]);
  }

  public async findForWorker(jobId: string): Promise<EpisodeExportJob | null> {
    const result = await this.client.query<EpisodeExportJobRow>(
      `
      SELECT episode_export_jobs.*
      FROM episode_export_jobs
      WHERE episode_export_jobs.id = $1::uuid
      `,
      [jobId],
    );
    return result.rows[0] === undefined
      ? null
      : toEpisodeExportJob(result.rows[0]);
  }

  public async claim(
    input: ClaimEpisodeExportJobInput,
  ): Promise<EpisodeExportJob | null> {
    assertLeaseDuration(input.leaseDurationSeconds);
    assertMaxAttempts(input.maxAttempts);
    const result = await this.client.query<EpisodeExportJobRow>(
      `
      WITH claimable AS (
        SELECT id
        FROM episode_export_jobs
        WHERE id = $1::uuid
          AND (
            status = 'queued'
            OR (
              status = 'processing'
              AND processing_lease_expires_at <= NOW()
            )
          )
          AND attempt_count < $4
          AND expires_at > NOW() + ($3::int * INTERVAL '1 second')
        FOR UPDATE SKIP LOCKED
      )
      UPDATE episode_export_jobs
      SET status = 'processing',
          progress_stage = 'loading_images',
          progress_percent = 1,
          started_at = COALESCE(episode_export_jobs.started_at, NOW()),
          completed_at = NULL,
          error_code = NULL,
          error_message = NULL,
          attempt_count = episode_export_jobs.attempt_count + 1,
          processing_lease_token = $2::uuid,
          last_heartbeat_at = NOW(),
          processing_lease_expires_at =
            NOW() + ($3::int * INTERVAL '1 second'),
          updated_at = NOW()
      FROM claimable
      WHERE episode_export_jobs.id = claimable.id
      RETURNING episode_export_jobs.*
      `,
      [
        input.jobId,
        input.leaseToken,
        input.leaseDurationSeconds,
        input.maxAttempts,
      ],
    );

    return result.rows[0] === undefined
      ? null
      : toEpisodeExportJob(result.rows[0]);
  }

  public async heartbeat(
    input: EpisodeExportHeartbeatInput,
  ): Promise<boolean> {
    assertLeaseDuration(input.leaseDurationSeconds);
    const result = await this.client.query<UpdatedRow>(
      `
      UPDATE episode_export_jobs
      SET last_heartbeat_at = NOW(),
          processing_lease_expires_at =
            NOW() + ($3::int * INTERVAL '1 second'),
          updated_at = NOW()
      WHERE id = $1::uuid
        AND processing_lease_token = $2::uuid
        AND status = 'processing'
        AND processing_lease_expires_at > NOW()
        AND expires_at > NOW() + ($3::int * INTERVAL '1 second')
      RETURNING TRUE AS updated
      `,
      [input.jobId, input.leaseToken, input.leaseDurationSeconds],
    );
    return (result.rowCount ?? 0) > 0;
  }

  public async updateProgress(
    input: EpisodeExportProgressInput,
  ): Promise<boolean> {
    assertProgress(input.stage, input.percent);
    const result = await this.client.query<UpdatedRow>(
      `
      UPDATE episode_export_jobs
      SET progress_stage = $3::text,
          progress_percent = $4::int,
          updated_at = NOW()
      WHERE id = $1::uuid
        AND processing_lease_token = $2::uuid
        AND status = 'processing'
        AND processing_lease_expires_at > NOW()
      RETURNING TRUE AS updated
      `,
      [input.jobId, input.leaseToken, input.stage, input.percent],
    );
    return (result.rowCount ?? 0) > 0;
  }

  public async releaseForRetry(
    input: EpisodeExportLeaseInput,
  ): Promise<boolean> {
    const result = await this.client.query<UpdatedRow>(
      `
      UPDATE episode_export_jobs
      SET status = 'queued',
          progress_stage = 'queued',
          progress_percent = 0,
          started_at = NULL,
          completed_at = NULL,
          error_code = NULL,
          error_message = NULL,
          processing_lease_token = NULL,
          processing_lease_expires_at = NULL,
          last_heartbeat_at = NULL,
          updated_at = NOW()
      WHERE id = $1::uuid
        AND processing_lease_token = $2::uuid
        AND status = 'processing'
        AND processing_lease_expires_at > NOW()
      RETURNING TRUE AS updated
      `,
      [input.jobId, input.leaseToken],
    );
    return (result.rowCount ?? 0) > 0;
  }

  public async complete(
    input: CompleteEpisodeExportJobInput,
  ): Promise<boolean> {
    assertArtifact(input);
    const result = await this.client.query<UpdatedRow>(
      `
      UPDATE episode_export_jobs
      SET status = 'completed',
          progress_stage = 'completed',
          progress_percent = 100,
          artifact_s3_key = $3::text,
          artifact_mime_type = $4::text,
          artifact_size_bytes = $5::bigint,
          completed_at = NOW(),
          processing_lease_token = NULL,
          processing_lease_expires_at = NULL,
          last_heartbeat_at = NULL,
          updated_at = NOW()
      WHERE id = $1::uuid
        AND processing_lease_token = $2::uuid
        AND status = 'processing'
        AND processing_lease_expires_at > NOW()
        AND expires_at > NOW()
      RETURNING TRUE AS updated
      `,
      [
        input.jobId,
        input.leaseToken,
        input.artifactS3Key,
        input.artifactMimeType,
        input.artifactSizeBytes,
      ],
    );
    return (result.rowCount ?? 0) > 0;
  }

  public async fail(input: FailEpisodeExportJobInput): Promise<boolean> {
    assertStableError(input.errorCode, input.errorMessage);
    const result = await this.client.query<UpdatedRow>(
      `
      UPDATE episode_export_jobs
      SET status = 'failed',
          progress_stage = 'failed',
          completed_at = NOW(),
          error_code = $3::text,
          error_message = $4::text,
          processing_lease_token = NULL,
          processing_lease_expires_at = NULL,
          last_heartbeat_at = NULL,
          updated_at = NOW()
      WHERE id = $1::uuid
        AND processing_lease_token = $2::uuid
        AND status = 'processing'
        AND processing_lease_expires_at > NOW()
      RETURNING TRUE AS updated
      `,
      [input.jobId, input.leaseToken, input.errorCode, input.errorMessage],
    );
    return (result.rowCount ?? 0) > 0;
  }

  public async failUnclaimable(
    input: FailUnclaimableEpisodeExportJobInput,
  ): Promise<boolean> {
    assertMaxAttempts(input.maxAttempts);
    assertBoundedInteger(
      input.minimumRemainingSeconds,
      1,
      MAX_MINIMUM_REMAINING_SECONDS,
      'Episode export minimum remaining time is invalid',
    );
    assertStableError(input.errorCode, input.errorMessage);
    const result = await this.client.query<UpdatedRow>(
      `
      UPDATE episode_export_jobs
      SET status = 'failed',
          progress_stage = 'failed',
          completed_at = NOW(),
          error_code = $4::text,
          error_message = $5::text,
          processing_lease_token = NULL,
          processing_lease_expires_at = NULL,
          last_heartbeat_at = NULL,
          updated_at = NOW()
      WHERE id = $1::uuid
        AND (
          (
            status = 'queued'
            AND (
              attempt_count >= $2::int
              OR expires_at <=
                NOW() + ($3::int * INTERVAL '1 second')
            )
          )
          OR (
            status = 'processing'
            AND processing_lease_expires_at <= NOW()
            AND (
              attempt_count >= $2::int
              OR expires_at <=
                NOW() + ($3::int * INTERVAL '1 second')
            )
          )
        )
      RETURNING TRUE AS updated
      `,
      [
        input.jobId,
        input.maxAttempts,
        input.minimumRemainingSeconds,
        input.errorCode,
        input.errorMessage,
      ],
    );
    return (result.rowCount ?? 0) > 0;
  }

  public async findUndispatchedForJob(
    jobId: string,
  ): Promise<EpisodeExportJobOutboxRecord | null> {
    const result = await this.client.query<EpisodeExportJobOutboxRow>(
      `
      SELECT episode_export_job_outbox.*
      FROM episode_export_job_outbox
      INNER JOIN episode_export_jobs
        ON episode_export_jobs.id =
           episode_export_job_outbox.export_job_id
      WHERE episode_export_job_outbox.export_job_id = $1::uuid
        AND episode_export_job_outbox.dispatched_at IS NULL
        AND episode_export_jobs.status = 'queued'
        AND episode_export_jobs.expires_at > NOW()
      `,
      [jobId],
    );
    return result.rows[0] === undefined
      ? null
      : toEpisodeExportJobOutboxRecord(result.rows[0]);
  }

  public async listUndispatched(
    limit: number,
  ): Promise<EpisodeExportJobOutboxRecord[]> {
    assertBoundedInteger(
      limit,
      1,
      100,
      'Episode export dispatch batch limit is invalid',
    );
    const result = await this.client.query<EpisodeExportJobOutboxRow>(
      `
      SELECT episode_export_job_outbox.*
      FROM episode_export_job_outbox
      INNER JOIN episode_export_jobs
        ON episode_export_jobs.id =
           episode_export_job_outbox.export_job_id
      WHERE episode_export_job_outbox.dispatched_at IS NULL
        AND episode_export_jobs.status = 'queued'
        AND episode_export_jobs.expires_at > NOW()
      ORDER BY episode_export_job_outbox.created_at ASC,
               episode_export_job_outbox.export_job_id ASC
      LIMIT $1::int
      `,
      [limit],
    );
    return result.rows.map(toEpisodeExportJobOutboxRecord);
  }

  public async markDispatched(
    jobId: string,
    sqsMessageId: string,
  ): Promise<boolean> {
    assertBoundedText(
      sqsMessageId,
      MAX_DISPATCH_MESSAGE_ID_LENGTH,
      'Episode export SQS message ID is invalid',
    );
    const result = await this.client.query<UpdatedRow>(
      `
      UPDATE episode_export_job_outbox
      SET dispatched_at = NOW(),
          sqs_message_id = $2::text,
          dispatch_attempts = dispatch_attempts + 1,
          last_dispatch_error = NULL
      WHERE export_job_id = $1::uuid
        AND dispatched_at IS NULL
      RETURNING TRUE AS updated
      `,
      [jobId, sqsMessageId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  public async markDispatchFailure(
    jobId: string,
    errorMessage: string,
  ): Promise<boolean> {
    assertBoundedText(
      errorMessage,
      MAX_ERROR_MESSAGE_LENGTH,
      'Episode export dispatch error is invalid',
    );
    const result = await this.client.query<UpdatedRow>(
      `
      UPDATE episode_export_job_outbox
      SET dispatch_attempts = dispatch_attempts + 1,
          last_dispatch_error = $2::text
      WHERE export_job_id = $1::uuid
        AND dispatched_at IS NULL
      RETURNING TRUE AS updated
      `,
      [jobId, errorMessage],
    );
    return (result.rowCount ?? 0) > 0;
  }

  public async listExpiredArtifacts(
    limit: number,
  ): Promise<ExpiredEpisodeExportArtifact[]> {
    assertBoundedInteger(
      limit,
      1,
      MAX_CLEANUP_BATCH_SIZE,
      'Episode export cleanup limit is invalid',
    );
    const result = await this.client.query<ExpiredEpisodeExportArtifactRow>(
      `
      SELECT id AS job_id,
             artifact_s3_key
      FROM episode_export_jobs
      WHERE status = 'completed'
        AND artifact_s3_key IS NOT NULL
        AND artifact_deleted_at IS NULL
        AND expires_at <= NOW()
      ORDER BY expires_at ASC, id ASC
      LIMIT $1::int
      `,
      [limit],
    );
    return result.rows.map((row) => ({
      jobId: row.job_id,
      artifactS3Key: row.artifact_s3_key,
    }));
  }

  public async markArtifactDeleted(
    jobId: string,
    artifactS3Key: string,
  ): Promise<boolean> {
    const result = await this.client.query<UpdatedRow>(
      `
      UPDATE episode_export_jobs
      SET artifact_deleted_at = NOW(),
          updated_at = NOW()
      WHERE id = $1::uuid
        AND artifact_s3_key = $2::text
        AND artifact_deleted_at IS NULL
        AND status = 'completed'
        AND expires_at <= NOW()
      RETURNING TRUE AS updated
      `,
      [jobId, artifactS3Key],
    );
    return (result.rowCount ?? 0) > 0;
  }

  private requireTransactionRunner(): TransactionRunner {
    if (this.transactionRunner === undefined) {
      throw new ConfigurationError(
        'Episode export creation requires transaction support',
      );
    }
    return this.transactionRunner;
  }

  private async findByIdempotencyKey(
    client: DatabaseClient,
    input: CreateEpisodeExportJobInput,
  ): Promise<EpisodeExportJob | null> {
    const result = await client.query<EpisodeExportJobRow>(
      `
      SELECT episode_export_jobs.*
      FROM episode_export_jobs
      WHERE episode_export_jobs.user_id = $1::uuid
        AND episode_export_jobs.idempotency_key = $3
        AND (
          (
            $2::uuid IS NULL
            AND episode_export_jobs.organization_id IS NULL
          )
          OR (
            $2::uuid IS NOT NULL
            AND episode_export_jobs.organization_id = $2::uuid
            AND EXISTS (
              SELECT 1
              FROM organization_members
              WHERE organization_members.organization_id =
                    episode_export_jobs.organization_id
                AND organization_members.user_id = $1::uuid
                AND organization_members.status = 'active'
            )
          )
        )
      `,
      [input.userId, input.organizationId, input.idempotencyKey],
    );
    return result.rows[0] === undefined
      ? null
      : toEpisodeExportJob(result.rows[0]);
  }

  private async lockPageSnapshot(
    client: DatabaseClient,
    input: CreateEpisodeExportJobInput,
  ): Promise<EpisodeExportPageSnapshot[]> {
    const result = await client.query<EpisodeExportPageSnapshotRow>(
      `
      SELECT pages.id AS page_id,
             pages.page_number,
             pages.generated_image ->> 's3_key' AS s3_key
      FROM pages
      INNER JOIN unnest($1::uuid[]) WITH ORDINALITY
        AS requested(page_id, requested_order)
        ON pages.id = requested.page_id
      INNER JOIN episodes ON episodes.id = pages.episode_id
      INNER JOIN chapters ON chapters.id = episodes.chapter_id
      INNER JOIN works ON works.id = chapters.work_id
      WHERE pages.episode_id = $2::uuid
        AND NULLIF(pages.generated_image ->> 's3_key', '') IS NOT NULL
        AND (
          (
            $3::uuid IS NULL
            AND works.user_id = $4::uuid
            AND works.organization_id IS NULL
          )
          OR (
            $3::uuid IS NOT NULL
            AND works.organization_id = $3::uuid
            AND EXISTS (
              SELECT 1
              FROM organization_members
              WHERE organization_members.organization_id =
                    works.organization_id
                AND organization_members.user_id = $4::uuid
                AND organization_members.status = 'active'
            )
          )
        )
      ORDER BY requested.requested_order ASC
      FOR SHARE OF pages
      `,
      [input.pageIds, input.episodeId, input.organizationId, input.userId],
    );

    if (result.rows.length !== input.pageIds.length) {
      throw new ValidationError(
        'One or more export pages are unavailable',
      );
    }

    return result.rows.map((row) => ({
      pageId: row.page_id,
      pageNumber: row.page_number,
      s3Key: row.s3_key,
      mimeType: inferEpisodeExportImageMimeType(row.s3_key),
    }));
  }
}

function assertCreateInput(input: CreateEpisodeExportJobInput): void {
  if (
    input.pageIds.length < 1
    || input.pageIds.length > EPISODE_EXPORT_MAX_PAGE_COUNT
    || new Set(input.pageIds).size !== input.pageIds.length
  ) {
    throw new ValidationError('Episode export pages are invalid');
  }
}

function assertMatchingFingerprint(
  existing: EpisodeExportJob,
  requestFingerprint: string,
): void {
  if (existing.requestFingerprint !== requestFingerprint) {
    throw new ConflictError(
      'Idempotency-Key is already used for a different export request',
    );
  }
}

function assertLeaseDuration(value: number): void {
  if (
    !Number.isSafeInteger(value)
    || value < 1
    || value > MAX_PROCESSING_LEASE_SECONDS
  ) {
    throw new ConfigurationError('Episode export lease duration is invalid');
  }
}

function assertMaxAttempts(value: number): void {
  if (
    !Number.isSafeInteger(value)
    || value < 1
    || value > MAX_PROCESSING_ATTEMPTS
  ) {
    throw new ConfigurationError('Episode export max attempts is invalid');
  }
}

function assertProgress(stage: string, percent: number): void {
  assertBoundedText(
    stage,
    MAX_PROGRESS_STAGE_LENGTH,
    'Episode export progress stage is invalid',
  );
  if (!Number.isSafeInteger(percent) || percent < 1 || percent > 99) {
    throw new ConfigurationError('Episode export progress percent is invalid');
  }
}

function assertArtifact(input: CompleteEpisodeExportJobInput): void {
  if (
    !Number.isSafeInteger(input.artifactSizeBytes)
    || input.artifactSizeBytes < 1
    || input.artifactSizeBytes > EPISODE_EXPORT_MAX_ARTIFACT_BYTES
  ) {
    throw new ConfigurationError('Episode export artifact size is invalid');
  }
  if (
    input.artifactMimeType !== 'application/pdf'
    && input.artifactMimeType !== 'application/zip'
  ) {
    throw new ConfigurationError('Episode export artifact MIME type is invalid');
  }
}

function assertStableError(errorCode: string, errorMessage: string): void {
  assertBoundedText(
    errorCode,
    MAX_ERROR_CODE_LENGTH,
    'Episode export error code is invalid',
  );
  assertBoundedText(
    errorMessage,
    MAX_ERROR_MESSAGE_LENGTH,
    'Episode export error message is invalid',
  );
}

function assertBoundedInteger(
  value: number,
  minimum: number,
  maximum: number,
  message: string,
): void {
  if (
    !Number.isSafeInteger(value)
    || value < minimum
    || value > maximum
  ) {
    throw new ConfigurationError(message);
  }
}

function assertBoundedText(
  value: string,
  maximumLength: number,
  message: string,
): void {
  if (
    value.length < 1
    || value.length > maximumLength
    || value.trim() !== value
    || CONTROL_CHARACTER_PATTERN.test(value)
  ) {
    throw new ConfigurationError(message);
  }
}

function toEpisodeExportJob(row: EpisodeExportJobRow): EpisodeExportJob {
  if (
    !isEpisodeExportFormat(row.format)
    || !isEpisodeExportJobStatus(row.status)
    || !Array.isArray(row.page_ids)
    || !row.page_ids.every((entry) => typeof entry === 'string')
  ) {
    throw new ConfigurationError('Episode export job row is invalid');
  }

  let pageSnapshot: EpisodeExportPageSnapshot[];
  try {
    pageSnapshot = parseEpisodeExportPageSnapshot(row.page_snapshot);
  } catch {
    throw new ConfigurationError('Episode export job row is invalid');
  }

  return {
    id: row.id,
    userId: row.user_id,
    organizationId: row.organization_id,
    episodeId: row.episode_id,
    format: row.format,
    filename: row.filename,
    pageIds: row.page_ids,
    pageSnapshot,
    requestFingerprint: row.request_fingerprint,
    idempotencyKey: row.idempotency_key,
    status: row.status,
    progressStage: row.progress_stage,
    progressPercent: row.progress_percent,
    artifactS3Key: row.artifact_s3_key,
    artifactMimeType: row.artifact_mime_type,
    artifactSizeBytes: toNullableSafeInteger(row.artifact_size_bytes),
    artifactDeletedAt: row.artifact_deleted_at,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    expiresAt: row.expires_at,
    updatedAt: row.updated_at,
    attemptCount: row.attempt_count,
    processingLeaseToken: row.processing_lease_token,
    processingLeaseExpiresAt: row.processing_lease_expires_at,
    lastHeartbeatAt: row.last_heartbeat_at,
  };
}

function toEpisodeExportJobOutboxRecord(
  row: EpisodeExportJobOutboxRow,
): EpisodeExportJobOutboxRecord {
  return {
    exportJobId: row.export_job_id,
    createdAt: row.created_at,
    dispatchedAt: row.dispatched_at,
    sqsMessageId: row.sqs_message_id,
    dispatchAttempts: row.dispatch_attempts,
    lastDispatchError: row.last_dispatch_error,
  };
}

function toNullableSafeInteger(
  value: string | number | null,
): number | null {
  if (value === null) {
    return null;
  }
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new ConfigurationError('Episode export artifact size is invalid');
  }
  return parsed;
}

function isEpisodeExportFormat(value: string): value is EpisodeExportFormat {
  return EPISODE_EXPORT_FORMATS.some((format) => format === value);
}

function isEpisodeExportJobStatus(value: string): value is EpisodeExportJobStatus {
  return EPISODE_EXPORT_JOB_STATUSES.some((status) => status === value);
}
