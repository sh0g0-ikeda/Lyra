import type { QueryResultRow } from 'pg';
import type {
  EpisodePagePlanContext,
  EpisodePagePlanSceneEntityStateContext,
  PageAutofillContext,
  PageAutofillEntityContext,
  PageAutofillPanelContext,
  PageAutofillSceneContext,
  GeneratedPageImage,
  PageGenerationContext,
  PageGenerationPanelContext,
  PageGenerationStateUpdate,
  PagePromptContext,
  PageDialogueMode,
  PageSummary,
  PageStatus,
  UpdatePageSettingsInput,
} from '../domain/types/page.js';
import type { PageGenerationMode } from '../domain/types/pageGeneration.js';
import { readStyleReferenceMetadata } from '../domain/types/styleReference.js';
import type { DatabaseClient } from '../lib/db.js';
import type { PanelEntityAssignment } from '../domain/types/panelEntityAssignment.js';
import { normalizeNullableText, normalizePossiblyMojibake } from '../lib/textEncoding.js';

export type { PageGenerationContext, PageGenerationStateUpdate };

const STORY_SOURCE_SCENE_IDS_KEY = 'story_source_scene_ids';
const STORY_PAGE_PURPOSE_KEY = 'story_page_purpose';
const STORY_CONTINUITY_NOTE_KEY = 'story_continuity_note';

export interface PageRepository {
  findPagesByEpisodeIdAndUserId(episodeId: string, userId: string, organizationId?: string | null): Promise<PageSummary[]>;
  findPageByIdAndUserId(pageId: string, userId: string, organizationId?: string | null): Promise<PageSummary | null>;
  findGenerationContextByIdAndUserId(pageId: string, userId: string, organizationId?: string | null): Promise<PageGenerationContext | null>;
  findPromptContextByIdAndUserId(pageId: string, userId: string, organizationId?: string | null): Promise<PagePromptContext | null>;
  findAutofillContextByIdAndUserId(
    pageId: string,
    userId: string,
    organizationId?: string | null,
  ): Promise<PageAutofillContext | null>;
  findEpisodePlanningContextByIdAndUserId(
    episodeId: string,
    userId: string,
    organizationId?: string | null,
  ): Promise<EpisodePagePlanContext | null>;
  updatePageSettings(pageId: string, userId: string, input: UpdatePageSettingsInput, organizationId?: string | null): Promise<PageSummary | null>;
  updateGenerationState(
    pageId: string,
    userId: string,
    input: PageGenerationStateUpdate,
    organizationId?: string | null,
  ): Promise<boolean>;
  updateGeneratedImageAndState(
    pageId: string,
    userId: string,
    input: {
      status: PageStatus;
      generationMode: PageGenerationMode | null;
      generatedImage: GeneratedPageImage;
    },
    organizationId?: string | null,
  ): Promise<boolean>;
}

