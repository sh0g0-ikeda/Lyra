import type { QueryResultRow } from 'pg';
import type {
  GeneratedPageImage,
  PageGenerationContext,
  PageGenerationPanelContext,
  PageGenerationStateUpdate,
  PagePromptContext,
  PageDialogueMode,
  PageSummary,
  PageStatus,
} from '../domain/types/page.js';
import type { PageGenerationMode } from '../domain/types/pageGeneration.js';
import type { DatabaseClient } from '../lib/db.js';
import type { PanelEntityAssignment } from '../domain/types/panelEntityAssignment.js';

export type { PageGenerationContext, PageGenerationStateUpdate };

export interface PageRepository {
  findPagesByEpisodeIdAndUserId(episodeId: string, userId: string): Promise<PageSummary[]>;
  findGenerationContextByIdAndUserId(pageId: string, userId: string): Promise<PageGenerationContext | null>;
  findPromptContextByIdAndUserId(pageId: string, userId: string): Promise<PagePromptContext | null>;
  updateGenerationState(
    pageId: string,
    userId: string,
    input: PageGenerationStateUpdate,
  ): Promise<boolean>;
  updateGeneratedImageAndState(
    pageId: string,
    userId: string,
    input: {
      status: PageStatus;
      generationMode: PageGenerationMode | null;
      generatedImage: GeneratedPageImage;
    },
  ): Promise<boolean>;
}

interface GenerationContextRow extends QueryResultRow {
  page_id: string;
  work_id: string;
  layout_config: unknown;
  generated_image: unknown;
  generation_mode: string | null;
  status: PageStatus;
  panel_entities: unknown;
}

interface PromptContextRow extends QueryResultRow {
  page_id: string;
  work_id: string;
  page_number: number;
  episode_purpose: string | null;
  scene_summaries: unknown;
  layout_config: unknown;
  dialogue_mode: string;
  page_dialogue_toggle: boolean;
}

interface PageSummaryRow extends QueryResultRow {
  id: string;
  episode_id: string;
  page_number: number;
  layout_config: unknown;
  dialogue_mode: string;
  generation_mode: string | null;
  generated_image: unknown;
  status: PageStatus;
  created_at: Date;
  updated_at: Date;
}

interface UpdateRow extends QueryResultRow {
  id: string;
}

export class PostgresPageRepository implements PageRepository {
  public constructor(private readonly client: DatabaseClient) {}

