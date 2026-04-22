import type { QueryResultRow } from 'pg';
import type { LayoutTemplateId } from '../domain/constants/layoutTemplates.js';
import type {
  CreatePageInput,
  CreatePanelInput,
  GeneratedImage,
  Page,
  PageDialogueMode,
  PageGenerationMode,
  PageLayoutConfig,
  PageLayoutType,
  PageStatus,
  Panel,
  PanelAction,
  PanelComposition,
  PanelDialogue,
  PanelDialoguePosition,
  PanelDialogueType,
  PanelEntity,
  PanelEntityRole,
  PanelExpression,
  PanelPosition,
  PanelRole,
  PanelSize,
  UpdatePageInput,
  UpdatePanelInput,
} from '../domain/types/page.js';
import { ValidationError } from '../domain/errors/index.js';
import type { DatabaseClient } from '../lib/db.js';
import { isUniqueViolation } from '../lib/dbErrors.js';

export type {
  CreatePageInput,
  CreatePanelInput,
  Page,
  Panel,
  UpdatePageInput,
  UpdatePanelInput,
};

export interface PageContext {
  episodeId: string;
  workId: string;
}

export interface PageSceneContext {
  sceneId: string;
  episodeId: string;
  workId: string;
}

export interface PanelContext {
  panelId: string;
  pageId: string;
  episodeId: string;
  workId: string;
}

export interface PanelEntityStateReference {
  entityId: string;
  stateId: string;
}

export interface PageRepository {
  findEpisodeContextByIdAndUserId(episodeId: string, userId: string): Promise<PageContext | null>;
  findSceneContextByIdAndUserId(sceneId: string, userId: string): Promise<PageSceneContext | null>;
  findPageContextByIdAndUserId(pageId: string, userId: string): Promise<PageContext | null>;
  findPanelContextByIdAndUserId(panelId: string, userId: string): Promise<PanelContext | null>;
  createPage(episodeId: string, input: CreatePageInput): Promise<Page>;
  findPagesByEpisodeIdAndUserId(episodeId: string, userId: string): Promise<Page[]>;
  findPageByIdAndUserId(pageId: string, userId: string): Promise<Page | null>;
  updatePage(pageId: string, userId: string, input: UpdatePageInput): Promise<Page | null>;
  deletePage(pageId: string, userId: string): Promise<boolean>;
  createPanel(pageId: string, input: CreatePanelInput): Promise<Panel>;
  findPanelsByPageIdAndUserId(pageId: string, userId: string): Promise<Panel[]>;
  updatePanel(panelId: string, userId: string, input: UpdatePanelInput): Promise<Panel | null>;
  deletePanel(panelId: string, userId: string): Promise<boolean>;
  countEntityStatesByReferencesAndWorkIdAndUserId(
    references: PanelEntityStateReference[],
    workId: string,
    userId: string,
  ): Promise<number>;
}

interface IdRow extends QueryResultRow {
  id: string;
}

interface CountRow extends QueryResultRow {
  count: number;
}

interface EpisodeContextRow extends QueryResultRow {
  episode_id: string;
  work_id: string;
}

interface SceneContextRow extends QueryResultRow {
  scene_id: string;
  episode_id: string;
  work_id: string;
}

interface PanelContextRow extends QueryResultRow {
  panel_id: string;
  page_id: string;
  episode_id: string;
  work_id: string;
}

interface PageRow extends QueryResultRow {
  id: string;
  episode_id: string;
  scene_id: string | null;
  page_number: number;
  layout_config: unknown;
  dialogue_mode: PageDialogueMode;
  page_dialogue_toggle: boolean;
  generated_image: unknown;
  generation_mode: PageGenerationMode | null;
  panel_ids: string[];
  status: PageStatus;
  created_at: Date;
  updated_at: Date;
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

const pageSelectColumns = `
  pages.id,
  pages.episode_id,
  pages.scene_id,
  pages.page_number,
  pages.layout_config,
  pages.dialogue_mode,
  pages.page_dialogue_toggle,
  pages.generated_image,
  pages.generation_mode,
  COALESCE(
    (
      SELECT array_agg(panels.id ORDER BY panels."order" ASC)
      FROM panels
      WHERE panels.page_id = pages.id
    ),
    ARRAY[]::uuid[]
  ) AS panel_ids,
  pages.status,
  pages.created_at,
  pages.updated_at
`;

export class PostgresPageRepository implements PageRepository {
  public constructor(private readonly client: DatabaseClient) {}

