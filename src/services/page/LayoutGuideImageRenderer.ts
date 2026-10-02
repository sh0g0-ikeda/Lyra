import { PNG } from 'pngjs';
import { ConfigurationError } from '../../domain/errors/index.js';

export interface LayoutGuideImage {
  imageData: Buffer;
  mimeType: 'image/png';
}

export interface LayoutGuideImageRendererPort {
  render(frameDefinitions: unknown, options?: { numberFrames?: boolean }): LayoutGuideImage | null;
}

interface LayoutFrameVertex {
  x: number;
  y: number;
}

interface LayoutFrameDefinition {
  borderColor: string;
  borderStyle: 'solid' | 'dashed' | 'none';
  borderWidth: number;
  readingOrder: number;
  vertices: LayoutFrameVertex[];
}

const PAGE_WIDTH = 1024;
const PAGE_HEIGHT = 1536;
const BACKGROUND_COLOR = { r: 255, g: 255, b: 255, a: 255 };
const BORDER_COLOR = { r: 0, g: 0, b: 0, a: 255 };

const LABEL_BACKGROUND = { r: 0, g: 0, b: 0, a: 255 };
const LABEL_FOREGROUND = { r: 255, g: 255, b: 255, a: 255 };
const LABEL_PADDING = 8;
const LABEL_FRAME_MARGIN = 12;
const GLYPH_SPACING = 2;
const BITMAP_FONT: Record<string, readonly string[]> = {
  P: ['11110','10001','10001','11110','10000','10000','10000'],
  0: ['01110','10001','10011','10101','11001','10001','01110'],
  1: ['00100','01100','00100','00100','00100','00100','01110'],
  2: ['01110','10001','00001','00010','00100','01000','11111'],
  3: ['11110','00001','00001','01110','00001','00001','11110'],
  4: ['00010','00110','01010','10010','11111','00010','00010'],
  5: ['11111','10000','10000','11110','00001','00001','11110'],
  6: ['01110','10000','10000','11110','10001','10001','01110'],
  7: ['11111','00001','00010','00100','01000','01000','01000'],
  8: ['01110','10001','10001','01110','10001','10001','01110'],
  9: ['01110','10001','10001','01111','00001','00001','01110'],
};

export class LayoutGuideImageRenderer implements LayoutGuideImageRendererPort {
  public render(frameDefinitions: unknown, options?: { numberFrames?: boolean }): LayoutGuideImage | null {
    const frames = toLayoutFrameDefinitions(frameDefinitions);
    if (frames.length === 0) {
      return null;
    }

    const png = new PNG({ width: PAGE_WIDTH, height: PAGE_HEIGHT });
    fillBackground(png.data);

    for (const frame of frames) {
      drawFrame(png, frame);
      if (options?.numberFrames === true && Number.isInteger(frame.readingOrder) && frame.readingOrder > 0) drawReadingOrderLabel(png, frame);
    }

    return {
      imageData: PNG.sync.write(png),
      mimeType: 'image/png',
    };
  }
}

function fillBackground(buffer: Buffer): void {
  for (let index = 0; index < buffer.length; index += 4) {
    buffer[index] = BACKGROUND_COLOR.r;
    buffer[index + 1] = BACKGROUND_COLOR.g;
    buffer[index + 2] = BACKGROUND_COLOR.b;
    buffer[index + 3] = BACKGROUND_COLOR.a;
  }
}

function drawFrame(png: PNG, frame: LayoutFrameDefinition): void {
  if (frame.borderStyle === 'none' || frame.vertices.length < 2) {
    return;
  }

  const color = toRgba(frame.borderColor);
  const points = frame.vertices.map((vertex) => ({
    x: Math.round(clamp(vertex.x) * (PAGE_WIDTH - 1)),
    y: Math.round(clamp(vertex.y) * (PAGE_HEIGHT - 1)),
  }));

  for (let index = 0; index < points.length; index += 1) {
    const start = points[index];
    const end = points[(index + 1) % points.length];
    drawLine(png, start.x, start.y, end.x, end.y, frame.borderWidth, color, frame.borderStyle);
  }
}

