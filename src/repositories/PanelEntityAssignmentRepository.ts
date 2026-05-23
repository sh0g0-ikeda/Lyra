import type { QueryResultRow } from 'pg';
import type {
  PanelEntityAssignment,
  PanelEntityAction,
  PanelEntityExpression,
  PanelEntityFacingDirection,
  PanelEntityPosition,
  PanelEntityRole,
  PanelEntityStateReference,
} from '../domain/types/panelEntityAssignment.js';
import type { DatabaseClient } from '../lib/db.js';

export type { PanelEntityAssignment, PanelEntityStateReference };

export interface PanelContext {
  panelId: string;
  pageId: string;
  workId: string;
}

export interface PanelEntityAssignmentRepository {
  findPanelContextByIdAndUserId(panelId: string, userId: string): Promise<PanelContext | null>;
  countEntitiesByIdsAndWorkIdAndUserId(
    entityIds: string[],
    workId: string,
    userId: string,
  ): Promise<number>;
  countEntityStatePairsByWorkIdAndUserId(
    pairs: PanelEntityStateReference[],
    workId: string,
    userId: string,
  ): Promise<number>;
  updatePanelEntityAssignments(
    panelId: string,
    userId: string,
    assignments: PanelEntityAssignment[],
  ): Promise<PanelEntityAssignment[] | null>;
}

interface PanelContextRow extends QueryResultRow {
  panel_id: string;
  page_id: string;
  work_id: string;
}

interface CountRow extends QueryResultRow {
  count: number;
}

interface PanelEntitiesRow extends QueryResultRow {
  entities: unknown;
}

export class PostgresPanelEntityAssignmentRepository implements PanelEntityAssignmentRepository {
  public constructor(private readonly client: DatabaseClient) {}

  public async findPanelContextByIdAndUserId(
    panelId: string,
    userId: string,
  ): Promise<PanelContext | null> {
    const result = await this.client.query<PanelContextRow>(
      `
      SELECT panels.id AS panel_id,
             pages.id AS page_id,
             chapters.work_id
      FROM panels
      INNER JOIN pages ON pages.id = panels.page_id
      INNER JOIN episodes ON episodes.id = pages.episode_id
      INNER JOIN chapters ON chapters.id = episodes.chapter_id
      INNER JOIN works ON works.id = chapters.work_id
      WHERE panels.id = $1
        AND works.user_id = $2
      `,
      [panelId, userId],
    );

    const row = result.rows[0];
    return row === undefined ? null : { panelId: row.panel_id, pageId: row.page_id, workId: row.work_id };
  }

  public async countEntitiesByIdsAndWorkIdAndUserId(
    entityIds: string[],
    workId: string,
    userId: string,
  ): Promise<number> {
    if (entityIds.length === 0) {
      return 0;
    }

    const result = await this.client.query<CountRow>(
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

  public async countEntityStatePairsByWorkIdAndUserId(
    pairs: PanelEntityStateReference[],
    workId: string,
    userId: string,
  ): Promise<number> {
    if (pairs.length === 0) {
      return 0;
    }

    const result = await this.client.query<CountRow>(
      `
      WITH requested(entity_id, state_id) AS (
        SELECT entity_id, state_id
        FROM jsonb_to_recordset($1::jsonb) AS requested(entity_id uuid, state_id uuid)
      )
      SELECT COUNT(*)::int AS count
      FROM requested
      INNER JOIN entity_states
        ON entity_states.id = requested.state_id
       AND entity_states.entity_id = requested.entity_id
      INNER JOIN entities ON entities.id = requested.entity_id
      WHERE entities.work_id = $2
        AND entities.user_id = $3
      `,
      [
        JSON.stringify(
          pairs.map((pair) => ({
            entity_id: pair.entityId,
            state_id: pair.stateId,
          })),
        ),
        workId,
        userId,
      ],
    );

    return result.rows[0]?.count ?? 0;
  }

  public async updatePanelEntityAssignments(
    panelId: string,
    userId: string,
    assignments: PanelEntityAssignment[],
  ): Promise<PanelEntityAssignment[] | null> {
    const result = await this.client.query<PanelEntitiesRow>(
      `
      UPDATE panels
      SET entities = $3::jsonb,
          updated_at = NOW()
      FROM pages
      INNER JOIN episodes ON episodes.id = pages.episode_id
      INNER JOIN chapters ON chapters.id = episodes.chapter_id
      INNER JOIN works ON works.id = chapters.work_id
      WHERE panels.id = $1
        AND panels.page_id = pages.id
        AND works.user_id = $2
      RETURNING panels.entities
      `,
      [panelId, userId, JSON.stringify(assignments.map(toPanelEntityAssignmentJson))],
    );

    const row = result.rows[0];
    return row === undefined ? null : toPanelEntityAssignments(row.entities);
  }
}

function toPanelEntityAssignmentJson(assignment: PanelEntityAssignment): Record<string, unknown> {
  return {
    entity_id: assignment.entityId,
    role: assignment.role,
    expression: assignment.expression,
    custom_expression: assignment.customExpression,
    action: assignment.action,
    custom_action: assignment.customAction,
    position: assignment.position,
    facing_direction: assignment.facingDirection,
    effect_note: assignment.effectNote,
    state_id: assignment.stateId,
  };
}

function toPanelEntityAssignments(value: unknown): PanelEntityAssignment[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (!isJsonObject(entry)) {
      return [];
    }

    const entityId = entry.entity_id;
    const role = entry.role;
    const expression = entry.expression;
    const customExpression = entry.custom_expression;
    const action = entry.action;
    const customAction = entry.custom_action;
    const position = entry.position;
    const facingDirection = entry.facing_direction;
    const effectNote = entry.effect_note;
    const stateId = entry.state_id;

    if (
      typeof entityId !== 'string' ||
      !isPanelEntityRole(role) ||
      !isPanelEntityExpression(expression) ||
      !isNullableString(customExpression) ||
      !isPanelEntityAction(action) ||
      !isNullableString(customAction) ||
      !isPanelEntityPosition(position) ||
      !isNullablePanelEntityFacingDirection(facingDirection) ||
      !isNullableString(effectNote) ||
      !isNullableString(stateId)
    ) {
      return [];
    }

    return [
      {
        entityId,
        role,
        expression,
        customExpression,
        action,
        customAction,
        position,
        facingDirection,
        effectNote,
        stateId,
      },
    ];
  });
}

function isPanelEntityRole(value: unknown): value is PanelEntityRole {
  return value === 'primary' || value === 'secondary' || value === 'background';
}

function isPanelEntityExpression(value: unknown): value is PanelEntityExpression {
  return (
    value === 'determined' ||
    value === 'calm' ||
    value === 'angry' ||
    value === 'sad' ||
    value === 'surprised' ||
    value === 'custom'
  );
}

function isPanelEntityAction(value: unknown): value is PanelEntityAction {
  return (
    value === 'standing_firm' ||
    value === 'attacking' ||
    value === 'defending' ||
    value === 'running' ||
    value === 'custom'
  );
}

function isPanelEntityPosition(value: unknown): value is PanelEntityPosition {
  return value === 'left' || value === 'center' || value === 'right' || value === 'background';
}

function isNullablePanelEntityFacingDirection(
  value: unknown,
): value is PanelEntityFacingDirection | null {
  return (
    value === null ||
    value === 'front' ||
    value === 'left' ||
    value === 'right' ||
    value === 'away' ||
    value === 'three_quarter_left' ||
    value === 'three_quarter_right'
  );
}

function isNullableString(value: unknown): value is string | null {
  return typeof value === 'string' || value === null;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
