import type { QueryResultRow } from 'pg';
import { ConflictError, ConfigurationError } from '../domain/errors/index.js';
import { computeStateReferenceFingerprint } from '../domain/state/StateReferenceFingerprint.js';
import type { EntityStatus, EntityType } from '../domain/types/entity.js';
import type {
  ConfirmedEntityStateReference,
  ConfirmEntityStateReferenceInput,
  EntityStateReferenceContextCandidate,
  EntityStateReferenceDescriptor,
} from '../domain/types/entityStateReference.js';
import type { DatabaseClient, TransactionRunner } from '../lib/db.js';

export interface EntityStateReferenceRepository {
  findContextByIdAndUserId(
    entityId: string,
    stateId: string,
    userId: string,
    organizationId?: string | null,
  ): Promise<EntityStateReferenceContextCandidate | null>;
  confirmReference(input: ConfirmEntityStateReferenceInput): Promise<ConfirmedEntityStateReference>;
}

interface StateContextRow extends QueryResultRow {
  entity_id: string;
  work_id: string;
  entity_owner_user_id: string;
  entity_type: string;
  entity_name: string;
  entity_free_description: string | null;
  entity_structured_fields: unknown;
  entity_prompt_supplement: string | null;
  entity_status: string;
  state_id: string;
  state_name: string | null;
  state_description: string | null;
  state_revision: Date | string;
  state_reference_image: unknown;
  base_ref_id: string | null;
  base_s3_key: string | null;
}

interface LockedReferenceSetRow extends QueryResultRow {
  primary_ref_id: string | null;
  base_s3_key: string | null;
}

interface LockedStateRow extends QueryResultRow {
  name: string | null;
  description: string | null;
  reference_image: unknown;
  state_revision: Date | string;
}

interface CandidateJobRow extends QueryResultRow {
  user_id: string;
  organization_id: string | null;
  status: string;
  params: unknown;
  result: unknown;
}

interface UpdatedStateRow extends QueryResultRow {
  state_revision: Date | string;
}

export class PostgresEntityStateReferenceRepository implements EntityStateReferenceRepository {
  public constructor(private readonly client: DatabaseClient & TransactionRunner) {}

  public async findContextByIdAndUserId(
    entityId: string,
    stateId: string,
    userId: string,
    organizationId: string | null = null,
  ): Promise<EntityStateReferenceContextCandidate | null> {
    const result = await this.client.query<StateContextRow>(
      `
      SELECT entities.id AS entity_id,
             entities.work_id,
             entities.user_id AS entity_owner_user_id,
             entities.entity_type,
             entities.name AS entity_name,
             entities.free_description AS entity_free_description,
             entities.structured_fields AS entity_structured_fields,
             entities.prompt_supplement AS entity_prompt_supplement,
             entities.status AS entity_status,
             entity_states.id AS state_id,
             entity_states.name AS state_name,
             entity_states.description AS state_description,
             COALESCE(entity_states.updated_at, entity_states.created_at) AS state_revision,
             entity_states.reference_image AS state_reference_image,
             reference_sets.primary_ref_id AS base_ref_id,
             primary_image.value->>'s3_key' AS base_s3_key
      FROM entity_states
      INNER JOIN entities ON entities.id = entity_states.entity_id
      INNER JOIN works ON works.id = entities.work_id
      LEFT JOIN reference_sets ON reference_sets.entity_id = entities.id
      LEFT JOIN LATERAL (
        SELECT value
        FROM jsonb_array_elements(
          CASE
            WHEN jsonb_typeof(reference_sets.reference_images) = 'array' THEN reference_sets.reference_images
            ELSE '[]'::jsonb
          END
        ) AS value
        WHERE value->>'ref_id' = reference_sets.primary_ref_id
        LIMIT 1
      ) AS primary_image ON TRUE
      WHERE entities.id = $1::uuid
        AND entity_states.id = $2::uuid
        AND (
          ($4::uuid IS NULL
            AND works.organization_id IS NULL
            AND entities.user_id = $3::uuid)
          OR (
            $4::uuid IS NOT NULL
            AND works.organization_id = $4::uuid
            AND EXISTS (
              SELECT 1
              FROM organization_members
              WHERE organization_members.organization_id = works.organization_id
                AND organization_members.user_id = $3::uuid
                AND organization_members.status = 'active'
            )
          )
        )
      `,
      [entityId, stateId, userId, organizationId],
    );

    const row = result.rows[0];
    return row === undefined ? null : mapStateContext(row);
  }