interface GenerationContextRow extends QueryResultRow {
  page_id: string;
  work_id: string;
  organization_id: string | null;
  layout_config: unknown;
  generated_image: unknown;
  generation_mode: string | null;
  status: PageStatus;
  frame_count: number;
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

interface AutofillContextRow extends QueryResultRow {
  page_id: string;
  work_id: string;
  episode_id: string;
  chapter_id: string;
  page_number: number;
  total_pages_in_episode: number;
  frame_count: number;
  status: PageStatus;
  dialogue_mode: string;
  page_dialogue_toggle: boolean;
  chapter_title: string | null;
  chapter_purpose: string | null;
  chapter_starting_state: string | null;
  chapter_ending_state: string | null;
  chapter_emotion_curve: string | null;
  chapter_key_beats: string[];
  episode_purpose: string | null;
  introduction: string | null;
  middle: string | null;
  climax: string | null;
  ending_hook: string | null;
  scenes: unknown;
  entities: unknown;
}

interface EpisodePlanContextRow extends QueryResultRow {
  episode_id: string;
  work_id: string;
  chapter_id: string;
  chapter_title: string | null;
  chapter_purpose: string | null;
  chapter_starting_state: string | null;
  chapter_ending_state: string | null;
  chapter_emotion_curve: string | null;
  chapter_key_beats: unknown;
  episode_title: string | null;
  episode_purpose: string | null;
  introduction: string | null;
  middle: string | null;
  climax: string | null;
  ending_hook: string | null;
  estimated_pages: number;
  scenes: unknown;
  entities: unknown;
}

interface PageSummaryRow extends QueryResultRow {
  id: string;
  episode_id: string;
  page_number: number;
  layout_config: unknown;
  dialogue_mode: string;
  page_dialogue_toggle: boolean;
  generation_mode: string | null;
  generated_image: unknown;
  status: PageStatus;
  panel_count: number;
  frame_count: number;
  balloon_count: number;
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
    organizationId: string | null = null,
  ): Promise<PageSummary[]> {
    const result = await this.client.query<PageSummaryRow>(
      `
      SELECT pages.id,
             pages.episode_id,
             pages.page_number,
             pages.layout_config,
             pages.dialogue_mode,
             pages.page_dialogue_toggle,
             pages.generation_mode,
             pages.generated_image,
             pages.status,
             COUNT(DISTINCT panels.id)::int AS panel_count,
             COUNT(DISTINCT panel_frames.id)::int AS frame_count,
             COUNT(DISTINCT balloons.id)::int AS balloon_count,
             pages.created_at,
             pages.updated_at
      FROM pages
      INNER JOIN episodes ON episodes.id = pages.episode_id
      INNER JOIN chapters ON chapters.id = episodes.chapter_id
      INNER JOIN works ON works.id = chapters.work_id
      LEFT JOIN panels ON panels.page_id = pages.id
      LEFT JOIN panel_frames ON panel_frames.page_id = pages.id
      LEFT JOIN balloons ON balloons.page_id = pages.id
      WHERE pages.episode_id = $1
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
      GROUP BY pages.id
      ORDER BY pages.page_number ASC
      `,
      [episodeId, userId, organizationId],
    );

    return result.rows.map((row) => {
      const layoutConfig = toJsonObject(row.layout_config);
      return {
        id: row.id,
        episodeId: row.episode_id,
        pageNumber: row.page_number,
        layoutConfig,
        storySourceSceneIds: readStorySourceSceneIds(layoutConfig),
        storyPagePurpose: readStoryPagePurpose(layoutConfig),
        storyContinuityNote: readStoryContinuityNote(layoutConfig),
        dialogueMode: toPageDialogueMode(row.dialogue_mode),
        pageDialogueToggle: row.page_dialogue_toggle,
        generationMode: toPageGenerationMode(row.generation_mode),
        generatedImage: toGeneratedPageImage(row.generated_image),
        status: row.status,
        panelCount: row.panel_count,
        frameCount: row.frame_count,
        balloonCount: row.balloon_count,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    });
  }

  public async findPageByIdAndUserId(
    pageId: string,
    userId: string,
    organizationId: string | null = null,
  ): Promise<PageSummary | null> {
    const result = await this.client.query<PageSummaryRow>(
      `
      SELECT pages.id,
             pages.episode_id,
             pages.page_number,
             pages.layout_config,
             pages.dialogue_mode,
             pages.page_dialogue_toggle,
             pages.generation_mode,
             pages.generated_image,
             pages.status,
             COUNT(DISTINCT panels.id)::int AS panel_count,
             COUNT(DISTINCT panel_frames.id)::int AS frame_count,
             COUNT(DISTINCT balloons.id)::int AS balloon_count,
             pages.created_at,
             pages.updated_at
      FROM pages
      INNER JOIN episodes ON episodes.id = pages.episode_id
      INNER JOIN chapters ON chapters.id = episodes.chapter_id
      INNER JOIN works ON works.id = chapters.work_id
      LEFT JOIN panels ON panels.page_id = pages.id
      LEFT JOIN panel_frames ON panel_frames.page_id = pages.id
      LEFT JOIN balloons ON balloons.page_id = pages.id
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
      GROUP BY pages.id
      `,
      [pageId, userId, organizationId],
    );

    const row = result.rows[0];
    if (row === undefined) {
      return null;
    }

    const layoutConfig = toJsonObject(row.layout_config);
    return {
          id: row.id,
          episodeId: row.episode_id,
          pageNumber: row.page_number,
          layoutConfig,
          storySourceSceneIds: readStorySourceSceneIds(layoutConfig),
          storyPagePurpose: readStoryPagePurpose(layoutConfig),
          storyContinuityNote: readStoryContinuityNote(layoutConfig),
          dialogueMode: toPageDialogueMode(row.dialogue_mode),
          pageDialogueToggle: row.page_dialogue_toggle,
          generationMode: toPageGenerationMode(row.generation_mode),
          generatedImage: toGeneratedPageImage(row.generated_image),
          status: row.status,
          panelCount: row.panel_count,
          frameCount: row.frame_count,
          balloonCount: row.balloon_count,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        };
  }

  public async findGenerationContextByIdAndUserId(
    pageId: string,
    userId: string,
    organizationId: string | null = null,
  ): Promise<PageGenerationContext | null> {
    const result = await this.client.query<GenerationContextRow>(
      `
      SELECT pages.id AS page_id,
             chapters.work_id,
             works.organization_id,
             pages.layout_config,
             pages.generated_image,
             pages.generation_mode,
             pages.status,
             (
               SELECT COUNT(*)::int
               FROM panel_frames
               WHERE panel_frames.page_id = pages.id
             ) AS frame_count,
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
      GROUP BY pages.id, chapters.work_id, works.organization_id, pages.layout_config, pages.generated_image, pages.generation_mode, pages.status
      `,
      [pageId, userId, organizationId],
    );

    const row = result.rows[0];
    return row === undefined
      ? null
      : {
        pageId: row.page_id,
        workId: row.work_id,
        organizationId: row.organization_id,
        layoutConfig: toJsonObject(row.layout_config),
          generatedImage: toGeneratedPageImage(row.generated_image),
          generationMode: toPageGenerationMode(row.generation_mode),
          status: row.status,
          frameCount: row.frame_count,
          panels: toPageGenerationPanels(row.panel_entities),
        };
  }

  public async findPromptContextByIdAndUserId(
    pageId: string,
    userId: string,
    organizationId: string | null = null,
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
    if (row === undefined) {
      return null;
    }

    const layoutConfig = toJsonObject(row.layout_config);
    return {
          pageId: row.page_id,
          workId: row.work_id,
          pageNumber: row.page_number,
          episodePurpose: normalizeNullableText(row.episode_purpose),
          sceneSummaries: toStringArray(row.scene_summaries),
          storyPagePurpose: readStoryPagePurpose(layoutConfig),
          storyContinuityNote: readStoryContinuityNote(layoutConfig),
          layoutConfig,
          styleReference: readStyleReferenceMetadata(layoutConfig.style_reference),
          dialogueMode: toPageDialogueMode(row.dialogue_mode),
          pageDialogueToggle: row.page_dialogue_toggle,
        };
  }

  public async findAutofillContextByIdAndUserId(
    pageId: string,
    userId: string,
    organizationId: string | null = null,
  ): Promise<PageAutofillContext | null> {
    const result = await this.client.query<AutofillContextRow>(
      `
      SELECT pages.id AS page_id,
             chapters.work_id,
             episodes.id AS episode_id,
             chapters.id AS chapter_id,
             pages.page_number,
             (
               SELECT COUNT(*)::int
               FROM pages AS episode_pages
               WHERE episode_pages.episode_id = episodes.id
             ) AS total_pages_in_episode,
             (
               SELECT COUNT(*)::int
               FROM panel_frames
               WHERE panel_frames.page_id = pages.id
             ) AS frame_count,
             pages.status,
             pages.dialogue_mode,
             pages.page_dialogue_toggle,
             chapters.title AS chapter_title,
             chapters.purpose AS chapter_purpose,
             chapters.starting_state AS chapter_starting_state,
             chapters.ending_state AS chapter_ending_state,
             chapters.emotion_curve AS chapter_emotion_curve,
             chapters.key_beats AS chapter_key_beats,
             episodes.purpose AS episode_purpose,
             episodes.introduction,
             episodes.middle,
             episodes.climax,
             episodes.ending_hook,
             (
               SELECT COALESCE(
                 jsonb_agg(
                   jsonb_build_object(
                     'id', scenes.id,
                     'order', scenes."order",
                     'location', scenes.location,
                     'time', scenes."time",
                     'atmosphere', scenes.atmosphere,
                     'involved_entity_ids', scenes.involved_entity_ids,
                     'entity_states',
                       COALESCE(
                         (
                           SELECT jsonb_agg(
                             jsonb_build_object(
                               'entity_id', entity_states.entity_id,
                               'state_id', entity_states.id
                             )
                             ORDER BY entity_states.created_at ASC
                           )
                           FROM entity_states
                           WHERE entity_states.scene_id = scenes.id
                         ),
                         '[]'::jsonb
                       )
                   )
                   ORDER BY scenes."order" ASC
                 ),
                 '[]'::jsonb
               )
               FROM scenes
               WHERE scenes.episode_id = episodes.id
             ) AS scenes,
             (
               SELECT COALESCE(
                 jsonb_agg(
                   jsonb_build_object(
                     'id', entities.id,
                     'name', entities.name,
                     'entity_type', entities.entity_type,
                     'free_description', entities.free_description,
                     'prompt_supplement', entities.prompt_supplement,
                     'structured_fields', entities.structured_fields
                   )
                   ORDER BY entities.created_at ASC
                 ),
                 '[]'::jsonb
               )
               FROM entities
               WHERE entities.work_id = chapters.work_id
             ) AS entities
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
    if (row === undefined) {
      return null;
    }

    const panelsResult = await this.client.query<QueryResultRow>(
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

    return {
      pageId: row.page_id,
      workId: row.work_id,
      episodeId: row.episode_id,
      chapterId: row.chapter_id,
      pageNumber: row.page_number,
      totalPagesInEpisode: row.total_pages_in_episode,
      frameCount: row.frame_count,
      status: row.status,
      dialogueMode: toPageDialogueMode(row.dialogue_mode),
      pageDialogueToggle: row.page_dialogue_toggle,
      chapterTitle: normalizeNullableText(row.chapter_title),
      chapterPurpose: normalizeNullableText(row.chapter_purpose),
      chapterStartingState: normalizeNullableText(row.chapter_starting_state),
      chapterEndingState: normalizeNullableText(row.chapter_ending_state),
      chapterEmotionCurve: normalizeNullableText(row.chapter_emotion_curve),
      chapterKeyBeats: toStringArray(row.chapter_key_beats),
      episodePurpose: normalizeNullableText(row.episode_purpose),
      introduction: normalizeNullableText(row.introduction),
      middle: normalizeNullableText(row.middle),
      climax: normalizeNullableText(row.climax),
      endingHook: normalizeNullableText(row.ending_hook),
      scenes: toAutofillScenes(row.scenes),
      entities: toAutofillEntities(row.entities),
      panels: panelsResult.rows.map((panelRow) => toAutofillPanelContext(panelRow)),
    };
  }

  public async findEpisodePlanningContextByIdAndUserId(
    episodeId: string,
    userId: string,
    organizationId: string | null = null,
  ): Promise<EpisodePagePlanContext | null> {
    const result = await this.client.query<EpisodePlanContextRow>(
      `
      SELECT episodes.id AS episode_id,
             chapters.work_id,
             chapters.id AS chapter_id,
             chapters.title AS chapter_title,
             chapters.purpose AS chapter_purpose,
             chapters.starting_state AS chapter_starting_state,
             chapters.ending_state AS chapter_ending_state,
             chapters.emotion_curve AS chapter_emotion_curve,
             chapters.key_beats AS chapter_key_beats,
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
                     'id', scenes.id,
                     'order', scenes."order",
                     'location', scenes.location,
                     'time', scenes."time",
                     'atmosphere', scenes.atmosphere,
                     'involved_entity_ids', scenes.involved_entity_ids,
                     'entity_states',
                       COALESCE(
                         (
                           SELECT jsonb_agg(
                             jsonb_build_object(
                               'entity_id', entity_states.entity_id,
                               'state_id', entity_states.id,
                               'costume_note', entity_states.costume_note,
                               'costume_ref_id', entity_states.costume_ref_id,
                               'condition_note', entity_states.condition_note,
                               'hair_note', entity_states.hair_note,
                               'expression_default', entity_states.expression_default,
                               'extra_note', entity_states.extra_note
                             )
                             ORDER BY entity_states.created_at ASC
                           )
                           FROM entity_states
                           WHERE entity_states.scene_id = scenes.id
                         ),
                         '[]'::jsonb
                       )
                   )
                   ORDER BY scenes."order" ASC
                 ),
                 '[]'::jsonb
               )
               FROM scenes
               WHERE scenes.episode_id = episodes.id
             ) AS scenes,
             (
               SELECT COALESCE(
                 jsonb_agg(
                   jsonb_build_object(
                     'id', entities.id,
                     'name', entities.name,
                     'entity_type', entities.entity_type,
                     'free_description', entities.free_description,
                     'prompt_supplement', entities.prompt_supplement,
                     'structured_fields', entities.structured_fields
                   )
                   ORDER BY entities.created_at ASC
                 ),
                 '[]'::jsonb
               )
               FROM entities
               WHERE entities.work_id = chapters.work_id
             ) AS entities
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

    const pagesResult = await this.client.query<QueryResultRow>(
      `
      SELECT pages.id AS page_id,
             pages.page_number,
             pages.status,
             pages.dialogue_mode,
             pages.page_dialogue_toggle,
             pages.layout_config,
             (
               SELECT COUNT(*)::int
               FROM panel_frames
               WHERE panel_frames.page_id = pages.id
             ) AS frame_count
      FROM pages
      INNER JOIN episodes ON episodes.id = pages.episode_id
      INNER JOIN chapters ON chapters.id = episodes.chapter_id
      INNER JOIN works ON works.id = chapters.work_id
      WHERE pages.episode_id = $1
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
      ORDER BY pages.page_number ASC
      `,
      [episodeId, userId, organizationId],
    );

    const panelsResult = await this.client.query<QueryResultRow>(
      `
      SELECT panels.*
      FROM panels
      INNER JOIN pages ON pages.id = panels.page_id
      INNER JOIN episodes ON episodes.id = pages.episode_id
      INNER JOIN chapters ON chapters.id = episodes.chapter_id
      INNER JOIN works ON works.id = chapters.work_id
      WHERE pages.episode_id = $1
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
      ORDER BY panels.page_id ASC, panels."order" ASC
      `,
      [episodeId, userId, organizationId],
    );

    const panelsByPageId = new Map<string, PageAutofillPanelContext[]>();
    for (const panelRow of panelsResult.rows) {
      const panel = toAutofillPanelContext(panelRow);
      const pagePanels = panelsByPageId.get(panelRow.page_id as string) ?? [];
      pagePanels.push(panel);
      panelsByPageId.set(panelRow.page_id as string, pagePanels);
    }

    return {
      episodeId: row.episode_id,
      workId: row.work_id,
      chapter: {
        id: row.chapter_id,
        title: normalizeNullableText(row.chapter_title),
        purpose: normalizeNullableText(row.chapter_purpose),
        startingState: normalizeNullableText(row.chapter_starting_state),
        endingState: normalizeNullableText(row.chapter_ending_state),
        emotionCurve: normalizeNullableText(row.chapter_emotion_curve),
        keyBeats: toStringArray(row.chapter_key_beats),
      },
      episode: {
        title: normalizeNullableText(row.episode_title),
        purpose: normalizeNullableText(row.episode_purpose),
        introduction: normalizeNullableText(row.introduction),
        middle: normalizeNullableText(row.middle),
        climax: normalizeNullableText(row.climax),
        endingHook: normalizeNullableText(row.ending_hook),
        estimatedPages: row.estimated_pages,
      },
      scenes: toEpisodePlanScenes(row.scenes),
      entities: toAutofillEntities(row.entities),
      pages: pagesResult.rows.map((pageRow) => ({
        pageId: pageRow.page_id as string,
        pageNumber: pageRow.page_number as number,
        frameCount: pageRow.frame_count as number,
        layoutConfig: toJsonObject(pageRow.layout_config),
        status: pageRow.status as PageStatus,
        dialogueMode: toPageDialogueMode(pageRow.dialogue_mode as string),
        pageDialogueToggle: pageRow.page_dialogue_toggle as boolean,
        panels: panelsByPageId.get(pageRow.page_id as string) ?? [],
      })),
    };
  }

  public async updatePageSettings(
    pageId: string,
    userId: string,
    input: UpdatePageSettingsInput,
    organizationId: string | null = null,
  ): Promise<PageSummary | null> {
    await this.client.query(
      `
      UPDATE pages
      SET dialogue_mode = COALESCE($3::text, pages.dialogue_mode),
          page_dialogue_toggle = COALESCE($4::boolean, pages.page_dialogue_toggle),
          layout_config = CASE
            WHEN $5::boolean = false THEN pages.layout_config
            ELSE $6::jsonb
          END,
          updated_at = NOW()
      FROM episodes
      INNER JOIN chapters ON chapters.id = episodes.chapter_id
      INNER JOIN works ON works.id = chapters.work_id
      WHERE pages.id = $1
        AND pages.episode_id = episodes.id
        AND (
          ($7::uuid IS NULL AND works.user_id = $2 AND works.organization_id IS NULL)
          OR (
            $7::uuid IS NOT NULL
            AND works.organization_id = $7::uuid
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
      [
        pageId,
        userId,
        input.dialogueMode ?? null,
        input.pageDialogueToggle ?? null,
        input.layoutConfig !== undefined,
        input.layoutConfig === undefined ? null : JSON.stringify(input.layoutConfig),
        organizationId,
      ],
    );

    return this.findPageByIdAndUserId(pageId, userId, organizationId);
  }

  public async updateGenerationState(
    pageId: string,
    userId: string,
    input: PageGenerationStateUpdate,
    organizationId: string | null = null,
  ): Promise<boolean> {
    const result = await this.client.query<UpdateRow>(
      `
      UPDATE pages
      SET status = $3::text,
          generation_mode = $4::text,
          updated_at = NOW()
      FROM episodes
      INNER JOIN chapters ON chapters.id = episodes.chapter_id
      INNER JOIN works ON works.id = chapters.work_id
      WHERE pages.id = $1
        AND pages.episode_id = episodes.id
        AND (
          ($6::uuid IS NULL AND works.user_id = $2 AND works.organization_id IS NULL)
          OR (
            $6::uuid IS NOT NULL
            AND works.organization_id = $6::uuid
            AND EXISTS (
              SELECT 1
              FROM organization_members
              WHERE organization_members.organization_id = works.organization_id
                AND organization_members.user_id = $2
                AND organization_members.status = 'active'
            )
          )
        )
        AND ($5::text IS NULL OR pages.status = $5::text)
      RETURNING pages.id
      `,
      [pageId, userId, input.status, input.generationMode, input.expectedStatus ?? null, organizationId],
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
    organizationId: string | null = null,
  ): Promise<boolean> {
    const result = await this.client.query<UpdateRow>(
      `
      UPDATE pages
      SET status = $3::text,
          generation_mode = $4::text,
          generated_image = jsonb_build_object(
            's3_key', $5::text,
            'cdn_url', $6::text,
            'generation_mode', $7::text,
            'generated_at', $8::text
          ),
          updated_at = NOW()
      FROM episodes
      INNER JOIN chapters ON chapters.id = episodes.chapter_id
      INNER JOIN works ON works.id = chapters.work_id
      WHERE pages.id = $1
        AND pages.episode_id = episodes.id
        AND (
          ($9::uuid IS NULL AND works.user_id = $2 AND works.organization_id IS NULL)
          OR (
            $9::uuid IS NOT NULL
            AND works.organization_id = $9::uuid
            AND EXISTS (
              SELECT 1
              FROM organization_members
              WHERE organization_members.organization_id = works.organization_id
                AND organization_members.user_id = $2
                AND organization_members.status = 'active'
            )
          )
        )
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
        organizationId,
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
      !isNullablePanelEntityFacingDirection(entry.facing_direction) ||
      !isNullableString(entry.effect_note) ||
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
        facingDirection: entry.facing_direction,
        effectNote: entry.effect_note,
        stateId: entry.state_id,
      },
    ];
  });
}