  public async findEpisodeContextByIdAndUserId(episodeId: string, userId: string): Promise<PageContext | null> {
    const result = await this.client.query<EpisodeContextRow>(
      `
      SELECT episodes.id AS episode_id,
             chapters.work_id
      FROM episodes
      INNER JOIN chapters ON chapters.id = episodes.chapter_id
      INNER JOIN works ON works.id = chapters.work_id
      WHERE episodes.id = $1
        AND works.user_id = $2
      `,
      [episodeId, userId],
    );

    const row = result.rows[0];
    return row === undefined ? null : { episodeId: row.episode_id, workId: row.work_id };
  }

  public async findSceneContextByIdAndUserId(sceneId: string, userId: string): Promise<PageSceneContext | null> {
    const result = await this.client.query<SceneContextRow>(
      `
      SELECT scenes.id AS scene_id,
             scenes.episode_id,
             chapters.work_id
      FROM scenes
      INNER JOIN episodes ON episodes.id = scenes.episode_id
      INNER JOIN chapters ON chapters.id = episodes.chapter_id
      INNER JOIN works ON works.id = chapters.work_id
      WHERE scenes.id = $1
        AND works.user_id = $2
      `,
      [sceneId, userId],
    );

    const row = result.rows[0];
    return row === undefined
      ? null
      : { sceneId: row.scene_id, episodeId: row.episode_id, workId: row.work_id };
  }

  public async findPageContextByIdAndUserId(pageId: string, userId: string): Promise<PageContext | null> {
    const result = await this.client.query<EpisodeContextRow>(
      `
      SELECT pages.episode_id,
             chapters.work_id
      FROM pages
      INNER JOIN episodes ON episodes.id = pages.episode_id
      INNER JOIN chapters ON chapters.id = episodes.chapter_id
      INNER JOIN works ON works.id = chapters.work_id
      WHERE pages.id = $1
        AND works.user_id = $2
      `,
      [pageId, userId],
    );

    const row = result.rows[0];
    return row === undefined ? null : { episodeId: row.episode_id, workId: row.work_id };
  }

