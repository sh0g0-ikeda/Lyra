import { afterEach, describe, expect, it, vi } from 'vitest';
import { entityReferenceImageDeliveryPath, entityReferenceCandidateDeliveryPath, mergeImageDeliveryMetadata, canReadWebImage } from '../../../apps/web/src/domain/imageDelivery.js';
// Load the real browser client at runtime; its own Web type gate validates its Vite module.
interface ImageExportClient {
  exportEntityReferenceImage(entityId: string, refId: string, organizationId: null, image: typeof restricted, enabled: boolean): Promise<unknown>;
  exportEntityReferenceCandidateImage(entityId: string, token: string, organizationId: null, image: typeof restricted, enabled: boolean): Promise<unknown>;
}
interface BrowserApiModule {
  LyraApiClient: new (getToken: () => null) => ImageExportClient;
}
const restricted = { image_model: 'hy4-preview', provider: 'tencent', mobile_access: 'web_only' };
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
describe('Web自由生成キャラの画像配信', () => {
  it('Hy4は能力を確認した専用Web口だけへ送り旧参照は共通口を保つ', () => {
    expect(entityReferenceImageDeliveryPath('entity', 'ref', {}, false)).toBe('/api/entities/entity/reference/ref/image');
    expect(entityReferenceImageDeliveryPath('entity', 'ref', restricted, true)).toBe('/api/web/entities/entity/reference/ref/image');
    expect(entityReferenceCandidateDeliveryPath('entity', restricted, true)).toBe('/api/web/entities/entity/reference-candidate-image');
    expect(() => entityReferenceImageDeliveryPath('entity', 'ref', restricted, false)).toThrow();
  });
  it('candidate側のnullや欠落でjobに固定されたHy4由来を消せない', () => {
    const image = mergeImageDeliveryMetadata(restricted, { image_model: null });
    expect(image.image_model).toBe('hy4-preview');
    expect(canReadWebImage(image, false)).toBe(false);
    expect(canReadWebImage(mergeImageDeliveryMetadata(restricted, { image_model: 'gpt-image-2' }), true)).toBe(false);
  });
  it('Web能力がOFFなら既知Hy4の参照と候補はHTTP要求もfallbackもゼロになる', async () => {
    const fetcher = vi.fn(async () => new Response()); globalThis.fetch = fetcher;
    const browserModulePath = '../../../apps/web/src/lib/api.js';
    const { LyraApiClient } = await import(browserModulePath) as BrowserApiModule;
    const api = new LyraApiClient(() => null);
    await expect(api.exportEntityReferenceImage('entity', 'ref', null, restricted, false)).rejects.toThrow();
    await expect(api.exportEntityReferenceCandidateImage('entity', 'token', null, restricted, false)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
