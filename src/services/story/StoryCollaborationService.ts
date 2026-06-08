import { STORY_AI_LIMITS } from '../../domain/constants/storyAi.js';
import { canonicalizeEntityMentionsInText } from '../../domain/entityAliases.js';
import {
  buildFullStoryDraftFromStructuredSections,
  normalizeEpisodeStoryInput,
} from '../../domain/episodeStoryInput.js';
import {
  compactCanonicalStoryPromptText,
  compactStoryPromptText,
  formatStoryPromptEntityList,
  formatStoryPromptParts,
  formatStoryPromptSummaryList,
  STORY_PROMPT_CONTEXT_LIMITS,
} from '../../domain/storyPromptCompaction.js';
import { NotFoundError, ValidationError } from '../../domain/errors/index.js';
import {
  STORY_EPISODE_IMPROVEMENT_WRITER_MODEL,
} from '../../domain/constants/storyAi.js';
import { describeAppLanguage } from '../../domain/types/language.js';
import { sanitizePersistedErrorMessage } from '../../lib/errorSanitizer.js';
import type {
  StoryCollaborationInput,
  StoryCollaborationTarget,
  StoryEpisodeImprovementAudit,
  StoryEpisodeDraftFields,
  StoryEpisodeImprovementContext,
  StoryEpisodeImprovementInput,
  StoryEpisodeImprovementPlan,
  StoryEpisodeImprovementResult,
} from '../../domain/types/storyAi.js';
import type { StoryRepository } from '../../repositories/StoryRepository.js';
import type { StoryEpisodeImprovementPlannerPort } from './StoryEpisodeImprovementPlanner.js';
import type { StoryAiClientPort } from './StoryAiClientPort.js';

export interface StoryCollaborationServicePort {
  collaborate(userId: string, input: StoryCollaborationInput): Promise<AsyncIterable<string>>;
  improveEpisodeDraft(
    userId: string,
    input: StoryEpisodeImprovementInput,
  ): Promise<StoryEpisodeImprovementResult>;
}

export class StoryCollaborationService implements StoryCollaborationServicePort {
  public constructor(
    private readonly storyRepository: StoryRepository,
    private readonly storyAiClient: StoryAiClientPort,
    private readonly storyEpisodeImprovementPlanner?: StoryEpisodeImprovementPlannerPort,
  ) {}

  public async collaborate(
    userId: string,
    input: StoryCollaborationInput,
  ): Promise<AsyncIterable<string>> {
    const target = await this.storyRepository.findCollaborationTargetByIdAndUserId(
      input.layer,
      input.targetId,
      userId,
    );
    if (target === null) {
      throw new NotFoundError(`${capitalizeLayer(input.layer)} not found`);
    }

    ensureContextFitsLimits(input);

    return limitStreamCharacters(
      this.storyAiClient.streamCollaboration({
        systemPrompt: buildCollaborationSystemPrompt(input.layer, input.language),
        userPrompt: buildCollaborationUserPrompt(target, input),
      }),
    );
  }

