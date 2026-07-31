import type { QueryResultRow } from 'pg';
import { buildPanelFrameTemplateInputs } from '../domain/constants/panelFrameTemplates.js';
import type {
  Chapter,
  CreateChapterInput,
  CreateEpisodeInput,
  CreateWorkInput,
  Episode,
  StoryItemMoveDirection,
  StoryStatus,
  UpdateChapterInput,
  UpdateEpisodeInput,
  UpdateWorkInput,
  Work,
} from '../domain/types/story.js';
import type {
  EpisodePageSkeletonContext,
  PageSkeletonPageDraft,
  PageSkeletonPersistResult,
  StoryEpisodeImprovementContext,
  StoryCollaborationLayer,
  StoryCollaborationTarget,
  StoryEntitySummary,
} from '../domain/types/storyAi.js';
import {
  ConfigurationError,
  ConflictError,
  ValidationError,
} from '../domain/errors/index.js';
import type { WorkListCursor } from '../domain/pagination.js';
import { normalizeEpisodeStoryInput } from '../domain/episodeStoryInput.js';
import type { DatabaseClient, TransactionRunner } from '../lib/db.js';
import { isUniqueViolation } from '../lib/dbErrors.js';
import { normalizeNullableText, normalizePossiblyMojibake } from '../lib/textEncoding.js';
import { extractEntityAliases } from '../domain/entityAliases.js';
import {
  lockStoryEpisodeAdmission,
  lockStoryEpisodeAdmissions,
} from './StoryEpisodeAdmissionLock.js';

export type {
  Chapter,
  CreateChapterInput,
  CreateEpisodeInput,
  CreateWorkInput,
  Episode,
  UpdateChapterInput,
  UpdateEpisodeInput,
  UpdateWorkInput,
  Work,
};
export type { WorkListCursor } from '../domain/pagination.js';

export interface StoryRepository {
  findWorksByUserId(userId: string, organizationId?: string | null): Promise<Work[]>;
  createWork(userId: string, input: CreateWorkInput): Promise<Work>;
  findWorkByIdAndUserId(id: string, userId: string, organizationId?: string | null): Promise<Work | null>;
  updateWork(id: string, userId: string, input: UpdateWorkInput, organizationId?: string | null): Promise<Work | null>;
  createChapter(workId: string, input: CreateChapterInput): Promise<Chapter>;
  findChaptersByWorkIdAndUserId(workId: string, userId: string, organizationId?: string | null): Promise<Chapter[]>;
  findChapterByIdAndUserId(id: string, userId: string, organizationId?: string | null): Promise<Chapter | null>;
  updateChapter(id: string, userId: string, input: UpdateChapterInput, organizationId?: string | null): Promise<Chapter | null>;
  deleteChapter(id: string, userId: string, organizationId?: string | null): Promise<boolean>;
  moveChapter(id: string, userId: string, direction: StoryItemMoveDirection, organizationId?: string | null): Promise<Chapter | null>;
  createEpisode(chapterId: string, input: CreateEpisodeInput): Promise<Episode>;
  findEpisodesByChapterIdAndUserId(chapterId: string, userId: string, organizationId?: string | null): Promise<Episode[]>;
  findEpisodeByIdAndUserId(id: string, userId: string, organizationId?: string | null): Promise<Episode | null>;
  updateEpisode(id: string, userId: string, input: UpdateEpisodeInput, organizationId?: string | null): Promise<Episode | null>;
  deleteEpisode(id: string, userId: string, organizationId?: string | null): Promise<boolean>;
  moveEpisode(
    id: string,
    userId: string,
    direction: StoryItemMoveDirection,
    organizationId?: string | null,
    crossChapter?: boolean,
  ): Promise<Episode | null>;
  findCollaborationTargetByIdAndUserId(
    layer: StoryCollaborationLayer,
    targetId: string,
    userId: string,
    organizationId?: string | null,
  ): Promise<StoryCollaborationTarget | null>;
  findEpisodePageSkeletonContextByIdAndUserId(
    episodeId: string,
    userId: string,
    organizationId?: string | null,
  ): Promise<EpisodePageSkeletonContext | null>;
  findEpisodeImprovementContextByIdAndUserId(
    episodeId: string,
    userId: string,
    organizationId?: string | null,
  ): Promise<StoryEpisodeImprovementContext | null>;
  createPageSkeleton(
    episodeId: string,
    userId: string,
    pages: PageSkeletonPageDraft[],
    options?: { overwriteExisting?: boolean },
    organizationId?: string | null,
  ): Promise<PageSkeletonPersistResult | null>;
  rollbackFreshPageSkeleton(
    episodeId: string,
    userId: string,
    expectedPageCount: number,
    organizationId?: string | null,
  ): Promise<boolean>;
}

export interface WorkListPageRequest {
  limit: number;
  cursor: WorkListCursor | null;
}

export interface WorkListPage {
  works: Work[];
  nextCursor: WorkListCursor | null;
}

export interface WorkListPaginationRepository {
  findWorksPageByUserId(
    userId: string,
    request: WorkListPageRequest,
    organizationId?: string | null,
  ): Promise<WorkListPage>;
}

interface WorkRow extends QueryResultRow {
  id: string;
  user_id: string;
  organization_id: string | null;
  title: string;
  genre: string | null;
  world_setting: string | null;
  theme: string | null;
  main_entity_ids: string[];
  starting_point: string | null;
  ending_point: string | null;
  overall_flow: string | null;
  version: number;
  edit_history: unknown;
  status: StoryStatus;
  created_at: Date;
  updated_at: Date;
}

interface ChapterRow extends QueryResultRow {
  id: string;
  work_id: string;
  order: number;
  title: string | null;
  purpose: string | null;
  starting_state: string | null;
  ending_state: string | null;
  emotion_curve: string | null;
  entities_involved: string[];
  key_beats: string[];
  version: number;
  edit_history: unknown;
  status: StoryStatus;
  created_at: Date;
  updated_at: Date;
}

interface EpisodeRow extends QueryResultRow {
  id: string;
  chapter_id: string;
  order: number;
  title: string | null;
  purpose: string | null;
  story_input_mode: 'structured' | 'full';
  story_full_draft: string | null;
  introduction: string | null;
  middle: string | null;
  climax: string | null;
  ending_hook: string | null;
  estimated_pages: number;
  entities_involved: string[];
  page_skeleton_generated: boolean;
  version: number;
  edit_history: unknown;
  status: StoryStatus;
  created_at: Date;
  updated_at: Date;
}

interface EpisodeMoveRow extends EpisodeRow {
  work_id: string;
  chapter_order: number;
}

interface EpisodeOrderRow extends QueryResultRow {
  id: string;
  chapter_id: string;
  order: number;
}

interface CollaborationRow extends QueryResultRow {
  work_id: string;
  work_title: string;
  chapter_title: string | null;
  episode_title: string | null;
  payload: unknown;
  entities: unknown;
  scene_summaries: unknown;
}

interface EpisodeSkeletonContextRow extends QueryResultRow {
  episode_id: string;
  chapter_id: string;
  work_id: string;
  work_title: string;
  work_genre: string | null;
  world_setting: string | null;
  theme: string | null;
  chapter_title: string | null;
  chapter_purpose: string | null;
  episode_title: string | null;
  episode_purpose: string | null;
  introduction: string | null;
  middle: string | null;
  climax: string | null;
  ending_hook: string | null;
  estimated_pages: number;
  entities_involved: string[];
  scene_involved_entity_ids: string[];
  page_skeleton_generated: boolean;
  existing_page_count: number;
  entities: unknown;
  scene_summaries: unknown;
}

interface EpisodeImprovementContextRow extends QueryResultRow {
  episode_id: string;
  chapter_id: string;
  work_id: string;
  work_title: string;
  work_genre: string | null;
  world_setting: string | null;
  theme: string | null;
  overall_flow: string | null;
  chapter_title: string | null;
  chapter_purpose: string | null;
  chapter_starting_state: string | null;
  chapter_ending_state: string | null;
  chapter_emotion_curve: string | null;
  episode_title: string | null;
  episode_purpose: string | null;
  introduction: string | null;
  middle: string | null;
  climax: string | null;
  ending_hook: string | null;
  estimated_pages: number;
  entities: unknown;
  scene_summaries: unknown;
  chapter_summaries: unknown;
  sibling_episode_summaries: unknown;
}

interface IdRow extends QueryResultRow {
  id: string;
}

interface AuthorizedChapterIdRow extends QueryResultRow {
  authorized_chapter_id: string;
}

interface AuthorizedEpisodeIdRow extends QueryResultRow {
  authorized_episode_id: string;
}

interface ChildEpisodeIdRow extends QueryResultRow {
  child_episode_id: string;
}

interface StoryDeletionBlockerRow extends QueryResultRow {
  deletion_blocked: boolean;
}

interface TemporaryOrderRow extends QueryResultRow {
  temporary_order: number;
}

interface SkeletonLockRow extends QueryResultRow {
  id: string;
  page_skeleton_generated: boolean;
  existing_page_count: number;
  rollback_safe_page_count?: number;
}

