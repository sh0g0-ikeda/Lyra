import type { DatabaseClient } from '../lib/db.js';

/** Only trusted SQL expressions belong here, never request text. A v2-looking
 * path is not authority: readable references require the immutable admission,
 * exact descriptor/scope and a complete confirmed image receipt. Legacy paths
 * deliberately keep their existing validation and read behavior.
 */
export interface StateReferenceReadScopeSql {
  descriptor: string;
  entityId: string;
  stateId: string;
  organizationId: string;
}

export function confirmedFencedStateReferenceAttemptSql(alias: string): string {
  const a = alias;
  const extension = `(CASE ${a}.mime_type WHEN 'image/png' THEN 'png' WHEN 'image/jpeg' THEN 'jpeg' WHEN 'image/webp' THEN 'webp' END)`;
  // UUIDs and the fixed extension have no JSON escaping ambiguity. This is the
  // exact compact versioned tuple serialized by buildFencedStateReferenceKey.
  const tuple = `('["state-reference-fenced-v2","' || ${a}.owner_user_id::text || '","' || ${a}.entity_id::text || '","' || ${a}.attempt_token::text || '","' || ${extension} || '"]')`;
  return `COALESCE(
    ${a}.state = 'confirmed' AND ${a}.protocol = 'state-reference-fenced-v2'
    AND ${a}.scrubbed_at IS NULL AND ${a}.dispatch_started_at IS NOT NULL
    AND ${a}.marker_receipt IS NULL AND ${a}.fencing_reason IS NULL AND ${a}.history_erased_at IS NULL
    AND ${a}.deletion_processing_token IS NULL
    AND ${a}.actor_user_id = ${a}.owner_user_id
    AND ${a}.owner_user_id IS NOT NULL AND ${a}.entity_id IS NOT NULL
    AND ${a}.state_id IS NOT NULL AND ${a}.job_id IS NOT NULL
    AND char_length(${a}.candidate_ref_id) BETWEEN 1 AND 200
    AND char_length(${a}.candidate_s3_key) BETWEEN 1 AND 1024
    AND char_length(${a}.expected_state_revision) BETWEEN 1 AND 64
    AND ${a}.digest ~ '^[0-9a-f]{64}$' AND ${a}.size_bytes BETWEEN 1 AND 5242880
    AND lyra_valid_state_copy_v2_storage_revision(${a}.source_revision)
    AND ${a}.s3_key = 'state-reference-v2/' || ${a}.attempt_token::text || '/'
      || encode(sha256(convert_to(${tuple}, 'UTF8')), 'hex') || '.' || ${extension}
    AND jsonb_typeof(${a}.descriptor) = 'object'
    AND (SELECT bool_and(jsonb_typeof(${a}.descriptor->required_key) = 'string'
      AND NULLIF(BTRIM(${a}.descriptor->>required_key), '') IS NOT NULL)
      FROM unnest(ARRAY['ref_id','s3_key','storage_owner_user_id','image_model','base_ref_id','created_at','input_fingerprint']) AS required_key)
    AND ${a}.descriptor->>'s3_key' = ${a}.s3_key
    AND ${a}.descriptor->>'ref_id' = ${a}.candidate_ref_id
    AND ${a}.descriptor->>'storage_owner_user_id' = ${a}.owner_user_id::text
    AND jsonb_typeof(${a}.image_receipt) = 'object'
    AND ${a}.image_receipt @> jsonb_build_object('kind','image','protocol',${a}.protocol,
      'attemptToken',${a}.attempt_token::text,'s3Key',${a}.s3_key,'digest',${a}.digest,
      'mimeType',${a}.mime_type,'sizeBytes',${a}.size_bytes)
    AND lyra_valid_state_copy_v2_storage_revision(${a}.image_receipt - ARRAY[
      'kind','protocol','attemptToken','s3Key','digest','mimeType','sizeBytes'])
  , FALSE)`;
}

export function readableStateReferencePredicateSql(scope: StateReferenceReadScopeSql): string {
  const a = 'fenced_read_attempt';
  return `(COALESCE(${scope.descriptor}->>'s3_key', '') NOT LIKE 'state-reference-v2/%'
    OR EXISTS (SELECT 1 FROM state_reference_copy_attempts ${a}
      WHERE ${a}.s3_key = ${scope.descriptor}->>'s3_key'
        AND ${a}.descriptor = ${scope.descriptor}
        AND ${a}.entity_id = ${scope.entityId} AND ${a}.state_id = ${scope.stateId}
        AND ${a}.organization_id IS NOT DISTINCT FROM ${scope.organizationId}
        AND (${scope.organizationId} IS NOT NULL OR ${a}.owner_user_id =
          (SELECT fenced_owner.user_id FROM entities fenced_owner WHERE fenced_owner.id = ${scope.entityId}))
        AND ${confirmedFencedStateReferenceAttemptSql(a)}))`;
}

export function readableStateReferenceSql(scope: StateReferenceReadScopeSql): string {
  return `CASE WHEN ${readableStateReferencePredicateSql(scope)} THEN ${scope.descriptor} ELSE NULL END`;
}

export interface ConfirmedQuotedReference {
  ownerUserId: string;
  digest: string;
  mimeType: string;
  sizeBytes: number;
}

/** Accepted quotes retain historical inputs. Authorize the current entity/scope,
 * then find the exact immutable journal entry, without reading current drafts or
 * inferring a v2 owner from its pseudonymous path. An organization's asset does
 * not become unreadable when its original storage owner's account is deleted.
 */
export async function findConfirmedQuotedStateReference(
  database: DatabaseClient,
  input: { s3Key: string; entityId: string; actorUserId: string; organizationId: string | null;
    stateId?: string | null; refId?: string; imageModel?: string | null },
): Promise<ConfirmedQuotedReference | null> {
  const result = await database.query<{ owner_user_id: string; digest: string; mime_type: string; size_bytes: number }>(`
    SELECT attempt.owner_user_id, attempt.digest, attempt.mime_type, attempt.size_bytes
    FROM state_reference_copy_attempts attempt
    INNER JOIN entities ON entities.id = attempt.entity_id
    INNER JOIN works ON works.id = entities.work_id
    WHERE attempt.s3_key = $1 AND attempt.entity_id = $2::uuid
      AND attempt.organization_id IS NOT DISTINCT FROM $4::uuid
      AND works.organization_id IS NOT DISTINCT FROM $4::uuid
      AND (($4::uuid IS NULL AND entities.user_id = $3::uuid AND attempt.owner_user_id = $3::uuid)
        OR ($4::uuid IS NOT NULL AND EXISTS (
          SELECT 1 FROM organization_members member
          WHERE member.organization_id = $4::uuid AND member.user_id = $3::uuid AND member.status = 'active')))
      AND ($5::boolean = FALSE OR attempt.state_id::text IS NOT DISTINCT FROM $6::text)
      AND ($7::text IS NULL OR attempt.descriptor->>'ref_id' = $7)
      AND ($8::boolean = FALSE OR attempt.descriptor->>'image_model' IS NOT DISTINCT FROM $9::text)
      AND ${confirmedFencedStateReferenceAttemptSql('attempt')}
  `, [input.s3Key, input.entityId, input.actorUserId, input.organizationId,
    input.stateId !== undefined, input.stateId ?? null, input.refId ?? null,
    input.imageModel !== undefined, input.imageModel ?? null]);
  const row = result.rows[0];
  return row === undefined ? null : { ownerUserId: row.owner_user_id, digest: row.digest,
    mimeType: row.mime_type, sizeBytes: row.size_bytes };
}
