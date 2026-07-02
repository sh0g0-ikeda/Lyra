import type { QueryResultRow } from 'pg';
import { ValidationError } from '../domain/errors/index.js';
import type {
  CreatePanelInput,
  Panel,
  PanelAngle,
  PanelComposition,
  PanelCompositionSource,
  PanelDialogueLine,
  PanelDialoguePosition,
  PanelDialogueType,
  PanelRole,
  PanelShotType,
  PanelSize,
  UpdatePanelInput,
} from '../domain/types/panel.js';
import type {
  PanelEntityAction,
  PanelEntityAssignment,
  PanelEntityExpression,
  PanelEntityFacingDirection,
  PanelEntityPosition,
  PanelEntityRole,
} from '../domain/types/panelEntityAssignment.js';
import type { DatabaseClient, TransactionRunner } from '../lib/db.js';
import { isUniqueViolation } from '../lib/dbErrors.js';
import type { PageStatus } from '../domain/types/page.js';

export type { CreatePanelInput, Panel, UpdatePanelInput };

export interface PagePanelContext {
  pageId: string;
  workId: string;
  pageStatus: PageStatus;
}

export interface PanelContext {
  panelId: string;
  pageId: string;
  panelOrder: number;
  workId: string;
  pageStatus: PageStatus;
}

export interface PanelRepository {
  findPageContextByIdAndUserId(
    pageId: string,
    userId: string,
    organizationId?: string | null,
  ): Promise<PagePanelContext | null>;
  findPanelContextByIdAndUserId(
    panelId: string,
    userId: string,
    organizationId?: string | null,
  ): Promise<PanelContext | null>;
  createPanel(
    pageId: string,
    userId: string,
    input: CreatePanelInput,
    organizationId?: string | null,
  ): Promise<Panel | null>;
  findPanelsByPageIdAndUserId(pageId: string, userId: string, organizationId?: string | null): Promise<Panel[]>;
  updatePanel(
    panelId: string,
    userId: string,
    input: UpdatePanelInput,
    organizationId?: string | null,
  ): Promise<Panel | null>;
  deletePanel(panelId: string, userId: string, organizationId?: string | null): Promise<boolean>;
  compactPanelOrdersAfterDelete(
    pageId: string,
    userId: string,
    deletedOrder: number,
    organizationId?: string | null,
  ): Promise<void>;
  reorderPanels(
    pageId: string,
    userId: string,
    panelIds: string[],
    organizationId?: string | null,
  ): Promise<Panel[]>;
}

interface PagePanelContextRow extends QueryResultRow {
  page_id: string;
  work_id: string;
  page_status: PageStatus;
}

interface PanelContextRow extends QueryResultRow {
  panel_id: string;
  page_id: string;
  panel_order: number;
  work_id: string;
  page_status: PageStatus;
}

interface PanelRow extends QueryResultRow {
  id: string;
  page_id: string;
  order: number;
  panel_role: PanelRole;
  panel_size: PanelSize;
  situation_text: string | null;
  entities: unknown;
  composition: unknown;
  dialogue_in_panel: boolean;
  dialogue: unknown;
  sfx_text: string | null;
  background_note: string | null;
  panel_notes: string | null;
  created_at: Date;
  updated_at: Date;
}

export class PostgresPanelRepository implements PanelRepository {
  public constructor(private readonly client: DatabaseClient & TransactionRunner) {}