function toPanelComposition(value: unknown): PageAutofillPanelContext['composition'] {
  if (!isJsonObject(value)) {
    return {
      source: 'custom',
      galleryItemId: null,
      compositionPrompt: null,
      shotType: null,
      angle: null,
      customNote: null,
    };
  }

  return {
    source: isPanelCompositionSource(value.source) ? value.source : 'custom',
    galleryItemId: typeof value.gallery_item_id === 'string' ? value.gallery_item_id : null,
    compositionPrompt:
      typeof value.composition_prompt === 'string'
        ? normalizePossiblyMojibake(value.composition_prompt)
        : null,
    shotType: isPanelShotType(value.shot_type) ? value.shot_type : null,
    angle: isPanelAngle(value.angle) ? value.angle : null,
    customNote: typeof value.custom_note === 'string' ? normalizePossiblyMojibake(value.custom_note) : null,
  };
}

function toPanelDialogues(value: unknown): PageAutofillPanelContext['dialogue'] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (!isJsonObject(entry)) {
      return [];
    }

    if (
      !isNullableString(entry.entity_id) ||
      typeof entry.text !== 'string' ||
      !isPanelDialogueType(entry.type) ||
      !isPanelDialoguePosition(entry.position)
    ) {
      return [];
    }

    return [
      {
        entityId: entry.entity_id,
        text: normalizePossiblyMojibake(entry.text),
        type: entry.type,
        position: entry.position,
      },
    ];
  });
}

