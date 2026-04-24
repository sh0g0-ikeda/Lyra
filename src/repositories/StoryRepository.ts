import type { QueryResultRow } from 'pg';
import type {
  Chapter,
  CreateChapterInput,
  CreateEpisodeInput,
  CreateWorkInput,
  Episode,
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
  StoryCollaborationLayer,
  StoryCollaborationTarget,
  StoryEntitySummary,
} from '../domain/types/storyAi.js';
import { ConflictError, ValidationError } from '../domain/errors/index.js';
import type { DatabaseClient, TransactionRunner } from '../lib/db.js';
import { isUniqueViolation } from '../lib/dbErrors.js';

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

export interface StoryRepository {
  createWork(userId: string, input: CreateWorkInput): Promise<Work>;
  findWorkByIdAndUserId(id: string, userId: string): Promise<Work | null>;
  updateWork(id: string, userId: string, input: UpdateWorkInput): Promise<Work | null>;
  createChapter(workId: string, input: CreateChapterInput): Promise<Chapter>;
  findChaptersByWorkIdAndUserId(workId: string, userId: string): Promise<Chapter[]>;
  findChapterByIdAndUserId(id: string, userId: string): Promise<Chapter | null>;
  updateChapter(id: string, userId: string, input: UpdateChapterInput): Promise<Chapter | null>;
  deleteChapter(id: string, userId: string): Promise<boolean>;
  createEpisode(chapterId: string, input: CreateEpisodeInput): Promise<Episode>;
  findEpisodesByChapterIdAndUserId(chapterId: string, userId: string): Promise<Episode[]>;
  findEpisodeByIdAndUserId(id: string, userId: string): Promise<Episode | null>;
  updateEpisode(id: string, userId: string, input: UpdateEpisodeInput): Promise<Episode | null>;
  deleteEpisode(id: string, userId: string): Promise<boolean>;
  findCollaborationTargetByIdAndUserId(
    layer: StoryCollaborationLayer,
    targetId: string,
    userId: string,
  ): Promise<StoryCollaborationTarget | null>;
  findEpisodePageSkeletonContextByIdAndUserId(
    episodeId: string,
    userId: string,
  ): Promise<EpisodePageSkeletonContext | null>;
  createPageSkeleton(
    episodeId: string,
    userId: string,
    pages: PageSkeletonPageDraft[],
  ): Promise<PageSkeletonPersistResult | null>;
}

interface WorkRow extends QueryResultRow {
  id: string;
  user_id: string;
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

interface CollaborationRow extends QueryResultRow {
  work_id: string;
  work_title: string;
  chapter_title: string | null;
  episode_title: string | null;
  payload: unknown;
  entities: unknown;
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
  page_skeleton_generated: boolean;
  existing_page_count: number;
  entities: unknown;
}

interface IdRow extends QueryResultRow {
  id: string;
}

interface SkeletonLockRow extends QueryResultRow {
  id: string;
  page_skeleton_generated: boolean;
  existing_page_count: number;
}

export class PostgresStoryRepository implements StoryRepository {
  public constructor(
    private readonly client: DatabaseClient,
    private readonly transactionRunner?: TransactionRunner,
  ) {}

  public async createWork(userId: string, input: CreateWorkInput): Promise<Work> {
    const result = await this.client.query<WorkRow>(
      `
      INSERT INTO works (
        user_id,
        title,
        genre,
        world_setting,
        theme,
        main_entity_ids,
        starting_point,
        ending_point,
        overall_flow
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
      `,
      [
        userId,
        input.title,
        input.genre,
        input.worldSetting,
        input.theme,
        input.mainEntityIds,
        input.startingPoint,
        input.endingPoint,
        input.overallFlow,
      ],
    );

    return mapWorkRow(result.rows[0]);
  }

  public async findWorkByIdAndUserId(id: string, userId: string): Promise<Work | null> {
    const result = await this.client.query<WorkRow>(
      `
      SELECT *
      FROM works
      WHERE id = $1
        AND user_id = $2
      `,
      [id, userId],
    );

    return result.rows[0] === undefined ? null : mapWorkRow(result.rows[0]);
  }

