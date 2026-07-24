import type { LoadedStoredImage } from '../../infrastructure/aws/S3StoredImageLoader.js';

export interface RenderedPageThumbnail {
  imageData: Buffer;
  mimeType: 'image/webp';
}

export interface PageThumbnailRendererPort {
  render(image: LoadedStoredImage): Promise<RenderedPageThumbnail>;
}
