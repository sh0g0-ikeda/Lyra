import type { UiLanguage } from '@/domain/types';
import { imageAccessMessages } from '@/lib/imageAccessMessages';
export interface MobileImageProvenance {
  image_model?: unknown;
  provider_model_id?: unknown;
  provider?: unknown;
  mobile_access?: unknown;
}
export function canDisplayMobileImage(image?: MobileImageProvenance | null): boolean {
  if (image == null) return true;
  if (image.mobile_access !== undefined && image.mobile_access !== 'available') return false;
  if (image.image_model == null) return image.provider_model_id == null && image.provider == null;
  return (image.image_model === 'gpt-image-2' || image.image_model === 'gpt-image-1') && (image.provider == null || image.provider === 'openai') &&
    (image.provider_model_id == null || image.provider_model_id === image.image_model);
}
export function imageAccessNotice(language: UiLanguage): string {
  return imageAccessMessages[language].blocked;
}