export class PostgresStoryRepository
  implements StoryRepository, WorkListPaginationRepository
{
  public constructor(
    private readonly client: DatabaseClient,
    private readonly transactionRunner?: TransactionRunner,
  ) {}

  public async findWorksByUserId(userId: string, organizationId: string | null = null): Promise<Work[]> {
    const result = await this.client.query<WorkRow>(
      `
      SELECT *
      FROM works
      WHERE (
        ($2::uuid IS NULL AND user_id = $1 AND organization_id IS NULL)
        OR (
          $2::uuid IS NOT NULL
          AND organization_id = $2::uuid
          AND EXISTS (
            SELECT 1
            FROM organization_members
            WHERE organization_members.organization_id = works.organization_id
              AND organization_members.user_id = $1
              AND organization_members.status = 'active'
          )
        )
      )
      ORDER BY updated_at DESC, created_at DESC
      `,
      [userId, organizationId],
    );

    return result.rows.map(mapWorkRow);
  }

  public async findWorksPageByUserId(
    userId: string,
    request: WorkListPageRequest,
    organizationId: string | null = null,
  ): Promise<WorkListPage> {
    if (
      !Number.isSafeInteger(request.limit)
      || request.limit < 1
      || request.limit > 100
    ) {
      throw new ConfigurationError('Work list page limit is invalid');
    }

    const result = await this.client.query<WorkRow>(
      `
      SELECT works.*
      FROM works
      WHERE (
        ($2::uuid IS NULL
          AND works.user_id = $1::uuid
          AND works.organization_id IS NULL)
        OR (
          $2::uuid IS NOT NULL
          AND works.organization_id = $2::uuid
          AND EXISTS (
            SELECT 1
            FROM organization_members
            WHERE organization_members.organization_id = works.organization_id
              AND organization_members.user_id = $1::uuid
              AND organization_members.status = 'active'
          )
        )
      )
      AND (
        $3::timestamptz IS NULL
        OR works.updated_at < $3::timestamptz
        OR (
          works.updated_at = $3::timestamptz
          AND (
            works.created_at < $4::timestamptz
            OR (
              works.created_at = $4::timestamptz
              AND works.id < $5::uuid
            )
          )
        )
      )
      ORDER BY works.updated_at DESC, works.created_at DESC, works.id DESC
      LIMIT $6
      `,
      [
        userId,
        organizationId,
        request.cursor?.updatedAt ?? null,
        request.cursor?.createdAt ?? null,
        request.cursor?.id ?? null,
        request.limit + 1,
      ],
    );

    const rows = result.rows.slice(0, request.limit);
    const lastRow = rows.at(-1);
    return {
      works: rows.map(mapWorkRow),
      nextCursor:
        result.rows.length > request.limit && lastRow !== undefined
          ? {
              updatedAt: lastRow.updated_at,
              createdAt: lastRow.created_at,
              id: lastRow.id,
            }
          : null,
    };
  }

  public async createWork(userId: string, input: CreateWorkInput): Promise<Work> {
    const result = await this.client.query<WorkRow>(
      `
      INSERT INTO works (
        user_id,
        organization_id,
        title,
        genre,
        world_setting,
        theme,
        main_entity_ids,
        starting_point,
        ending_point,
        overall_flow
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
      `,
      [
        userId,
        input.organizationId ?? null,
        normalizePossiblyMojibake(input.title),
        normalizeNullableText(input.genre),
        normalizeNullableText(input.worldSetting),
        normalizeNullableText(input.theme),
        input.mainEntityIds,
        normalizeNullableText(input.startingPoint),
        normalizeNullableText(input.endingPoint),
        normalizeNullableText(input.overallFlow),
      ],
    );

    return mapWorkRow(result.rows[0]);
  }

  public async findWorkByIdAndUserId(
    id: string,
    userId: string,
    organizationId: string | null = null,
  ): Promise<Work | null> {
    const result = await this.client.query<WorkRow>(
      `
      SELECT *
      FROM works
      WHERE id = $1
        AND (
          ($3::uuid IS NULL AND user_id = $2 AND organization_id IS NULL)
          OR (
            $3::uuid IS NOT NULL
            AND organization_id = $3::uuid
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
      [id, userId, organizationId],
    );

    return result.rows[0] === undefined ? null : mapWorkRow(result.rows[0]);
  }

  public async updateWork(
    id: string,
    userId: string,
    input: UpdateWorkInput,
    organizationId: string | null = null,
  ): Promise<Work | null> {
    const result = await this.client.query<WorkRow>(
      `
      UPDATE works
      SET title = COALESCE($3, title),
          genre = CASE WHEN $4::boolean THEN $5 ELSE genre END,
          world_setting = CASE WHEN $6::boolean THEN $7 ELSE world_setting END,
          theme = CASE WHEN $8::boolean THEN $9 ELSE theme END,
          main_entity_ids = CASE WHEN $10::boolean THEN $11 ELSE main_entity_ids END,
          starting_point = CASE WHEN $12::boolean THEN $13 ELSE starting_point END,
          ending_point = CASE WHEN $14::boolean THEN $15 ELSE ending_point END,
          overall_flow = CASE WHEN $16::boolean THEN $17 ELSE overall_flow END,
          status = COALESCE($18, status),
          edit_history = (
            SELECT COALESCE(jsonb_agg(history_entry.value ORDER BY history_entry.ordinality), '[]'::jsonb)
            FROM (
              SELECT history_entry.value, history_entry.ordinality
              FROM jsonb_array_elements(
                jsonb_build_array(
                  jsonb_build_object(
                    'version', version,
                    'title', title,
                    'genre', genre,
                    'world_setting', world_setting,
                    'theme', theme,
                    'main_entity_ids', main_entity_ids,
                    'starting_point', starting_point,
                    'ending_point', ending_point,
                    'overall_flow', overall_flow,
                    'status', status,
                    'updated_at', updated_at
                  )
                ) || edit_history
              ) WITH ORDINALITY AS history_entry(value, ordinality)
              ORDER BY history_entry.ordinality
              LIMIT 5
            ) history_entry
          ),
          version = version + 1,
          updated_at = NOW()
      WHERE id = $1
        AND (
          ($19::uuid IS NULL AND user_id = $2 AND organization_id IS NULL)
          OR (
            $19::uuid IS NOT NULL
            AND organization_id = $19::uuid
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
        id,
        userId,
        normalizeNullableText(input.title ?? null),
        input.genre !== undefined,
        normalizeNullableText(input.genre ?? null),
        input.worldSetting !== undefined,
        normalizeNullableText(input.worldSetting ?? null),
        input.theme !== undefined,
        normalizeNullableText(input.theme ?? null),
        input.mainEntityIds !== undefined,
        input.mainEntityIds ?? [],
        input.startingPoint !== undefined,
        normalizeNullableText(input.startingPoint ?? null),
        input.endingPoint !== undefined,
        normalizeNullableText(input.endingPoint ?? null),
        input.overallFlow !== undefined,
        normalizeNullableText(input.overallFlow ?? null),
        input.status ?? null,
        organizationId,
      ],
    );

    return result.rows[0] === undefined ? null : mapWorkRow(result.rows[0]);
  }

  public async createChapter(workId: string, input: CreateChapterInput): Promise<Chapter> {
    try {
      const result = await this.client.query<ChapterRow>(
        `
        INSERT INTO chapters (
          work_id,
          "order",
          title,
          purpose,
          starting_state,
          ending_state,
          emotion_curve,
          entities_involved,
          key_beats
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING *
        `,
        [
          workId,
          input.order,
          normalizeNullableText(input.title),
          normalizeNullableText(input.purpose),
          normalizeNullableText(input.startingState),
          normalizeNullableText(input.endingState),
          normalizeNullableText(input.emotionCurve),
          input.entitiesInvolved,
          input.keyBeats,
        ],
      );

      return mapChapterRow(result.rows[0]);
    } catch (error) {
      throw mapOrderConflict(error, 'Chapter order must be unique within the work');
    }
  }

  public async findChaptersByWorkIdAndUserId(
    workId: string,
    userId: string,
    organizationId: string | null = null,
  ): Promise<Chapter[]> {
    const result = await this.client.query<ChapterRow>(
      `
      SELECT chapters.*
      FROM chapters
      INNER JOIN works ON works.id = chapters.work_id
      WHERE chapters.work_id = $1
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
      ORDER BY chapters."order" ASC
      `,
      [workId, userId, organizationId],
    );

    return result.rows.map(mapChapterRow);
  }

  public async findChapterByIdAndUserId(
    id: string,
    userId: string,
    organizationId: string | null = null,
  ): Promise<Chapter | null> {
    const result = await this.client.query<ChapterRow>(
      `
      SELECT chapters.*
      FROM chapters
      INNER JOIN works ON works.id = chapters.work_id
      WHERE chapters.id = $1
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
      [id, userId, organizationId],
    );

    return result.rows[0] === undefined ? null : mapChapterRow(result.rows[0]);
  }

  public async updateChapter(
    id: string,
    userId: string,
    input: UpdateChapterInput,
    organizationId: string | null = null,
  ): Promise<Chapter | null> {
    try {
      const result = await this.client.query<ChapterRow>(
        `
        UPDATE chapters
        SET "order" = COALESCE($3, chapters."order"),
            title = CASE WHEN $4::boolean THEN $5 ELSE chapters.title END,
            purpose = CASE WHEN $6::boolean THEN $7 ELSE chapters.purpose END,
            starting_state = CASE WHEN $8::boolean THEN $9 ELSE chapters.starting_state END,
            ending_state = CASE WHEN $10::boolean THEN $11 ELSE chapters.ending_state END,
            emotion_curve = CASE WHEN $12::boolean THEN $13 ELSE chapters.emotion_curve END,
            entities_involved = CASE WHEN $14::boolean THEN $15 ELSE chapters.entities_involved END,
            key_beats = CASE WHEN $16::boolean THEN $17 ELSE chapters.key_beats END,
            status = COALESCE($18, chapters.status),
            edit_history = (
              SELECT COALESCE(jsonb_agg(history_entry.value ORDER BY history_entry.ordinality), '[]'::jsonb)
              FROM (
                SELECT history_entry.value, history_entry.ordinality
                FROM jsonb_array_elements(
                  jsonb_build_array(
                    jsonb_build_object(
                      'version', chapters.version,
                      'order', chapters."order",
                      'title', chapters.title,
                      'purpose', chapters.purpose,
                      'starting_state', chapters.starting_state,
                      'ending_state', chapters.ending_state,
                      'emotion_curve', chapters.emotion_curve,
                      'entities_involved', chapters.entities_involved,
                      'key_beats', chapters.key_beats,
                      'status', chapters.status,
                      'updated_at', chapters.updated_at
                    )
                  ) || chapters.edit_history
                ) WITH ORDINALITY AS history_entry(value, ordinality)
                ORDER BY history_entry.ordinality
                LIMIT 5
              ) history_entry
            ),
            version = chapters.version + 1,
            updated_at = NOW()
        FROM works
        WHERE chapters.id = $1
          AND chapters.work_id = works.id
          AND (
            ($19::uuid IS NULL AND works.user_id = $2 AND works.organization_id IS NULL)
            OR (
            $19::uuid IS NOT NULL
            AND works.organization_id = $19::uuid
            AND EXISTS (
              SELECT 1
              FROM organization_members
              WHERE organization_members.organization_id = works.organization_id
                AND organization_members.user_id = $2
                AND organization_members.status = 'active'
            )
          )
          )
        RETURNING chapters.*
        `,
        [
          id,
          userId,
          input.order ?? null,
          input.title !== undefined,
          normalizeNullableText(input.title ?? null),
          input.purpose !== undefined,
          normalizeNullableText(input.purpose ?? null),
          input.startingState !== undefined,
          normalizeNullableText(input.startingState ?? null),
          input.endingState !== undefined,
          normalizeNullableText(input.endingState ?? null),
          input.emotionCurve !== undefined,
          normalizeNullableText(input.emotionCurve ?? null),
          input.entitiesInvolved !== undefined,
          input.entitiesInvolved ?? [],
          input.keyBeats !== undefined,
          input.keyBeats ?? [],
          input.status ?? null,
          organizationId,
        ],
      );

      return result.rows[0] === undefined ? null : mapChapterRow(result.rows[0]);
    } catch (error) {
      throw mapOrderConflict(error, 'Chapter order must be unique within the work');
    }
  }

  public async deleteChapter(id: string, userId: string, organizationId: string | null = null): Promise<boolean> {
    const transactionRunner = this.requireTransactionRunnerForStoryDeletion();
    return transactionRunner.transaction(async (transactionClient) => {
      const authorized = await transactionClient.query<AuthorizedChapterIdRow>(
        `
        SELECT chapters.id AS authorized_chapter_id
        FROM chapters
        INNER JOIN works ON works.id = chapters.work_id
        WHERE chapters.id = $1::uuid
          AND (
            ($3::uuid IS NULL
              AND works.user_id = $2::uuid
              AND works.organization_id IS NULL)
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
        FOR UPDATE OF chapters
        `,
        [id, userId, organizationId],
      );
      if (authorized.rows[0] === undefined) {
        return false;
      }

      const initialChildren = await this.findChildEpisodeIds(transactionClient, id, false);
      await lockStoryEpisodeAdmissions(transactionClient, initialChildren);

      const lockedChildren = await this.findChildEpisodeIds(transactionClient, id, true);
      await this.lockStoryDeletionPages(transactionClient, lockedChildren);
      await this.assertStoryDeletionAllowed(
        transactionClient,
        lockedChildren,
        userId,
        organizationId,
      );

      const deleted = await transactionClient.query<IdRow>(
        `
        DELETE FROM chapters
        USING works
        WHERE chapters.id = $1::uuid
          AND chapters.work_id = works.id
          AND (
            ($3::uuid IS NULL
              AND works.user_id = $2::uuid
              AND works.organization_id IS NULL)
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
        RETURNING chapters.id
        `,
        [id, userId, organizationId],
      );
      return (deleted.rowCount ?? 0) > 0;
    });
  }

  public async moveChapter(
    id: string,
    userId: string,
    direction: StoryItemMoveDirection,
    organizationId: string | null = null,
  ): Promise<Chapter | null> {
    return runInTransaction(this.client, this.transactionRunner, async (transactionClient) => {
      const currentResult = await transactionClient.query<ChapterRow>(
        `
        SELECT chapters.*
        FROM chapters
        INNER JOIN works ON works.id = chapters.work_id
        WHERE chapters.id = $1
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
        FOR UPDATE OF chapters
        `,
        [id, userId, organizationId],
      );
      const current = currentResult.rows[0];
      if (current === undefined) {
        return null;
      }

      const neighborResult = await transactionClient.query<ChapterRow>(
        `
        SELECT chapters.*
        FROM chapters
        WHERE chapters.work_id = $1
          AND chapters."order" ${direction === 'up' ? '<' : '>'} $2
        ORDER BY chapters."order" ${direction === 'up' ? 'DESC' : 'ASC'}
        LIMIT 1
        FOR UPDATE
        `,
        [current.work_id, current.order],
      );
      const neighbor = neighborResult.rows[0];
      if (neighbor === undefined) {
        return mapChapterRow(current);
      }

      try {
        return await swapChapterOrders(
          transactionClient,
          current.work_id,
          current.id,
          current.order,
          neighbor.id,
          neighbor.order,
        );
      } catch (error) {
        throw mapOrderConflict(error, 'Chapter order must be unique within the work');
      }
    });
  }

  public async createEpisode(chapterId: string, input: CreateEpisodeInput): Promise<Episode> {
    const normalizedStoryInput = normalizeEpisodeStoryInput({
      storyInputMode: input.storyInputMode,
      purpose: input.purpose,
      introduction: input.introduction,
      middle: input.middle,
      climax: input.climax,
      endingHook: input.endingHook,
      storyFullDraft: input.storyFullDraft,
    });

    try {
      const result = await this.client.query<EpisodeRow>(
        `
        INSERT INTO episodes (
          chapter_id,
          "order",
          title,
          purpose,
          story_input_mode,
          story_full_draft,
          introduction,
          middle,
          climax,
          ending_hook,
          estimated_pages,
          entities_involved
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING *
        `,
        [
          chapterId,
          input.order,
          normalizeNullableText(input.title),
          normalizedStoryInput.purpose,
          normalizedStoryInput.storyInputMode,
          normalizedStoryInput.storyFullDraft,
          normalizedStoryInput.normalizedIntroduction,
          normalizedStoryInput.normalizedMiddle,
          normalizedStoryInput.normalizedClimax,
          normalizedStoryInput.normalizedEndingHook,
          input.estimatedPages,
          input.entitiesInvolved,
        ],
      );

      return mapEpisodeRow(result.rows[0]);
    } catch (error) {
      throw mapOrderConflict(error, 'Episode order must be unique within the chapter');
    }
  }

  public async findEpisodesByChapterIdAndUserId(
    chapterId: string,
    userId: string,
    organizationId: string | null = null,
  ): Promise<Episode[]> {
    const result = await this.client.query<EpisodeRow>(
      `
      SELECT episodes.*
      FROM episodes
      INNER JOIN chapters ON chapters.id = episodes.chapter_id
      INNER JOIN works ON works.id = chapters.work_id
      WHERE episodes.chapter_id = $1
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
      ORDER BY episodes."order" ASC
      `,
      [chapterId, userId, organizationId],
    );

    return result.rows.map(mapEpisodeRow);
  }

  public async findEpisodeByIdAndUserId(
    id: string,
    userId: string,
    organizationId: string | null = null,
  ): Promise<Episode | null> {
    const result = await this.client.query<EpisodeRow>(
      `
      SELECT episodes.*
      FROM episodes
      INNER JOIN chapters ON chapters.id = episodes.chapter_id
      INNER JOIN works ON works.id = chapters.work_id
      WHERE episodes.id = $1
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
      [id, userId, organizationId],
    );

    return result.rows[0] === undefined ? null : mapEpisodeRow(result.rows[0]);
  }

  public async updateEpisode(
    id: string,
    userId: string,
    input: UpdateEpisodeInput,
    organizationId: string | null = null,
  ): Promise<Episode | null> {
    const currentEpisode = await this.findEpisodeByIdAndUserId(id, userId, organizationId);
    if (currentEpisode === null) {
      return null;
    }

    // Partial updates use undefined as "leave unchanged"; null is an explicit editor clear.
    const normalizedStoryInput = normalizeEpisodeStoryInput({
      storyInputMode: input.storyInputMode ?? currentEpisode.storyInputMode,
      purpose: pickEpisodeUpdateValue(input.purpose, currentEpisode.purpose),
      introduction: pickEpisodeUpdateValue(input.introduction, currentEpisode.introduction),
      middle: pickEpisodeUpdateValue(input.middle, currentEpisode.middle),
      climax: pickEpisodeUpdateValue(input.climax, currentEpisode.climax),
      endingHook: pickEpisodeUpdateValue(input.endingHook, currentEpisode.endingHook),
      storyFullDraft: pickEpisodeUpdateValue(input.storyFullDraft, currentEpisode.storyFullDraft),
    });

    try {
      const result = await this.client.query<EpisodeRow>(
        `
        UPDATE episodes
        SET "order" = COALESCE($3, episodes."order"),
            title = CASE WHEN $4::boolean THEN $5 ELSE episodes.title END,
            purpose = CASE WHEN $6::boolean THEN $7 ELSE episodes.purpose END,
            story_input_mode = CASE WHEN $8::boolean THEN $9 ELSE episodes.story_input_mode END,
            story_full_draft = CASE WHEN $10::boolean THEN $11 ELSE episodes.story_full_draft END,
            introduction = CASE WHEN $12::boolean THEN $13 ELSE episodes.introduction END,
            middle = CASE WHEN $14::boolean THEN $15 ELSE episodes.middle END,
            climax = CASE WHEN $16::boolean THEN $17 ELSE episodes.climax END,
            ending_hook = CASE WHEN $18::boolean THEN $19 ELSE episodes.ending_hook END,
            estimated_pages = COALESCE($20, episodes.estimated_pages),
            entities_involved = CASE WHEN $21::boolean THEN $22 ELSE episodes.entities_involved END,
            status = COALESCE($23, episodes.status),
            edit_history = (
              SELECT COALESCE(jsonb_agg(history_entry.value ORDER BY history_entry.ordinality), '[]'::jsonb)
              FROM (
                SELECT history_entry.value, history_entry.ordinality
                FROM jsonb_array_elements(
                  jsonb_build_array(
                    jsonb_build_object(
                      'version', episodes.version,
                      'order', episodes."order",
                      'title', episodes.title,
                      'purpose', episodes.purpose,
                      'story_input_mode', episodes.story_input_mode,
                      'story_full_draft', episodes.story_full_draft,
                      'introduction', episodes.introduction,
                      'middle', episodes.middle,
                      'climax', episodes.climax,
                      'ending_hook', episodes.ending_hook,
                      'estimated_pages', episodes.estimated_pages,
                      'entities_involved', episodes.entities_involved,
                      'status', episodes.status,
                      'updated_at', episodes.updated_at
                    )
                  ) || episodes.edit_history
                ) WITH ORDINALITY AS history_entry(value, ordinality)
                ORDER BY history_entry.ordinality
                LIMIT 5
              ) history_entry
            ),
            version = episodes.version + 1,
            updated_at = NOW()
        FROM chapters
        INNER JOIN works ON works.id = chapters.work_id
        WHERE episodes.id = $1
          AND episodes.chapter_id = chapters.id
          AND (
            ($24::uuid IS NULL AND works.user_id = $2 AND works.organization_id IS NULL)
            OR (
            $24::uuid IS NOT NULL
            AND works.organization_id = $24::uuid
            AND EXISTS (
              SELECT 1
              FROM organization_members
              WHERE organization_members.organization_id = works.organization_id
                AND organization_members.user_id = $2
                AND organization_members.status = 'active'
            )
          )
          )
        RETURNING episodes.*
        `,
        [
          id,
          userId,
          input.order ?? null,
          input.title !== undefined,
          normalizeNullableText(input.title ?? null),
          input.purpose !== undefined || input.storyInputMode !== undefined || input.storyFullDraft !== undefined,
          normalizedStoryInput.purpose,
          input.storyInputMode !== undefined || input.storyFullDraft !== undefined,
          normalizedStoryInput.storyInputMode,
          input.storyInputMode !== undefined || input.storyFullDraft !== undefined,
          normalizedStoryInput.storyFullDraft,
          input.introduction !== undefined || input.storyInputMode !== undefined || input.storyFullDraft !== undefined,
          normalizedStoryInput.normalizedIntroduction,
          input.middle !== undefined || input.storyInputMode !== undefined || input.storyFullDraft !== undefined,
          normalizedStoryInput.normalizedMiddle,
          input.climax !== undefined || input.storyInputMode !== undefined || input.storyFullDraft !== undefined,
          normalizedStoryInput.normalizedClimax,
          input.endingHook !== undefined || input.storyInputMode !== undefined || input.storyFullDraft !== undefined,
          normalizedStoryInput.normalizedEndingHook,
          input.estimatedPages ?? null,
          input.entitiesInvolved !== undefined,
          input.entitiesInvolved ?? [],
          input.status ?? null,
          organizationId,
        ],
      );

      return result.rows[0] === undefined ? null : mapEpisodeRow(result.rows[0]);
    } catch (error) {
      throw mapOrderConflict(error, 'Episode order must be unique within the chapter');
    }
  }

  public async deleteEpisode(id: string, userId: string, organizationId: string | null = null): Promise<boolean> {
    const transactionRunner = this.requireTransactionRunnerForStoryDeletion();
    return transactionRunner.transaction(async (transactionClient) => {
      const initialTarget = await this.findAuthorizedEpisodeForDeletion(
        transactionClient,
        id,
        userId,
        organizationId,
        false,
      );
      if (initialTarget === null) {
        return false;
      }

      await lockStoryEpisodeAdmission(transactionClient, initialTarget);
      const lockedTarget = await this.findAuthorizedEpisodeForDeletion(
        transactionClient,
        id,
        userId,
        organizationId,
        true,
      );
      if (lockedTarget === null) {
        return false;
      }

      const episodeIds = [lockedTarget];
      await this.lockStoryDeletionPages(transactionClient, episodeIds);
      await this.assertStoryDeletionAllowed(
        transactionClient,
        episodeIds,
        userId,
        organizationId,
      );

      const deleted = await transactionClient.query<IdRow>(
        `
        DELETE FROM episodes
        USING chapters, works
        WHERE episodes.id = $1::uuid
          AND episodes.chapter_id = chapters.id
          AND chapters.work_id = works.id
          AND (
            ($3::uuid IS NULL
              AND works.user_id = $2::uuid
              AND works.organization_id IS NULL)
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
        RETURNING episodes.id
        `,
        [id, userId, organizationId],
      );
      return (deleted.rowCount ?? 0) > 0;
    });
  }

  private requireTransactionRunnerForStoryDeletion(): TransactionRunner {
    if (this.transactionRunner === undefined) {
      throw new ConfigurationError('Story deletion requires transaction support');
    }
    return this.transactionRunner;
  }

  private async findAuthorizedEpisodeForDeletion(
    client: DatabaseClient,
    episodeId: string,
    userId: string,
    organizationId: string | null,
    lock: boolean,
  ): Promise<string | null> {
    const result = await client.query<AuthorizedEpisodeIdRow>(
      `
      SELECT episodes.id AS authorized_episode_id
      FROM episodes
      INNER JOIN chapters ON chapters.id = episodes.chapter_id
      INNER JOIN works ON works.id = chapters.work_id
      WHERE episodes.id = $1::uuid
        AND (
          ($3::uuid IS NULL
            AND works.user_id = $2::uuid
            AND works.organization_id IS NULL)
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
      ${lock ? 'FOR UPDATE OF episodes' : ''}
      `,
      [episodeId, userId, organizationId],
    );
    return result.rows[0]?.authorized_episode_id ?? null;
  }

  private async findChildEpisodeIds(
    client: DatabaseClient,
    chapterId: string,
    lock: boolean,
  ): Promise<string[]> {
    const result = await client.query<ChildEpisodeIdRow>(
      `
      SELECT episodes.id AS child_episode_id
      FROM episodes
      WHERE episodes.chapter_id = $1::uuid
      ORDER BY episodes.id ASC
      ${lock ? 'FOR UPDATE OF episodes' : ''}
      `,
      [chapterId],
    );
    return result.rows.map((row) => row.child_episode_id);
  }

  private async lockStoryDeletionPages(
    client: DatabaseClient,
    episodeIds: string[],
  ): Promise<void> {
    if (episodeIds.length === 0) {
      return;
    }
    await client.query(
      `
      SELECT pages.id
      FROM pages
      WHERE pages.episode_id = ANY($1::uuid[])
      ORDER BY pages.id ASC
      FOR UPDATE OF pages
      `,
      [episodeIds],
    );
  }

  private async assertStoryDeletionAllowed(
    client: DatabaseClient,
    episodeIds: string[],
    userId: string,
    organizationId: string | null,
  ): Promise<void> {
    if (episodeIds.length === 0) {
      return;
    }
    const episodeIdTexts = episodeIds;
    const result = await client.query<StoryDeletionBlockerRow>(
      `
      SELECT (
        EXISTS (
          SELECT 1
          FROM pages
          WHERE pages.episode_id = ANY($1::uuid[])
            AND pages.generated_image IS NOT NULL
        )
        OR EXISTS (
          SELECT 1
          FROM generation_jobs
          WHERE generation_jobs.status IN ('queued', 'processing')
            AND (
              (
                generation_jobs.job_type IN (
                  'episode_story_autofill',
                  'episode_page_skeleton'
                )
                AND generation_jobs.params ->> 'episode_id' = ANY($2::text[])
              )
              OR (
                generation_jobs.job_type = 'page_generate'
                AND EXISTS (
                  SELECT 1
                  FROM pages AS job_pages
                  WHERE job_pages.id::text = generation_jobs.params ->> 'page_id'
                    AND job_pages.episode_id = ANY($1::uuid[])
                )
              )
            )
            AND (
              ($4::uuid IS NULL
                AND generation_jobs.user_id = $3::uuid
                AND generation_jobs.organization_id IS NULL)
              OR (
                $4::uuid IS NOT NULL
                AND generation_jobs.organization_id = $4::uuid
              )
            )
        )
        OR EXISTS (
          SELECT 1
          FROM episode_export_jobs
          WHERE episode_export_jobs.episode_id = ANY($1::uuid[])
            AND (
              episode_export_jobs.status IN ('queued', 'processing')
              OR (
                episode_export_jobs.status = 'completed'
                AND episode_export_jobs.artifact_s3_key IS NOT NULL
                AND episode_export_jobs.artifact_deleted_at IS NULL
              )
            )
            AND (
              ($4::uuid IS NULL
                AND episode_export_jobs.user_id = $3::uuid
                AND episode_export_jobs.organization_id IS NULL)
              OR (
                $4::uuid IS NOT NULL
                AND episode_export_jobs.organization_id = $4::uuid
              )
            )
        )
      ) AS deletion_blocked
      `,
      [episodeIds, episodeIdTexts, userId, organizationId],
    );
    if (result.rows[0]?.deletion_blocked === true) {
      throw new ConflictError(
        'Story content cannot be deleted while related jobs or generated files still exist',
      );
    }
  }

  public async moveEpisode(
    id: string,
    userId: string,
    direction: StoryItemMoveDirection,
    organizationId: string | null = null,
    crossChapter = false,
  ): Promise<Episode | null> {
    return runInTransaction(this.client, this.transactionRunner, async (transactionClient) => {
      const currentResult = await transactionClient.query<EpisodeMoveRow>(
        `
        SELECT episodes.*,
               chapters.work_id,
               chapters."order" AS chapter_order
        FROM episodes
        INNER JOIN chapters ON chapters.id = episodes.chapter_id
        INNER JOIN works ON works.id = chapters.work_id
        WHERE episodes.id = $1
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
        FOR UPDATE OF episodes, chapters, works
        `,
        [id, userId, organizationId],
      );
      const current = currentResult.rows[0];
      if (current === undefined) {
        return null;
      }

      const neighborResult = await transactionClient.query<EpisodeRow>(
        `
        SELECT episodes.*
        FROM episodes
        WHERE episodes.chapter_id = $1
          AND episodes."order" ${direction === 'up' ? '<' : '>'} $2
        ORDER BY episodes."order" ${direction === 'up' ? 'DESC' : 'ASC'}
        LIMIT 1
        FOR UPDATE
        `,
        [current.chapter_id, current.order],
      );
      const neighbor = neighborResult.rows[0];
      if (neighbor === undefined) {
        if (!crossChapter) {
          return mapEpisodeRow(current);
        }

        const destinationResult = await transactionClient.query<ChapterRow>(
          `
          SELECT chapters.*
          FROM chapters
          WHERE chapters.work_id = $1
            AND chapters."order" ${direction === 'up' ? '<' : '>'} $2
          ORDER BY chapters."order" ${direction === 'up' ? 'DESC' : 'ASC'}
          LIMIT 1
          FOR UPDATE
          `,
          [current.work_id, current.chapter_order],
        );
        const destinationChapter = destinationResult.rows[0];
        if (destinationChapter === undefined) {
          return mapEpisodeRow(current);
        }

        try {
          return await moveEpisodeAcrossChapters(transactionClient, current, destinationChapter.id, direction);
        } catch (error) {
          throw mapOrderConflict(error, 'Episode order must be unique within the chapter');
        }
      }

      try {
        return await swapEpisodeOrders(
          transactionClient,
          current.chapter_id,
          current.id,
          current.order,
          neighbor.id,
          neighbor.order,
        );
      } catch (error) {
        throw mapOrderConflict(error, 'Episode order must be unique within the chapter');
      }
    });
  }

  public async findCollaborationTargetByIdAndUserId(
    layer: StoryCollaborationLayer,
    targetId: string,
    userId: string,
    organizationId: string | null = null,
  ): Promise<StoryCollaborationTarget | null> {
    const result =
      layer === 'work'
        ? await this.client.query<CollaborationRow>(
            `
            SELECT works.id AS work_id,
                   works.title AS work_title,
                   NULL::text AS chapter_title,
                   NULL::text AS episode_title,
                   jsonb_build_object(
                     'title', works.title,
                     'genre', works.genre,
                     'world_setting', works.world_setting,
                     'theme', works.theme,
                     'starting_point', works.starting_point,
                     'ending_point', works.ending_point,
                     'overall_flow', works.overall_flow,
                     'main_entity_ids', works.main_entity_ids
                   ) AS payload,
                   (
                     SELECT COALESCE(
                       jsonb_agg(
                         jsonb_build_object(
                           'id', entities.id,
                           'name', entities.name,
                           'entity_type', entities.entity_type,
                           'free_description', entities.free_description,
                           'structured_fields', entities.structured_fields
                         )
                         ORDER BY entities.name ASC
                       ),
                       '[]'::jsonb
                     )
                     FROM entities
                     WHERE entities.work_id = works.id
                   ) AS entities,
                   '[]'::jsonb AS scene_summaries
            FROM works
            WHERE works.id = $1
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
            [targetId, userId, organizationId],
          )
        : layer === 'chapter'
          ? await this.client.query<CollaborationRow>(
              `
              SELECT works.id AS work_id,
                     works.title AS work_title,
                     chapters.title AS chapter_title,
                     NULL::text AS episode_title,
                     jsonb_build_object(
                       'work_title', works.title,
                       'work_genre', works.genre,
                       'chapter_order', chapters."order",
                       'chapter_title', chapters.title,
                       'purpose', chapters.purpose,
                       'starting_state', chapters.starting_state,
                       'ending_state', chapters.ending_state,
                       'emotion_curve', chapters.emotion_curve,
                       'entities_involved', chapters.entities_involved,
                       'key_beats', chapters.key_beats
                     ) AS payload,
                     (
                       SELECT COALESCE(
                         jsonb_agg(
                           jsonb_build_object(
                             'id', entities.id,
                             'name', entities.name,
                             'entity_type', entities.entity_type,
                             'free_description', entities.free_description,
                             'structured_fields', entities.structured_fields
                           )
                           ORDER BY entities.name ASC
                         ),
                         '[]'::jsonb
                       )
                       FROM entities
                       WHERE entities.id = ANY(chapters.entities_involved)
                         AND entities.work_id = works.id
                     ) AS entities,
                     '[]'::jsonb AS scene_summaries
              FROM chapters
              INNER JOIN works ON works.id = chapters.work_id
              WHERE chapters.id = $1
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
              [targetId, userId, organizationId],
            )
          : await this.client.query<CollaborationRow>(
              `
              SELECT works.id AS work_id,
                     works.title AS work_title,
                     chapters.title AS chapter_title,
                     episodes.title AS episode_title,
                     jsonb_build_object(
                       'work_title', works.title,
                       'chapter_title', chapters.title,
                       'episode_order', episodes."order",
                       'episode_title', episodes.title,
                       'purpose', episodes.purpose,
                       'introduction', episodes.introduction,
                       'middle', episodes.middle,
                       'climax', episodes.climax,
                       'ending_hook', episodes.ending_hook,
                       'estimated_pages', episodes.estimated_pages,
                       'entities_involved', episodes.entities_involved
                     ) AS payload,
                     (
                       SELECT COALESCE(
                         jsonb_agg(
                           jsonb_build_object(
                             'id', entities.id,
                             'name', entities.name,
                             'entity_type', entities.entity_type,
                             'free_description', entities.free_description,
                             'structured_fields', entities.structured_fields
                           )
                           ORDER BY entities.name ASC
                         ),
                         '[]'::jsonb
                       )
                       FROM entities
                       WHERE entities.id = ANY(episodes.entities_involved)
                         AND entities.work_id = works.id
                     ) AS entities,
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
                     ) AS scene_summaries
              FROM episodes
              INNER JOIN chapters ON chapters.id = episodes.chapter_id
              INNER JOIN works ON works.id = chapters.work_id
              WHERE episodes.id = $1
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
              [targetId, userId, organizationId],
            );

    const row = result.rows[0];
    return row === undefined
      ? null
      : {
          layer,
          targetId,
          workId: row.work_id,
          workTitle: normalizePossiblyMojibake(row.work_title),
          chapterTitle: normalizeNullableText(row.chapter_title),
          episodeTitle: normalizeNullableText(row.episode_title),
          payload: toCollaborationPayload(row.payload),
          entities: toStoryEntitySummaries(row.entities),
          sceneSummaries: toStringArray(row.scene_summaries),
        };
  }

  public async findEpisodePageSkeletonContextByIdAndUserId(
    episodeId: string,
    userId: string,
    organizationId: string | null = null,
  ): Promise<EpisodePageSkeletonContext | null> {
    const result = await this.client.query<EpisodeSkeletonContextRow>(
      `
      SELECT episodes.id AS episode_id,
             episodes.chapter_id,
             works.id AS work_id,
             works.title AS work_title,
             works.genre AS work_genre,
             works.world_setting,
             works.theme,
             chapters.title AS chapter_title,
             chapters.purpose AS chapter_purpose,
             episodes.title AS episode_title,
             episodes.purpose AS episode_purpose,
             episodes.introduction,
             episodes.middle,
             episodes.climax,
             episodes.ending_hook,
             episodes.estimated_pages,
             episodes.entities_involved,
             (
               SELECT COALESCE(
                 array_agg(DISTINCT scene_entity_id) FILTER (WHERE scene_entity_id IS NOT NULL),
                 ARRAY[]::uuid[]
               )
               FROM (
                 SELECT unnest(COALESCE(scenes.involved_entity_ids, ARRAY[]::uuid[])) AS scene_entity_id
                 FROM scenes
                 WHERE scenes.episode_id = episodes.id
               ) scene_entity_ids
             ) AS scene_involved_entity_ids,
             episodes.page_skeleton_generated,
             (
               SELECT COUNT(*)::int
               FROM pages
               WHERE pages.episode_id = episodes.id
             ) AS existing_page_count,
             (
               SELECT COALESCE(
                 jsonb_agg(
                   jsonb_build_object(
                     'id', entities.id,
                     'name', entities.name,
                     'entity_type', entities.entity_type,
                     'free_description', entities.free_description,
                     'structured_fields', entities.structured_fields
                   )
                   ORDER BY entities.created_at ASC
                 ),
                 '[]'::jsonb
               )
               FROM entities
               WHERE entities.work_id = works.id
             ) AS entities,
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
             ) AS scene_summaries
      FROM episodes
      INNER JOIN chapters ON chapters.id = episodes.chapter_id
      INNER JOIN works ON works.id = chapters.work_id
      WHERE episodes.id = $1
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
      [episodeId, userId, organizationId],
    );

    const row = result.rows[0];
    if (row === undefined) {
      return null;
    }

    const entities = toStoryEntitySummaries(row.entities);
    const candidateEntityIds = buildSkeletonCandidateEntityIds(
      row.entities_involved,
      row.scene_involved_entity_ids,
      entities.map((entity) => entity.id),
    );

    return {
      episodeId: row.episode_id,
      chapterId: row.chapter_id,
      workId: row.work_id,
      workTitle: normalizePossiblyMojibake(row.work_title),
      workGenre: normalizeNullableText(row.work_genre),
      worldSetting: normalizeNullableText(row.world_setting),
      theme: normalizeNullableText(row.theme),
      chapterTitle: normalizeNullableText(row.chapter_title),
      chapterPurpose: normalizeNullableText(row.chapter_purpose),
      episodeTitle: normalizeNullableText(row.episode_title),
      episodePurpose: normalizeNullableText(row.episode_purpose),
      introduction: normalizeNullableText(row.introduction),
      middle: normalizeNullableText(row.middle),
      climax: normalizeNullableText(row.climax),
      endingHook: normalizeNullableText(row.ending_hook),
      estimatedPages: row.estimated_pages,
      entitiesInvolved: candidateEntityIds,
      pageSkeletonGenerated: row.page_skeleton_generated,
      existingPageCount: row.existing_page_count,
      entities,
      sceneSummaries: toStringArray(row.scene_summaries),
    };
  }

  public async findEpisodeImprovementContextByIdAndUserId(
    episodeId: string,
    userId: string,
    organizationId: string | null = null,
  ): Promise<StoryEpisodeImprovementContext | null> {
    const result = await this.client.query<EpisodeImprovementContextRow>(
      `
      SELECT episodes.id AS episode_id,
             episodes.chapter_id,
             works.id AS work_id,
             works.title AS work_title,
             works.genre AS work_genre,
             works.world_setting,
             works.theme,
             works.overall_flow,
             chapters.title AS chapter_title,
             chapters.purpose AS chapter_purpose,
             chapters.starting_state AS chapter_starting_state,
             chapters.ending_state AS chapter_ending_state,
             chapters.emotion_curve AS chapter_emotion_curve,
             episodes.title AS episode_title,
             episodes.purpose AS episode_purpose,
             episodes.introduction,
             episodes.middle,
             episodes.climax,
             episodes.ending_hook,
             episodes.estimated_pages,
             (
               SELECT COALESCE(
                 jsonb_agg(
                   jsonb_build_object(
                     'id', entities.id,
                     'name', entities.name,
                     'entity_type', entities.entity_type,
                     'free_description', entities.free_description,
                     'structured_fields', entities.structured_fields
                   )
                   ORDER BY entities.name ASC
                 ),
                 '[]'::jsonb
               )
               FROM entities
               WHERE entities.id = ANY(episodes.entities_involved)
                 AND entities.work_id = works.id
             ) AS entities,
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
             (
               SELECT COALESCE(
                 jsonb_agg(summary_row.summary ORDER BY summary_row.sort_order),
                 '[]'::jsonb
               )
               FROM (
                 SELECT concat(
                          'Chapter ',
                          sibling_chapters."order",
                          ': ',
                          COALESCE(sibling_chapters.title, 'untitled'),
                          CASE
                            WHEN sibling_chapters.purpose IS NULL THEN ''
                            ELSE concat(' / ', sibling_chapters.purpose)
                          END
                        ) AS summary,
                        sibling_chapters."order" AS sort_order
                 FROM chapters AS sibling_chapters
                 WHERE sibling_chapters.work_id = works.id
                   AND sibling_chapters.id <> chapters.id
                 ORDER BY sibling_chapters."order" ASC
                 LIMIT 12
               ) AS summary_row
             ) AS chapter_summaries,
             (
               SELECT COALESCE(
                 jsonb_agg(summary_row.summary ORDER BY summary_row.chapter_order, summary_row.episode_order),
                 '[]'::jsonb
               )
               FROM (
                 SELECT concat(
                          'Chapter ',
                          sibling_chapters."order",
                          ' Episode ',
                          sibling_episodes."order",
                          ': ',
                          COALESCE(sibling_episodes.title, 'untitled'),
                          CASE
                            WHEN sibling_episodes.purpose IS NULL THEN ''
                            ELSE concat(' / ', sibling_episodes.purpose)
                          END,
                          CASE
                            WHEN sibling_episodes.ending_hook IS NULL THEN ''
                            ELSE concat(' / hook: ', sibling_episodes.ending_hook)
                          END
                        ) AS summary,
                        sibling_chapters."order" AS chapter_order,
                        sibling_episodes."order" AS episode_order
                 FROM episodes AS sibling_episodes
                 INNER JOIN chapters AS sibling_chapters ON sibling_chapters.id = sibling_episodes.chapter_id
                 WHERE sibling_chapters.work_id = works.id
                   AND sibling_episodes.id <> episodes.id
                 ORDER BY sibling_chapters."order" ASC, sibling_episodes."order" ASC
                 LIMIT 16
               ) AS summary_row
             ) AS sibling_episode_summaries
      FROM episodes
      INNER JOIN chapters ON chapters.id = episodes.chapter_id
      INNER JOIN works ON works.id = chapters.work_id
      WHERE episodes.id = $1
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
      [episodeId, userId, organizationId],
    );

    const row = result.rows[0];
    return row === undefined
      ? null
      : {
          episodeId: row.episode_id,
          chapterId: row.chapter_id,
          workId: row.work_id,
          workTitle: normalizePossiblyMojibake(row.work_title),
          workGenre: normalizeNullableText(row.work_genre),
          worldSetting: normalizeNullableText(row.world_setting),
          theme: normalizeNullableText(row.theme),
          overallFlow: normalizeNullableText(row.overall_flow),
          chapterTitle: normalizeNullableText(row.chapter_title),
          chapterPurpose: normalizeNullableText(row.chapter_purpose),
          chapterStartingState: normalizeNullableText(row.chapter_starting_state),
          chapterEndingState: normalizeNullableText(row.chapter_ending_state),
          chapterEmotionCurve: normalizeNullableText(row.chapter_emotion_curve),
          episodeTitle: normalizeNullableText(row.episode_title),
          episodePurpose: normalizeNullableText(row.episode_purpose),
          introduction: normalizeNullableText(row.introduction),
          middle: normalizeNullableText(row.middle),
          climax: normalizeNullableText(row.climax),
          endingHook: normalizeNullableText(row.ending_hook),
          estimatedPages: row.estimated_pages,
          entities: toStoryEntitySummaries(row.entities),
          sceneSummaries: toStringArray(row.scene_summaries),
          chapterSummaries: toStringArray(row.chapter_summaries),
          siblingEpisodeSummaries: toStringArray(row.sibling_episode_summaries),
        };
  }

  public async createPageSkeleton(
    episodeId: string,
    userId: string,
    pages: PageSkeletonPageDraft[],
    options?: { overwriteExisting?: boolean },
    organizationId: string | null = null,
  ): Promise<PageSkeletonPersistResult | null> {
    const overwriteExisting = options?.overwriteExisting === true;
    return runInTransaction(this.client, this.transactionRunner, async (transactionClient) => {
      const ownershipResult = await transactionClient.query<SkeletonLockRow>(
        `
        SELECT episodes.id,
               episodes.page_skeleton_generated,
               (
                 SELECT COUNT(*)::int
                 FROM pages
                 WHERE pages.episode_id = episodes.id
               ) AS existing_page_count
        FROM episodes
        INNER JOIN chapters ON chapters.id = episodes.chapter_id
        INNER JOIN works ON works.id = chapters.work_id
        WHERE episodes.id = $1
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
        FOR UPDATE
        `,
        [episodeId, userId, organizationId],
      );

      if (ownershipResult.rows[0] === undefined) {
        return null;
      }

      if (!overwriteExisting && ownershipResult.rows[0].page_skeleton_generated) {
        throw new ConflictError('Page skeleton has already been generated for this episode');
      }
      if (!overwriteExisting && ownershipResult.rows[0].existing_page_count > 0) {
        throw new ConflictError('Episode already has pages');
      }
      const replacedExisting = overwriteExisting && ownershipResult.rows[0].existing_page_count > 0;

      if (replacedExisting) {
        await transactionClient.query(
          `
          DELETE FROM pages
          WHERE episode_id = $1
          `,
          [episodeId],
        );
      }

      let panelsCreated = 0;

      for (const page of pages) {
        const frameDefinitions = buildPanelFrameTemplateInputs(page.suggestedLayout);
        const pageResult = await transactionClient.query<IdRow>(
          `
          INSERT INTO pages (
            episode_id,
            page_number,
            layout_config,
            status
          )
          VALUES (
            $1,
            $2,
            $3::jsonb,
            'designing'
          )
          RETURNING id
          `,
          [
            episodeId,
            page.pageNumber,
            JSON.stringify({
              type: 'template',
              template_id: page.suggestedLayout,
              panel_count: page.suggestedPanelCount,
              frame_definitions: frameDefinitions,
            }),
          ],
        );

        const pageId = pageResult.rows[0]?.id;
        if (pageId === undefined) {
          throw new ValidationError('Failed to create page skeleton page');
        }

        const panelIdsByOrder = new Map<number, string>();
        for (const panel of page.panels) {
          const panelResult = await transactionClient.query<IdRow>(
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
              panel_notes
            )
            VALUES (
              $1,
              $2,
              $3,
              $4,
              $5,
              $6::jsonb,
              $7::jsonb,
              TRUE,
              '[]'::jsonb,
              $8
            )
            RETURNING id
            `,
            [
              pageId,
              panel.order,
              panel.panelRole,
              panel.suggestedSize,
              panel.situationHint,
              JSON.stringify(buildSuggestedPanelEntities(panel.suggestedEntities)),
              JSON.stringify({
                source: 'ai_auto',
                gallery_item_id: null,
                composition_prompt: null,
                shot_type: null,
                angle: null,
                custom_note: null,
              }),
              panel.suggestedDialogueHint,
            ],
          );
          const panelId = panelResult.rows[0]?.id;
          if (panelId === undefined) {
            throw new ValidationError('Failed to create page skeleton panel');
          }
          panelIdsByOrder.set(panel.order, panelId);
          panelsCreated += 1;
        }

        for (const frame of frameDefinitions) {
          const panelId = panelIdsByOrder.get(frame.readingOrder) ?? null;
          const frameResult = await transactionClient.query<IdRow>(
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
            VALUES (
              $1,
              $2,
              $3::jsonb,
              $4,
              $5,
              $6,
              $7,
              $8
            )
            RETURNING id
            `,
            [
              pageId,
              panelId,
              JSON.stringify(frame.vertices),
              frame.borderStyle,
              frame.borderWidth,
              frame.borderColor,
              frame.zIndex,
              frame.readingOrder,
            ],
          );

          if (frameResult.rows[0] === undefined) {
            throw new ValidationError('Failed to create page skeleton frame');
          }
        }
      }

      await transactionClient.query(
        `
        UPDATE episodes
        SET page_skeleton_generated = TRUE,
            edit_history = (
              SELECT COALESCE(jsonb_agg(history_entry.value ORDER BY history_entry.ordinality), '[]'::jsonb)
              FROM (
                SELECT history_entry.value, history_entry.ordinality
                FROM jsonb_array_elements(
                  jsonb_build_array(
                    jsonb_build_object(
                      'version', episodes.version,
                      'page_skeleton_generated', episodes.page_skeleton_generated,
                      'updated_at', episodes.updated_at
                    )
                  ) || episodes.edit_history
                ) WITH ORDINALITY AS history_entry(value, ordinality)
                ORDER BY history_entry.ordinality
                LIMIT 5
              ) history_entry
            ),
            version = episodes.version + 1,
            updated_at = NOW()
        FROM chapters
        INNER JOIN works ON works.id = chapters.work_id
        WHERE episodes.id = $1
          AND episodes.chapter_id = chapters.id
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
        [episodeId, userId, organizationId],
      );

      return {
        pagesCreated: pages.length,
        panelsCreated,
        replacedExisting,
      };
    });
  }

  public async rollbackFreshPageSkeleton(
    episodeId: string,
    userId: string,
    expectedPageCount: number,
    organizationId: string | null = null,
  ): Promise<boolean> {
    if (!Number.isSafeInteger(expectedPageCount) || expectedPageCount <= 0) {
      return false;
    }

    return runInTransaction(this.client, this.transactionRunner, async (transactionClient) => {
      const ownershipResult = await transactionClient.query<SkeletonLockRow>(
        `
        SELECT episodes.id,
               episodes.page_skeleton_generated,
               (
                 SELECT COUNT(*)::int
                 FROM pages
                 WHERE pages.episode_id = episodes.id
               ) AS existing_page_count,
               (
                 SELECT COUNT(*)::int
                 FROM pages
                 WHERE pages.episode_id = episodes.id
                   AND pages.status = 'designing'
                   AND pages.generated_image IS NULL
               ) AS rollback_safe_page_count
        FROM episodes
        INNER JOIN chapters ON chapters.id = episodes.chapter_id
        INNER JOIN works ON works.id = chapters.work_id
        WHERE episodes.id = $1
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
        FOR UPDATE
        `,
        [episodeId, userId, organizationId],
      );

      const lockedEpisode = ownershipResult.rows[0];
      if (lockedEpisode === undefined) {
        return false;
      }
      if (!lockedEpisode.page_skeleton_generated || lockedEpisode.existing_page_count === 0) {
        return false;
      }
      if (lockedEpisode.existing_page_count !== expectedPageCount) {
        return false;
      }
      if ((lockedEpisode.rollback_safe_page_count ?? 0) !== expectedPageCount) {
        return false;
      }

      await transactionClient.query(
        `
        DELETE FROM pages
        WHERE episode_id = $1
          AND status = 'designing'
          AND generated_image IS NULL
        `,
        [episodeId],
      );

      await transactionClient.query(
        `
        UPDATE episodes
        SET page_skeleton_generated = FALSE,
            edit_history = (
              SELECT COALESCE(jsonb_agg(history_entry.value ORDER BY history_entry.ordinality), '[]'::jsonb)
              FROM (
                SELECT history_entry.value, history_entry.ordinality
                FROM jsonb_array_elements(
                  jsonb_build_array(
                    jsonb_build_object(
                      'version', episodes.version,
                      'page_skeleton_generated', episodes.page_skeleton_generated,
                      'updated_at', episodes.updated_at,
                      'rollback_reason', 'story_plan_failed'
                    )
                  ) || episodes.edit_history
                ) WITH ORDINALITY AS history_entry(value, ordinality)
                ORDER BY history_entry.ordinality
                LIMIT 5
              ) history_entry
            ),
            version = episodes.version + 1,
            updated_at = NOW()
        FROM chapters
        INNER JOIN works ON works.id = chapters.work_id
        WHERE episodes.id = $1
          AND episodes.chapter_id = chapters.id
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
        [episodeId, userId, organizationId],
      );

      return true;
    });
  }
}

function mapWorkRow(row: WorkRow): Work {
  return {
    id: row.id,
    userId: row.user_id,
    organizationId: row.organization_id,
    title: normalizePossiblyMojibake(row.title),
    genre: normalizeNullableText(row.genre),
    worldSetting: normalizeNullableText(row.world_setting),
    theme: normalizeNullableText(row.theme),
    mainEntityIds: row.main_entity_ids,
    startingPoint: normalizeNullableText(row.starting_point),
    endingPoint: normalizeNullableText(row.ending_point),
    overallFlow: normalizeNullableText(row.overall_flow),
    version: row.version,
    editHistory: toObjectArray(row.edit_history),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function swapChapterOrders(
  client: DatabaseClient,
  workId: string,
  currentChapterId: string,
  currentOrder: number,
  neighborChapterId: string,
  neighborOrder: number,
): Promise<Chapter> {
  // Existing order constraints are non-deferrable, so use a parent-local temporary
  // order before assigning the two final values.
  const temporaryOrder = await nextTemporaryChapterOrder(client, workId);
  await client.query(
    `
    UPDATE chapters
    SET "order" = $2
    WHERE id = $1
    `,
    [currentChapterId, temporaryOrder],
  );

  await client.query(
    `
    UPDATE chapters
    SET "order" = $2,
        version = version + 1,
        updated_at = NOW()
    WHERE id = $1
    `,
    [neighborChapterId, currentOrder],
  );

  const result = await client.query<ChapterRow>(
    `
    UPDATE chapters
    SET "order" = $2,
        version = version + 1,
        updated_at = NOW()
    WHERE id = $1
    RETURNING *
    `,
    [currentChapterId, neighborOrder],
  );

  const movedChapter = result.rows[0];
  if (movedChapter === undefined) {
    throw new ValidationError('Failed to move chapter');
  }

  return mapChapterRow(movedChapter);
}

async function swapEpisodeOrders(
  client: DatabaseClient,
  chapterId: string,
  currentEpisodeId: string,
  currentOrder: number,
  neighborEpisodeId: string,
  neighborOrder: number,
): Promise<Episode> {
  const temporaryOrder = await nextTemporaryEpisodeOrder(client, chapterId);
  await client.query(
    `
    UPDATE episodes
    SET "order" = $2
    WHERE id = $1
    `,
    [currentEpisodeId, temporaryOrder],
  );

  await client.query(
    `
    UPDATE episodes
    SET "order" = $2,
        version = version + 1,
        updated_at = NOW()
    WHERE id = $1
    `,
    [neighborEpisodeId, currentOrder],
  );

  const result = await client.query<EpisodeRow>(
    `
    UPDATE episodes
    SET "order" = $2,
        version = version + 1,
        updated_at = NOW()
    WHERE id = $1
    RETURNING *
    `,
    [currentEpisodeId, neighborOrder],
  );

  const movedEpisode = result.rows[0];
  if (movedEpisode === undefined) {
    throw new ValidationError('Failed to move episode');
  }

  return mapEpisodeRow(movedEpisode);
}

async function moveEpisodeAcrossChapters(
  client: DatabaseClient,
  current: EpisodeMoveRow,
  destinationChapterId: string,
  direction: StoryItemMoveDirection,
): Promise<Episode> {
  const lockedEpisodesResult = await client.query<EpisodeOrderRow>(
    `
    SELECT id, chapter_id, "order"
    FROM episodes
    WHERE chapter_id = ANY($1::uuid[])
    ORDER BY chapter_id ASC, "order" ASC, id ASC
    FOR UPDATE
    `,
    [[current.chapter_id, destinationChapterId]],
  );
  const sourceEpisodes = lockedEpisodesResult.rows
    .filter((episode) => episode.chapter_id === current.chapter_id && episode.id !== current.id)
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
  const destinationEpisodes = lockedEpisodesResult.rows
    .filter((episode) => episode.chapter_id === destinationChapterId)
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));

  const temporaryOrder = await nextTemporaryEpisodeOrder(client, current.chapter_id);
  await client.query(
    `
    UPDATE episodes
    SET "order" = $2
    WHERE id = $1
    `,
    [current.id, temporaryOrder],
  );

  for (const sourceEpisode of sourceEpisodes.filter((episode) => episode.order > current.order)) {
    await client.query(
      `
      UPDATE episodes
      SET "order" = $2,
          version = version + 1,
          updated_at = NOW()
      WHERE id = $1
      `,
      [sourceEpisode.id, sourceEpisode.order - 1],
    );
  }

  if (direction === 'down') {
    for (const destinationEpisode of [...destinationEpisodes].sort((left, right) => right.order - left.order)) {
      await client.query(
        `
        UPDATE episodes
        SET "order" = $2,
            version = version + 1,
            updated_at = NOW()
        WHERE id = $1
        `,
        [destinationEpisode.id, destinationEpisode.order + 1],
      );
    }
  }

  const destinationOrder =
    direction === 'down'
      ? 1
      : destinationEpisodes.reduce((maximum, episode) => Math.max(maximum, episode.order), 0) + 1;
  const result = await client.query<EpisodeRow>(
    `
    UPDATE episodes
    SET chapter_id = $2,
        "order" = $3,
        version = version + 1,
        updated_at = NOW()
    WHERE id = $1
    RETURNING *
    `,
    [current.id, destinationChapterId, destinationOrder],
  );
  const movedEpisode = result.rows[0];
  if (movedEpisode === undefined) {
    throw new ValidationError('Failed to move episode across chapters');
  }

  return mapEpisodeRow(movedEpisode);
}

async function nextTemporaryChapterOrder(client: DatabaseClient, workId: string): Promise<number> {
  const result = await client.query<TemporaryOrderRow>(
    `
    SELECT COALESCE(MAX("order"), 0)::int + 100000 AS temporary_order
    FROM chapters
    WHERE work_id = $1
    `,
    [workId],
  );

  return result.rows[0]?.temporary_order ?? 100000;
}

async function nextTemporaryEpisodeOrder(client: DatabaseClient, chapterId: string): Promise<number> {
  const result = await client.query<TemporaryOrderRow>(
    `
    SELECT COALESCE(MAX("order"), 0)::int + 100000 AS temporary_order
    FROM episodes
    WHERE chapter_id = $1
    `,
    [chapterId],
  );

  return result.rows[0]?.temporary_order ?? 100000;
}

function mapChapterRow(row: ChapterRow): Chapter {
  return {
    id: row.id,
    workId: row.work_id,
    order: row.order,
    title: normalizeNullableText(row.title),
    purpose: normalizeNullableText(row.purpose),
    startingState: normalizeNullableText(row.starting_state),
    endingState: normalizeNullableText(row.ending_state),
    emotionCurve: normalizeNullableText(row.emotion_curve),
    entitiesInvolved: row.entities_involved,
    keyBeats: row.key_beats,
    version: row.version,
    editHistory: toObjectArray(row.edit_history),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapEpisodeRow(row: EpisodeRow): Episode {
  return {
    id: row.id,
    chapterId: row.chapter_id,
    order: row.order,
    title: normalizeNullableText(row.title),
    purpose: normalizeNullableText(row.purpose),
    storyInputMode: row.story_input_mode,
    storyFullDraft: normalizeNullableText(row.story_full_draft),
    introduction: normalizeNullableText(row.introduction),
    middle: normalizeNullableText(row.middle),
    climax: normalizeNullableText(row.climax),
    endingHook: normalizeNullableText(row.ending_hook),
    estimatedPages: row.estimated_pages,
    entitiesInvolved: row.entities_involved,
    pageSkeletonGenerated: row.page_skeleton_generated,
    version: row.version,
    editHistory: toObjectArray(row.edit_history),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function pickEpisodeUpdateValue<T>(nextValue: T | undefined, currentValue: T): T {
  return nextValue === undefined ? currentValue : nextValue;
}

function toStoryEntitySummaries(value: unknown): StoryEntitySummary[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (!isJsonObject(entry)) {
      return [];
    }

    if (
      typeof entry.id !== 'string' ||
      typeof entry.name !== 'string' ||
      typeof entry.entity_type !== 'string' ||
      !(entry.free_description === null || typeof entry.free_description === 'string')
    ) {
      return [];
    }

    return [
      {
        id: entry.id,
        name: normalizePossiblyMojibake(entry.name),
        aliases: extractEntityAliases(isJsonObject(entry.structured_fields) ? entry.structured_fields : {}),
        entityType: entry.entity_type,
        freeDescription: normalizeNullableText(entry.free_description),
      },
    ];
  });
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (typeof entry !== 'string' || entry.length === 0) {
      return [];
    }

    return [normalizePossiblyMojibake(entry)];
  });
}

function toCollaborationPayload(
  value: unknown,
): Record<string, string | number | boolean | string[] | null> {
  if (!isJsonObject(value)) {
    return {};
  }

  const payload: Record<string, string | number | boolean | string[] | null> = {};

  for (const [key, entry] of Object.entries(value)) {
    if (
      typeof entry === 'string' ||
      typeof entry === 'number' ||
      typeof entry === 'boolean' ||
      entry === null ||
      (Array.isArray(entry) && entry.every((item) => typeof item === 'string'))
    ) {
      payload[key] =
        typeof entry === 'string'
          ? normalizePossiblyMojibake(entry)
          : Array.isArray(entry)
            ? entry.map((item) => normalizePossiblyMojibake(item))
            : entry;
    }
  }

  return payload;
}

function buildSuggestedPanelEntities(entityIds: string[]): Array<Record<string, unknown>> {
  return entityIds.map((entityId, index) => ({
    entity_id: entityId,
    role: index === 0 ? 'primary' : 'secondary',
    expression: 'calm',
    custom_expression: null,
    action: 'standing_firm',
    custom_action: null,
    position: toSuggestedPosition(index),
    facing_direction: null,
    effect_note: null,
    state_id: null,
  }));
}

function toSuggestedPosition(index: number): 'left' | 'center' | 'right' | 'background' {
  if (index === 0) {
    return 'center';
  }
  if (index === 1) {
    return 'left';
  }
  if (index === 2) {
    return 'right';
  }

  return 'background';
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

function buildSkeletonCandidateEntityIds(
  episodeEntityIds: string[] | null | undefined,
  sceneEntityIds: string[] | null | undefined,
  workEntityIds: string[] | null | undefined,
): string[] {
  const ordered = [
    ...normalizeEntityIdArray(episodeEntityIds),
    ...normalizeEntityIdArray(sceneEntityIds),
    ...normalizeEntityIdArray(workEntityIds),
  ];
  const seen = new Set<string>();
  const result: string[] = [];

  for (const entityId of ordered) {
    if (typeof entityId !== 'string' || entityId.length === 0 || seen.has(entityId)) {
      continue;
    }
    seen.add(entityId);
    result.push(entityId);
  }

  return result;
}

function normalizeEntityIdArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
}

async function runInTransaction<T>(
  client: DatabaseClient,
  transactionRunner: TransactionRunner | undefined,
  work: (transactionClient: DatabaseClient) => Promise<T>,
): Promise<T> {
  if (transactionRunner !== undefined) {
    return transactionRunner.transaction(work);
  }

  return work(client);
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
