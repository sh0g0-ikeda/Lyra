import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { SharpPageBalloonComposer } from '../../../../src/services/page/PageBalloonComposer.js';

describe('SharpPageBalloonComposer', () => {
  it('balloon overlay を合成した PNG を返す', async () => {
    const sourceImage = await sharp({
      create: {
        width: 200,
        height: 300,
        channels: 4,
        background: '#cccccc',
      },
    })
      .png()
      .toBuffer();
    const composer = new SharpPageBalloonComposer();

    const result = await composer.compose({
      pageImage: sourceImage,
      balloons: [
        {
          id: 'balloon-1',
          pageId: 'page-1',
          speakerEntityId: null,
          balloonType: 'speech',
          writingMode: 'horizontal',
          text: 'Hello world',
          position: { x: 0.1, y: 0.1, width: 0.4, height: 0.2 },
          tail: null,
          fontSize: 18,
          fontFamily: 'manga_gothic',
          panelOrderReference: 1,
          zIndex: 10,
        },
      ],
    });

    const metadata = await sharp(result.imageData).metadata();

    expect(result.mimeType).toBe('image/png');
    expect(metadata.width).toBe(200);
    expect(metadata.height).toBe(300);
    expect(result.imageData.equals(sourceImage)).toBe(false);
  });
});
