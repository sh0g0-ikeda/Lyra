import type { QueryResultRow } from 'pg';
import type {
  CreateEntityInput,
  Entity,
  EntityStatus,
  EntityType,
  UpdateEntityInput,
} from '../domain/types/entity.js';
import type { DatabaseClient } from '../lib/db.js';

export type { CreateEntityInput, Entity, UpdateEntityInput };

export interface EntityRepository {
  create(input: CreateEntityInput): Promise<Entity>;
  findByIdAndUserId(id: string, userId: string): Promise<Entity | null>;
  findByWorkIdAndUserId(workId: string, userId: string): Promise<Entity[]>;
  countByIdsAndWorkIdAndUserId(entityIds: string[], workId: string, userId: string): Promise<number>;
  update(id: string, userId: string, input: UpdateEntityInput): Promise<Entity | null>;
  delete(id: string, userId: string): Promise<boolean>;
}

export interface EntityReferenceReader {
  countByIdsAndWorkIdAndUserId(entityIds: string[], workId: string, userId: string): Promise<number>;
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

export class PostgresEntityRepository implements EntityRepository {
  public constructor(private readonly client: DatabaseClient) {}

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
          structured_fields,
          speech_profile,
          status
        )
        VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, 'draft')
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

  public async update(id: string, userId: string, input: UpdateEntityInput): Promise<Entity | null> {
    const result = await this.client.query<EntityRow>(
      `
      UPDATE entities
      SET entity_type = COALESCE($3, entity_type),
          name = COALESCE($4, name),
          free_description = CASE WHEN $5::boolean THEN $6 ELSE free_description END,
          structured_fields = CASE WHEN $7::boolean THEN $8::jsonb ELSE structured_fields END,
          speech_profile = CASE WHEN $9::boolean THEN $10::jsonb ELSE speech_profile END,
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

function toJsonObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}
