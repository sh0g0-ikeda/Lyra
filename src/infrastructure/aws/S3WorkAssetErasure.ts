import { DeleteObjectCommand, GetBucketVersioningCommand, HeadObjectCommand, ListObjectVersionsCommand } from '@aws-sdk/client-s3';
import { ConfigurationError } from '../../domain/errors/index.js';
import type { WorkAssetErasurePort,WorkDeletionPrefix,WorkDeletionPrefixPage } from '../../services/work/WorkDeletionService.js';
type ErasureCommand=DeleteObjectCommand|GetBucketVersioningCommand|HeadObjectCommand|ListObjectVersionsCommand;
export interface WorkErasureS3Client { send(command:ErasureCommand,options?:{abortSignal:AbortSignal}):Promise<unknown> }
const MAX_VERSION_PAGES=8;
const MAX_VERSIONS_PER_ATTEMPT=100;
/** Only a committed, ownership-checked manifest may call this adapter. It never
 * deletes prefixes. Version history is removed for exactly the requested key;
 * any ambiguity, retention failure or post-delete reappearance stays pending. */
export class S3WorkAssetErasure implements WorkAssetErasurePort{
 public constructor(private readonly client:WorkErasureS3Client,private readonly bucket:string){}
 public async scanPrefix(input:WorkDeletionPrefix):Promise<WorkDeletionPrefixPage>{
  const uuid='[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
  const pattern=new RegExp(`^(?:(?:saved|session)/${uuid}/entities/${uuid}/|session/${uuid}/pages/${uuid}/|saved/${uuid}/pages/${uuid}_final\\.|exports/${uuid}/episodes/${uuid}/${uuid}\\.)$`,'u');
  if(input.prefix!=='saved/'&&input.prefix!=='session/'&&!pattern.test(input.prefix))throw blocked();
  if(input.cursor!==null&&(!input.cursor.key.startsWith(input.prefix)||!input.cursor.version))throw blocked();
  const value=record(await this.send(new ListObjectVersionsCommand({Bucket:this.bucket,Prefix:input.prefix,
    KeyMarker:input.cursor?.key,VersionIdMarker:input.cursor?.version,MaxKeys:200}),AbortSignal.timeout(15_000)));
  const keys=new Set<string>();
  for(const field of ['Versions','DeleteMarkers']){
    const items=value[field];if(items!==undefined&&!Array.isArray(items))throw blocked();
    for(const item of (items??[]) as unknown[]){const entry=record(item);if(typeof entry.Key!=='string'||!entry.Key.startsWith(input.prefix)||typeof entry.VersionId!=='string')throw blocked();keys.add(entry.Key);}
  }
  if(keys.size>200)throw blocked();
  if(value.IsTruncated!==true)return {keys:[...keys],next:null};
  if(typeof value.NextKeyMarker!=='string'||!value.NextKeyMarker.startsWith(input.prefix)||typeof value.NextVersionIdMarker!=='string'||!value.NextVersionIdMarker||
    (value.NextKeyMarker===input.cursor?.key&&value.NextVersionIdMarker===input.cursor?.version))throw blocked();
  return {keys:[...keys],next:{key:value.NextKeyMarker,version:value.NextVersionIdMarker}};
 }
 public async erase(key:string):Promise<void>{
  const signal=AbortSignal.timeout(15_000);
  if(!this.bucket || !key || key.length>1024 || key.startsWith('state-reference-v2/') || /[\\\s\x00-\x1f]/u.test(key) || key.split('/').some(part=>!part||part==='.'||part==='..'))throw blocked();
  const versioning=record(await this.send(new GetBucketVersioningCommand({Bucket:this.bucket}),signal));
  if(versioning.Status!==undefined && versioning.Status!=='Enabled' && versioning.Status!=='Suspended')throw blocked();
  if(versioning.Status===undefined){
   await this.send(new DeleteObjectCommand({Bucket:this.bucket,Key:key}),signal);
   try{await this.send(new HeadObjectCommand({Bucket:this.bucket,Key:key}),signal);}
   catch(error){if(status(error)===404)return;throw error;}
   throw blocked();
  }
  const versions=await this.versions(key,signal);
  for(const version of versions)await this.send(new DeleteObjectCommand({Bucket:this.bucket,Key:key,VersionId:version}),signal);
  if((await this.versions(key,signal)).length!==0)throw blocked();
 }
 private async versions(key:string,signal:AbortSignal):Promise<string[]>{
  let keyMarker:string|undefined;let versionMarker:string|undefined;
  const result:string[]=[];const seen=new Set<string>();
  for(let page=0;page<MAX_VERSION_PAGES;page++){
   const value=record(await this.send(new ListObjectVersionsCommand({Bucket:this.bucket,Prefix:key,KeyMarker:keyMarker,VersionIdMarker:versionMarker,MaxKeys:1000}),signal));
   for(const field of ['Versions','DeleteMarkers']){
    const items=value[field];if(items!==undefined && !Array.isArray(items))throw blocked();
    for(const item of (items??[]) as unknown[]){
     const entry=record(item);
     if(typeof entry.Key!=='string')throw blocked();
     if(entry.Key!==key)continue;
     if(typeof entry.VersionId!=='string'||entry.VersionId.length===0||entry.VersionId.length>1024||seen.has(entry.VersionId))throw blocked();
     seen.add(entry.VersionId);result.push(entry.VersionId);
     if(result.length>=MAX_VERSIONS_PER_ATTEMPT)return result;
    }
   }
   if(value.IsTruncated!==true)return result;
   if(typeof value.NextKeyMarker!=='string'||typeof value.NextVersionIdMarker!=='string'||(value.NextKeyMarker===keyMarker&&value.NextVersionIdMarker===versionMarker))throw blocked();
   keyMarker=value.NextKeyMarker;versionMarker=value.NextVersionIdMarker;
  }
  throw blocked();
 }
 private async send(command:ErasureCommand,signal:AbortSignal):Promise<unknown>{
  signal.throwIfAborted();
  return this.client.send(command,{abortSignal:signal});
 }
}
function record(value:unknown):Record<string,unknown>{
 if(value===null||typeof value!=='object'||Array.isArray(value))throw blocked();return value as Record<string,unknown>;
}
function status(error:unknown):number|undefined{
 if(error===null||typeof error!=='object')return undefined;
 const metadata=(error as Record<string,unknown>).$metadata;
 return metadata!==null&&typeof metadata==='object'&&typeof (metadata as Record<string,unknown>).httpStatusCode==='number'?(metadata as {httpStatusCode:number}).httpStatusCode:undefined;
}
function blocked():ConfigurationError{return new ConfigurationError('Work asset erasure could not be verified');}