  public async improveEpisodeDraft(
    userId: string,
    input: StoryEpisodeImprovementInput,
  ): Promise<StoryEpisodeImprovementResult> {
    ensureEpisodeImprovementFitsLimits(input);
    const normalizedBaseDraft = normalizeEpisodeDraftFields(input.baseDraft);

    const context = await this.storyRepository.findEpisodeImprovementContextByIdAndUserId(
      input.episodeId,
      userId,
    );
    if (context === null) {
      throw new NotFoundError('Episode not found');
    }

    const directFallbackPromptVersion = 'story_episode_improve_v2';

    try {
      if (this.storyEpisodeImprovementPlanner === undefined) {
        const directDraft = await this.storyAiClient.improveEpisodeDraft({
          systemPrompt: buildEpisodeImprovementWriterSystemPrompt(input.language),
          userPrompt: buildEpisodeImprovementWriterUserPrompt(
            context,
            { ...input, baseDraft: normalizedBaseDraft },
            null,
            null,
          ),
        });

        return {
          draft: projectEpisodeDraftToMode(input.baseDraft.storyInputMode, directDraft),
          compilerProvider: 'openai',
          compilerModel: STORY_EPISODE_IMPROVEMENT_WRITER_MODEL,
          compilerPromptVersion: directFallbackPromptVersion,
          compilerError: null,
        };
      }

      const plan = await this.storyEpisodeImprovementPlanner.planEpisodeImprovement({
        instruction: input.instruction,
        language: input.language,
        baseDraft: normalizedBaseDraft,
        context,
      });

      const firstPass = normalizeStructuredWriterOutput(
        await this.storyAiClient.improveEpisodeDraft({
          systemPrompt: buildEpisodeImprovementWriterSystemPrompt(input.language),
          userPrompt: buildEpisodeImprovementWriterUserPrompt(
            context,
            { ...input, baseDraft: normalizedBaseDraft },
            plan.plan,
            null,
          ),
        }),
      );

      const audit = await this.storyEpisodeImprovementPlanner.auditEpisodeImprovement({
        instruction: input.instruction,
        language: input.language,
        baseDraft: normalizedBaseDraft,
        context,
        plan: plan.plan,
        draft: firstPass,
      });

      const finalDraft =
        audit.audit.verdict === 'revise' && hasActionableAuditNotes(audit.audit)
          ? normalizeStructuredWriterOutput(
              await this.storyAiClient.improveEpisodeDraft({
                systemPrompt: buildEpisodeImprovementWriterSystemPrompt(input.language),
                userPrompt: buildEpisodeImprovementWriterUserPrompt(
                  context,
                  { ...input, baseDraft: normalizedBaseDraft },
                  plan.plan,
                  audit.audit,
                ),
              }),
            )
          : firstPass;

      return {
        draft: projectEpisodeDraftToMode(input.baseDraft.storyInputMode, finalDraft),
        compilerProvider: 'openai',
        compilerModel: `${STORY_EPISODE_IMPROVEMENT_WRITER_MODEL} + ${plan.compilerModel}`,
        compilerPromptVersion: 'story_episode_improve_v2',
        compilerError:
          audit.audit.verdict === 'revise' && hasActionableAuditNotes(audit.audit)
            ? summarizeAuditNotes(audit.audit)
            : null,
      };
    } catch (error) {
      try {
        const directDraft = await this.storyAiClient.improveEpisodeDraft({
          systemPrompt: buildEpisodeImprovementWriterSystemPrompt(input.language),
          userPrompt: buildEpisodeImprovementWriterUserPrompt(
            context,
            { ...input, baseDraft: normalizedBaseDraft },
            null,
            null,
          ),
        });

        return {
          draft: projectEpisodeDraftToMode(input.baseDraft.storyInputMode, directDraft),
          compilerProvider: 'openai',
          compilerModel: STORY_EPISODE_IMPROVEMENT_WRITER_MODEL,
          compilerPromptVersion: directFallbackPromptVersion,
          compilerError: sanitizePersistedErrorMessage(error, 'Story planning failed'),
        };
      } catch (writerError) {
        return {
          draft: projectEpisodeDraftToMode(input.baseDraft.storyInputMode, normalizedBaseDraft),
          compilerProvider: 'fallback',
          compilerModel: null,
          compilerPromptVersion: directFallbackPromptVersion,
          compilerError: sanitizePersistedErrorMessage(writerError, 'Story improvement failed'),
        };
      }
    }
  }
}

function buildCollaborationSystemPrompt(
  layer: StoryCollaborationInput['layer'],
  language: StoryCollaborationInput['language'],
): string {
  const outputLanguage = describeAppLanguage(language);
  return [
    'You are Lyra Story AI.',
    `Revise or extend the provided manga story draft in ${outputLanguage}.`,
    `Target layer: ${layer}.`,
    'Respect the existing setting, entity names, and continuity.',
    'Do not output markdown fences or explanations.',
    `Return only the revised ${outputLanguage} prose that the user can review before applying.`,
  ].join('\n');
}

function buildCollaborationUserPrompt(
  target: StoryCollaborationTarget,
  input: StoryCollaborationInput,
): string {
  return [
    `Instruction:\n${input.instruction}`,
    '',
    `Target summary:\n${formatTargetSummary(target)}`,
    '',
    `Editor context:\n${formatContext(input)}`,
    '',
    `Write a clean revised draft in ${describeAppLanguage(input.language)}. Preserve continuity and named entities.`,
  ].join('\n');
}

