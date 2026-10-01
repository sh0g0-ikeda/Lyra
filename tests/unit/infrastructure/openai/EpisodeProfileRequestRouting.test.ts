import {expect,it} from 'vitest';
import {OpenAIClient} from '../../../../src/infrastructure/openai/OpenAIClient.js';
import {resolveEpisodeOpenAIModelProfile} from '../../../../src/infrastructure/openai/EpisodeOpenAIModelProfile.js';
import {OpenAIEpisodeBeatPlanCompiler} from '../../../../src/infrastructure/openai/OpenAIEpisodeBeatPlanCompiler.js';
import {OpenAIPageEpisodePlanCompiler} from '../../../../src/infrastructure/openai/OpenAIPageEpisodePlanCompiler.js';
import {OpenAIEpisodePlanAuditCompiler} from '../../../../src/infrastructure/openai/OpenAIEpisodePlanAuditCompiler.js';
it.each(['legacy','balanced_v1'] as const)('%sは指定stage model/reasoningを送信し既定を黙って変更しない',async(key)=>{
 const profile=resolveEpisodeOpenAIModelProfile(key);const requests:Record<string,unknown>[]=[];
 const client={postJson:async(_path:string,payload:Record<string,unknown>)=>{requests.push(payload);throw new Error('fixture: no provider call');}} as unknown as OpenAIClient;
 const inputs=[
  {expected:profile.beat,run:()=>new OpenAIEpisodeBeatPlanCompiler(client,profile.beat.model,profile.beat.reasoningEffort).compileBeatPlan({compilerBrief:'fixture',language:'ja'})},
  {expected:profile.beat,run:()=>new OpenAIEpisodeBeatPlanCompiler(client,profile.beat.model,profile.beat.reasoningEffort).compileOutline({compilerBrief:'fixture',language:'ja'})},
  {expected:profile.detail,run:()=>new OpenAIPageEpisodePlanCompiler(client,profile.detail.model,profile.detail.reasoningEffort).compilePlan({compilerBrief:'fixture',language:'ja'})},
  {expected:profile.audit,run:()=>new OpenAIEpisodePlanAuditCompiler(client,profile.audit.model,profile.audit.reasoningEffort).auditPlan({compilerBrief:'fixture',language:'ja',pageIds:['11111111-1111-4111-8111-111111111111']})}
 ];
 for(const {expected,run} of inputs){requests.length=0;await expect(run()).rejects.toThrow();expect(requests.length).toBeGreaterThan(0);for(const request of requests){expect(request.model).toBe(expected.model);expect(request.reasoning).toEqual(expected.reasoningEffort===undefined?undefined:{effort:expected.reasoningEffort});expect(request.max_output_tokens).toBeGreaterThan(0);}}
});
