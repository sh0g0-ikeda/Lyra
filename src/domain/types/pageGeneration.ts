export type PageGenerationMode = 'standard' | 'thinking';
export type PageGenerationRequestKind = 'initial' | 'regenerate';
export type PageGenerationQuality = 'medium' | 'high';

export interface ModeSelectionInput {
  entityCount: number;
  panelCount: number;
}

export interface PageGenerationSelection {
  requestKind: PageGenerationRequestKind;
  mode: PageGenerationMode;
  quality: PageGenerationQuality;
  creditCost: number;
  requiresPlanner: boolean;
}
