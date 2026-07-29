import type { QueryResultRow } from 'pg';
import type { EntityReferenceUploadMimeType } from '../domain/constants/entityReferenceUpload.js';
import type {
  EntityReferenceUploadPurpose,
  EntityReferenceUploadToken,
} from '../domain/types/entityReferenceUpload.js';
import type { DatabaseClient } from '../lib/db.js';

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
  public constructor(private readonly client: DatabaseClient) {}

  public async create(input: CreateEntityReferenceUploadTokenInput): Promise<EntityReferenceUploadToken> {
    const result = await this.client.query<EntityReferenceUploadTokenRow>(
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

    return mapEntityReferenceUploadTokenRow(result.rows[0]);
  }

  public async inspect(input: ConsumeEntityReferenceUploadTokenInput): Promise<EntityReferenceUploadToken | null> {
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

  public async consume(input: ConsumeEntityReferenceUploadTokenInput): Promise<EntityReferenceUploadToken | null> {
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

function mapEntityReferenceUploadTokenRow(row: EntityReferenceUploadTokenRow): EntityReferenceUploadToken {
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
