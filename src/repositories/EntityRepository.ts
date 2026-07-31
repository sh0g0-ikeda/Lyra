import type { QueryResultRow } from 'pg';
import type {
  CreateEntityInput,
  Entity,
  EntityStatus,
  EntityType,
  UpdateEntityInput,
} from '../domain/types/entity.js';
import type {
  EntityReferenceContext,
  EntityReferenceImage,
  EntityReferenceImageSource,
  EntityReferenceSet,
  EntityReferenceSetStatus,
} from '../domain/types/entityReference.js';
import { ConfigurationError } from '../domain/errors/index.js';
import type { EntityListCursor } from '../domain/pagination.js';
import type { DatabaseClient, TransactionRunner } from '../lib/db.js';

export type { CreateEntityInput, Entity, UpdateEntityInput };
export type { EntityListCursor } from '../domain/pagination.js';

export interface EntityPrimaryReferenceImage {
  entityId: string;
  ownerUserId?: string;
  refId: string;
  s3Key: string;
  cdnUrl: string;
}

export interface EntityRepository {
  create(input: CreateEntityInput): Promise<Entity>;
  findByIdAndUserId(id: string, userId: string, organizationId?: string | null): Promise<Entity | null>;
  findByWorkIdAndUserId(workId: string, userId: string, organizationId?: string | null): Promise<Entity[]>;
  countByIdsAndWorkIdAndUserId(
    entityIds: string[],
    workId: string,
    userId: string,
    organizationId?: string | null,
  ): Promise<number>;
  findPrimaryReferenceImagesByEntityIdsAndUserId(
    entityIds: string[],
    workId: string,
    userId: string,
    organizationId?: string | null,
  ): Promise<EntityPrimaryReferenceImage[]>;
  update(id: string, userId: string, input: UpdateEntityInput, organizationId?: string | null): Promise<Entity | null>;
  delete(id: string, userId: string, organizationId?: string | null): Promise<boolean>;
}

export interface EntityListPageRequest {
  limit: number;
  cursor: EntityListCursor | null;
}

export interface EntityListPage {
  entities: Entity[];
  nextCursor: EntityListCursor | null;
}

export interface EntityListPaginationRepository {
  findPageByWorkIdAndUserId(
    workId: string,
    userId: string,
    request: EntityListPageRequest,
    organizationId?: string | null,
  ): Promise<EntityListPage>;
}

export interface EntityReferenceReader {
  countByIdsAndWorkIdAndUserId(
    entityIds: string[],
    workId: string,
    userId: string,
    organizationId?: string | null,
  ): Promise<number>;
  countByIdsAndWorkId?(entityIds: string[], workId: string): Promise<number>;
}

export interface EntityReferenceRepository {
  findReferenceContextByIdAndUserId(
    entityId: string,
    userId: string,
    organizationId?: string | null,
  ): Promise<EntityReferenceContext | null>;
  saveConfirmedReferences(input: {
    entityId: string;
    userId: string;
    organizationId?: string | null;
    images: EntityReferenceImage[];
    primaryRefId: string;
    promptSupplement?: string | null;
  }): Promise<EntityReferenceSet | null>;
  deleteReferenceImage(input: {
    entityId: string;
    userId: string;
    organizationId?: string | null;
    refId: string;
  }): Promise<EntityReferenceSet | null>;
  countEntityStateUsageByReferenceId(
    entityId: string,
    userId: string,
    refId: string,
    organizationId?: string | null,
  ): Promise<number>;
}

interface EntityRow extends QueryResultRow {
  id: string;
  work_id: string;
  user_id: string;
  entity_type: EntityType;
  name: string;
  free_description: string | null;
  structured_fields: unknown;
  prompt_supplement: string | null;
  speech_profile: unknown;
  status: EntityStatus;
  created_at: Date;
  updated_at: Date;
}

interface EntityReferenceSetRow extends QueryResultRow {
  entity_id: string;
  owner_user_id?: string;
  reference_images: unknown;
  primary_ref_id: string | null;
  reference_set_status: EntityReferenceSetStatus;
  updated_at: Date;
}

