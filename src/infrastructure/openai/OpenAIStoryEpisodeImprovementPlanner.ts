import {
  STORY_EPISODE_IMPROVEMENT_AUDITOR_MAX_TOKENS,
  STORY_EPISODE_IMPROVEMENT_AUDITOR_OPENAI_MODEL,
  STORY_EPISODE_IMPROVEMENT_PLANNER_MAX_TOKENS,
  STORY_EPISODE_IMPROVEMENT_PLANNER_OPENAI_MODEL,
} from '../../domain/constants/storyAi.js';
import { describeAppLanguage } from '../../domain/types/language.js';
import type {
  StoryEpisodeDraftFields,
  StoryEpisodeImprovementPlan,
  StoryEpisodeImprovementSectionPlan,
} from '../../domain/types/storyAi.js';
import {
  compactStoryPromptText,
  formatStoryPromptEntityList,
  formatStoryPromptParts,
  formatStoryPromptSummaryList,
  STORY_PROMPT_CONTEXT_LIMITS,
} from '../../domain/storyPromptCompaction.js';
import {
  episodeImprovementAuditResponseSchema,
  episodeImprovementPlanResponseSchema,
} from '../../lib/validators/storyAi.schema.js';
import { OpenAIClient } from './OpenAIClient.js';
import { z } from 'zod';
import type {
  AuditStoryEpisodeImprovementInput,
  CompiledStoryEpisodeImprovementAudit,
  CompiledStoryEpisodeImprovementPlan,
  PlanStoryEpisodeImprovementInput,
  StoryEpisodeImprovementPlannerPort,
} from '../../services/story/StoryEpisodeImprovementPlanner.js';
import { requestStructuredOpenAIResponse } from './StructuredOpenAIResponse.js';

export class OpenAIStoryEpisodeImprovementPlanner implements StoryEpisodeImprovementPlannerPort {
  public constructor(
    private readonly client: OpenAIClient,
    private readonly plannerModel = STORY_EPISODE_IMPROVEMENT_PLANNER_OPENAI_MODEL,
    private readonly auditorModel = STORY_EPISODE_IMPROVEMENT_AUDITOR_OPENAI_MODEL,
  ) {}

  public async planEpisodeImprovement(
    input: PlanStoryEpisodeImprovementInput,
  ): Promise<CompiledStoryEpisodeImprovementPlan> {
    const validated = await requestStructuredOpenAIResponse({
      client: this.client,
      model: this.plannerModel,
      maxOutputTokens: STORY_EPISODE_IMPROVEMENT_PLANNER_MAX_TOKENS,
      schemaName: 'story_episode_improvement_plan',
      jsonSchema: episodeImprovementPlanJsonSchema,
      responseSchema: episodeImprovementPlanResponseSchema,
      errorLabel: 'OpenAI story improvement planner',
      input: [
        {
          role: 'system',
          content: [{ type: 'input_text', text: buildPlannerSystemPrompt(input.language) }],
        },
        {
          role: 'user',
            content: [{ type: 'input_text', text: buildPlannerUserPrompt(input) }],
        },
      ],
    });

    return {
      plan: mapPlanPayload(validated),
      compilerProvider: 'openai',
      compilerModel: this.plannerModel,
      compilerPromptVersion: 'story_episode_improve_plan_v1',
    };
  }

  public async auditEpisodeImprovement(
    input: AuditStoryEpisodeImprovementInput,
  ): Promise<CompiledStoryEpisodeImprovementAudit> {
    const validated = await requestStructuredOpenAIResponse({
      client: this.client,
      model: this.auditorModel,
      maxOutputTokens: STORY_EPISODE_IMPROVEMENT_AUDITOR_MAX_TOKENS,
      schemaName: 'story_episode_improvement_audit',
      jsonSchema: episodeImprovementAuditJsonSchema,
      responseSchema: episodeImprovementAuditResponseSchema,
      errorLabel: 'OpenAI story improvement audit',
      input: [
        {
          role: 'system',
          content: [{ type: 'input_text', text: buildAuditSystemPrompt(input.language) }],
        },
        {
          role: 'user',
            content: [{ type: 'input_text', text: buildAuditUserPrompt(input) }],
        },
      ],
    });

    return {
      audit: {
        verdict: validated.verdict,
        globalIssues: validated.global_issues,
        introduction: validated.introduction,
        middle: validated.middle,
        climax: validated.climax,
        endingHook: validated.ending_hook,
      },
      compilerProvider: 'openai',
      compilerModel: this.auditorModel,
      compilerPromptVersion: 'story_episode_improve_audit_v1',
    };
  }
}

