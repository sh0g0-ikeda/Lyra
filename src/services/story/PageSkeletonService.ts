import { PANEL_FRAME_TEMPLATES } from '../../domain/constants/panelFrameTemplates.js';
import { STORY_AI_LIMITS } from '../../domain/constants/storyAi.js';
import { AppError, ConflictError, NotFoundError, ValidationError } from '../../domain/errors/index.js';
import { describeAppLanguage, type AppLanguage } from '../../domain/types/language.js';
import type { PageSkeletonPageDraft, PageSkeletonPersistResult } from '../../domain/types/storyAi.js';
import type { StoryRepository } from '../../repositories/StoryRepository.js';
import type { StoryAiClientPort } from '../../infrastructure/anthropic/AnthropicStoryAiClient.js';

export interface PageSkeletonServicePort {
  generateForEpisode(
    userId: string,
    episodeId: string,
    options?: { overwriteExisting?: boolean; language?: AppLanguage },
  ): Promise<PageSkeletonPersistResult>;
}

export class PageSkeletonService implements PageSkeletonServicePort {
  public constructor(
    private readonly storyRepository: StoryRepository,
    private readonly storyAiClient: StoryAiClientPort,
  ) {}

  public async generateForEpisode(
    userId: string,
    episodeId: string,
    options?: { overwriteExisting?: boolean; language?: AppLanguage },
  ): Promise<PageSkeletonPersistResult> {
    const overwriteExisting = options?.overwriteExisting === true;
    const language = options?.language ?? 'ja';
    const context = await this.storyRepository.findEpisodePageSkeletonContextByIdAndUserId(episodeId, userId);
    if (context === null) {
      throw new NotFoundError('Episode not found');
    }
    if (!overwriteExisting && context.pageSkeletonGenerated) {
      throw new ConflictError('Page skeleton has already been generated for this episode');
    }
    if (!overwriteExisting && context.existingPageCount > 0) {
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
        systemPrompt: buildPageSkeletonSystemPrompt(context.estimatedPages, language),
        userPrompt: buildPageSkeletonUserPrompt(context),
      });
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      pages = buildFallbackPageSkeleton({ ...context, language });
    }

    validatePageSkeleton(context.estimatedPages, context.entitiesInvolved, pages);

    const result = await this.storyRepository.createPageSkeleton(episodeId, userId, pages, {
      overwriteExisting,
    });
    if (result === null) {
      throw new NotFoundError('Episode not found');
    }

    return result;
  }
}

function buildPageSkeletonSystemPrompt(estimatedPages: number, language: AppLanguage): string {
  const outputLanguage = describeAppLanguage(language);
  return [
    'You are Lyra Story AI.',
    `Generate a manga page skeleton in ${outputLanguage} and return JSON only.`,
    'Treat the episode draft and scene list as the primary source of truth for page content.',
    'Use chapter context only as a consistency check so the episode does not contradict the larger chapter arc.',
    `Return exactly ${estimatedPages} pages.`,
    `Allowed layout ids: ${Object.keys(PANEL_FRAME_TEMPLATES).join(', ')}.`,
    'Each page must contain 1 to 8 panels.',
    'Each panel must include order, panel_role, suggested_size, situation_hint, suggested_entities, and suggested_dialogue_hint.',
    `Keep situation_hint concise and editable in ${outputLanguage}: one short sentence or fragment, not a full prose summary of the scene.`,
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
  sceneSummaries: string[];
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
    `Episode title: ${context.episodeTitle ?? '(none)'}`,
    `Episode purpose: ${context.episodePurpose ?? '(none)'}`,
    `Introduction: ${context.introduction ?? '(none)'}`,
    `Middle: ${context.middle ?? '(none)'}`,
    `Climax: ${context.climax ?? '(none)'}`,
    `Ending hook: ${context.endingHook ?? '(none)'}`,
    `Chapter consistency note: ${[context.chapterTitle, context.chapterPurpose].filter((value) => value !== null && value.trim().length > 0).join(' / ') || '(none)'}`,
    `Estimated pages: ${context.estimatedPages}`,
    `Scenes: ${context.sceneSummaries.join(' / ') || '(none)'}`,
    `Available entities: ${context.entities
      .map((entity) => `${entity.id}: ${entity.name} (${entity.entityType}${entity.freeDescription === null ? '' : `, ${entity.freeDescription}`})`)
      .join(' / ') || '(none)'}`,
  ].join('\n');
}

