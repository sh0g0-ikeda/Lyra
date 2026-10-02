import { describe,expect,it } from 'vitest';
import { pageImageDeliveryPath, canReadWebImage } from '../../../apps/web/src/domain/imageDelivery.js';
describe('Web画像専用配信',()=>{
 it.each([undefined,null,{}, {image_model:null},{image_model:'gpt-image-1',provider:'openai',provider_model_id:'gpt-image-1'},{image_model:'gpt-image-2',provider:'openai'}])('旧GPT画像は既存配信口を保持する (%j)',image=>expect(pageImageDeliveryPath('page',image,false)).toBe('/api/pages/page/export-image'));
 it('既知Web限定modelとserver能力が揃う場合だけ専用配信口を選ぶ',()=>{
  const image={image_model:'hy4-preview',mobile_access:'web_only'};
  expect(pageImageDeliveryPath('page',image,true)).toBe('/api/web/pages/page/image');
  expect(()=>pageImageDeliveryPath('page',image,false)).toThrow();
  expect(()=>pageImageDeliveryPath('page',image,undefined)).toThrow();
 });
 it.each([{image_model:'unknown'},{image_model:42},{image_model:'gpt-image-2',provider:'other'},{mobile_access:'web_only'}])('未知metadataは能力があっても配信しない (%j)',image=>expect(canReadWebImage(image,true)).toBe(false));
});
