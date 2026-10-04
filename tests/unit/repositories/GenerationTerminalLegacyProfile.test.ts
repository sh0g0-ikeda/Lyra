import type { QueryResult, QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';
import type { DatabaseClient, TransactionRunner } from '../../../src/lib/db.js';
import { PostgresGenerationJobRepository } from '../../../src/repositories/GenerationJobRepository.js';
import { PostgresPageGenerationExecutionRepository } from '../../../src/repositories/PageGenerationExecutionRepository.js';
import { PostgresEntityGenerationExecutionRepository } from '../../../src/repositories/EntityGenerationExecutionRepository.js';
import { PostgresEpisodeStoryAutofillExecutionRepository } from '../../../src/repositories/EpisodeStoryAutofillExecutionRepository.js';
import { PostgresEpisodePageSkeletonExecutionRepository } from '../../../src/repositories/EpisodePageSkeletonExecutionRepository.js';
import { enqueueTerminalGenerationJobNotificationAfterRegistryLock } from '../../../src/repositories/PushNotificationOutboxRepository.js';

/** Spec 11: migration0の旧034 triggerがterminal UPDATEと同txで唯一の通知を作る。
 * profileはctorからhelperまで明示。旧retryは通知世代/canceled deliveryへ触れない。
 * canonical既定とtransaction/取消/保存境界は維持し、runtime選択は別gateで検証する。 */
class CapturingDatabase implements DatabaseClient, TransactionRunner {
  public queries: string[]=[];
  public constructor(private readonly legacy=true) {}
  public async query<Row extends QueryResultRow=QueryResultRow>(text: string): Promise<QueryResult<Row>> {
    this.queries.push(text);
    if(this.legacy && /INSERT INTO mobile_push_notification_outbox|generation_retry_count|SET status = 'canceled'/u.test(text)) {
      throw new Error('Legacy schema cannot execute canonical delivery SQL');
    }
    return {command:'UPDATE',rowCount:1,oid:0,fields:[],rows:[jobRow()] as unknown as Row[]};
  }
  public async transaction<T>(work:(client:DatabaseClient)=>Promise<T>):Promise<T>{ return work(this); }
}
function jobRow(): QueryResultRow {
  return {id:'job-1',user_id:'user-1',organization_id:null,job_type:'entity_generate',status:'failed',generation_mode:null,
    credit_cost:1,params:{entity_id:'entity-1'},result:{},sqs_message_id:null,openai_request_id:null,error_message:null,retry_count:0,
    created_at:new Date(),started_at:null,completed_at:null,expires_at:null,cancel_requested_at:null,cancel_requested_by:null,cancelled_at:null,commit_started_at:null};
}
describe('旧schemaのterminal notification所有権',()=>{
  it('legacy helperは既存triggerへ通知所有権を残してcanonical INSERTを実行しない',async()=>{
    const client=new CapturingDatabase();
    expect(await enqueueTerminalGenerationJobNotificationAfterRegistryLock(client,{id:'job-1',user_id:'user-1',organization_id:null,cancel_requested_at:null,cancelled_at:null,retry_count:0},'failed','legacy_2debe_v1')).toBeNull();
    expect(client.queries).toEqual([]);
  });
  const cases=[
    ['job',async(client:CapturingDatabase)=>new PostgresGenerationJobRepository(client,'legacy_2debe_v1').markFailed('job-1','failure')],
    ['page',async(client:CapturingDatabase)=>new PostgresPageGenerationExecutionRepository(client,'legacy_2debe_v1').failPageGeneration({jobId:'job-1',userId:'user-1',errorMessage:'failure'})],
    ['entity',async(client:CapturingDatabase)=>new PostgresEntityGenerationExecutionRepository(client,'legacy_2debe_v1').failEntityGeneration({jobId:'job-1',userId:'user-1',errorMessage:'failure'})],
    ['autofill',async(client:CapturingDatabase)=>new PostgresEpisodeStoryAutofillExecutionRepository(client,'legacy_2debe_v1').failEpisodeStoryAutofill({jobId:'job-1',userId:'user-1',errorMessage:'failure'})],
    ['skeleton',async(client:CapturingDatabase)=>new PostgresEpisodePageSkeletonExecutionRepository(client,'legacy_2debe_v1').failEpisodePageSkeleton({jobId:'job-1',userId:'user-1',errorMessage:'failure'})],
  ] as const;
  it.each(cases)('%sのlegacy失敗処理が同一txでjobを終端し新outboxへ触れない',async(_label,settle)=>{
    const client=new CapturingDatabase(); expect(await settle(client)).toBe(true);
    expect(client.queries.some(sql=>sql.includes('pg_advisory_xact_lock'))).toBe(true);
    expect(client.queries.some(sql=>sql.includes('UPDATE generation_jobs'))).toBe(true);
  });
  it('legacy retryは旧一件通知を変更せずfailed jobを再投入する',async()=>{
    const client=new CapturingDatabase();
    expect(await new PostgresGenerationJobRepository(client,'legacy_2debe_v1').prepareRetry('job-1',2)).toBe(true);
    expect(client.queries.some(sql=>sql.includes('retry_count = retry_count + 1'))).toBe(true);
  });
  it('既定canonical retryは旧schemaへ黙ってfallbackしない',async()=>{
    const client=new CapturingDatabase(false);
    expect(await new PostgresGenerationJobRepository(client).prepareRetry('job-1',2)).toBe(true);
    expect(client.queries.some(sql=>sql.includes('generation_retry_count'))).toBe(true);
  });
});
