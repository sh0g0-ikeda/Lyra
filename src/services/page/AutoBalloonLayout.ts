import { ValidationError } from '../../domain/errors/index.js';
import type { CreateBalloonInput } from '../../domain/types/balloon.js';
import type { Panel } from '../../domain/types/panel.js';
import type { PanelFrame } from '../../domain/types/panelFrame.js';
import type { PageDialogueMode } from '../../domain/types/page.js';

export function buildAutoBalloonInputs(
  dialogueMode: PageDialogueMode,
  panels: Panel[],
  frames: PanelFrame[],
): CreateBalloonInput[] {
  const frameByPanelId = new Map<string, PanelFrame>();
  const frameByReadingOrder = new Map<number, PanelFrame>();

  for (const frame of frames) {
    if (frame.panelId !== null) {
      frameByPanelId.set(frame.panelId, frame);
    }
    frameByReadingOrder.set(frame.readingOrder, frame);
  }

  const eligiblePanels = panels
    .filter((panel) => shouldAutoGenerateForPanel(dialogueMode, panel))
    .filter((panel) => panel.dialogue.length > 0);

  if (eligiblePanels.length === 0) {
    throw new ValidationError('No eligible panel dialogue lines for auto balloon placement');
  }

  const counters = new Map<string, number>();
  const balloons: CreateBalloonInput[] = [];

  for (const panel of eligiblePanels) {
    const frame = frameByPanelId.get(panel.id) ?? frameByReadingOrder.get(panel.order);
    if (frame === undefined) {
      throw new ValidationError('Each panel with auto balloons must have a frame');
    }

    const bounds = toBounds(frame);
    for (const line of panel.dialogue) {
      const key = `${panel.id}:${line.position}`;
      const index = counters.get(key) ?? 0;
      counters.set(key, index + 1);
      balloons.push(
        buildAutoBalloonInput({
          panelOrder: panel.order,
          bounds,
          index,
          line,
        }),
      );
    }
  }

  return balloons;
}

function shouldAutoGenerateForPanel(dialogueMode: PageDialogueMode, panel: Panel): boolean {
  if (dialogueMode === 'balloon_only') {
    return true;
  }

  return !panel.dialogueInPanel;
}

function buildAutoBalloonInput(params: {
  panelOrder: number;
  bounds: Bounds;
  index: number;
  line: Panel['dialogue'][number];
}): CreateBalloonInput {
  const writingMode = params.line.type === 'sfx' ? 'horizontal' : 'vertical';
  const size = getBalloonSize(params.line.type, writingMode, params.bounds);
  const position = placeBalloon(params.bounds, params.line.position, size, params.index);

  return {
    speakerEntityId: params.line.entityId,
    balloonType: params.line.type,
    writingMode,
    text: params.line.text,
    position,
    tail: buildTail(params.line.type, params.line.entityId, params.line.position, position, params.bounds),
    fontSize: getFontSize(params.line.type),
    fontFamily: getFontFamily(params.line.type),
    panelOrderReference: params.panelOrder,
    zIndex: 10 + params.panelOrder * 10 + params.index,
  };
}

interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
}

