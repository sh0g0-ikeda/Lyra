import { Hono, type MiddlewareHandler } from 'hono';
import { ValidationError } from '../domain/errors/index.js';
import type { Chapter, Episode, Work } from '../domain/types/story.js';
import { workBootstrapBodySchema, workCreationMetadataQuerySchema, parseWorkIds } from '../lib/validators/workBootstrap.schema.js';
import type { OrganizationServicePort } from '../services/organization/OrganizationService.js';
import type { WorkBootstrapServicePort } from '../services/story/WorkBootstrapService.js';
import type { AppEnv } from '../types/app.js';
import { parseOptionalOrganizationId, requireOrganizationCapability } from './organizationRouteHelpers.js';
import { readJsonBody, REQUEST_BODY_LIMITS } from './requestBody.js';

export interface WorkBootstrapRouteDependencies {
  authMiddleware: MiddlewareHandler<AppEnv>;
  rateLimitMiddleware: MiddlewareHandler<AppEnv>;
  organizationService?: OrganizationServicePort;
  workBootstrapService: WorkBootstrapServicePort;
}

export function createWorkBootstrapRoutes(dependencies: WorkBootstrapRouteDependencies): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use('*', dependencies.authMiddleware);
  app.use('*', dependencies.rateLimitMiddleware);
  app.post('/work-bootstraps', async (c) => {
    const body = workBootstrapBodySchema.safeParse(await readJsonBody(c, { maxBytes: REQUEST_BODY_LIMITS.SMALL_JSON_BYTES, description: 'Work bootstrap request' }));
    if (!body.success) throw new ValidationError('Invalid work bootstrap request');
    const organizationId = parseOptionalOrganizationId(c);
    await requireOrganizationCapability(c, dependencies, organizationId, 'create_work');
    await requireOrganizationCapability(c, dependencies, organizationId, 'edit_work');
    const result = await dependencies.workBootstrapService.create(c.get('user').id, { title:body.data.title, mode:body.data.mode, requestId:body.data.request_id, organizationId });
    return c.json({ work:toWork(result.work), chapter:toChapter(result.chapter), episode:toEpisode(result.episode), mode:result.mode }, 201);
  });
  app.get('/work-creation-metadata', async (c) => {
    const parsed = workCreationMetadataQuerySchema.safeParse({ work_ids:c.req.query('work_ids') });
    if (!parsed.success) throw new ValidationError('work_ids is required');
    let workIds: string[];
    try { workIds = parseWorkIds(parsed.data.work_ids); } catch { throw new ValidationError('work_ids must contain 1 to 100 UUIDs'); }
    const organizationId = parseOptionalOrganizationId(c);
    await requireOrganizationCapability(c, dependencies, organizationId, 'view_work');
    const metadata = await dependencies.workBootstrapService.listMetadata(c.get('user').id, organizationId, workIds);
    return c.json({ metadata:metadata.map((item) => ({ work_id:item.workId,mode:item.mode,entry_chapter_id:item.entryChapterId,entry_episode_id:item.entryEpisodeId })) });
  });
  return app;
}
function toWork(work: Work): Record<string,unknown> { return {id:work.id,title:work.title,organization_id:work.organizationId ?? null,genre:work.genre,world_setting:work.worldSetting,theme:work.theme,main_entity_ids:work.mainEntityIds,starting_point:work.startingPoint,ending_point:work.endingPoint,overall_flow:work.overallFlow,version:work.version,status:work.status,created_at:work.createdAt.toISOString(),updated_at:work.updatedAt.toISOString()}; }
function toChapter(chapter: Chapter): Record<string,unknown> { return {id:chapter.id,work_id:chapter.workId,order:chapter.order,title:chapter.title,purpose:chapter.purpose,starting_state:chapter.startingState,ending_state:chapter.endingState,emotion_curve:chapter.emotionCurve,entities_involved:chapter.entitiesInvolved,key_beats:chapter.keyBeats,version:chapter.version,status:chapter.status,created_at:chapter.createdAt.toISOString(),updated_at:chapter.updatedAt.toISOString()}; }
function toEpisode(episode: Episode): Record<string,unknown> { return {id:episode.id,chapter_id:episode.chapterId,order:episode.order,title:episode.title,purpose:episode.purpose,story_input_mode:episode.storyInputMode,story_full_draft:episode.storyFullDraft,introduction:episode.introduction,middle:episode.middle,climax:episode.climax,ending_hook:episode.endingHook,estimated_pages:episode.estimatedPages,entities_involved:episode.entitiesInvolved,starting_entity_states:[],page_skeleton_generated:episode.pageSkeletonGenerated,version:episode.version,status:episode.status,created_at:episode.createdAt.toISOString(),updated_at:episode.updatedAt.toISOString()}; }
