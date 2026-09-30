import type { QueryResultRow } from 'pg';
import type { DatabaseClient } from '../lib/db.js';

export interface ProtectedImageS3KeyLookupInput {
  protectRecentCandidateHours: number;
}

export interface ImageStorageReferenceRepository {
  findProtectedImageS3Keys(input: ProtectedImageS3KeyLookupInput): Promise<Set<string>>;
}

interface ImageS3KeyRow extends QueryResultRow {
  s3_key: string | null;
}

/**
 * Reads only current/live image references from the database. Operational
 * pruning uses this as the safety list before touching temporary S3 objects.
 */
export class PostgresImageStorageReferenceRepository implements ImageStorageReferenceRepository {
  public constructor(private readonly client: DatabaseClient) {}

  public async findProtectedImageS3Keys(
    input: ProtectedImageS3KeyLookupInput,
  ): Promise<Set<string>> {
    const result = await this.client.query<ImageS3KeyRow>(
      `
      WITH live_page_images AS (
        SELECT generated_image->>'s3_key' AS s3_key
        FROM pages
        WHERE generated_image IS NOT NULL
      ),
      live_reference_images AS (
        SELECT reference_image->>'s3_key' AS s3_key
        FROM reference_sets
        CROSS JOIN LATERAL jsonb_array_elements(reference_images) AS reference_image
      ),
      live_entity_state_images AS (
        SELECT entity_states.reference_image->>'s3_key' AS s3_key
        FROM entity_states
        WHERE entity_states.reference_image IS NOT NULL
      ),
      page_snapshot_images AS (
        SELECT snapshot_reference->>'s3Key' AS s3_key
        FROM generation_jobs
        CROSS JOIN LATERAL jsonb_array_elements(
          COALESCE(result->'input_snapshot'->'references', '[]'::jsonb)
        ) AS snapshot_reference
        WHERE job_type = 'page_generate'
        UNION ALL
        SELECT snapshot_reference->>'s3Key' AS s3_key
        FROM generation_jobs
        CROSS JOIN LATERAL jsonb_array_elements(
          COALESCE(params->'input_snapshot'->'references', '[]'::jsonb)
        ) AS snapshot_reference
        WHERE job_type = 'page_generate'
      ),
      recent_entity_candidates AS (
        SELECT candidate->>'s3_key' AS s3_key
        FROM generation_jobs
        CROSS JOIN LATERAL jsonb_array_elements(COALESCE(result->'candidates', '[]'::jsonb)) AS candidate
        WHERE job_type = 'entity_generate'
          AND status = 'completed'
          AND completed_at >= NOW() - ($1::int * INTERVAL '1 hour')
      ),
      recent_entity_source_images AS (
        SELECT params->>'source_s3_key' AS s3_key
        FROM generation_jobs
        WHERE job_type = 'entity_generate'
          AND params ? 'source_s3_key'
          AND created_at >= NOW() - ($1::int * INTERVAL '1 hour')
      )
      SELECT DISTINCT s3_key
      FROM (
        SELECT s3_key FROM live_page_images
        UNION ALL
        SELECT s3_key FROM live_reference_images
        UNION ALL
        SELECT s3_key FROM live_entity_state_images
        UNION ALL
        SELECT s3_key FROM page_snapshot_images
        UNION ALL
        SELECT s3_key FROM recent_entity_candidates
        UNION ALL
        SELECT s3_key FROM recent_entity_source_images
      ) AS protected_keys
      WHERE s3_key IS NOT NULL
        AND s3_key <> ''
      `,
      [input.protectRecentCandidateHours],
    );

    return new Set(result.rows.flatMap((row) => (row.s3_key === null ? [] : [row.s3_key])));
  }
}
