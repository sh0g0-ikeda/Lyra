import type { PanelEntityAssignment } from './panelEntityAssignment.js';

export type PanelRole =
  | 'establish'
  | 'action'
  | 'reaction'
  | 'emphasis'
  | 'transition'
  | 'pause'
  | 'impact';

export type PanelSize = 'standard' | 'large' | 'wide' | 'narrow' | 'splash';

export type PanelCompositionSource = 'gallery' | 'custom' | 'ai_auto';
export type PanelShotType = 'full_body' | 'half_body' | 'close_up' | 'wide' | 'extreme_close_up';
export type PanelAngle =
  | 'front'
  | 'side'
  | 'three_quarter'
  | 'bird_eye'
  | 'worm_eye'
  | 'dutch_angle';

export type PanelDialogueType = 'speech' | 'thought' | 'narration' | 'shout' | 'whisper' | 'sfx';
export type PanelDialoguePosition = 'top' | 'bottom' | 'left' | 'right' | 'center';

export interface PanelComposition {
  source: PanelCompositionSource;
  galleryItemId: string | null;
  compositionPrompt: string | null;
  shotType: PanelShotType | null;
  angle: PanelAngle | null;
  customNote: string | null;
}

export interface PanelDialogueLine {
  entityId: string | null;
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
  entities: PanelEntityAssignment[];
  composition: PanelComposition;
  dialogueInPanel: boolean;
  dialogue: PanelDialogueLine[];
  sfxText: string | null;
  backgroundNote: string | null;
  panelNotes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreatePanelInput {
  order: number;
  panelRole?: PanelRole;
  panelSize?: PanelSize;
  situationText?: string | null;
  composition?: PanelComposition;
  dialogueInPanel?: boolean;
  dialogue?: PanelDialogueLine[];
  sfxText?: string | null;
  backgroundNote?: string | null;
  panelNotes?: string | null;
}

export interface UpdatePanelInput {
  order?: number;
  panelRole?: PanelRole;
  panelSize?: PanelSize;
  situationText?: string | null;
  composition?: PanelComposition;
  dialogueInPanel?: boolean;
  dialogue?: PanelDialogueLine[];
  sfxText?: string | null;
  backgroundNote?: string | null;
  panelNotes?: string | null;
}
