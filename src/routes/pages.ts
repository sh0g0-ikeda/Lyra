import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { z } from 'zod';
import { ValidationError } from '../domain/errors/index.js';
import { APP_LANGUAGES } from '../domain/types/language.js';
import type { PageSummary } from '../domain/types/page.js';
import type { PanelFrame } from '../domain/types/panelFrame.js';
import {
  applyPageLayoutTemplateBodySchema,
  updatePageSettingsBodySchema,
} from '../lib/validators/page.schema.js';
import { signImageCdnUrl } from '../infrastructure/aws/CloudFrontImageUrlSigner.js';
import { formatZodValidationError } from '../lib/validationErrorFormatter.js';
import { sanitizePersistedErrorMessage } from '../lib/errorSanitizer.js';
import type { PageFinalizeServicePort } from '../services/page/PageFinalizeService.js';
import type { PageQueryServicePort } from '../services/page/PageQueryService.js';
import type { PageGenerationServicePort } from '../services/page/PageGenerationService.js';
import type { PageExportServicePort } from '../services/page/PageExportService.js';
import type { PageLayoutServicePort } from '../services/page/PageLayoutService.js';
import type { PageServicePort } from '../services/page/PageService.js';
import type { OrganizationServicePort } from '../services/organization/OrganizationService.js';
import type { EpisodeStoryAutofillServicePort } from '../services/story/EpisodeStoryAutofillService.js';
import type { AppEnv } from '../types/app.js';
import { readJsonBody, readOptionalJsonBody, REQUEST_BODY_LIMITS } from './requestBody.js';

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
  episodeStoryAutofillService: EpisodeStoryAutofillServicePort;
  pageLayoutService: PageLayoutServicePort;
  organizationService?: OrganizationServicePort;
}

