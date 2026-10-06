import { createHash } from 'node:crypto';
import { PANEL_FRAME_TEMPLATE_IDS, getPanelFrameTemplate, buildPanelFrameTemplateInputs } from '../domain/constants/panelFrameTemplates.js';
import type { PageThumbnailServicePort } from '../services/page/PageThumbnailService.js';
import { imageMobileAccess, publicImageProvenance, requireAuthorizedWebImageClient } from '../domain/generation/ImageAccessPolicy.js';
import { env } from '../lib/env.js';
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { z } from 'zod';
import {
  pageLayoutTemplatesCatalogSchema,
  pageAutofillResponseSchema,
  pageGenerationReadinessSchema,
  saveAndGeneratePageResponseSchema,
  pageJobAcceptedResponseSchema,
  pageLayoutTemplateResponseSchema,
  pageSchema,
  pagesResponseSchema,
} from '../../packages/api-contract/src/mobileApiSchemas.js';
import { ConfigurationError, ValidationError } from '../domain/errors/index.js';
import {
  decodePageListCursor,
  encodePageListCursor,
  type PageListCursor,
} from '../domain/pagination.js';
import { APP_LANGUAGES } from '../domain/types/language.js';
import type { PageSummary } from '../domain/types/page.js';
import type { PanelFrame } from '../domain/types/panelFrame.js';
import {
  applyPageLayoutTemplateBodySchema,
  updatePageSettingsBodySchema,
  saveAndGeneratePageBodySchema,
} from '../lib/validators/page.schema.js';
import { signImageCdnUrl } from '../infrastructure/aws/CloudFrontImageUrlSigner.js';
import { formatZodValidationError } from '../lib/validationErrorFormatter.js';
import type { PageFinalizeServicePort } from '../services/page/PageFinalizeService.js';
import type { PageQueryServicePort } from '../services/page/PageQueryService.js';
import type { PageAtomicGenerationServicePort } from '../services/page/PageAtomicGenerationService.js';
import type { PageGenerationServicePort } from '../services/page/PageGenerationService.js';
import type { PageExportServicePort } from '../services/page/PageExportService.js';
import type { PageLayoutServicePort } from '../services/page/PageLayoutService.js';
import type { PageServicePort } from '../services/page/PageService.js';
import type { OrganizationServicePort } from '../services/organization/OrganizationService.js';
import type { EpisodeStoryAutofillServicePort } from '../services/story/EpisodeStoryAutofillService.js';
import type { AppEnv } from '../types/app.js';
import {
  parseOptionalOrganizationId,
  recordOrganizationAudit,
  requireOrganizationCapability,
} from './organizationRouteHelpers.js';
import { assertMobileResponseContract } from './mobileResponseContract.js';
import { readJsonBody, readOptionalJsonBody, REQUEST_BODY_LIMITS } from './requestBody.js';

const uuidParamSchema = z.string().uuid();
const MAX_PAGE_LIST_PAGE_LIMIT = 100;
const languageBodySchema = z
  .object({
    language: z.enum(APP_LANGUAGES).optional().default('ja'),
  })
  .strict();
const episodeStoryAutofillBodySchema = languageBodySchema.extend({
  state_autofill_version: z.literal('v1').optional(),
  state_assignment_policy: z.enum(['preserve_existing', 'overwrite_existing']).optional(),
}).strict().refine(
  (body) => body.state_assignment_policy === undefined || body.state_autofill_version === 'v1',
  {
    message: 'state_assignment_policy requires state_autofill_version=v1',
    path: ['state_assignment_policy'],
  },
);
const generatePageBodySchema = z.object({
  render_style: z.enum(['color', 'monochrome']).optional().default('color'),
}).strict();

export interface PageRouteDependencies {
  authMiddleware: MiddlewareHandler<AppEnv>;
  rateLimitMiddleware: MiddlewareHandler<AppEnv>;
  pageFinalizeService: PageFinalizeServicePort;
  pageQueryService: PageQueryServicePort;
  pageGenerationService: PageGenerationServicePort;
  pageAtomicGenerationService?: PageAtomicGenerationServicePort;
  pageExportService: PageExportServicePort;
  pageThumbnailService?: PageThumbnailServicePort;
  pageService: PageServicePort;
  episodeStoryAutofillService: EpisodeStoryAutofillServicePort;
  pageLayoutService: PageLayoutServicePort;
  organizationService?: OrganizationServicePort;
}

