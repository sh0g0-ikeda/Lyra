import { describe, expect, it } from 'vitest';
import { DeleteObjectCommand, GetBucketVersioningCommand, HeadObjectCommand, ListObjectVersionsCommand } from '@aws-sdk/client-s3';
import { S3WorkAssetErasure } from '../../../../src/infrastructure/aws/S3WorkAssetErasure.js';
describe('作品画像の完全消去',()=>{
 it('versioned bucketで対象keyの旧versionも消し隣接keyを残す',async()=>{
   const deleted: string[]=[]; let listed=0;
   const storage=new S3WorkAssetErasure({send:async(command)=>{
     if(command instanceof GetBucketVersioningCommand)return {Status:'Enabled'};
     if(command instanceof ListObjectVersionsCommand){listed++;return listed===1?{Versions:[{Key:'saved/a.png',VersionId:'v1'},{Key:'saved/a.png-extra',VersionId:'foreign'}],DeleteMarkers:[{Key:'saved/a.png',VersionId:'v2'}]}:{};}
     if(command instanceof DeleteObjectCommand){deleted.push(command.input.VersionId!);return {};}
     throw new Error('unexpected');
   }},'bucket');
   await storage.erase('saved/a.png'); expect(deleted).toEqual(['v1','v2']);
 });
 it('非versioned bucketは削除後の不在を確認する',async()=>{
   let removed=false;
   const storage=new S3WorkAssetErasure({send:async(command)=>{
     if(command instanceof GetBucketVersioningCommand)return {};
     if(command instanceof DeleteObjectCommand){removed=true;return {};}
     if(command instanceof HeadObjectCommand)throw {$metadata:{httpStatusCode:404}};
     throw new Error('unexpected');
   }},'bucket');
   await storage.erase('saved/a.png');expect(removed).toBe(true);
 });
 it('削除後にもobjectがある場合に完了しない',async()=>{
   const storage=new S3WorkAssetErasure({send:async()=>({})},'bucket');
   await expect(storage.erase('saved/a.png')).rejects.toThrow();
 });
 it('v2画像を通常DeleteObjectへ送らない',async()=>{
   let calls=0;
   const storage=new S3WorkAssetErasure({send:async()=>{calls++;return {};}},'bucket');
   await expect(storage.erase('state-reference-v2/a/image.png')).rejects.toThrow();expect(calls).toBe(0);
 });

 it('所有prefixからcurrentでない旧versionとdelete-markerだけのkeyも列挙する',async()=>{
  const prefix='saved/11111111-1111-4111-8111-111111111111/entities/22222222-2222-4222-8222-222222222222/';
  const storage=new S3WorkAssetErasure({send:async command=>{expect(command).toBeInstanceOf(ListObjectVersionsCommand);return {Versions:[{Key:prefix+'old.png',VersionId:'old',IsLatest:false}],DeleteMarkers:[{Key:prefix+'deleted.png',VersionId:'marker'}],IsTruncated:true,NextKeyMarker:prefix+'old.png',NextVersionIdMarker:'old'};}},'bucket');
  expect(await storage.scanPrefix({prefix,cursor:null})).toEqual({keys:[prefix+'old.png',prefix+'deleted.png'],next:{key:prefix+'old.png',version:'old'}});
 });
 it('任意prefixや別prefixのlist結果では消去manifestを作らない',async()=>{
  let calls=0;const storage=new S3WorkAssetErasure({send:async()=>{calls++;return {Versions:[{Key:'foreign/key',VersionId:'v1'}]};}},'bucket');
  await expect(storage.scanPrefix({prefix:'saved/arbitrary/',cursor:null})).rejects.toThrow();expect(calls).toBe(0);
  await expect(storage.scanPrefix({prefix:'saved/11111111-1111-4111-8111-111111111111/entities/22222222-2222-4222-8222-222222222222/',cursor:null})).rejects.toThrow();
 });
});
