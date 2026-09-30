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
  imageModel?: string;
  providerModelId?: string;
  pricingVersion?: string | null;
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
  image_model?: string;
  provider_model_id?: string;
  pricing_version?: string;
  estimated_credit_cost?: number;
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
  /** Null is the entity's default reference; retained as optional for old snapshots. */
  stateId?: string | null;
  stateName?: string | null;
  canonicalName: string;
  refId: string;
  s3Key: string;
  subjectLabel: string;
  imageModel?: string | null;
  modelInputOrder: number;
}

export interface PageGenerationInputSnapshot {
  pageId: string;
  requestKind: PageGenerationRequestKind;
  generationMode: PageGenerationMode;
  panelCount: number;
  panels: PageGenerationInputSnapshotPanel[];
  references?: PageGenerationInputSnapshotReference[];
  inputImages?: PageGenerationInputSnapshotImage[];
}
