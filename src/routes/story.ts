import { Hono, type Context, type MiddlewareHandler } from 'hono';
import {
  chapterSchema,
  chaptersResponseSchema,
  episodeSchema,
  episodesResponseSchema,
  workSchema,
  worksResponseSchema,
} from '../../packages/api-contract/src/mobileApiSchemas.js';
import { ValidationError } from '../domain/errors/index.js';
import type { Chapter, Episode, Work } from '../domain/types/story.js';
import {
  collaborateStoryBodySchema,
  generatePageSkeletonBodySchema,
  generatePageSkeletonParamSchema,
  improveEpisodeDraftBodySchema,
} from '../lib/validators/storyAi.schema.js';
import {
  createChapterBodySchema,
  createEpisodeBodySchema,
  createWorkBodySchema,
  moveStoryItemBodySchema,
  moveEpisodeBodySchema,
  storyUuidParamSchema,
  updateChapterBodySchema,
  updateEpisodeBodySchema,
  updateWorkBodySchema,
} from '../lib/validators/story.schema.js';
import { formatZodValidationError } from '../lib/validationErrorFormatter.js';
import type { StoryServicePort } from '../services/story/StoryService.js';
import type { StoryCollaborationServicePort } from '../services/story/StoryCollaborationService.js';
import type { PageSkeletonServicePort } from '../services/story/PageSkeletonService.js';
import type { EpisodePageSkeletonServicePort } from '../services/story/EpisodePageSkeletonService.js';
import type { PageServicePort } from '../services/page/PageService.js';
import type { EpisodeStoryAutofillServicePort } from '../services/story/EpisodeStoryAutofillService.js';
import type { OrganizationServicePort } from '../services/organization/OrganizationService.js';
import type { AppEnv } from '../types/app.js';
import {
  parseOptionalOrganizationId,
  recordOrganizationAudit,
  requireOrganizationCapability,
} from './organizationRouteHelpers.js';
import { assertMobileResponseContract } from './mobileResponseContract.js';
import { readJsonBody, readOptionalJsonBody, REQUEST_BODY_LIMITS } from './requestBody.js';

export interface StoryRouteDependencies {
  authMiddleware: MiddlewareHandler<AppEnv>;
  rateLimitMiddleware: MiddlewareHandler<AppEnv>;
  pageSkeletonService: PageSkeletonServicePort;
  episodePageSkeletonService?: EpisodePageSkeletonServicePort;
  pageService?: PageServicePort;
  episodeStoryAutofillService?: EpisodeStoryAutofillServicePort;
  organizationService?: OrganizationServicePort;
  storyCollaborationService: StoryCollaborationServicePort;
  storyService: StoryServicePort;
}