function toAutofillScenes(value: unknown): PageAutofillSceneContext[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (!isJsonObject(entry)) {
      return [];
    }

    if (
      typeof entry.id !== 'string' ||
      typeof entry.order !== 'number' ||
      !isNullableString(entry.location) ||
      !isNullableString(entry.time) ||
      !isNullableString(entry.atmosphere)
    ) {
      return [];
    }

    return [
      {
        id: entry.id,
        order: entry.order,
        location: normalizeNullableText(entry.location),
        time: normalizeNullableText(entry.time),
        atmosphere: normalizeNullableText(entry.atmosphere),
        involvedEntityIds: toStringArray(entry.involved_entity_ids),
        entityStates: toSceneEntityStates(entry.entity_states),
      },
    ];
  });
}

function toEpisodePlanScenes(
  value: unknown,
): EpisodePagePlanContext['scenes'] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (!isJsonObject(entry)) {
      return [];
    }

    if (
      typeof entry.id !== 'string' ||
      typeof entry.order !== 'number' ||
      !isNullableString(entry.location) ||
      !isNullableString(entry.time) ||
      !isNullableString(entry.atmosphere)
    ) {
      return [];
    }

    return [
      {
        id: entry.id,
        order: entry.order,
        location: normalizeNullableText(entry.location),
        time: normalizeNullableText(entry.time),
        atmosphere: normalizeNullableText(entry.atmosphere),
        involvedEntityIds: toStringArray(entry.involved_entity_ids),
        entityStates: toEpisodePlanSceneEntityStates(entry.entity_states),
      },
    ];
  });
}