  public async findPanelContextByIdAndUserId(panelId: string, userId: string): Promise<PanelContext | null> {
    const result = await this.client.query<PanelContextRow>(
      `
      SELECT panels.id AS panel_id,
             panels.page_id,
             pages.episode_id,
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
    return row === undefined
      ? null
      : {
          panelId: row.panel_id,
          pageId: row.page_id,
          episodeId: row.episode_id,
          workId: row.work_id,
        };
  }

  public async createPage(episodeId: string, input: CreatePageInput): Promise<Page> {
    try {
      const result = await this.client.query<PageRow>(
        `
        INSERT INTO pages (
          episode_id,
          scene_id,
          page_number,
          layout_config,
          dialogue_mode,
          page_dialogue_toggle
        )
        VALUES ($1, $2, $3, $4::jsonb, $5, $6)
        RETURNING *,
                  ARRAY[]::uuid[] AS panel_ids
        `,
        [
          episodeId,
          input.sceneId,
          input.pageNumber,
          JSON.stringify(toPageLayoutConfigJson(input.layoutConfig)),
          input.dialogueMode,
          input.pageDialogueToggle,
        ],
      );

      return mapPageRow(result.rows[0]);
    } catch (error) {
      throw mapUniqueViolation(error, 'Page number must be unique within the episode');
    }
  }

  public async findPagesByEpisodeIdAndUserId(episodeId: string, userId: string): Promise<Page[]> {
    const result = await this.client.query<PageRow>(
      `
      SELECT ${pageSelectColumns}
      FROM pages
      INNER JOIN episodes ON episodes.id = pages.episode_id
      INNER JOIN chapters ON chapters.id = episodes.chapter_id
      INNER JOIN works ON works.id = chapters.work_id
      WHERE pages.episode_id = $1
        AND works.user_id = $2
      ORDER BY pages.page_number ASC
      `,
      [episodeId, userId],
    );

    return result.rows.map(mapPageRow);
  }

  public async findPageByIdAndUserId(pageId: string, userId: string): Promise<Page | null> {
    const result = await this.client.query<PageRow>(
      `
      SELECT ${pageSelectColumns}
      FROM pages
      INNER JOIN episodes ON episodes.id = pages.episode_id
      INNER JOIN chapters ON chapters.id = episodes.chapter_id
      INNER JOIN works ON works.id = chapters.work_id
      WHERE pages.id = $1
        AND works.user_id = $2
      `,
      [pageId, userId],
    );

    return result.rows[0] === undefined ? null : mapPageRow(result.rows[0]);
  }

  public async updatePage(pageId: string, userId: string, input: UpdatePageInput): Promise<Page | null> {
    try {
      const result = await this.client.query<IdRow>(
        `
        UPDATE pages
        SET scene_id = CASE WHEN $3::boolean THEN $4 ELSE pages.scene_id END,
            page_number = COALESCE($5, pages.page_number),
            layout_config = CASE WHEN $6::boolean THEN $7::jsonb ELSE pages.layout_config END,
            dialogue_mode = COALESCE($8, pages.dialogue_mode),
            page_dialogue_toggle = COALESCE($9, pages.page_dialogue_toggle),
            status = COALESCE($10, pages.status),
            updated_at = NOW()
        FROM episodes
        INNER JOIN chapters ON chapters.id = episodes.chapter_id
        INNER JOIN works ON works.id = chapters.work_id
        WHERE pages.id = $1
          AND pages.episode_id = episodes.id
          AND works.user_id = $2
        RETURNING pages.id
        `,
        [
          pageId,
          userId,
          input.sceneId !== undefined,
          input.sceneId ?? null,
          input.pageNumber ?? null,
          input.layoutConfig !== undefined,
          JSON.stringify(toPageLayoutConfigJson(input.layoutConfig ?? defaultPersistedLayoutConfig())),
          input.dialogueMode ?? null,
          input.pageDialogueToggle ?? null,
          input.status ?? null,
        ],
      );

      if (result.rows[0] === undefined) {
        return null;
      }

      return this.findPageByIdAndUserId(result.rows[0].id, userId);
    } catch (error) {
      throw mapUniqueViolation(error, 'Page number must be unique within the episode');
    }
  }

  public async deletePage(pageId: string, userId: string): Promise<boolean> {
    const result = await this.client.query(
      `
      DELETE FROM pages
      USING episodes, chapters, works
      WHERE pages.id = $1
        AND pages.episode_id = episodes.id
        AND episodes.chapter_id = chapters.id
        AND chapters.work_id = works.id
        AND works.user_id = $2
      `,
      [pageId, userId],
    );

    return (result.rowCount ?? 0) > 0;
  }

  public async createPanel(pageId: string, input: CreatePanelInput): Promise<Panel> {
    try {
      const result = await this.client.query<PanelRow>(
        `
        INSERT INTO panels (
          page_id,
          "order",
          panel_role,
          panel_size,
          situation_text,
          entities,
          composition,
          dialogue_in_panel,
          dialogue,
          sfx_text,
          background_note,
          panel_notes
        )
        VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9::jsonb, $10, $11, $12)
        RETURNING *
        `,
        [
          pageId,
          input.order,
          input.panelRole,
          input.panelSize,
          input.situationText,
          JSON.stringify(input.entities.map(toPanelEntityJson)),
          JSON.stringify(toPanelCompositionJson(input.composition)),
          input.dialogueInPanel,
          JSON.stringify(input.dialogue.map(toPanelDialogueJson)),
          input.sfxText,
          input.backgroundNote,
          input.panelNotes,
        ],
      );

      return mapPanelRow(result.rows[0]);
    } catch (error) {
      throw mapUniqueViolation(error, 'Panel order must be unique within the page');
    }
  }

  public async findPanelsByPageIdAndUserId(pageId: string, userId: string): Promise<Panel[]> {
    const result = await this.client.query<PanelRow>(
      `
      SELECT panels.*
      FROM panels
      INNER JOIN pages ON pages.id = panels.page_id
      INNER JOIN episodes ON episodes.id = pages.episode_id
      INNER JOIN chapters ON chapters.id = episodes.chapter_id
      INNER JOIN works ON works.id = chapters.work_id
      WHERE panels.page_id = $1
        AND works.user_id = $2
      ORDER BY panels."order" ASC
      `,
      [pageId, userId],
    );

    return result.rows.map(mapPanelRow);
  }

  public async updatePanel(panelId: string, userId: string, input: UpdatePanelInput): Promise<Panel | null> {
    try {
      const result = await this.client.query<PanelRow>(
        `
        UPDATE panels
        SET "order" = COALESCE($3, panels."order"),
            panel_role = COALESCE($4, panels.panel_role),
            panel_size = COALESCE($5, panels.panel_size),
            situation_text = CASE WHEN $6::boolean THEN $7 ELSE panels.situation_text END,
            entities = CASE WHEN $8::boolean THEN $9::jsonb ELSE panels.entities END,
            composition = CASE WHEN $10::boolean THEN $11::jsonb ELSE panels.composition END,
            dialogue_in_panel = COALESCE($12, panels.dialogue_in_panel),
            dialogue = CASE WHEN $13::boolean THEN $14::jsonb ELSE panels.dialogue END,
            sfx_text = CASE WHEN $15::boolean THEN $16 ELSE panels.sfx_text END,
            background_note = CASE WHEN $17::boolean THEN $18 ELSE panels.background_note END,
            panel_notes = CASE WHEN $19::boolean THEN $20 ELSE panels.panel_notes END,
            updated_at = NOW()
        FROM pages
        INNER JOIN episodes ON episodes.id = pages.episode_id
        INNER JOIN chapters ON chapters.id = episodes.chapter_id
        INNER JOIN works ON works.id = chapters.work_id
        WHERE panels.id = $1
          AND panels.page_id = pages.id
          AND works.user_id = $2
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
          input.entities !== undefined,
          JSON.stringify((input.entities ?? []).map(toPanelEntityJson)),
          input.composition !== undefined,
          JSON.stringify(toPanelCompositionJson(input.composition ?? defaultPanelComposition())),
          input.dialogueInPanel ?? null,
          input.dialogue !== undefined,
          JSON.stringify((input.dialogue ?? []).map(toPanelDialogueJson)),
          input.sfxText !== undefined,
          input.sfxText ?? null,
          input.backgroundNote !== undefined,
          input.backgroundNote ?? null,
          input.panelNotes !== undefined,
          input.panelNotes ?? null,
        ],
      );

