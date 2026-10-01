import { describe, expect, it } from 'vitest';
import { imageMobileAccess, readImageProvenance, readGenerationImageProvenance, toImageProvenanceRecord, assertImageDeliveryAllowed, requireAuthorizedWebImageClient } from '../../../../src/domain/generation/ImageAccessPolicy.js';

describe('画像由来と配信境界', () => {
  it.each([{}, { imageModel: null }, {imageModel:'gpt-image-1',provider:'openai',providerModelId:'gpt-image-1'}, { imageModel: 'gpt-image-2' }, { imageModel: 'gpt-image-2', provider: 'openai', providerModelId: 'gpt-image-2' }])('旧metadataまたは既知GPTはMobile互換 (%j)', (value) => {
    expect(imageMobileAccess(value)).toBe('available');
    expect(() => assertImageDeliveryAllowed(value)).not.toThrow();
  });
  it('Hy4画像はWebに限定し未対応モデルをGPTへ代替しない', () => {
    expect(imageMobileAccess({ imageModel: 'hy4-preview' })).toBe('web_only');
    expect(() => assertImageDeliveryAllowed({ imageModel: 'hy4-preview' })).toThrow();
    expect(() => assertImageDeliveryAllowed({ imageModel: 'hy4-preview' }, 'authorized_web')).not.toThrow();
    expect(() => assertImageDeliveryAllowed({ imageModel: 'unknown-model' }, 'authorized_web')).toThrow();
  });
  it.each([{image_model:'new-model'},{image_model:42},{image_model:''},{image_model:'gpt-image-2',provider:'other'},{provider_model_id:'hy4-preview'}])('未知または壊れた明示metadataを旧画像に戻さない (%j)', (value) => {
    expect(imageMobileAccess(readImageProvenance(value))).toBe('unavailable');
  });
  it('由来metadataを読書きしても欠落と明示値を維持する', () => {
    expect(toImageProvenanceRecord(readImageProvenance({}))).toEqual({});
    expect(toImageProvenanceRecord(readImageProvenance({image_model:'hy4-preview',provider:'tencent',provider_model_id:'hy4-preview'}))).toEqual({image_model:'hy4-preview',provider:'tencent',provider_model_id:'hy4-preview'});
  });
  it.each([undefined, '', 'mobile-client', 'unknown-client'])('許可された署名済みWeb client以外は拒否する (%s)', (clientId) => {
    expect(() => requireAuthorizedWebImageClient(clientId, ['web-client'])).toThrow();
  });
  it('明示server許可リストにある認証済みWeb clientだけ許可する', () => {
    expect(() => requireAuthorizedWebImageClient('web-client', ['web-client'])).not.toThrow();
    expect(() => requireAuthorizedWebImageClient('web-client', [])).toThrow();
  });
});


it('固定modelと実出力modelが矛盾する場合はどの配信口でも拒否する',()=>{
 const provenance=readGenerationImageProvenance({image_model:'hy4-preview'},{image_model:'gpt-image-2'});
 expect(imageMobileAccess(provenance)).toBe('unavailable');
 expect(()=>assertImageDeliveryAllowed(provenance,'authorized_web')).toThrow();
});
