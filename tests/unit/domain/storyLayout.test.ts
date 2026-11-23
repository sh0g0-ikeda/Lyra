import { describe, expect, it } from 'vitest';
import {
  buildStoryLayoutFrames,
  type StoryPanelLayoutHint,
} from '../../../src/domain/storyLayout.js';

function hints(
  values: ReadonlyArray<Pick<StoryPanelLayoutHint, 'size' | 'shape'>>,
): StoryPanelLayoutHint[] {
  return values.map((value, index) => ({ order: index + 1, ...value }));
}

function bounds(vertices: ReadonlyArray<{ x: number; y: number }>): { x1: number; y1: number; x2: number; y2: number } {
  return {
    x1: vertices[0]!.x,
    y1: vertices[0]!.y,
    x2: vertices[2]!.x,
    y2: vertices[2]!.y,
  };
}

function area(vertices: ReadonlyArray<{ x: number; y: number }>): number {
  const rectangle = bounds(vertices);
  return (rectangle.x2 - rectangle.x1) * (rectangle.y2 - rectangle.y1);
}

function physicalRatio(vertices: ReadonlyArray<{ x: number; y: number }>): number {
  const rectangle = bounds(vertices);
  return (0.7 * (rectangle.x2 - rectangle.x1)) / (rectangle.y2 - rectangle.y1);
}

function overlapArea(
  first: ReadonlyArray<{ x: number; y: number }>,
  second: ReadonlyArray<{ x: number; y: number }>,
): number {
  const a = bounds(first);
  const b = bounds(second);
  return Math.max(0, Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1))
    * Math.max(0, Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1));
}

describe('buildStoryLayoutFrames', () => {
  it('縦長と横長が混在しても実現可能な向きを自然な比率より優先する', () => {
    const frames = buildStoryLayoutFrames(hints([
      { size: 'standard', shape: 'tall' }, { size: 'standard', shape: 'wide' },
      { size: 'standard', shape: 'tall' }, { size: 'standard', shape: 'auto' },
    ]));
    expect(physicalRatio(frames[0]!.vertices)).toBeLessThan(0.8);
    expect(physicalRatio(frames[1]!.vertices)).toBeGreaterThan(1.2);
    expect(physicalRatio(frames[2]!.vertices)).toBeLessThan(0.8);
  });
  it.each([1, 2, 3, 4, 5, 6, 7, 8])('%iコマの正規化済みフレームをページ全体に作る', (count) => {
    const frames = buildStoryLayoutFrames(hints(Array.from({ length: count }, () => ({ size: 'standard', shape: 'auto' }))));

    expect(frames).toHaveLength(count);
    expect(frames.map((frame) => frame.readingOrder)).toEqual(Array.from({ length: count }, (_, index) => index + 1));
    expect(frames.every((frame) => frame.panelId === null && frame.borderStyle === 'solid' && frame.borderWidth === 3 && frame.borderColor === '#000000' && frame.zIndex === 1)).toBe(true);
    expect(frames.reduce((sum, frame) => sum + area(frame.vertices), 0)).toBeCloseTo(1, 10);

    for (const frame of frames) {
      const rectangle = bounds(frame.vertices);
      expect(rectangle.x1).toBeGreaterThanOrEqual(0);
      expect(rectangle.y1).toBeGreaterThanOrEqual(0);
      expect(rectangle.x2).toBeLessThanOrEqual(1);
      expect(rectangle.y2).toBeLessThanOrEqual(1);
    }
    for (let first = 0; first < frames.length; first += 1) {
      for (let second = first + 1; second < frames.length; second += 1) {
        expect(overlapArea(frames[first]!.vertices, frames[second]!.vertices)).toBeCloseTo(0, 10);
      }
    }
  });

  it('4コマ中2コマ目のlargestを他より大きくする', () => {
    const frames = buildStoryLayoutFrames(hints([
      { size: 'standard', shape: 'auto' },
      { size: 'largest', shape: 'auto' },
      { size: 'standard', shape: 'auto' },
      { size: 'standard', shape: 'auto' },
    ]));

    expect(area(frames[1]!.vertices)).toBeGreaterThan(area(frames[0]!.vertices));
    expect(area(frames[1]!.vertices)).toBeGreaterThan(area(frames[2]!.vertices));
    expect(area(frames[1]!.vertices)).toBeGreaterThan(area(frames[3]!.vertices));
  });

  it('4コマ中3コマ目のlarge wideを物理比率1.2超の横長にする', () => {
    const frames = buildStoryLayoutFrames(hints([
      { size: 'standard', shape: 'auto' },
      { size: 'standard', shape: 'auto' },
      { size: 'large', shape: 'wide' },
      { size: 'standard', shape: 'auto' },
    ]));

    expect(physicalRatio(frames[2]!.vertices)).toBeGreaterThan(1.2);
  });

  it('小コマが混在してもlargeを大きく保つ', () => {
    const frames = buildStoryLayoutFrames(hints([
      { size: 'standard', shape: 'auto' },
      { size: 'large', shape: 'auto' },
      { size: 'small', shape: 'auto' },
      { size: 'small', shape: 'auto' },
    ]));

    expect(area(frames[1]!.vertices)).toBeGreaterThan(area(frames[2]!.vertices));
    expect(area(frames[1]!.vertices)).toBeGreaterThan(area(frames[3]!.vertices));
  });

  it('6コマ中1コマ目のwide largeを横長にする', () => {
    const frames = buildStoryLayoutFrames(hints([
      { size: 'large', shape: 'wide' },
      { size: 'standard', shape: 'auto' },
      { size: 'standard', shape: 'auto' },
      { size: 'standard', shape: 'auto' },
      { size: 'standard', shape: 'auto' },
      { size: 'standard', shape: 'auto' },
    ]));

    expect(physicalRatio(frames[0]!.vertices)).toBeGreaterThan(1.2);
  });

  it('4コマ中のtall指定を物理比率0.8未満にする', () => {
    const frames = buildStoryLayoutFrames(hints([
      { size: 'standard', shape: 'auto' },
      { size: 'standard', shape: 'tall' },
      { size: 'standard', shape: 'auto' },
      { size: 'standard', shape: 'auto' },
    ]));

    expect(physicalRatio(frames[1]!.vertices)).toBeLessThan(0.8);
  });

  it('全wide指定を横長の帯として配置する', () => {
    const frames = buildStoryLayoutFrames(hints(Array.from({ length: 4 }, () => ({ size: 'standard', shape: 'wide' }))));

    expect(frames.every((frame) => physicalRatio(frame.vertices) > 1.2)).toBe(true);
  });

  it('不正な件数、順序、ヒント値を拒否する', () => {
    expect(() => buildStoryLayoutFrames([])).toThrow('between 1 and 8');
    expect(() => buildStoryLayoutFrames([
      { order: 1, size: 'standard', shape: 'auto' },
      { order: 3, size: 'standard', shape: 'auto' },
    ])).toThrow('contiguous');
    expect(() => buildStoryLayoutFrames([
      { order: 1, size: 'standard', shape: 'auto' },
      { order: 1, size: 'standard', shape: 'auto' },
    ])).toThrow('contiguous');
    expect(() => buildStoryLayoutFrames([{ order: 1, size: 'huge' as never, shape: 'auto' }])).toThrow('size');
    expect(() => buildStoryLayoutFrames([{ order: 1, size: 'standard', shape: 'diagonal' as never }])).toThrow('shape');
  });
});