export function createStoryRoutes(dependencies: StoryRouteDependencies): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use('*', dependencies.authMiddleware);
  app.use('*', dependencies.rateLimitMiddleware);

  app.post('/story/collaborate', async (c) => {
    const user = c.get('user');
    const organizationId = parseOptionalOrganizationId(c);
    const body = collaborateStoryBodySchema.safeParse(await readStoryJsonBody(c));

    if (!body.success) {
      throw new ValidationError(formatZodValidationError(body.error));
    }

    await requireOrganizationCapability(c, dependencies, organizationId, 'edit_work');

    const stream = await dependencies.storyCollaborationService.collaborate(user.id, {
      layer: body.data.layer,
      targetId: body.data.target_id,
      instruction: body.data.instruction,
      language: body.data.language,
      context: {
        currentDraft: body.data.context.current_draft,
        selectedText: body.data.context.selected_text,
        userNotes: body.data.context.user_notes,
        focusPoints: body.data.context.focus_points,
        constraints: body.data.context.constraints,
      },
    }, organizationId);

    return createSseResponse(stream);
  });

  app.post('/story/improve-episode-draft', async (c) => {
    const user = c.get('user');
    const organizationId = parseOptionalOrganizationId(c);
    const body = improveEpisodeDraftBodySchema.safeParse(await readStoryJsonBody(c));

    if (!body.success) {
      throw new ValidationError(formatZodValidationError(body.error));
    }

    await requireOrganizationCapability(c, dependencies, organizationId, 'edit_work');

    const result = await dependencies.storyCollaborationService.improveEpisodeDraft(user.id, {
      episodeId: body.data.episode_id,
      instruction: body.data.instruction,
      language: body.data.language,
      baseDraft: {
        title: body.data.base_draft.title,
        purpose: body.data.base_draft.purpose,
        storyInputMode: body.data.base_draft.story_input_mode,
        storyFullDraft: body.data.base_draft.story_full_draft,
        introduction: body.data.base_draft.introduction,
        middle: body.data.base_draft.middle,
        climax: body.data.base_draft.climax,
        endingHook: body.data.base_draft.ending_hook,
      },
    }, organizationId);

    return c.json({
      draft: {
        title: result.draft.title,
        purpose: result.draft.purpose,
        story_input_mode: result.draft.storyInputMode,
        story_full_draft: result.draft.storyFullDraft,
        introduction: result.draft.introduction,
        middle: result.draft.middle,
        climax: result.draft.climax,
        ending_hook: result.draft.endingHook,
      },
      compiler_provider: result.compilerProvider,
      compiler_model: result.compilerModel,
      compiler_prompt_version: result.compilerPromptVersion,
      compiler_error: result.compilerError,
    });
  });

  app.post('/works', async (c) => {
    const user = c.get('user');
    const body = createWorkBodySchema.safeParse(await readStoryJsonBody(c));

    if (!body.success) {
      throw new ValidationError(formatZodValidationError(body.error));
    }

    const organizationId = body.data.organization_id ?? null;
    await requireOrganizationCapability(c, dependencies, organizationId, 'create_work');

    const work = await dependencies.storyService.createWork(user.id, {
      organizationId,
      title: body.data.title,
      genre: body.data.genre ?? null,
      worldSetting: body.data.world_setting ?? null,
      theme: body.data.theme ?? null,
      mainEntityIds: body.data.main_entity_ids ?? [],
      startingPoint: body.data.starting_point ?? null,
      endingPoint: body.data.ending_point ?? null,
      overallFlow: body.data.overall_flow ?? null,
    });
    await recordOrganizationAudit(dependencies, organizationId, user.id, 'work.created', 'work', work.id);

    const payload = toWorkResponse(work);
    return c.json(assertMobileResponseContract(workSchema, payload), 201);
  });

  app.get('/works', async (c) => {
    const user = c.get('user');
    const organizationId = parseOptionalOrganizationId(c);
    await requireOrganizationCapability(c, dependencies, organizationId, 'view_work');
    const works = await dependencies.storyService.listWorks(user.id, organizationId);

    const payload = { works: works.map(toWorkResponse) };
    return c.json(assertMobileResponseContract(worksResponseSchema, payload));
  });

  app.get('/works/:id', async (c) => {
    const user = c.get('user');
    const workId = parseUuidParam(c, 'id');
    const organizationId = parseOptionalOrganizationId(c);
    await requireOrganizationCapability(c, dependencies, organizationId, 'view_work');
    const work = await dependencies.storyService.getWork(user.id, workId, organizationId);

    const payload = toWorkResponse(work);
    return c.json(assertMobileResponseContract(workSchema, payload));
  });

  app.put('/works/:id', async (c) => {
    const user = c.get('user');
    const workId = parseUuidParam(c, 'id');
    const organizationId = parseOptionalOrganizationId(c);
    await requireOrganizationCapability(c, dependencies, organizationId, 'edit_work');
    const body = updateWorkBodySchema.safeParse(await readStoryJsonBody(c));

    if (!body.success) {
      throw new ValidationError(formatZodValidationError(body.error));
    }

    const work = await dependencies.storyService.updateWork(user.id, workId, {
      title: body.data.title,
      genre: body.data.genre,
      worldSetting: body.data.world_setting,
      theme: body.data.theme,
      mainEntityIds: body.data.main_entity_ids,
      startingPoint: body.data.starting_point,
      endingPoint: body.data.ending_point,
      overallFlow: body.data.overall_flow,
      status: body.data.status,
    }, organizationId);
    await recordOrganizationAudit(dependencies, organizationId, user.id, 'work.updated', 'work', workId);

    const payload = toWorkResponse(work);
    return c.json(assertMobileResponseContract(workSchema, payload));
  });

  app.post('/works/:id/chapters', async (c) => {
    const user = c.get('user');
    const workId = parseUuidParam(c, 'id');
    const organizationId = parseOptionalOrganizationId(c);
    await requireOrganizationCapability(c, dependencies, organizationId, 'edit_work');
    const body = createChapterBodySchema.safeParse(await readStoryJsonBody(c));

    if (!body.success) {
      throw new ValidationError(formatZodValidationError(body.error));
    }

    const chapter = await dependencies.storyService.createChapter(user.id, workId, {
      order: body.data.order,
      title: body.data.title ?? null,
      purpose: body.data.purpose ?? null,
      startingState: body.data.starting_state ?? null,
      endingState: body.data.ending_state ?? null,
      emotionCurve: body.data.emotion_curve ?? null,
      entitiesInvolved: body.data.entities_involved ?? [],
      keyBeats: body.data.key_beats ?? [],
    }, organizationId);
    await recordOrganizationAudit(dependencies, organizationId, user.id, 'chapter.created', 'chapter', chapter.id, {
      work_id: workId,
    });

    const payload = toChapterResponse(chapter);
    return c.json(assertMobileResponseContract(chapterSchema, payload), 201);
  });

  app.get('/works/:id/chapters', async (c) => {
    const user = c.get('user');
    const workId = parseUuidParam(c, 'id');
    const organizationId = parseOptionalOrganizationId(c);
    await requireOrganizationCapability(c, dependencies, organizationId, 'view_work');
    const chapters = await dependencies.storyService.listChapters(user.id, workId, organizationId);

    const payload = { chapters: chapters.map(toChapterResponse) };
    return c.json(assertMobileResponseContract(chaptersResponseSchema, payload));
  });

  app.put('/chapters/:id', async (c) => {
    const user = c.get('user');
    const chapterId = parseUuidParam(c, 'id');
    const organizationId = parseOptionalOrganizationId(c);
    await requireOrganizationCapability(c, dependencies, organizationId, 'edit_work');
    const body = updateChapterBodySchema.safeParse(await readStoryJsonBody(c));

    if (!body.success) {
      throw new ValidationError(formatZodValidationError(body.error));
    }

    const chapter = await dependencies.storyService.updateChapter(user.id, chapterId, {
      order: body.data.order,
      title: body.data.title,
      purpose: body.data.purpose,
      startingState: body.data.starting_state,
      endingState: body.data.ending_state,
      emotionCurve: body.data.emotion_curve,
      entitiesInvolved: body.data.entities_involved,
      keyBeats: body.data.key_beats,
      status: body.data.status,
    }, organizationId);
    await recordOrganizationAudit(dependencies, organizationId, user.id, 'chapter.updated', 'chapter', chapterId);

    const payload = toChapterResponse(chapter);
    return c.json(assertMobileResponseContract(chapterSchema, payload));
  });

  app.delete('/chapters/:id', async (c) => {
    const user = c.get('user');
    const chapterId = parseUuidParam(c, 'id');
    const organizationId = parseOptionalOrganizationId(c);
    await requireOrganizationCapability(c, dependencies, organizationId, 'edit_work');
    await dependencies.storyService.deleteChapter(user.id, chapterId, organizationId);
    await recordOrganizationAudit(dependencies, organizationId, user.id, 'chapter.deleted', 'chapter', chapterId);

    return c.body(null, 204);
  });

  app.post('/chapters/:id/move', async (c) => {
    const user = c.get('user');
    const chapterId = parseUuidParam(c, 'id');
    const organizationId = parseOptionalOrganizationId(c);
    await requireOrganizationCapability(c, dependencies, organizationId, 'edit_work');
    const body = moveStoryItemBodySchema.safeParse(await readStoryJsonBody(c));

    if (!body.success) {
      throw new ValidationError(formatZodValidationError(body.error));
    }

    const chapter = await dependencies.storyService.moveChapter(user.id, chapterId, body.data.direction, organizationId);
    await recordOrganizationAudit(dependencies, organizationId, user.id, 'chapter.moved', 'chapter', chapterId, {
      direction: body.data.direction,
    });

    const payload = toChapterResponse(chapter);
    return c.json(assertMobileResponseContract(chapterSchema, payload));
  });

  app.post('/chapters/:id/episodes', async (c) => {
    const user = c.get('user');
    const chapterId = parseUuidParam(c, 'id');
    const organizationId = parseOptionalOrganizationId(c);
    await requireOrganizationCapability(c, dependencies, organizationId, 'edit_work');
    const body = createEpisodeBodySchema.safeParse(await readStoryJsonBody(c));

    if (!body.success) {
      throw new ValidationError(formatZodValidationError(body.error));
    }

    const episode = await dependencies.storyService.createEpisode(user.id, chapterId, {
      order: body.data.order,
      title: body.data.title ?? null,
      purpose: body.data.purpose ?? null,
      storyInputMode: body.data.story_input_mode,
      storyFullDraft: body.data.story_full_draft ?? null,
      introduction: body.data.introduction ?? null,
      middle: body.data.middle ?? null,
      climax: body.data.climax ?? null,
      endingHook: body.data.ending_hook ?? null,
      estimatedPages: body.data.estimated_pages,
      entitiesInvolved: body.data.entities_involved ?? [],
    }, organizationId);
    await recordOrganizationAudit(dependencies, organizationId, user.id, 'episode.created', 'episode', episode.id, {
      chapter_id: chapterId,
    });

    const payload = toEpisodeResponse(episode);
    return c.json(assertMobileResponseContract(episodeSchema, payload), 201);
  });

  app.get('/chapters/:id/episodes', async (c) => {
    const user = c.get('user');
    const chapterId = parseUuidParam(c, 'id');
    const organizationId = parseOptionalOrganizationId(c);
    await requireOrganizationCapability(c, dependencies, organizationId, 'view_work');
    const episodes = await dependencies.storyService.listEpisodes(user.id, chapterId, organizationId);

    const payload = { episodes: episodes.map(toEpisodeResponse) };
    return c.json(assertMobileResponseContract(episodesResponseSchema, payload));
  });

  app.put('/episodes/:id', async (c) => {
    const user = c.get('user');
    const episodeId = parseUuidParam(c, 'id');
    const organizationId = parseOptionalOrganizationId(c);
    await requireOrganizationCapability(c, dependencies, organizationId, 'edit_work');
    const body = updateEpisodeBodySchema.safeParse(await readStoryJsonBody(c));

    if (!body.success) {
      throw new ValidationError(formatZodValidationError(body.error));
    }

    const episode = await dependencies.storyService.updateEpisode(user.id, episodeId, {
      order: body.data.order,
      title: body.data.title,
      purpose: body.data.purpose,
      storyInputMode: body.data.story_input_mode,
      storyFullDraft: body.data.story_full_draft,
      introduction: body.data.introduction,
      middle: body.data.middle,
      climax: body.data.climax,
      endingHook: body.data.ending_hook,
      estimatedPages: body.data.estimated_pages,
      entitiesInvolved: body.data.entities_involved,
      status: body.data.status,
    }, organizationId);
    await recordOrganizationAudit(dependencies, organizationId, user.id, 'episode.updated', 'episode', episodeId);

    const payload = toEpisodeResponse(episode);
    return c.json(assertMobileResponseContract(episodeSchema, payload));
  });

  app.delete('/episodes/:id', async (c) => {
    const user = c.get('user');
    const episodeId = parseUuidParam(c, 'id');
    const organizationId = parseOptionalOrganizationId(c);
    await requireOrganizationCapability(c, dependencies, organizationId, 'edit_work');
    await dependencies.storyService.deleteEpisode(user.id, episodeId, organizationId);
    await recordOrganizationAudit(dependencies, organizationId, user.id, 'episode.deleted', 'episode', episodeId);

    return c.body(null, 204);
  });

  app.post('/episodes/:id/move', async (c) => {
    const user = c.get('user');
    const episodeId = parseUuidParam(c, 'id');
    const organizationId = parseOptionalOrganizationId(c);
    await requireOrganizationCapability(c, dependencies, organizationId, 'edit_work');
    const body = moveEpisodeBodySchema.safeParse(await readStoryJsonBody(c));

    if (!body.success) {
      throw new ValidationError(formatZodValidationError(body.error));
    }

    const episode = await dependencies.storyService.moveEpisode(
      user.id,
      episodeId,
      body.data.direction,
      organizationId,
      body.data.cross_chapter,
    );
    await recordOrganizationAudit(dependencies, organizationId, user.id, 'episode.moved', 'episode', episodeId, {
      direction: body.data.direction,
      cross_chapter: body.data.cross_chapter,
      destination_chapter_id: episode.chapterId,
    });

    const payload = toEpisodeResponse(episode);
    return c.json(assertMobileResponseContract(episodeSchema, payload));
  });

  app.post('/episodes/:id/generate-page-skeleton', async (c) => {
    const user = c.get('user');
    const organizationId = parseOptionalOrganizationId(c);
    await requireOrganizationCapability(c, dependencies, organizationId, 'edit_work');
    const parsedEpisodeId = generatePageSkeletonParamSchema.safeParse(c.req.param('id'));
    if (!parsedEpisodeId.success) {
      throw new ValidationError('id must be a valid UUID');
    }

    const hasBody = (c.req.header('content-type') ?? '').includes('application/json');
    const body = generatePageSkeletonBodySchema.safeParse(
      hasBody
        ? await readOptionalJsonBody(c, {
            maxBytes: REQUEST_BODY_LIMITS.SMALL_JSON_BYTES,
            description: 'Page skeleton options',
          })
        : {},
    );
    if (!body.success) {
      throw new ValidationError(formatZodValidationError(body.error));
    }

    if (dependencies.episodePageSkeletonService !== undefined) {
      const queued = await dependencies.episodePageSkeletonService.enqueueEpisodePageSkeleton(
        user.id,
        parsedEpisodeId.data,
        {
          overwriteExisting: body.data.overwrite_existing,
          applyStoryPlan: body.data.apply_story_plan,
          language: body.data.language,
        },
        organizationId,
      );
      await recordOrganizationAudit(
        dependencies,
        organizationId,
        user.id,
        'episode.page_skeleton_queued',
        'episode',
        parsedEpisodeId.data,
        {
          job_id: queued.jobId,
          overwrite_existing: body.data.overwrite_existing,
          apply_story_plan: body.data.apply_story_plan,
        },
      );

      return c.json(
        {
          job_id: queued.jobId,
          queued: true,
          story_plan_applied: body.data.apply_story_plan,
        },
        202,
      );
    }

    const result = await dependencies.pageSkeletonService.generateForEpisode(user.id, parsedEpisodeId.data, {
      overwriteExisting: body.data.overwrite_existing,
      language: body.data.language,
    }, organizationId);

    let storyPlanApplied = false;
    let storyPlanJobId: string | null = null;

    if (body.data.apply_story_plan) {
      if (dependencies.episodeStoryAutofillService === undefined) {
        throw new ValidationError('Page service is not configured for story plan autofill');
      }

      const applied = await dependencies.episodeStoryAutofillService.enqueueEpisodeStoryAutofill(
        user.id,
        parsedEpisodeId.data,
        body.data.language,
        organizationId,
      );
      storyPlanApplied = true;
      storyPlanJobId = applied.jobId;
    }
    await recordOrganizationAudit(
      dependencies,
      organizationId,
      user.id,
      'episode.page_skeleton_generated',
      'episode',
      parsedEpisodeId.data,
      {
        pages_created: result.pagesCreated,
        panels_created: result.panelsCreated,
        replaced_existing: result.replacedExisting,
        story_plan_job_id: storyPlanJobId,
      },
    );

    return c.json(
      {
        pages_created: result.pagesCreated,
        panels_created: result.panelsCreated,
        replaced_existing: result.replacedExisting,
        story_plan_applied: storyPlanApplied,
        story_plan_job_id: storyPlanJobId,
      },
      201,
    );
  });

  return app;
}

