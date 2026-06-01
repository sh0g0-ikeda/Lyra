import {
  PAGE_SKELETON_MAX_TOKENS,
  PAGE_SKELETON_MODEL,
  STORY_COLLABORATION_MAX_TOKENS,
  STORY_COLLABORATION_MODEL,
  STORY_EPISODE_IMPROVEMENT_WRITER_MAX_TOKENS,
  STORY_EPISODE_IMPROVEMENT_WRITER_MODEL,
} from '../../domain/constants/storyAi.js';
import type { PageSkeletonPageDraft, StoryEpisodeDraftFields } from '../../domain/types/storyAi.js';
import {
  improveEpisodeDraftResponseSchema,
  pageSkeletonResponseSchema,
} from '../../lib/validators/storyAi.schema.js';
import { AnthropicClient } from './AnthropicClient.js';

export interface StoryAiModelRequest {
  systemPrompt: string;
  userPrompt: string;
}

export interface StoryAiClientPort {
  streamCollaboration(request: StoryAiModelRequest): AsyncIterable<string>;
  generatePageSkeleton(request: StoryAiModelRequest): Promise<PageSkeletonPageDraft[]>;
  improveEpisodeDraft(request: StoryAiModelRequest): Promise<StoryEpisodeDraftFields>;
}

export class AnthropicStoryAiClient implements StoryAiClientPort {
  public constructor(private readonly client: AnthropicClient) {}

  public streamCollaboration(request: StoryAiModelRequest): AsyncIterable<string> {
    return this.client.streamMessageText({
      model: STORY_COLLABORATION_MODEL,
      system: request.systemPrompt,
      max_tokens: STORY_COLLABORATION_MAX_TOKENS,
      temperature: 0.7,
      messages: [
        {
          role: 'user',
          content: request.userPrompt,
        },
      ],
    });
  }

  public async generatePageSkeleton(request: StoryAiModelRequest): Promise<PageSkeletonPageDraft[]> {
    const response = await this.client.createMessageText({
      model: PAGE_SKELETON_MODEL,
      system: request.systemPrompt,
      max_tokens: PAGE_SKELETON_MAX_TOKENS,
      temperature: 0.2,
      messages: [
        {
          role: 'user',
          content: request.userPrompt,
        },
      ],
    });

    const normalizedText = stripMarkdownCodeFence(response.text);
    const parsed = pageSkeletonResponseSchema.parse(JSON.parse(normalizedText));

    return parsed.pages.map((page) => ({
      pageNumber: page.page_number,
      purpose: page.purpose,
      suggestedPanelCount: page.suggested_panel_count,
      suggestedLayout: page.suggested_layout,
      panels: page.panels.map((panel) => ({
        order: panel.order,
        panelRole: panel.panel_role,
        suggestedSize: panel.suggested_size,
        situationHint: panel.situation_hint,
        suggestedEntities: panel.suggested_entities,
        suggestedDialogueHint: panel.suggested_dialogue_hint,
      })),
    }));
  }

  public async improveEpisodeDraft(request: StoryAiModelRequest): Promise<StoryEpisodeDraftFields> {
    const response = await this.client.createMessageText({
      model: STORY_EPISODE_IMPROVEMENT_WRITER_MODEL,
      system: request.systemPrompt,
      max_tokens: STORY_EPISODE_IMPROVEMENT_WRITER_MAX_TOKENS,
      temperature: 0.3,
      messages: [
        {
          role: 'user',
          content: request.userPrompt,
        },
      ],
    });

    const normalizedText = stripMarkdownCodeFence(response.text);
    const parsed = improveEpisodeDraftResponseSchema.parse(JSON.parse(normalizedText));

    return {
      title: parsed.title,
      purpose: parsed.purpose,
      introduction: parsed.introduction,
      middle: parsed.middle,
      climax: parsed.climax,
      endingHook: parsed.ending_hook,
    };
  }
}

function stripMarkdownCodeFence(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith('```')) {
    return trimmed;
  }

  return trimmed
    .replace(/^```(?:json)?\s*/u, '')
    .replace(/\s*```$/u, '')
    .trim();
}
