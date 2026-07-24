import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { SharpPageThumbnailRenderer } from '../../../../src/infrastructure/image/SharpPageThumbnailRenderer.js';

describe('SharpPageThumbnailRenderer', () => {
  it('大きな原画像を320x480以内のWebPへ縮小する', async () => {
    const source = await sharp({
      create: {
        width: 1200,
        height: 1800,
        channels: 3,
        background: '#ffffff',
      },
    }).png().toBuffer();
    const renderer = new SharpPageThumbnailRenderer();

    const result = await renderer.render({
      imageData: source,
      mimeType: 'image/png',
    });

    const metadata = await sharp(result.imageData).metadata();
    expect(result.mimeType).toBe('image/webp');
    expect(metadata.format).toBe('webp');
    expect(metadata.width).toBeLessThanOrEqual(320);
    expect(metadata.height).toBeLessThanOrEqual(480);
  });

  it('小さな画像を拡大しない', async () => {
    const source = await sharp({
      create: {
        width: 120,
        height: 180,
        channels: 3,
        background: '#ffffff',
      },
    }).png().toBuffer();
    const renderer = new SharpPageThumbnailRenderer();

    const result = await renderer.render({
      imageData: source,
      mimeType: 'image/png',
    });

    const metadata = await sharp(result.imageData).metadata();
    expect(metadata.width).toBe(120);
    expect(metadata.height).toBe(180);
  });
});