function toSceneEntityStates(
  value: unknown,
): Array<{ entityId: string; stateId: string }> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (!isJsonObject(entry) || typeof entry.entity_id !== 'string' || typeof entry.state_id !== 'string') {
      return [];
    }

    return [{ entityId: entry.entity_id, stateId: entry.state_id }];
  });
}

function toEpisodePlanSceneEntityStates(
  value: unknown,
): EpisodePagePlanSceneEntityStateContext[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (
      !isJsonObject(entry) ||
      typeof entry.entity_id !== 'string' ||
      typeof entry.state_id !== 'string' ||
      !isNullableString(entry.costume_note) ||
      !isNullableString(entry.costume_ref_id) ||
      !isNullableString(entry.condition_note) ||
      !isNullableString(entry.hair_note) ||
      !isNullableString(entry.expression_default) ||
      !isNullableString(entry.extra_note)
    ) {
      return [];
    }

    return [
      {
        entityId: entry.entity_id,
        stateId: entry.state_id,
        costumeNote: entry.costume_note,
        costumeRefId: entry.costume_ref_id,
        conditionNote: normalizeNullableText(entry.condition_note),
        hairNote: normalizeNullableText(entry.hair_note),
        expressionDefault: normalizeNullableText(entry.expression_default),
        extraNote: normalizeNullableText(entry.extra_note),
      },
    ];
  });
}