  public async findPageContextByIdAndUserId(
    pageId: string,
    userId: string,
    organizationId: string | null = null,
  ): Promise<PagePanelContext | null> {
    const result = await this.client.query<PagePanelContextRow>(
      `
      SELECT pages.id AS page_id,
             chapters.work_id,
             pages.status AS page_status
      FROM pages
      INNER JOIN episodes ON episodes.id = pages.episode_id
      INNER JOIN chapters ON chapters.id = episodes.chapter_id
      INNER JOIN works ON works.id = chapters.work_id
      WHERE pages.id = $1
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
      [pageId, userId, organizationId],
    );

    const row = result.rows[0];
    return row === undefined
      ? null
      : { pageId: row.page_id, workId: row.work_id, pageStatus: row.page_status };
  }

  public async findPanelContextByIdAndUserId(
    panelId: string,
    userId: string,
    organizationId: string | null = null,
  ): Promise<PanelContext | null> {
    const result = await this.client.query<PanelContextRow>(
      `
      SELECT panels.id AS panel_id,
             pages.id AS page_id,
             panels."order" AS panel_order,
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
      `,
      [panelId, userId, organizationId],
    );

    const row = result.rows[0];
    return row === undefined
      ? null
      : {
          panelId: row.panel_id,
          pageId: row.page_id,
          panelOrder: row.panel_order,
          workId: row.work_id,
          pageStatus: row.page_status,
        };
  }

  public async createPanel(
    pageId: string,
    userId: string,
    input: CreatePanelInput,
    organizationId: string | null = null,
  ): Promise<Panel | null> {
    try {
      const result = await this.client.query<PanelRow>(
        `
        INSERT INTO panels (
          page_id,
          "order",
          panel_role,
          panel_size,
          situation_text,
          composition,
          dialogue_in_panel,
          dialogue,
          sfx_text,
          background_note,
          panel_notes
        )
        SELECT
          pages.id,
          $3,
          $4,
          $5,
          $6,
          $7::jsonb,
          $8,
          $9::jsonb,
          $10,
          $11,
          $12
        FROM pages
        INNER JOIN episodes ON episodes.id = pages.episode_id
        INNER JOIN chapters ON chapters.id = episodes.chapter_id
        INNER JOIN works ON works.id = chapters.work_id
        WHERE pages.id = $1
          AND (
            ($13::uuid IS NULL AND works.user_id = $2 AND works.organization_id IS NULL)
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
        RETURNING *
        `,
        [
          pageId,
          userId,
          input.order,
          input.panelRole ?? 'action',
          input.panelSize ?? 'standard',
          input.situationText ?? null,
          JSON.stringify(toPanelCompositionJson(input.composition ?? defaultPanelComposition())),
          input.dialogueInPanel ?? true,
          JSON.stringify((input.dialogue ?? []).map(toPanelDialogueJson)),
          input.sfxText ?? null,
          input.backgroundNote ?? null,
          input.panelNotes ?? null,
          organizationId,
        ],
      );

      const row = result.rows[0];
      return row === undefined ? null : mapPanelRow(row);
    } catch (error) {
      throw mapOrderConflict(error);
    }
  }

  public async findPanelsByPageIdAndUserId(
    pageId: string,
    userId: string,
    organizationId: string | null = null,
  ): Promise<Panel[]> {
    const result = await this.client.query<PanelRow>(
      `
      SELECT panels.*
      FROM panels
      INNER JOIN pages ON pages.id = panels.page_id
      INNER JOIN episodes ON episodes.id = pages.episode_id
      INNER JOIN chapters ON chapters.id = episodes.chapter_id
      INNER JOIN works ON works.id = chapters.work_id
      WHERE panels.page_id = $1
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
      ORDER BY panels."order" ASC
      `,
      [pageId, userId, organizationId],
    );

    return result.rows.map(mapPanelRow);
  }

  public async updatePanel(
    panelId: string,
    userId: string,
    input: UpdatePanelInput,
    organizationId: string | null = null,
  ): Promise<Panel | null> {
    try {
      const result = await this.client.query<PanelRow>(
        `
        UPDATE panels
        SET "order" = COALESCE($3, panels."order"),
            panel_role = COALESCE($4, panels.panel_role),
            panel_size = COALESCE($5, panels.panel_size),
            situation_text = CASE WHEN $6::boolean THEN $7 ELSE panels.situation_text END,
            composition = CASE WHEN $8::boolean THEN $9::jsonb ELSE panels.composition END,
            dialogue_in_panel = CASE WHEN $10::boolean THEN $11 ELSE panels.dialogue_in_panel END,
            dialogue = CASE WHEN $12::boolean THEN $13::jsonb ELSE panels.dialogue END,
            sfx_text = CASE WHEN $14::boolean THEN $15 ELSE panels.sfx_text END,
            background_note = CASE WHEN $16::boolean THEN $17 ELSE panels.background_note END,
            panel_notes = CASE WHEN $18::boolean THEN $19 ELSE panels.panel_notes END,
            updated_at = NOW()
        FROM pages
        INNER JOIN episodes ON episodes.id = pages.episode_id
        INNER JOIN chapters ON chapters.id = episodes.chapter_id
        INNER JOIN works ON works.id = chapters.work_id
        WHERE panels.id = $1
          AND panels.page_id = pages.id
          AND (
            ($20::uuid IS NULL AND works.user_id = $2 AND works.organization_id IS NULL)
            OR (
            $20::uuid IS NOT NULL
            AND works.organization_id = $20::uuid
            AND EXISTS (
              SELECT 1
              FROM organization_members
              WHERE organization_members.organization_id = works.organization_id
                AND organization_members.user_id = $2
                AND organization_members.status = 'active'
            )
          )
          )
        RETURNING panels.*
        `,
        [
          panelId,
          userId,
          input.order ?? null,
          input.panelRole ?? null,
          input.panelSize ?? null,
          input.situationText !== undefined,
          input.situationText ?? null,
          input.composition !== undefined,
          JSON.stringify(toPanelCompositionJson(input.composition ?? defaultPanelComposition())),
          input.dialogueInPanel !== undefined,
          input.dialogueInPanel ?? true,
          input.dialogue !== undefined,
          JSON.stringify((input.dialogue ?? []).map(toPanelDialogueJson)),
          input.sfxText !== undefined,
          input.sfxText ?? null,
          input.backgroundNote !== undefined,
          input.backgroundNote ?? null,
          input.panelNotes !== undefined,
          input.panelNotes ?? null,
          organizationId,
        ],
      );

      const row = result.rows[0];
      return row === undefined ? null : mapPanelRow(row);
    } catch (error) {
      throw mapOrderConflict(error);
    }
  }

  public async deletePanel(panelId: string, userId: string, organizationId: string | null = null): Promise<boolean> {
    return this.client.transaction(async (transactionClient) => {
      await transactionClient.query(
        `
        UPDATE panel_frames
        SET panel_id = NULL
        WHERE panel_frames.panel_id = $1
          AND EXISTS (
            SELECT 1
            FROM panels
            INNER JOIN pages ON pages.id = panels.page_id
            INNER JOIN episodes ON episodes.id = pages.episode_id
            INNER JOIN chapters ON chapters.id = episodes.chapter_id
            INNER JOIN works ON works.id = chapters.work_id
            WHERE panels.id = $1
              AND panel_frames.page_id = pages.id
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
          )
        `,
        [panelId, userId, organizationId],
      );

      const result = await transactionClient.query<QueryResultRow>(
        `
        DELETE FROM panels
        USING pages
        INNER JOIN episodes ON episodes.id = pages.episode_id
        INNER JOIN chapters ON chapters.id = episodes.chapter_id
        INNER JOIN works ON works.id = chapters.work_id
        WHERE panels.id = $1
          AND panels.page_id = pages.id
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
        RETURNING panels.id
        `,
        [panelId, userId, organizationId],
      );

      return result.rows[0] !== undefined;
    });
  }

  public async compactPanelOrdersAfterDelete(
    pageId: string,
    userId: string,
    deletedOrder: number,
    organizationId: string | null = null,
  ): Promise<void> {
    await this.client.query(
      `
      UPDATE panels
      SET "order" = panels."order" - 1,
          updated_at = NOW()
      FROM pages
      INNER JOIN episodes ON episodes.id = pages.episode_id
      INNER JOIN chapters ON chapters.id = episodes.chapter_id
      INNER JOIN works ON works.id = chapters.work_id
      WHERE panels.page_id = pages.id
        AND pages.id = $1
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
        AND panels."order" > $3
      `,
      [pageId, userId, deletedOrder, organizationId],
    );
  }

  public async reorderPanels(
    pageId: string,
    userId: string,
    panelIds: string[],
    organizationId: string | null = null,
  ): Promise<Panel[]> {
    if (panelIds.length === 0) {
      return [];
    }

    return this.client.transaction(async (transactionClient) => {
      await transactionClient.query(
        `
        WITH requested_order AS (
          SELECT requested.id,
                 requested.ordinality::int AS new_order
          FROM unnest($3::uuid[]) WITH ORDINALITY AS requested(id, ordinality)
        )
        UPDATE panels
        SET "order" = -requested_order.new_order,
            updated_at = NOW()
        FROM requested_order,
             pages
        INNER JOIN episodes ON episodes.id = pages.episode_id
        INNER JOIN chapters ON chapters.id = episodes.chapter_id
        INNER JOIN works ON works.id = chapters.work_id
        WHERE panels.id = requested_order.id
          AND panels.page_id = pages.id
          AND panels.page_id = $1
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
        `,
        [pageId, userId, panelIds, organizationId],
      );

      await transactionClient.query(
        `
        UPDATE panels
        SET "order" = -panels."order",
            updated_at = NOW()
        FROM pages
        INNER JOIN episodes ON episodes.id = pages.episode_id
        INNER JOIN chapters ON chapters.id = episodes.chapter_id
        INNER JOIN works ON works.id = chapters.work_id
        WHERE panels.page_id = pages.id
          AND panels.page_id = $1
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
          AND panels."order" < 0
        `,
        [pageId, userId, organizationId],
      );

      const result = await transactionClient.query<PanelRow>(
        `
        SELECT panels.*
        FROM panels
        INNER JOIN pages ON pages.id = panels.page_id
        INNER JOIN episodes ON episodes.id = pages.episode_id
        INNER JOIN chapters ON chapters.id = episodes.chapter_id
        INNER JOIN works ON works.id = chapters.work_id
        WHERE panels.page_id = $1
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
        ORDER BY panels."order" ASC
        `,
        [pageId, userId, organizationId],
      );

      return result.rows.map(mapPanelRow);
    });
  }
}

function mapPanelRow(row: PanelRow): Panel {
  return {
    id: row.id,
    pageId: row.page_id,
    order: row.order,
    panelRole: row.panel_role,
    panelSize: row.panel_size,
    situationText: row.situation_text,
    entities: toPanelEntityAssignments(row.entities),
    composition: toPanelComposition(row.composition),
    dialogueInPanel: row.dialogue_in_panel,
    dialogue: toPanelDialogues(row.dialogue),
    sfxText: row.sfx_text,
    backgroundNote: row.background_note,
    panelNotes: row.panel_notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapOrderConflict(error: unknown): Error {
  if (isUniqueViolation(error)) {
    return new ValidationError('Panel order must be unique within the page');
  }

  return error instanceof Error ? error : new Error('Unexpected panel repository error');
}

function defaultPanelComposition(): PanelComposition {
  return {
    source: 'custom',
    galleryItemId: null,
    compositionPrompt: null,
    shotType: null,
    angle: null,
    customNote: null,
  };
}

function toPanelCompositionJson(composition: PanelComposition): Record<string, unknown> {
  return {
    source: composition.source,
    gallery_item_id: composition.galleryItemId,
    composition_prompt: composition.compositionPrompt,
    shot_type: composition.shotType,
    angle: composition.angle,
    custom_note: composition.customNote,
  };
}

function toPanelDialogueJson(dialogue: PanelDialogueLine): Record<string, unknown> {
  return {
    entity_id: dialogue.entityId,
    text: dialogue.text,
    type: dialogue.type,
    position: dialogue.position,
  };
}

function toPanelComposition(value: unknown): PanelComposition {
  if (!isRecord(value)) {
    return defaultPanelComposition();
  }

  const source = value.source;
  const galleryItemId = value.gallery_item_id;
  const compositionPrompt = value.composition_prompt;
  const shotType = value.shot_type;
  const angle = value.angle;
  const customNote = value.custom_note;

  return {
    source: isPanelCompositionSource(source) ? source : 'custom',
    galleryItemId: typeof galleryItemId === 'string' ? galleryItemId : null,
    compositionPrompt: typeof compositionPrompt === 'string' ? compositionPrompt : null,
    shotType: isPanelShotType(shotType) ? shotType : null,
    angle: isPanelAngle(angle) ? angle : null,
    customNote: typeof customNote === 'string' ? customNote : null,
  };
}

function toPanelDialogues(value: unknown): PanelDialogueLine[] {
  if (!Array.isArray(value)) {
    throw new ValidationError('Stored panel dialogue payload is invalid');
  }

  return value.map((entry) => {
    if (!isRecord(entry)) {
      throw new ValidationError('Stored panel dialogue payload is invalid');
    }

    const entityId = entry.entity_id;
    const text = entry.text;
    const type = entry.type;
    const position = entry.position;

    if (
      (entityId !== null && typeof entityId !== 'string') ||
      typeof text !== 'string' ||
      !isPanelDialogueType(type) ||
      !isPanelDialoguePosition(position)
    ) {
      throw new ValidationError('Stored panel dialogue payload is invalid');
    }

    return {
      entityId: entityId ?? null,
      text,
      type,
      position,
    };
  });
}

function toPanelEntityAssignments(value: unknown): PanelEntityAssignment[] {
  if (!Array.isArray(value)) {
    throw new ValidationError('Stored panel entities payload is invalid');
  }

  return value.map((entry) => {
    if (!isRecord(entry)) {
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
      (customExpression !== undefined && customExpression !== null && typeof customExpression !== 'string') ||
      !isPanelEntityAction(action) ||
      (customAction !== undefined && customAction !== null && typeof customAction !== 'string') ||
      !isPanelEntityPosition(position) ||
      (facingDirection !== undefined && !isNullablePanelEntityFacingDirection(facingDirection)) ||
      (effectNote !== undefined && effectNote !== null && typeof effectNote !== 'string') ||
      (stateId !== undefined && stateId !== null && typeof stateId !== 'string')
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isPanelCompositionSource(value: unknown): value is PanelCompositionSource {
  return value === 'gallery' || value === 'custom' || value === 'ai_auto';
}

function isPanelShotType(value: unknown): value is PanelShotType {
  return (
    value === 'full_body' ||
    value === 'half_body' ||
    value === 'close_up' ||
    value === 'wide' ||
    value === 'extreme_close_up'
  );
}

function isPanelAngle(value: unknown): value is PanelAngle {
  return (
    value === 'front' ||
    value === 'side' ||
    value === 'three_quarter' ||
    value === 'bird_eye' ||
    value === 'worm_eye' ||
    value === 'dutch_angle'
  );
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

function isPanelDialoguePosition(value: unknown): value is PanelDialoguePosition {
  return value === 'top' || value === 'bottom' || value === 'left' || value === 'right' || value === 'center';
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
