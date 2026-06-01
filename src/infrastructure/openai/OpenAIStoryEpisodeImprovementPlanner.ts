import { ConfigurationError } from '../../domain/errors/index.js';
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
} from '../../domain/types/storyAi.js';
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

interface OpenAICompilerResponse {
  output_text?: unknown;
  output?: unknown;
}

export class OpenAIStoryEpisodeImprovementPlanner implements StoryEpisodeImprovementPlannerPort {
  public constructor(
    private readonly client: OpenAIClient,
    private readonly plannerModel = STORY_EPISODE_IMPROVEMENT_PLANNER_OPENAI_MODEL,
    private readonly auditorModel = STORY_EPISODE_IMPROVEMENT_AUDITOR_OPENAI_MODEL,
  ) {}

  public async planEpisodeImprovement(
    input: PlanStoryEpisodeImprovementInput,
  ): Promise<CompiledStoryEpisodeImprovementPlan> {
    const response = await this.client.postJson<OpenAICompilerResponse>('/responses', {
      model: this.plannerModel,
      max_output_tokens: STORY_EPISODE_IMPROVEMENT_PLANNER_MAX_TOKENS,
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

    const outputText = extractOutputText(response.body);
    if (outputText === null) {
      throw new ConfigurationError('OpenAI story improvement planner returned no text output');
    }

    const normalized = normalizeCompiledJson(outputText);
    let parsed: unknown;
    try {
      parsed = JSON.parse(normalized);
    } catch {
      throw new ConfigurationError(
        `OpenAI story improvement planner returned invalid JSON: ${normalized.slice(0, 400)}`,
      );
    }

    const validated = episodeImprovementPlanResponseSchema.safeParse(parsed);
    if (!validated.success) {
      throw new ConfigurationError(
        `OpenAI story improvement planner returned an invalid payload: ${validated.error.message}`,
      );
    }

    return {
      plan: mapPlanPayload(validated.data),
      compilerProvider: 'openai',
      compilerModel: this.plannerModel,
      compilerPromptVersion: 'story_episode_improve_plan_v1',
    };
  }

  public async auditEpisodeImprovement(
    input: AuditStoryEpisodeImprovementInput,
  ): Promise<CompiledStoryEpisodeImprovementAudit> {
    const response = await this.client.postJson<OpenAICompilerResponse>('/responses', {
      model: this.auditorModel,
      max_output_tokens: STORY_EPISODE_IMPROVEMENT_AUDITOR_MAX_TOKENS,
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

    const outputText = extractOutputText(response.body);
    if (outputText === null) {
      throw new ConfigurationError('OpenAI story improvement audit returned no text output');
    }

    const normalized = normalizeCompiledJson(outputText);
    let parsed: unknown;
    try {
      parsed = JSON.parse(normalized);
    } catch {
      throw new ConfigurationError(
        `OpenAI story improvement audit returned invalid JSON: ${normalized.slice(0, 400)}`,
      );
    }

    const validated = episodeImprovementAuditResponseSchema.safeParse(parsed);
    if (!validated.success) {
      throw new ConfigurationError(
        `OpenAI story improvement audit returned an invalid payload: ${validated.error.message}`,
      );
    }

    return {
      audit: {
        verdict: validated.data.verdict,
        globalIssues: validated.data.global_issues,
        title: validated.data.title,
        purpose: validated.data.purpose,
        introduction: validated.data.introduction,
        middle: validated.data.middle,
        climax: validated.data.climax,
        endingHook: validated.data.ending_hook,
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
    'Keep purpose concise but practical: it should say what the episode accomplishes in story terms and what emotional or informational turn it must deliver.',
    'Return JSON only.',
  ].join(' ');
}

function buildPlannerUserPrompt(input: PlanStoryEpisodeImprovementInput): string {
  return [
    `Instruction:\n${input.instruction}`,
    '',
    `Current editable draft:\n${formatEpisodeDraftFields(input.baseDraft)}`,
    '',
    `Current stored episode:\n${formatEpisodeDraftFields({
      title: input.context.episodeTitle,
      purpose: input.context.episodePurpose,
      introduction: input.context.introduction,
      middle: input.context.middle,
      climax: input.context.climax,
      endingHook: input.context.endingHook,
    })}`,
    '',
    `Context:\n${formatEpisodeImprovementContext(input.context)}`,
    '',
    'Return JSON with exactly these keys: story_objective, must_preserve, continuity_guards, page_adaptation_notes, title, purpose, introduction, middle, climax, ending_hook.',
    'Each section object must contain: objective, must_include, visual_beats, narration_hints, continuity_guards, avoid.',
    'Keep arrays compact and useful for later page and panel planning.',
  ].join('\n');
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
    'Return JSON with keys: verdict, global_issues, title, purpose, introduction, middle, climax, ending_hook.',
    'Use short actionable notes only. If the draft is good enough, return verdict "pass" and empty arrays.',
  ].join('\n');
}

function formatEpisodeDraftFields(draft: StoryEpisodeDraftFields): string {
  return [
    `Title: ${draft.title ?? '(none)'}`,
    `Purpose: ${draft.purpose ?? '(none)'}`,
    `Introduction: ${draft.introduction ?? '(none)'}`,
    `Middle: ${draft.middle ?? '(none)'}`,
    `Climax: ${draft.climax ?? '(none)'}`,
    `Ending hook: ${draft.endingHook ?? '(none)'}`,
  ].join('\n');
}

function formatEpisodeImprovementContext(
  context: PlanStoryEpisodeImprovementInput['context'],
): string {
  return [
    `Work: ${context.workTitle}`,
    `Genre: ${context.workGenre ?? '(none)'}`,
    `World setting: ${context.worldSetting ?? '(none)'}`,
    `Theme: ${context.theme ?? '(none)'}`,
    `Overall flow: ${context.overallFlow ?? '(none)'}`,
    `Chapter: ${[context.chapterTitle, context.chapterPurpose].filter((value) => value !== null && value.length > 0).join(' / ') || '(none)'}`,
    `Chapter arc: ${[context.chapterStartingState, context.chapterEndingState, context.chapterEmotionCurve].filter((value) => value !== null && value.length > 0).join(' / ') || '(none)'}`,
    `Estimated pages: ${context.estimatedPages}`,
    `Entities: ${
      context.entities.map((entity) => `${entity.name} (${entity.entityType}${entity.freeDescription === null ? '' : `, ${entity.freeDescription}`})`).join(' / ') || '(none)'
    }`,
    `Scenes: ${context.sceneSummaries.join(' / ') || '(none)'}`,
    `Other chapters: ${context.chapterSummaries.join(' / ') || '(none)'}`,
    `Other episodes: ${context.siblingEpisodeSummaries.join(' / ') || '(none)'}`,
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
    title: mapSectionPlan(payload.title),
    purpose: mapSectionPlan(payload.purpose),
    introduction: mapSectionPlan(payload.introduction),
    middle: mapSectionPlan(payload.middle),
    climax: mapSectionPlan(payload.climax),
    endingHook: mapSectionPlan(payload.ending_hook),
  };
}

function mapSectionPlan(
  section: z.infer<typeof episodeImprovementPlanResponseSchema>['title'],
): StoryEpisodeImprovementPlan['title'] {
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
    title: mapSectionForPrompt(plan.title),
    purpose: mapSectionForPrompt(plan.purpose),
    introduction: mapSectionForPrompt(plan.introduction),
    middle: mapSectionForPrompt(plan.middle),
    climax: mapSectionForPrompt(plan.climax),
    ending_hook: mapSectionForPrompt(plan.endingHook),
  };
}

function mapSectionForPrompt(
  section: StoryEpisodeImprovementPlan['title'],
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

function extractOutputText(response: OpenAICompilerResponse): string | null {
  if (typeof response.output_text === 'string' && response.output_text.trim().length > 0) {
    return response.output_text.trim();
  }

  if (!Array.isArray(response.output)) {
    return null;
  }

  for (const item of response.output) {
    if (!isRecord(item) || !Array.isArray(item.content)) {
      continue;
    }

    for (const content of item.content) {
      if (!isRecord(content)) {
        continue;
      }

      const text = content.text;
      if (typeof text === 'string' && text.trim().length > 0) {
        return text.trim();
      }
    }
  }

  return null;
}

function normalizeCompiledJson(value: string): string {
  const trimmed = value.trim().replace(/^```(?:json)?\s*/u, '').replace(/\s*```$/u, '').trim();
  const extracted = extractFirstJsonObject(trimmed);
  return extracted ?? trimmed;
}

function extractFirstJsonObject(value: string): string | null {
  const start = value.indexOf('{');
  if (start < 0) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < value.length; index += 1) {
    const char = value[index];
    if (char === undefined) {
      continue;
    }

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }

      if (char === '\\') {
        escaped = true;
        continue;
      }

      if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === '{') {
      depth += 1;
      continue;
    }

    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return value.slice(start, index + 1);
      }
    }
  }

  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
