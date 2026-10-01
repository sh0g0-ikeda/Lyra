import { AppError, ForbiddenError } from '../errors/index.js';

/** Server-owned output metadata, independent from model/quality selection. */
export interface ImageProvenance {
  imageModel?: string | null;
  providerModelId?: string | null;
  provider?: string | null;
}
export type ImageMobileAccess = 'available' | 'web_only' | 'unavailable';
export type ImageDeliveryAudience = 'mobile' | 'authorized_web';

export function imageMobileAccess(image: ImageProvenance): ImageMobileAccess {
  const model = image.imageModel;
  if (model == null) {
    return image.providerModelId == null && image.provider == null ? 'available' : 'unavailable';
  }
  if ((model === 'gpt-image-2' || model === 'gpt-image-1') && (image.provider == null || image.provider === 'openai')
    && (image.providerModelId == null || image.providerModelId === model)) return 'available';
  if (model === 'hy4-preview' && (image.provider == null || image.provider === 'tencent')
    && (image.providerModelId == null || image.providerModelId === model)) return 'web_only';
  return 'unavailable';
}

export function assertImageDeliveryAllowed(image: ImageProvenance, audience: ImageDeliveryAudience = 'mobile'): void {
  const access = imageMobileAccess(image);
  if (access === 'available' || (access === 'web_only' && audience === 'authorized_web')) return;
  throw new AppError(access === 'web_only' ? 'IMAGE_WEB_ONLY' : 'IMAGE_MODEL_UNAVAILABLE',
    access === 'web_only' ? 'This image is available on Lyra web only' : 'This image model is unavailable', 403);
}

/** Only a client ID extracted from a successfully verified token may be passed. */
export function requireAuthorizedWebImageClient(clientId: string | undefined, allowlist: readonly string[]): void {
  if (clientId === undefined || clientId.length === 0 || !allowlist.includes(clientId)) {
    throw new ForbiddenError('This image delivery endpoint requires an authorized web session');
  }
}

export function readImageProvenance(value: unknown): ImageProvenance {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  const result: ImageProvenance = {};
  for (const [persisted, domain] of [['image_model', 'imageModel'], ['provider_model_id', 'providerModelId'], ['provider', 'provider']] as const) {
    if (!Object.prototype.hasOwnProperty.call(record, persisted)) continue;
    const entry = record[persisted];
    result[domain] = entry === null ? null
      : typeof entry === 'string' && entry.trim().length > 0 && entry.length <= 200 ? entry : 'unknown';
  }
  return result;
}

export function toImageProvenanceRecord(image: ImageProvenance): Record<string, string | null> {
  return {
    ...(image.imageModel === undefined ? {} : { image_model: image.imageModel }),
    ...(image.providerModelId === undefined ? {} : { provider_model_id: image.providerModelId }),
    ...(image.provider === undefined ? {} : { provider: image.provider }),
  };
}

export function publicImageProvenance(image: ImageProvenance): Record<string, string | null> {
  const record = toImageProvenanceRecord(image);
  return Object.keys(record).length === 0 ? {} : { ...record, mobile_access: imageMobileAccess(image) };
}

/** A null/missing result cannot erase a pinned restriction; conflicts are unknown. */
export function readGenerationImageProvenance(params: unknown, result: unknown): ImageProvenance {
  const pinned = readImageProvenance(params);
  const actual = readImageProvenance(result);
  const combined: ImageProvenance = {};
  for (const field of ['imageModel', 'providerModelId', 'provider'] as const) {
    const expected = pinned[field]; const returned = actual[field];
    if (expected === undefined && returned === undefined) continue;
    combined[field] = expected != null && returned != null && expected !== returned
      ? 'unknown' : returned ?? expected ?? null;
  }
  return combined;
}