async function readStoryJsonBody(c: Context<AppEnv>): Promise<unknown> {
  return readJsonBody(c, {
    maxBytes: REQUEST_BODY_LIMITS.STORY_JSON_BYTES,
    description: 'Story JSON request',
  });
}

function parseUuidParam(c: Context<AppEnv>, name: string): string {
  const result = storyUuidParamSchema.safeParse(c.req.param(name));
  if (!result.success) {
    throw new ValidationError(`${name} must be a valid UUID`);
  }

  return result.data;
}

function toWorkResponse(work: Work): Record<string, unknown> {
  return {
    id: work.id,
    title: work.title,
    organization_id: work.organizationId ?? null,
    genre: work.genre,
    world_setting: work.worldSetting,
    theme: work.theme,
    main_entity_ids: work.mainEntityIds,
    starting_point: work.startingPoint,
    ending_point: work.endingPoint,
    overall_flow: work.overallFlow,
    version: work.version,
    status: work.status,
    created_at: work.createdAt.toISOString(),
    updated_at: work.updatedAt.toISOString(),
  };
}

function toChapterResponse(chapter: Chapter): Record<string, unknown> {
  return {
    id: chapter.id,
    work_id: chapter.workId,
    order: chapter.order,
    title: chapter.title,
    purpose: chapter.purpose,
    starting_state: chapter.startingState,
    ending_state: chapter.endingState,
    emotion_curve: chapter.emotionCurve,
    entities_involved: chapter.entitiesInvolved,
    key_beats: chapter.keyBeats,
    version: chapter.version,
    status: chapter.status,
    created_at: chapter.createdAt.toISOString(),
    updated_at: chapter.updatedAt.toISOString(),
  };
}