function drawReadingOrderLabel(png: PNG, frame: LayoutFrameDefinition): void {
  const label = `P${frame.readingOrder}`;
  const placement = findLabelPlacement(frame.vertices, label);
  if (placement === null) {
    return;
  }

  const clipPolygon = frame.vertices.map((vertex) => ({
    x: Math.round(clamp(vertex.x) * (PAGE_WIDTH - 1)),
    y: Math.round(clamp(vertex.y) * (PAGE_HEIGHT - 1)),
  }));
  const clip = polygonIsConvex(clipPolygon) ? undefined : clipPolygon;

  fillRectangle(png, placement.left, placement.top, placement.width, placement.height, LABEL_BACKGROUND, clip);
  let cursorX = placement.left + LABEL_PADDING;
  for (const character of label) {
    drawBitmapCharacter(png, character, cursorX, placement.top + LABEL_PADDING, placement.scale, clip);
    cursorX += (BITMAP_FONT[character]?.[0]?.length ?? 0) * placement.scale + GLYPH_SPACING * placement.scale;
  }
}

function findLabelPlacement(
  vertices: readonly LayoutFrameVertex[],
  label: string,
): { left: number; top: number; width: number; height: number; scale: number } | null {
  const points = vertices.map((vertex) => ({
    x: Math.round(clamp(vertex.x) * (PAGE_WIDTH - 1)),
    y: Math.round(clamp(vertex.y) * (PAGE_HEIGHT - 1)),
  }));
  const center = polygonCenter(points);
  const glyphWidth = [...label].reduce((total, character) => total + (BITMAP_FONT[character]?.[0]?.length ?? 0) + GLYPH_SPACING, -GLYPH_SPACING);
  const glyphHeight = BITMAP_FONT.P.length;

  for (let scale = 7; scale >= 2; scale -= 1) {
    const width = glyphWidth * scale + LABEL_PADDING * 2;
    const height = glyphHeight * scale + LABEL_PADDING * 2;
    const left = Math.round(center.x - width / 2);
    const top = Math.round(center.y - height / 2);
    if (rectangleIsInsidePolygon(points, left - LABEL_FRAME_MARGIN, top - LABEL_FRAME_MARGIN, width + LABEL_FRAME_MARGIN * 2, height + LABEL_FRAME_MARGIN * 2)) {
      return { left, top, width, height, scale };
    }

    const fallback = findLargestSafeLabelPlacement(points, center, width, height);
    if (fallback !== null) {
      return { ...fallback, width, height, scale };
    }
  }

  return null;
}

function findLargestSafeLabelPlacement(
  polygon: readonly { x: number; y: number }[],
  preferredCenter: { x: number; y: number },
  width: number,
  height: number,
): { left: number; top: number } | null {
  const bounds = polygon.reduce(
    (current, point) => ({
      minX: Math.min(current.minX, point.x), maxX: Math.max(current.maxX, point.x),
      minY: Math.min(current.minY, point.y), maxY: Math.max(current.maxY, point.y),
    }),
    { minX: PAGE_WIDTH, maxX: 0, minY: PAGE_HEIGHT, maxY: 0 },
  );
  let best: { left: number; top: number; score: number; preferredDistance: number } | null = null;
  const consider = (centerX: number, centerY: number): void => {
    const left = Math.round(centerX - width / 2);
    const top = Math.round(centerY - height / 2);
    if (!rectangleIsInsidePolygon(polygon, left - LABEL_FRAME_MARGIN, top - LABEL_FRAME_MARGIN, width + LABEL_FRAME_MARGIN * 2, height + LABEL_FRAME_MARGIN * 2)) return;
    const score = distanceToPolygonEdges({ x: centerX, y: centerY }, polygon);
    const preferredDistance = Math.hypot(centerX - preferredCenter.x, centerY - preferredCenter.y);
    if (best === null || score > best.score || (score === best.score && preferredDistance < best.preferredDistance)) {
      best = { left, top, score, preferredDistance };
    }
  };
  for (let index = 1; index < polygon.length - 1; index += 1) {
    const first = polygon[0]!;
    const second = polygon[index]!;
    const third = polygon[index + 1]!;
    consider((first.x + second.x + third.x) / 3, (first.y + second.y + third.y) / 3);
  }
  for (let centerY = bounds.minY + height / 2; centerY <= bounds.maxY - height / 2; centerY += 8) {
    for (let centerX = bounds.minX + width / 2; centerX <= bounds.maxX - width / 2; centerX += 8) {
      consider(centerX, centerY);
    }
  }
  const resolvedBest = best as { left: number; top: number; score: number; preferredDistance: number } | null;
  return resolvedBest === null ? null : { left: resolvedBest.left, top: resolvedBest.top };
}

