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
        CROSS JOIN LATERAL jsonb_array_elements(
          CASE
            WHEN jsonb_typeof(reference_images) = 'array' THEN reference_images
            ELSE '[]'::jsonb
          END
        ) AS reference_image
      ),
      live_entity_state_reference_images AS (
        SELECT entity_states.reference_image->>'s3_key' AS s3_key
        FROM entity_states
        WHERE jsonb_typeof(entity_states.reference_image) = 'object'
      ),
      recent_entity_candidates AS (
        SELECT candidate->>'s3_key' AS s3_key
        FROM generation_jobs
        CROSS JOIN LATERAL jsonb_array_elements(
          CASE
            WHEN jsonb_typeof(generation_jobs.result->'candidates') = 'array'
              THEN generation_jobs.result->'candidates'
            ELSE '[]'::jsonb
          END
        ) AS candidate
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
      ),
      retained_state_reference_copies AS (
        -- Intents survive copy/commit failures and replacements. Do not age them
        -- out while their job remains: account deletion owns exact-key cleanup.
        SELECT copy_intent->>'s3_key' AS s3_key
        FROM generation_jobs
        CROSS JOIN LATERAL jsonb_array_elements(
          CASE WHEN jsonb_typeof(result->'state_reference_copies') = 'array'
            THEN result->'state_reference_copies' ELSE '[]'::jsonb END
        ) AS copy_intent
        WHERE job_type = 'entity_generate'
          AND params->>'target' = 'entity_state'
      ),
      quoted_import_images AS (
        SELECT params->>'source_s3_key' AS s3_key FROM generation_jobs
        WHERE job_type = 'entity_import_analysis'
        UNION ALL
        SELECT result->>'import_copy_intent' AS s3_key FROM generation_jobs
        WHERE job_type = 'entity_import_analysis'
      ),
      retained_input_snapshot_reference_images AS (
        SELECT reference_image->>'s3Key' AS s3_key
        FROM generation_jobs
        CROSS JOIN LATERAL jsonb_array_elements(
          CASE
            WHEN jsonb_typeof(generation_jobs.result->'input_snapshot'->'references') = 'array'
              THEN generation_jobs.result->'input_snapshot'->'references'
            ELSE '[]'::jsonb
          END
          || CASE WHEN jsonb_typeof(generation_jobs.result->'retained_input_references') = 'array'
            THEN generation_jobs.result->'retained_input_references' ELSE '[]'::jsonb END
        ) AS reference_image
      )
      SELECT DISTINCT s3_key
      FROM (
        SELECT s3_key FROM live_page_images
        UNION ALL
        SELECT s3_key FROM live_reference_images
        UNION ALL
        SELECT s3_key FROM live_entity_state_reference_images
        UNION ALL
        SELECT s3_key FROM recent_entity_candidates
        UNION ALL
        SELECT s3_key FROM recent_entity_source_images
        UNION ALL
        SELECT s3_key FROM retained_input_snapshot_reference_images
        UNION ALL
        SELECT s3_key FROM retained_state_reference_copies
        UNION ALL
        SELECT s3_key FROM quoted_import_images
      ) AS protected_keys
      WHERE s3_key IS NOT NULL
        AND s3_key <> ''
      `,
      [input.protectRecentCandidateHours],
    );

    return new Set(result.rows.flatMap((row) => (row.s3_key === null ? [] : [row.s3_key])));
  }
}
