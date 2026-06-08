import { PANEL_FRAME_TEMPLATES } from '../../domain/constants/panelFrameTemplates.js';
import { STORY_AI_LIMITS } from '../../domain/constants/storyAi.js';
import { canonicalizeEntityMentionsInText, inferEntityIdsFromTexts } from '../../domain/entityAliases.js';
import { AppError, ConflictError, NotFoundError, ValidationError } from '../../domain/errors/index.js';
import { distributeStoryBeats } from '../../domain/storyBeatDistribution.js';
import { describeAppLanguage, type AppLanguage } from '../../domain/types/language.js';
import type {
  PageSkeletonPageDraft,
  PageSkeletonPanelDraft,
  PageSkeletonPersistResult,
} from '../../domain/types/storyAi.js';
import type { StoryRepository } from '../../repositories/StoryRepository.js';
import { sanitizePersistedErrorMessage } from '../../lib/errorSanitizer.js';
import type { StoryAiClientPort } from './StoryAiClientPort.js';

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
      const fallbackReason = sanitizePersistedErrorMessage(error, 'Page skeleton compiler failed');
      console.warn('page_skeleton_fallback', {
        episodeId,
        reason: fallbackReason,
      });
      pages = buildFallbackPageSkeleton({ ...context, language });
    }

    const allowedEntityIds = context.entities.map((entity) => entity.id);
    pages = repairGeneratedPageSkeleton(pages, allowedEntityIds);

    try {
      validatePageSkeleton(context.estimatedPages, allowedEntityIds, pages);
    } catch (error) {
      if (!(error instanceof ValidationError)) {
        throw error;
      }

      console.warn('page_skeleton_post_validation_fallback', {
        episodeId,
        reason: sanitizePersistedErrorMessage(error, 'Page skeleton validation failed'),
      });
      pages = repairGeneratedPageSkeleton(
        buildFallbackPageSkeleton({ ...context, language }),
        allowedEntityIds,
      );
      validatePageSkeleton(context.estimatedPages, allowedEntityIds, pages);
    }

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
    'Work in this order: first distribute the story across the exact page count, then decide each page purpose, then split each page into panel beats in reading order, then choose the visible entities for each panel.',
    `Return exactly ${estimatedPages} pages.`,
    `Allowed layout ids: ${Object.keys(PANEL_FRAME_TEMPLATES).join(', ')}.`,
    'Allowed panel_role values: establish, action, reaction, emphasis, transition, pause, impact.',
    'Allowed suggested_size values: standard, large, wide, narrow, splash.',
    'Each page must contain 1 to 8 panels.',
    'Each panel must include order, panel_role, suggested_size, situation_hint, suggested_entities, and suggested_dialogue_hint.',
    `Keep situation_hint concise and editable in ${outputLanguage}: one short sentence or fragment, not a full prose summary of the scene.`,
    'A page should not repeat the same beat in every panel. Each panel must have a distinct job in the page rhythm such as establish, approach, exchange, reaction, transition, or impact.',
    'Do not blindly copy all named characters into every panel. Choose only the visible subject or subjects that should actually appear in that panel.',
    'Suggested dialogue hints are optional, but use them for panels that naturally carry conversation, challenge, reaction, or inner realization.',
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
    aliases: string[];
    entityType: string;
    freeDescription: string | null;
  }>;
}): string {
  const canonicalize = (value: string | null): string =>
    canonicalizeEntityMentionsInText(value, context.entities) ?? '(none)';

  return [
    `Work title: ${context.workTitle}`,
    `Genre: ${context.workGenre ?? '(none)'}`,
    `World setting: ${context.worldSetting ?? '(none)'}`,
    `Theme: ${context.theme ?? '(none)'}`,
    `Episode title: ${context.episodeTitle ?? '(none)'}`,
    `Episode purpose: ${canonicalize(context.episodePurpose)}`,
    `Introduction: ${canonicalize(context.introduction)}`,
    `Middle: ${canonicalize(context.middle)}`,
    `Climax: ${canonicalize(context.climax)}`,
    `Ending hook: ${canonicalize(context.endingHook)}`,
    `Chapter consistency note: ${[context.chapterTitle, context.chapterPurpose].filter((value) => value !== null && value.trim().length > 0).join(' / ') || '(none)'}`,
    `Estimated pages: ${context.estimatedPages}`,
    `Scenes: ${context.sceneSummaries.map((scene) => canonicalizeEntityMentionsInText(scene, context.entities) ?? scene).join(' / ') || '(none)'}`,
    `Available entities: ${context.entities
      .map((entity) => `${entity.id}: ${entity.name} (${entity.entityType}${entity.freeDescription === null ? '' : `, ${entity.freeDescription}`}${entity.aliases.length === 0 ? '' : `, aliases: ${entity.aliases.join(', ')}`})`)
      .join(' / ') || '(none)'}`,
  ].join('\n');
}

