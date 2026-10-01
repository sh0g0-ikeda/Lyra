import sharp from 'sharp';
import { ConfigurationError } from '../../domain/errors/index.js';
import type { LoadedStoredImage } from '../aws/S3StoredImageLoader.js';
import type {
  PageThumbnailRendererPort,
  RenderedPageThumbnail,
} from '../../services/page/PageThumbnailRenderer.js';

const THUMBNAIL_MAX_WIDTH = 320;
const THUMBNAIL_MAX_HEIGHT = 480;
const THUMBNAIL_MAX_INPUT_PIXELS = 40_000_000;

export class SharpPageThumbnailRenderer implements PageThumbnailRendererPort {
  public async render(image: LoadedStoredImage): Promise<RenderedPageThumbnail> {
    try {
      const imageData = await sharp(image.imageData, {
        failOn: 'error',
        limitInputPixels: THUMBNAIL_MAX_INPUT_PIXELS,
      })
        .rotate()
        .resize({
          width: THUMBNAIL_MAX_WIDTH,
          height: THUMBNAIL_MAX_HEIGHT,
          fit: 'inside',
          withoutEnlargement: true,
          kernel: sharp.kernel.lanczos3,
        })
        .webp({
          quality: 72,
          effort: 4,
        })
        .toBuffer();

      return {
        imageData,
        mimeType: 'image/webp',
      };
    } catch {
      throw new ConfigurationError('Failed to render page thumbnail');
    }
  }
}
