import type { PageStatus } from './page.js';
import type { PanelDialoguePosition, PanelDialogueType } from './panel.js';

export type PageGenerationMode = 'standard' | 'thinking';
export type PageGenerationRequestKind = 'initial' | 'regenerate';
export type PageGenerationQuality = 'medium' | 'high';
export type PageRenderStyle = 'color' | 'monochrome';
export type PageGenerationInputImageRole = 'entity_reference' | 'layout_reference';

export interface PageGenerationInputImage {
  role: PageGenerationInputImageRole;
  label: string;
  dataUrl: string;
  reference?: Omit<PageGenerationInputSnapshotReference, 'modelInputOrder'>;
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
  work_id?: string | null;
  request_kind: PageGenerationRequestKind;
  generation_mode: PageGenerationMode;
  quality: PageGenerationQuality;
  requires_planner: boolean;
  previous_page_status: PageStatus;
  previous_generation_mode: PageGenerationMode | null;
  render_style?: PageRenderStyle;
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

export interface PageGenerationInputSnapshotReference {
  entityId: string;
  stateId: string | null;
  refId: string;
  s3Key: string;
  imageModel: string | null;
  providerModelId?: string | null;
  provider?: string | null;
  subjectLabel: string;
  modelInputOrder: number;
}

export interface PageGenerationInputSnapshot {
  pageId: string;
  requestKind: PageGenerationRequestKind;
  generationMode: PageGenerationMode;
  renderStyle?: PageRenderStyle;
  panelCount: number;
  panels: PageGenerationInputSnapshotPanel[];
  inputImages?: PageGenerationInputSnapshotImage[];
  references?: PageGenerationInputSnapshotReference[];
}