function buildFallbackPageSkeleton(context: {
  estimatedPages: number;
  entitiesInvolved: string[];
  entities: Array<{
    id: string;
    name: string;
    aliases: string[];
    entityType: string;
    freeDescription: string | null;
  }>;
  introduction: string | null;
  middle: string | null;
  climax: string | null;
  endingHook: string | null;
  episodePurpose: string | null;
  sceneSummaries: string[];
  language: AppLanguage;
}): PageSkeletonPageDraft[] {
  const distributedBeats = buildDistributedStoryBeats(
    [
      context.introduction,
      context.middle,
      context.climax,
      context.endingHook,
      context.episodePurpose,
    ],
    context.estimatedPages,
    context.language,
  );
  const sceneTexts =
    context.sceneSummaries.length > 0
      ? context.sceneSummaries
      : [fallbackText(context.language, 'Episode progression', '話の進行')];

  return Array.from({ length: context.estimatedPages }, (_value, pageIndex) => {
    const suggestedLayout = selectFallbackSkeletonLayout(pageIndex, context.estimatedPages);
    const panelCount = PANEL_FRAME_TEMPLATES[suggestedLayout].panelCount;
    const pageBeat = distributedBeats[pageIndex] ?? distributedBeats[distributedBeats.length - 1];
    const sceneText = sceneTexts[Math.min(sceneTexts.length - 1, Math.floor((pageIndex * sceneTexts.length) / context.estimatedPages))];
    const pagePurpose =
      pageBeat ??
      fallbackText(context.language, `Page ${pageIndex + 1} progression`, `${pageIndex + 1}ページ目の進行`);
    const pageEntityIds = inferRelevantEntityIds(
      context.entities,
      [pagePurpose, sceneText, context.introduction, context.middle, context.climax, context.endingHook],
      4,
      context.entitiesInvolved,
    );
    const panelPlans = buildFallbackSkeletonPanelPlans(panelCount);

    return {
      pageNumber: pageIndex + 1,
      purpose: pagePurpose,
      suggestedPanelCount: panelCount,
      suggestedLayout,
      panels: panelPlans.map((panelPlan, panelIndex) => {
        const order = panelIndex + 1;
        const panelBeat = buildPanelFallbackBeat(
          pagePurpose,
          order,
          panelCount,
          context.language,
          panelPlan.focus,
        );
        const entityIds = selectFallbackPanelEntityIds(pageEntityIds, panelPlan.focus);
        const entityNames = entityIds
          .map((entityId) => context.entities.find((entity) => entity.id === entityId)?.name ?? entityId)
          .filter((value, index, array) => array.indexOf(value) === index);

        return {
          order,
          panelRole: panelPlan.role,
          suggestedSize: panelPlan.size,
          situationHint: buildFallbackSituationHint(
            sceneText,
            pagePurpose,
            panelBeat,
            panelPlan,
            entityNames,
            context.language,
          ),
          suggestedEntities: entityIds,
          suggestedDialogueHint: buildFallbackDialogueHint(panelPlan, entityNames, context.language),
        };
      }),
    };
  });
}