  public async findPagesByEpisodeIdAndUserId(
    episodeId: string,
    userId: string,
  ): Promise<PageSummary[]> {
    const result = await this.client.query<PageSummaryRow>(
      `
      SELECT pages.id,
             pages.episode_id,
             pages.page_number,
             pages.layout_config,
             pages.dialogue_mode,
             pages.generation_mode,
             pages.generated_image,
             pages.status,
             pages.created_at,
             pages.updated_at
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

    return result.rows.map((row) => ({
      id: row.id,
      episodeId: row.episode_id,
      pageNumber: row.page_number,
      layoutConfig: toJsonObject(row.layout_config),
      dialogueMode: toPageDialogueMode(row.dialogue_mode),
      generationMode: toPageGenerationMode(row.generation_mode),
      generatedImage: toGeneratedPageImage(row.generated_image),
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  public async findGenerationContextByIdAndUserId(
    pageId: string,
    userId: string,
  ): Promise<PageGenerationContext | null> {
    const result = await this.client.query<GenerationContextRow>(
      `
      SELECT pages.id AS page_id,
             chapters.work_id,
             pages.layout_config,
             pages.generated_image,
             pages.generation_mode,
             pages.status,
             COALESCE(
               jsonb_agg(
                 jsonb_build_object(
                   'panel_id', panels.id,
                   'entities', COALESCE(panels.entities, '[]'::jsonb)
                 )
                 ORDER BY panels."order"
               ) FILTER (WHERE panels.id IS NOT NULL),
               '[]'::jsonb
             ) AS panel_entities
      FROM pages
      INNER JOIN episodes ON episodes.id = pages.episode_id
      INNER JOIN chapters ON chapters.id = episodes.chapter_id
      INNER JOIN works ON works.id = chapters.work_id
      LEFT JOIN panels ON panels.page_id = pages.id
      WHERE pages.id = $1
        AND works.user_id = $2
      GROUP BY pages.id, chapters.work_id, pages.layout_config, pages.generated_image, pages.generation_mode, pages.status
      `,
      [pageId, userId],
    );

    const row = result.rows[0];
    return row === undefined
      ? null
      : {
          pageId: row.page_id,
          workId: row.work_id,
          layoutConfig: toJsonObject(row.layout_config),
          generatedImage: toGeneratedPageImage(row.generated_image),
          generationMode: toPageGenerationMode(row.generation_mode),
          status: row.status,
          panels: toPageGenerationPanels(row.panel_entities),
        };
  }

  public async findPromptContextByIdAndUserId(
    pageId: string,
    userId: string,
  ): Promise<PagePromptContext | null> {
    const result = await this.client.query<PromptContextRow>(
      `
      SELECT pages.id AS page_id,
             chapters.work_id,
             pages.page_number,
             episodes.purpose AS episode_purpose,
             (
               SELECT COALESCE(
                 jsonb_agg(
                   trim(
                     both ' '
                     FROM concat(
                       'Scene ',
                       scenes."order",
                       ': ',
                       COALESCE(scenes.location, 'unknown location'),
                       CASE
                         WHEN scenes."time" IS NULL THEN ''
                         ELSE concat(' / ', scenes."time")
                       END,
                       CASE
                         WHEN scenes.atmosphere IS NULL THEN ''
                         ELSE concat(' / ', scenes.atmosphere)
                       END
                     )
                   )
                   ORDER BY scenes."order" ASC
                 ),
                 '[]'::jsonb
               )
               FROM scenes
               WHERE scenes.episode_id = episodes.id
             ) AS scene_summaries,
             pages.layout_config,
             pages.dialogue_mode,
             pages.page_dialogue_toggle
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
    return row === undefined
      ? null
      : {
          pageId: row.page_id,
          workId: row.work_id,
          pageNumber: row.page_number,
          episodePurpose: row.episode_purpose,
          sceneSummaries: toStringArray(row.scene_summaries),
          layoutConfig: toJsonObject(row.layout_config),
          dialogueMode: toPageDialogueMode(row.dialogue_mode),
          pageDialogueToggle: row.page_dialogue_toggle,
        };
  }

  public async updateGenerationState(
    pageId: string,
    userId: string,
    input: PageGenerationStateUpdate,
  ): Promise<boolean> {
    const result = await this.client.query<UpdateRow>(
      `
      UPDATE pages
      SET status = $3,
          generation_mode = $4,
          updated_at = NOW()
      FROM episodes
      INNER JOIN chapters ON chapters.id = episodes.chapter_id
      INNER JOIN works ON works.id = chapters.work_id
      WHERE pages.id = $1
        AND pages.episode_id = episodes.id
        AND works.user_id = $2
      RETURNING pages.id
      `,
      [pageId, userId, input.status, input.generationMode],
    );

    return (result.rowCount ?? 0) > 0;
  }

  public async updateGeneratedImageAndState(
    pageId: string,
    userId: string,
    input: {
      status: PageStatus;
      generationMode: PageGenerationMode | null;
      generatedImage: GeneratedPageImage;
    },
  ): Promise<boolean> {
    const result = await this.client.query<UpdateRow>(
      `
      UPDATE pages
      SET status = $3,
          generation_mode = $4,
          generated_image = jsonb_build_object(
            's3_key', $5,
            'cdn_url', $6,
            'generation_mode', $7,
            'generated_at', $8
          ),
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
        input.status,
        input.generationMode,
        input.generatedImage.s3Key,
        input.generatedImage.cdnUrl,
        input.generatedImage.generationMode,
        input.generatedImage.generatedAt,
      ],
    );

    return (result.rowCount ?? 0) > 0;
  }
}

function toGeneratedPageImage(value: unknown): GeneratedPageImage | null {
  if (!isJsonObject(value)) {
    return null;
  }

  const s3Key = value.s3_key;
  const cdnUrl = value.cdn_url;
  const generationMode = value.generation_mode;
  const generatedAt = value.generated_at;

  if (
    !isNullableString(s3Key) ||
    !isNullableString(cdnUrl) ||
    !(generationMode === null || generationMode === 'standard' || generationMode === 'thinking') ||
    !isNullableString(generatedAt)
  ) {
    return null;
  }

  return {
    s3Key,
    cdnUrl,
    generationMode,
    generatedAt,
  };
}

function toPageGenerationPanels(value: unknown): PageGenerationPanelContext[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (!isJsonObject(entry) || typeof entry.panel_id !== 'string') {
      return [];
    }

    return [
      {
        panelId: entry.panel_id,
        entities: toPanelEntityAssignments(entry.entities),
      },
    ];
  });
}

function toPanelEntityAssignments(value: unknown): PanelEntityAssignment[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (!isJsonObject(entry)) {
      return [];
    }

    if (
      typeof entry.entity_id !== 'string' ||
      !isPanelEntityRole(entry.role) ||
      !isPanelEntityExpression(entry.expression) ||
      !isNullableString(entry.custom_expression) ||
      !isPanelEntityAction(entry.action) ||
      !isNullableString(entry.custom_action) ||
      !isPanelEntityPosition(entry.position) ||
      !isNullableString(entry.state_id)
    ) {
      return [];
    }

    return [
      {
        entityId: entry.entity_id,
        role: entry.role,
        expression: entry.expression,
        customExpression: entry.custom_expression,
        action: entry.action,
        customAction: entry.custom_action,
        position: entry.position,
        stateId: entry.state_id,
      },
    ];
  });
}

function toJsonObject(value: unknown): Record<string, unknown> {
  return isJsonObject(value) ? value : {};
}

function toPageGenerationMode(value: string | null): PageGenerationMode | null {
  return value === 'standard' || value === 'thinking' ? value : null;
}

function toPageDialogueMode(value: string): PageDialogueMode {
  return value === 'balloon_only' || value === 'mixed' ? value : 'image_baked';
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0);
}

function isPanelEntityRole(value: unknown): value is PanelEntityAssignment['role'] {
  return value === 'primary' || value === 'secondary' || value === 'background';
}

function isPanelEntityExpression(value: unknown): value is PanelEntityAssignment['expression'] {
  return (
    value === 'determined' ||
    value === 'calm' ||
    value === 'angry' ||
    value === 'sad' ||
    value === 'surprised' ||
    value === 'custom'
  );
}

function isPanelEntityAction(value: unknown): value is PanelEntityAssignment['action'] {
  return (
    value === 'standing_firm' ||
    value === 'attacking' ||
    value === 'defending' ||
    value === 'running' ||
    value === 'custom'
  );
}

function isPanelEntityPosition(value: unknown): value is PanelEntityAssignment['position'] {
  return value === 'left' || value === 'center' || value === 'right' || value === 'background';
}

function isNullableString(value: unknown): value is string | null {
  return typeof value === 'string' || value === null;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
