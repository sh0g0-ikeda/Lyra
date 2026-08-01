import type { QueryResultRow } from 'pg';
import { ConflictError, NotFoundError, ValidationError } from '../domain/errors/index.js';
import type { PageStatus } from '../domain/types/page.js';
import type {
  PanelFrame,
  PanelFrameBorderStyle,
  PanelFrameTemplateId,
  PanelFrameVertex,
  UpsertPanelFrameInput,
} from '../domain/types/panelFrame.js';
import type { DatabaseClient, TransactionRunner } from '../lib/db.js';
import { lockStoryEpisodeAdmission } from './StoryEpisodeAdmissionLock.js';

export type PagePanelStructureOperation =
  | { type: 'append' }
  | { type: 'delete'; panelId: string }
  | { type: 'reorder'; panelIds: string[] };

export interface PagePanelStructureReplacementLayout {
  templateId: PanelFrameTemplateId;
  frameDefinitions: UpsertPanelFrameInput[];
}

export interface ApplyPagePanelStructureInput {
  expectedPanelIds: string[];
  operation: PagePanelStructureOperation;
  replacementLayout: PagePanelStructureReplacementLayout | null;
}

export interface PagePanelStructureResult {
  panelIds: string[];
  createdPanelId: string | null;
  layoutTemplateId: PanelFrameTemplateId | null;
  frames: PanelFrame[];
  balloonReferenceUpdatedCount: number;
  balloonReferenceClearedCount: number;
}

export interface PagePanelStructureRepository {
  apply(
    userId: string,
    pageId: string,
    input: ApplyPagePanelStructureInput,
    organizationId?: string | null,
  ): Promise<PagePanelStructureResult>;
}

export class PostgresPagePanelStructureRepository implements PagePanelStructureRepository {
  public constructor(private readonly client: DatabaseClient & TransactionRunner) {}

  public async apply(
    userId: string,
    pageId: string,
    input: ApplyPagePanelStructureInput,
    organizationId: string | null = null,
  ): Promise<PagePanelStructureResult> {
    return this.client.transaction(async (transactionClient) => {
      const initialTarget = await findAuthorizedPageTarget(
        transactionClient,
        userId,
        pageId,
        organizationId,
        false,
      );
      if (initialTarget === null) {
        throw new NotFoundError('Page not found');
      }

      await lockStoryEpisodeAdmission(transactionClient, initialTarget.episodeId);
      const lockedTarget = await findAuthorizedPageTarget(
        transactionClient,
        userId,
        pageId,
        organizationId,
        true,
      );
      if (lockedTarget === null) {
        throw new NotFoundError('Page not found');
      }
      if (lockedTarget.episodeId !== initialTarget.episodeId) {
        throw new ConflictError('Page structure changed before it could be saved');
      }
      ensurePageStructureEditable(lockedTarget.pageStatus);
      if (await hasActiveGenerationJob(transactionClient, pageId, lockedTarget.episodeId)) {
        throw new ConflictError('Page structure cannot change while generation is active');
      }

      const currentPanels = await listPanelsForUpdate(transactionClient, pageId);
      const currentPanelIds = currentPanels.map((panel) => panel.id);
      if (!orderedIdsEqual(currentPanelIds, input.expectedPanelIds)) {
        throw new ConflictError('Page panels changed before the structure could be saved');
      }

      const desiredPanelIds = resolveDesiredPanelIds(currentPanelIds, input.operation);
      const balloonImpact = await remapBalloonReferences(
        transactionClient,
        pageId,
        currentPanelIds,
        desiredPanelIds,
      );

      let createdPanelId: string | null = null;
      let frames: PanelFrame[];
      if (input.operation.type === 'reorder') {
        const currentFrames = await listFramesForUpdate(transactionClient, pageId);
        ensureFramesMatchPanels(currentFrames, currentPanelIds);
        await reorderPanels(transactionClient, pageId, desiredPanelIds);
        frames = await relinkFramesByReadingOrder(transactionClient, pageId, desiredPanelIds);
        await updatePreservedLayoutConfig(transactionClient, pageId, frames);
      } else {
        const replacementLayout = input.replacementLayout;
        if (replacementLayout === null || replacementLayout.frameDefinitions.length !== desiredPanelIds.length) {
          throw new ValidationError('A complete replacement layout is required for a panel count change');
        }
        ensureReplacementFrames(replacementLayout.frameDefinitions, desiredPanelIds.length);
        await deleteFramesForPage(transactionClient, pageId);
        if (input.operation.type === 'append') {
          createdPanelId = await insertEmptyPanel(transactionClient, pageId, desiredPanelIds.length);
          desiredPanelIds[desiredPanelIds.length - 1] = createdPanelId;
        } else {
          await deletePanel(transactionClient, pageId, input.operation.panelId);
          await compactPanelOrders(transactionClient, pageId, currentPanels, input.operation.panelId);
        }
        frames = await insertReplacementFrames(
          transactionClient,
          pageId,
          desiredPanelIds,
          replacementLayout.frameDefinitions,
        );
        await updateTemplateLayoutConfig(
          transactionClient,
          pageId,
          replacementLayout.templateId,
          frames,
        );
      }

      return {
        panelIds: desiredPanelIds,
        createdPanelId,
        layoutTemplateId: input.replacementLayout?.templateId ?? null,
        frames,
        balloonReferenceUpdatedCount: balloonImpact.updatedCount,
        balloonReferenceClearedCount: balloonImpact.clearedCount,
      };
    });
  }
}

