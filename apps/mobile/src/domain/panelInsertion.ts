import type { CreatePanelPayload } from '@/domain/payloads';
import type { PanelFrameRecord, PanelRecord } from '@/domain/types';

export type PanelInsertionErrorCode =
  | 'SELECTED_PANEL_NOT_FOUND'
  | 'CREATED_PANEL_DUPLICATE'
  | 'SELECTED_FRAME_NOT_FOUND'
  | 'PANEL_LIMIT_REACHED'
  | 'INVALID_FRAME_SET'
  | 'RECOVERY_NOT_AVAILABLE';

export class PanelInsertionError extends Error {
  public readonly code: PanelInsertionErrorCode;

  public constructor(code: PanelInsertionErrorCode, message: string) {
    super(message);
    this.name = 'PanelInsertionError';
    this.code = code;
  }
}

export interface PanelInsertionPlan {
  appendOrder: number;
  reorderedPanelIds: string[];
}

export interface PanelInsertionRecoveryPlan {
  createdPanelId: string;
  selectedPanelId: string;
  createdFrameId: string;
}

export interface PreparedPanelInsertion {
  appendOrder: number;
  createdFrameId: string;
}

export const MAX_PANEL_FRAMES = 20;
const MIN_FRAME_AREA = 0.0001;

export type PanelInsertionPhase = 'save' | 'create' | 'reorder' | 'frames';

export class PanelInsertionOperationError extends Error {
  public readonly phase: PanelInsertionPhase;
  public readonly cause: unknown;
  public readonly recovery: PanelInsertionRecoveryPlan | null;

  public constructor(
    phase: PanelInsertionPhase,
    cause: unknown,
    recovery: PanelInsertionRecoveryPlan | null = null
  ) {
    super(`Panel insertion failed during ${phase}.`);
    this.name = 'PanelInsertionOperationError';
    this.phase = phase;
    this.cause = cause;
    this.recovery = recovery;
  }
}

export const getPanelAppendOrder = (
  panels: readonly PanelRecord[],
  selectedPanelId: string
): number => {
  if (!panels.some((panel) => panel.id === selectedPanelId)) {
    throw new PanelInsertionError(
      'SELECTED_PANEL_NOT_FOUND',
      'The selected panel is no longer present on this page.'
    );
  }
  if (panels.length >= MAX_PANEL_FRAMES) {
    throw new PanelInsertionError('PANEL_LIMIT_REACHED', 'This page already has the maximum number of panels.');
  }
  return panels.length + 1;
};

export const buildEmptyPanelPayload = (order: number): CreatePanelPayload => ({
  order,
  panel_role: 'action',
  panel_size: 'standard',
  situation_text: null,
  composition: {
    source: 'ai_auto',
    gallery_item_id: null,
    composition_prompt: null,
    shot_type: null,
    angle: null,
    custom_note: null
  },
  dialogue_in_panel: true,
  dialogue: [],
  sfx_text: null,
  background_note: null,
  panel_notes: null
});

export const buildPanelInsertionPlan = (
  panels: readonly PanelRecord[],
  selectedPanelId: string,
  createdPanelId: string
): PanelInsertionPlan => {
  const sortedPanels = [...panels].sort((left, right) => left.order - right.order);
  const selectedIndex = sortedPanels.findIndex((panel) => panel.id === selectedPanelId);
  if (selectedIndex < 0) {
    throw new PanelInsertionError(
      'SELECTED_PANEL_NOT_FOUND',
      'The selected panel is no longer present on this page.'
    );
  }
  if (sortedPanels.some((panel) => panel.id === createdPanelId)) {
    throw new PanelInsertionError(
      'CREATED_PANEL_DUPLICATE',
      'The created panel ID already exists on this page.'
    );
  }

  const reorderedPanelIds = sortedPanels.map((panel) => panel.id);
  reorderedPanelIds.splice(selectedIndex + 1, 0, createdPanelId);
  return {
    appendOrder: getPanelAppendOrder(sortedPanels, selectedPanelId),
    reorderedPanelIds
  };
};

const midpoint = (left: number, right: number): number => (left + right) / 2;

const polygonArea = (vertices: readonly { x: number; y: number }[]): number =>
  Math.abs(vertices.reduce((sum, vertex, index) => {
    const next = vertices[(index + 1) % vertices.length];
    return next === undefined ? sum : sum + vertex.x * next.y - next.x * vertex.y;
  }, 0)) / 2;

const isValidFrame = (frame: PanelFrameRecord): boolean =>
  frame.vertices.length === 4 && polygonArea(frame.vertices) >= MIN_FRAME_AREA &&
  frame.vertices.every(
    (vertex) => Number.isFinite(vertex.x) && vertex.x >= 0 && vertex.x <= 1 &&
      Number.isFinite(vertex.y) && vertex.y >= 0 && vertex.y <= 1
  ) &&
  Number.isInteger(frame.border_width) && frame.border_width >= 0 && frame.border_width <= 20 &&
  /^#[0-9A-Fa-f]{6}$/u.test(frame.border_color) &&
  Number.isInteger(frame.z_index) && frame.z_index >= 0 && frame.z_index <= 1000 &&
  Number.isInteger(frame.reading_order) && frame.reading_order >= 1 && frame.reading_order <= 1000;

