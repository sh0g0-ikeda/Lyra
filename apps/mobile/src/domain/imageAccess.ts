import type { UiLanguage } from '@/domain/types';
import { imageAccessMessages } from '@/lib/imageAccessMessages';
export interface MobileImageProvenance {
  image_model?: unknown;
  provider_model_id?: unknown;
  provider?: unknown;
  mobile_access?: unknown;
}

const SUNBURST_DISPLAY_MODEL = 'gpt-image-2.5-sunburst';
const SUNBURST_PROVIDER = 'openai';
const SUNBURST_PINNED_SNAPSHOT = 'gpt-image-2.5-sunburst-2026-09-08';

// OTA compatibility design: preserve the 1.0.11 native decoder boundary. A
// Sunburst descriptor is displayable only when the server attests its public
// display model, OpenAI provider, immutable snapshot, and mobile permission.
// Missing or changed provenance is never treated as an older GPT image.
function isVerifiedSunburstImage(image: MobileImageProvenance): boolean {
  return image.image_model === SUNBURST_DISPLAY_MODEL &&
    image.provider === SUNBURST_PROVIDER &&
    image.provider_model_id === SUNBURST_PINNED_SNAPSHOT &&
    image.mobile_access === 'available';
}

export function canDisplayMobileImage(image?: MobileImageProvenance | null): boolean {
  if (image == null) return true;
  if (image.image_model === SUNBURST_DISPLAY_MODEL) return isVerifiedSunburstImage(image);
  if (image.mobile_access !== undefined && image.mobile_access !== 'available') return false;
  if (image.image_model == null) return image.provider_model_id == null && image.provider == null;
  return (image.image_model === 'gpt-image-2' || image.image_model === 'gpt-image-1') && (image.provider == null || image.provider === 'openai') &&
    (image.provider_model_id == null || image.provider_model_id === image.image_model);
}
export function imageAccessNotice(language: UiLanguage): string {
  return imageAccessMessages[language].blocked;
}