function toAutofillEntities(value: unknown): PageAutofillEntityContext[] {
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
      !isEntityType(entry.entity_type) ||
      !isNullableString(entry.free_description) ||
      !isNullableString(entry.prompt_supplement)
    ) {
      return [];
    }

    return [
      {
        id: entry.id,
        name: normalizePossiblyMojibake(entry.name),
        entityType: entry.entity_type,
        freeDescription: normalizeNullableText(entry.free_description),
        promptSupplement: normalizeNullableText(entry.prompt_supplement),
        structuredFields: toJsonObject(entry.structured_fields),
      },
    ];
  });
}

function toAutofillPanelContext(value: unknown): PageAutofillPanelContext {
  if (!isJsonObject(value)) {
    throw new Error('Autofill panel row was not an object');
  }

  if (
    typeof value.id !== 'string' ||
    typeof value.page_id !== 'string' ||
    typeof value.order !== 'number' ||
    !isPanelRole(value.panel_role) ||
    !isPanelSize(value.panel_size) ||
    !isNullableString(value.situation_text) ||
    typeof value.dialogue_in_panel !== 'boolean' ||
    !isNullableString(value.sfx_text) ||
    !isNullableString(value.background_note) ||
    !isNullableString(value.panel_notes)
  ) {
    throw new Error('Autofill panel row was invalid');
  }

  return {
    id: value.id,
    order: value.order,
    panelRole: value.panel_role,
    panelSize: value.panel_size,
    situationText: normalizeNullableText(value.situation_text),
    composition: toPanelComposition(value.composition),
    dialogueInPanel: value.dialogue_in_panel,
    dialogue: toPanelDialogues(value.dialogue),
    sfxText: normalizeNullableText(value.sfx_text),
    backgroundNote: normalizeNullableText(value.background_note),
    panelNotes: normalizeNullableText(value.panel_notes),
    entities: toPanelEntityAssignments(value.entities),
  };
}

