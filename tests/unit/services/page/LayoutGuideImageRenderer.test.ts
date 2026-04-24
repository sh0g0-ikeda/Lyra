import { describe, expect, it } from 'vitest';
import { LayoutGuideImageRenderer } from '../../../../src/services/page/LayoutGuideImageRenderer.js';

describe('LayoutGuideImageRenderer', () => {
  it('frame_definitions から png guide image を生成する', () => {
    const renderer = new LayoutGuideImageRenderer();

    const result = renderer.render([
      {
        reading_order: 1,
        border_style: 'solid',
        border_width: 4,
        border_color: '#000000',
        vertices: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 1, y: 0.5 },
          { x: 0, y: 0.5 },
        ],
      },
    ]);

    expect(result).not.toBeNull();
    expect(result?.mimeType).toBe('image/png');
    expect(result?.imageData.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
  });

  it('空の frame_definitions は null を返す', () => {
    const renderer = new LayoutGuideImageRenderer();

    expect(renderer.render([])).toBeNull();
  });
});
