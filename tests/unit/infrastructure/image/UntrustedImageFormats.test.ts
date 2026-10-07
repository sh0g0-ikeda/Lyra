import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { SharpPageThumbnailRenderer } from '../../../../src/infrastructure/image/SharpPageThumbnailRenderer.js';

describe('画像decoderへ渡す形式の制限', () => {
  it('PNGを名乗るSVGの場合にdecoderへ渡さず拒否する', async () => {
    const imageData = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>');
    await expect(new SharpPageThumbnailRenderer().render({ imageData, mimeType: 'image/png' })).rejects.toMatchObject({ code: 'CONFIGURATION_ERROR' });
  });
  it.each(['png', 'jpeg', 'webp'] as const)('正規の%sの場合にサムネイルを維持する', async (format) => {
    const imageData = await sharp({ create: { width: 20, height: 30, channels: 3, background: '#fff' } }).toFormat(format).toBuffer();
    const result = await new SharpPageThumbnailRenderer().render({ imageData, mimeType: `image/${format}` });
    expect(result.mimeType).toBe('image/webp');
  });
});
