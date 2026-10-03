import { describe, expect, it } from 'vitest';
import { canDisplayMobileImage, imageAccessNotice } from '@/domain/imageAccess';
describe('Mobile output image provenance',()=>{
 it.each([undefined,null,{}, {image_model:null},{image_model:'gpt-image-1',provider:'openai',provider_model_id:'gpt-image-1'},{image_model:'gpt-image-2',provider:'openai',provider_model_id:'gpt-image-2'}])('legacy and verified GPT remain visible (%j)',image=>expect(canDisplayMobileImage(image)).toBe(true));
 it.each([{image_model:'hy4-preview'},{image_model:'future-model'},{image_model:42},{image_model:''},{image_model:'gpt-image-2',provider:'tencent'},{mobile_access:'web_only'},{mobile_access:'unknown'},{provider_model_id:'hy4-preview'}])('explicit unsupported metadata never falls back (%j)',image=>expect(canDisplayMobileImage(image)).toBe(false));
 it('uses the specified Japanese notice and a complete English message',()=>{
  expect(imageAccessNotice('ja')).toBe('このページはアプリでは表示できません。一部のコンテンツはweb版でのみ利用できます');
  expect(imageAccessNotice('en')).toContain('Lyra on the web');
 });
});
