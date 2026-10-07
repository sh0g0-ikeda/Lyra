import { describe, expect, it } from 'vitest';
import { OpenAIClient } from '../../../../src/infrastructure/openai/OpenAIClient.js';
import { OpenAIEpisodeBeatPlanCompiler } from '../../../../src/infrastructure/openai/OpenAIEpisodeBeatPlanCompiler.js';
import { OpenAIPageEpisodePlanCompiler } from '../../../../src/infrastructure/openai/OpenAIPageEpisodePlanCompiler.js';
import { prepareEpisodeSourceRequirementExtraction, buildAuditCompatibilityPlanFromSourceRequirements } from '../../../../src/services/page/EpisodeSourceRequirements.js';

const PAGE='11111111-1111-4111-8111-111111111111';
const examples=[
  {source:'7ページ目：一度腰を下ろし、濡れた指先を見つめる。その後、絵本の表紙に描かれた光を見てゆっくり立ち上がる。くじけそうな表情から決意へ変わる過程を描く。',pageNumber:7,span:'くじけそうな表情から決意へ変わる過程を描く。',orders:[[3],[4],[3,4]]},
  {source:'8ページ目：矢印に沿って狭い岩の隙間を横向きで通り、出口へ進む。隙間の途中で絵本が引っかかりそうになり、胸へ寄せて向きを変える。狭い入口、通り抜ける体勢、出口の順に描く。',pageNumber:8,span:'狭い入口、通り抜ける体勢、出口の順に描く。',orders:[[3,4],[4],[3,4]]},
];
async function extract(example=examples[0]!,edge:'none'|'from'|'to'='none',kind='s') {
 const extraction=prepareEpisodeSourceRequirementExtraction({storyFullDraft:example.source,pages:[{pageId:PAGE,pageNumber:example.pageNumber}]})!;
 const units=extraction.units.map((unit,index)=>({unit,ordinal:index+1})).filter(x=>x.unit.text.trim());
 const records=units.map(({unit,ordinal},index)=>({i:ordinal,u:ordinal,k:index===2?kind:'e',ob:index===2?[]:[{e:unit.fragmentCatalog[0]!.id,r:null,c:null,z:true}],a:index===2&&edge==='to'?[2]:index===1&&edge==='from'?[3]:index===1&&example.pageNumber===7?[1]:[],x:[],q:[]}));
 const client={postJson:async()=>({body:{output_text:JSON.stringify({requirements:records},(key,value:unknown)=>kind==='missing'&&key==='k'?undefined:value)},requestId:'artificial-r58-span'})} as unknown as OpenAIClient;
 return new OpenAIEpisodeBeatPlanCompiler(client).compileSourceRequirements({extraction,language:'ja'});
}
describe('r58 spanning depiction と event completion の分離',()=>{
 it.each(examples)('$pageNumberページの総括は本文を保持して前後の同じ4コマを覆う',async example=>{
  const result=await extract(example);const rs=result.requirements.requirements;
  expect(rs[2]).toMatchObject({kind:'spanning_constraint',events:[],afterRequirementIds:[],context:example.span,requiredByEnd:true});
  expect(buildAuditCompatibilityPlanFromSourceRequirements([{pageId:PAGE,pageNumber:example.pageNumber}],result.requirements).pages[0]!.storyBeats.join(' ')).toContain(example.span);
  const client={postJson:async()=>({body:{output_text:JSON.stringify({source_requirement_placements:rs.map((r,i)=>({requirement_id:r.requirementId,page_id:PAGE,panel_orders:example.orders[i]})),pages:[{page_id:PAGE,page_number:example.pageNumber,panels:[1,2,3,4].map(order=>({order,entities:[]}))}]})},requestId:'artificial-r58-detail'})} as unknown as OpenAIClient;
  await expect(new OpenAIPageEpisodePlanCompiler(client).compilePlan({compilerBrief:example.source,language:'ja',sourceRequirements:result.requirements,sourceOwnedPageContext:true})).resolves.toBeDefined();
 });
 it.each(['from','to'] as const)('spanning constraintをafterの%s側へ置く出力はsource段階で拒否する',async edge=>{
  await expect(extract(examples[0],edge)).rejects.toThrow('Spanning source constraints cannot have temporal edges');
 });
 it.each(['unknown','g','missing'])('page分類%sは補正せず拒否する',async kind=>{await expect(extract(examples[0],'none',kind)).rejects.toThrow();});
 it.each(['from','to'] as const)('内部入力のspan edge %sもdetail paid call前に拒否する',async direction=>{
  const result=await extract();const rs=result.requirements.requirements;
  if(direction==='to')rs[2]!.afterRequirementIds=[rs[1]!.requirementId];else rs[1]!.afterRequirementIds=[rs[2]!.requirementId];
  let calls=0;const client={postJson:async()=>{calls++;throw new Error('must not call provider');}} as unknown as OpenAIClient;
  await expect(new OpenAIPageEpisodePlanCompiler(client).compilePlan({compilerBrief:examples[0]!.source,language:'ja',sourceRequirements:result.requirements})).rejects.toThrow('Spanning source constraints cannot have temporal edges');
  expect(calls).toBe(0);
 });
 it.each(['event', 'empty-context', 'not-required'] as const)('不整合span分類 %s はdetail paid call前に拒否する', async malformed => {
  const result = await extract();
  const span = result.requirements.requirements[2]!;
  if (malformed === 'event') span.events = [span.context!];
  if (malformed === 'empty-context') span.context = '';
  if (malformed === 'not-required') span.requiredByEnd = false;
  let calls = 0;
  const client = { postJson: async () => { calls++; throw new Error('must not call provider'); } } as unknown as OpenAIClient;
  await expect(new OpenAIPageEpisodePlanCompiler(client).compilePlan({
    compilerBrief: examples[0]!.source, language: 'ja', sourceRequirements: result.requirements,
  })).rejects.toThrow('Spanning source constraints must remain complete non-event obligations');
  expect(calls).toBe(0);
 });
 it('真のevent順序を逆転した4コマは拒否し取消checkpointを保持する',async()=>{
  const result=await extract();let calls=0;const cancelled=new Error('cancelled before placement retry');
  const client={postJson:async()=>{calls++;return{body:{output_text:JSON.stringify({source_requirement_placements:result.requirements.requirements.map((r,i)=>({requirement_id:r.requirementId,page_id:PAGE,panel_orders:i===0?[4]:i===1?[3]:[3,4]})),pages:[{page_id:PAGE,page_number:7,panels:[1,2,3,4].map(order=>({order,entities:[]}))}]})},requestId:'reverse'};}} as unknown as OpenAIClient;
  await expect(new OpenAIPageEpisodePlanCompiler(client).compilePlan({compilerBrief:examples[0]!.source,language:'ja',sourceRequirements:result.requirements,beforeRetry:async()=>{throw cancelled;}})).rejects.toBe(cancelled);
  expect(calls).toBe(1);
 });
});
