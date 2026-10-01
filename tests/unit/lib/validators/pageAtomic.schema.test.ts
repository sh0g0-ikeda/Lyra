import {describe,expect,it} from 'vitest';
import {saveAndGeneratePageBodySchema} from '../../../../src/lib/validators/page.schema.js';
const id='11111111-1111-4111-8111-111111111111';
const body={expected_updated_at:'2026-10-01T12:00:00.000Z',page:{},panels:[{id,order:1,entities:[]}],frames:[{panel_id:id,reading_order:1,vertices:[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}]}],generation:{language:'ja'}};
describe('atomic page generation compatibility schema',()=>{
 it('本番payloadを受け入れ追加render_styleを保持する',()=>{
  expect(saveAndGeneratePageBodySchema.parse(body).generation.render_style).toBe('color');
  expect(saveAndGeneratePageBodySchema.parse({...body,generation:{language:'en',render_style:'monochrome'}}).generation.render_style).toBe('monochrome');
 });
 it('不正revision、重複・欠落panel、frame対応なし、過大payloadを拒否する',()=>{
  expect(saveAndGeneratePageBodySchema.safeParse({...body,expected_updated_at:'old'}).success).toBe(false);
  expect(saveAndGeneratePageBodySchema.safeParse({...body,panels:[body.panels[0],body.panels[0]]}).success).toBe(false);
  expect(saveAndGeneratePageBodySchema.safeParse({...body,frames:[]}).success).toBe(false);
  expect(saveAndGeneratePageBodySchema.safeParse({...body,frames:[{...body.frames[0],panel_id:'22222222-2222-4222-8222-222222222222'}]}).success).toBe(false);
  expect(saveAndGeneratePageBodySchema.safeParse({...body,panels:Array.from({length:21},()=>body.panels[0])}).success).toBe(false);
 });
});