function distanceToPolygonEdges(point: { x: number; y: number }, polygon: readonly { x: number; y: number }[]): number {
  return polygon.reduce((minimum, current, index) => {
    const previous = polygon[(index + polygon.length - 1) % polygon.length]!;
    return Math.min(minimum, distanceToSegment(point, previous, current));
  }, Number.POSITIVE_INFINITY);
}

function distanceToSegment(point: { x: number; y: number }, start: { x: number; y: number }, end: { x: number; y: number }): number {
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  const lengthSquared = deltaX * deltaX + deltaY * deltaY;
  const ratio = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - start.x) * deltaX + (point.y - start.y) * deltaY) / lengthSquared));
  return Math.hypot(point.x - (start.x + ratio * deltaX), point.y - (start.y + ratio * deltaY));
}

function polygonCenter(points: readonly { x: number; y: number }[]): { x: number; y: number } {
  const total = points.reduce((sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }), { x: 0, y: 0 });
  return { x: total.x / points.length, y: total.y / points.length };
}

function rectangleIsInsidePolygon(
  polygon: readonly { x: number; y: number }[],
  left: number,
  top: number,
  width: number,
  height: number,
): boolean {
  return [
    { x: left, y: top },
    { x: left + width - 1, y: top },
    { x: left, y: top + height - 1 },
    { x: left + width - 1, y: top + height - 1 },
  ].every((point) => pointIsInsidePolygon(point, polygon));
}

function pointIsInsidePolygon(point: { x: number; y: number }, polygon: readonly { x: number; y: number }[]): boolean {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const current = polygon[index]!;
    const before = polygon[previous]!;
    const intersects =
      (current.y > point.y) !== (before.y > point.y) &&
      point.x < ((before.x - current.x) * (point.y - current.y)) / (before.y - current.y) + current.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

function fillRectangle(
  png: PNG,
  left: number,
  top: number,
  width: number,
  height: number,
  color: { r: number; g: number; b: number; a: number },
  clipPolygon?: readonly { x: number; y: number }[],
): void {
  for (let y = top; y < top + height; y += 1) {
    for (let x = left; x < left + width; x += 1) {
      if (clipPolygon !== undefined && !pointIsInsidePolygon({ x, y }, clipPolygon)) continue;
      paintPoint(png, x, y, 1, color);
    }
  }
}

function drawBitmapCharacter(
  png: PNG,
  character: string,
  left: number,
  top: number,
  scale: number,
  clipPolygon?: readonly { x: number; y: number }[],
): void {
  const bitmap = BITMAP_FONT[character];
  if (bitmap === undefined) return;
  for (let row = 0; row < bitmap.length; row += 1) {
    for (let column = 0; column < bitmap[row]!.length; column += 1) {
      if (bitmap[row]![column] === '1') {
        fillRectangle(png, left + column * scale, top + row * scale, scale, scale, LABEL_FOREGROUND, clipPolygon);
      }
    }
  }
}

function polygonIsConvex(polygon: readonly { x: number; y: number }[]): boolean {
  let direction = 0;
  for (let index = 0; index < polygon.length; index += 1) {
    const first = polygon[index]!;
    const second = polygon[(index + 1) % polygon.length]!;
    const third = polygon[(index + 2) % polygon.length]!;
    const cross = (second.x - first.x) * (third.y - second.y) - (second.y - first.y) * (third.x - second.x);
    if (cross === 0) continue;
    const nextDirection = Math.sign(cross);
    if (direction !== 0 && direction !== nextDirection) return false;
    direction = nextDirection;
  }
  return true;
}

function drawLine(
  png: PNG,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  width: number,
  color: { r: number; g: number; b: number; a: number },
  style: 'solid' | 'dashed',
): void {
  let x = startX;
  let y = startY;
  const deltaX = Math.abs(endX - startX);
  const deltaY = Math.abs(endY - startY);
  const stepX = startX < endX ? 1 : -1;
  const stepY = startY < endY ? 1 : -1;
  let error = deltaX - deltaY;
  let step = 0;

  while (true) {
    if (style === 'solid' || Math.floor(step / 12) % 2 === 0) {
      paintPoint(png, x, y, width, color);
    }

    if (x === endX && y === endY) {
      break;
    }

    const twiceError = error * 2;
    if (twiceError > -deltaY) {
      error -= deltaY;
      x += stepX;
    }

    if (twiceError < deltaX) {
      error += deltaX;
      y += stepY;
    }

    step += 1;
  }
}

function paintPoint(
  png: PNG,
  centerX: number,
  centerY: number,
  width: number,
  color: { r: number; g: number; b: number; a: number },
): void {
  const radius = Math.max(0, Math.floor(width / 2));
  for (let offsetY = -radius; offsetY <= radius; offsetY += 1) {
    for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
      const x = centerX + offsetX;
      const y = centerY + offsetY;
      if (x < 0 || x >= PAGE_WIDTH || y < 0 || y >= PAGE_HEIGHT) {
        continue;
      }

      const index = (y * PAGE_WIDTH + x) * 4;
      png.data[index] = color.r;
      png.data[index + 1] = color.g;
      png.data[index + 2] = color.b;
      png.data[index + 3] = color.a;
    }
  }
}