function buildEpisodeImprovementWriterSystemPrompt(
  language: StoryEpisodeImprovementInput['language'],
): string {
  const outputLanguage = describeAppLanguage(language);
  return [
    'You are Lyra Story AI.',
    `You write the final ${outputLanguage} editor-facing episode draft for Lyra and return JSON only.`,
    'The current episode draft is the main editing target.',
    'Use work, chapter, sibling-episode, scene, and entity context only to preserve continuity.',
    'If a structured rewrite plan is provided, follow it closely.',
    'If audit notes are provided, resolve them without overreacting or inventing unrelated changes.',
    'Do not introduce major new plot turns, new characters, or new locations unless the instruction explicitly asks for them.',
    'You may add modest connective detail, sharper motivations, cleaner emotional logic, and more effective hooks when they are already implied by the material.',
    `Write each field in practical ${outputLanguage} prose for direct use in the editor form.`,
    'Write in a way that remains easy to split into scenes, pages, and panel beats later.',
    'Prefer concrete named subjects, visible actions, causal progression, emotional turns, and page-friendly beats over abstract summary language.',
    'The purpose field should stay concise. The story body fields may be richer, but they should still read like editable draft prose, not notes or bullet points.',
    'Return JSON with exactly these keys: title, purpose, introduction, middle, climax, ending_hook.',
    `Each value must be ${outputLanguage} prose or null. Do not add commentary or markdown.`,
  ].join('\n');
}

function buildEpisodeImprovementWriterUserPrompt(
  context: StoryEpisodeImprovementContext,
  input: StoryEpisodeImprovementInput,
  plan: StoryEpisodeImprovementPlan | null,
  audit: StoryEpisodeImprovementAudit | null,
): string {
  const storedEpisodeDraft = buildStoredEpisodeDraftFields(context);

  return [
    `Instruction:\n${input.instruction}`,
    '',
    `Current editable draft:\n${formatEpisodeDraftFields(input.baseDraft)}`,
    '',
    buildStoredEpisodePromptSection(input.baseDraft, storedEpisodeDraft),
    '',
    `Work context:\n${formatEpisodeImprovementContext(context)}`,
    '',
    plan === null ? null : `Structured rewrite plan:\n${formatEpisodeImprovementPlan(plan)}`,
    '',
    audit === null ? null : `Audit notes to resolve:\n${formatEpisodeImprovementAudit(audit)}`,
    '',
    'Revise the current editable draft so it reads cleaner, remains consistent with surrounding chapters and episodes, and stays suitable for later scene, page, and panel autofill.',
  ]
    .filter((line): line is string => line !== null)
    .join('\n');
}

function buildStoredEpisodeDraftFields(context: StoryEpisodeImprovementContext): StoryEpisodeDraftFields {
  const canonicalize = (value: string | null): string | null =>
    canonicalizeEntityMentionsInText(value, context.entities);

  return {
    title: canonicalize(context.episodeTitle),
    purpose: canonicalize(context.episodePurpose),
    storyInputMode: 'structured',
    storyFullDraft: null,
    introduction: canonicalize(context.introduction),
    middle: canonicalize(context.middle),
    climax: canonicalize(context.climax),
    endingHook: canonicalize(context.endingHook),
  };
}

function buildStoredEpisodePromptSection(
  baseDraft: StoryEpisodeDraftFields,
  storedDraft: StoryEpisodeDraftFields,
): string {
  if (episodeDraftsHaveSameEditableContent(baseDraft, storedDraft)) {
    return 'Current stored episode: same as current editable draft.';
  }

  return `Current stored episode:\n${formatEpisodeDraftFields(storedDraft)}`;
}

function formatTargetSummary(target: StoryCollaborationTarget): string {
  const canonicalize = (value: string | null): string | null =>
    canonicalizeEntityMentionsInText(value, target.entities);
  const lines: string[] = [
    `Work: ${target.workTitle}`,
  ];

  if (target.chapterTitle !== null) {
    lines.push(`Chapter: ${target.chapterTitle}`);
  }
  if (target.episodeTitle !== null) {
    lines.push(`Episode: ${target.episodeTitle}`);
  }

  for (const [key, value] of Object.entries(target.payload)) {
    if (value === null) {
      continue;
    }

    const renderedValue = Array.isArray(value)
      ? value
          .map((item) => compactStoryPromptText(item, STORY_PROMPT_CONTEXT_LIMITS.payloadFieldChars))
          .filter((item): item is string => item !== null)
          .join(', ')
      : compactStoryPromptText(value, STORY_PROMPT_CONTEXT_LIMITS.payloadFieldChars);
    if (renderedValue === null || renderedValue.length === 0) {
      continue;
    }

    lines.push(`${key}: ${canonicalize(renderedValue) ?? renderedValue}`);
  }

  if (target.entities.length > 0) {
    lines.push(`Entities: ${formatStoryPromptEntityList(target.entities)}`);
  }

  if (target.sceneSummaries.length > 0) {
    lines.push(
      `Scenes: ${formatStoryPromptSummaryList(target.sceneSummaries, target.entities, {
        maxItems: STORY_PROMPT_CONTEXT_LIMITS.maxSceneSummaries,
      })}`,
    );
  }

  return lines.join('\n');
}