interface PageTargetRow extends QueryResultRow {
  episode_id: string;
  page_status: PageStatus;
}

interface PageTarget {
  episodeId: string;
  pageStatus: PageStatus;
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

interface ActiveJobRow extends QueryResultRow {
  has_active_job: boolean;
}

interface InsertedPanelRow extends QueryResultRow {
  id: string;
}

interface BalloonImpactRow extends QueryResultRow {
  balloon_reference_updated_count: string;
  balloon_reference_cleared_count: string;
}

async function findAuthorizedPageTarget(
  client: DatabaseClient,
  userId: string,
  pageId: string,
  organizationId: string | null,
  lock: boolean,
): Promise<PageTarget | null> {
  const result = await client.query<PageTargetRow>(
    `
    SELECT pages.episode_id AS episode_id,
           pages.status AS page_status
    FROM pages
    INNER JOIN episodes ON episodes.id = pages.episode_id
    INNER JOIN chapters ON chapters.id = episodes.chapter_id
    INNER JOIN works ON works.id = chapters.work_id
    WHERE pages.id = $1::uuid
      AND (
        ($3::uuid IS NULL AND works.user_id = $2::uuid AND works.organization_id IS NULL)
        OR (
          $3::uuid IS NOT NULL
          AND works.organization_id = $3::uuid
          AND EXISTS (
            SELECT 1
            FROM organization_members
            WHERE organization_members.organization_id = works.organization_id
              AND organization_members.user_id = $2::uuid
              AND organization_members.status = 'active'
          )
        )
      )
    ${lock ? 'FOR UPDATE OF pages' : ''}
    `,
    [pageId, userId, organizationId],
  );
  const row = result.rows[0];
  return row === undefined ? null : { episodeId: row.episode_id, pageStatus: row.page_status };
}

async function hasActiveGenerationJob(
  client: DatabaseClient,
  pageId: string,
  episodeId: string,
): Promise<boolean> {
  const result = await client.query<ActiveJobRow>(
    `
    SELECT EXISTS (
      SELECT 1
      FROM generation_jobs
      WHERE generation_jobs.status IN ('queued', 'processing')
        AND (
          (
            generation_jobs.job_type = 'page_generate'
            AND generation_jobs.params->>'page_id' = $1::text
          )
          OR (
            generation_jobs.job_type IN ('episode_story_autofill', 'episode_page_skeleton')
            AND generation_jobs.params->>'episode_id' = $2::text
          )
        )
    ) AS has_active_job
    `,
    [pageId, episodeId],
  );
  return result.rows[0]?.has_active_job ?? false;
}

async function listPanelsForUpdate(client: DatabaseClient, pageId: string): Promise<PanelOrderRow[]> {
  const result = await client.query<PanelOrderRow>(
    `
    SELECT panels.id,
           panels."order"
    FROM panels
    WHERE panels.page_id = $1::uuid
    ORDER BY panels."order" ASC
    FOR UPDATE
    `,
    [pageId],
  );
  return result.rows;
}

async function listFramesForUpdate(client: DatabaseClient, pageId: string): Promise<PanelFrame[]> {
  const result = await client.query<PanelFrameRow>(
    `
    SELECT panel_frames.*
    FROM panel_frames
    WHERE panel_frames.page_id = $1::uuid
    ORDER BY panel_frames.reading_order ASC
    FOR UPDATE
    `,
    [pageId],
  );
  return result.rows.map(mapPanelFrameRow);
}

function resolveDesiredPanelIds(currentPanelIds: string[], operation: PagePanelStructureOperation): string[] {
  if (operation.type === 'append') {
    if (currentPanelIds.length >= 8) {
      throw new ValidationError('A page can contain at most eight panels');
    }
    return [...currentPanelIds, 'pending-created-panel'];
  }
  if (operation.type === 'delete') {
    if (currentPanelIds.length <= 1) {
      throw new ValidationError('A page must retain at least one panel');
    }
    if (!currentPanelIds.includes(operation.panelId)) {
      throw new ConflictError('The panel to delete is no longer on the page');
    }
    return currentPanelIds.filter((panelId) => panelId !== operation.panelId);
  }
  if (!sameIdSet(currentPanelIds, operation.panelIds)) {
    throw new ValidationError('Panel reorder must include every current panel exactly once');
  }
  return [...operation.panelIds];
}

async function remapBalloonReferences(
  client: DatabaseClient,
  pageId: string,
  currentPanelIds: string[],
  desiredPanelIds: string[],
): Promise<{ updatedCount: number; clearedCount: number }> {
  const desiredOrderById = new Map(desiredPanelIds.map((panelId, index) => [panelId, index + 1] as const));
  const mappings = currentPanelIds.flatMap((panelId, index) => {
    const oldOrder = index + 1;
    const newOrder = desiredOrderById.get(panelId) ?? null;
    return newOrder === oldOrder ? [] : [{ oldOrder, newOrder }];
  });
  if (mappings.length === 0) {
    return { updatedCount: 0, clearedCount: 0 };
  }

  const result = await client.query<BalloonImpactRow>(
    `
    WITH mapping AS (
      SELECT requested.old_order,
             requested.new_order
      FROM unnest($2::int[], $3::int[]) AS requested(old_order, new_order)
    ),
    updated AS (
      UPDATE balloons
      SET panel_order_reference = mapping.new_order
      FROM mapping
      WHERE balloons.page_id = $1::uuid
        AND balloons.panel_order_reference = mapping.old_order
        AND balloons.panel_order_reference IS DISTINCT FROM mapping.new_order
      RETURNING balloons.panel_order_reference AS new_order
    )
    SELECT COUNT(*)::text AS balloon_reference_updated_count,
           COUNT(*) FILTER (WHERE new_order IS NULL)::text AS balloon_reference_cleared_count
    FROM updated
    `,
    [
      pageId,
      mappings.map((mapping) => mapping.oldOrder),
      mappings.map((mapping) => mapping.newOrder),
    ],
  );
  const row = result.rows[0];
  return {
    updatedCount: Number(row?.balloon_reference_updated_count ?? 0),
    clearedCount: Number(row?.balloon_reference_cleared_count ?? 0),
  };
}

async function insertEmptyPanel(client: DatabaseClient, pageId: string, order: number): Promise<string> {
  const result = await client.query<InsertedPanelRow>(
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
    VALUES (
      $1::uuid,
      $2::int,
      'action',
      'standard',
      NULL,
      '[]'::jsonb,
      '{"source":"custom","gallery_item_id":null,"composition_prompt":null,"shot_type":null,"angle":null,"custom_note":null}'::jsonb,
      TRUE,
      '[]'::jsonb,
      NULL,
      NULL,
      NULL
    )
    RETURNING id
    `,
    [pageId, order],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new ValidationError('Failed to append panel');
  }
  return row.id;
}

async function deletePanel(client: DatabaseClient, pageId: string, panelId: string): Promise<void> {
  const result = await client.query<InsertedPanelRow>(
    `
    DELETE FROM panels
    WHERE panels.page_id = $1::uuid
      AND panels.id = $2::uuid
    RETURNING panels.id
    `,
    [pageId, panelId],
  );
  if (result.rows[0] === undefined) {
    throw new ConflictError('The panel to delete is no longer on the page');
  }
}

async function compactPanelOrders(
  client: DatabaseClient,
  pageId: string,
  currentPanels: PanelOrderRow[],
  deletedPanelId: string,
): Promise<void> {
  const deletedPanel = currentPanels.find((panel) => panel.id === deletedPanelId);
  if (deletedPanel === undefined) {
    throw new ConflictError('The panel to delete is no longer on the page');
  }
  await client.query(
    `
    UPDATE panels
    SET "order" = panels."order" - 1,
        updated_at = NOW()
    WHERE panels.page_id = $1::uuid
      AND panels."order" > $2::int
    `,
    [pageId, deletedPanel.order],
  );
}

async function reorderPanels(client: DatabaseClient, pageId: string, panelIds: string[]): Promise<void> {
  await client.query(
    `
    WITH requested_order AS (
      SELECT requested.id,
             requested.ordinality::int AS new_order
      FROM unnest($2::uuid[]) WITH ORDINALITY AS requested(id, ordinality)
    )
    UPDATE panels
    SET "order" = -requested_order.new_order,
        updated_at = NOW()
    FROM requested_order
    WHERE panels.page_id = $1::uuid
      AND panels.id = requested_order.id
    `,
    [pageId, panelIds],
  );
  await client.query(
    `
    UPDATE panels
    SET "order" = -panels."order",
        updated_at = NOW()
    WHERE panels.page_id = $1::uuid
      AND panels."order" < 0
    `,
    [pageId],
  );
}

async function relinkFramesByReadingOrder(
  client: DatabaseClient,
  pageId: string,
  panelIds: string[],
): Promise<PanelFrame[]> {
  const result = await client.query<PanelFrameRow>(
    `
    WITH requested_order AS (
      SELECT requested.id,
             requested.ordinality::int AS reading_order
      FROM unnest($2::uuid[]) WITH ORDINALITY AS requested(id, ordinality)
    )
    UPDATE panel_frames
    SET panel_id = requested_order.id
    FROM requested_order
    WHERE panel_frames.page_id = $1::uuid
      AND panel_frames.reading_order = requested_order.reading_order
    RETURNING panel_frames.*
    `,
    [pageId, panelIds],
  );
  const frames = result.rows.map(mapPanelFrameRow).sort(compareFrameOrder);
  if (frames.length !== panelIds.length) {
    throw new ConflictError('Page frames changed before the structure could be saved');
  }
  return frames;
}

async function deleteFramesForPage(client: DatabaseClient, pageId: string): Promise<void> {
  await client.query('DELETE FROM panel_frames WHERE page_id = $1::uuid', [pageId]);
}

async function insertReplacementFrames(
  client: DatabaseClient,
  pageId: string,
  panelIds: string[],
  definitions: UpsertPanelFrameInput[],
): Promise<PanelFrame[]> {
  const sortedDefinitions = [...definitions].sort((left, right) => left.readingOrder - right.readingOrder);
  const frames: PanelFrame[] = [];
  for (const [index, definition] of sortedDefinitions.entries()) {
    const panelId = panelIds[index];
    if (panelId === undefined) {
      throw new ValidationError('Replacement frame does not have a matching panel');
    }
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
      VALUES ($1::uuid, $2::uuid, $3::jsonb, $4, $5, $6, $7, $8)
      RETURNING *
      `,
      [
        pageId,
        panelId,
        JSON.stringify(definition.vertices),
        definition.borderStyle,
        definition.borderWidth,
        definition.borderColor,
        definition.zIndex,
        index + 1,
      ],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new ValidationError('Failed to save replacement frame');
    }
    frames.push(mapPanelFrameRow(row));
  }
  return frames;
}