export function createPageRoutes(dependencies: PageRouteDependencies): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use('*', dependencies.authMiddleware);
  app.use('*', dependencies.rateLimitMiddleware);

  app.get('/episodes/:id/pages', async (c) => {
    const user = c.get('user');
    const episodeId = parseUuidParam(c, 'id');
    const organizationId = parseOptionalOrganizationId(c);
    await requireOrganizationCapability(c, dependencies, organizationId, 'view_work');
    const pages = await dependencies.pageQueryService.listEpisodePages(user.id, episodeId, organizationId);

    return c.json({ pages: await Promise.all(pages.map(toPageSummaryResponse)) });
  });

  app.post('/episodes/:id/autofill-pages-from-story', async (c) => {
    const user = c.get('user');
    const episodeId = parseUuidParam(c, 'id');
    const organizationId = parseOptionalOrganizationId(c);
    await requireOrganizationCapability(c, dependencies, organizationId, 'edit_work');
    const hasBody = (c.req.header('content-type') ?? '').includes('application/json');
    const body = languageBodySchema.safeParse(
      hasBody
        ? await readOptionalJsonBody(c, {
            maxBytes: REQUEST_BODY_LIMITS.SMALL_JSON_BYTES,
            description: 'Episode autofill options',
          })
        : {},
    );
    if (!body.success) {
      throw new ValidationError(formatZodValidationError(body.error));
    }
    const result = await dependencies.episodeStoryAutofillService.enqueueEpisodeStoryAutofill(
      user.id,
      episodeId,
      body.data.language,
      organizationId,
    );
    await recordOrganizationAudit(dependencies, organizationId, user.id, 'episode.story_autofill_queued', 'episode', episodeId, {
      job_id: result.jobId,
      language: body.data.language,
    });
    return c.json({ job_id: result.jobId }, 202);
  });

  app.put('/pages/:id', async (c) => {
    const user = c.get('user');
    const pageId = parseUuidParam(c, 'id');
    const organizationId = parseOptionalOrganizationId(c);
    await requireOrganizationCapability(c, dependencies, organizationId, 'edit_work');
    const body = updatePageSettingsBodySchema.safeParse(
      await readJsonBody(c, {
        maxBytes: REQUEST_BODY_LIMITS.SMALL_JSON_BYTES,
        description: 'Page settings',
      }),
    );
    if (!body.success) {
      throw new ValidationError(formatZodValidationError(body.error));
    }

    const page = await dependencies.pageService.updatePageSettings(
      user.id,
      pageId,
      {
        dialogueMode: body.data.dialogue_mode,
        pageDialogueToggle: body.data.page_dialogue_toggle,
        styleReference: body.data.style_reference,
        storySourceSceneIds: body.data.story_source_scene_ids,
        storyPagePurpose: body.data.story_page_purpose,
        storyContinuityNote: body.data.story_continuity_note,
      },
      organizationId,
    );
    await recordOrganizationAudit(dependencies, organizationId, user.id, 'page.settings_updated', 'page', pageId, {
      fields: Object.keys(body.data),
    });

    return c.json(await toPageSummaryResponse(page));
  });

  app.post('/pages/:id/layout-template', async (c) => {
    const user = c.get('user');
    const pageId = parseUuidParam(c, 'id');
    const organizationId = parseOptionalOrganizationId(c);
    await requireOrganizationCapability(c, dependencies, organizationId, 'edit_work');
    const body = applyPageLayoutTemplateBodySchema.safeParse(
      await readJsonBody(c, {
        maxBytes: REQUEST_BODY_LIMITS.SMALL_JSON_BYTES,
        description: 'Page layout template',
      }),
    );
    if (!body.success) {
      throw new ValidationError(formatZodValidationError(body.error));
    }

    const result = await dependencies.pageLayoutService.applyTemplate(
      user.id,
      pageId,
      {
        templateId: body.data.template_id,
        allowPanelTruncation: body.data.allow_panel_truncation,
      },
      organizationId,
    );
    await recordOrganizationAudit(dependencies, organizationId, user.id, 'page.layout_template_applied', 'page', pageId, {
      template_id: result.templateId,
      panel_count: result.panelCount,
      created_panel_count: result.createdPanelCount,
      deleted_panel_count: result.deletedPanelCount,
    });

    return c.json({
      template_id: result.templateId,
      panel_count: result.panelCount,
      created_panel_count: result.createdPanelCount,
      deleted_panel_count: result.deletedPanelCount,
      frames: result.frames.map(toPanelFrameResponse),
    });
  });

  app.post('/pages/:id/autofill-from-scenes', async (c) => {
    const user = c.get('user');
    const pageId = parseUuidParam(c, 'id');
    const organizationId = parseOptionalOrganizationId(c);
    await requireOrganizationCapability(c, dependencies, organizationId, 'edit_work');
    const hasBody = (c.req.header('content-type') ?? '').includes('application/json');
    const body = languageBodySchema.safeParse(
      hasBody
        ? await readOptionalJsonBody(c, {
            maxBytes: REQUEST_BODY_LIMITS.SMALL_JSON_BYTES,
            description: 'Page autofill options',
          })
        : {},
    );
    if (!body.success) {
      throw new ValidationError(formatZodValidationError(body.error));
    }
    const result = await dependencies.pageService.autofillFromScenes(
      user.id,
      pageId,
      body.data.language,
      organizationId,
    );
    await recordOrganizationAudit(dependencies, organizationId, user.id, 'page.autofill_from_scenes_applied', 'page', pageId, {
      updated_panel_count: result.updatedPanelCount,
      filled_field_count: result.filledFieldCount,
      compiler_used: result.compilerUsed,
    });

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
    const organizationId = parseOptionalOrganizationId(c);
    await requireOrganizationCapability(c, dependencies, organizationId, 'generate');
    const result = await dependencies.pageGenerationService.enqueuePageGeneration(user.id, pageId, organizationId);
    await recordOrganizationAudit(dependencies, organizationId, user.id, 'page.generation_queued', 'page', pageId, {
      job_id: result.jobId,
    });

    return c.json({ job_id: result.jobId }, 202);
  });

  app.get('/pages/:id/export-image', async (c) => {
    const user = c.get('user');
    const pageId = parseUuidParam(c, 'id');
    const organizationId = parseOptionalOrganizationId(c);
    await requireOrganizationCapability(c, dependencies, organizationId, 'export');
    const exportedImage = await dependencies.pageExportService.exportGeneratedImage(user.id, pageId, organizationId);

    return c.body(new Uint8Array(exportedImage.imageData), 200, {
      'Content-Type': exportedImage.mimeType,
      'Cache-Control': 'private, no-store',
    });
  });

  app.post('/pages/:id/confirm', async (c) => {
    const user = c.get('user');
    const pageId = parseUuidParam(c, 'id');
    const organizationId = parseOptionalOrganizationId(c);
    await requireOrganizationCapability(c, dependencies, organizationId, 'edit_work');
    await dependencies.pageFinalizeService.confirmPage(user.id, pageId, organizationId);
    await recordOrganizationAudit(dependencies, organizationId, user.id, 'page.confirmed', 'page', pageId);

    return c.body(null, 204);
  });

  app.post('/pages/:id/reopen', async (c) => {
    const user = c.get('user');
    const pageId = parseUuidParam(c, 'id');
    const organizationId = parseOptionalOrganizationId(c);
    await requireOrganizationCapability(c, dependencies, organizationId, 'edit_work');
    await dependencies.pageFinalizeService.reopenPage(user.id, pageId, organizationId);
    await recordOrganizationAudit(dependencies, organizationId, user.id, 'page.reopened', 'page', pageId);

    return c.body(null, 204);
  });

  return app;
}