      return result.rows[0] === undefined ? null : mapPanelRow(result.rows[0]);
    } catch (error) {
      throw mapUniqueViolation(error, 'Panel order must be unique within the page');
    }
  }

  public async deletePanel(panelId: string, userId: string): Promise<boolean> {
    const result = await this.client.query(
      `
      DELETE FROM panels
      USING pages, episodes, chapters, works
      WHERE panels.id = $1
        AND panels.page_id = pages.id
        AND pages.episode_id = episodes.id
        AND episodes.chapter_id = chapters.id
        AND chapters.work_id = works.id
        AND works.user_id = $2
      `,
      [panelId, userId],
    );

    return (result.rowCount ?? 0) > 0;
  }

  public async countEntityStatesByReferencesAndWorkIdAndUserId(
    references: PanelEntityStateReference[],
    workId: string,
    userId: string,
  ): Promise<number> {
    if (references.length === 0) {
      return 0;
    }

    const result = await this.client.query<CountRow>(
      `
      SELECT COUNT(DISTINCT entity_states.id)::int AS count
      FROM entity_states
      INNER JOIN entities ON entities.id = entity_states.entity_id
      INNER JOIN jsonb_to_recordset($1::jsonb) AS refs(entity_id uuid, state_id uuid)
        ON refs.entity_id = entity_states.entity_id
       AND refs.state_id = entity_states.id
      WHERE entities.work_id = $2
        AND entities.user_id = $3
      `,
      [
        JSON.stringify(
          references.map((reference) => ({
            entity_id: reference.entityId,
            state_id: reference.stateId,
          })),
        ),
        workId,
        userId,
      ],
    );

    return result.rows[0]?.count ?? 0;
  }
}

