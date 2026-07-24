import type { QueryResultRow } from 'pg';
import type {
  PageLayoutTemplateApplication,
  PanelFrame,
  PanelFrameBorderStyle,
  PanelFrameTemplateId,
  PanelFrameVertex,
  UpsertPanelFrameInput,
} from '../domain/types/panelFrame.js';
import type { PageStatus } from '../domain/types/page.js';
import { ConflictError, NotFoundError, ValidationError } from '../domain/errors/index.js';
import type { DatabaseClient, TransactionRunner } from '../lib/db.js';

export interface ApplyPageLayoutTemplateInput {
  templateId: PanelFrameTemplateId;
  targetPanelCount: number;
  frameDefinitions: UpsertPanelFrameInput[];
}

export interface PageLayoutRepository {
  applyTemplateAndSyncPanels(
    userId: string,
    pageId: string,
    input: ApplyPageLayoutTemplateInput,
    organizationId?: string | null,
  ): Promise<PageLayoutTemplateApplication>;
}

interface PageLayoutContextRow extends QueryResultRow {
  page_id: string;
  page_status: PageStatus;
}

interface PanelOrderRow extends QueryResultRow {
  id: string;
  order: number;
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

const defaultPanelComposition = {
  source: 'custom',
  gallery_item_id: null,
  composition_prompt: null,
  shot_type: null,
  angle: null,
  custom_note: null,
} as const;

/**
 * Applies a reader-facing layout template as one atomic page edit. This keeps
 * the generation invariant intact: each saved frame always has one panel.
 */
export class PostgresPageLayoutRepository implements PageLayoutRepository {
  public constructor(private readonly client: DatabaseClient & TransactionRunner) {}

