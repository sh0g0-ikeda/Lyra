import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { listPanelFrameTemplateDefinitions } from '../../../../src/domain/constants/panelFrameTemplates.js';
import { LayoutGuideImageRenderer } from '../../../../src/services/page/LayoutGuideImageRenderer.js';

class NumberedLayoutGuideImageRenderer extends LayoutGuideImageRenderer {
  public override render(frames: unknown) { return super.render(frames, { numberFrames: true }); }
}

describe('LayoutGuideImageRenderer', () => {
  it('frame_definitions から png guide image を生成する', () => {
    const renderer = new NumberedLayoutGuideImageRenderer();

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
    const renderer = new NumberedLayoutGuideImageRenderer();

    expect(renderer.render([])).toBeNull();
  });

  it('保存されたsnake_caseとcamelCaseの読み順を枠内ラベルとして描く', () => {
    const renderer = new NumberedLayoutGuideImageRenderer();
    const result = renderer.render([
      {
        reading_order: 12,
        border_style: 'solid',
        border_width: 4,
        border_color: '#000000',
        vertices: [{ x: 0, y: 0 }, { x: 0.45, y: 0 }, { x: 0.45, y: 0.5 }, { x: 0, y: 0.5 }],
      },
      {
        readingOrder: 3,
        borderStyle: 'dashed',
        borderWidth: 4,
        borderColor: '#000000',
        vertices: [{ x: 0.55, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 0.5 }, { x: 0.55, y: 0.5 }],
      },
    ]);

    expect(result).not.toBeNull();
    const png = PNG.sync.read(result!.imageData);
    expect(countDarkPixelsNear(png, 0.225, 0.25)).toBeGreaterThan(20);
    expect(countDarkPixelsNear(png, 0.775, 0.25)).toBeGreaterThan(20);
  });

  it.each(listPanelFrameTemplateDefinitions())('テンプレート$idの有効な枠に番号付きガイドを描ける', (template) => {
    const renderer = new NumberedLayoutGuideImageRenderer();

    const result = renderer.render(template.frames);
    expect(result, template.id).not.toBeNull();
    const png = PNG.sync.read(result!.imageData);
    for (const frame of template.frames) {
      const center = polygonCenter(frame.vertices);
      expect(countDarkPixelsNear(png, center.x, center.y), `${template.id}:P${frame.readingOrder}`).toBeGreaterThan(20);
    }
  });

  it('読み順の数字を固定ビットマップとして保持する', () => {
    const renderer = new NumberedLayoutGuideImageRenderer();
    const frame = {
      border_style: 'solid', border_width: 4, border_color: '#000000',
      vertices: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }],
    };
    const one = PNG.sync.read(renderer.render([{ ...frame, reading_order: 1 }])!.imageData);
    const two = PNG.sync.read(renderer.render([{ ...frame, reading_order: 2 }])!.imageData);

    expect(one.data.equals(two.data)).toBe(false);
    const centerBlack = listDarkPixels(one).filter(p => p.x > 400 && p.x < 620 && p.y > 650 && p.y < 850);
    expect(centerBlack.length).toBeGreaterThan(100);

  });

  it('narrow frames leave clear space between the label and each border', () => {
    const png=PNG.sync.read(new NumberedLayoutGuideImageRenderer().render([{reading_order:2,border_style:'solid',border_width:1,border_color:'#000000',vertices:[{x:.91,y:.4},{x:1,y:.4},{x:1,y:1},{x:.91,y:1}]}])!.imageData);
    // Central strip excludes the horizontal panel borders. Labels must leave a 10px margin.
    expect(countDarkPixelsInRegion(png,.913,.921,.6,.8)).toBe(0);
    expect(countDarkPixelsInRegion(png,.99,.998,.6,.8)).toBe(0);
  });

  it('頂点平均が枠外の凹形layoutでもガイド生成を継続する', () => {
    const renderer = new NumberedLayoutGuideImageRenderer();
    const result = renderer.render([{
      reading_order: 7,
      border_style: 'solid', border_width: 4, border_color: '#000000',
      vertices: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 0.25 }, { x: 0.25, y: 0.25 }, { x: 0.25, y: 1 }, { x: 0, y: 1 }],
    }]);

    expect(result).not.toBeNull();
    expect(PNG.sync.read(result!.imageData).width).toBe(1024);
  });

  it('ラベル矩形が収まらない狭小custom frameの外側へ描画しない', () => {
    const renderer = new NumberedLayoutGuideImageRenderer();
    const result = renderer.render([{
      reading_order: 1,
      border_style: 'solid', border_width: 1, border_color: '#000000',
      vertices: [{ x: 0.497, y: 0.2 }, { x: 0.502, y: 0.2 }, { x: 0.502, y: 0.8 }, { x: 0.497, y: 0.8 }],
    }]);

    expect(result).not.toBeNull();
    expect(countDarkPixelsInRegion(PNG.sync.read(result!.imageData), 0.45, 0.49, 0.35, 0.65)).toBe(0);
    expect(countDarkPixelsInRegion(PNG.sync.read(result!.imageData), 0.51, 0.55, 0.35, 0.65)).toBe(0);
  });

  it('凹形custom frameではラベルの全暗色pixelをpolygon内へclipする', () => {
    const renderer = new NumberedLayoutGuideImageRenderer();
    const vertices = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0.2, y: 0.2 }, { x: 0, y: 1 }];
    const result = renderer.render([{
      reading_order: 1,
      border_style: 'none', border_width: 1, border_color: '#000000', vertices,
    }]);

    expect(result).not.toBeNull();
    const png = PNG.sync.read(result!.imageData);
    const darkPixels = listDarkPixels(png);
    expect(darkPixels.length).toBeGreaterThan(20);
    expect(darkPixels.every((pixel) => pointIsInsidePolygon({ x: pixel.x / (png.width - 1), y: pixel.y / (png.height - 1) }, vertices))).toBe(true);
  });
});

