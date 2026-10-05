import type { QueryResultRow } from 'pg';
import type { EntityReferenceUploadMimeType } from '../domain/constants/entityReferenceUpload.js';
import type {
  EntityReferenceUploadPurpose,
  EntityReferenceUploadToken,
} from '../domain/types/entityReferenceUpload.js';
import { ConfigurationError, ForbiddenError } from '../domain/errors/index.js';
import type { DatabaseClient, TransactionRunner } from '../lib/db.js';
import {
  CANONICAL_REPOSITORY_SCHEMA_PROFILE,
  type RepositorySchemaProfile,
} from './RepositorySchemaProfile.js';
import { assertLegacyPersonalWriteAllowed } from './LegacyAccountDeletionWriteFence.js';

export interface CreateEntityReferenceUploadTokenInput {
  tokenHash: string;
  userId: string;
  organizationId: string | null;
  entityId: string | null;
  purpose: EntityReferenceUploadPurpose;
  mimeType: EntityReferenceUploadMimeType;
  sizeBytes: number;
  s3Key: string;
  expiresAt: Date;
}

export interface ConsumeEntityReferenceUploadTokenInput {
  tokenHash: string;
  userId: string;
  organizationId: string | null;
  purpose: EntityReferenceUploadPurpose;
}

export interface EntityReferenceUploadTokenRepository {
  create(input: CreateEntityReferenceUploadTokenInput): Promise<EntityReferenceUploadToken>;
  inspect(input: ConsumeEntityReferenceUploadTokenInput): Promise<EntityReferenceUploadToken | null>;
  consume(input: ConsumeEntityReferenceUploadTokenInput): Promise<EntityReferenceUploadToken | null>;
}

interface EntityReferenceUploadTokenRow extends QueryResultRow {
  id: string;
  token_hash: string;
  user_id: string;
  organization_id: string | null;
  entity_id: string | null;
  purpose: EntityReferenceUploadPurpose;
  mime_type: EntityReferenceUploadMimeType;
  size_bytes: number;
  s3_key: string;
  expires_at: Date;
  consumed_at: Date | null;
  created_at: Date;
}

export class PostgresEntityReferenceUploadTokenRepository implements EntityReferenceUploadTokenRepository {
  public constructor(
    private readonly client: DatabaseClient & Partial<TransactionRunner>,
    private readonly schemaProfile: RepositorySchemaProfile = CANONICAL_REPOSITORY_SCHEMA_PROFILE,
  ) {}

  public async create(input: CreateEntityReferenceUploadTokenInput): Promise<EntityReferenceUploadToken> {
    if (this.schemaProfile !== 'legacy_2debe_v1') {
      return this.createWithAdmission(this.client, input);
    }
    if (typeof this.client.transaction !== 'function') {
      throw new ConfigurationError('Legacy entity reference upload token writes require transaction support');
    }
    return this.client.transaction(async (transactionClient) => {
      await assertLegacyEntityReferenceUploadAdmission(transactionClient, input);
      return this.createWithAdmission(transactionClient, input);
    });
  }

  private async createWithAdmission(
    client: DatabaseClient,
    input: CreateEntityReferenceUploadTokenInput,
  ): Promise<EntityReferenceUploadToken> {
    const result = await client.query<EntityReferenceUploadTokenRow>(
      `
      INSERT INTO entity_reference_upload_tokens (
        token_hash,
        user_id,
        organization_id,
        entity_id,
        purpose,
        mime_type,
        size_bytes,
        s3_key,
        expires_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
      `,
      [
        input.tokenHash,
        input.userId,
        input.organizationId,
        input.entityId,
        input.purpose,
        input.mimeType,
        input.sizeBytes,
        input.s3Key,
        input.expiresAt,
      ],
    );

    return mapEntityReferenceUploadTokenRow(requireTokenRow(result.rows[0]));
  }

  public async inspect(
    input: ConsumeEntityReferenceUploadTokenInput,
  ): Promise<EntityReferenceUploadToken | null> {
    const result = await this.client.query<EntityReferenceUploadTokenRow>(
      `
      SELECT *
      FROM entity_reference_upload_tokens
      WHERE token_hash = $1
        AND user_id = $2
        AND organization_id IS NOT DISTINCT FROM $3::uuid
        AND purpose = $4
        AND consumed_at IS NULL
        AND expires_at > NOW()
      `,
      [input.tokenHash, input.userId, input.organizationId, input.purpose],
    );

    const row = result.rows[0];
    return row === undefined ? null : mapEntityReferenceUploadTokenRow(row);
  }