export function createPageRoutes(dependencies: PageRouteDependencies): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use('*', dependencies.authMiddleware);
  app.use('*', dependencies.rateLimitMiddleware);

  app.get('/page-layout-templates', (c) => {
    const templates = PANEL_FRAME_TEMPLATE_IDS.map((id) => ({
      id, label_key: `page.layoutTemplate.${id}`, panel_count: getPanelFrameTemplate(id).panelCount,
      reading_direction: 'right_to_left_top_to_bottom', preview_aspect_ratio: 0.7,
      supported_page_sizes: ['normalized_portrait'],
      frames: buildPanelFrameTemplateInputs(id).map((frame) => ({
        vertices: frame.vertices, border_style: frame.borderStyle, border_width: frame.borderWidth,
        border_color: frame.borderColor, z_index: frame.zIndex, reading_order: frame.readingOrder,
      })),
    }));
    return c.json(assertMobileResponseContract(pageLayoutTemplatesCatalogSchema, { templates }));
  });

  app.get('/pages/:id', async (c) => {
    const user = c.get('user'); const pageId = parseUuidParam(c, 'id');
    const organizationId = parseOptionalOrganizationId(c);
    await requireOrganizationCapability(c, dependencies, organizationId, 'view_work');
    if (dependencies.pageQueryService.getPage === undefined) throw new ConfigurationError('Page detail reader is not configured');
    const page = await dependencies.pageQueryService.getPage(user.id, pageId, organizationId);
    return c.json(assertMobileResponseContract(pageSchema, await toPageSummaryResponse(page)));
  });

  app.get('/pages/:id/thumbnail', async (c) => {
    const user = c.get('user'); const pageId = parseUuidParam(c, 'id');
    const organizationId = parseOptionalOrganizationId(c);
    await requireOrganizationCapability(c, dependencies, organizationId, 'view_work');
    const service = dependencies.pageThumbnailService;
    if (service === undefined) throw new ConfigurationError('Page thumbnails are not configured');
    // Authorization and provenance checks happen before conditional cache validation.
    const revision = await service.getGeneratedImageThumbnailRevision(user.id, pageId, organizationId);
    const etagFor = (value: string): string => `"page-thumbnail-${createHash('sha256').update(value).digest('hex').slice(0, 24)}"`;
    const headers = { 'Cache-Control': 'private, max-age=300', 'Content-Type': 'image/webp', ETag: etagFor(revision), Vary: 'Authorization' };
    if (c.req.header('If-None-Match') === headers.ETag) return c.body(null, 304, headers);
    const thumbnail = await service.getGeneratedImageThumbnail(user.id, pageId, organizationId);
    return c.body(new Uint8Array(thumbnail.imageData), 200, { ...headers, ETag: etagFor(thumbnail.revision) });
  });

  app.get('/episodes/:id/pages', async (c) => {
    const user = c.get('user');
    const episodeId = parseUuidParam(c, 'id');
    const organizationId = parseOptionalOrganizationId(c);
    await requireOrganizationCapability(c, dependencies, organizationId, 'view_work');
    const pageRequest = parsePageListPageRequest(c);
    if (pageRequest !== null) {
      const page = await dependencies.pageQueryService.listEpisodePagesPage(
        user.id,
        episodeId,
        pageRequest,
        organizationId,
      );
      const payload = {
        pages: await Promise.all(page.pages.map(toPageSummaryResponse)),
        next_cursor:
          page.nextCursor === null
            ? null
            : encodePageListCursor(page.nextCursor),
      };
      return c.json(
        assertMobileResponseContract(pagesResponseSchema, payload),
      );
    }

    const pages = await dependencies.pageQueryService.listEpisodePages(user.id, episodeId, organizationId);

    const payload = { pages: await Promise.all(pages.map(toPageSummaryResponse)) };
    return c.json(assertMobileResponseContract(pagesResponseSchema, payload));
  });

  app.post('/episodes/:id/autofill-pages-from-story', async (c) => {
    const user = c.get('user');
    const episodeId = parseUuidParam(c, 'id');
    const organizationId = parseOptionalOrganizationId(c);
    await requireOrganizationCapability(c, dependencies, organizationId, 'edit_work');
    const hasBody = (c.req.header('content-type') ?? '').includes('application/json');
    const body = episodeStoryAutofillBodySchema.safeParse(
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
      body.data.state_autofill_version === undefined
        ? undefined
        : {
            stateAutofillVersion: 'v1',
            stateAssignmentPolicy: body.data.state_assignment_policy ?? 'preserve_existing',
          },
    );
    await recordOrganizationAudit(dependencies, organizationId, user.id, 'episode.story_autofill_queued', 'episode', episodeId, {
      job_id: result.jobId,
      language: body.data.language,
    });
    const payload = { job_id: result.jobId };
    return c.json(assertMobileResponseContract(pageJobAcceptedResponseSchema, payload), 202);
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

    const payload = await toPageSummaryResponse(page);
    return c.json(assertMobileResponseContract(pageSchema, payload));
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

    const payload = {
      template_id: result.templateId,
      panel_count: result.panelCount,
      created_panel_count: result.createdPanelCount,
      deleted_panel_count: result.deletedPanelCount,
      frames: result.frames.map(toPanelFrameResponse),
    };
    return c.json(assertMobileResponseContract(pageLayoutTemplateResponseSchema, payload));
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

    const payload = {
      updated_panel_count: result.updatedPanelCount,
      filled_field_count: result.filledFieldCount,
      compiler_used: result.compilerUsed,
      compiler_provider: result.compilerProvider,
      compiler_model: result.compilerModel,
      compiler_prompt_version: result.compilerPromptVersion,
      compiler_error: result.compilerError,
    };
    return c.json(assertMobileResponseContract(pageAutofillResponseSchema, payload));
  });

  app.get('/pages/:id/generation-readiness', async (c) => {
    if (!dependencies.pageAtomicGenerationService) throw new ConfigurationError('Atomic page generation is not configured');
    c.header('Cache-Control', 'no-store');
    const user = c.get('user');
    const pageId = parseUuidParam(c, 'id');
    const organizationId = parseOptionalOrganizationId(c);
    await requireOrganizationCapability(c, dependencies, organizationId, 'generate');
    const readiness = await dependencies.pageAtomicGenerationService.getGenerationReadiness(user.id, pageId, organizationId);

    const payload = {
      ready: readiness.ready,
      blockers: readiness.blockers.map((blocker) => ({
        code: blocker.code,
        entity_id: blocker.entityId,
        field: blocker.field,
        action: blocker.action,
        message_key: blocker.messageKey,
      })),
      warnings: readiness.warnings,
      estimated_credit_cost: readiness.estimatedCreditCost,
      page_revision: readiness.pageRevision,
    };
    return c.json(assertMobileResponseContract(pageGenerationReadinessSchema, payload));
  });

  app.post('/pages/:id/save-and-generate', async (c) => {
    if (!dependencies.pageAtomicGenerationService) throw new ConfigurationError('Atomic page generation is not configured');
    c.header('Cache-Control', 'no-store');
    const user = c.get('user');
    const pageId = parseUuidParam(c, 'id');
    const organizationId = parseOptionalOrganizationId(c);
    await requireOrganizationCapability(c, dependencies, organizationId, 'edit_work');
    await requireOrganizationCapability(c, dependencies, organizationId, 'generate');
    const requestId = readIdempotencyKey(c);
    const body = saveAndGeneratePageBodySchema.safeParse(
      await readJsonBody(c, {
        maxBytes: REQUEST_BODY_LIMITS.SAVE_AND_GENERATE_JSON_BYTES,
        description: 'Save and generate page',
      }),
    );
    if (!body.success) {
      throw new ValidationError(formatZodValidationError(body.error));
    }

    const result = await dependencies.pageAtomicGenerationService.saveAndGenerate(
      user.id,
      pageId,
      {
        expectedUpdatedAt: body.data.expected_updated_at,
        page: {
          dialogueMode: body.data.page.dialogue_mode,
          pageDialogueToggle: body.data.page.page_dialogue_toggle,
          styleReference: body.data.page.style_reference,
          storySourceSceneIds: body.data.page.story_source_scene_ids,
          storyPagePurpose: body.data.page.story_page_purpose,
          storyContinuityNote: body.data.page.story_continuity_note,
        },
        panels: body.data.panels.map((panel) => ({
          id: panel.id,
          order: panel.order,
          panelRole: panel.panel_role,
          panelSize: panel.panel_size,
          situationText: panel.situation_text,
          composition: {
            source: panel.composition.source,
            galleryItemId: panel.composition.gallery_item_id,
            compositionPrompt: panel.composition.composition_prompt,
            shotType: panel.composition.shot_type,
            angle: panel.composition.angle,
            customNote: panel.composition.custom_note,
          },
          dialogueInPanel: panel.dialogue_in_panel,
          dialogue: panel.dialogue.map((dialogue) => ({
            entityId: dialogue.entity_id,
            text: dialogue.text,
            type: dialogue.type,
            position: dialogue.position,
          })),
          sfxText: panel.sfx_text,
          backgroundNote: panel.background_note,
          panelNotes: panel.panel_notes,
          entities: panel.entities.map((assignment) => ({
            entityId: assignment.entity_id,
            role: assignment.role,
            expression: assignment.expression,
            customExpression: assignment.custom_expression,
            action: assignment.action,
            customAction: assignment.custom_action,
            position: assignment.position,
            facingDirection: assignment.facing_direction,
            effectNote: assignment.effect_note,
            stateId: assignment.state_id,
          })),
        })),
        frames: body.data.frames.map((frame) => ({
          panelId: frame.panel_id,
          vertices: frame.vertices,
          borderStyle: frame.border_style,
          borderWidth: frame.border_width,
          borderColor: frame.border_color,
          zIndex: frame.z_index,
          readingOrder: frame.reading_order,
        })),
        language: body.data.generation.language,
        renderStyle: body.data.generation.render_style,
        requestId,
      },
      organizationId,
    );
    await recordOrganizationAudit(dependencies, organizationId, user.id, 'page.save_and_generate_queued', 'page', pageId, {
      job_id: result.jobId,
      request_id: requestId,
    });

    const payload = { job_id: result.jobId, page_revision: result.pageRevision };
    return c.json(assertMobileResponseContract(saveAndGeneratePageResponseSchema, payload), 202);
  });

  app.post('/pages/:id/generate', async (c) => {
    const user = c.get('user');
    const pageId = parseUuidParam(c, 'id');
    const organizationId = parseOptionalOrganizationId(c);
    await requireOrganizationCapability(c, dependencies, organizationId, 'generate');
    const body = generatePageBodySchema.safeParse(await readOptionalJsonBody(c, {
      maxBytes: REQUEST_BODY_LIMITS.SMALL_JSON_BYTES,
      description: 'Page generation request',
    }));
    if (!body.success) {
      throw new ValidationError(formatZodValidationError(body.error));
    }
    const result = await dependencies.pageGenerationService.enqueuePageGeneration(
      user.id, pageId, organizationId, body.data.render_style,
    );
    await recordOrganizationAudit(dependencies, organizationId, user.id, 'page.generation_queued', 'page', pageId, {
      job_id: result.jobId,
      render_style: body.data.render_style,
    });

    const payload = { job_id: result.jobId };
    return c.json(assertMobileResponseContract(pageJobAcceptedResponseSchema, payload), 202);
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

  app.get('/web/pages/:id/image', async (c) => {
    requireAuthorizedWebImageClient(c.get('authenticatedClientId'), env.WEB_IMAGE_DELIVERY_COGNITO_CLIENT_IDS.split(',').map((id) => id.trim()).filter(Boolean));
    const user = c.get('user');
    const pageId = parseUuidParam(c, 'id');
    const organizationId = parseOptionalOrganizationId(c);
    await requireOrganizationCapability(c, dependencies, organizationId, 'view_work');
    const image = await dependencies.pageExportService.exportGeneratedImage(user.id, pageId, organizationId, 'authorized_web');
    return c.body(new Uint8Array(image.imageData), 200, { 'Content-Type': image.mimeType, 'Cache-Control': 'private, no-store' });
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
  const signedGeneratedImageUrl = page.generatedImage !== null && imageMobileAccess(page.generatedImage) !== 'available'
    ? null : await signImageCdnUrl(page.generatedImage?.cdnUrl, page.generatedImage?.s3Key);

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
            ...publicImageProvenance(page.generatedImage),
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

function parsePageListPageRequest(
  c: Context<AppEnv>,
): { limit: number; cursor: PageListCursor | null } | null {
  const rawLimit = c.req.query('limit');
  const rawCursor = c.req.query('cursor');
  if (rawLimit === undefined && rawCursor === undefined) {
    return null;
  }
  if (rawLimit === undefined || !/^[0-9]+$/u.test(rawLimit)) {
    throw new ValidationError(
      'limit must be an integer from 1 to 100 and is required with cursor',
    );
  }

  const limit = Number(rawLimit);
  if (
    !Number.isSafeInteger(limit)
    || limit < 1
    || limit > MAX_PAGE_LIST_PAGE_LIMIT
  ) {
    throw new ValidationError('limit must be an integer from 1 to 100');
  }

  return {
    limit,
    cursor:
      rawCursor === undefined
        ? null
        : decodePageListCursor(rawCursor),
  };
}

function parseUuidParam(c: Context<AppEnv>, name: string): string {
  const result = uuidParamSchema.safeParse(c.req.param(name));
  if (!result.success) {
    throw new ValidationError(`${name} must be a valid UUID`);
  }

  return result.data;
}

function readIdempotencyKey(c: Context<AppEnv>): string {
  const value=c.req.header('Idempotency-Key');
  if(value===undefined || !/^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/u.test(value)) throw new ValidationError('Idempotency-Key must be 8 to 128 URL-safe characters');
  return value;
}
