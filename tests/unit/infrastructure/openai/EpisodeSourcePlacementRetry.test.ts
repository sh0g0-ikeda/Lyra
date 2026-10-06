import {describe, expect, it} from 'vitest';
import {ConfigurationError} from '../../../../src/domain/errors/index.js';
import {OpenAIClient} from '../../../../src/infrastructure/openai/OpenAIClient.js';
import {OpenAIPageEpisodePlanCompiler} from '../../../../src/infrastructure/openai/OpenAIPageEpisodePlanCompiler.js';
import type {CompileEpisodePagePlanInput} from '../../../../src/services/page/EpisodePagePlanCompiler.js';

const PAGE='11111111-1111-4111-8111-111111111111';
const NEXT_PAGE='22222222-2222-4222-8222-222222222222';
const common={scope:'page' as const,pageId:PAGE,pageNumber:1,results:[],conditionalUntil:null,requiredByEnd:true,context:null,emotion:null,function:null,camera:null,framing:null,quotedText:[]};
const requirements={requirements:[
  {...common,requirementId:'p1-u1-r1',sourceUnitIds:['p1-u1'],order:1,events:['扉を開く'],afterRequirementIds:[]},
  {...common,requirementId:'p1-u2-r2',sourceUnitIds:['p1-u2'],order:2,events:['中へ入る'],afterRequirementIds:['p1-u1-r1']},
]};
const base:CompileEpisodePagePlanInput={compilerBrief:'[FULL STORY DRAFT - SOURCE DATA]\n1ページ目：扉を開いてから中へ入る。',language:'ja',sourceOwnedPageContext:true,sourceRequirements:requirements,sourceRequirementPlacementPageIds:[PAGE]};
function response(reversed:boolean): {body:{output_text:string};requestId:string} {
  return {body:{output_text:JSON.stringify({
    source_requirement_placements:[
      {requirement_id:'p1-u1-r1',page_id:PAGE,panel_orders:[reversed?4:1]},
      {requirement_id:'p1-u2-r2',page_id:PAGE,panel_orders:[2,3,4]},
    ],pages:[{page_id:PAGE,page_number:1,page_purpose:reversed?'provider-prose-sentinel':null,panels:[1,2,3,4].map(order=>({order,entities:[]}))}],
  })},requestId:'req-placement'};
}
function compiler(responses:ReturnType<typeof response>[],requests:Array<Record<string,unknown>>):OpenAIPageEpisodePlanCompiler{
  const client={postJson:async (_path:string,payload:Record<string,unknown>)=>{
    requests.push(payload);return responses[Math.min(requests.length-1,responses.length-1)]!;
  }} as unknown as OpenAIClient;
  return new OpenAIPageEpisodePlanCompiler(client);
}
describe('コマの前後矛盾だけを既存の試行上限内で修正する',()=>{
  it('1回目の配置が逆転した場合は停止確認後に同じ原文を再送して正しい配置を返す',async()=>{
    const requests:Array<Record<string,unknown>>=[];let checkpoints=0;
    const result=await compiler([response(true),response(false)],requests).compilePlan({...base,beforeRetry:async()=>{checkpoints+=1;}});
    expect(result.suggestion.pages).toHaveLength(1);expect(requests).toHaveLength(2);expect(checkpoints).toBe(1);
    expect(requests[1]?.text).toEqual(requests[0]?.text);expect(requests[1]?.max_output_tokens).toEqual(requests[0]?.max_output_tokens);
    const inputs=requests.map(request=>(request.input as Array<{content:Array<{text:string}>}>)[1]!.content[0]!.text);
    expect(inputs[1]).toContain(inputs[0]!);expect(inputs[1]).toContain('p1-u1-r1');expect(inputs[1]).toContain('p1-u2-r2');
    expect(inputs[1]).not.toContain('provider-prose-sentinel');
    const correction=inputs[1]!.split('[PLACEMENT CORRECTION - SERVER DATA]\n')[1]!.split('\n')[0]!;
    expect(Buffer.byteLength(correction,'utf8')).toBeLessThanOrEqual(1024);
    expect(Object.keys(JSON.parse(correction)).sort()).toEqual(['panelOrders','pageId','predecessorId','predecessorPanelOrders','relation','requirementId'].sort());
    expect((requests[1]?.input as unknown[])[0]).toEqual((requests[0]?.input as unknown[])[0]);
  });
  it('2回とも配置が逆転する場合はそれ以上送信せず保存可能な結果を返さない',async()=>{
    const requests:Array<Record<string,unknown>>=[];let checkpoints=0;
    await expect(compiler([response(true)],requests).compilePlan({...base,beforeRetry:async()=>{checkpoints+=1;}})).rejects.toThrow('relation contradicts panel order');
    expect(requests).toHaveLength(2);expect(checkpoints).toBe(1);
  });
  it('配置の修正前に中断された場合は2回目の送信をしない',async()=>{
    const requests:Array<Record<string,unknown>>=[];const cancellation=new Error('cancelled');
    await expect(compiler([response(true),response(false)],requests).compilePlan({...base,beforeRetry:async()=>{throw cancellation;}})).rejects.toBe(cancellation);
    expect(requests).toHaveLength(1);
  });
  it('JSON修正で残り試行を使った場合は配置矛盾でも3回目を送信しない',async()=>{
    const requests:Array<Record<string,unknown>>=[];let checkpoints=0;
    await expect(compiler([{body:{output_text:'{'},requestId:'invalid'},response(true),response(false)],requests).compilePlan({...base,beforeRetry:async()=>{checkpoints+=1;}})).rejects.toThrow('relation contradicts panel order');
    expect(requests).toHaveLength(2);expect(checkpoints).toBe(1);
  });
  it('原文要件の依存が未来ページへ逆転する場合は有料送信前に拒否する',async()=>{
    const requests:Array<Record<string,unknown>>=[];
    const impossible={requirements:[
      {...requirements.requirements[0]!,afterRequirementIds:['p2-u1-r2']},
      {...requirements.requirements[1]!,requirementId:'p2-u1-r2',pageId:NEXT_PAGE,pageNumber:2,sourceUnitIds:['p2-u1'],afterRequirementIds:[]},
    ]};
    await expect(compiler([response(false)],requests).compilePlan({...base,sourceRequirements:impossible,sourceRequirementPlacementPageIds:[PAGE,NEXT_PAGE]})).rejects.toThrow('relation contradicts page order');
    expect(requests).toHaveLength(0);
  });
  it('同じ文言の一般設定エラーの場合は型で区別して再送しない',async()=>{
    let calls=0;const failure=new ConfigurationError('Detail plan source requirement relation contradicts panel order');
    const client={postJson:async()=>{calls+=1;throw failure;}} as unknown as OpenAIClient;
    await expect(new OpenAIPageEpisodePlanCompiler(client).compilePlan(base)).rejects.toBe(failure);
    expect(calls).toBe(1);
  });

});