function buildFallbackSituationHint(
  sceneText: string,
  pagePurpose: string,
  panelBeat: string,
  panelPlan: FallbackSkeletonPanelPlan,
  entityNames: string[],
  language: AppLanguage,
): string {
  const scenePart = summarizeHint(sceneText, 60) ?? fallbackText(language, 'Current scene', '現在の場面');
  const purposePart =
    summarizeHint(pagePurpose, 56) ?? fallbackText(language, 'Advance the page clearly', 'ページの流れを明確に進める');
  const subject =
    entityNames.length === 0
      ? fallbackText(language, 'the scene itself', '場面そのもの')
      : entityNames.length === 1
        ? entityNames[0]
        : language === 'en'
          ? `${entityNames[0]} and ${entityNames[1]}`
          : `${entityNames[0]}と${entityNames[1]}`;

  if (language === 'en') {
    return [subject, fallbackRoleCue(panelPlan.focus, language), scenePart, summarizeHint(panelBeat, 48) ?? purposePart]
      .filter((value): value is string => value !== null)
      .join(' / ');
  }

  return [subject, fallbackRoleCue(panelPlan.focus, language), scenePart, summarizeHint(panelBeat, 48) ?? purposePart]
    .filter((value): value is string => value !== null)
    .join(' / ');
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

function buildDistributedStoryBeats(
  segments: Array<string | null | undefined>,
  totalPages: number,
  language: AppLanguage,
): string[] {
  const distributed = distributeStoryBeats(segments, totalPages, 140);

  if (distributed.length === 0) {
    return Array.from({ length: totalPages }, (_value, pageIndex) =>
      fallbackText(language, `Page ${pageIndex + 1} progression`, `${pageIndex + 1}ページ目の進行`),
    );
  }

  return distributed;
}

function buildPanelFallbackBeat(
  pagePurpose: string,
  panelOrder: number,
  panelCount: number,
  language: AppLanguage,
  focus: FallbackSkeletonPanelPlan['focus'],
): string {
  const cue =
    panelOrder === 1
      ? fallbackText(language, 'Set up the page beat', 'ページの主題を立ち上げる')
      : panelOrder === panelCount
        ? fallbackText(language, 'Land the page beat cleanly', 'ページの主題を印象づけて締める')
        : fallbackText(language, `Develop beat ${panelOrder}`, `${panelOrder}コマ目で流れを具体化する`);

  return [
    summarizeHint(pagePurpose, 90),
    fallbackRoleCue(focus, language),
    cue,
  ]
    .filter((value): value is string => value !== null)
    .join(' / ');
}

function inferRelevantEntityIds(
  entities: Array<{ id: string; name: string; aliases: string[] }>,
  texts: Array<string | null | undefined>,
  limit: number,
  preferredEntityIds: string[] = [],
): string[] {
  return inferEntityIdsFromTexts(entities, texts, limit, preferredEntityIds);
}

type FallbackSkeletonPanelPlan = {
  role: PageSkeletonPanelDraft['panelRole'];
  size: PageSkeletonPanelDraft['suggestedSize'];
  focus: 'setting' | 'lead' | 'exchange' | 'reaction' | 'transition' | 'impact' | 'pause';
};

function selectFallbackSkeletonLayout(
  pageIndex: number,
  totalPages: number,
): PageSkeletonPageDraft['suggestedLayout'] {
  if (totalPages <= 2) {
    return pageIndex === 0 ? 'standard_4' : 'top_wide_3';
  }
  if (pageIndex === 0) {
    return 'standard_4';
  }
  if (pageIndex === totalPages - 1) {
    return 'top_wide_3';
  }
  return pageIndex % 2 === 0 ? 'action_5' : 'standard_4';
}

function buildFallbackSkeletonPanelPlans(panelCount: number): FallbackSkeletonPanelPlan[] {
  const templates: Record<number, FallbackSkeletonPanelPlan[]> = {
    1: [{ role: 'emphasis', size: 'large', focus: 'lead' }],
    2: [
      { role: 'establish', size: 'wide', focus: 'setting' },
      { role: 'impact', size: 'large', focus: 'impact' },
    ],
    3: [
      { role: 'establish', size: 'large', focus: 'setting' },
      { role: 'action', size: 'standard', focus: 'exchange' },
      { role: 'impact', size: 'standard', focus: 'reaction' },
    ],
    4: [
      { role: 'establish', size: 'large', focus: 'setting' },
      { role: 'action', size: 'standard', focus: 'lead' },
      { role: 'reaction', size: 'standard', focus: 'reaction' },
      { role: 'impact', size: 'wide', focus: 'impact' },
    ],
    5: [
      { role: 'establish', size: 'wide', focus: 'setting' },
      { role: 'action', size: 'standard', focus: 'lead' },
      { role: 'action', size: 'standard', focus: 'exchange' },
      { role: 'reaction', size: 'standard', focus: 'reaction' },
      { role: 'impact', size: 'large', focus: 'impact' },
    ],
  };

  const exact = templates[panelCount];
  if (exact !== undefined) {
    return exact;
  }

  return Array.from({ length: panelCount }, (_value, index) => {
    if (index === 0) {
      return { role: 'establish', size: 'wide', focus: 'setting' } satisfies FallbackSkeletonPanelPlan;
    }
    if (index === panelCount - 1) {
      return { role: 'impact', size: 'large', focus: 'impact' } satisfies FallbackSkeletonPanelPlan;
    }
    if (index === panelCount - 2) {
      return { role: 'reaction', size: 'standard', focus: 'reaction' } satisfies FallbackSkeletonPanelPlan;
    }
    return { role: 'action', size: 'standard', focus: index % 2 === 0 ? 'exchange' : 'lead' } satisfies FallbackSkeletonPanelPlan;
  });
}

function selectFallbackPanelEntityIds(
  pageEntityIds: string[],
  focus: FallbackSkeletonPanelPlan['focus'],
): string[] {
  if (pageEntityIds.length === 0) {
    return [];
  }

  switch (focus) {
    case 'setting':
      return pageEntityIds.slice(0, Math.min(pageEntityIds.length, 2));
    case 'exchange':
    case 'impact':
      return pageEntityIds.slice(0, Math.min(pageEntityIds.length, 2));
    case 'reaction':
      return pageEntityIds.length > 1 ? [pageEntityIds[1]] : pageEntityIds.slice(0, 1);
    case 'transition':
    case 'pause':
    case 'lead':
    default:
      return pageEntityIds.slice(0, 1);
  }
}

function buildFallbackDialogueHint(
  panelPlan: FallbackSkeletonPanelPlan,
  entityNames: string[],
  language: AppLanguage,
): string | null {
  if (entityNames.length === 0) {
    return null;
  }

  switch (panelPlan.focus) {
    case 'exchange':
      return language === 'en'
        ? 'A short exchange, challenge, or refusal.'
        : '短いやり取り、牽制、あるいは拒否の一言。';
    case 'reaction':
      return language === 'en'
        ? 'A brief reaction, realization, or uneasy inner line.'
        : '短い反応、気づき、または不穏な内心。';
    case 'impact':
      return language === 'en'
        ? 'A decisive short line or sharp narration beat.'
        : '決めの短い一言、または鋭いナレーション。';
    default:
      return null;
  }
}

function fallbackRoleCue(focus: FallbackSkeletonPanelPlan['focus'], language: AppLanguage): string {
  if (language === 'ja') {
    switch (focus) {
      case 'setting':
        return '場面と空気をつかませる';
      case 'lead':
        return '主役の行動や姿勢を見せる';
      case 'exchange':
        return '向き合いや応酬を見せる';
      case 'reaction':
        return '感情の反応を拾う';
      case 'transition':
        return '次の流れへ橋渡しする';
      case 'impact':
        return 'このページの決定的な瞬間を見せる';
      case 'pause':
        return '間をつくる';
      default:
        return 'このコマの要点を見せる';
    }
  }

  switch (focus) {
    case 'setting':
      return 'Establish the setting and tension';
    case 'lead':
      return 'Show the lead subject and their intent';
    case 'exchange':
      return 'Show the visible exchange or confrontation';
    case 'reaction':
      return 'Capture the emotional reaction';
    case 'transition':
      return 'Bridge into the next beat';
    case 'impact':
      return 'Show the decisive impact';
    case 'pause':
      return 'Create a pause';
    default:
      return 'Carry the panel beat clearly';
  }
}

function fallbackText(language: AppLanguage, english: string, japanese: string): string {
  return language === 'en' ? english : japanese;
}

function repairGeneratedPageSkeleton(
  pages: PageSkeletonPageDraft[],
  allowedEntityIds: string[],
): PageSkeletonPageDraft[] {
  const allowedEntityIdSet = new Set(allowedEntityIds);

  return pages.map((page, pageIndex) => {
    const repairedPanels = page.panels.map((panel, panelIndex) => ({
      ...panel,
      order: panelIndex + 1,
      suggestedEntities: panel.suggestedEntities.filter(
        (entityId, index, values) =>
          values.indexOf(entityId) === index && allowedEntityIdSet.has(entityId),
      ),
    }));
    const actualPanelCount = repairedPanels.length;
    const matchingTemplates = Object.values(PANEL_FRAME_TEMPLATES).filter(
      (template) => template.panelCount === actualPanelCount,
    );
    const repairedLayout =
      matchingTemplates.length >= 1 ? matchingTemplates[0]!.id : page.suggestedLayout;

    return {
      ...page,
      pageNumber: pageIndex + 1,
      suggestedPanelCount: actualPanelCount,
      suggestedLayout: repairedLayout,
      panels: repairedPanels,
    };
  });
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

