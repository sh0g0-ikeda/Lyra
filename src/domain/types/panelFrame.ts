export type PanelFrameBorderStyle = 'solid' | 'dashed' | 'none';

export type PanelFrameTemplateId =
  | 'standard_4'
  | 'top_wide_3'
  | 'standard_6'
  | 'dense_8'
  | 'climax_2'
  | 'splash_1'
  | 'action_5'
  | 'battle_7';

export interface PanelFrameVertex {
  x: number;
  y: number;
}

export interface PanelFrame {
  id: string;
  pageId: string;
  panelId: string | null;
  vertices: PanelFrameVertex[];
  borderStyle: PanelFrameBorderStyle;
  borderWidth: number;
  borderColor: string;
  zIndex: number;
  readingOrder: number;
}

export interface UpsertPanelFrameInput {
  id?: string;
  panelId: string | null;
  vertices: PanelFrameVertex[];
  borderStyle: PanelFrameBorderStyle;
  borderWidth: number;
  borderColor: string;
  zIndex: number;
  readingOrder: number;
}

export interface PageLayoutTemplateUpdate {
  type: 'template';
  templateId: PanelFrameTemplateId;
  panelCount: number;
  frameDefinitions: UpsertPanelFrameInput[];
}

export interface PageLayoutCustomUpdate {
  type: 'custom';
  panelCount: number;
  frameDefinitions: UpsertPanelFrameInput[];
}

export type PageLayoutFrameUpdate = PageLayoutTemplateUpdate | PageLayoutCustomUpdate;

export interface PanelFrameTemplateApplication {
  templateId: PanelFrameTemplateId;
  panelCount: number;
  frames: PanelFrame[];
}
