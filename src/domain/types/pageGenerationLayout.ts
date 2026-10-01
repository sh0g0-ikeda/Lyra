import type { PanelFrameBorderStyle, PanelFrameTemplateId, PanelFrameVertex } from './panelFrame.js';

export interface PageLayoutControlFrame {
  readingOrder: number;
  vertices: PanelFrameVertex[];
  borderStyle: PanelFrameBorderStyle;
  borderWidth: number;
  borderColor: string;
  physicalPlacement: string;
}

export interface PageGenerationLayoutControl {
  version: 'page_layout_v1';
  source: 'template' | 'custom' | 'ai_generated' | 'ai_auto';
  templateId: PanelFrameTemplateId | null;
  frames: PageLayoutControlFrame[];
  detailedInstruction: string;
  finalSuffix: string;
}
