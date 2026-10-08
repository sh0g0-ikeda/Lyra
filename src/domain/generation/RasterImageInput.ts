import { ConfigurationError } from '../errors/index.js';

// Match the existing export ceiling so valid saved pages remain usable.
export const STORED_RASTER_IMAGE_MAX_BYTES = 20 * 1024 * 1024;
export const STORED_RASTER_IMAGE_MAX_PIXELS = 40_000_000;
export type RasterImageMimeType = 'image/png' | 'image/jpeg' | 'image/webp';

export function assertRasterImageInput(bytes: Buffer, claimedMimeType?: string): RasterImageMimeType {
  if (bytes.length === 0 || bytes.length > STORED_RASTER_IMAGE_MAX_BYTES) {
    throw new ConfigurationError('Stored image size is invalid');
  }
  const mimeType = bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    ? 'image/png'
    : bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
      ? 'image/jpeg'
      : bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP'
        ? 'image/webp' : null;
  if (mimeType === null || (claimedMimeType !== undefined && claimedMimeType !== mimeType)) {
    throw new ConfigurationError('Stored image bytes do not match a supported raster image format');
  }
  return mimeType;
}