function buildPlannerSystemPrompt(language: PlanStoryEpisodeImprovementInput['language']): string {
  const outputLanguage = describeAppLanguage(language);
  return [
    'You prepare a structured improvement plan for one manga episode draft in Lyra.',
    'You are not writing the final surface prose for the editor fields.',
    'Your job is to infer how the draft should be improved so that a later writer can produce cleaner Japanese prose without breaking continuity.',
    'Use work, chapter, sibling-episode, scene, and entity context to preserve consistency.',
    'Do not invent major new plot turns, new cast members, or new locations unless the instruction explicitly requires them.',
    'Bias the plan toward page and panel adaptation: every section should become easier to split into scenes, pages, and panel beats after rewriting.',
    'Prefer concrete visual and causal beats over abstract thematic summaries.',
    `For introduction, middle, climax, and ending_hook, identify compact visual beats and narration hints that would later help page autofill and panel planning in ${outputLanguage}.`,
    'Return JSON only.',
  ].join(' ');
}

function buildPlannerUserPrompt(input: PlanStoryEpisodeImprovementInput): string {
  const storedEpisodeDraft = buildStoredEpisodeDraftFields(input.context);

  return [
    `Instruction:\n${input.instruction}`,
    '',
    `Current editable draft:\n${formatEpisodeDraftFields(input.baseDraft)}`,
    '',
    buildStoredEpisodePromptSection(input.baseDraft, storedEpisodeDraft),
    '',
    `Context:\n${formatEpisodeImprovementContext(input.context)}`,
    '',
    'Return JSON with exactly these keys: story_objective, must_preserve, continuity_guards, page_adaptation_notes, introduction, middle, climax, ending_hook.',
    'Each section object must contain: objective, must_include, visual_beats, narration_hints, continuity_guards, avoid.',
    'Keep arrays compact and useful for later page and panel planning.',
  ].join('\n');
}

