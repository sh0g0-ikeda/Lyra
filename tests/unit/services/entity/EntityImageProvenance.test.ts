import { describe,expect,it,vi } from 'vitest';
import { resolveEntityImageProvenance } from '../../../../src/services/entity/EntityImageProvenance.js';
const jobId='11111111-1111-4111-8111-111111111111';const key=`session/user/entities/entity/${jobId}-0.png`;
const job={id:jobId,userId:'user',organizationId:null,jobType:'entity_generate',status:'completed',params:{entity_id:'entity'},result:{image_model:'hy4-preview',candidates:[{s3_key:key}]}};
const input=(value:unknown=job)=>({userId:'user',entityId:'entity',organizationId:null,s3Key:key,references:[],jobs:{findByIdAndUserId:vi.fn().mockResolvedValue(value)}});
describe('candidate output provenance',()=>{
 it('署名tokenやraw key経由でも実際の完了jobから由来を読む',async()=>{expect(await resolveEntityImageProvenance(input())).toEqual({imageModel:'hy4-preview'});});
 it.each([null,{...job,status:'processing'},{...job,params:{entity_id:'different'}},{...job,result:{image_model:'gpt-image-2',candidates:[]}},{...job,params:{entity_id:'entity',target:'entity_state'}}])('不一致や状態専用candidateは基本参照口から読まない (%j)',async(value)=>{await expect(resolveEntityImageProvenance(input(value))).rejects.toThrow();});
 it('resultのnullは固定済みWeb限定modelを旧画像へ戻さない',async()=>{expect(await resolveEntityImageProvenance(input({...job,params:{...job.params,image_model:'hy4-preview'},result:{...job.result,image_model:null}}))).toEqual({imageModel:'hy4-preview'});});
 it('古い実在jobのmetadata欠落は旧GPT互換として残す',async()=>{expect(await resolveEntityImageProvenance(input({...job,result:{candidates:[{s3_key:key}]}}))).toEqual({});});
 it('アップロードはproviderを推測せず既存確定参照は由来を保つ',async()=>{const request=input();expect(await resolveEntityImageProvenance({...request,s3Key:'tmp/user/entities/imports/upload.png'})).toEqual({});expect(request.jobs.findByIdAndUserId).not.toHaveBeenCalled();});
});
