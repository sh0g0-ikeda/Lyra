export interface ImageDeliveryMetadata {
  image_model?: unknown; provider_model_id?: unknown; provider?: unknown; mobile_access?: unknown;
}
function delivery(image?: ImageDeliveryMetadata | null): 'ordinary' | 'web' | 'blocked' {
  if (image == null) return 'ordinary';
  if (image.mobile_access !== undefined && !['available','web_only'].includes(String(image.mobile_access))) return 'blocked';
  if (image.image_model == null) return image.mobile_access !== 'web_only' && image.provider == null && image.provider_model_id == null ? 'ordinary' : 'blocked';
  if ((image.image_model === 'gpt-image-2' || image.image_model === 'gpt-image-1') && image.mobile_access !== 'web_only' && (image.provider == null || image.provider === 'openai') && (image.provider_model_id == null || image.provider_model_id === image.image_model)) return 'ordinary';
  if (image.image_model === 'hy4-preview' && (image.provider == null || image.provider === 'tencent') && (image.provider_model_id == null || image.provider_model_id === 'hy4-preview')) return 'web';
  return 'blocked';
}
export function canReadWebImage(image?: ImageDeliveryMetadata | null, webDeliveryEnabled?: boolean): boolean {
  const kind=delivery(image);
  return kind==='ordinary' || (kind==='web' && webDeliveryEnabled===true);
}
export function pageImageDeliveryPath(pageId:string,image?:ImageDeliveryMetadata|null,webDeliveryEnabled?:boolean):string {
  const kind=delivery(image);
  if (!canReadWebImage(image,webDeliveryEnabled)) throw new Error('Image delivery is unavailable for this session');
  return kind==='web' ? `/api/web/pages/${encodeURIComponent(pageId)}/image` : `/api/pages/${encodeURIComponent(pageId)}/export-image`;
}
export function imageDeliveryNotice(language:'ja'|'en'):string {
  return language==='ja' ? 'このセッションでは、この画像を表示・保存できません。作品やページの編集は続けられます。' : 'This image cannot be viewed or saved in this session. You can continue editing the work and page.';
}
