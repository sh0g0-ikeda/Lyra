import { ConflictError } from '../domain/errors/index.js';

export type StateReferenceCopyAttemptState = 'unresolved' | 'succeeded' | 'not_dispatched';
export interface StateReferenceCopyAttempt {
  s3_key: string;
  entity_id: string;
  state_id: string;
  ref_id: string;
  attempt_id: string;
  state: StateReferenceCopyAttemptState;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/** Unknown history is never positive evidence that an external write settled. */
export function readStateReferenceCopyHistory(
  value: unknown,
  scope: { userId: string; entityId: string; stateId: string },
): StateReferenceCopyAttempt[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new ConflictError('State reference copy history requires reconciliation');
  const ids = new Set<string>();
  return value.map((entry: unknown) => {
    const row = typeof entry === 'object' && entry !== null && !Array.isArray(entry)
      ? entry as Record<string, unknown> : null;
    if (row === null || typeof row.attempt_id !== 'string' || !UUID.test(row.attempt_id)
      || ids.has(row.attempt_id)
      || !UUID.test(scope.userId) || !UUID.test(scope.entityId) || !UUID.test(scope.stateId)
      || row.entity_id !== scope.entityId || row.state_id !== scope.stateId
      || typeof row.ref_id !== 'string' || !/^[A-Za-z0-9_-]+$/u.test(row.ref_id)
      || typeof row.s3_key !== 'string'
      || !['png', 'jpeg', 'webp'].some((extension) => row.s3_key
        === `saved/${scope.userId}/entities/${scope.entityId}/states/${scope.stateId}/${row.ref_id}.${extension}`)
      || typeof row.state !== 'string'
      || !['unresolved', 'succeeded', 'not_dispatched'].includes(row.state)) {
      throw new ConflictError('State reference copy history requires reconciliation');
    }
    ids.add(row.attempt_id);
    return row as unknown as StateReferenceCopyAttempt;
  });
}

/** Correlated predicate for generation_jobs; absence/null/empty history is safe.
 * Legacy, malformed or unresolved entries fail closed, without a time limit.
 * Keep this in sync with readStateReferenceCopyHistory and deployment checks.
 */
export const UNRESOLVED_STATE_REFERENCE_COPY_SQL = `
  CASE
    WHEN generation_jobs.result->'state_reference_copies' IS NULL
      OR generation_jobs.result->'state_reference_copies' = 'null'::jsonb THEN FALSE
    WHEN jsonb_typeof(generation_jobs.result->'state_reference_copies') <> 'array' THEN TRUE
    ELSE EXISTS (
      SELECT 1
      FROM jsonb_array_elements(generation_jobs.result->'state_reference_copies') AS copy_attempt
      WHERE generation_jobs.job_type <> 'entity_generate'
        OR generation_jobs.params->>'target' IS DISTINCT FROM 'entity_state'
        OR jsonb_typeof(copy_attempt) IS DISTINCT FROM 'object'
        OR jsonb_typeof(copy_attempt->'attempt_id') IS DISTINCT FROM 'string'
        OR COALESCE(copy_attempt->>'attempt_id', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        OR COALESCE(copy_attempt->>'state', '') NOT IN ('succeeded', 'not_dispatched')
        OR jsonb_typeof(copy_attempt->'state') IS DISTINCT FROM 'string'
        OR jsonb_typeof(copy_attempt->'entity_id') IS DISTINCT FROM 'string'
        OR jsonb_typeof(copy_attempt->'state_id') IS DISTINCT FROM 'string'
        OR copy_attempt->>'entity_id' IS DISTINCT FROM generation_jobs.params->>'entity_id'
        OR copy_attempt->>'state_id' IS DISTINCT FROM generation_jobs.params->>'entity_state_id'
        OR COALESCE(copy_attempt->>'entity_id', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        OR COALESCE(copy_attempt->>'state_id', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        OR jsonb_typeof(copy_attempt->'ref_id') IS DISTINCT FROM 'string'
        OR COALESCE(copy_attempt->>'ref_id', '') !~ '^[A-Za-z0-9_-]+$'
        OR jsonb_typeof(copy_attempt->'s3_key') IS DISTINCT FROM 'string'
        OR NOT EXISTS (
          SELECT 1 FROM unnest(ARRAY['png', 'jpeg', 'webp']) AS extension
          WHERE copy_attempt->>'s3_key' = 'saved/' || generation_jobs.user_id::text
            || '/entities/' || (copy_attempt->>'entity_id') || '/states/'
            || (copy_attempt->>'state_id') || '/' || (copy_attempt->>'ref_id') || '.' || extension
        )
        OR (SELECT COUNT(*) FROM jsonb_array_elements(generation_jobs.result->'state_reference_copies') AS other_attempt
            WHERE other_attempt->>'attempt_id' = copy_attempt->>'attempt_id') <> 1
    )
  END
`;