function toBounds(frame: PanelFrame): Bounds {
  if (frame.vertices.length === 0) {
    throw new ValidationError('Panel frame vertices are required for auto balloon placement');
  }

  const xs = frame.vertices.map((vertex) => vertex.x);
  const ys = frame.vertices.map((vertex) => vertex.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  const width = maxX - minX;
  const height = maxY - minY;

  if (width <= 0 || height <= 0) {
    throw new ValidationError('Panel frame bounds must be positive for auto balloon placement');
  }

  return {
    minX,
    minY,
    maxX,
    maxY,
    width,
    height,
    centerX: minX + width / 2,
    centerY: minY + height / 2,
  };
}

function getBalloonSize(
  type: Panel['dialogue'][number]['type'],
  writingMode: CreateBalloonInput['writingMode'],
  bounds: Bounds,
): CreateBalloonInput['position'] {
  const isHorizontal = writingMode === 'horizontal';
  const widthFactor = isHorizontal ? 0.42 : 0.26;
  const heightFactor = isHorizontal ? 0.18 : 0.34;
  const effectiveMaxWidth = bounds.width * 0.88;
  const effectiveMaxHeight = bounds.height * 0.88;
  const widthUpperBound = Math.min(effectiveMaxWidth, bounds.width * 0.6);
  const heightUpperBound = Math.min(effectiveMaxHeight, bounds.height * 0.6);

  const width = clamp(bounds.width * widthFactor, 0.001, widthUpperBound);
  const height = clamp(bounds.height * heightFactor, 0.001, heightUpperBound);

  if (type === 'shout') {
    return {
      x: 0,
      y: 0,
      width: clamp(width * 1.1, 0.001, Math.min(effectiveMaxWidth, bounds.width * 0.7)),
      height,
    };
  }

  if (type === 'whisper') {
    return {
      x: 0,
      y: 0,
      width,
      height: clamp(height * 0.9, 0.001, Math.min(effectiveMaxHeight, bounds.height * 0.5)),
    };
  }

  return { x: 0, y: 0, width, height };
}

function placeBalloon(
  bounds: Bounds,
  desiredPosition: Panel['dialogue'][number]['position'],
  size: CreateBalloonInput['position'],
  index: number,
): CreateBalloonInput['position'] {
  const paddingX = Math.max(bounds.width * 0.04, 0.012);
  const paddingY = Math.max(bounds.height * 0.05, 0.012);
  const gapX = Math.max(bounds.width * 0.03, 0.01);
  const gapY = Math.max(bounds.height * 0.04, 0.01);

  let x = bounds.centerX - size.width / 2;
  let y = bounds.centerY - size.height / 2;

  if (desiredPosition === 'top') {
    x = bounds.minX + paddingX + (index % 2) * (size.width + gapX);
    y = bounds.minY + paddingY + Math.floor(index / 2) * (size.height + gapY);
  } else if (desiredPosition === 'bottom') {
    x = bounds.minX + paddingX + (index % 2) * (size.width + gapX);
    y = bounds.maxY - paddingY - size.height - Math.floor(index / 2) * (size.height + gapY);
  } else if (desiredPosition === 'left') {
    x = bounds.minX + paddingX;
    y = bounds.minY + paddingY + index * (size.height + gapY);
  } else if (desiredPosition === 'right') {
    x = bounds.maxX - paddingX - size.width;
    y = bounds.minY + paddingY + index * (size.height + gapY);
  } else {
    x = bounds.centerX - size.width / 2 + (index % 2) * gapX - gapX / 2;
    y = bounds.centerY - size.height / 2 + Math.floor(index / 2) * (size.height * 0.65);
  }

  return {
    x: clamp(x, bounds.minX + paddingX, bounds.maxX - paddingX - size.width),
    y: clamp(y, bounds.minY + paddingY, bounds.maxY - paddingY - size.height),
    width: size.width,
    height: size.height,
  };
}

function buildTail(
  type: Panel['dialogue'][number]['type'],
  entityId: string | null,
  desiredPosition: Panel['dialogue'][number]['position'],
  position: CreateBalloonInput['position'],
  bounds: Bounds,
): CreateBalloonInput['tail'] {
  if ((type === 'narration' || type === 'sfx') || entityId === null) {
    return null;
  }

  if (desiredPosition === 'center') {
    return null;
  }

  if (desiredPosition === 'top') {
    return {
      baseX: position.x + position.width / 2,
      baseY: position.y + position.height,
      tipX: bounds.centerX,
      tipY: clamp(bounds.centerY, position.y + position.height, bounds.maxY),
    };
  }

  if (desiredPosition === 'bottom') {
    return {
      baseX: position.x + position.width / 2,
      baseY: position.y,
      tipX: bounds.centerX,
      tipY: clamp(bounds.centerY, bounds.minY, position.y),
    };
  }

  if (desiredPosition === 'left') {
    return {
      baseX: position.x + position.width,
      baseY: position.y + position.height / 2,
      tipX: bounds.centerX,
      tipY: bounds.centerY,
    };
  }

  return {
    baseX: position.x,
    baseY: position.y + position.height / 2,
    tipX: bounds.centerX,
    tipY: bounds.centerY,
  };
}

function getFontSize(type: Panel['dialogue'][number]['type']): number {
  if (type === 'shout') {
    return 22;
  }

  if (type === 'whisper' || type === 'narration') {
    return 16;
  }

  if (type === 'sfx') {
    return 20;
  }

  return 18;
}

function getFontFamily(type: Panel['dialogue'][number]['type']): CreateBalloonInput['fontFamily'] {
  if (type === 'narration') {
    return 'mincho';
  }

  if (type === 'sfx' || type === 'shout') {
    return 'bold';
  }

  return 'manga_gothic';
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) {
    return min;
  }

  if (value > max) {
    return max;
  }

  return value;
}