async function updateTemplateLayoutConfig(
  client: DatabaseClient,
  pageId: string,
  templateId: PanelFrameTemplateId,
  frames: PanelFrame[],
): Promise<void> {
  await client.query(
    `
    UPDATE pages
    SET layout_config = COALESCE(layout_config, '{}'::jsonb)
        || jsonb_build_object(
          'type', 'template',
          'panel_count', $2::int,
          'frame_definitions', $3::jsonb,
          'template_id', $4::text
        ),
        updated_at = NOW()
    WHERE pages.id = $1::uuid
    `,
    [pageId, frames.length, JSON.stringify(toLayoutFrameDefinitions(frames)), templateId],
  );
}

async function updatePreservedLayoutConfig(
  client: DatabaseClient,
  pageId: string,
  frames: PanelFrame[],
): Promise<void> {
  await client.query(
    `
    UPDATE pages
    SET layout_config = COALESCE(layout_config, '{}'::jsonb)
        || jsonb_build_object(
          'panel_count', $2::int,
          'frame_definitions', $3::jsonb
        ),
        updated_at = NOW()
    WHERE pages.id = $1::uuid
    `,
    [pageId, frames.length, JSON.stringify(toLayoutFrameDefinitions(frames))],
  );
}

function ensurePageStructureEditable(status: PageStatus): void {
  if (status === 'confirmed') {
    throw new ConflictError('Confirmed pages must be reopened before changing panel structure');
  }
  if (status === 'generating') {
    throw new ConflictError('Page structure cannot change while generation is in progress');
  }
}

