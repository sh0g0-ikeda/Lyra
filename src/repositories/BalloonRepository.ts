import type { QueryResultRow } from 'pg';
import type {
  Balloon,
  BalloonFontFamily,
  BalloonPosition,
  BalloonTail,
  BalloonType,
  BalloonWritingMode,
  CreateBalloonInput,
  UpdateBalloonInput,
} from '../domain/types/balloon.js';
import type { PageDialogueMode, PageStatus } from '../domain/types/page.js';
import type { DatabaseClient, TransactionRunner } from '../lib/db.js';

export interface PageBalloonContext {
  pageId: string;
  workId: string;
  status: PageStatus;
  dialogueMode: PageDialogueMode;
  hasGeneratedImage: boolean;
  panelCount: number;
}

export interface BalloonContext {
  balloonId: string;
  pageId: string;
  workId: string;
  status: PageStatus;
  dialogueMode: PageDialogueMode;
  hasGeneratedImage: boolean;
  panelCount: number;
}

export interface BalloonRepository {
  findPageContextByIdAndUserId(
    pageId: string,
    userId: string,
    organizationId?: string | null,
  ): Promise<PageBalloonContext | null>;
  findBalloonContextByIdAndUserId(
    balloonId: string,
    userId: string,
    organizationId?: string | null,
  ): Promise<BalloonContext | null>;
  createBalloon(
    pageId: string,
    userId: string,
    input: CreateBalloonInput,
    organizationId?: string | null,
  ): Promise<Balloon | null>;
  findBalloonsByPageIdAndUserId(pageId: string, userId: string, organizationId?: string | null): Promise<Balloon[]>;
  replaceBalloonsByPageIdAndUserId(
    pageId: string,
    userId: string,
    inputs: CreateBalloonInput[],
    organizationId?: string | null,
  ): Promise<Balloon[]>;
  updateBalloon(
    balloonId: string,
    userId: string,
    input: UpdateBalloonInput,
    organizationId?: string | null,
  ): Promise<Balloon | null>;
  deleteBalloon(balloonId: string, userId: string, organizationId?: string | null): Promise<boolean>;
}

interface PageContextRow extends QueryResultRow {
  page_id: string;
  work_id: string;
  status: PageStatus;
  dialogue_mode: string;
  generated_image: unknown;
  panel_count: number;
}

interface BalloonContextRow extends QueryResultRow {
  balloon_id: string;
  page_id: string;
  work_id: string;
  status: PageStatus;
  dialogue_mode: string;
  generated_image: unknown;
  panel_count: number;
}

interface BalloonRow extends QueryResultRow {
  id: string;
  page_id: string;
  speaker_entity_id: string | null;
  balloon_type: string;
  writing_mode: string;
  text: string;
  position: unknown;
  tail: unknown;
  font_size: number;
  font_family: string;
  panel_order_reference: number | null;
  z_index: number;
}

export class PostgresBalloonRepository implements BalloonRepository {
  public constructor(private readonly client: DatabaseClient & TransactionRunner) {}

  public async findPageContextByIdAndUserId(
    pageId: string,
    userId: string,
    organizationId: string | null = null,
  ): Promise<PageBalloonContext | null> {
    const result = await this.client.query<PageContextRow>(
      `
      SELECT pages.id AS page_id,
             chapters.work_id,
             pages.status,
             pages.dialogue_mode,
             pages.generated_image,
             COUNT(panels.id)::int AS panel_count
      FROM pages
      INNER JOIN episodes ON episodes.id = pages.episode_id
      INNER JOIN chapters ON chapters.id = episodes.chapter_id
      INNER JOIN works ON works.id = chapters.work_id
      LEFT JOIN panels ON panels.page_id = pages.id
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
      GROUP BY pages.id, chapters.work_id, pages.status, pages.dialogue_mode, pages.generated_image
      `,
      [pageId, userId, organizationId],
    );

    const row = result.rows[0];
    return row === undefined
      ? null
      : {
          pageId: row.page_id,
          workId: row.work_id,
          status: row.status,
          dialogueMode: toDialogueMode(row.dialogue_mode),
          hasGeneratedImage: isJsonObject(row.generated_image),
          panelCount: row.panel_count,
        };
  }

  public async findBalloonContextByIdAndUserId(
    balloonId: string,
    userId: string,
    organizationId: string | null = null,
  ): Promise<BalloonContext | null> {
    const result = await this.client.query<BalloonContextRow>(
      `
      SELECT balloons.id AS balloon_id,
             pages.id AS page_id,
             chapters.work_id,
             pages.status,
             pages.dialogue_mode,
             pages.generated_image,
             COUNT(panels.id)::int AS panel_count
      FROM balloons
      INNER JOIN pages ON pages.id = balloons.page_id
      INNER JOIN episodes ON episodes.id = pages.episode_id
      INNER JOIN chapters ON chapters.id = episodes.chapter_id
      INNER JOIN works ON works.id = chapters.work_id
      LEFT JOIN panels ON panels.page_id = pages.id
      WHERE balloons.id = $1
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
      GROUP BY balloons.id, pages.id, chapters.work_id, pages.status, pages.dialogue_mode, pages.generated_image
      `,
      [balloonId, userId, organizationId],
    );

    const row = result.rows[0];
    return row === undefined
      ? null
      : {
          balloonId: row.balloon_id,
          pageId: row.page_id,
          workId: row.work_id,
          status: row.status,
          dialogueMode: toDialogueMode(row.dialogue_mode),
          hasGeneratedImage: isJsonObject(row.generated_image),
          panelCount: row.panel_count,
        };
  }

