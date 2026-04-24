import { PNG } from 'pngjs';
import { ConfigurationError } from '../../domain/errors/index.js';

export interface LayoutGuideImage {
  imageData: Buffer;
  mimeType: 'image/png';
}

export interface LayoutGuideImageRendererPort {
  render(frameDefinitions: unknown): LayoutGuideImage | null;
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

export class LayoutGuideImageRenderer implements LayoutGuideImageRendererPort {
  public render(frameDefinitions: unknown): LayoutGuideImage | null {
    const frames = toLayoutFrameDefinitions(frameDefinitions);
    if (frames.length === 0) {
      return null;
    }

    const png = new PNG({ width: PAGE_WIDTH, height: PAGE_HEIGHT });
    fillBackground(png.data);

    for (const frame of frames) {
      drawFrame(png, frame);
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
        if (!isRecord(vertex) || typeof vertex.x !== 'number' || typeof vertex.y !== 'number') {
          return [];
        }

        return [{ x: vertex.x, y: vertex.y }];
      });

      if (vertices.length < 3) {
        return [];
      }

      const borderStyle: LayoutFrameDefinition['borderStyle'] =
        entry.border_style === 'dashed' || entry.border_style === 'none'
          ? entry.border_style
          : 'solid';

      return [
        {
          borderColor:
            typeof entry.border_color === 'string' ? entry.border_color : '#000000',
          borderStyle,
          borderWidth:
            typeof entry.border_width === 'number' && entry.border_width > 0
              ? Math.min(16, Math.round(entry.border_width))
              : 4,
          readingOrder:
            typeof entry.reading_order === 'number' ? entry.reading_order : 0,
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
