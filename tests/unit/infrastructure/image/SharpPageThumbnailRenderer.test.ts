import {describe,expect,it} from 'vitest';
import sharp from 'sharp';
import {SharpPageThumbnailRenderer} from '../../../../src/infrastructure/image/SharpPageThumbnailRenderer.js';
describe('WebP thumbnails',()=>{
 it.each([[640,960,320,480],[20,30,20,30]])('縦横比を保ち拡大しない %j',async(width,height,expectedWidth,expectedHeight)=>{
  const imageData=await sharp({create:{width,height,channels:3,background:'#eee'}}).png().toBuffer();
  const rendered=await new SharpPageThumbnailRenderer().render({imageData,mimeType:'image/png'});
  expect(rendered.mimeType).toBe('image/webp');expect(await sharp(rendered.imageData).metadata()).toMatchObject({format:'webp',width:expectedWidth,height:expectedHeight});
 });
 it('壊れた画像は安定したerrorで拒否する',async()=>{await expect(new SharpPageThumbnailRenderer().render({imageData:Buffer.from('invalid'),mimeType:'image/png'})).rejects.toMatchObject({code:'CONFIGURATION_ERROR'});});
});
