import type { PanelEntityAssignment } from './panelEntityAssignment.js';
import type { PageGenerationMode } from './pageGeneration.js';

export type PageStatus = 'designing' | 'generating' | 'generated' | 'editing' | 'confirmed';
export type PageDialogueMode = 'image_baked' | 'balloon_only' | 'mixed';

export interface GeneratedPageImage {
  s3Key: string | null;
  cdnUrl: string | null;
  generationMode: PageGenerationMode | null;
  generatedAt: string | null;
}

export interface PageGenerationPanelContext {
  panelId: string;
  entities: PanelEntityAssignment[];
}

export interface PageGenerationContext {
  pageId: string;
  workId: string;
  layoutConfig: Record<string, unknown>;
  generatedImage: GeneratedPageImage | null;
  generationMode: PageGenerationMode | null;
  status: PageStatus;
  panels: PageGenerationPanelContext[];
}

export interface PagePromptContext {
  pageId: string;
  workId: string;
  pageNumber: number;
  episodePurpose: string | null;
  layoutConfig: Record<string, unknown>;
  dialogueMode: PageDialogueMode;
  pageDialogueToggle: boolean;
}

export interface PageGenerationStateUpdate {
  status: PageStatus;
  generationMode: PageGenerationMode | null;
}
