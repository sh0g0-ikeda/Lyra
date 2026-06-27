import type { PageStatus } from './page.js';
import type { PanelDialoguePosition, PanelDialogueType } from './panel.js';

export type PageGenerationMode = 'standard' | 'thinking';
export type PageGenerationRequestKind = 'initial' | 'regenerate';
export type PageGenerationQuality = 'medium' | 'high';
export type PageGenerationInputImageRole = 'entity_reference' | 'layout_reference';

export interface PageGenerationInputImage {
  role: PageGenerationInputImageRole;
  label: string;
  dataUrl: string;
}

export interface ModeSelectionInput {
  entityCount: number;
  panelCount: number;
}

export interface PageGenerationSelection {
  requestKind: PageGenerationRequestKind;
  mode: PageGenerationMode;
  quality: PageGenerationQuality;
  creditCost: number;
  billableReferenceCount: number;
  requiresPlanner: boolean;
}

export interface PageGenerationQueuePayload {
  jobId: string;
  userId: string;
  pageId: string;
  requestKind: PageGenerationRequestKind;
  generationMode: PageGenerationMode;
  quality: PageGenerationQuality;
  creditCost: number;
  requiresPlanner: boolean;
  previousPageStatus: PageStatus;
  previousGenerationMode: PageGenerationMode | null;
}

export interface PersistedPageGenerationJobParams {
  page_id: string;
  request_kind: PageGenerationRequestKind;
  generation_mode: PageGenerationMode;
  quality: PageGenerationQuality;
  requires_planner: boolean;
  previous_page_status: PageStatus;
  previous_generation_mode: PageGenerationMode | null;
}

export interface PageGenerationInputSnapshotDialogue {
  entityId: string | null;
  speakerName: string | null;
  type: PanelDialogueType;
  position: PanelDialoguePosition;
  text: string;
}

export interface PageGenerationInputSnapshotPanel {
  panelId: string;
  order: number;
  entityIds: string[];
  entityNames: string[];
  dialogue: PageGenerationInputSnapshotDialogue[];
}

export interface PageGenerationInputSnapshotImage {
  role: PageGenerationInputImageRole;
  label: string;
}

export interface PageGenerationInputSnapshot {
  pageId: string;
  requestKind: PageGenerationRequestKind;
  generationMode: PageGenerationMode;
  panelCount: number;
  panels: PageGenerationInputSnapshotPanel[];
  inputImages?: PageGenerationInputSnapshotImage[];
}
