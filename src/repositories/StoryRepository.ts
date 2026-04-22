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
import type { DatabaseClient } from '../lib/db.js';

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

export class PostgresStoryRepository implements StoryRepository {
  public constructor(private readonly client: DatabaseClient) {}

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
    const result = await this.client.query<ChapterRow>(
      `
      UPDATE chapters
      SET "order" = COALESCE($3, "order"),
          title = CASE WHEN $4::boolean THEN $5 ELSE title END,
          purpose = CASE WHEN $6::boolean THEN $7 ELSE purpose END,
          starting_state = CASE WHEN $8::boolean THEN $9 ELSE starting_state END,
          ending_state = CASE WHEN $10::boolean THEN $11 ELSE ending_state END,
          emotion_curve = CASE WHEN $12::boolean THEN $13 ELSE emotion_curve END,
          entities_involved = CASE WHEN $14::boolean THEN $15 ELSE entities_involved END,
          key_beats = CASE WHEN $16::boolean THEN $17 ELSE key_beats END,
          status = COALESCE($18, status),
          version = version + 1,
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
    const result = await this.client.query<EpisodeRow>(
      `
      UPDATE episodes
      SET "order" = COALESCE($3, "order"),
          title = CASE WHEN $4::boolean THEN $5 ELSE title END,
          purpose = CASE WHEN $6::boolean THEN $7 ELSE purpose END,
          introduction = CASE WHEN $8::boolean THEN $9 ELSE introduction END,
          middle = CASE WHEN $10::boolean THEN $11 ELSE middle END,
          climax = CASE WHEN $12::boolean THEN $13 ELSE climax END,
          ending_hook = CASE WHEN $14::boolean THEN $15 ELSE ending_hook END,
          estimated_pages = COALESCE($16, estimated_pages),
          entities_involved = CASE WHEN $17::boolean THEN $18 ELSE entities_involved END,
          status = COALESCE($19, status),
          version = version + 1,
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

function toObjectArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(isJsonObject);
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