export const validatePanelFrameMapping = (
  panels: readonly PanelRecord[],
  frames: readonly PanelFrameRecord[]
): void => {
  const panelIds = new Set(panels.map((panel) => panel.id));
  const mappedPanelIds = frames.map((frame) => frame.panel_id);
  const frameIds = frames.map((frame) => frame.id);
  const readingOrders = frames.map((frame) => frame.reading_order);
  if (
    frames.length !== panels.length ||
    frames.some((frame) => !isValidFrame(frame) || frame.panel_id === null || !panelIds.has(frame.panel_id)) ||
    new Set(mappedPanelIds).size !== mappedPanelIds.length ||
    new Set(frameIds).size !== frameIds.length ||
    new Set(readingOrders).size !== readingOrders.length
  ) {
    throw new PanelInsertionError('INVALID_FRAME_SET', 'Every panel must have one valid, unique frame before insertion.');
  }
};

export const preparePanelInsertion = (
  panels: readonly PanelRecord[],
  frames: readonly PanelFrameRecord[],
  selectedPanelId: string,
  createdFrameId: string
): PreparedPanelInsertion => {
  const appendOrder = getPanelAppendOrder(panels, selectedPanelId);
  validatePanelFrameMapping(panels, frames);
  // Compute once before POST so geometry/schema failures cannot leave an orphan panel.
  buildFramesForInsertedPanel(frames, selectedPanelId, '__preflight_panel__', createdFrameId);
  return { appendOrder, createdFrameId };
};

export const buildFramesForInsertedPanel = (
  frames: readonly PanelFrameRecord[],
  selectedPanelId: string,
  createdPanelId: string,
  createdFrameId: string
): PanelFrameRecord[] => {
  const sortedFrames = [...frames].sort(
    (left, right) => left.reading_order - right.reading_order
  );
  const selectedIndex = sortedFrames.findIndex(
    (frame) => frame.panel_id === selectedPanelId
  );
  const selectedFrame = sortedFrames[selectedIndex];
  if (selectedFrame === undefined || selectedFrame.vertices.length !== 4) {
    throw new PanelInsertionError(
      'SELECTED_FRAME_NOT_FOUND',
      'The selected panel does not have an editable frame.'
    );
  }

  const [topLeft, topRight, bottomRight, bottomLeft] = selectedFrame.vertices;
  if (
    topLeft === undefined ||
    topRight === undefined ||
    bottomRight === undefined ||
    bottomLeft === undefined
  ) {
    throw new PanelInsertionError(
      'SELECTED_FRAME_NOT_FOUND',
      'The selected panel does not have an editable frame.'
    );
  }

  const width = Math.max(...selectedFrame.vertices.map((vertex) => vertex.x)) -
    Math.min(...selectedFrame.vertices.map((vertex) => vertex.x));
  const height = Math.max(...selectedFrame.vertices.map((vertex) => vertex.y)) -
    Math.min(...selectedFrame.vertices.map((vertex) => vertex.y));
  // Reading order is right-to-left, then top-to-bottom. The original panel stays
  // first in reading order, so a horizontal split keeps it on the right.
  const firstVertices = width >= height
    ? [
        { x: midpoint(topLeft.x, topRight.x), y: midpoint(topLeft.y, topRight.y) },
        topRight,
        bottomRight,
        { x: midpoint(bottomLeft.x, bottomRight.x), y: midpoint(bottomLeft.y, bottomRight.y) }
      ]
    : [
        topLeft,
        topRight,
        { x: midpoint(topRight.x, bottomRight.x), y: midpoint(topRight.y, bottomRight.y) },
        { x: midpoint(topLeft.x, bottomLeft.x), y: midpoint(topLeft.y, bottomLeft.y) }
      ];
  const secondVertices = width >= height
    ? [
        topLeft,
        firstVertices[0]!,
        firstVertices[3]!,
        bottomLeft
      ]
    : [
        firstVertices[3]!,
        firstVertices[2]!,
        bottomRight,
        bottomLeft
      ];

  const nextFrames = sortedFrames.map((frame, index) => ({
    ...frame,
    reading_order: index > selectedIndex ? index + 2 : index + 1,
    ...(frame.id === selectedFrame.id ? { vertices: firstVertices } : {})
  }));
  nextFrames.splice(selectedIndex + 1, 0, {
    ...selectedFrame,
    id: createdFrameId,
    panel_id: createdPanelId,
    vertices: secondVertices,
    reading_order: selectedIndex + 2,
    z_index: selectedFrame.z_index
  });
  if (
    nextFrames.length > MAX_PANEL_FRAMES ||
    nextFrames.some((frame) => !isValidFrame(frame)) ||
    new Set(nextFrames.map((frame) => frame.id)).size !== nextFrames.length ||
    new Set(nextFrames.map((frame) => frame.reading_order)).size !== nextFrames.length
  ) {
    throw new PanelInsertionError('INVALID_FRAME_SET', 'The split layout does not satisfy the frame API contract.');
  }
  return nextFrames;
};

