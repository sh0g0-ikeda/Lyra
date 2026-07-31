import type { QueryResultRow } from 'pg';
import { ValidationError } from '../domain/errors/index.js';
import type { PanelDialogueType } from '../domain/types/panel.js';
import type { PageStatus } from '../domain/types/page.js';
import type {
  PanelEntityAssignment,
  PanelEntityAction,
  PanelEntityExpression,
  PanelEntityFacingDirection,
  PanelEntityPosition,
  PanelEntityRole,
  PanelEntityStateReference,
} from '../domain/types/panelEntityAssignment.js';
import type { DatabaseClient, TransactionRunner } from '../lib/db.js';

export type { PanelEntityAssignment, PanelEntityStateReference };

export interface PanelContext {
  panelId: string;
  pageId: string;
  workId: string;
}

export type ConditionalPanelEntityAssignmentResult =
  | { status: 'saved'; assignments: PanelEntityAssignment[] }
  | {
      status:
        | 'not_found'
        | 'stale'
        | 'page_not_editable'
        | 'dialogue_speaker_not_assigned'
        | 'entity_not_in_work'
        | 'state_not_in_entity';
    };

export interface PanelEntityAssignmentRepository {
  findPanelContextByIdAndUserId(
    panelId: string,
    userId: string,
    organizationId?: string | null,
  ): Promise<PanelContext | null>;
  countEntitiesByIdsAndWorkIdAndUserId(
    entityIds: string[],
    workId: string,
    userId: string,
    organizationId?: string | null,
  ): Promise<number>;
  countEntityStatePairsByWorkIdAndUserId(
    pairs: PanelEntityStateReference[],
    workId: string,
    userId: string,
    organizationId?: string | null,
  ): Promise<number>;
  updatePanelEntityAssignments(
    panelId: string,
    userId: string,
    assignments: PanelEntityAssignment[],
    organizationId?: string | null,
  ): Promise<PanelEntityAssignment[] | null>;
  replacePanelEntityAssignmentsConditionally(
    panelId: string,
    userId: string,
    expectedAssignments: PanelEntityAssignment[],
    assignments: PanelEntityAssignment[],
    organizationId?: string | null,
  ): Promise<ConditionalPanelEntityAssignmentResult>;
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

interface ConditionalPageContextRow extends QueryResultRow {
  page_id: string;
  work_id: string;
  page_status: PageStatus;
}

interface LockedPanelAssignmentRow extends QueryResultRow {
  dialogue: unknown;
  entities: unknown;
}

interface EntityIdRow extends QueryResultRow {
  id: string;
}

interface EntityStatePairRow extends QueryResultRow {
  entity_id: string;
  state_id: string;
}

export class PostgresPanelEntityAssignmentRepository implements PanelEntityAssignmentRepository {
  public constructor(private readonly client: DatabaseClient & TransactionRunner) {}

  public async findPanelContextByIdAndUserId(
    panelId: string,
    userId: string,
    organizationId: string | null = null,
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
        AND (
          ($3::uuid IS NULL AND works.user_id = $2 AND works.organization_id IS NULL)
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
      [panelId, userId, organizationId],
    );

    const row = result.rows[0];
    return row === undefined ? null : { panelId: row.panel_id, pageId: row.page_id, workId: row.work_id };
  }

  public async countEntitiesByIdsAndWorkIdAndUserId(
    entityIds: string[],
    workId: string,
    userId: string,
    organizationId: string | null = null,
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
        AND (
          $4::uuid IS NOT NULL
          OR user_id = $3
        )
      `,
      [entityIds, workId, userId, organizationId],
    );

    return result.rows[0]?.count ?? 0;
  }

  public async countEntityStatePairsByWorkIdAndUserId(
    pairs: PanelEntityStateReference[],
    workId: string,
    userId: string,
    organizationId: string | null = null,
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
        AND (
          $4::uuid IS NOT NULL
          OR entities.user_id = $3
        )
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
        organizationId,
      ],
    );

    return result.rows[0]?.count ?? 0;
  }

  public async updatePanelEntityAssignments(
    panelId: string,
    userId: string,
    assignments: PanelEntityAssignment[],
    organizationId: string | null = null,
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
        AND (
          ($4::uuid IS NULL AND works.user_id = $2 AND works.organization_id IS NULL)
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
      RETURNING panels.entities
      `,
      [panelId, userId, JSON.stringify(assignments.map(toPanelEntityAssignmentJson)), organizationId],
    );

