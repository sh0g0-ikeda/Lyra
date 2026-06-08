import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { z } from 'zod';
import { ValidationError } from '../domain/errors/index.js';
import { APP_LANGUAGES } from '../domain/types/language.js';
import type { PageSummary } from '../domain/types/page.js';
import { updatePageSettingsBodySchema } from '../lib/validators/page.schema.js';
import type { PageFinalizeServicePort } from '../services/page/PageFinalizeService.js';
import type { PageQueryServicePort } from '../services/page/PageQueryService.js';
import type { PageGenerationServicePort } from '../services/page/PageGenerationService.js';
import type { PageExportServicePort } from '../services/page/PageExportService.js';
import type { PageServicePort } from '../services/page/PageService.js';
import type { AppEnv } from '../types/app.js';
import { readJsonBody } from './requestBody.js';

const uuidParamSchema = z.string().uuid();
const languageBodySchema = z
  .object({
    language: z.enum(APP_LANGUAGES).optional().default('ja'),
  })
  .strict();

export interface PageRouteDependencies {
  authMiddleware: MiddlewareHandler<AppEnv>;
  rateLimitMiddleware: MiddlewareHandler<AppEnv>;
  pageFinalizeService: PageFinalizeServicePort;
  pageQueryService: PageQueryServicePort;
  pageGenerationService: PageGenerationServicePort;
  pageExportService: PageExportServicePort;
  pageService: PageServicePort;
}

export function createPageRoutes(dependencies: PageRouteDependencies): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use('*', dependencies.authMiddleware);
  app.use('*', dependencies.rateLimitMiddleware);

  app.get('/episodes/:id/pages', async (c) => {
    const user = c.get('user');
    const episodeId = parseUuidParam(c, 'id');
    const pages = await dependencies.pageQueryService.listEpisodePages(user.id, episodeId);

    return c.json({ pages: pages.map(toPageSummaryResponse) });
  });

  app.post('/episodes/:id/autofill-pages-from-story', async (c) => {
    const user = c.get('user');
    const episodeId = parseUuidParam(c, 'id');
    const hasBody = (c.req.header('content-type') ?? '').includes('application/json');
    const body = languageBodySchema.safeParse(hasBody ? await readJsonBody(c) : {});
    if (!body.success) {
      throw new ValidationError(body.error.message);
    }
    const result = await dependencies.pageService.autofillEpisodeFromStory(
      user.id,
      episodeId,
      body.data.language,
    );

    return c.json({
      updated_page_count: result.updatedPageCount,
      updated_panel_count: result.updatedPanelCount,
      updated_assignment_count: result.updatedAssignmentCount,
      filled_field_count: result.filledFieldCount,
      compiler_used: result.compilerUsed,
      compiler_provider: result.compilerProvider,
      compiler_model: result.compilerModel,
      compiler_prompt_version: result.compilerPromptVersion,
      compiler_error: result.compilerError,
    });
  });

  app.put('/pages/:id', async (c) => {
    const user = c.get('user');
    const pageId = parseUuidParam(c, 'id');
    const body = updatePageSettingsBodySchema.safeParse(await readJsonBody(c));
    if (!body.success) {
      throw new ValidationError(body.error.message);
    }

    const page = await dependencies.pageService.updatePageSettings(user.id, pageId, {
      dialogueMode: body.data.dialogue_mode,
      pageDialogueToggle: body.data.page_dialogue_toggle,
      styleReference: body.data.style_reference,
      storySourceSceneIds: body.data.story_source_scene_ids,
      storyPagePurpose: body.data.story_page_purpose,
      storyContinuityNote: body.data.story_continuity_note,
    });

    return c.json(toPageSummaryResponse(page));
  });

  app.post('/pages/:id/autofill-from-scenes', async (c) => {
    const user = c.get('user');
    const pageId = parseUuidParam(c, 'id');
    const hasBody = (c.req.header('content-type') ?? '').includes('application/json');
    const body = languageBodySchema.safeParse(hasBody ? await readJsonBody(c) : {});
    if (!body.success) {
      throw new ValidationError(body.error.message);
    }
    const result = await dependencies.pageService.autofillFromScenes(user.id, pageId, body.data.language);

    return c.json({
      updated_panel_count: result.updatedPanelCount,
      filled_field_count: result.filledFieldCount,
      compiler_used: result.compilerUsed,
      compiler_provider: result.compilerProvider,
      compiler_model: result.compilerModel,
      compiler_prompt_version: result.compilerPromptVersion,
      compiler_error: result.compilerError,
    });
  });

  app.post('/pages/:id/generate', async (c) => {
    const user = c.get('user');
    const pageId = parseUuidParam(c, 'id');
    const result = await dependencies.pageGenerationService.enqueuePageGeneration(user.id, pageId);

    return c.json({ job_id: result.jobId }, 202);
  });

  app.get('/pages/:id/export-image', async (c) => {
    const user = c.get('user');
    const pageId = parseUuidParam(c, 'id');
    const exportedImage = await dependencies.pageExportService.exportGeneratedImage(user.id, pageId);

    return c.body(new Uint8Array(exportedImage.imageData), 200, {
      'Content-Type': exportedImage.mimeType,
      'Cache-Control': 'no-store',
    });
  });

  app.post('/pages/:id/confirm', async (c) => {
    const user = c.get('user');
    const pageId = parseUuidParam(c, 'id');
    await dependencies.pageFinalizeService.confirmPage(user.id, pageId);

    return c.body(null, 204);
  });

  app.post('/pages/:id/reopen', async (c) => {
    const user = c.get('user');
    const pageId = parseUuidParam(c, 'id');
    await dependencies.pageFinalizeService.reopenPage(user.id, pageId);

    return c.body(null, 204);
  });

  return app;
}

function toPageSummaryResponse(page: PageSummary): Record<string, unknown> {
  return {
    id: page.id,
    episode_id: page.episodeId,
    page_number: page.pageNumber,
    layout_config: page.layoutConfig,
    story_source_scene_ids: page.storySourceSceneIds,
    story_page_purpose: page.storyPagePurpose,
    story_continuity_note: page.storyContinuityNote,
    dialogue_mode: page.dialogueMode,
    page_dialogue_toggle: page.pageDialogueToggle,
    generation_mode: page.generationMode,
    generated_image:
      page.generatedImage === null
        ? null
        : {
            s3_key: page.generatedImage.s3Key,
            cdn_url: page.generatedImage.cdnUrl,
            generation_mode: page.generatedImage.generationMode,
            generated_at: page.generatedImage.generatedAt,
          },
    status: page.status,
    panel_count: page.panelCount,
    frame_count: page.frameCount,
    balloon_count: page.balloonCount,
    created_at: page.createdAt.toISOString(),
    updated_at: page.updatedAt.toISOString(),
  };
}

function parseUuidParam(c: Context<AppEnv>, name: string): string {
  const result = uuidParamSchema.safeParse(c.req.param(name));
  if (!result.success) {
    throw new ValidationError(`${name} must be a valid UUID`);
  }

  return result.data;
}
