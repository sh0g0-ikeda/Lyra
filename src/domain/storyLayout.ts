import type { PanelFrameVertex, UpsertPanelFrameInput } from './types/panelFrame.js';

/**
 * Design: story planning supplies a fixed narrative order, so this pure builder only
 * partitions contiguous order ranges.  It exhaustively evaluates the finite set of
 * guillotine cuts for at most eight panels: horizontal cuts retain top-before-bottom
 * order and vertical cuts retain right-before-left order.  Each cut receives the
 * sum-of-size-weights share, which makes area predictable; the lowest shape-loss
 * candidate wins deterministically.  This deliberately favors an achievable best
 * layout over rejecting aesthetically conflicting but structurally valid hints.
 */
export interface StoryPanelLayoutHint {
  order: number;
  size: 'standard' | 'large' | 'small' | 'largest';
  shape: 'auto' | 'wide' | 'tall';
}

interface Rectangle {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

interface LayoutCandidate {
  frames: readonly LayoutFrame[];
  score: number;
}

interface LayoutFrame {
  hint: StoryPanelLayoutHint;
  rectangle: Rectangle;
}

const MAX_PANEL_COUNT = 8;
const PAGE_PHYSICAL_WIDTH = 0.7;
const SIZE_WEIGHTS: Readonly<Record<StoryPanelLayoutHint['size'], number>> = {
  standard: 1,
  large: 2.2,
  small: 0.6,
  largest: 3.2,
};
const SHAPE_TARGETS: Readonly<Record<StoryPanelLayoutHint['shape'], number>> = {
  auto: 0.9,
  wide: 1.8,
  tall: 0.55,
};
const SHAPE_IMPORTANCE: Readonly<Record<StoryPanelLayoutHint['shape'], number>> = {
  auto: 0.35,
  wide: 5,
  tall: 5,
};

export function buildStoryLayoutFrames(hints: readonly StoryPanelLayoutHint[]): UpsertPanelFrameInput[] {
  validateHints(hints);
  const orderedHints = [...hints].sort((left, right) => left.order - right.order);
  const candidate = buildCandidate(orderedHints, fullPage());

  return candidate.frames.map((frame) => ({
    panelId: null,
    vertices: rectangleVertices(frame.rectangle),
    borderStyle: 'solid',
    borderWidth: 3,
    borderColor: '#000000',
    zIndex: 1,
    readingOrder: frame.hint.order,
  }));
}

function validateHints(hints: readonly StoryPanelLayoutHint[]): void {
  if (!Array.isArray(hints) || hints.length < 1 || hints.length > MAX_PANEL_COUNT) {
    throw new Error(`Story layout hints must contain between 1 and ${MAX_PANEL_COUNT} panels.`);
  }

  const seenOrders = new Set<number>();
  for (const hint of hints) {
    if (!isHint(hint)) {
      throw new Error('Story layout hint must contain an integer order, supported size, and supported shape.');
    }
    if (seenOrders.has(hint.order)) {
      throw new Error('Story layout hint orders must be contiguous and unique from 1.');
    }
    seenOrders.add(hint.order);
  }

  for (let order = 1; order <= hints.length; order += 1) {
    if (!seenOrders.has(order)) {
      throw new Error('Story layout hint orders must be contiguous and unique from 1.');
    }
  }
}

function isHint(value: unknown): value is StoryPanelLayoutHint {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as { order?: unknown; size?: unknown; shape?: unknown };
  return Number.isInteger(candidate.order)
    && isSize(candidate.size)
    && isShape(candidate.shape);
}

function isSize(value: unknown): value is StoryPanelLayoutHint['size'] {
  return value === 'standard' || value === 'large' || value === 'small' || value === 'largest';
}

function isShape(value: unknown): value is StoryPanelLayoutHint['shape'] {
  return value === 'auto' || value === 'wide' || value === 'tall';
}

function buildCandidate(hints: readonly StoryPanelLayoutHint[], rectangle: Rectangle): LayoutCandidate {
  if (hints.length === 1) {
    const hint = hints[0]!;
    return {
      frames: [{ hint, rectangle }],
      score: frameShapeLoss(hint, rectangle),
    };
  }

  let best: LayoutCandidate | null = null;
  const totalWeight = weightOf(hints);
  for (let splitAt = 1; splitAt < hints.length; splitAt += 1) {
    const first = hints.slice(0, splitAt);
    const second = hints.slice(splitAt);
    const firstShare = weightOf(first) / totalWeight;

    const horizontal = splitHorizontally(rectangle, firstShare);
    best = chooseBetter(best, combine(
      buildCandidate(first, horizontal.first),
      buildCandidate(second, horizontal.second),
    ));

    const vertical = splitRightToLeft(rectangle, firstShare);
    best = chooseBetter(best, combine(
      buildCandidate(first, vertical.first),
      buildCandidate(second, vertical.second),
    ));
  }

  if (best === null) {
    throw new Error('Unable to build a story layout candidate.');
  }
  return best;
}

function combine(first: LayoutCandidate, second: LayoutCandidate): LayoutCandidate {
  return {
    frames: [...first.frames, ...second.frames],
    score: first.score + second.score,
  };
}

function chooseBetter(current: LayoutCandidate | null, next: LayoutCandidate): LayoutCandidate {
  if (current === null || next.score < current.score) {
    return next;
  }
  return current;
}

function splitHorizontally(rectangle: Rectangle, firstShare: number): { first: Rectangle; second: Rectangle } {
  const splitY = rectangle.y1 + ((rectangle.y2 - rectangle.y1) * firstShare);
  return {
    first: { x1: rectangle.x1, y1: rectangle.y1, x2: rectangle.x2, y2: splitY },
    second: { x1: rectangle.x1, y1: splitY, x2: rectangle.x2, y2: rectangle.y2 },
  };
}

function splitRightToLeft(rectangle: Rectangle, firstShare: number): { first: Rectangle; second: Rectangle } {
  const splitX = rectangle.x2 - ((rectangle.x2 - rectangle.x1) * firstShare);
  return {
    first: { x1: splitX, y1: rectangle.y1, x2: rectangle.x2, y2: rectangle.y2 },
    second: { x1: rectangle.x1, y1: rectangle.y1, x2: splitX, y2: rectangle.y2 },
  };
}

function frameShapeLoss(hint: StoryPanelLayoutHint, rectangle: Rectangle): number {
  const logicalWidth = rectangle.x2 - rectangle.x1;
  const logicalHeight = rectangle.y2 - rectangle.y1;
  const physicalRatio = (PAGE_PHYSICAL_WIDTH * logicalWidth) / logicalHeight;
  const target = SHAPE_TARGETS[hint.shape];
  // Satisfying an achievable explicit orientation beats a slightly prettier
  // aspect ratio elsewhere; weights alone can prefer a square over a requested
  // wide panel. Impossible combinations still choose the least conflicting fit.
  const violatesShape = (hint.shape === 'wide' && physicalRatio < 1.2)
    || (hint.shape === 'tall' && physicalRatio > 0.8);
  return (violatesShape ? 1000 : 0)
    + SHAPE_IMPORTANCE[hint.shape] * Math.abs(Math.log(physicalRatio / target));
}

function weightOf(hints: readonly StoryPanelLayoutHint[]): number {
  return hints.reduce((total, hint) => total + SIZE_WEIGHTS[hint.size], 0);
}

function fullPage(): Rectangle {
  return { x1: 0, y1: 0, x2: 1, y2: 1 };
}

function rectangleVertices(rectangle: Rectangle): PanelFrameVertex[] {
  return [
    { x: rectangle.x1, y: rectangle.y1 },
    { x: rectangle.x2, y: rectangle.y1 },
    { x: rectangle.x2, y: rectangle.y2 },
    { x: rectangle.x1, y: rectangle.y2 },
  ];
}