function mapPageRow(row: PageRow): Page {
  return {
    id: row.id,
    episodeId: row.episode_id,
    sceneId: row.scene_id,
    pageNumber: row.page_number,
    layoutConfig: toPageLayoutConfig(row.layout_config),
    dialogueMode: row.dialogue_mode,
    pageDialogueToggle: row.page_dialogue_toggle,
    generatedImage: toGeneratedImage(row.generated_image),
    generationMode: row.generation_mode,
    panelIds: row.panel_ids,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapPanelRow(row: PanelRow): Panel {
  return {
    id: row.id,
    pageId: row.page_id,
    order: row.order,
    panelRole: row.panel_role,
    panelSize: row.panel_size,
    situationText: row.situation_text,
    entities: toPanelEntities(row.entities),
    composition: toPanelComposition(row.composition),
    dialogueInPanel: row.dialogue_in_panel,
    dialogue: toPanelDialogue(row.dialogue),
    sfxText: row.sfx_text,
    backgroundNote: row.background_note,
    panelNotes: row.panel_notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toPageLayoutConfig(value: unknown): PageLayoutConfig {
  if (!isJsonObject(value)) {
    return defaultPersistedLayoutConfig();
  }

  return {
    type: toLayoutType(value.type),
    templateId: toNullableLayoutTemplateId(value.template_id),
    panelCount: toPositiveInteger(value.panel_count, 4),
    layoutReferenceS3Key: toNullableString(value.layout_reference_s3_key),
    frameDefinitions: toObjectArray(value.frame_definitions),
  };
}

function toGeneratedImage(value: unknown): GeneratedImage | null {
  if (!isJsonObject(value)) {
    return null;
  }

  return {
    s3Key: toNullableString(value.s3_key),
    cdnUrl: toNullableString(value.cdn_url),
    generationMode: toGenerationModeOrNull(value.generation_mode),
    generatedAt: toNullableString(value.generated_at),
  };
}

function toPanelEntities(value: unknown): PanelEntity[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (!isJsonObject(entry) || typeof entry.entity_id !== 'string') {
      return [];
    }

    return [
      {
        entityId: entry.entity_id,
        role: toPanelEntityRole(entry.role),
        expression: toPanelExpression(entry.expression),
        customExpression: toNullableString(entry.custom_expression),
        action: toPanelAction(entry.action),
        customAction: toNullableString(entry.custom_action),
        position: toPanelPosition(entry.position),
        stateId: toNullableString(entry.state_id),
      },
    ];
  });
}

function toPanelComposition(value: unknown): PanelComposition {
  if (!isJsonObject(value)) {
    return defaultPanelComposition();
  }

  return {
    source: toCompositionSource(value.source),
    galleryItemId: toNullableString(value.gallery_item_id),
    compositionPrompt: toNullableString(value.composition_prompt),
    shotType: toNullableString(value.shot_type),
    angle: toNullableString(value.angle),
    customNote: toNullableString(value.custom_note),
  };
}

function toPanelDialogue(value: unknown): PanelDialogue[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (!isJsonObject(entry) || typeof entry.entity_id !== 'string' || typeof entry.text !== 'string') {
      return [];
    }

    return [
      {
        entityId: entry.entity_id,
        text: entry.text,
        type: toPanelDialogueType(entry.type),
        position: toPanelDialoguePosition(entry.position),
      },
    ];
  });
}