interface ExecutePanelInsertionInput {
  panels: readonly PanelRecord[];
  frames: readonly PanelFrameRecord[];
  selectedPanelId: string;
  createFrameId: () => string;
  saveDrafts: () => Promise<void>;
  createPanel: (payload: CreatePanelPayload) => Promise<PanelRecord>;
  reorderPanels: (panelIds: string[]) => Promise<void>;
  replaceFrames: (frames: PanelFrameRecord[]) => Promise<void>;
}

interface RecoverPanelInsertionInput {
  panels: readonly PanelRecord[];
  frames: readonly PanelFrameRecord[];
  recovery: PanelInsertionRecoveryPlan;
  reorderPanels: (panelIds: string[]) => Promise<void>;
  replaceFrames: (frames: PanelFrameRecord[]) => Promise<void>;
}

export const inferPanelInsertionRecovery = (
  panels: readonly PanelRecord[],
  frames: readonly PanelFrameRecord[],
  createdFrameId: string
): PanelInsertionRecoveryPlan | null => {
  if (panels.length !== frames.length + 1 || panels.length > MAX_PANEL_FRAMES) return null;
  const framePanelIds = new Set(frames.map((frame) => frame.panel_id));
  const missingPanels = [...panels]
    .sort((left, right) => left.order - right.order)
    .filter((panel) => !framePanelIds.has(panel.id));
  if (missingPanels.length !== 1) return null;
  const orderedPanels = [...panels].sort((left, right) => left.order - right.order);
  const missingIndex = orderedPanels.findIndex((panel) => panel.id === missingPanels[0]?.id);
  const preceding = orderedPanels[missingIndex - 1];
  if (preceding === undefined) return null;
  try {
    validatePanelFrameMapping(orderedPanels.filter((panel) => panel.id !== missingPanels[0]?.id), frames);
    buildFramesForInsertedPanel(frames, preceding.id, missingPanels[0]!.id, createdFrameId);
  } catch {
    return null;
  }
  return { createdPanelId: missingPanels[0]!.id, selectedPanelId: preceding.id, createdFrameId };
};

export const recoverPanelInsertion = async (input: RecoverPanelInsertionInput): Promise<PanelRecord> => {
  const created = input.panels.find((panel) => panel.id === input.recovery.createdPanelId);
  if (created === undefined || input.frames.some((frame) => frame.panel_id === created.id)) {
    throw new PanelInsertionError('RECOVERY_NOT_AVAILABLE', 'The unfinished insertion can no longer be repaired safely.');
  }
  validatePanelFrameMapping(input.panels.filter((panel) => panel.id !== created.id), input.frames);
  const plan = buildPanelInsertionPlan(
    input.panels.filter((panel) => panel.id !== created.id),
    input.recovery.selectedPanelId,
    created.id
  );
  const nextFrames = buildFramesForInsertedPanel(
    input.frames,
    input.recovery.selectedPanelId,
    created.id,
    input.recovery.createdFrameId
  );
  try {
    await input.reorderPanels(plan.reorderedPanelIds);
  } catch (error) {
    throw new PanelInsertionOperationError('reorder', error, input.recovery);
  }
  try {
    await input.replaceFrames(nextFrames);
  } catch (error) {
    throw new PanelInsertionOperationError('frames', error, input.recovery);
  }
  return created;
};

export const executePanelInsertion = async (
  input: ExecutePanelInsertionInput
): Promise<PanelRecord> => {
  const prepared = preparePanelInsertion(
    input.panels,
    input.frames,
    input.selectedPanelId,
    input.createFrameId()
  );

  try {
    await input.saveDrafts();
  } catch (error) {
    throw new PanelInsertionOperationError('save', error);
  }

  let created: PanelRecord;
  try {
    created = await input.createPanel(buildEmptyPanelPayload(prepared.appendOrder));
  } catch (error) {
    throw new PanelInsertionOperationError('create', error);
  }

  const plan = buildPanelInsertionPlan(
    input.panels,
    input.selectedPanelId,
    created.id
  );
  const recovery: PanelInsertionRecoveryPlan = {
    createdPanelId: created.id,
    selectedPanelId: input.selectedPanelId,
    createdFrameId: prepared.createdFrameId
  };
  try {
    await input.reorderPanels(plan.reorderedPanelIds);
  } catch (error) {
    throw new PanelInsertionOperationError('reorder', error, recovery);
  }

  const nextFrames = buildFramesForInsertedPanel(
    input.frames,
    input.selectedPanelId,
    created.id,
    prepared.createdFrameId
  );
  try {
    await input.replaceFrames(nextFrames);
  } catch (error) {
    throw new PanelInsertionOperationError('frames', error, recovery);
  }
  return created;
};