    const row = result.rows[0];
    return row === undefined ? null : toLegacyPanelEntityAssignments(row.entities);
  }

  public async replacePanelEntityAssignmentsConditionally(
    panelId: string,
    userId: string,
    expectedAssignments: PanelEntityAssignment[],
    assignments: PanelEntityAssignment[],
    organizationId: string | null = null,
  ): Promise<ConditionalPanelEntityAssignmentResult> {
    return this.client.transaction(async (transactionClient) => {
      const pageResult = await transactionClient.query<ConditionalPageContextRow>(
        `
        SELECT pages.id AS page_id,
               chapters.work_id,
               pages.status AS page_status
        FROM panels
        INNER JOIN pages ON pages.id = panels.page_id
        INNER JOIN episodes ON episodes.id = pages.episode_id
        INNER JOIN chapters ON chapters.id = episodes.chapter_id
        INNER JOIN works ON works.id = chapters.work_id
        WHERE panels.id = $1
          AND (
            ($3::uuid IS NULL AND works.user_id = $2 AND works.organization_id IS NULL)
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
        FOR UPDATE OF pages
        `,
        [panelId, userId, organizationId],
      );
      const page = pageResult.rows[0];
      if (page === undefined) {
        return { status: 'not_found' };
      }
      if (page.page_status === 'confirmed' || page.page_status === 'generating') {
        return { status: 'page_not_editable' };
      }

      const panelResult = await transactionClient.query<LockedPanelAssignmentRow>(
        `
        SELECT panels.entities,
               panels.dialogue
        FROM panels
        WHERE panels.id = $1
          AND panels.page_id = $2
        FOR UPDATE
        `,
        [panelId, page.page_id],
      );
      const panel = panelResult.rows[0];
      if (panel === undefined) {
        return { status: 'not_found' };
      }

      const storedAssignments = toStrictPanelEntityAssignments(panel.entities);
      if (!sameAssignments(storedAssignments, expectedAssignments)) {
        return { status: 'stale' };
      }

      const assignedEntityIds = new Set(assignments.map((assignment) => assignment.entityId));
      const speakerEntityIds = toPanelSpeakerEntityIds(panel.dialogue);
      if (speakerEntityIds.some((entityId) => !assignedEntityIds.has(entityId))) {
        return { status: 'dialogue_speaker_not_assigned' };
      }

      const entityIds = [...assignedEntityIds].sort();
      if (entityIds.length > 0) {
        const entityResult = await transactionClient.query<EntityIdRow>(
          `
          SELECT entities.id
          FROM entities
          WHERE entities.id = ANY($1::uuid[])
            AND entities.work_id = $2
            AND (
              $4::uuid IS NOT NULL
              OR entities.user_id = $3
            )
          ORDER BY entities.id
          FOR KEY SHARE
          `,
          [entityIds, page.work_id, userId, organizationId],
        );
        if (entityResult.rows.length !== entityIds.length) {
          return { status: 'entity_not_in_work' };
        }
      }

      const statePairs = uniqueStateReferences(assignments);
      if (statePairs.length > 0) {
        const stateResult = await transactionClient.query<EntityStatePairRow>(
          `
          WITH requested(entity_id, state_id) AS (
            SELECT entity_id, state_id
            FROM jsonb_to_recordset($1::jsonb) AS requested(entity_id uuid, state_id uuid)
          )
          SELECT entity_states.entity_id,
                 entity_states.id AS state_id
          FROM requested
          INNER JOIN entity_states
            ON entity_states.id = requested.state_id
           AND entity_states.entity_id = requested.entity_id
          INNER JOIN entities ON entities.id = entity_states.entity_id
          WHERE entities.work_id = $2
            AND (
              $4::uuid IS NOT NULL
              OR entities.user_id = $3
            )
          ORDER BY entity_states.entity_id, entity_states.id
          FOR KEY SHARE OF entity_states
          `,
          [
            JSON.stringify(statePairs.map((pair) => ({
              entity_id: pair.entityId,
              state_id: pair.stateId,
            }))),
            page.work_id,
            userId,
            organizationId,
          ],
        );
        if (stateResult.rows.length !== statePairs.length) {
          return { status: 'state_not_in_entity' };
        }
      }

      const updateResult = await transactionClient.query<PanelEntitiesRow>(
        `
        UPDATE panels
        SET entities = $2::jsonb,
            updated_at = NOW()
        WHERE panels.id = $1
        RETURNING panels.entities
        `,
        [panelId, JSON.stringify(assignments.map(toPanelEntityAssignmentJson))],
      );
      const updated = updateResult.rows[0];
      if (updated === undefined) {
        return { status: 'not_found' };
      }
      return {
        status: 'saved',
        assignments: toStrictPanelEntityAssignments(updated.entities),
      };
    });
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

function toLegacyPanelEntityAssignments(value: unknown): PanelEntityAssignment[] {
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

    return [{
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
    }];
  });
}