function toJsonObject(value: unknown): Record<string, unknown> {
  return isJsonObject(value) ? value : {};
}

function readStorySourceSceneIds(layoutConfig: Record<string, unknown>): string[] {
  return toStringArray(layoutConfig[STORY_SOURCE_SCENE_IDS_KEY]);
}

function readStoryPagePurpose(layoutConfig: Record<string, unknown>): string | null {
  return normalizeNullableText(readNullableString(layoutConfig[STORY_PAGE_PURPOSE_KEY]));
}

function readStoryContinuityNote(layoutConfig: Record<string, unknown>): string | null {
  return normalizeNullableText(readNullableString(layoutConfig[STORY_CONTINUITY_NOTE_KEY]));
}

function toPageGenerationMode(value: string | null): PageGenerationMode | null {
  return value === 'standard' || value === 'thinking' ? value : null;
}

function toPageDialogueMode(value: string): PageDialogueMode {
  return value === 'balloon_only' || value === 'mixed' ? value : 'image_baked';
}

function isEntityType(value: unknown): value is 'character' | 'nonhuman' | 'object' {
  return value === 'character' || value === 'nonhuman' || value === 'object';
}

function isPanelRole(value: unknown): value is PageAutofillPanelContext['panelRole'] {
  return (
    value === 'establish' ||
    value === 'action' ||
    value === 'reaction' ||
    value === 'emphasis' ||
    value === 'transition' ||
    value === 'pause' ||
    value === 'impact'
  );
}