function ensureFramesMatchPanels(frames: PanelFrame[], panelIds: string[]): void {
  if (frames.length !== panelIds.length) {
    throw new ConflictError('Page panels and frames must be synchronized before reordering');
  }
  const linkedPanelIds = frames.map((frame) => frame.panelId);
  if (linkedPanelIds.some((panelId) => panelId === null) || !sameIdSet(panelIds, linkedPanelIds as string[])) {
    throw new ConflictError('Every page frame must link to one current panel before reordering');
  }
  if (frames.some((frame, index) => frame.readingOrder !== index + 1)) {
    throw new ConflictError('Page frame reading order must be contiguous before reordering');
  }
}

function ensureReplacementFrames(definitions: UpsertPanelFrameInput[], panelCount: number): void {
  const orders = definitions.map((frame) => frame.readingOrder).sort((left, right) => left - right);
  if (orders.length !== panelCount || orders.some((order, index) => order !== index + 1)) {
    throw new ValidationError('Replacement frame reading order must be complete and contiguous');
  }
}

function orderedIdsEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

function sameIdSet(left: string[], right: string[]): boolean {
  return left.length === right.length
    && new Set(left).size === left.length
    && new Set(right).size === right.length
    && right.every((id) => left.includes(id));
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
    throw new ValidationError('Stored panel frame vertices are invalid');
  }
  const vertices = value.flatMap((vertex) => {
    if (!isRecord(vertex) || typeof vertex.x !== 'number' || typeof vertex.y !== 'number') {
      return [];
    }
    return [{ x: vertex.x, y: vertex.y }];
  });
  if (vertices.length < 3) {
    throw new ValidationError('Stored panel frame vertices are invalid');
  }
  return vertices;
}

function toBorderStyle(value: string): PanelFrameBorderStyle {
  return value === 'dashed' || value === 'none' ? value : 'solid';
}

function toLayoutFrameDefinitions(frames: PanelFrame[]): Array<Record<string, unknown>> {
  return [...frames].sort(compareFrameOrder).map((frame) => ({
    vertices: frame.vertices,
    border_style: frame.borderStyle,
    border_width: frame.borderWidth,
    border_color: frame.borderColor,
    z_index: frame.zIndex,
    reading_order: frame.readingOrder,
    panel_id: frame.panelId,
  }));
}

function compareFrameOrder(left: PanelFrame, right: PanelFrame): number {
  return left.readingOrder - right.readingOrder;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