function formatEpisodeDraftFields(draft: StoryEpisodeDraftFields): string {
  return [
    `Title: ${draft.title ?? '(none)'}`,
    `Purpose: ${draft.purpose ?? '(none)'}`,
    `Story input mode: ${draft.storyInputMode}`,
    `Full story draft: ${draft.storyFullDraft ?? '(none)'}`,
    `Introduction: ${draft.introduction ?? '(none)'}`,
    `Middle: ${draft.middle ?? '(none)'}`,
    `Climax: ${draft.climax ?? '(none)'}`,
    `Ending hook: ${draft.endingHook ?? '(none)'}`,
  ].join('\n');
}

function episodeDraftsHaveSameEditableContent(
  left: StoryEpisodeDraftFields,
  right: StoryEpisodeDraftFields,
): boolean {
  return (
    normalizeComparableDraftField(left.title) === normalizeComparableDraftField(right.title) &&
    normalizeComparableDraftField(left.purpose) === normalizeComparableDraftField(right.purpose) &&
    normalizeComparableDraftField(left.introduction) === normalizeComparableDraftField(right.introduction) &&
    normalizeComparableDraftField(left.middle) === normalizeComparableDraftField(right.middle) &&
    normalizeComparableDraftField(left.climax) === normalizeComparableDraftField(right.climax) &&
    normalizeComparableDraftField(left.endingHook) === normalizeComparableDraftField(right.endingHook)
  );
}

function normalizeComparableDraftField(value: string | null): string {
  return value?.replace(/\s+/gu, ' ').trim() ?? '';
}

function formatEpisodeImprovementContext(context: StoryEpisodeImprovementContext): string {
  const canonicalize = (value: string | null): string | null =>
    compactCanonicalStoryPromptText(value, context.entities);
  return [
    `Work: ${compactStoryPromptText(context.workTitle) ?? '(none)'}`,
    `Genre: ${compactStoryPromptText(context.workGenre) ?? '(none)'}`,
    `World setting: ${canonicalize(context.worldSetting) ?? '(none)'}`,
    `Theme: ${canonicalize(context.theme) ?? '(none)'}`,
    `Overall flow: ${canonicalize(context.overallFlow) ?? '(none)'}`,
    `Chapter: ${formatStoryPromptParts([context.chapterTitle, context.chapterPurpose], context.entities)}`,
    `Chapter arc: ${formatStoryPromptParts(
      [context.chapterStartingState, context.chapterEndingState, context.chapterEmotionCurve],
      context.entities,
    )}`,
    `Estimated pages: ${context.estimatedPages}`,
    `Entities: ${formatStoryPromptEntityList(context.entities)}`,
    `Scenes: ${formatStoryPromptSummaryList(context.sceneSummaries, context.entities, {
      maxItems: STORY_PROMPT_CONTEXT_LIMITS.maxSceneSummaries,
    })}`,
    `Other chapters: ${formatStoryPromptSummaryList(context.chapterSummaries, context.entities, {
      maxItems: STORY_PROMPT_CONTEXT_LIMITS.maxChapterSummaries,
    })}`,
    `Other episodes: ${formatStoryPromptSummaryList(context.siblingEpisodeSummaries, context.entities, {
      maxItems: STORY_PROMPT_CONTEXT_LIMITS.maxSiblingEpisodeSummaries,
    })}`,
  ].join('\n');
}

function formatEpisodeImprovementPlan(plan: StoryEpisodeImprovementPlan): string {
  return [
    `Story objective: ${plan.storyObjective ?? '(none)'}`,
    `Must preserve: ${plan.mustPreserve.join(' / ') || '(none)'}`,
    `Continuity guards: ${plan.continuityGuards.join(' / ') || '(none)'}`,
    `Page adaptation notes: ${plan.pageAdaptationNotes.join(' / ') || '(none)'}`,
    '',
    ...formatSectionPlan('Title', plan.title),
    ...formatSectionPlan('Purpose', plan.purpose),
    ...formatSectionPlan('Introduction', plan.introduction),
    ...formatSectionPlan('Middle', plan.middle),
    ...formatSectionPlan('Climax', plan.climax),
    ...formatSectionPlan('Ending hook', plan.endingHook),
  ].join('\n');
}

