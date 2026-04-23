export type PanelFrameBorderStyle = 'solid' | 'dashed' | 'none';

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
