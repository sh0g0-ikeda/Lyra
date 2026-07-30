import type { QueryResultRow } from 'pg';
import type {
  CreateEntityStateInput,
  CreateSceneInput,
  EntityState,
  Scene,
  SceneEntityStateReference,
  SceneStatus,
  UpdateEntityStateInput,
  UpdateSceneInput,
} from '../domain/types/scene.js';
import { ValidationError } from '../domain/errors/index.js';
import type { DatabaseClient } from '../lib/db.js';
import { isUniqueViolation } from '../lib/dbErrors.js';
import { normalizeNullableText } from '../lib/textEncoding.js';

export type {
  CreateEntityStateInput,
  CreateSceneInput,
  EntityState,
  Scene,
  UpdateEntityStateInput,
  UpdateSceneInput,
};

export interface EpisodeSceneContext {
  episodeId: string;
  workId: string;
}

export interface SceneWorkContext {
  sceneId: string;
  episodeId: string;
  workId: string;
}

export interface SceneRepository {
  findEpisodeContextByIdAndUserId(
    episodeId: string,
    userId: string,
    organizationId?: string | null,
  ): Promise<EpisodeSceneContext | null>;
  findSceneContextByIdAndUserId(
    sceneId: string,
    userId: string,
    organizationId?: string | null,
  ): Promise<SceneWorkContext | null>;
  createScene(episodeId: string, input: CreateSceneInput): Promise<Scene>;
  findScenesByEpisodeIdAndUserId(
    episodeId: string,
    userId: string,
    organizationId?: string | null,
  ): Promise<Scene[]>;
  updateScene(
    sceneId: string,
    userId: string,
    input: UpdateSceneInput,
    organizationId?: string | null,
  ): Promise<Scene | null>;
  deleteScene(sceneId: string, userId: string, organizationId?: string | null): Promise<boolean>;
  findEntityStatesByEntityIdAndUserId(
    entityId: string,
    userId: string,
    organizationId?: string | null,
  ): Promise<EntityState[]>;
  createEntityState(entityId: string, input: CreateEntityStateInput): Promise<EntityState>;
  updateEntityState(
    entityId: string,
    stateId: string,
    userId: string,
    input: UpdateEntityStateInput,
    organizationId?: string | null,
  ): Promise<EntityState | null>;
}

interface IdRow extends QueryResultRow {
  id: string;
}

interface EpisodeSceneContextRow extends QueryResultRow {
  episode_id: string;
  work_id: string;
}

interface SceneWorkContextRow extends QueryResultRow {
  scene_id: string;
  episode_id: string;
  work_id: string;
}

interface SceneRow extends QueryResultRow {
  id: string;
  episode_id: string;
  order: number;
  location: string | null;
  time: string | null;
  atmosphere: string | null;
  involved_entity_ids: string[];
  entity_states: unknown;
  status: SceneStatus;
  created_at: Date;
  updated_at: Date;
}

interface EntityStateRow extends QueryResultRow {
  id: string;
  entity_id: string;
  scene_id: string | null;
  costume_note: string | null;
  costume_ref_id: string | null;
  condition_note: string | null;
  hair_note: string | null;
  expression_default: string;
  extra_note: string | null;
  created_at: Date;
}

const sceneSelectColumns = `
  scenes.id,
  scenes.episode_id,
  scenes."order",
  scenes.location,
  scenes."time",
  scenes.atmosphere,
  scenes.involved_entity_ids,
  COALESCE(
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'entity_id', entity_states.entity_id,
          'state_id', entity_states.id
        )
        ORDER BY entity_states.created_at ASC
      )
      FROM entity_states
      WHERE entity_states.scene_id = scenes.id
    ),
    '[]'::jsonb
  ) AS entity_states,
  scenes.status,
  scenes.created_at,
  scenes.updated_at
`;

export class PostgresSceneRepository implements SceneRepository {
  public constructor(private readonly client: DatabaseClient) {}

