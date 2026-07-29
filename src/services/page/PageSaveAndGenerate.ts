import type { GenerationCapacityLimits } from '../generation/GenerationCapacityGuard.js';
import type { Panel, PanelComposition, PanelDialogueLine } from '../../domain/types/panel.js';
import type { PanelEntityAssignment } from '../../domain/types/panelEntityAssignment.js';
import type { UpsertPanelFrameInput } from '../../domain/types/panelFrame.js';
import type { UpdatePageSettingsInput } from '../../domain/types/page.js';
import type { PageGenerationInputSnapshot, PageGenerationSelection } from '../../domain/types/pageGeneration.js';

export interface SaveAndGeneratePanelInput {
  id: string;
  order: number;
  panelRole: Panel['panelRole'];
  panelSize: Panel['panelSize'];
  situationText: string | null;
  composition: PanelComposition;
  dialogueInPanel: boolean;
  dialogue: PanelDialogueLine[];
  sfxText: string | null;
  backgroundNote: string | null;
  panelNotes: string | null;
  entities: PanelEntityAssignment[];
}

export interface SaveAndGeneratePageInput {
  expectedUpdatedAt: string;
  page: UpdatePageSettingsInput;
  panels: SaveAndGeneratePanelInput[];
  frames: UpsertPanelFrameInput[];
  language: 'ja' | 'en';
  requestId: string;
}

export interface AtomicSaveAndGenerateInput extends SaveAndGeneratePageInput {
  pageId: string;
  userId: string;
  organizationId: string | null;
  layoutConfig: Record<string, unknown>;
  selection: PageGenerationSelection;
  inputSnapshot: PageGenerationInputSnapshot;
  capacityLimits: GenerationCapacityLimits;
}

export interface AtomicSaveAndGenerateResult {
  jobId: string;
  pageRevision: string;
  created: boolean;
}

export interface PageAtomicGenerationRepository {
  saveAndCreateGenerationJob(input: AtomicSaveAndGenerateInput): Promise<AtomicSaveAndGenerateResult>;
}

export function isPageAtomicGenerationRepository(value: object): value is PageAtomicGenerationRepository {
  return 'saveAndCreateGenerationJob' in value && typeof value.saveAndCreateGenerationJob === 'function';
}