/**
 * Owns entity persistence plus reference_set mutations so the confirm/delete
 * flow stays transactional and user-scoped.
 */
export class PostgresEntityRepository
  implements
    EntityRepository,
    EntityReferenceRepository,
    EntityListPaginationRepository
{
  public constructor(private readonly client: DatabaseClient & Partial<TransactionRunner>) {}

  public async create(input: CreateEntityInput): Promise<Entity> {
    const result = await this.client.query<EntityRow>(
      `
      WITH inserted_entity AS (
        INSERT INTO entities (
          work_id,
          user_id,
          entity_type,
          name,
          free_description,
          prompt_supplement,
          structured_fields,
          speech_profile,
          status
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, 'draft')
        RETURNING *
      ),
      inserted_reference_set AS (
        INSERT INTO reference_sets (entity_id, status)
        SELECT id, 'empty'
        FROM inserted_entity
      )
      SELECT *
      FROM inserted_entity
      `,
      [
        input.workId,
        input.userId,
        input.entityType,
        input.name,
        input.freeDescription,
        input.promptSupplement,
        JSON.stringify(input.structuredFields),
        JSON.stringify(input.speechProfile),
      ],
    );

    return mapEntityRow(result.rows[0]);
  }

  public async findByIdAndUserId(
    id: string,
    userId: string,
    organizationId: string | null = null,
  ): Promise<Entity | null> {
    const result = await this.client.query<EntityRow>(
      `
      SELECT entities.*
      FROM entities
      INNER JOIN works ON works.id = entities.work_id
      WHERE entities.id = $1
        AND (
          ($3::uuid IS NULL AND works.organization_id IS NULL AND entities.user_id = $2)
          OR (
            $3::uuid IS NOT NULL
            AND works.organization_id = $3::uuid
            AND EXISTS (
              SELECT 1
              FROM organization_members
              WHERE organization_members.organization_id = works.organization_id
                AND organization_members.user_id = $2
                AND organization_members.status = 'active'
            )
          )
        )
      `,
      [id, userId, organizationId],
    );

    return result.rows[0] === undefined ? null : mapEntityRow(result.rows[0]);
  }

  public async findByWorkIdAndUserId(
    workId: string,
    userId: string,
    organizationId: string | null = null,
  ): Promise<Entity[]> {
    const result = await this.client.query<EntityRow>(
      `
      SELECT entities.*
      FROM entities
      INNER JOIN works ON works.id = entities.work_id
      WHERE entities.work_id = $1
        AND (
          ($3::uuid IS NULL AND works.organization_id IS NULL AND entities.user_id = $2)
          OR (
            $3::uuid IS NOT NULL
            AND works.organization_id = $3::uuid
            AND EXISTS (
              SELECT 1
              FROM organization_members
              WHERE organization_members.organization_id = works.organization_id
                AND organization_members.user_id = $2
                AND organization_members.status = 'active'
            )
          )
        )
      ORDER BY entities.created_at DESC
      `,
      [workId, userId, organizationId],
    );

    return result.rows.map(mapEntityRow);
  }

  public async findPageByWorkIdAndUserId(
    workId: string,
    userId: string,
    request: EntityListPageRequest,
    organizationId: string | null = null,
  ): Promise<EntityListPage> {
    if (
      !Number.isSafeInteger(request.limit)
      || request.limit < 1
      || request.limit > 100
    ) {
      throw new ConfigurationError('Entity list page limit is invalid');
    }

    const result = await this.client.query<EntityRow>(
      `
      SELECT entities.*
      FROM entities
      INNER JOIN works ON works.id = entities.work_id
      WHERE entities.work_id = $1::uuid
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
        AND (
          $4::timestamptz IS NULL
          OR entities.created_at < $4::timestamptz
          OR (
            entities.created_at = $4::timestamptz
            AND entities.id < $5::uuid
          )
        )
      ORDER BY entities.created_at DESC, entities.id DESC
      LIMIT $6
      `,
      [
        workId,
        userId,
        organizationId,
        request.cursor?.createdAt ?? null,
        request.cursor?.id ?? null,
        request.limit + 1,
      ],
    );

    const rows = result.rows.slice(0, request.limit);
    const lastRow = rows.at(-1);
    return {
      entities: rows.map(mapEntityRow),
      nextCursor:
        result.rows.length > request.limit && lastRow !== undefined
          ? {
              createdAt: lastRow.created_at,
              id: lastRow.id,
            }
          : null,
    };
  }

  public async findReferenceContextByIdAndUserId(
    entityId: string,
    userId: string,
    organizationId: string | null = null,
  ): Promise<EntityReferenceContext | null> {
    const result = await this.client.query<EntityRow & EntityReferenceSetRow>(
      `
      SELECT entities.*,
             reference_sets.entity_id,
             reference_sets.reference_images,
             reference_sets.primary_ref_id,
             reference_sets.status AS reference_set_status,
             reference_sets.updated_at
      FROM entities
      INNER JOIN reference_sets ON reference_sets.entity_id = entities.id
      INNER JOIN works ON works.id = entities.work_id
      WHERE entities.id = $1
        AND (
          ($3::uuid IS NULL AND works.organization_id IS NULL AND entities.user_id = $2)
          OR (
            $3::uuid IS NOT NULL
            AND works.organization_id = $3::uuid
            AND EXISTS (
              SELECT 1
              FROM organization_members
              WHERE organization_members.organization_id = works.organization_id
                AND organization_members.user_id = $2
                AND organization_members.status = 'active'
            )
          )
        )
      `,
      [entityId, userId, organizationId],
    );

    const row = result.rows[0];
    return row === undefined ? null : mapEntityReferenceContextRow(row);
  }

  public async countByIdsAndWorkIdAndUserId(
    entityIds: string[],
    workId: string,
    userId: string,
    organizationId: string | null = null,
  ): Promise<number> {
    if (entityIds.length === 0) {
      return 0;
    }

    const result = await this.client.query<{ count: number }>(
      `
      SELECT COUNT(DISTINCT entities.id)::int AS count
      FROM entities
      INNER JOIN works ON works.id = entities.work_id
      WHERE entities.id = ANY($1::uuid[])
        AND entities.work_id = $2
        AND (
          ($4::uuid IS NULL AND works.organization_id IS NULL AND entities.user_id = $3)
          OR (
            $4::uuid IS NOT NULL
            AND works.organization_id = $4::uuid
            AND EXISTS (
              SELECT 1
              FROM organization_members
              WHERE organization_members.organization_id = works.organization_id
                AND organization_members.user_id = $3
                AND organization_members.status = 'active'
            )
          )
        )
      `,
      [entityIds, workId, userId, organizationId],
    );

    return result.rows[0]?.count ?? 0;
  }

  public async countByIdsAndWorkId(entityIds: string[], workId: string): Promise<number> {
    if (entityIds.length === 0) {
      return 0;
    }

    const result = await this.client.query<{ count: number }>(
      `
      SELECT COUNT(DISTINCT id)::int AS count
      FROM entities
      WHERE id = ANY($1::uuid[])
        AND work_id = $2
      `,
      [entityIds, workId],
    );

    return result.rows[0]?.count ?? 0;
  }

  public async findPrimaryReferenceImagesByEntityIdsAndUserId(
    entityIds: string[],
    workId: string,
    userId: string,
    organizationId: string | null = null,
  ): Promise<EntityPrimaryReferenceImage[]> {
    if (entityIds.length === 0) {
      return [];
    }

    const result = await this.client.query<EntityReferenceSetRow>(
      `
      SELECT entities.id AS entity_id,
             entities.user_id AS owner_user_id,
             reference_sets.reference_images,
             reference_sets.primary_ref_id,
             reference_sets.status AS reference_set_status,
             reference_sets.updated_at
      FROM entities
      INNER JOIN reference_sets ON reference_sets.entity_id = entities.id
      INNER JOIN works ON works.id = entities.work_id
      WHERE entities.id = ANY($1::uuid[])
        AND entities.work_id = $2
        AND (
          ($4::uuid IS NULL AND works.organization_id IS NULL AND entities.user_id = $3)
          OR (
            $4::uuid IS NOT NULL
            AND works.organization_id = $4::uuid
            AND EXISTS (
              SELECT 1
              FROM organization_members
              WHERE organization_members.organization_id = works.organization_id
                AND organization_members.user_id = $3
                AND organization_members.status = 'active'
            )
          )
        )
      `,
      [entityIds, workId, userId, organizationId],
    );

    return result.rows.flatMap((row) => {
      if (row.primary_ref_id === null) {
        return [];
      }

      const primaryReference = parseReferenceImages(row.reference_images).find(
        (image) => image.refId === row.primary_ref_id,
      );
      if (primaryReference === undefined) {
        return [];
      }

      return [
        {
          entityId: row.entity_id,
          ownerUserId: row.owner_user_id ?? userId,
          refId: row.primary_ref_id,
          s3Key: primaryReference.s3Key,
          cdnUrl: primaryReference.cdnUrl,
        },
      ];
    });
  }

  public async saveConfirmedReferences(input: {
    entityId: string;
    userId: string;
    organizationId?: string | null;
    images: EntityReferenceImage[];
    primaryRefId: string;
    promptSupplement?: string | null;
  }): Promise<EntityReferenceSet | null> {
    const runner = this.client.transaction?.bind(this.client);
    if (runner === undefined) {
      throw new Error('EntityRepository requires transaction support to save references');
    }

    return runner(async (transactionClient) => {
      const current = await transactionClient.query<EntityReferenceSetRow>(
        `
        SELECT reference_sets.entity_id,
               reference_sets.reference_images,
               reference_sets.primary_ref_id,
               reference_sets.status AS reference_set_status,
               reference_sets.updated_at
        FROM reference_sets
        INNER JOIN entities ON entities.id = reference_sets.entity_id
        INNER JOIN works ON works.id = entities.work_id
        WHERE reference_sets.entity_id = $1
          AND (
            ($3::uuid IS NULL AND works.organization_id IS NULL AND entities.user_id = $2)
            OR (
              $3::uuid IS NOT NULL
              AND works.organization_id = $3::uuid
              AND EXISTS (
                SELECT 1
                FROM organization_members
                WHERE organization_members.organization_id = works.organization_id
                  AND organization_members.user_id = $2
                  AND organization_members.status = 'active'
              )
            )
          )
        FOR UPDATE OF reference_sets
        `,
        [input.entityId, input.userId, input.organizationId ?? null],
      );

      const currentRow = current.rows[0];
      if (currentRow === undefined) {
        return null;
      }

      const mergedImages = mergeReferenceImages(
        parseReferenceImages(currentRow.reference_images),
        input.images,
      );
      const primaryRefId = mergedImages.some((image) => image.refId === input.primaryRefId)
        ? input.primaryRefId
        : mergedImages[0]?.refId ?? null;
      const referenceSetStatus = deriveReferenceSetStatus(mergedImages.length);

      const updatedReferenceSet = await transactionClient.query<EntityReferenceSetRow>(
        `
        UPDATE reference_sets
        SET reference_images = $3::jsonb,
            primary_ref_id = $4,
            status = $5,
            updated_at = NOW()
        FROM entities
        INNER JOIN works ON works.id = entities.work_id
        WHERE reference_sets.entity_id = $1
          AND entities.id = reference_sets.entity_id
          AND (
            ($6::uuid IS NULL AND works.organization_id IS NULL AND entities.user_id = $2)
            OR (
              $6::uuid IS NOT NULL
              AND works.organization_id = $6::uuid
              AND EXISTS (
                SELECT 1
                FROM organization_members
                WHERE organization_members.organization_id = works.organization_id
                  AND organization_members.user_id = $2
                  AND organization_members.status = 'active'
              )
            )
          )
        RETURNING reference_sets.entity_id,
                  reference_sets.reference_images,
                  reference_sets.primary_ref_id,
                  reference_sets.status AS reference_set_status,
                  reference_sets.updated_at
        `,
        [
          input.entityId,
          input.userId,
          JSON.stringify(mergedImages.map(toReferenceImageRecord)),
          primaryRefId,
          referenceSetStatus,
          input.organizationId ?? null,
        ],
      );

      await transactionClient.query(
        `
        UPDATE entities
        SET prompt_supplement = CASE
              WHEN $3::boolean THEN $4
              ELSE prompt_supplement
            END,
            status = $5,
            updated_at = NOW()
        WHERE id = $1
          AND (
            ($6::uuid IS NULL AND user_id = $2 AND work_id IN (
              SELECT id
              FROM works
              WHERE organization_id IS NULL
            ))
            OR ($6::uuid IS NOT NULL AND work_id IN (
              SELECT id
              FROM works
              WHERE organization_id = $6::uuid
                AND EXISTS (
                  SELECT 1
                  FROM organization_members
                  WHERE organization_members.organization_id = works.organization_id
                    AND organization_members.user_id = $2
                    AND organization_members.status = 'active'
                )
            ))
          )
        `,
        [
          input.entityId,
          input.userId,
          input.promptSupplement !== undefined,
          input.promptSupplement ?? null,
          mergedImages.length === 0 ? 'draft' : 'ready',
          input.organizationId ?? null,
        ],
      );

      const updatedRow = updatedReferenceSet.rows[0];
      return updatedRow === undefined ? null : mapReferenceSetRow(updatedRow);
    });
  }

  public async deleteReferenceImage(input: {
    entityId: string;
    userId: string;
    organizationId?: string | null;
    refId: string;
  }): Promise<EntityReferenceSet | null> {
    const runner = this.client.transaction?.bind(this.client);
    if (runner === undefined) {
      throw new Error('EntityRepository requires transaction support to delete references');
    }

    return runner(async (transactionClient) => {
      const current = await transactionClient.query<EntityReferenceSetRow>(
        `
        SELECT reference_sets.entity_id,
               reference_sets.reference_images,
               reference_sets.primary_ref_id,
               reference_sets.status AS reference_set_status,
               reference_sets.updated_at
        FROM reference_sets
        INNER JOIN entities ON entities.id = reference_sets.entity_id
        INNER JOIN works ON works.id = entities.work_id
        WHERE reference_sets.entity_id = $1
          AND (
            ($3::uuid IS NULL AND works.organization_id IS NULL AND entities.user_id = $2)
            OR (
              $3::uuid IS NOT NULL
              AND works.organization_id = $3::uuid
              AND EXISTS (
                SELECT 1
                FROM organization_members
                WHERE organization_members.organization_id = works.organization_id
                  AND organization_members.user_id = $2
                  AND organization_members.status = 'active'
              )
            )
          )
        FOR UPDATE OF reference_sets
        `,
        [input.entityId, input.userId, input.organizationId ?? null],
      );

      const currentRow = current.rows[0];
      if (currentRow === undefined) {
        return null;
      }

      const nextImages = parseReferenceImages(currentRow.reference_images).filter(
        (image) => image.refId !== input.refId,
      );
      const primaryRefId = currentRow.primary_ref_id === input.refId
        ? (nextImages[0]?.refId ?? null)
        : nextImages.some((image) => image.refId === currentRow.primary_ref_id)
          ? currentRow.primary_ref_id
          : (nextImages[0]?.refId ?? null);
      const referenceSetStatus = deriveReferenceSetStatus(nextImages.length);

      const updatedReferenceSet = await transactionClient.query<EntityReferenceSetRow>(
        `
        UPDATE reference_sets
        SET reference_images = $3::jsonb,
            primary_ref_id = $4,
            status = $5,
            updated_at = NOW()
        FROM entities
        INNER JOIN works ON works.id = entities.work_id
        WHERE reference_sets.entity_id = $1
          AND entities.id = reference_sets.entity_id
          AND (
            ($6::uuid IS NULL AND works.organization_id IS NULL AND entities.user_id = $2)
            OR (
              $6::uuid IS NOT NULL
              AND works.organization_id = $6::uuid
              AND EXISTS (
                SELECT 1
                FROM organization_members
                WHERE organization_members.organization_id = works.organization_id
                  AND organization_members.user_id = $2
                  AND organization_members.status = 'active'
              )
            )
          )
        RETURNING reference_sets.entity_id,
                  reference_sets.reference_images,
                  reference_sets.primary_ref_id,
                  reference_sets.status AS reference_set_status,
                  reference_sets.updated_at
        `,
        [
          input.entityId,
          input.userId,
          JSON.stringify(nextImages.map(toReferenceImageRecord)),
          primaryRefId,
          referenceSetStatus,
          input.organizationId ?? null,
        ],
      );

      await transactionClient.query(
        `
        UPDATE entities
        SET status = $3,
            updated_at = NOW()
        WHERE id = $1
          AND (
            ($4::uuid IS NULL AND user_id = $2 AND work_id IN (
              SELECT id
              FROM works
              WHERE organization_id IS NULL
            ))
            OR ($4::uuid IS NOT NULL AND work_id IN (
              SELECT id
              FROM works
              WHERE organization_id = $4::uuid
                AND EXISTS (
                  SELECT 1
                  FROM organization_members
                  WHERE organization_members.organization_id = works.organization_id
                    AND organization_members.user_id = $2
                    AND organization_members.status = 'active'
                )
            ))
          )
        `,
        [input.entityId, input.userId, nextImages.length === 0 ? 'draft' : 'ready', input.organizationId ?? null],
      );

      const updatedRow = updatedReferenceSet.rows[0];
      return updatedRow === undefined ? null : mapReferenceSetRow(updatedRow);
    });
  }

  public async countEntityStateUsageByReferenceId(
    entityId: string,
    userId: string,
    refId: string,
    organizationId: string | null = null,
  ): Promise<number> {
    const result = await this.client.query<{ count: number }>(
      `
      SELECT COUNT(entity_states.id)::int AS count
      FROM entity_states
      INNER JOIN entities ON entities.id = entity_states.entity_id
      INNER JOIN works ON works.id = entities.work_id
      WHERE entity_states.entity_id = $1
        AND (
          ($4::uuid IS NULL AND works.organization_id IS NULL AND entities.user_id = $2)
          OR (
            $4::uuid IS NOT NULL
            AND works.organization_id = $4::uuid
            AND EXISTS (
              SELECT 1
              FROM organization_members
              WHERE organization_members.organization_id = works.organization_id
                AND organization_members.user_id = $2
                AND organization_members.status = 'active'
            )
          )
        )
        AND entity_states.costume_ref_id = $3
      `,
      [entityId, userId, refId, organizationId],
    );

    return result.rows[0]?.count ?? 0;
  }

  public async update(
    id: string,
    userId: string,
    input: UpdateEntityInput,
    organizationId: string | null = null,
  ): Promise<Entity | null> {
    const result = await this.client.query<EntityRow>(
      `
      UPDATE entities
      SET entity_type = COALESCE($3, entity_type),
          name = COALESCE($4, name),
          free_description = CASE WHEN $5::boolean THEN $6 ELSE free_description END,
          prompt_supplement = CASE WHEN $7::boolean THEN $8 ELSE prompt_supplement END,
          structured_fields = CASE WHEN $9::boolean THEN $10::jsonb ELSE structured_fields END,
          speech_profile = CASE WHEN $11::boolean THEN $12::jsonb ELSE speech_profile END,
          updated_at = NOW()
      WHERE id = $1
        AND (
          ($13::uuid IS NULL AND user_id = $2 AND work_id IN (
              SELECT id
              FROM works
              WHERE organization_id IS NULL
            ))
          OR ($13::uuid IS NOT NULL AND work_id IN (
              SELECT id
              FROM works
              WHERE organization_id = $13::uuid
                AND EXISTS (
                  SELECT 1
                  FROM organization_members
                  WHERE organization_members.organization_id = works.organization_id
                    AND organization_members.user_id = $2
                    AND organization_members.status = 'active'
                )
            ))
        )
      RETURNING *
      `,
      [
        id,
        userId,
        input.entityType ?? null,
        input.name ?? null,
        input.freeDescription !== undefined,
        input.freeDescription ?? null,
        input.promptSupplement !== undefined,
        input.promptSupplement ?? null,
        input.structuredFields !== undefined,
        JSON.stringify(input.structuredFields ?? {}),
        input.speechProfile !== undefined,
        JSON.stringify(input.speechProfile ?? {}),
        organizationId,
      ],
    );

    return result.rows[0] === undefined ? null : mapEntityRow(result.rows[0]);
  }

  public async delete(id: string, userId: string, organizationId: string | null = null): Promise<boolean> {
    const result = await this.client.query(
      `
      DELETE FROM entities
      WHERE id = $1
        AND (
          ($3::uuid IS NULL AND user_id = $2 AND work_id IN (
              SELECT id
              FROM works
              WHERE organization_id IS NULL
            ))
          OR ($3::uuid IS NOT NULL AND work_id IN (
              SELECT id
              FROM works
              WHERE organization_id = $3::uuid
                AND EXISTS (
                  SELECT 1
                  FROM organization_members
                  WHERE organization_members.organization_id = works.organization_id
                    AND organization_members.user_id = $2
                    AND organization_members.status = 'active'
                )
            ))
        )
      `,
      [id, userId, organizationId],
    );

    return (result.rowCount ?? 0) > 0;
  }
}