  public async consume(
    input: ConsumeEntityReferenceUploadTokenInput,
  ): Promise<EntityReferenceUploadToken | null> {
    const result = await this.client.query<EntityReferenceUploadTokenRow>(
      `
      UPDATE entity_reference_upload_tokens
      SET consumed_at = NOW()
      WHERE token_hash = $1
        AND user_id = $2
        AND organization_id IS NOT DISTINCT FROM $3::uuid
        AND purpose = $4
        AND consumed_at IS NULL
        AND expires_at > NOW()
      RETURNING *
      `,
      [input.tokenHash, input.userId, input.organizationId, input.purpose],
    );

    const row = result.rows[0];
    return row === undefined ? null : mapEntityReferenceUploadTokenRow(row);
  }
}

async function assertLegacyEntityReferenceUploadAdmission(
  client: DatabaseClient,
  input: CreateEntityReferenceUploadTokenInput,
): Promise<void> {
  await assertLegacyPersonalWriteAllowed(client, {
    userId: input.userId,
    organizationId: null,
  });
  if (input.organizationId !== null) {
    await assertLegacyOrganizationUploadAdmission(client, input.organizationId, input.userId);
  }
  if (input.entityId !== null) {
    const preliminaryEntity = await client.query<{ work_id: string }>(
      'SELECT work_id FROM entities WHERE id = $1::uuid',
      [input.entityId],
    );
    const workId = preliminaryEntity.rows[0]?.work_id;
    if (workId === undefined) {
      throw new ForbiddenError('Entity reference upload is no longer authorized');
    }
    const work = await client.query<{ id: string }>(
      `
      SELECT id
      FROM works
      WHERE id = $1::uuid
        AND (
          ($3::uuid IS NULL AND organization_id IS NULL AND user_id = $2::uuid)
          OR ($3::uuid IS NOT NULL AND organization_id = $3::uuid)
        )
      FOR SHARE
      `,
      [workId, input.userId, input.organizationId],
    );
    if (work.rows[0] === undefined) {
      throw new ForbiddenError('Entity reference upload is no longer authorized');
    }
    const entity = await client.query<{ id: string }>(
      `
      SELECT entities.id
      FROM entities
      WHERE entities.id = $1::uuid
        AND entities.work_id = $2::uuid
        AND ($3::uuid IS NOT NULL OR entities.user_id = $4::uuid)
      FOR SHARE
      `,
      [input.entityId, workId, input.organizationId, input.userId],
    );
    if (entity.rows[0] === undefined) {
      throw new ForbiddenError('Entity reference upload is no longer authorized');
    }
  }
}

async function assertLegacyOrganizationUploadAdmission(
  client: DatabaseClient,
  organizationId: string,
  userId: string,
): Promise<void> {
  const organization = await client.query<{ status: string }>(
    'SELECT status FROM organizations WHERE id = $1::uuid FOR SHARE',
    [organizationId],
  );
  if (!['active', 'trialing'].includes(organization.rows[0]?.status ?? '')) {
    throw new ForbiddenError('Entity reference upload is no longer authorized');
  }
  const membership = await client.query<{ role: string }>(
    `
    SELECT role
    FROM organization_members
    WHERE organization_id = $1::uuid
      AND user_id = $2::uuid
      AND status = 'active'
    FOR SHARE
    `,
    [organizationId, userId],
  );
  const role = membership.rows[0]?.role;
  if (role !== 'owner' && role !== 'admin' && role !== 'editor') {
    throw new ForbiddenError('Entity reference upload is no longer authorized');
  }
}

function requireTokenRow(row: EntityReferenceUploadTokenRow | undefined): EntityReferenceUploadTokenRow {
  if (row === undefined) {
    throw new Error('Entity reference upload token was not persisted');
  }
  return row;
}

function mapEntityReferenceUploadTokenRow(
  row: EntityReferenceUploadTokenRow,
): EntityReferenceUploadToken {
  return {
    id: row.id,
    tokenHash: row.token_hash,
    userId: row.user_id,
    organizationId: row.organization_id,
    entityId: row.entity_id,
    purpose: row.purpose,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    s3Key: row.s3_key,
    expiresAt: row.expires_at,
    consumedAt: row.consumed_at,
    createdAt: row.created_at,
  };
}