function formatSectionPlan(
  label: string,
  section: StoryEpisodeImprovementPlan['title'],
): string[] {
  return [
    `${label} objective: ${section.objective ?? '(none)'}`,
    `${label} must include: ${section.mustInclude.join(' / ') || '(none)'}`,
    `${label} visual beats: ${section.visualBeats.join(' / ') || '(none)'}`,
    `${label} narration hints: ${section.narrationHints.join(' / ') || '(none)'}`,
    `${label} continuity guards: ${section.continuityGuards.join(' / ') || '(none)'}`,
    `${label} avoid: ${section.avoid.join(' / ') || '(none)'}`,
  ];
}

function formatEpisodeImprovementAudit(audit: StoryEpisodeImprovementAudit): string {
  return [
    `Verdict: ${audit.verdict}`,
    `Global issues: ${audit.globalIssues.join(' / ') || '(none)'}`,
    `Title notes: ${audit.title.join(' / ') || '(none)'}`,
    `Purpose notes: ${audit.purpose.join(' / ') || '(none)'}`,
    `Introduction notes: ${audit.introduction.join(' / ') || '(none)'}`,
    `Middle notes: ${audit.middle.join(' / ') || '(none)'}`,
    `Climax notes: ${audit.climax.join(' / ') || '(none)'}`,
    `Ending hook notes: ${audit.endingHook.join(' / ') || '(none)'}`,
  ].join('\n');
}

function formatContext(input: StoryCollaborationInput): string {
  const lines: string[] = [];

  if (input.context.currentDraft !== null) {
    lines.push(`Current draft:\n${input.context.currentDraft}`);
  }
  if (input.context.selectedText !== null) {
    lines.push(`Selected text:\n${input.context.selectedText}`);
  }
  if (input.context.userNotes !== null) {
    lines.push(`User notes:\n${input.context.userNotes}`);
  }
  if (input.context.focusPoints.length > 0) {
    lines.push(`Focus points: ${input.context.focusPoints.join(' / ')}`);
  }
  if (input.context.constraints.length > 0) {
    lines.push(`Constraints: ${input.context.constraints.join(' / ')}`);
  }

  return lines.length === 0 ? '(none)' : lines.join('\n\n');
}

function ensureContextFitsLimits(input: StoryCollaborationInput): void {
  if (
    input.instruction.length > STORY_AI_LIMITS.instructionMaxLength ||
    (input.context.currentDraft?.length ?? 0) > STORY_AI_LIMITS.currentDraftMaxLength ||
    (input.context.selectedText?.length ?? 0) > STORY_AI_LIMITS.selectedTextMaxLength ||
    (input.context.userNotes?.length ?? 0) > STORY_AI_LIMITS.notesMaxLength
  ) {
    throw new ValidationError('Story collaboration context is too large');
  }

  const totalLength =
    input.instruction.length +
    (input.context.currentDraft?.length ?? 0) +
    (input.context.selectedText?.length ?? 0) +
    (input.context.userNotes?.length ?? 0) +
    input.context.focusPoints.join('').length +
    input.context.constraints.join('').length;

  if (totalLength > STORY_AI_LIMITS.currentDraftMaxLength + STORY_AI_LIMITS.notesMaxLength + 6000) {
    throw new ValidationError('Story collaboration context is too large');
  }
}

function ensureEpisodeImprovementFitsLimits(input: StoryEpisodeImprovementInput): void {
  const baseDraftLength =
    (input.baseDraft.title?.length ?? 0) +
    (input.baseDraft.purpose?.length ?? 0) +
    (input.baseDraft.storyFullDraft?.length ?? 0) +
    (input.baseDraft.introduction?.length ?? 0) +
    (input.baseDraft.middle?.length ?? 0) +
    (input.baseDraft.climax?.length ?? 0) +
    (input.baseDraft.endingHook?.length ?? 0);

  if (
    input.instruction.length > STORY_AI_LIMITS.instructionMaxLength ||
    baseDraftLength > STORY_AI_LIMITS.currentDraftMaxLength
  ) {
    throw new ValidationError('Story improvement context is too large');
  }
}

