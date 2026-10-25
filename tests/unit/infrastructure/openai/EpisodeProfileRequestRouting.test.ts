import {expect,it} from 'vitest';
import {OpenAIClient} from '../../../../src/infrastructure/openai/OpenAIClient.js';
import {resolveEpisodeOpenAIModelProfile} from '../../../../src/infrastructure/openai/EpisodeOpenAIModelProfile.js';
import {OpenAIEpisodeBeatPlanCompiler} from '../../../../src/infrastructure/openai/OpenAIEpisodeBeatPlanCompiler.js';
import {OpenAIPageEpisodePlanCompiler} from '../../../../src/infrastructure/openai/OpenAIPageEpisodePlanCompiler.js';
import {OpenAIEpisodeStateTransitionCompiler} from '../../../../src/infrastructure/openai/OpenAIEpisodeStateTransitionCompiler.js';
import {prepareEpisodeSourceRequirementExtraction} from '../../../../src/services/page/EpisodeSourceRequirements.js';
import type {EpisodePagePlanContext} from '../../../../src/domain/types/page.js';
import {OpenAIEpisodePlanAuditCompiler} from '../../../../src/infrastructure/openai/OpenAIEpisodePlanAuditCompiler.js';
it.each(['legacy','balanced_v1','balanced_v2'] as const)('%sは指定stage model/reasoningを送信し既定を黙って変更しない',async(key)=>{
 const profile=resolveEpisodeOpenAIModelProfile(key);const requests:Record<string,unknown>[]=[];
 const client={postJson:async(_path:string,payload:Record<string,unknown>)=>{requests.push(payload);throw new Error('fixture: no provider call');}} as unknown as OpenAIClient;
 const inputs=[
  {expected:profile.beat,run:()=>new OpenAIEpisodeBeatPlanCompiler(client,profile.beat.model,profile.beat.reasoningEffort).compileBeatPlan({compilerBrief:'fixture',language:'ja'})},
  {expected:profile.beat,run:()=>new OpenAIEpisodeBeatPlanCompiler(client,profile.beat.model,profile.beat.reasoningEffort).compileOutline({compilerBrief:'fixture',language:'ja'})},
  {expected:{...profile.beat,reasoningEffort:profile.beat.reasoningEffort??'low'},run:()=>new OpenAIEpisodeBeatPlanCompiler(client,profile.beat.model,profile.beat.reasoningEffort).compileSourceRequirements({extraction:prepareEpisodeSourceRequirementExtraction({storyFullDraft:'1ページ目：扉を押す。',pages:[{pageId:'11111111-1111-4111-8111-111111111111',pageNumber:1}]})!,language:'ja'})},
  {expected:profile.detail,run:()=>new OpenAIPageEpisodePlanCompiler(client,profile.detail.model,profile.detail.reasoningEffort).compilePlan({compilerBrief:'fixture',language:'ja'})},
  {expected:profile.state,run:()=>new OpenAIEpisodeStateTransitionCompiler(client,profile.state.model,profile.state.reasoningEffort).compileStateTransitions({context:stateContext(),language:'ja'})},
  {expected:profile.audit,run:()=>new OpenAIEpisodePlanAuditCompiler(client,profile.audit.model,profile.audit.reasoningEffort).auditPlan({compilerBrief:'fixture',language:'ja',pageIds:['11111111-1111-4111-8111-111111111111'],coverageCatalog:{pages:[{pageId:'11111111-1111-4111-8111-111111111111',sources:[{ref:'source',text:'原作事実が存在する'}],outputs:[{ref:'p1.s',text:'画面描写が存在する',panelOrder:1}]}]}})}
 ];
 for(const {expected,run} of inputs){requests.length=0;await expect(run()).rejects.toThrow();expect(requests.length).toBeGreaterThan(0);for(const request of requests){expect(request.model).toBe(expected.model);expect(request.reasoning).toEqual(expected.reasoningEffort===undefined?undefined:{effort:expected.reasoningEffort});expect(request.max_output_tokens).toBeGreaterThan(0);}}
});

const ENTITY = '11111111-1111-4111-8111-111111111111';
const STATE = '22222222-2222-4222-8222-222222222222';
const PANEL = '33333333-3333-4333-8333-333333333333';
function stateContext(): EpisodePagePlanContext {
  return {
    episodeId: '44444444-4444-4444-8444-444444444444', workId: '55555555-5555-4555-8555-555555555555',
    chapter: { id: '66666666-6666-4666-8666-666666666666', title: null, purpose: null, startingState: null, endingState: null, emotionCurve: null, keyBeats: [] },
    episode: { title: null, purpose: null, storyFullDraft: '主人公は腕を負傷した。', introduction: null, middle: '腕を負傷した', climax: null, endingHook: null, estimatedPages: 1, startingEntityStates: [] },
    scenes: [],
    entities: [{ id: ENTITY, name: '主人公', entityType: 'character', freeDescription: null, promptSupplement: null, structuredFields: {} }],
    stateLibrary: [{ entityId: ENTITY, stateId: STATE, name: '負傷', description: '腕に包帯', revision: null, baseRefId: null, baseRefUpdatedAt: null, referenceImage: { refId: 'ref', s3Key: 'private/state.png', storageOwnerUserId: 'owner-secret', imageModel: 'gpt-image-1', baseRefId: 'base', createdAt: '2026-09-30T00:00:00.000Z', inputFingerprint: 'fingerprint' }, referenceReady: true }],
    pages: [{ pageId: '77777777-7777-4777-8777-777777777777', pageNumber: 1, frameCount: 1, layoutConfig: {}, status: 'designing', dialogueMode: 'mixed', pageDialogueToggle: true, panels: [{ id: PANEL, order: 1, panelRole: 'action', panelSize: 'standard', situationText: null, composition: { source: 'ai_auto', galleryItemId: null, compositionPrompt: null, shotType: null, angle: null, customNote: null }, dialogueInPanel: false, dialogue: [], sfxText: null, backgroundNote: null, panelNotes: null, entities: [] }] }],
  };
}