  public async confirmReference(
    input: ConfirmEntityStateReferenceInput,
  ): Promise<ConfirmedEntityStateReference> {
    return this.client.transaction(async (transactionClient) => {
      const referenceSet = await lockReferenceSet(transactionClient, input);
      const state = await lockEntityState(transactionClient, input);
      const job = await lockCandidateJob(transactionClient, input.jobId);

      assertConfirmCandidate(job, input);
      assertFreshStateAndBase(state, referenceSet, input);

      const currentDescriptor = parseStateReferenceDescriptor(state.reference_image);
      if (currentDescriptor !== null && descriptorsEqual(currentDescriptor, input.descriptor)) {
        return {
          entityId: input.entityId,
          stateId: input.stateId,
          stateRevision: toIsoString(state.state_revision),
          referenceImage: currentDescriptor,
        };
      }

      const currentRevision = toIsoString(state.state_revision);
      if (currentRevision !== input.expectedStateRevision) {
        throw new ConflictError('Entity state changed after the preview was generated');
      }

      const updateResult = await transactionClient.query<UpdatedStateRow>(
        `
        UPDATE entity_states
        SET reference_image = $3::jsonb,
            updated_at = GREATEST(
              date_trunc('milliseconds', clock_timestamp()),
              date_trunc('milliseconds', COALESCE(updated_at, created_at)) + INTERVAL '1 millisecond'
            )
        WHERE id = $1::uuid
          AND entity_id = $2::uuid
        RETURNING COALESCE(updated_at, created_at) AS state_revision
        `,
        [input.stateId, input.entityId, JSON.stringify(toPersistedDescriptor(input.descriptor))],
      );
      const updated = updateResult.rows[0];
      if (updated === undefined) {
        throw new ConflictError('Entity state reference could not be confirmed');
      }

      return {
        entityId: input.entityId,
        stateId: input.stateId,
        stateRevision: toIsoString(updated.state_revision),
        referenceImage: input.descriptor,
      };
    });
  }
}

async function lockReferenceSet(
  client: DatabaseClient,
  input: ConfirmEntityStateReferenceInput,
): Promise<LockedReferenceSetRow> {
  const result = await client.query<LockedReferenceSetRow>(
    `
    SELECT reference_sets.primary_ref_id,
           primary_image.value->>'s3_key' AS base_s3_key
    FROM reference_sets
    INNER JOIN entities ON entities.id = reference_sets.entity_id
    INNER JOIN works ON works.id = entities.work_id
    LEFT JOIN LATERAL (
      SELECT value
      FROM jsonb_array_elements(
        CASE
          WHEN jsonb_typeof(reference_sets.reference_images) = 'array' THEN reference_sets.reference_images
          ELSE '[]'::jsonb
        END
      ) AS value
      WHERE value->>'ref_id' = reference_sets.primary_ref_id
      LIMIT 1
    ) AS primary_image ON TRUE
    WHERE entities.id = $1::uuid
      AND (
        ($3::uuid IS NULL
          AND works.organization_id IS NULL
          AND entities.user_id = $2::uuid)
        OR (
          $3::uuid IS NOT NULL
          AND works.organization_id = $3::uuid
          AND EXISTS (
            SELECT 1
            FROM organization_members
            WHERE organization_members.organization_id = works.organization_id
              AND organization_members.user_id = $2::uuid
              AND organization_members.status = 'active'
          )
        )
      )
    FOR UPDATE OF reference_sets
    `,
    [input.entityId, input.userId, input.organizationId],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new ConflictError('Base entity reference is not available');
  }
  return row;
}

async function lockEntityState(
  client: DatabaseClient,
  input: ConfirmEntityStateReferenceInput,
): Promise<LockedStateRow> {
  const result = await client.query<LockedStateRow>(
    `
    SELECT entity_states.name,
           entity_states.description,
           entity_states.reference_image,
           COALESCE(entity_states.updated_at, entity_states.created_at) AS state_revision
    FROM entity_states
    INNER JOIN entities ON entities.id = entity_states.entity_id
    INNER JOIN works ON works.id = entities.work_id
    WHERE entity_states.id = $1::uuid
      AND entity_states.entity_id = $2::uuid
      AND (
        ($4::uuid IS NULL
          AND works.organization_id IS NULL
          AND entities.user_id = $3::uuid)
        OR (
          $4::uuid IS NOT NULL
          AND works.organization_id = $4::uuid
          AND EXISTS (
            SELECT 1
            FROM organization_members
            WHERE organization_members.organization_id = works.organization_id
              AND organization_members.user_id = $3::uuid
              AND organization_members.status = 'active'
          )
        )
      )
    FOR UPDATE OF entity_states
    `,
    [input.stateId, input.entityId, input.userId, input.organizationId],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new ConflictError('Entity state is no longer available');
  }
  return row;
}

async function lockCandidateJob(client: DatabaseClient, jobId: string): Promise<CandidateJobRow> {
  const result = await client.query<CandidateJobRow>(
    `
    SELECT user_id, organization_id, status, params, result
    FROM generation_jobs
    WHERE id = $1::uuid
      AND job_type = 'entity_generate'
    FOR SHARE
    `,
    [jobId],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new ConflictError('State reference preview job is not available');
  }
  return row;
}

