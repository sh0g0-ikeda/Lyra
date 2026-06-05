import type { PageSkeletonPageDraft, StoryEpisodeDraftFields } from '../../domain/types/storyAi.js';

export interface StoryAiModelRequest {
  systemPrompt: string;
  userPrompt: string;
}

export type StoryEpisodeDraftWriterOutput = Pick<
  StoryEpisodeDraftFields,
  'title' | 'purpose' | 'introduction' | 'middle' | 'climax' | 'endingHook'
>;

export interface StoryAiClientPort {
  streamCollaboration(request: StoryAiModelRequest): AsyncIterable<string>;
  generatePageSkeleton(request: StoryAiModelRequest): Promise<PageSkeletonPageDraft[]>;
  improveEpisodeDraft(request: StoryAiModelRequest): Promise<StoryEpisodeDraftWriterOutput>;
}