function mapEntityRow(row: EntityRow): Entity {
  return {
    id: row.id,
    workId: row.work_id,
    userId: row.user_id,
    entityType: row.entity_type,
    name: row.name,
    freeDescription: row.free_description,
    structuredFields: toJsonObject(row.structured_fields),
    promptSupplement: row.prompt_supplement,
    speechProfile: toJsonObject(row.speech_profile),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapEntityReferenceContextRow(
  row: EntityRow & EntityReferenceSetRow,
): EntityReferenceContext {
  return {
    entityId: row.id,
    workId: row.work_id,
    userId: row.user_id,
    entityType: row.entity_type,
    name: row.name,
    freeDescription: row.free_description,
    structuredFields: toJsonObject(row.structured_fields),
    promptSupplement: row.prompt_supplement,
    status: row.status,
    referenceSet: mapReferenceSetRow(row),
  };
}

function mapReferenceSetRow(row: EntityReferenceSetRow): EntityReferenceSet {
  return {
    entityId: row.entity_id,
    images: parseReferenceImages(row.reference_images),
    primaryRefId: row.primary_ref_id,
    status: row.reference_set_status,
    updatedAt: row.updated_at,
  };
}

function toJsonObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function parseReferenceImages(value: unknown): EntityReferenceImage[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (
      typeof entry !== 'object' ||
      entry === null ||
      Array.isArray(entry) ||
      typeof entry.ref_id !== 'string' ||
      typeof entry.s3_key !== 'string' ||
      typeof entry.cdn_url !== 'string'
    ) {
      return [];
    }

    return [
      {
        refId: entry.ref_id,
        s3Key: entry.s3_key,
        cdnUrl: entry.cdn_url,
        source: toReferenceSource(entry.source),
        createdAt:
          typeof entry.created_at === 'string' && entry.created_at.length > 0
            ? entry.created_at
            : new Date(0).toISOString(),
      },
    ];
  });
}

function toReferenceImageRecord(image: EntityReferenceImage): Record<string, unknown> {
  return {
    ref_id: image.refId,
    s3_key: image.s3Key,
    cdn_url: image.cdnUrl,
    source: image.source,
    created_at: image.createdAt,
  };
}

function toReferenceSource(value: unknown): EntityReferenceImageSource {
  return value === 'generated' ? 'generated' : 'upload';
}

function mergeReferenceImages(
  existingImages: EntityReferenceImage[],
  nextImages: EntityReferenceImage[],
): EntityReferenceImage[] {
  const merged: EntityReferenceImage[] = [];
  const seenS3Keys = new Set<string>();

  for (const image of [...existingImages, ...nextImages]) {
    if (seenS3Keys.has(image.s3Key)) {
      continue;
    }

    seenS3Keys.add(image.s3Key);
    merged.push(image);
  }

  return merged;
}

function deriveReferenceSetStatus(imageCount: number): EntityReferenceSetStatus {
  if (imageCount === 0) {
    return 'empty';
  }

  if (imageCount >= 3) {
    return 'ready';
  }

  return 'partial';
}
