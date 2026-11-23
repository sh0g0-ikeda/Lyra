import type { PageSkeletonPageDraft, StoryEpisodeDraftFields } from '../../domain/types/storyAi.js';
import type { ExtractedCharacter } from '../../../packages/api-contract/src/characterSuggestions.js';
import type { CharacterAutofillExtraction } from './CharacterAutofillFields.js';
import type { CharacterAppearanceCoverageResponse } from './CharacterAppearanceCoverage.js';
import type { ManuscriptLayoutResponse } from './StoryManuscriptLayout.js';

export interface StoryAiModelRequest {
  systemPrompt: string;
  userPrompt: string;
}

export type StoryEpisodeDraftWriterOutput = Pick<
  StoryEpisodeDraftFields,
  'introduction' | 'middle' | 'climax' | 'endingHook'
>;

export interface StoryPanelCountEstimate {
  blockId: string;
  panelCount: number;
}

export interface StoryManuscriptFragmentOutput {
  id: string;
  text: string;
}

export interface StoryAiClientPort {
  planManuscriptLayouts?(request: StoryAiModelRequest): Promise<ManuscriptLayoutResponse>;
  estimateEpisodePanelCount?(request: StoryAiModelRequest): Promise<StoryPanelCountEstimate[]>;
  streamCollaboration(request: StoryAiModelRequest): AsyncIterable<string>;
  generatePageSkeleton(request: StoryAiModelRequest): Promise<PageSkeletonPageDraft[]>;
  improveEpisodeDraft(request: StoryAiModelRequest): Promise<StoryEpisodeDraftWriterOutput>;
  improveEpisodeManuscript?(request: StoryAiModelRequest): Promise<StoryManuscriptFragmentOutput[]>;
  extractEpisodeCharacters?(request: StoryAiModelRequest): Promise<ExtractedCharacter[]>;
  extractCharacterAutofill?(request: StoryAiModelRequest): Promise<CharacterAutofillExtraction>;
  reconcileCharacterAutofillCoverage?(
    request: StoryAiModelRequest,
  ): Promise<CharacterAppearanceCoverageResponse>;
  suggestEpisodeProductionNotes?(request: StoryAiModelRequest): Promise<string[]>;
}
