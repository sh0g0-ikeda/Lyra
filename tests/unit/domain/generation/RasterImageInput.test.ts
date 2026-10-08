import { describe, expect, it } from 'vitest';
import { assertRasterImageInput, STORED_RASTER_IMAGE_MAX_BYTES } from '../../../../src/domain/generation/RasterImageInput.js';

const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
describe('保存画像のdecoder入力検証', () => {
  it.each([Buffer.from('<svg/>'), Buffer.from('0000ftypavif'), Buffer.alloc(0), Buffer.alloc(STORED_RASTER_IMAGE_MAX_BYTES + 1)])('未対応形式・空・過大な画像の場合に拒否する', (bytes) => {
    expect(() => assertRasterImageInput(bytes, 'image/png')).toThrow();
  });
  it('実画像とContent-Typeが異なる場合に拒否する', () => {
    expect(() => assertRasterImageInput(png, 'image/jpeg')).toThrow();
  });
  it('既存の20MiB境界以下のPNGの場合に許可する', () => {
    const bytes = Buffer.alloc(STORED_RASTER_IMAGE_MAX_BYTES);
    png.copy(bytes);
    expect(assertRasterImageInput(bytes, 'image/png')).toBe('image/png');
  });
});