  public async updateWork(id: string, userId: string, input: UpdateWorkInput): Promise<Work | null> {
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
        AND user_id = $2
      RETURNING *
      `,
      [
        id,
        userId,
        input.title ?? null,
        input.genre !== undefined,
        input.genre ?? null,
        input.worldSetting !== undefined,
        input.worldSetting ?? null,
        input.theme !== undefined,
        input.theme ?? null,
        input.mainEntityIds !== undefined,
        input.mainEntityIds ?? [],
        input.startingPoint !== undefined,
        input.startingPoint ?? null,
        input.endingPoint !== undefined,
        input.endingPoint ?? null,
        input.overallFlow !== undefined,
        input.overallFlow ?? null,
        input.status ?? null,
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
          input.title,
          input.purpose,
          input.startingState,
          input.endingState,
          input.emotionCurve,
          input.entitiesInvolved,
          input.keyBeats,
        ],
      );

      return mapChapterRow(result.rows[0]);
    } catch (error) {
      throw mapOrderConflict(error, 'Chapter order must be unique within the work');
    }
  }

  public async findChaptersByWorkIdAndUserId(workId: string, userId: string): Promise<Chapter[]> {
    const result = await this.client.query<ChapterRow>(
      `
      SELECT chapters.*
      FROM chapters
      INNER JOIN works ON works.id = chapters.work_id
      WHERE chapters.work_id = $1
        AND works.user_id = $2
      ORDER BY chapters."order" ASC
      `,
      [workId, userId],
    );

    return result.rows.map(mapChapterRow);
  }

  public async findChapterByIdAndUserId(id: string, userId: string): Promise<Chapter | null> {
    const result = await this.client.query<ChapterRow>(
      `
      SELECT chapters.*
      FROM chapters
      INNER JOIN works ON works.id = chapters.work_id
      WHERE chapters.id = $1
        AND works.user_id = $2
      `,
      [id, userId],
    );

    return result.rows[0] === undefined ? null : mapChapterRow(result.rows[0]);
  }

  public async updateChapter(id: string, userId: string, input: UpdateChapterInput): Promise<Chapter | null> {
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
          AND works.user_id = $2
        RETURNING chapters.*
        `,
        [
          id,
          userId,
          input.order ?? null,
          input.title !== undefined,
          input.title ?? null,
          input.purpose !== undefined,
          input.purpose ?? null,
          input.startingState !== undefined,
          input.startingState ?? null,
          input.endingState !== undefined,
          input.endingState ?? null,
          input.emotionCurve !== undefined,
          input.emotionCurve ?? null,
          input.entitiesInvolved !== undefined,
          input.entitiesInvolved ?? [],
          input.keyBeats !== undefined,
          input.keyBeats ?? [],
          input.status ?? null,
        ],
      );

