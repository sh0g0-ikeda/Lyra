import type { QueryResultRow } from 'pg';
import type {
  PageLayoutFrameUpdate,
  PanelFrame,
  PanelFrameBorderStyle,
  PanelFrameVertex,
  UpsertPanelFrameInput,
} from '../domain/types/panelFrame.js';
import { ValidationError } from '../domain/errors/index.js';
import type { DatabaseClient, TransactionRunner } from '../lib/db.js';

export type { PanelFrame, UpsertPanelFrameInput };

export interface PageFrameContext {
  pageId: string;
  workId: string;
}

export interface PanelFrameRepository {
  findPageContextByIdAndUserId(pageId: string, userId: string): Promise<PageFrameContext | null>;
  findPanelIdsByPageIdAndUserId(
    pageId: string,
    userId: string,
    panelIds: string[],
  ): Promise<string[]>;
  findFramesByPageIdAndUserId(pageId: string, userId: string): Promise<PanelFrame[]>;
  replaceFramesByPageIdAndUserId(
    pageId: string,
    userId: string,
    frames: UpsertPanelFrameInput[],
    layoutUpdate?: PageLayoutFrameUpdate,
  ): Promise<PanelFrame[]>;
}

interface PageFrameContextRow extends QueryResultRow {
  page_id: string;
  work_id: string;
}

interface PanelIdRow extends QueryResultRow {
  id: string;
}

interface PanelFrameRow extends QueryResultRow {
  id: string;
  page_id: string;
  panel_id: string | null;
  vertices: unknown;
  border_style: string;
  border_width: number;
  border_color: string;
  z_index: number;
  reading_order: number;
}

export class PostgresPanelFrameRepository implements PanelFrameRepository {
  public constructor(private readonly client: DatabaseClient & TransactionRunner) {}

