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
import type { DatabaseClient, TransactionRunner } from '../lib/db.js';

export type { CreateEntityInput, Entity, UpdateEntityInput };

export interface EntityPrimaryReferenceImage {
  entityId: string;
  refId: string;
  s3Key: string;
  cdnUrl: string;
}

export interface EntityRepository {
  create(input: CreateEntityInput): Promise<Entity>;
  findByIdAndUserId(id: string, userId: string): Promise<Entity | null>;
  findByWorkIdAndUserId(workId: string, userId: string): Promise<Entity[]>;
  countByIdsAndWorkIdAndUserId(entityIds: string[], workId: string, userId: string): Promise<number>;
  findPrimaryReferenceImagesByEntityIdsAndUserId(
    entityIds: string[],
    workId: string,
    userId: string,
  ): Promise<EntityPrimaryReferenceImage[]>;
  update(id: string, userId: string, input: UpdateEntityInput): Promise<Entity | null>;
  delete(id: string, userId: string): Promise<boolean>;
}

export interface EntityReferenceReader {
  countByIdsAndWorkIdAndUserId(entityIds: string[], workId: string, userId: string): Promise<number>;
}

export interface EntityReferenceRepository {
  findReferenceContextByIdAndUserId(entityId: string, userId: string): Promise<EntityReferenceContext | null>;
  saveConfirmedReferences(input: {
    entityId: string;
    userId: string;
    images: EntityReferenceImage[];
    primaryRefId: string;
    promptSupplement?: string | null;
  }): Promise<EntityReferenceSet | null>;
  deleteReferenceImage(input: {
    entityId: string;
    userId: string;
    refId: string;
  }): Promise<EntityReferenceSet | null>;
  countEntityStateUsageByReferenceId(entityId: string, userId: string, refId: string): Promise<number>;
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
  reference_images: unknown;
  primary_ref_id: string | null;
  reference_set_status: EntityReferenceSetStatus;
  updated_at: Date;
}

/**
 * Owns entity persistence plus reference_set mutations so the confirm/delete
 * flow stays transactional and user-scoped.
 */
export class PostgresEntityRepository implements EntityRepository, EntityReferenceRepository {
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

  public async findByIdAndUserId(id: string, userId: string): Promise<Entity | null> {
    const result = await this.client.query<EntityRow>(
      `
      SELECT *
      FROM entities
      WHERE id = $1
        AND user_id = $2
      `,
      [id, userId],
    );

    return result.rows[0] === undefined ? null : mapEntityRow(result.rows[0]);
  }

  public async findByWorkIdAndUserId(workId: string, userId: string): Promise<Entity[]> {
    const result = await this.client.query<EntityRow>(
      `
      SELECT *
      FROM entities
      WHERE work_id = $1
        AND user_id = $2
      ORDER BY created_at DESC
      `,
      [workId, userId],
    );

    return result.rows.map(mapEntityRow);
  }

  public async findReferenceContextByIdAndUserId(
    entityId: string,
    userId: string,
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
      WHERE entities.id = $1
        AND entities.user_id = $2
      `,
      [entityId, userId],
    );

    const row = result.rows[0];
    return row === undefined ? null : mapEntityReferenceContextRow(row);
  }

  public async countByIdsAndWorkIdAndUserId(
    entityIds: string[],
    workId: string,
    userId: string,
  ): Promise<number> {
    if (entityIds.length === 0) {
      return 0;
    }

    const result = await this.client.query<{ count: number }>(
      `
      SELECT COUNT(DISTINCT id)::int AS count
      FROM entities
      WHERE id = ANY($1::uuid[])
        AND work_id = $2
        AND user_id = $3
      `,
      [entityIds, workId, userId],
    );

    return result.rows[0]?.count ?? 0;
  }

  public async findPrimaryReferenceImagesByEntityIdsAndUserId(
    entityIds: string[],
    workId: string,
    userId: string,
  ): Promise<EntityPrimaryReferenceImage[]> {
    if (entityIds.length === 0) {
      return [];
    }

    const result = await this.client.query<EntityReferenceSetRow>(
      `
      SELECT entities.id AS entity_id,
             reference_sets.reference_images,
             reference_sets.primary_ref_id,
             reference_sets.status AS reference_set_status,
             reference_sets.updated_at
      FROM entities
      INNER JOIN reference_sets ON reference_sets.entity_id = entities.id
      WHERE entities.id = ANY($1::uuid[])
        AND entities.work_id = $2
        AND entities.user_id = $3
      `,
      [entityIds, workId, userId],
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
        WHERE reference_sets.entity_id = $1
          AND entities.user_id = $2
        FOR UPDATE OF reference_sets
        `,
        [input.entityId, input.userId],
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
        WHERE reference_sets.entity_id = $1
          AND entities.id = reference_sets.entity_id
          AND entities.user_id = $2
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
          AND user_id = $2
        `,
        [
          input.entityId,
          input.userId,
          input.promptSupplement !== undefined,
          input.promptSupplement ?? null,
          mergedImages.length === 0 ? 'draft' : 'ready',
        ],
      );

      const updatedRow = updatedReferenceSet.rows[0];
      return updatedRow === undefined ? null : mapReferenceSetRow(updatedRow);
    });
  }

  public async deleteReferenceImage(input: {
    entityId: string;
    userId: string;
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
        WHERE reference_sets.entity_id = $1
          AND entities.user_id = $2
        FOR UPDATE OF reference_sets
        `,
        [input.entityId, input.userId],
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
        WHERE reference_sets.entity_id = $1
          AND entities.id = reference_sets.entity_id
          AND entities.user_id = $2
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
        ],
      );

      await transactionClient.query(
        `
        UPDATE entities
        SET status = $3,
            updated_at = NOW()
        WHERE id = $1
          AND user_id = $2
        `,
        [input.entityId, input.userId, nextImages.length === 0 ? 'draft' : 'ready'],
      );

      const updatedRow = updatedReferenceSet.rows[0];
      return updatedRow === undefined ? null : mapReferenceSetRow(updatedRow);
    });
  }

  public async countEntityStateUsageByReferenceId(
    entityId: string,
    userId: string,
    refId: string,
  ): Promise<number> {
    const result = await this.client.query<{ count: number }>(
      `
      SELECT COUNT(entity_states.id)::int AS count
      FROM entity_states
      INNER JOIN entities ON entities.id = entity_states.entity_id
      WHERE entity_states.entity_id = $1
        AND entities.user_id = $2
        AND entity_states.costume_ref_id = $3
      `,
      [entityId, userId, refId],
    );

    return result.rows[0]?.count ?? 0;
  }

  public async update(id: string, userId: string, input: UpdateEntityInput): Promise<Entity | null> {
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
        AND user_id = $2
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
      ],
    );

    return result.rows[0] === undefined ? null : mapEntityRow(result.rows[0]);
  }

  public async delete(id: string, userId: string): Promise<boolean> {
    const result = await this.client.query(
      `
      DELETE FROM entities
      WHERE id = $1
        AND user_id = $2
      `,
      [id, userId],
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