function isPanelSize(value: unknown): value is PageAutofillPanelContext['panelSize'] {
  return value === 'standard' || value === 'large' || value === 'wide' || value === 'narrow' || value === 'splash';
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

function isPanelEntityRole(value: unknown): value is PanelEntityAssignment['role'] {
  return value === 'primary' || value === 'secondary' || value === 'background';
}

function isPanelCompositionSource(
  value: unknown,
): value is PageAutofillPanelContext['composition']['source'] {
  return value === 'gallery' || value === 'custom' || value === 'ai_auto';
}

function isPanelShotType(value: unknown): value is NonNullable<PageAutofillPanelContext['composition']['shotType']> {
  return (
    value === 'full_body' ||
    value === 'half_body' ||
    value === 'close_up' ||
    value === 'wide' ||
    value === 'extreme_close_up'
  );
}

function isPanelAngle(value: unknown): value is NonNullable<PageAutofillPanelContext['composition']['angle']> {
  return (
    value === 'front' ||
    value === 'side' ||
    value === 'three_quarter' ||
    value === 'bird_eye' ||
    value === 'worm_eye' ||
    value === 'dutch_angle'
  );
}

function isPanelDialogueType(value: unknown): value is PageAutofillPanelContext['dialogue'][number]['type'] {
  return (
    value === 'speech' ||
    value === 'thought' ||
    value === 'narration' ||
    value === 'shout' ||
    value === 'whisper' ||
    value === 'sfx'
  );
}

function isPanelDialoguePosition(
  value: unknown,
): value is PageAutofillPanelContext['dialogue'][number]['position'] {
  return value === 'top' || value === 'bottom' || value === 'left' || value === 'right' || value === 'center';
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

function isNullablePanelEntityFacingDirection(
  value: unknown,
): value is PanelEntityAssignment['facingDirection'] {
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

function isNullableString(value: unknown): value is string | null {
  return typeof value === 'string' || value === null;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readNullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}