function toStrictPanelEntityAssignments(value: unknown): PanelEntityAssignment[] {
  if (!Array.isArray(value)) {
    throw new ValidationError('Stored panel entities payload is invalid');
  }

  return value.map((entry) => {
    if (!isJsonObject(entry)) {
      throw new ValidationError('Stored panel entities payload is invalid');
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
      !isOptionalNullableString(customExpression) ||
      !isPanelEntityAction(action) ||
      !isOptionalNullableString(customAction) ||
      !isPanelEntityPosition(position) ||
      !isOptionalNullablePanelEntityFacingDirection(facingDirection) ||
      !isOptionalNullableString(effectNote) ||
      !isOptionalNullableString(stateId)
    ) {
      throw new ValidationError('Stored panel entities payload is invalid');
    }

    return {
      entityId,
      role,
      expression,
      customExpression: customExpression ?? null,
      action,
      customAction: customAction ?? null,
      position,
      facingDirection: facingDirection ?? null,
      effectNote: effectNote ?? null,
      stateId: stateId ?? null,
    };
  });
}

function sameAssignments(
  left: readonly PanelEntityAssignment[],
  right: readonly PanelEntityAssignment[],
): boolean {
  return JSON.stringify(left.map(toComparablePanelEntityAssignmentJson))
    === JSON.stringify(right.map(toComparablePanelEntityAssignmentJson));
}

function toComparablePanelEntityAssignmentJson(
  assignment: PanelEntityAssignment,
): Record<string, unknown> {
  return {
    ...toPanelEntityAssignmentJson(assignment),
    custom_expression:
      assignment.expression === 'custom' ? assignment.customExpression?.trim() ?? null : null,
    custom_action:
      assignment.action === 'custom' ? assignment.customAction?.trim() ?? null : null,
    effect_note: assignment.effectNote?.trim() ?? null,
  };
}

function uniqueStateReferences(
  assignments: readonly PanelEntityAssignment[],
): PanelEntityStateReference[] {
  const seen = new Set<string>();
  const references: PanelEntityStateReference[] = [];
  for (const assignment of assignments) {
    if (assignment.stateId === null) {
      continue;
    }
    const key = `${assignment.entityId}:${assignment.stateId}`;
    if (!seen.has(key)) {
      seen.add(key);
      references.push({ entityId: assignment.entityId, stateId: assignment.stateId });
    }
  }
  return references;
}

function toPanelSpeakerEntityIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new ValidationError('Stored panel dialogue payload is invalid');
  }
  const speakerEntityIds: string[] = [];
  for (const entry of value) {
    if (!isJsonObject(entry) || !isPanelDialogueType(entry.type)) {
      throw new ValidationError('Stored panel dialogue payload is invalid');
    }
    const entityId = entry.entity_id;
    if (entityId !== undefined && entityId !== null && typeof entityId !== 'string') {
      throw new ValidationError('Stored panel dialogue payload is invalid');
    }
    if (requiresSpeaker(entry.type)) {
      if (typeof entityId !== 'string') {
        throw new ValidationError('Stored panel dialogue payload is invalid');
      }
      speakerEntityIds.push(entityId);
    }
  }
  return [...new Set(speakerEntityIds)];
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

function isOptionalNullablePanelEntityFacingDirection(
  value: unknown,
): value is PanelEntityFacingDirection | null | undefined {
  return value === undefined || isNullablePanelEntityFacingDirection(value);
}

function isNullableString(value: unknown): value is string | null {
  return typeof value === 'string' || value === null;
}

function isOptionalNullableString(value: unknown): value is string | null | undefined {
  return value === undefined || isNullableString(value);
}

function isPanelDialogueType(value: unknown): value is PanelDialogueType {
  return (
    value === 'speech' ||
    value === 'thought' ||
    value === 'narration' ||
    value === 'shout' ||
    value === 'whisper' ||
    value === 'sfx'
  );
}

function requiresSpeaker(type: PanelDialogueType): boolean {
  return type === 'speech' || type === 'thought' || type === 'shout' || type === 'whisper';
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