function toPageLayoutConfigJson(layoutConfig: PageLayoutConfig): Record<string, unknown> {
  return {
    type: layoutConfig.type,
    template_id: layoutConfig.templateId,
    panel_count: layoutConfig.panelCount,
    layout_reference_s3_key: layoutConfig.layoutReferenceS3Key,
    frame_definitions: layoutConfig.frameDefinitions,
  };
}

function toPanelEntityJson(entity: PanelEntity): Record<string, unknown> {
  return {
    entity_id: entity.entityId,
    role: entity.role,
    expression: entity.expression,
    custom_expression: entity.customExpression,
    action: entity.action,
    custom_action: entity.customAction,
    position: entity.position,
    state_id: entity.stateId,
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

function toPanelDialogueJson(dialogue: PanelDialogue): Record<string, unknown> {
  return {
    entity_id: dialogue.entityId,
    text: dialogue.text,
    type: dialogue.type,
    position: dialogue.position,
  };
}

function defaultPersistedLayoutConfig(): PageLayoutConfig {
  return {
    type: 'template',
    templateId: 'standard_4',
    panelCount: 4,
    layoutReferenceS3Key: null,
    frameDefinitions: [],
  };
}

function defaultPanelComposition(): PanelComposition {
  return {
    source: 'ai_auto',
    galleryItemId: null,
    compositionPrompt: null,
    shotType: null,
    angle: null,
    customNote: null,
  };
}

function toObjectArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(isJsonObject);
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toNullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function toPositiveInteger(value: unknown, fallback: number): number {
  return Number.isInteger(value) && typeof value === 'number' && value > 0 ? value : fallback;
}

function toLayoutType(value: unknown): PageLayoutType {
  return value === 'custom' || value === 'ai_generated' || value === 'template' ? value : 'template';
}

function toNullableLayoutTemplateId(value: unknown): LayoutTemplateId | null {
  switch (value) {
    case 'standard_4':
    case 'top_wide_3':
    case 'standard_6':
    case 'dense_8':
    case 'climax_2':
    case 'splash_1':
    case 'action_5':
    case 'battle_7':
      return value;
    default:
      return null;
  }
}

function toGenerationModeOrNull(value: unknown): PageGenerationMode | null {
  return value === 'standard' || value === 'thinking' ? value : null;
}

function toPanelEntityRole(value: unknown): PanelEntityRole {
  return value === 'secondary' || value === 'background' || value === 'primary' ? value : 'primary';
}

function toPanelExpression(value: unknown): PanelExpression {
  switch (value) {
    case 'calm':
    case 'angry':
    case 'sad':
    case 'surprised':
    case 'custom':
    case 'determined':
      return value;
    default:
      return 'determined';
  }
}

function toPanelAction(value: unknown): PanelAction {
  switch (value) {
    case 'attacking':
    case 'defending':
    case 'running':
    case 'custom':
    case 'standing_firm':
      return value;
    default:
      return 'standing_firm';
  }
}

function toPanelPosition(value: unknown): PanelPosition {
  return value === 'left' || value === 'right' || value === 'background' || value === 'center' ? value : 'center';
}

function toCompositionSource(value: unknown): PanelComposition['source'] {
  return value === 'gallery' || value === 'custom' || value === 'ai_auto' ? value : 'ai_auto';
}

function toPanelDialogueType(value: unknown): PanelDialogueType {
  switch (value) {
    case 'thought':
    case 'narration':
    case 'shout':
    case 'whisper':
    case 'sfx':
    case 'speech':
      return value;
    default:
      return 'speech';
  }
}

function toPanelDialoguePosition(value: unknown): PanelDialoguePosition {
  switch (value) {
    case 'top':
    case 'left':
    case 'right':
    case 'center':
    case 'bottom':
      return value;
    default:
      return 'bottom';
  }
}

function mapUniqueViolation(error: unknown, message: string): Error {
  if (isUniqueViolation(error)) {
    return new ValidationError(message);
  }

  if (error instanceof Error) {
    return error;
  }

  return new Error('Unexpected database error');
}