      return result.rows[0] === undefined ? null : mapChapterRow(result.rows[0]);
    } catch (error) {
      throw mapOrderConflict(error, 'Chapter order must be unique within the work');
    }
  }

  public async deleteChapter(id: string, userId: string): Promise<boolean> {
    const result = await this.client.query(
      `
      DELETE FROM chapters
      USING works
      WHERE chapters.id = $1
        AND chapters.work_id = works.id
        AND works.user_id = $2
      `,
      [id, userId],
    );

    return (result.rowCount ?? 0) > 0;
  }

  public async createEpisode(chapterId: string, input: CreateEpisodeInput): Promise<Episode> {
    try {
      const result = await this.client.query<EpisodeRow>(
        `
        INSERT INTO episodes (
          chapter_id,
          "order",
          title,
          purpose,
          introduction,
          middle,
          climax,
          ending_hook,
          estimated_pages,
          entities_involved
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING *
        `,
        [
          chapterId,
          input.order,
          input.title,
          input.purpose,
          input.introduction,
          input.middle,
          input.climax,
          input.endingHook,
          input.estimatedPages,
          input.entitiesInvolved,
        ],
      );

      return mapEpisodeRow(result.rows[0]);
    } catch (error) {
      throw mapOrderConflict(error, 'Episode order must be unique within the chapter');
    }
  }

  public async findEpisodesByChapterIdAndUserId(chapterId: string, userId: string): Promise<Episode[]> {
    const result = await this.client.query<EpisodeRow>(
      `
      SELECT episodes.*
      FROM episodes
      INNER JOIN chapters ON chapters.id = episodes.chapter_id
      INNER JOIN works ON works.id = chapters.work_id
      WHERE episodes.chapter_id = $1
        AND works.user_id = $2
      ORDER BY episodes."order" ASC
      `,
      [chapterId, userId],
    );

    return result.rows.map(mapEpisodeRow);
  }

  public async findEpisodeByIdAndUserId(id: string, userId: string): Promise<Episode | null> {
    const result = await this.client.query<EpisodeRow>(
      `
      SELECT episodes.*
      FROM episodes
      INNER JOIN chapters ON chapters.id = episodes.chapter_id
      INNER JOIN works ON works.id = chapters.work_id
      WHERE episodes.id = $1
        AND works.user_id = $2
      `,
      [id, userId],
    );

    return result.rows[0] === undefined ? null : mapEpisodeRow(result.rows[0]);
  }

  public async updateEpisode(id: string, userId: string, input: UpdateEpisodeInput): Promise<Episode | null> {
    try {
      const result = await this.client.query<EpisodeRow>(
        `
        UPDATE episodes
        SET "order" = COALESCE($3, episodes."order"),
            title = CASE WHEN $4::boolean THEN $5 ELSE episodes.title END,
            purpose = CASE WHEN $6::boolean THEN $7 ELSE episodes.purpose END,
            introduction = CASE WHEN $8::boolean THEN $9 ELSE episodes.introduction END,
            middle = CASE WHEN $10::boolean THEN $11 ELSE episodes.middle END,
            climax = CASE WHEN $12::boolean THEN $13 ELSE episodes.climax END,
            ending_hook = CASE WHEN $14::boolean THEN $15 ELSE episodes.ending_hook END,
            estimated_pages = COALESCE($16, episodes.estimated_pages),
            entities_involved = CASE WHEN $17::boolean THEN $18 ELSE episodes.entities_involved END,
            status = COALESCE($19, episodes.status),
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
          AND works.user_id = $2
        RETURNING episodes.*
        `,
        [
          id,
          userId,
          input.order ?? null,
          input.title !== undefined,
          input.title ?? null,
          input.purpose !== undefined,
          input.purpose ?? null,
          input.introduction !== undefined,
          input.introduction ?? null,
          input.middle !== undefined,
          input.middle ?? null,
          input.climax !== undefined,
          input.climax ?? null,
          input.endingHook !== undefined,
          input.endingHook ?? null,
          input.estimatedPages ?? null,
          input.entitiesInvolved !== undefined,
          input.entitiesInvolved ?? [],
          input.status ?? null,
        ],
      );

      return result.rows[0] === undefined ? null : mapEpisodeRow(result.rows[0]);
    } catch (error) {
      throw mapOrderConflict(error, 'Episode order must be unique within the chapter');
    }
  }

  public async deleteEpisode(id: string, userId: string): Promise<boolean> {
    const result = await this.client.query(
      `
      DELETE FROM episodes
      USING chapters, works
      WHERE episodes.id = $1
        AND episodes.chapter_id = chapters.id
        AND chapters.work_id = works.id
        AND works.user_id = $2
      `,
      [id, userId],
    );

    return (result.rowCount ?? 0) > 0;
  }

  public async findCollaborationTargetByIdAndUserId(
    layer: StoryCollaborationLayer,
    targetId: string,
    userId: string,
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
                           'free_description', entities.free_description
                         )
                         ORDER BY entities.name ASC
                       ),
                       '[]'::jsonb
                     )
                     FROM entities
                     WHERE entities.work_id = works.id
                       AND entities.user_id = works.user_id
                   ) AS entities
            FROM works
            WHERE works.id = $1
              AND works.user_id = $2
            `,
            [targetId, userId],
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
                             'free_description', entities.free_description
                           )
                           ORDER BY entities.name ASC
                         ),
                         '[]'::jsonb
                       )
                       FROM entities
                       WHERE entities.id = ANY(chapters.entities_involved)
                         AND entities.work_id = works.id
                         AND entities.user_id = works.user_id
                     ) AS entities
              FROM chapters
              INNER JOIN works ON works.id = chapters.work_id
              WHERE chapters.id = $1
                AND works.user_id = $2
              `,
              [targetId, userId],
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
                             'free_description', entities.free_description
                           )
                           ORDER BY entities.name ASC
                         ),
                         '[]'::jsonb
                       )
                       FROM entities
                       WHERE entities.id = ANY(episodes.entities_involved)
                         AND entities.work_id = works.id
                         AND entities.user_id = works.user_id
                     ) AS entities
              FROM episodes
              INNER JOIN chapters ON chapters.id = episodes.chapter_id
              INNER JOIN works ON works.id = chapters.work_id
              WHERE episodes.id = $1
                AND works.user_id = $2
              `,
              [targetId, userId],
            );

    const row = result.rows[0];
    return row === undefined
      ? null
      : {
          layer,
          targetId,
          workId: row.work_id,
          workTitle: row.work_title,
          chapterTitle: row.chapter_title,
          episodeTitle: row.episode_title,
          payload: toCollaborationPayload(row.payload),
          entities: toStoryEntitySummaries(row.entities),
        };
  }

  public async findEpisodePageSkeletonContextByIdAndUserId(
    episodeId: string,
    userId: string,
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
                     'free_description', entities.free_description
                   )
                   ORDER BY array_position(episodes.entities_involved, entities.id)
                 ),
                 '[]'::jsonb
               )
               FROM entities
               WHERE entities.id = ANY(episodes.entities_involved)
                 AND entities.work_id = works.id
                 AND entities.user_id = works.user_id
             ) AS entities
      FROM episodes
      INNER JOIN chapters ON chapters.id = episodes.chapter_id
      INNER JOIN works ON works.id = chapters.work_id
      WHERE episodes.id = $1
        AND works.user_id = $2
      `,
      [episodeId, userId],
    );

    const row = result.rows[0];
    return row === undefined
      ? null
      : {
          episodeId: row.episode_id,
          chapterId: row.chapter_id,
          workId: row.work_id,
          workTitle: row.work_title,
          workGenre: row.work_genre,
          worldSetting: row.world_setting,
          theme: row.theme,
          chapterTitle: row.chapter_title,
          chapterPurpose: row.chapter_purpose,
          episodeTitle: row.episode_title,
          episodePurpose: row.episode_purpose,
          introduction: row.introduction,
          middle: row.middle,
          climax: row.climax,
          endingHook: row.ending_hook,
          estimatedPages: row.estimated_pages,
          entitiesInvolved: row.entities_involved,
          pageSkeletonGenerated: row.page_skeleton_generated,
          existingPageCount: row.existing_page_count,
          entities: toStoryEntitySummaries(row.entities),
        };
  }

  public async createPageSkeleton(
    episodeId: string,
    userId: string,
    pages: PageSkeletonPageDraft[],
  ): Promise<PageSkeletonPersistResult | null> {
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
          AND works.user_id = $2
        FOR UPDATE
        `,
        [episodeId, userId],
      );

      if (ownershipResult.rows[0] === undefined) {
        return null;
      }

      if (ownershipResult.rows[0].page_skeleton_generated) {
        throw new ConflictError('Page skeleton has already been generated for this episode');
      }
      if (ownershipResult.rows[0].existing_page_count > 0) {
        throw new ConflictError('Episode already has pages');
      }

      let panelsCreated = 0;

      for (const page of pages) {
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
            }),
          ],
        );

        const pageId = pageResult.rows[0]?.id;
        if (pageId === undefined) {
          throw new ValidationError('Failed to create page skeleton page');
        }

        for (const panel of page.panels) {
          await transactionClient.query(
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
          panelsCreated += 1;
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
          AND works.user_id = $2
        `,
        [episodeId, userId],
      );

      return {
        pagesCreated: pages.length,
        panelsCreated,
      };
    });
  }
}

function mapWorkRow(row: WorkRow): Work {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    genre: row.genre,
    worldSetting: row.world_setting,
    theme: row.theme,
    mainEntityIds: row.main_entity_ids,
    startingPoint: row.starting_point,
    endingPoint: row.ending_point,
    overallFlow: row.overall_flow,
    version: row.version,
    editHistory: toObjectArray(row.edit_history),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapChapterRow(row: ChapterRow): Chapter {
  return {
    id: row.id,
    workId: row.work_id,
    order: row.order,
    title: row.title,
    purpose: row.purpose,
    startingState: row.starting_state,
    endingState: row.ending_state,
    emotionCurve: row.emotion_curve,
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
    title: row.title,
    purpose: row.purpose,
    introduction: row.introduction,
    middle: row.middle,
    climax: row.climax,
    endingHook: row.ending_hook,
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
        name: entry.name,
        entityType: entry.entity_type,
        freeDescription: entry.free_description,
      },
    ];
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
      payload[key] = entry;
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