function buildStoredEpisodeDraftFields(
  context: PlanStoryEpisodeImprovementInput['context'],
): StoryEpisodeDraftFields {
  return {
    title: context.episodeTitle,
    purpose: context.episodePurpose,
    storyInputMode: 'structured',
    storyFullDraft: null,
    introduction: context.introduction,
    middle: context.middle,
    climax: context.climax,
    endingHook: context.endingHook,
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

function buildAuditSystemPrompt(language: AuditStoryEpisodeImprovementInput['language']): string {
  const outputLanguage = describeAppLanguage(language);
  return [
    'You audit a rewritten manga episode draft for Lyra.',
    `Check whether the ${outputLanguage} draft follows the user instruction, stays consistent with the surrounding story context, and remains suitable for later page and panel autofill.`,
    'Be strict about missing causal steps, lost emotional turns, contradictions with surrounding chapters or episodes, and sections that became too abstract to adapt into pages.',
    'Prefer revise when the draft is understandable but still underspecified for scene/page planning.',
    'Return JSON only.',
  ].join(' ');
}

function buildAuditUserPrompt(input: AuditStoryEpisodeImprovementInput): string {
  return [
    `Instruction:\n${input.instruction}`,
    '',
    `Base draft before rewrite:\n${formatEpisodeDraftFields(input.baseDraft)}`,
    '',
    `Structured improvement plan:\n${JSON.stringify(mapPlanForPrompt(input.plan), null, 2)}`,
    '',
    `Context:\n${formatEpisodeImprovementContext(input.context)}`,
    '',
    `Candidate rewritten draft:\n${formatEpisodeDraftFields(input.draft)}`,
    '',
    'Return JSON with keys: verdict, global_issues, introduction, middle, climax, ending_hook.',
    'Use short actionable notes only. If the draft is good enough, return verdict "pass" and empty arrays.',
  ].join('\n');
}

function formatEpisodeDraftFields(draft: StoryEpisodeDraftFields): string {
  return [
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
    normalizeComparableDraftField(left.introduction) === normalizeComparableDraftField(right.introduction) &&
    normalizeComparableDraftField(left.middle) === normalizeComparableDraftField(right.middle) &&
    normalizeComparableDraftField(left.climax) === normalizeComparableDraftField(right.climax) &&
    normalizeComparableDraftField(left.endingHook) === normalizeComparableDraftField(right.endingHook)
  );
}

function normalizeComparableDraftField(value: string | null): string {
  return value?.replace(/\s+/gu, ' ').trim() ?? '';
}

function formatEpisodeImprovementContext(
  context: PlanStoryEpisodeImprovementInput['context'],
): string {
  return [
    `Work: ${compactStoryPromptText(context.workTitle) ?? '(none)'}`,
    `Genre: ${compactStoryPromptText(context.workGenre) ?? '(none)'}`,
    `World setting: ${compactStoryPromptText(context.worldSetting) ?? '(none)'}`,
    `Theme: ${compactStoryPromptText(context.theme) ?? '(none)'}`,
    `Overall flow: ${compactStoryPromptText(context.overallFlow) ?? '(none)'}`,
    `Chapter: ${formatStoryPromptParts([context.chapterTitle, context.chapterPurpose], context.entities)}`,
    `Episode: ${formatStoryPromptParts([context.episodeTitle, context.episodePurpose], context.entities)}`,
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

function mapPlanPayload(
  payload: z.infer<typeof episodeImprovementPlanResponseSchema>,
): StoryEpisodeImprovementPlan {
  return {
    storyObjective: payload.story_objective,
    mustPreserve: payload.must_preserve,
    continuityGuards: payload.continuity_guards,
    pageAdaptationNotes: payload.page_adaptation_notes,
    introduction: mapSectionPlan(payload.introduction),
    middle: mapSectionPlan(payload.middle),
    climax: mapSectionPlan(payload.climax),
    endingHook: mapSectionPlan(payload.ending_hook),
  };
}

function mapSectionPlan(
  section: z.infer<typeof episodeImprovementPlanResponseSchema>['introduction'],
): StoryEpisodeImprovementSectionPlan {
  return {
    objective: section.objective,
    mustInclude: section.must_include,
    visualBeats: section.visual_beats,
    narrationHints: section.narration_hints,
    continuityGuards: section.continuity_guards,
    avoid: section.avoid,
  };
}

function mapPlanForPrompt(plan: StoryEpisodeImprovementPlan): Record<string, unknown> {
  return {
    story_objective: plan.storyObjective,
    must_preserve: plan.mustPreserve,
    continuity_guards: plan.continuityGuards,
    page_adaptation_notes: plan.pageAdaptationNotes,
    introduction: mapSectionForPrompt(plan.introduction),
    middle: mapSectionForPrompt(plan.middle),
    climax: mapSectionForPrompt(plan.climax),
    ending_hook: mapSectionForPrompt(plan.endingHook),
  };
}

function mapSectionForPrompt(
  section: StoryEpisodeImprovementSectionPlan,
): Record<string, unknown> {
  return {
    objective: section.objective,
    must_include: section.mustInclude,
    visual_beats: section.visualBeats,
    narration_hints: section.narrationHints,
    continuity_guards: section.continuityGuards,
    avoid: section.avoid,
  };
}

const nullableStringJsonSchema = {
  anyOf: [{ type: 'string' }, { type: 'null' }],
} as const;

const boundedStringListJsonSchema = {
  type: 'array',
  items: { type: 'string' },
} as const;

const episodeImprovementSectionPlanJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'objective',
    'must_include',
    'visual_beats',
    'narration_hints',
    'continuity_guards',
    'avoid',
  ],
  properties: {
    objective: nullableStringJsonSchema,
    must_include: boundedStringListJsonSchema,
    visual_beats: boundedStringListJsonSchema,
    narration_hints: boundedStringListJsonSchema,
    continuity_guards: boundedStringListJsonSchema,
    avoid: boundedStringListJsonSchema,
  },
} as const;

const episodeImprovementPlanJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'story_objective',
    'must_preserve',
    'continuity_guards',
    'page_adaptation_notes',
    'introduction',
    'middle',
    'climax',
    'ending_hook',
  ],
  properties: {
    story_objective: nullableStringJsonSchema,
    must_preserve: boundedStringListJsonSchema,
    continuity_guards: boundedStringListJsonSchema,
    page_adaptation_notes: boundedStringListJsonSchema,
    introduction: episodeImprovementSectionPlanJsonSchema,
    middle: episodeImprovementSectionPlanJsonSchema,
    climax: episodeImprovementSectionPlanJsonSchema,
    ending_hook: episodeImprovementSectionPlanJsonSchema,
  },
} as const;

const episodeImprovementAuditJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'verdict',
    'global_issues',
    'introduction',
    'middle',
    'climax',
    'ending_hook',
  ],
  properties: {
    verdict: { type: 'string', enum: ['pass', 'revise'] },
    global_issues: boundedStringListJsonSchema,
    introduction: boundedStringListJsonSchema,
    middle: boundedStringListJsonSchema,
    climax: boundedStringListJsonSchema,
    ending_hook: boundedStringListJsonSchema,
  },
} as const;