  public async applyTemplateAndSyncPanels(
    userId: string,
    pageId: string,
    input: ApplyPageLayoutTemplateInput,
    organizationId: string | null = null,
  ): Promise<PageLayoutTemplateApplication> {
    return this.client.transaction(async (transactionClient) => {
      await ensureEditableOwnedPage(transactionClient, userId, pageId, organizationId);

      const currentPanels = await listPanelsForUpdate(transactionClient, pageId);
      const currentPanelCount = currentPanels.length;
      const deletedPanelCount = Math.max(currentPanelCount - input.targetPanelCount, 0);
      const createdPanelCount = Math.max(input.targetPanelCount - currentPanelCount, 0);

      if (deletedPanelCount > 0) {
        throw new ConflictError('Applying this template would delete panels');
      }

      await compactPanelOrders(transactionClient, pageId);
      await deleteFramesForPage(transactionClient, pageId);

      if (createdPanelCount > 0) {
        await createEmptyPanels(transactionClient, pageId, currentPanelCount, input.targetPanelCount);
      }

      const syncedPanels = await listPanelsForUpdate(transactionClient, pageId);
      if (syncedPanels.length !== input.targetPanelCount) {
        throw new ValidationError('Panel count did not match layout template');
      }

      const frames = buildPanelLinkedFrames(input.frameDefinitions, syncedPanels);
      const savedFrames = await replaceFrames(transactionClient, pageId, frames);
      await updatePageLayoutConfig(transactionClient, pageId, input.templateId, input.targetPanelCount, frames);

      return {
        templateId: input.templateId,
        panelCount: input.targetPanelCount,
        createdPanelCount,
        deletedPanelCount,
        frames: savedFrames,
      };
    });
  }
}

async function ensureEditableOwnedPage(
  client: DatabaseClient,
  userId: string,
  pageId: string,
  organizationId: string | null,
): Promise<void> {
  const result = await client.query<PageLayoutContextRow>(
    `
    SELECT pages.id AS page_id,
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
    FOR UPDATE OF pages
    `,
    [pageId, userId, organizationId],
  );

  const page = result.rows[0];
  if (page === undefined) {
    throw new NotFoundError('Page not found');
  }

  if (page.page_status === 'confirmed') {
    throw new ConflictError('Confirmed pages must be reopened before changing layout');
  }

  if (page.page_status === 'generating') {
    throw new ConflictError('Pages cannot change layout while generation is in progress');
  }
}

async function listPanelsForUpdate(client: DatabaseClient, pageId: string): Promise<PanelOrderRow[]> {
  const result = await client.query<PanelOrderRow>(
    `
    SELECT id,
           "order"
    FROM panels
    WHERE page_id = $1
    ORDER BY "order" ASC
    FOR UPDATE
    `,
    [pageId],
  );

  return result.rows;
}

async function deleteFramesForPage(client: DatabaseClient, pageId: string): Promise<void> {
  await client.query(
    `
    DELETE FROM panel_frames
    WHERE page_id = $1
    `,
    [pageId],
  );
}

async function compactPanelOrders(client: DatabaseClient, pageId: string): Promise<void> {
  await client.query(
    `
    WITH ordered AS (
      SELECT id,
             ROW_NUMBER() OVER (ORDER BY "order" ASC, created_at ASC, id ASC)::int AS compact_order
      FROM panels
      WHERE page_id = $1
    )
    UPDATE panels
    SET "order" = -ordered.compact_order,
        updated_at = NOW()
    FROM ordered
    WHERE panels.id = ordered.id
    `,
    [pageId],
  );

  await client.query(
    `
    UPDATE panels
    SET "order" = -panels."order",
        updated_at = NOW()
    WHERE page_id = $1
      AND panels."order" < 0
    `,
    [pageId],
  );
}

async function createEmptyPanels(
  client: DatabaseClient,
  pageId: string,
  currentPanelCount: number,
  targetPanelCount: number,
): Promise<void> {
  await client.query(
    `
    INSERT INTO panels (
      page_id,
      "order",
      panel_role,
      panel_size,
      composition,
      dialogue_in_panel,
      dialogue
    )
    SELECT
      $1,
      new_order,
      'action',
      'standard',
      $4::jsonb,
      TRUE,
      '[]'::jsonb
    FROM generate_series($2::int + 1, $3::int) AS new_order
    `,
    [pageId, currentPanelCount, targetPanelCount, JSON.stringify(defaultPanelComposition)],
  );
}

function buildPanelLinkedFrames(
  frameDefinitions: UpsertPanelFrameInput[],
  panels: PanelOrderRow[],
): UpsertPanelFrameInput[] {
  return [...frameDefinitions]
    .sort((left, right) => left.readingOrder - right.readingOrder)
    .map((frame, index) => {
      const panel = panels[index];
      if (panel === undefined) {
        throw new ValidationError('Panel count did not match layout template');
      }

      return {
        ...frame,
        panelId: panel.id,
        readingOrder: index + 1,
        vertices: frame.vertices.map((vertex) => ({ ...vertex })),
      };
    });
}

async function replaceFrames(
  client: DatabaseClient,
  pageId: string,
  frames: UpsertPanelFrameInput[],
): Promise<PanelFrame[]> {
  const savedFrames: PanelFrame[] = [];
  for (const frame of frames) {
    const result = await client.query<PanelFrameRow>(
      `
      INSERT INTO panel_frames (
        page_id,
        panel_id,
        vertices,
        border_style,
        border_width,
        border_color,
        z_index,
        reading_order
      )
      VALUES ($1, $2::uuid, $3::jsonb, $4, $5, $6, $7, $8)
      RETURNING *
      `,
      [
        pageId,
        frame.panelId,
        JSON.stringify(frame.vertices),
        frame.borderStyle,
        frame.borderWidth,
        frame.borderColor,
        frame.zIndex,
        frame.readingOrder,
      ],
    );

    const savedFrame = result.rows[0];
    if (savedFrame === undefined) {
      throw new ValidationError('Failed to save panel frame');
    }
    savedFrames.push(mapPanelFrameRow(savedFrame));
  }

  return savedFrames.sort((left, right) => left.readingOrder - right.readingOrder);
}

async function updatePageLayoutConfig(
  client: DatabaseClient,
  pageId: string,
  templateId: PanelFrameTemplateId,
  panelCount: number,
  frames: UpsertPanelFrameInput[],
): Promise<void> {
  await client.query(
    `
    UPDATE pages
    SET layout_config = (COALESCE(layout_config, '{}'::jsonb) - 'template_id')
        || jsonb_build_object(
          'type', 'template',
          'panel_count', $2::int,
          'frame_definitions', $3::jsonb,
          'template_id', $4::text
        ),
        updated_at = NOW()
    WHERE id = $1
    `,
    [pageId, panelCount, JSON.stringify(toLayoutFrameDefinitions(frames)), templateId],
  );
}

function toLayoutFrameDefinitions(frames: UpsertPanelFrameInput[]): Array<Record<string, unknown>> {
  return frames.map((frame) => ({
    vertices: frame.vertices,
    border_style: frame.borderStyle,
    border_width: frame.borderWidth,
    border_color: frame.borderColor,
    z_index: frame.zIndex,
    reading_order: frame.readingOrder,
    panel_id: frame.panelId,
  }));
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