function toLayoutFrameDefinitions(value: unknown): LayoutFrameDefinition[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .flatMap((entry) => {
      if (!isRecord(entry) || !Array.isArray(entry.vertices)) {
        return [];
      }

      const vertices = entry.vertices.flatMap((vertex) => {
        if (!isRecord(vertex) || typeof vertex.x !== 'number' || typeof vertex.y !== 'number' || !Number.isFinite(vertex.x) || !Number.isFinite(vertex.y)) {
          return [];
        }

        return [{ x: vertex.x, y: vertex.y }];
      });

      if (vertices.length < 3) {
        return [];
      }

      const borderStyleValue = entry.border_style ?? entry.borderStyle;
      const borderColorValue = entry.border_color ?? entry.borderColor;
      const borderWidthValue = entry.border_width ?? entry.borderWidth;
      const readingOrderValue = entry.reading_order ?? entry.readingOrder;
      const borderStyle: LayoutFrameDefinition['borderStyle'] =
        borderStyleValue === 'dashed' || borderStyleValue === 'none'
          ? borderStyleValue
          : 'solid';

      return [
        {
          borderColor:
            typeof borderColorValue === 'string'
              ? borderColorValue
              : '#000000',
          borderStyle,
          borderWidth:
            typeof borderWidthValue === 'number' && borderWidthValue > 0
              ? Math.min(16, Math.round(borderWidthValue))
              : 4,
          readingOrder:
            typeof readingOrderValue === 'number'
              ? readingOrderValue
              : 0,
          vertices,
        },
      ];
    })
    .sort((left, right) => left.readingOrder - right.readingOrder);
}

function toRgba(value: string): { r: number; g: number; b: number; a: number } {
  const normalized = value.trim().toLowerCase();
  const match = /^#([0-9a-f]{6})$/u.exec(normalized);
  if (match === null) {
    return BORDER_COLOR;
  }

  const hex = match[1];
  const parsed = Number.parseInt(hex, 16);
  if (Number.isNaN(parsed)) {
    throw new ConfigurationError(`Invalid layout guide color: ${value}`);
  }

  return {
    r: (parsed >> 16) & 0xff,
    g: (parsed >> 8) & 0xff,
    b: parsed & 0xff,
    a: 255,
  };
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