function buildFallbackPageSkeleton(context: {
  estimatedPages: number;
  entitiesInvolved: string[];
  introduction: string | null;
  middle: string | null;
  climax: string | null;
  endingHook: string | null;
  episodePurpose: string | null;
  sceneSummaries: string[];
  language: AppLanguage;
}): PageSkeletonPageDraft[] {
  const templateSequence = ['standard_4', 'top_wide_3', 'action_5', 'standard_4'] as const;
  const roleSequence = ['establish', 'action', 'reaction', 'transition', 'action', 'reaction', 'impact', 'pause'] as const;
  const sizeSequence = ['large', 'standard', 'standard', 'wide', 'standard', 'standard', 'large', 'narrow'] as const;
  const narrativeSegments = [
    context.introduction,
    context.middle,
    context.climax,
    context.endingHook,
    context.episodePurpose,
  ].filter((value): value is string => value !== null && value.trim().length > 0);
  const sceneText =
    context.sceneSummaries.length > 0
      ? context.sceneSummaries.join(' / ')
      : fallbackText(context.language, 'Episode progression', '話の進行');
  const leadEntityId = context.entitiesInvolved[0] ?? null;
  const secondaryEntityId = context.entitiesInvolved[1] ?? null;

  return Array.from({ length: context.estimatedPages }, (_value, pageIndex) => {
    const suggestedLayout = templateSequence[pageIndex % templateSequence.length];
    const panelCount = PANEL_FRAME_TEMPLATES[suggestedLayout].panelCount;
    const pagePurpose =
      narrativeSegments[pageIndex] ??
      narrativeSegments[narrativeSegments.length - 1] ??
      fallbackText(context.language, `Page ${pageIndex + 1} progression`, `${pageIndex + 1}ページ目の進行`);

    return {
      pageNumber: pageIndex + 1,
      purpose: pagePurpose,
      suggestedPanelCount: panelCount,
      suggestedLayout,
      panels: Array.from({ length: panelCount }, (_panelValue, panelIndex) => {
        const order = panelIndex + 1;
        const role = roleSequence[Math.min(panelIndex, roleSequence.length - 1)];
        const size = sizeSequence[Math.min(panelIndex, sizeSequence.length - 1)];
        const entities =
          panelIndex === 0 && leadEntityId !== null
            ? [leadEntityId]
            : panelIndex % 2 === 1 && secondaryEntityId !== null
              ? [secondaryEntityId]
              : leadEntityId !== null
                ? [leadEntityId]
                : [];

        return {
          order,
          panelRole: role,
          suggestedSize: size,
          situationHint:
            panelIndex === 0
              ? buildFallbackSituationHint(sceneText, pagePurpose, role, order, context.language)
              : buildFallbackSituationHint(pagePurpose, pagePurpose, role, order, context.language),
          suggestedEntities: entities,
          suggestedDialogueHint: null,
        };
      }),
    };
  });
}

function buildFallbackSituationHint(
  sceneText: string,
  pagePurpose: string,
  role: string,
  order: number,
  language: AppLanguage,
): string {
  const scenePart = summarizeHint(sceneText, 60) ?? fallbackText(language, 'Current scene', '現在の場面');
  const purposePart =
    summarizeHint(pagePurpose, 70) ?? fallbackText(language, 'Advance the page clearly', 'ページの流れを明確に進める');

  return [scenePart, purposePart, fallbackRoleCue(role, order, language)].join(' / ');
}

function summarizeHint(value: string | null | undefined, maxLength: number): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const normalized = value.replace(/\s+/gu, ' ').trim();
  if (normalized.length === 0) {
    return null;
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`;
}

function fallbackRoleCue(role: string, order: number, language: AppLanguage): string {
  if (language === 'ja') {
    switch (role) {
      case 'establish':
        return '場面と空気を見せる';
      case 'action':
        return `動きの主軸 ${order}`;
      case 'reaction':
        return `反応の主軸 ${order}`;
      case 'transition':
        return '次の流れへつなぐ';
      case 'impact':
        return '強い印象を見せる';
      case 'pause':
        return '間をつくる';
      default:
        return `${order}コマ目の主軸`;
    }
  }

  switch (role) {
    case 'establish':
      return 'Establish the setting and tension';
    case 'action':
      return `Action beat ${order}`;
    case 'reaction':
      return `Reaction beat ${order}`;
    case 'transition':
      return 'Bridge into the next beat';
    case 'impact':
      return 'Show the strongest impact';
    case 'pause':
      return 'Create a pause';
    default:
      return `Panel ${order} beat`;
  }
}

function fallbackText(language: AppLanguage, english: string, japanese: string): string {
  return language === 'en' ? english : japanese;
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