  public async createBalloon(
    pageId: string,
    userId: string,
    input: CreateBalloonInput,
    organizationId: string | null = null,
  ): Promise<Balloon | null> {
    const result = await this.client.query<BalloonRow>(
      `
      INSERT INTO balloons (
        page_id,
        speaker_entity_id,
        balloon_type,
        writing_mode,
        text,
        position,
        tail,
        font_size,
        font_family,
        panel_order_reference,
        z_index
      )
      SELECT
        pages.id,
        $3,
        $4,
        $5,
        $6,
        $7::jsonb,
        $8::jsonb,
        $9,
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
        input.speakerEntityId,
        input.balloonType,
        input.writingMode,
        input.text,
        JSON.stringify(toDbPosition(input.position)),
        JSON.stringify(toDbTail(input.tail)),
        input.fontSize,
        input.fontFamily,
        input.panelOrderReference,
        input.zIndex,
        organizationId,
      ],
    );

    return result.rows[0] === undefined ? null : mapBalloonRow(result.rows[0]);
  }

  public async findBalloonsByPageIdAndUserId(
    pageId: string,
    userId: string,
    organizationId: string | null = null,
  ): Promise<Balloon[]> {
    const result = await this.client.query<BalloonRow>(
      `
      SELECT balloons.*
      FROM balloons
      INNER JOIN pages ON pages.id = balloons.page_id
      INNER JOIN episodes ON episodes.id = pages.episode_id
      INNER JOIN chapters ON chapters.id = episodes.chapter_id
      INNER JOIN works ON works.id = chapters.work_id
      WHERE balloons.page_id = $1
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
      ORDER BY balloons.z_index ASC, balloons.id ASC
      `,
      [pageId, userId, organizationId],
    );

    return result.rows.map(mapBalloonRow);
  }

  public async replaceBalloonsByPageIdAndUserId(
    pageId: string,
    userId: string,
    inputs: CreateBalloonInput[],
    organizationId: string | null = null,
  ): Promise<Balloon[]> {
    return this.client.transaction(async (transactionClient) => {
      await transactionClient.query(
        `
        DELETE FROM balloons
        USING pages, episodes, chapters, works
        WHERE balloons.page_id = $1
          AND balloons.page_id = pages.id
          AND pages.episode_id = episodes.id
          AND episodes.chapter_id = chapters.id
          AND chapters.work_id = works.id
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

      const saved: Balloon[] = [];
      for (const input of inputs) {
        const result = await transactionClient.query<BalloonRow>(
          `
          INSERT INTO balloons (
            page_id,
            speaker_entity_id,
            balloon_type,
            writing_mode,
            text,
            position,
            tail,
            font_size,
            font_family,
            panel_order_reference,
            z_index
          )
          SELECT
            pages.id,
            $3,
            $4,
            $5,
            $6,
            $7::jsonb,
            $8::jsonb,
            $9,
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
            input.speakerEntityId,
            input.balloonType,
            input.writingMode,
            input.text,
            JSON.stringify(toDbPosition(input.position)),
            JSON.stringify(toDbTail(input.tail)),
            input.fontSize,
            input.fontFamily,
            input.panelOrderReference,
            input.zIndex,
            organizationId,
          ],
        );

        const row = result.rows[0];
        if (row !== undefined) {
          saved.push(mapBalloonRow(row));
        }
      }

      return saved;
    });
  }

  public async updateBalloon(
    balloonId: string,
    userId: string,
    input: UpdateBalloonInput,
    organizationId: string | null = null,
  ): Promise<Balloon | null> {
    const result = await this.client.query<BalloonRow>(
      `
      UPDATE balloons
      SET speaker_entity_id = CASE WHEN $3::boolean THEN $4 ELSE balloons.speaker_entity_id END,
          balloon_type = COALESCE($5, balloons.balloon_type),
          writing_mode = COALESCE($6, balloons.writing_mode),
          text = COALESCE($7, balloons.text),
          position = CASE WHEN $8::boolean THEN $9::jsonb ELSE balloons.position END,
          tail = CASE WHEN $10::boolean THEN $11::jsonb ELSE balloons.tail END,
          font_size = COALESCE($12, balloons.font_size),
          font_family = COALESCE($13, balloons.font_family),
          panel_order_reference = CASE WHEN $14::boolean THEN $15 ELSE balloons.panel_order_reference END,
          z_index = COALESCE($16, balloons.z_index)
      FROM pages
      INNER JOIN episodes ON episodes.id = pages.episode_id
      INNER JOIN chapters ON chapters.id = episodes.chapter_id
      INNER JOIN works ON works.id = chapters.work_id
      WHERE balloons.id = $1
        AND balloons.page_id = pages.id
        AND (
          ($17::uuid IS NULL AND works.user_id = $2 AND works.organization_id IS NULL)
          OR (
            $17::uuid IS NOT NULL
            AND works.organization_id = $17::uuid
            AND EXISTS (
              SELECT 1
              FROM organization_members
              WHERE organization_members.organization_id = works.organization_id
                AND organization_members.user_id = $2
                AND organization_members.status = 'active'
            )
          )
        )
      RETURNING balloons.*
      `,
      [
        balloonId,
        userId,
        input.speakerEntityId !== undefined,
        input.speakerEntityId ?? null,
        input.balloonType ?? null,
        input.writingMode ?? null,
        input.text ?? null,
        input.position !== undefined,
        JSON.stringify(input.position === undefined ? null : toDbPosition(input.position)),
        input.tail !== undefined,
        JSON.stringify(input.tail === undefined ? null : toDbTail(input.tail)),
        input.fontSize ?? null,
        input.fontFamily ?? null,
        input.panelOrderReference !== undefined,
        input.panelOrderReference ?? null,
        input.zIndex ?? null,
        organizationId,
      ],
    );

    return result.rows[0] === undefined ? null : mapBalloonRow(result.rows[0]);
  }

  public async deleteBalloon(
    balloonId: string,
    userId: string,
    organizationId: string | null = null,
  ): Promise<boolean> {
    const result = await this.client.query(
      `
      DELETE FROM balloons
      USING pages, episodes, chapters, works
      WHERE balloons.id = $1
        AND balloons.page_id = pages.id
        AND pages.episode_id = episodes.id
        AND episodes.chapter_id = chapters.id
        AND chapters.work_id = works.id
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
      [balloonId, userId, organizationId],
    );

    return (result.rowCount ?? 0) > 0;
  }
}

function mapBalloonRow(row: BalloonRow): Balloon {
  return {
    id: row.id,
    pageId: row.page_id,
    speakerEntityId: row.speaker_entity_id,
    balloonType: toBalloonType(row.balloon_type),
    writingMode: toWritingMode(row.writing_mode),
    text: row.text,
    position: toPosition(row.position),
    tail: toTail(row.tail),
    fontSize: row.font_size,
    fontFamily: toFontFamily(row.font_family),
    panelOrderReference: row.panel_order_reference,
    zIndex: row.z_index,
  };
}

function toDbPosition(position: BalloonPosition): Record<string, number> {
  return {
    x: position.x,
    y: position.y,
    width: position.width,
    height: position.height,
  };
}

function toDbTail(tail: BalloonTail | null): Record<string, number> | null {
  if (tail === null) {
    return null;
  }

  return {
    base_x: tail.baseX,
    base_y: tail.baseY,
    tip_x: tail.tipX,
    tip_y: tail.tipY,
  };
}

function toPosition(value: unknown): BalloonPosition {
  if (!isJsonObject(value)) {
    return { x: 0, y: 0, width: 0.1, height: 0.1 };
  }

  return {
    x: typeof value.x === 'number' ? value.x : 0,
    y: typeof value.y === 'number' ? value.y : 0,
    width: typeof value.width === 'number' ? value.width : 0.1,
    height: typeof value.height === 'number' ? value.height : 0.1,
  };
}

function toTail(value: unknown): BalloonTail | null {
  if (!isJsonObject(value)) {
    return null;
  }

  const baseX = typeof value.baseX === 'number' ? value.baseX : value.base_x;
  const baseY = typeof value.baseY === 'number' ? value.baseY : value.base_y;
  const tipX = typeof value.tipX === 'number' ? value.tipX : value.tip_x;
  const tipY = typeof value.tipY === 'number' ? value.tipY : value.tip_y;

  if (
    typeof baseX !== 'number' ||
    typeof baseY !== 'number' ||
    typeof tipX !== 'number' ||
    typeof tipY !== 'number'
  ) {
    return null;
  }

  return {
    baseX,
    baseY,
    tipX,
    tipY,
  };
}

function toDialogueMode(value: string): PageDialogueMode {
  return value === 'balloon_only' || value === 'mixed' ? value : 'image_baked';
}

function toBalloonType(value: string): BalloonType {
  return value === 'thought' ||
    value === 'narration' ||
    value === 'shout' ||
    value === 'whisper' ||
    value === 'sfx' ||
    value === 'caption'
    ? value
    : 'speech';
}

function toWritingMode(value: string): BalloonWritingMode {
  return value === 'horizontal' ? 'horizontal' : 'vertical';
}

function toFontFamily(value: string): BalloonFontFamily {
  return value === 'mincho' || value === 'rounded' || value === 'bold' ? value : 'manga_gothic';
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