  public async findEpisodeContextByIdAndUserId(
    episodeId: string,
    userId: string,
    organizationId: string | null = null,
  ): Promise<EpisodeSceneContext | null> {
    const result = await this.client.query<EpisodeSceneContextRow>(
      `
      SELECT episodes.id AS episode_id,
             chapters.work_id
      FROM episodes
      INNER JOIN chapters ON chapters.id = episodes.chapter_id
      INNER JOIN works ON works.id = chapters.work_id
      WHERE episodes.id = $1
        AND (
          ($3::uuid IS NULL AND works.organization_id IS NULL AND works.user_id = $2)
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
      [episodeId, userId, organizationId],
    );

    const row = result.rows[0];
    return row === undefined ? null : { episodeId: row.episode_id, workId: row.work_id };
  }

  public async findSceneContextByIdAndUserId(
    sceneId: string,
    userId: string,
    organizationId: string | null = null,
  ): Promise<SceneWorkContext | null> {
    const result = await this.client.query<SceneWorkContextRow>(
      `
      SELECT scenes.id AS scene_id,
             episodes.id AS episode_id,
             chapters.work_id
      FROM scenes
      INNER JOIN episodes ON episodes.id = scenes.episode_id
      INNER JOIN chapters ON chapters.id = episodes.chapter_id
      INNER JOIN works ON works.id = chapters.work_id
      WHERE scenes.id = $1
        AND (
          ($3::uuid IS NULL AND works.organization_id IS NULL AND works.user_id = $2)
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
      [sceneId, userId, organizationId],
    );

    const row = result.rows[0];
    return row === undefined
      ? null
      : { sceneId: row.scene_id, episodeId: row.episode_id, workId: row.work_id };
  }

  public async createScene(episodeId: string, input: CreateSceneInput): Promise<Scene> {
    try {
      const result = await this.client.query<SceneRow>(
        `
        INSERT INTO scenes (
          episode_id,
          "order",
          location,
          "time",
          atmosphere,
          involved_entity_ids
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
        `,
        [
          episodeId,
          input.order,
          normalizeNullableText(input.location),
          normalizeNullableText(input.time),
          normalizeNullableText(input.atmosphere),
          input.involvedEntityIds,
        ],
      );

      return mapSceneRow(result.rows[0]);
    } catch (error) {
      throw mapOrderConflict(error, 'Scene order must be unique within the episode');
    }
  }

  public async findScenesByEpisodeIdAndUserId(
    episodeId: string,
    userId: string,
    organizationId: string | null = null,
  ): Promise<Scene[]> {
    const result = await this.client.query<SceneRow>(
      `
      SELECT ${sceneSelectColumns}
      FROM scenes
      INNER JOIN episodes ON episodes.id = scenes.episode_id
      INNER JOIN chapters ON chapters.id = episodes.chapter_id
      INNER JOIN works ON works.id = chapters.work_id
      WHERE scenes.episode_id = $1
        AND (
          ($3::uuid IS NULL AND works.organization_id IS NULL AND works.user_id = $2)
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
      ORDER BY scenes."order" ASC
      `,
      [episodeId, userId, organizationId],
    );

    return result.rows.map(mapSceneRow);
  }

  public async updateScene(
    sceneId: string,
    userId: string,
    input: UpdateSceneInput,
    organizationId: string | null = null,
  ): Promise<Scene | null> {
    try {
      const result = await this.client.query<IdRow>(
        `
        UPDATE scenes
        SET "order" = COALESCE($3, scenes."order"),
            location = CASE WHEN $4::boolean THEN $5 ELSE scenes.location END,
            "time" = CASE WHEN $6::boolean THEN $7 ELSE scenes."time" END,
            atmosphere = CASE WHEN $8::boolean THEN $9 ELSE scenes.atmosphere END,
            involved_entity_ids = CASE WHEN $10::boolean THEN $11 ELSE scenes.involved_entity_ids END,
            status = COALESCE($12, scenes.status),
            updated_at = NOW()
        FROM episodes
        INNER JOIN chapters ON chapters.id = episodes.chapter_id
        INNER JOIN works ON works.id = chapters.work_id
        WHERE scenes.id = $1
          AND scenes.episode_id = episodes.id
          AND (
            ($13::uuid IS NULL AND works.organization_id IS NULL AND works.user_id = $2)
            OR (
              $13::uuid IS NOT NULL
              AND works.organization_id = $13::uuid
              AND EXISTS (
                SELECT 1
                FROM organization_members
                WHERE organization_members.organization_id = works.organization_id
                  AND organization_members.user_id = $2
                  AND organization_members.status = 'active'
              )
            )
          )
        RETURNING scenes.id
        `,
        [
          sceneId,
          userId,
          input.order ?? null,
          input.location !== undefined,
          normalizeNullableText(input.location ?? null),
          input.time !== undefined,
          normalizeNullableText(input.time ?? null),
          input.atmosphere !== undefined,
          normalizeNullableText(input.atmosphere ?? null),
          input.involvedEntityIds !== undefined,
          input.involvedEntityIds ?? [],
          input.status ?? null,
          organizationId,
        ],
      );

      if (result.rows[0] === undefined) {
        return null;
      }

      return this.findSceneByIdAndUserId(result.rows[0].id, userId, organizationId);
    } catch (error) {
      throw mapOrderConflict(error, 'Scene order must be unique within the episode');
    }
  }

  public async deleteScene(
    sceneId: string,
    userId: string,
    organizationId: string | null = null,
  ): Promise<boolean> {
    const result = await this.client.query(
      `
      DELETE FROM scenes
      USING episodes, chapters, works
      WHERE scenes.id = $1
        AND scenes.episode_id = episodes.id
        AND episodes.chapter_id = chapters.id
        AND chapters.work_id = works.id
        AND (
          ($3::uuid IS NULL AND works.organization_id IS NULL AND works.user_id = $2)
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
      [sceneId, userId, organizationId],
    );

    return (result.rowCount ?? 0) > 0;
  }

  public async createEntityState(entityId: string, input: CreateEntityStateInput): Promise<EntityState> {
    const result = await this.client.query<EntityStateRow>(
      `
      INSERT INTO entity_states (
        entity_id,
        scene_id,
        costume_note,
        costume_ref_id,
        condition_note,
        hair_note,
        expression_default,
        extra_note
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
      `,
      [
        entityId,
        input.sceneId,
        input.costumeNote,
        input.costumeRefId,
        input.conditionNote,
        input.hairNote,
        input.expressionDefault,
        input.extraNote,
      ],
    );

    return mapEntityStateRow(result.rows[0]);
  }

  public async findEntityStatesByEntityIdAndUserId(
    entityId: string,
    userId: string,
    organizationId: string | null = null,
  ): Promise<EntityState[]> {
    const result = await this.client.query<EntityStateRow>(
      `
      SELECT entity_states.*
      FROM entity_states
      INNER JOIN entities ON entities.id = entity_states.entity_id
      INNER JOIN works ON works.id = entities.work_id
      WHERE entity_states.entity_id = $1
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
      ORDER BY entity_states.created_at ASC, entity_states.id ASC
      `,
      [entityId, userId, organizationId],
    );

    return result.rows.map(mapEntityStateRow);
  }

  public async updateEntityState(
    entityId: string,
    stateId: string,
    userId: string,
    input: UpdateEntityStateInput,
    organizationId: string | null = null,
  ): Promise<EntityState | null> {
    const result = await this.client.query<EntityStateRow>(
      `
      UPDATE entity_states
      SET scene_id = CASE WHEN $4::boolean THEN $5 ELSE entity_states.scene_id END,
          costume_note = CASE WHEN $6::boolean THEN $7 ELSE entity_states.costume_note END,
          costume_ref_id = CASE WHEN $8::boolean THEN $9 ELSE entity_states.costume_ref_id END,
          condition_note = CASE WHEN $10::boolean THEN $11 ELSE entity_states.condition_note END,
          hair_note = CASE WHEN $12::boolean THEN $13 ELSE entity_states.hair_note END,
          expression_default = COALESCE($14, entity_states.expression_default),
          extra_note = CASE WHEN $15::boolean THEN $16 ELSE entity_states.extra_note END
      FROM entities
      INNER JOIN works ON works.id = entities.work_id
      WHERE entity_states.id = $1
        AND entity_states.entity_id = $2
        AND entity_states.entity_id = entities.id
        AND (
          ($17::uuid IS NULL AND works.organization_id IS NULL AND entities.user_id = $3)
          OR (
            $17::uuid IS NOT NULL
            AND works.organization_id = $17::uuid
            AND EXISTS (
              SELECT 1
              FROM organization_members
              WHERE organization_members.organization_id = works.organization_id
                AND organization_members.user_id = $3
                AND organization_members.status = 'active'
            )
          )
        )
      RETURNING entity_states.*
      `,
      [
        stateId,
        entityId,
        userId,
        input.sceneId !== undefined,
        input.sceneId ?? null,
        input.costumeNote !== undefined,
        input.costumeNote ?? null,
        input.costumeRefId !== undefined,
        input.costumeRefId ?? null,
        input.conditionNote !== undefined,
        input.conditionNote ?? null,
        input.hairNote !== undefined,
        input.hairNote ?? null,
        input.expressionDefault ?? null,
        input.extraNote !== undefined,
        input.extraNote ?? null,
        organizationId,
      ],
    );

    return result.rows[0] === undefined ? null : mapEntityStateRow(result.rows[0]);
  }

  private async findSceneByIdAndUserId(
    sceneId: string,
    userId: string,
    organizationId: string | null,
  ): Promise<Scene | null> {
    const result = await this.client.query<SceneRow>(
      `
      SELECT ${sceneSelectColumns}
      FROM scenes
      INNER JOIN episodes ON episodes.id = scenes.episode_id
      INNER JOIN chapters ON chapters.id = episodes.chapter_id
      INNER JOIN works ON works.id = chapters.work_id
      WHERE scenes.id = $1
        AND (
          ($3::uuid IS NULL AND works.organization_id IS NULL AND works.user_id = $2)
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
      [sceneId, userId, organizationId],
    );

    return result.rows[0] === undefined ? null : mapSceneRow(result.rows[0]);
  }
}

function mapSceneRow(row: SceneRow): Scene {
  return {
    id: row.id,
    episodeId: row.episode_id,
    order: row.order,
    location: normalizeNullableText(row.location),
    time: normalizeNullableText(row.time),
    atmosphere: normalizeNullableText(row.atmosphere),
    involvedEntityIds: row.involved_entity_ids,
    entityStates: toSceneStateReferences(row.entity_states),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapEntityStateRow(row: EntityStateRow): EntityState {
  return {
    id: row.id,
    entityId: row.entity_id,
    sceneId: row.scene_id,
    costumeNote: row.costume_note,
    costumeRefId: row.costume_ref_id,
    conditionNote: row.condition_note,
    hairNote: row.hair_note,
    expressionDefault: row.expression_default,
    extraNote: row.extra_note,
    createdAt: row.created_at,
  };
}

function toSceneStateReferences(value: unknown): SceneEntityStateReference[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (!isJsonObject(entry)) {
      return [];
    }

    const entityId = entry.entity_id;
    const stateId = entry.state_id;
    if (typeof entityId !== 'string' || typeof stateId !== 'string') {
      return [];
    }

    return [{ entityId, stateId }];
  });
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mapOrderConflict(error: unknown, message: string): Error {
  if (isUniqueViolation(error)) {
    return new ValidationError(message);
  }

  if (error instanceof Error) {
    return error;
  }

  return new Error('Unexpected database error');
}
