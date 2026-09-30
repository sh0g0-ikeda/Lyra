import { describe, expect, it } from 'vitest';
import type { EpisodePagePlanContext } from '../../../../src/domain/types/page.js';
import { buildEpisodeStateTransitionCompilerBrief } from '../../../../src/services/page/EpisodeStateTransitionCompiler.js';

describe('buildEpisodeStateTransitionCompilerBrief', () => {
  it('保存済みstory、scene、panel読順、開始状態と未確定候補だけをAI briefへ渡す', () => {
    const brief = buildEpisodeStateTransitionCompilerBrief(context(), 'ja');

    expect(brief).toContain('腕を負傷した');
    expect(brief).toContain('Scene 1');
    expect(brief).toContain('Panel 1');
    expect(brief).toContain('Panel 2');
    expect(brief.indexOf('Panel 1')).toBeLessThan(brief.indexOf('Panel 2'));
    expect(brief).toContain('starting_state=none');
    expect(brief).toContain('state_id=33333333-3333-4333-8333-333333333333');
    expect(brief).toContain('reference_ready=false');
    expect(brief).toContain('candidate=true');
    expect(brief).toContain('entity_id=11111111-1111-4111-8111-111111111111 | name=主人公');
    expect(brief).toContain('page_id=99999999-9999-4999-8999-999999999999');
    expect(brief).toContain('source_scene_ids=44444444-4444-4444-8444-444444444444');
    expect(brief).toContain('situation=腕を押さえる');
    expect(brief).toContain('dialogue=11111111-1111-4111-8111-111111111111:痛い');
    expect(brief).not.toContain('reference/private/state.png');
    expect(brief).not.toContain('storage-owner-secret');
    expect(brief).not.toContain('base-ref-secret');
  });
});

function context(): EpisodePagePlanContext {
  return {
    episodeId: '66666666-6666-4666-8666-666666666666',
    workId: '77777777-7777-4777-8777-777777777777',
    chapter: { id: '88888888-8888-4888-8888-888888888888', title: null, purpose: null, startingState: null, endingState: null, emotionCurve: null, keyBeats: [] },
    episode: { title: '第1話', purpose: '負傷', storyFullDraft: '主人公は腕を負傷した。', introduction: '駅前にいる。', middle: '腕を負傷した。', climax: null, endingHook: null, estimatedPages: 1, startingEntityStates: [{ entityId: '11111111-1111-4111-8111-111111111111', stateId: null }] },
    scenes: [{ id: '44444444-4444-4444-8444-444444444444', order: 1, location: '駅前', time: '夕方', atmosphere: '緊迫', involvedEntityIds: ['11111111-1111-4111-8111-111111111111'], entityStates: [] }],
    entities: [{ id: '11111111-1111-4111-8111-111111111111', name: '主人公', entityType: 'character', freeDescription: null, promptSupplement: null, structuredFields: {} }],
    stateLibrary: [{ entityId: '11111111-1111-4111-8111-111111111111', stateId: '33333333-3333-4333-8333-333333333333', name: '負傷', description: '腕に包帯', revision: '2026-09-30T00:00:00.000Z', baseRefId: 'base-ref-secret', baseRefUpdatedAt: '2026-09-30T00:00:00.000Z', referenceImage: { refId: 'state-ref', s3Key: 'reference/private/state.png', storageOwnerUserId: 'storage-owner-secret', imageModel: 'gpt-image-1', baseRefId: 'base-ref-secret', createdAt: '2026-09-30T00:00:00.000Z', inputFingerprint: 'fingerprint-secret' }, referenceReady: false }],
    pages: [{ pageId: '99999999-9999-4999-8999-999999999999', pageNumber: 2, frameCount: 1, layoutConfig: { story_source_scene_ids: ['44444444-4444-4444-8444-444444444444'] }, status: 'designing', dialogueMode: 'mixed', pageDialogueToggle: true, panels: [{ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', order: 2, panelRole: 'action', panelSize: 'standard', situationText: null, composition: { source: 'ai_auto', galleryItemId: null, compositionPrompt: null, shotType: null, angle: null, customNote: null }, dialogueInPanel: false, dialogue: [], sfxText: null, backgroundNote: null, panelNotes: null, entities: [] }, { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', order: 1, panelRole: 'action', panelSize: 'standard', situationText: '腕を押さえる', composition: { source: 'ai_auto', galleryItemId: null, compositionPrompt: null, shotType: null, angle: null, customNote: null }, dialogueInPanel: true, dialogue: [{ entityId: '11111111-1111-4111-8111-111111111111', text: '痛い', type: 'speech', position: 'top' }], sfxText: null, backgroundNote: null, panelNotes: null, entities: [] }] }],
  };
}
