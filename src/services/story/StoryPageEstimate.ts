import type { AppLanguage } from '../../domain/types/language.js';
import type { StoryEpisodeDraftFields } from '../../domain/types/storyAi.js';

export interface StoryPageEstimateInput {
  episodeId: string;
  baseDraft: StoryEpisodeDraftFields;
  productionNotesEnabled: boolean;
  language: AppLanguage;
}

export interface StoryPageEstimateResult {
  panel_count: number;
  calculated_pages: number;
  estimated_pages: number;
  explicit_page_count: number | null;
}