function countDarkPixelsNear(png: PNG, normalizedX: number, normalizedY: number): number {
  const centerX = Math.round(normalizedX * (png.width - 1));
  const centerY = Math.round(normalizedY * (png.height - 1));
  let count = 0;
  for (let y = centerY - 32; y <= centerY + 32; y += 1) {
    for (let x = centerX - 32; x <= centerX + 32; x += 1) {
      if (x < 0 || y < 0 || x >= png.width || y >= png.height) continue;
      const offset = (y * png.width + x) * 4;
      if (png.data[offset]! < 64 && png.data[offset + 1]! < 64 && png.data[offset + 2]! < 64) count += 1;
    }
  }
  return count;
}

function polygonCenter(vertices: readonly { x: number; y: number }[]): { x: number; y: number } {
  const total = vertices.reduce((sum, vertex) => ({ x: sum.x + vertex.x, y: sum.y + vertex.y }), { x: 0, y: 0 });
  return { x: total.x / vertices.length, y: total.y / vertices.length };
}



function countDarkPixelsInRegion(png: PNG, minX: number, maxX: number, minY: number, maxY: number): number {
  let count = 0;
  for (let y = Math.floor(minY * png.height); y < Math.ceil(maxY * png.height); y += 1) {
    for (let x = Math.floor(minX * png.width); x < Math.ceil(maxX * png.width); x += 1) {
      const offset = (y * png.width + x) * 4;
      if (png.data[offset]! < 64 && png.data[offset + 1]! < 64 && png.data[offset + 2]! < 64) count += 1;
    }
  }
  return count;
}

function listDarkPixels(png: PNG): Array<{ x: number; y: number }> {
  const pixels: Array<{ x: number; y: number }> = [];
  for (let y = 0; y < png.height; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      const offset = (y * png.width + x) * 4;
      if (png.data[offset]! < 64 && png.data[offset + 1]! < 64 && png.data[offset + 2]! < 64) pixels.push({ x, y });
    }
  }
  return pixels;
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
