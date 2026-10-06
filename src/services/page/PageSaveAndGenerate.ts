import type { Panel, PanelComposition, PanelDialogueLine } from '../../domain/types/panel.js';
import type { PanelEntityAssignment } from '../../domain/types/panelEntityAssignment.js';
import type { UpsertPanelFrameInput } from '../../domain/types/panelFrame.js';
import type { UpdatePageSettingsInput } from '../../domain/types/page.js';
import type { PageRenderStyle } from '../../domain/types/pageGeneration.js';

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
  renderStyle: PageRenderStyle;
}

export interface SaveAndGeneratePageResult {
  jobId: string;
  pageRevision: string;
}