  public async findPageContextByIdAndUserId(
    pageId: string,
    userId: string,
  ): Promise<PageFrameContext | null> {
    const result = await this.client.query<PageFrameContextRow>(
      `
      SELECT pages.id AS page_id,
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
    return row === undefined ? null : { pageId: row.page_id, workId: row.work_id };
  }

  public async findPanelIdsByPageIdAndUserId(
    pageId: string,
    userId: string,
    panelIds: string[],
  ): Promise<string[]> {
    if (panelIds.length === 0) {
      return [];
    }

    const result = await this.client.query<PanelIdRow>(
      `
      SELECT panels.id
      FROM panels
      INNER JOIN pages ON pages.id = panels.page_id
      INNER JOIN episodes ON episodes.id = pages.episode_id
      INNER JOIN chapters ON chapters.id = episodes.chapter_id
      INNER JOIN works ON works.id = chapters.work_id
      WHERE panels.page_id = $1
        AND works.user_id = $2
        AND panels.id = ANY($3::uuid[])
      `,
      [pageId, userId, panelIds],
    );

    return result.rows.map((row) => row.id);
  }

  public async findFramesByPageIdAndUserId(pageId: string, userId: string): Promise<PanelFrame[]> {
    const result = await this.client.query<PanelFrameRow>(
      `
      SELECT panel_frames.id,
             panel_frames.page_id,
             panel_frames.panel_id,
             panel_frames.vertices,
             panel_frames.border_style,
             panel_frames.border_width,
             panel_frames.border_color,
             panel_frames.z_index,
             panel_frames.reading_order
      FROM panel_frames
      INNER JOIN pages ON pages.id = panel_frames.page_id
      INNER JOIN episodes ON episodes.id = pages.episode_id
      INNER JOIN chapters ON chapters.id = episodes.chapter_id
      INNER JOIN works ON works.id = chapters.work_id
      WHERE panel_frames.page_id = $1
        AND works.user_id = $2
      ORDER BY panel_frames.reading_order ASC
      `,
      [pageId, userId],
    );

    return result.rows.map(mapPanelFrameRow);
  }

  public async replaceFramesByPageIdAndUserId(
    pageId: string,
    userId: string,
    frames: UpsertPanelFrameInput[],
    layoutUpdate?: PageLayoutFrameUpdate,
  ): Promise<PanelFrame[]> {
    return this.client.transaction(async (transactionClient) => {
      await transactionClient.query(
        `
        DELETE FROM panel_frames
        USING pages
        INNER JOIN episodes ON episodes.id = pages.episode_id
        INNER JOIN chapters ON chapters.id = episodes.chapter_id
        INNER JOIN works ON works.id = chapters.work_id
        WHERE panel_frames.page_id = $1
          AND panel_frames.page_id = pages.id
          AND works.user_id = $2
        `,
        [pageId, userId],
      );

      const savedFrames: PanelFrame[] = [];
      for (const frame of frames) {
        const result = await transactionClient.query<PanelFrameRow>(
          `
          INSERT INTO panel_frames (
            id,
            page_id,
            panel_id,
            vertices,
            border_style,
            border_width,
            border_color,
            z_index,
            reading_order
          )
          SELECT
            COALESCE($1::uuid, gen_random_uuid()),
            pages.id,
            $3::uuid,
            $4::jsonb,
            $5,
            $6,
            $7,
            $8,
            $9
          FROM pages
          INNER JOIN episodes ON episodes.id = pages.episode_id
          INNER JOIN chapters ON chapters.id = episodes.chapter_id
          INNER JOIN works ON works.id = chapters.work_id
          WHERE pages.id = $2
            AND works.user_id = $10
            AND (
              $3::uuid IS NULL
              OR EXISTS (
                SELECT 1
                FROM panels
                WHERE panels.id = $3::uuid
                  AND panels.page_id = pages.id
              )
            )
          RETURNING *
          `,
          [
            frame.id ?? null,
            pageId,
            frame.panelId,
            JSON.stringify(frame.vertices),
            frame.borderStyle,
            frame.borderWidth,
            frame.borderColor,
            frame.zIndex,
            frame.readingOrder,
            userId,
          ],
        );

        const savedFrame = result.rows[0];
        if (savedFrame === undefined) {
          throw new ValidationError('PanelFrame references must belong to the page');
        }

        savedFrames.push(mapPanelFrameRow(savedFrame));
      }

      if (layoutUpdate !== undefined) {
        await updatePageFrameLayoutConfig(transactionClient, pageId, userId, layoutUpdate);
      }

      return savedFrames.sort((left, right) => left.readingOrder - right.readingOrder);
    });
  }
}

async function updatePageFrameLayoutConfig(
  client: DatabaseClient,
  pageId: string,
  userId: string,
  layoutUpdate: PageLayoutFrameUpdate,
): Promise<void> {
  await client.query(
    `
    UPDATE pages
    SET layout_config = (COALESCE(pages.layout_config, '{}'::jsonb) - 'template_id')
        || jsonb_build_object(
          'type', $3,
          'panel_count', $4,
          'frame_definitions', $5::jsonb
        )
        || CASE
          WHEN $6::text IS NULL THEN '{}'::jsonb
          ELSE jsonb_build_object('template_id', $6)
        END,
        updated_at = NOW()
    FROM episodes
    INNER JOIN chapters ON chapters.id = episodes.chapter_id
    INNER JOIN works ON works.id = chapters.work_id
    WHERE pages.id = $1
      AND pages.episode_id = episodes.id
      AND works.user_id = $2
    `,
    [
      pageId,
      userId,
      layoutUpdate.type,
      layoutUpdate.panelCount,
      JSON.stringify(toLayoutFrameDefinitions(layoutUpdate.frameDefinitions)),
      layoutUpdate.type === 'template' ? layoutUpdate.templateId : null,
    ],
  );
}

function mapPanelFrameRow(row: PanelFrameRow): PanelFrame {
  return {
    id: row.id,
    pageId: row.page_id,
    panelId: row.panel_id,
    vertices: toVertices(row.vertices),
    borderStyle: toBorderStyle(row.border_style),
    borderWidth: row.border_width,
    borderColor: row.border_color,
    zIndex: row.z_index,
    readingOrder: row.reading_order,
  };
}

function toLayoutFrameDefinitions(frames: UpsertPanelFrameInput[]): Array<Record<string, unknown>> {
  return frames.map((frame) => {
    const definition: Record<string, unknown> = {
      vertices: frame.vertices,
      border_style: frame.borderStyle,
      border_width: frame.borderWidth,
      border_color: frame.borderColor,
      z_index: frame.zIndex,
      reading_order: frame.readingOrder,
    };

    if (frame.panelId !== null) {
      definition.panel_id = frame.panelId;
    }

    return definition;
  });
}

function toVertices(value: unknown): PanelFrameVertex[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((vertex) => {
    if (!isJsonObject(vertex)) {
      return [];
    }

    const x = vertex.x;
    const y = vertex.y;
    if (typeof x !== 'number' || typeof y !== 'number') {
      return [];
    }

    return [{ x, y }];
  });
}

function toBorderStyle(value: string): PanelFrameBorderStyle {
  if (value === 'solid' || value === 'dashed' || value === 'none') {
    return value;
  }

  return 'solid';
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