function toEpisodeResponse(episode: Episode): Record<string, unknown> {
  return {
    id: episode.id,
    chapter_id: episode.chapterId,
    order: episode.order,
    title: episode.title,
    purpose: episode.purpose,
    story_input_mode: episode.storyInputMode,
    story_full_draft: episode.storyFullDraft,
    introduction: episode.introduction,
    middle: episode.middle,
    climax: episode.climax,
    ending_hook: episode.endingHook,
    estimated_pages: episode.estimatedPages,
    entities_involved: episode.entitiesInvolved,
    page_skeleton_generated: episode.pageSkeletonGenerated,
    version: episode.version,
    status: episode.status,
    created_at: episode.createdAt.toISOString(),
    updated_at: episode.updatedAt.toISOString(),
  };
}

function createSseResponse(stream: AsyncIterable<string>): Response {
  const encoder = new TextEncoder();

  return new Response(
    new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const chunk of stream) {
            controller.enqueue(
              encoder.encode(`event: chunk\ndata: ${JSON.stringify({ text: chunk })}\n\n`),
            );
          }
          controller.enqueue(encoder.encode('event: done\ndata: {}\n\n'));
        } catch {
          controller.enqueue(
            encoder.encode(
              `event: error\ndata: ${JSON.stringify({ message: 'Story collaboration stream failed' })}\n\n`,
            ),
          );
        } finally {
          controller.close();
        }
      },
    }),
    {
      headers: {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      },
    },
  );
}
