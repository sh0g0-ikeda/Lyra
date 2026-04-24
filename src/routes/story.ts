import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { ValidationError } from '../domain/errors/index.js';
import type { Chapter, Episode, Work } from '../domain/types/story.js';
import { collaborateStoryBodySchema, generatePageSkeletonParamSchema } from '../lib/validators/storyAi.schema.js';
import {
  createChapterBodySchema,
  createEpisodeBodySchema,
  createWorkBodySchema,
  storyUuidParamSchema,
  updateChapterBodySchema,
  updateEpisodeBodySchema,
  updateWorkBodySchema,
} from '../lib/validators/story.schema.js';
import type { StoryServicePort } from '../services/story/StoryService.js';
import type { StoryCollaborationServicePort } from '../services/story/StoryCollaborationService.js';
import type { PageSkeletonServicePort } from '../services/story/PageSkeletonService.js';
import type { AppEnv } from '../types/app.js';

export interface StoryRouteDependencies {
  authMiddleware: MiddlewareHandler<AppEnv>;
  rateLimitMiddleware: MiddlewareHandler<AppEnv>;
  pageSkeletonService: PageSkeletonServicePort;
  storyCollaborationService: StoryCollaborationServicePort;
  storyService: StoryServicePort;
}

export function createStoryRoutes(dependencies: StoryRouteDependencies): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use('*', dependencies.authMiddleware);
  app.use('*', dependencies.rateLimitMiddleware);

  app.post('/story/collaborate', async (c) => {
    const user = c.get('user');
    const body = collaborateStoryBodySchema.safeParse(await readJsonBody(c));

    if (!body.success) {
      throw new ValidationError(body.error.message);
    }

    const stream = await dependencies.storyCollaborationService.collaborate(user.id, {
      layer: body.data.layer,
      targetId: body.data.target_id,
      instruction: body.data.instruction,
      context: {
        currentDraft: body.data.context.current_draft,
        selectedText: body.data.context.selected_text,
        userNotes: body.data.context.user_notes,
        focusPoints: body.data.context.focus_points,
        constraints: body.data.context.constraints,
      },
    });

    return createSseResponse(stream);
  });

  app.post('/works', async (c) => {
    const user = c.get('user');
    const body = createWorkBodySchema.safeParse(await readJsonBody(c));

    if (!body.success) {
      throw new ValidationError(body.error.message);
    }

    const work = await dependencies.storyService.createWork(user.id, {
      title: body.data.title,
      genre: body.data.genre ?? null,
      worldSetting: body.data.world_setting ?? null,
      theme: body.data.theme ?? null,
      mainEntityIds: body.data.main_entity_ids ?? [],
      startingPoint: body.data.starting_point ?? null,
      endingPoint: body.data.ending_point ?? null,
      overallFlow: body.data.overall_flow ?? null,
    });

    return c.json(toWorkResponse(work), 201);
  });

  app.get('/works/:id', async (c) => {
    const user = c.get('user');
    const workId = parseUuidParam(c, 'id');
    const work = await dependencies.storyService.getWork(user.id, workId);

    return c.json(toWorkResponse(work));
  });

  app.put('/works/:id', async (c) => {
    const user = c.get('user');
    const workId = parseUuidParam(c, 'id');
    const body = updateWorkBodySchema.safeParse(await readJsonBody(c));

    if (!body.success) {
      throw new ValidationError(body.error.message);
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
    });

    return c.json(toWorkResponse(work));
  });

  app.post('/works/:id/chapters', async (c) => {
    const user = c.get('user');
    const workId = parseUuidParam(c, 'id');
    const body = createChapterBodySchema.safeParse(await readJsonBody(c));

    if (!body.success) {
      throw new ValidationError(body.error.message);
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
    });

    return c.json(toChapterResponse(chapter), 201);
  });

  app.get('/works/:id/chapters', async (c) => {
    const user = c.get('user');
    const workId = parseUuidParam(c, 'id');
    const chapters = await dependencies.storyService.listChapters(user.id, workId);

    return c.json({ chapters: chapters.map(toChapterResponse) });
  });

  app.put('/chapters/:id', async (c) => {
    const user = c.get('user');
    const chapterId = parseUuidParam(c, 'id');
    const body = updateChapterBodySchema.safeParse(await readJsonBody(c));

    if (!body.success) {
      throw new ValidationError(body.error.message);
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
    });

    return c.json(toChapterResponse(chapter));
  });

  app.delete('/chapters/:id', async (c) => {
    const user = c.get('user');
    const chapterId = parseUuidParam(c, 'id');
    await dependencies.storyService.deleteChapter(user.id, chapterId);

    return c.body(null, 204);
  });

  app.post('/chapters/:id/episodes', async (c) => {
    const user = c.get('user');
    const chapterId = parseUuidParam(c, 'id');
    const body = createEpisodeBodySchema.safeParse(await readJsonBody(c));

    if (!body.success) {
      throw new ValidationError(body.error.message);
    }

    const episode = await dependencies.storyService.createEpisode(user.id, chapterId, {
      order: body.data.order,
      title: body.data.title ?? null,
      purpose: body.data.purpose ?? null,
      introduction: body.data.introduction ?? null,
      middle: body.data.middle ?? null,
      climax: body.data.climax ?? null,
      endingHook: body.data.ending_hook ?? null,
      estimatedPages: body.data.estimated_pages,
      entitiesInvolved: body.data.entities_involved ?? [],
    });

    return c.json(toEpisodeResponse(episode), 201);
  });

  app.get('/chapters/:id/episodes', async (c) => {
    const user = c.get('user');
    const chapterId = parseUuidParam(c, 'id');
    const episodes = await dependencies.storyService.listEpisodes(user.id, chapterId);

    return c.json({ episodes: episodes.map(toEpisodeResponse) });
  });

  app.put('/episodes/:id', async (c) => {
    const user = c.get('user');
    const episodeId = parseUuidParam(c, 'id');
    const body = updateEpisodeBodySchema.safeParse(await readJsonBody(c));

    if (!body.success) {
      throw new ValidationError(body.error.message);
    }

    const episode = await dependencies.storyService.updateEpisode(user.id, episodeId, {
      order: body.data.order,
      title: body.data.title,
      purpose: body.data.purpose,
      introduction: body.data.introduction,
      middle: body.data.middle,
      climax: body.data.climax,
      endingHook: body.data.ending_hook,
      estimatedPages: body.data.estimated_pages,
      entitiesInvolved: body.data.entities_involved,
      status: body.data.status,
    });

    return c.json(toEpisodeResponse(episode));
  });

  app.delete('/episodes/:id', async (c) => {
    const user = c.get('user');
    const episodeId = parseUuidParam(c, 'id');
    await dependencies.storyService.deleteEpisode(user.id, episodeId);

    return c.body(null, 204);
  });

  app.post('/episodes/:id/generate-page-skeleton', async (c) => {
    const user = c.get('user');
    const parsedEpisodeId = generatePageSkeletonParamSchema.safeParse(c.req.param('id'));
    if (!parsedEpisodeId.success) {
      throw new ValidationError('id must be a valid UUID');
    }

    const result = await dependencies.pageSkeletonService.generateForEpisode(user.id, parsedEpisodeId.data);

    return c.json(
      {
        pages_created: result.pagesCreated,
        panels_created: result.panelsCreated,
      },
      201,
    );
  });

  return app;
}

async function readJsonBody(c: Context<AppEnv>): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw new ValidationError('Request body must be valid JSON');
  }
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
    user_id: work.userId,
    title: work.title,
    genre: work.genre,
    world_setting: work.worldSetting,
    theme: work.theme,
    main_entity_ids: work.mainEntityIds,
    starting_point: work.startingPoint,
    ending_point: work.endingPoint,
    overall_flow: work.overallFlow,
    version: work.version,
    edit_history: work.editHistory,
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
    edit_history: chapter.editHistory,
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
    introduction: episode.introduction,
    middle: episode.middle,
    climax: episode.climax,
    ending_hook: episode.endingHook,
    estimated_pages: episode.estimatedPages,
    entities_involved: episode.entitiesInvolved,
    page_skeleton_generated: episode.pageSkeletonGenerated,
    version: episode.version,
    edit_history: episode.editHistory,
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
