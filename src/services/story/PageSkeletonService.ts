import { PANEL_FRAME_TEMPLATES } from '../../domain/constants/panelFrameTemplates.js';
import { STORY_AI_LIMITS } from '../../domain/constants/storyAi.js';
import { AppError, ConflictError, NotFoundError, ValidationError } from '../../domain/errors/index.js';
import type { PageSkeletonPageDraft, PageSkeletonPersistResult } from '../../domain/types/storyAi.js';
import type { StoryRepository } from '../../repositories/StoryRepository.js';
import type { StoryAiClientPort } from '../../infrastructure/anthropic/AnthropicStoryAiClient.js';

export interface PageSkeletonServicePort {
  generateForEpisode(userId: string, episodeId: string): Promise<PageSkeletonPersistResult>;
}

export class PageSkeletonService implements PageSkeletonServicePort {
  public constructor(
    private readonly storyRepository: StoryRepository,
    private readonly storyAiClient: StoryAiClientPort,
  ) {}

  public async generateForEpisode(userId: string, episodeId: string): Promise<PageSkeletonPersistResult> {
    const context = await this.storyRepository.findEpisodePageSkeletonContextByIdAndUserId(episodeId, userId);
    if (context === null) {
      throw new NotFoundError('Episode not found');
    }
    if (context.pageSkeletonGenerated) {
      throw new ConflictError('Page skeleton has already been generated for this episode');
    }
    if (context.existingPageCount > 0) {
      throw new ConflictError('Episode already has pages');
    }
    if (context.estimatedPages > STORY_AI_LIMITS.maxSkeletonPages) {
      throw new ValidationError(
        `estimatedPages must be ${STORY_AI_LIMITS.maxSkeletonPages} or less to generate a page skeleton`,
      );
    }

    let pages: PageSkeletonPageDraft[];
    try {
      pages = await this.storyAiClient.generatePageSkeleton({
        systemPrompt: buildPageSkeletonSystemPrompt(context.estimatedPages),
        userPrompt: buildPageSkeletonUserPrompt(context),
      });
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }

      throw new ValidationError('Generated page skeleton payload was invalid');
    }

    validatePageSkeleton(context.estimatedPages, context.entitiesInvolved, pages);

    const result = await this.storyRepository.createPageSkeleton(episodeId, userId, pages);
    if (result === null) {
      throw new NotFoundError('Episode not found');
    }

    return result;
  }
}

function buildPageSkeletonSystemPrompt(estimatedPages: number): string {
  return [
    'You are Lyra Story AI.',
    'Generate a manga page skeleton in Japanese and return JSON only.',
    `Return exactly ${estimatedPages} pages.`,
    `Allowed layout ids: ${Object.keys(PANEL_FRAME_TEMPLATES).join(', ')}.`,
    'Each page must contain 1 to 8 panels.',
    'Each panel must include order, panel_role, suggested_size, situation_hint, suggested_entities, and suggested_dialogue_hint.',
    'Use only entity IDs that appear in the provided available entities list.',
    'Do not wrap the JSON in markdown fences.',
  ].join('\n');
}

function buildPageSkeletonUserPrompt(context: {
  workTitle: string;
  workGenre: string | null;
  worldSetting: string | null;
  theme: string | null;
  chapterTitle: string | null;
  chapterPurpose: string | null;
  episodeTitle: string | null;
  episodePurpose: string | null;
  introduction: string | null;
  middle: string | null;
  climax: string | null;
  endingHook: string | null;
  estimatedPages: number;
  entities: Array<{
    id: string;
    name: string;
    entityType: string;
    freeDescription: string | null;
  }>;
}): string {
  return [
    `Work title: ${context.workTitle}`,
    `Genre: ${context.workGenre ?? '(none)'}`,
    `World setting: ${context.worldSetting ?? '(none)'}`,
    `Theme: ${context.theme ?? '(none)'}`,
    `Chapter title: ${context.chapterTitle ?? '(none)'}`,
    `Chapter purpose: ${context.chapterPurpose ?? '(none)'}`,
    `Episode title: ${context.episodeTitle ?? '(none)'}`,
    `Episode purpose: ${context.episodePurpose ?? '(none)'}`,
    `Introduction: ${context.introduction ?? '(none)'}`,
    `Middle: ${context.middle ?? '(none)'}`,
    `Climax: ${context.climax ?? '(none)'}`,
    `Ending hook: ${context.endingHook ?? '(none)'}`,
    `Estimated pages: ${context.estimatedPages}`,
    `Available entities: ${context.entities
      .map((entity) => `${entity.id}: ${entity.name} (${entity.entityType}${entity.freeDescription === null ? '' : `, ${entity.freeDescription}`})`)
      .join(' / ') || '(none)'}`,
  ].join('\n');
}

function validatePageSkeleton(
  estimatedPages: number,
  allowedEntityIds: string[],
  pages: PageSkeletonPageDraft[],
): void {
  if (pages.length !== estimatedPages) {
    throw new ValidationError('Generated page skeleton page count did not match estimated pages');
  }

  const pageNumbers = new Set<number>();
  const allowedEntityIdSet = new Set(allowedEntityIds);

  for (const page of pages) {
    if (pageNumbers.has(page.pageNumber)) {
      throw new ValidationError('Generated page skeleton contains duplicate page numbers');
    }
    pageNumbers.add(page.pageNumber);

    const template = PANEL_FRAME_TEMPLATES[page.suggestedLayout];
    if (template === undefined) {
      throw new ValidationError('Generated page skeleton used an unknown layout template');
    }
    if (page.suggestedPanelCount !== page.panels.length) {
      throw new ValidationError('Generated page skeleton panel count did not match panels array length');
    }
    if (page.suggestedPanelCount !== template.panelCount) {
      throw new ValidationError('Generated page skeleton panel count did not match layout template');
    }

    const panelOrders = new Set<number>();
    for (const panel of page.panels) {
      if (panelOrders.has(panel.order)) {
        throw new ValidationError('Generated page skeleton contains duplicate panel orders');
      }
      panelOrders.add(panel.order);

      const uniqueSuggestedEntities = new Set(panel.suggestedEntities);
      if (uniqueSuggestedEntities.size !== panel.suggestedEntities.length) {
        throw new ValidationError('Generated page skeleton contains duplicate suggested entities in a panel');
      }

      for (const entityId of panel.suggestedEntities) {
        if (!allowedEntityIdSet.has(entityId)) {
          throw new ValidationError('Generated page skeleton referenced an entity outside the episode');
        }
      }
    }

    for (let order = 1; order <= page.panels.length; order += 1) {
      if (!panelOrders.has(order)) {
        throw new ValidationError('Generated page skeleton panel orders must be contiguous');
      }
    }
  }

  for (let pageNumber = 1; pageNumber <= estimatedPages; pageNumber += 1) {
    if (!pageNumbers.has(pageNumber)) {
      throw new ValidationError('Generated page skeleton page numbers must be contiguous');
    }
  }
}
