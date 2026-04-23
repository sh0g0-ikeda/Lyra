import type {
  PanelFrameTemplateId,
  PanelFrameVertex,
  UpsertPanelFrameInput,
} from '../types/panelFrame.js';

export const PANEL_FRAME_TEMPLATE_IDS = [
  'standard_4',
  'top_wide_3',
  'standard_6',
  'dense_8',
  'climax_2',
  'splash_1',
  'action_5',
  'battle_7',
] as const satisfies readonly PanelFrameTemplateId[];

export interface PanelFrameTemplate {
  id: PanelFrameTemplateId;
  panelCount: number;
  frames: UpsertPanelFrameInput[];
}

const defaultFrameStyle = {
  panelId: null,
  borderStyle: 'solid',
  borderWidth: 3,
  borderColor: '#000000',
  zIndex: 1,
} as const;

export const PANEL_FRAME_TEMPLATES: Record<PanelFrameTemplateId, PanelFrameTemplate> = {
  standard_4: {
    id: 'standard_4',
    panelCount: 4,
    frames: [
      frame(1, rect(0, 0, 0.5, 0.5)),
      frame(2, rect(0.5, 0, 1, 0.5)),
      frame(3, rect(0, 0.5, 0.5, 1)),
      frame(4, rect(0.5, 0.5, 1, 1)),
    ],
  },
  top_wide_3: {
    id: 'top_wide_3',
    panelCount: 3,
    frames: [
      frame(1, rect(0, 0, 1, 0.5)),
      frame(2, rect(0, 0.5, 0.5, 1)),
      frame(3, rect(0.5, 0.5, 1, 1)),
    ],
  },
  standard_6: {
    id: 'standard_6',
    panelCount: 6,
    frames: [
      frame(1, rect(0, 0, 1 / 3, 0.5)),
      frame(2, rect(1 / 3, 0, 2 / 3, 0.5)),
      frame(3, rect(2 / 3, 0, 1, 0.5)),
      frame(4, rect(0, 0.5, 1 / 3, 1)),
      frame(5, rect(1 / 3, 0.5, 2 / 3, 1)),
      frame(6, rect(2 / 3, 0.5, 1, 1)),
    ],
  },
  dense_8: {
    id: 'dense_8',
    panelCount: 8,
    frames: [
      frame(1, rect(0, 0, 0.25, 0.5)),
      frame(2, rect(0.25, 0, 0.5, 0.5)),
      frame(3, rect(0.5, 0, 0.75, 0.5)),
      frame(4, rect(0.75, 0, 1, 0.5)),
      frame(5, rect(0, 0.5, 0.25, 1)),
      frame(6, rect(0.25, 0.5, 0.5, 1)),
      frame(7, rect(0.5, 0.5, 0.75, 1)),
      frame(8, rect(0.75, 0.5, 1, 1)),
    ],
  },
  climax_2: {
    id: 'climax_2',
    panelCount: 2,
    frames: [
      frame(1, rect(0, 0, 0.5, 1)),
      frame(2, rect(0.5, 0, 1, 1)),
    ],
  },
  splash_1: {
    id: 'splash_1',
    panelCount: 1,
    frames: [frame(1, rect(0, 0, 1, 1))],
  },
  action_5: {
    id: 'action_5',
    panelCount: 5,
    frames: [
      frame(1, rect(0, 0, 0.35, 1)),
      frame(2, rect(0.35, 0, 1, 0.32)),
      frame(3, rect(0.35, 0.32, 0.675, 0.66)),
      frame(4, rect(0.675, 0.32, 1, 0.66)),
      frame(5, rect(0.35, 0.66, 1, 1)),
    ],
  },
  battle_7: {
    id: 'battle_7',
    panelCount: 7,
    frames: [
      frame(1, quad({ x: 0, y: 0 }, { x: 0.35, y: 0 }, { x: 0.28, y: 0.32 }, { x: 0, y: 0.28 })),
      frame(
        2,
        quad({ x: 0.35, y: 0 }, { x: 0.7, y: 0 }, { x: 0.63, y: 0.32 }, { x: 0.28, y: 0.32 }),
      ),
      frame(3, quad({ x: 0.7, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 0.28 }, { x: 0.63, y: 0.32 })),
      frame(
        4,
        quad({ x: 0, y: 0.28 }, { x: 0.63, y: 0.32 }, { x: 0.56, y: 0.68 }, { x: 0, y: 0.66 }),
      ),
      frame(
        5,
        quad({ x: 0.63, y: 0.32 }, { x: 1, y: 0.28 }, { x: 1, y: 0.66 }, { x: 0.56, y: 0.68 }),
      ),
      frame(6, quad({ x: 0, y: 0.66 }, { x: 0.5, y: 0.68 }, { x: 0.5, y: 1 }, { x: 0, y: 1 })),
      frame(7, quad({ x: 0.5, y: 0.68 }, { x: 1, y: 0.66 }, { x: 1, y: 1 }, { x: 0.5, y: 1 })),
    ],
  },
};

export function getPanelFrameTemplate(templateId: PanelFrameTemplateId): PanelFrameTemplate {
  return PANEL_FRAME_TEMPLATES[templateId];
}

export function buildPanelFrameTemplateInputs(templateId: PanelFrameTemplateId): UpsertPanelFrameInput[] {
  return getPanelFrameTemplate(templateId).frames.map((templateFrame) => ({
    ...templateFrame,
    vertices: templateFrame.vertices.map((vertex) => ({ ...vertex })),
  }));
}

function frame(readingOrder: number, vertices: PanelFrameVertex[]): UpsertPanelFrameInput {
  return {
    ...defaultFrameStyle,
    vertices,
    readingOrder,
  };
}

function rect(x1: number, y1: number, x2: number, y2: number): PanelFrameVertex[] {
  return [
    { x: x1, y: y1 },
    { x: x2, y: y1 },
    { x: x2, y: y2 },
    { x: x1, y: y2 },
  ];
}

function quad(
  topLeft: PanelFrameVertex,
  topRight: PanelFrameVertex,
  bottomRight: PanelFrameVertex,
  bottomLeft: PanelFrameVertex,
): PanelFrameVertex[] {
  return [topLeft, topRight, bottomRight, bottomLeft];
}