function assertConfirmCandidate(
  job: CandidateJobRow,
  input: ConfirmEntityStateReferenceInput,
): void {
  const params = toRecord(job.params);
  const result = toRecord(job.result);
  const candidates = Array.isArray(result?.candidates) ? result.candidates : [];
  const candidateExists = candidates.some((candidate) => {
    const record = toRecord(candidate);
    return record?.s3_key === input.candidateS3Key
      && record.ref_id === input.descriptor.refId;
  });

  if (
    job.status !== 'completed'
    || job.user_id !== input.userId
    || job.organization_id !== input.organizationId
    || params?.target !== 'entity_state'
    || params.entity_id !== input.entityId
    || params.entity_state_id !== input.stateId
    || params.base_primary_ref_id !== input.descriptor.baseRefId
    || params.state_input_fingerprint !== input.descriptor.inputFingerprint
    || params.state_revision !== input.expectedStateRevision
    || params.image_model !== input.descriptor.imageModel
    || !candidateExists
  ) {
    throw new ConflictError('State reference preview is stale or does not match this state');
  }
}

function assertFreshStateAndBase(
  state: LockedStateRow,
  referenceSet: LockedReferenceSetRow,
  input: ConfirmEntityStateReferenceInput,
): void {
  if (
    state.name === null
    || state.description === null
    || referenceSet.primary_ref_id === null
    || referenceSet.base_s3_key === null
  ) {
    throw new ConflictError('State reference inputs are no longer available');
  }

  const fingerprint = computeStateReferenceFingerprint({
    entityId: input.entityId,
    stateId: input.stateId,
    name: state.name,
    description: state.description,
    baseRefId: referenceSet.primary_ref_id,
  });
  if (
    referenceSet.primary_ref_id !== input.descriptor.baseRefId
    || fingerprint !== input.descriptor.inputFingerprint
  ) {
    throw new ConflictError('Entity state or base reference changed after the preview was generated');
  }
}

function mapStateContext(row: StateContextRow): EntityStateReferenceContextCandidate {
  return {
    entityId: row.entity_id,
    workId: row.work_id,
    entityOwnerUserId: row.entity_owner_user_id,
    entityType: toEntityType(row.entity_type),
    entityName: row.entity_name,
    entityFreeDescription: row.entity_free_description,
    entityStructuredFields: toRecord(row.entity_structured_fields) ?? {},
    entityPromptSupplement: row.entity_prompt_supplement,
    entityStatus: toEntityStatus(row.entity_status),
    stateId: row.state_id,
    stateName: row.state_name,
    stateDescription: row.state_description,
    stateRevision: toIsoString(row.state_revision),
    baseReference: row.base_ref_id === null || row.base_s3_key === null
      ? null
      : {
          refId: row.base_ref_id,
          s3Key: row.base_s3_key,
          storageOwnerUserId: row.entity_owner_user_id,
        },
    referenceImage: parseStateReferenceDescriptor(row.state_reference_image),
  };
}

export function parseStateReferenceDescriptor(value: unknown): EntityStateReferenceDescriptor | null {
  const descriptor = toRecord(value);
  if (descriptor === null) {
    return null;
  }
  const values = [
    descriptor.ref_id,
    descriptor.s3_key,
    descriptor.storage_owner_user_id,
    descriptor.image_model,
    descriptor.base_ref_id,
    descriptor.created_at,
    descriptor.input_fingerprint,
  ];
  if (!values.every((entry) => typeof entry === 'string' && entry.length > 0)) {
    return null;
  }
  return {
    refId: descriptor.ref_id as string,
    s3Key: descriptor.s3_key as string,
    storageOwnerUserId: descriptor.storage_owner_user_id as string,
    imageModel: descriptor.image_model as string,
    baseRefId: descriptor.base_ref_id as string,
    createdAt: descriptor.created_at as string,
    inputFingerprint: descriptor.input_fingerprint as string,
  };
}

function toPersistedDescriptor(descriptor: EntityStateReferenceDescriptor): Record<string, string> {
  return {
    ref_id: descriptor.refId,
    s3_key: descriptor.s3Key,
    storage_owner_user_id: descriptor.storageOwnerUserId,
    image_model: descriptor.imageModel,
    base_ref_id: descriptor.baseRefId,
    created_at: descriptor.createdAt,
    input_fingerprint: descriptor.inputFingerprint,
  };
}

function descriptorsEqual(
  left: EntityStateReferenceDescriptor,
  right: EntityStateReferenceDescriptor,
): boolean {
  return left.refId === right.refId
    && left.s3Key === right.s3Key
    && left.storageOwnerUserId === right.storageOwnerUserId
    && left.imageModel === right.imageModel
    && left.baseRefId === right.baseRefId
    && left.createdAt === right.createdAt
    && left.inputFingerprint === right.inputFingerprint;
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function toEntityType(value: string): EntityType {
  if (value === 'character' || value === 'nonhuman' || value === 'object') {
    return value;
  }
  throw new ConfigurationError('Entity state reference entity type is invalid');
}

function toEntityStatus(value: string): EntityStatus {
  if (value === 'draft' || value === 'ready') {
    return value;
  }
  throw new ConfigurationError('Entity state reference entity status is invalid');
}

function toIsoString(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new ConfigurationError('Entity state reference revision is invalid');
  }
  return date.toISOString();
}