async function toPageSummaryResponse(page: PageSummary): Promise<Record<string, unknown>> {
  const signedGeneratedImageUrl = await signImageCdnUrl(
    page.generatedImage?.cdnUrl,
    page.generatedImage?.s3Key,
  );

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
            generation_mode: page.generatedImage.generationMode,
            generated_at: page.generatedImage.generatedAt,
            ...(signedGeneratedImageUrl === null ? {} : { cdn_url: signedGeneratedImageUrl }),
          },
    status: page.status,
    panel_count: page.panelCount,
    frame_count: page.frameCount,
    balloon_count: page.balloonCount,
    created_at: page.createdAt.toISOString(),
    updated_at: page.updatedAt.toISOString(),
  };
}

function toPanelFrameResponse(frame: PanelFrame): Record<string, unknown> {
  return {
    id: frame.id,
    page_id: frame.pageId,
    panel_id: frame.panelId,
    vertices: frame.vertices,
    border_style: frame.borderStyle,
    border_width: frame.borderWidth,
    border_color: frame.borderColor,
    z_index: frame.zIndex,
    reading_order: frame.readingOrder,
  };
}

function parseUuidParam(c: Context<AppEnv>, name: string): string {
  const result = uuidParamSchema.safeParse(c.req.param(name));
  if (!result.success) {
    throw new ValidationError(`${name} must be a valid UUID`);
  }

  return result.data;
}

function parseOptionalOrganizationId(c: Context<AppEnv>): string | null {
  const raw = c.req.query('organization_id');
  if (raw === undefined || raw.trim().length === 0) {
    return null;
  }

  const result = uuidParamSchema.safeParse(raw);
  if (!result.success) {
    throw new ValidationError('organization_id must be a valid UUID');
  }

  return result.data;
}

async function requireOrganizationCapability(
  c: Context<AppEnv>,
  dependencies: PageRouteDependencies,
  organizationId: string | null,
  capability: Parameters<OrganizationServicePort['requireMembership']>[2],
): Promise<void> {
  if (organizationId === null) {
    return;
  }
  if (dependencies.organizationService === undefined) {
    throw new ValidationError('Organization service is not configured');
  }

  const user = c.get('user');
  await dependencies.organizationService.requireMembership(organizationId, user.id, capability);
}

async function recordOrganizationAudit(
  dependencies: PageRouteDependencies,
  organizationId: string | null,
  actorUserId: string,
  action: string,
  targetType: string,
  targetId: string | null,
  metadata?: Record<string, unknown>,
): Promise<void> {
  if (organizationId === null || dependencies.organizationService === undefined) {
    return;
  }
  try {
    await dependencies.organizationService.recordAuditEvent({
      organizationId,
      actorUserId,
      action,
      targetType,
      targetId,
      metadata,
    });
  } catch (error) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        event: 'organization_audit_log_failed',
        action,
        target_type: targetType,
        target_id: targetId,
        message: sanitizePersistedErrorMessage(error, 'Organization audit log failed'),
      }),
    );
  }
}