function normalizeEpisodeDraftFields(draft: StoryEpisodeDraftFields): StoryEpisodeDraftFields {
  const normalizedStoryInput = normalizeEpisodeStoryInput({
    storyInputMode: draft.storyInputMode,
    purpose: draft.purpose,
    introduction: draft.introduction,
    middle: draft.middle,
    climax: draft.climax,
    endingHook: draft.endingHook,
    storyFullDraft: draft.storyFullDraft,
  });

  return {
    title: normalizeNullableField(draft.title, 200),
    purpose: normalizeNullableField(normalizedStoryInput.purpose, 2000),
    storyInputMode: normalizedStoryInput.storyInputMode,
    storyFullDraft: normalizeNullableField(normalizedStoryInput.storyFullDraft, 8000),
    introduction: normalizeNullableField(normalizedStoryInput.normalizedIntroduction, 2000),
    middle: normalizeNullableField(normalizedStoryInput.normalizedMiddle, 2000),
    climax: normalizeNullableField(normalizedStoryInput.normalizedClimax, 2000),
    endingHook: normalizeNullableField(normalizedStoryInput.normalizedEndingHook, 2000),
  };
}

function normalizeStructuredWriterOutput(
  draft: Pick<
    StoryEpisodeDraftFields,
    'title' | 'purpose' | 'introduction' | 'middle' | 'climax' | 'endingHook'
  >,
): StoryEpisodeDraftFields {
  return normalizeEpisodeDraftFields({
    ...draft,
    storyInputMode: 'structured',
    storyFullDraft: null,
  });
}

function projectEpisodeDraftToMode(
  storyInputMode: StoryEpisodeDraftFields['storyInputMode'],
  draft: Pick<
    StoryEpisodeDraftFields,
    'title' | 'purpose' | 'introduction' | 'middle' | 'climax' | 'endingHook'
  >,
): StoryEpisodeDraftFields {
  const normalizedStructuredDraft = normalizeEpisodeDraftFields({
    ...draft,
    storyInputMode: 'structured',
    storyFullDraft: null,
  });

  if (storyInputMode === 'full') {
    return {
      title: normalizedStructuredDraft.title,
      purpose: normalizedStructuredDraft.purpose,
      storyInputMode: 'full',
      storyFullDraft: buildFullStoryDraftFromStructuredSections({
        introduction: normalizedStructuredDraft.introduction,
        middle: normalizedStructuredDraft.middle,
        climax: normalizedStructuredDraft.climax,
        endingHook: normalizedStructuredDraft.endingHook,
      }),
      introduction: null,
      middle: null,
      climax: null,
      endingHook: null,
    };
  }

  return {
    ...normalizedStructuredDraft,
    storyInputMode: 'structured',
    storyFullDraft: null,
  };
}

function normalizeNullableField(value: string | null, maxLength: number): string | null {
  if (value === null) {
    return null;
  }

  const normalized = value.trim();
  if (normalized.length === 0) {
    return null;
  }

  return normalized.slice(0, maxLength);
}

function hasActionableAuditNotes(audit: StoryEpisodeImprovementAudit): boolean {
  return (
    audit.globalIssues.length > 0 ||
    audit.title.length > 0 ||
    audit.purpose.length > 0 ||
    audit.introduction.length > 0 ||
    audit.middle.length > 0 ||
    audit.climax.length > 0 ||
    audit.endingHook.length > 0
  );
}

function summarizeAuditNotes(audit: StoryEpisodeImprovementAudit): string {
  return [
    ...audit.globalIssues,
    ...audit.title,
    ...audit.purpose,
    ...audit.introduction,
    ...audit.middle,
    ...audit.climax,
    ...audit.endingHook,
  ]
    .slice(0, 6)
    .join(' / ');
}

function capitalizeLayer(layer: StoryCollaborationInput['layer']): string {
  return layer.charAt(0).toUpperCase() + layer.slice(1);
}

async function* limitStreamCharacters(
  stream: AsyncIterable<string>,
): AsyncGenerator<string, void, void> {
  let totalLength = 0;

  for await (const chunk of stream) {
    totalLength += chunk.length;
    if (totalLength > STORY_AI_LIMITS.maxStreamingChars) {
      throw new ValidationError('Story collaboration output exceeded the maximum size');
    }

    yield chunk;
  }
}
