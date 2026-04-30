import { STORY_AI_LIMITS } from '../../domain/constants/storyAi.js';
import { NotFoundError, ValidationError } from '../../domain/errors/index.js';
import type { StoryCollaborationInput, StoryCollaborationTarget } from '../../domain/types/storyAi.js';
import type { StoryRepository } from '../../repositories/StoryRepository.js';
import type { StoryAiClientPort } from '../../infrastructure/anthropic/AnthropicStoryAiClient.js';

export interface StoryCollaborationServicePort {
  collaborate(userId: string, input: StoryCollaborationInput): Promise<AsyncIterable<string>>;
}

export class StoryCollaborationService implements StoryCollaborationServicePort {
  public constructor(
    private readonly storyRepository: StoryRepository,
    private readonly storyAiClient: StoryAiClientPort,
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
        systemPrompt: buildCollaborationSystemPrompt(input.layer),
        userPrompt: buildCollaborationUserPrompt(target, input),
      }),
    );
  }
}

function buildCollaborationSystemPrompt(layer: StoryCollaborationInput['layer']): string {
  return [
    'You are Lyra Story AI.',
    'Revise or extend the provided manga story draft in Japanese.',
    `Target layer: ${layer}.`,
    'Respect the existing setting, entity names, and continuity.',
    'Do not output markdown fences or explanations.',
    'Return only the revised Japanese prose that the user can review before applying.',
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
    'Write a clean revised draft in Japanese. Preserve continuity and named entities.',
  ].join('\n');
}

function formatTargetSummary(target: StoryCollaborationTarget): string {
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

    const renderedValue = Array.isArray(value) ? value.join(', ') : String(value);
    if (renderedValue.length === 0) {
      continue;
    }

    lines.push(`${key}: ${renderedValue}`);
  }

  if (target.entities.length > 0) {
    const visibleEntities = target.entities.slice(0, 20);
    lines.push(
      `Entities: ${visibleEntities
        .map((entity) => `${entity.name} (${entity.entityType}${entity.freeDescription === null ? '' : `, ${entity.freeDescription}`})`)
        .join(' / ')}`,
    );
  }

  if (target.sceneSummaries.length > 0) {
    lines.push(`Scenes: ${target.sceneSummaries.join(' / ')}`);
  }

  return lines.join('\n');
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
