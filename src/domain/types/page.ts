import type { LayoutTemplateId } from '../constants/layoutTemplates.js';

export type PageLayoutType = 'template' | 'custom' | 'ai_generated';
export type PageDialogueMode = 'image_baked' | 'balloon_only' | 'mixed';
export type PageGenerationMode = 'standard' | 'thinking';
export type PageStatus = 'designing' | 'generating' | 'generated' | 'editing' | 'confirmed';

export type PanelRole = 'establish' | 'action' | 'reaction' | 'emphasis' | 'transition' | 'pause' | 'impact';
export type PanelSize = 'standard' | 'large' | 'wide' | 'narrow' | 'splash';
export type PanelEntityRole = 'primary' | 'secondary' | 'background';
export type PanelExpression = 'determined' | 'calm' | 'angry' | 'sad' | 'surprised' | 'custom';
export type PanelAction = 'standing_firm' | 'attacking' | 'defending' | 'running' | 'custom';
export type PanelPosition = 'left' | 'center' | 'right' | 'background';
export type CompositionSource = 'gallery' | 'custom' | 'ai_auto';
export type PanelDialogueType = 'speech' | 'thought' | 'narration' | 'shout' | 'whisper' | 'sfx';
export type PanelDialoguePosition = 'top' | 'bottom' | 'left' | 'right' | 'center';

export interface PageLayoutConfig {
  type: PageLayoutType;
  templateId: LayoutTemplateId | null;
  panelCount: number;
  layoutReferenceS3Key: string | null;
  frameDefinitions: Record<string, unknown>[];
}

export interface GeneratedImage {
  s3Key: string | null;
  cdnUrl: string | null;
  generationMode: PageGenerationMode | null;
  generatedAt: string | null;
}

export interface Page {
  id: string;
  episodeId: string;
  sceneId: string | null;
  pageNumber: number;
  layoutConfig: PageLayoutConfig;
  dialogueMode: PageDialogueMode;
  pageDialogueToggle: boolean;
  generatedImage: GeneratedImage | null;
  generationMode: PageGenerationMode | null;
  panelIds: string[];
  status: PageStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface PanelEntity {
  entityId: string;
  role: PanelEntityRole;
  expression: PanelExpression;
  customExpression: string | null;
  action: PanelAction;
  customAction: string | null;
  position: PanelPosition;
  stateId: string | null;
}

export interface PanelComposition {
  source: CompositionSource;
  galleryItemId: string | null;
  compositionPrompt: string | null;
  shotType: string | null;
  angle: string | null;
  customNote: string | null;
}

export interface PanelDialogue {
  entityId: string;
  text: string;
  type: PanelDialogueType;
  position: PanelDialoguePosition;
}

export interface Panel {
  id: string;
  pageId: string;
  order: number;
  panelRole: PanelRole;
  panelSize: PanelSize;
  situationText: string | null;
  entities: PanelEntity[];
  composition: PanelComposition;
  dialogueInPanel: boolean;
  dialogue: PanelDialogue[];
  sfxText: string | null;
  backgroundNote: string | null;
  panelNotes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreatePageInput {
  sceneId: string | null;
  pageNumber: number;
  layoutConfig: PageLayoutConfig;
  dialogueMode: PageDialogueMode;
  pageDialogueToggle: boolean;
}

export interface UpdatePageInput {
  sceneId?: string | null;
  pageNumber?: number;
  layoutConfig?: PageLayoutConfig;
  dialogueMode?: PageDialogueMode;
  pageDialogueToggle?: boolean;
  status?: PageStatus;
}

export interface CreatePanelInput {
  order: number;
  panelRole: PanelRole;
  panelSize: PanelSize;
  situationText: string | null;
  entities: PanelEntity[];
  composition: PanelComposition;
  dialogueInPanel: boolean;
  dialogue: PanelDialogue[];
  sfxText: string | null;
  backgroundNote: string | null;
  panelNotes: string | null;
}

export interface UpdatePanelInput {
  order?: number;
  panelRole?: PanelRole;
  panelSize?: PanelSize;
  situationText?: string | null;
  entities?: PanelEntity[];
  composition?: PanelComposition;
  dialogueInPanel?: boolean;
  dialogue?: PanelDialogue[];
  sfxText?: string | null;
  backgroundNote?: string | null;
  panelNotes?: string | null;
}
