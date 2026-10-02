import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EpisodeStateAutofillResult } from '@/components/EpisodeStateAutofillResult';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const id = (index: number): string => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
const candidate = { entity_id: id(1), candidate_state_id: id(3), starts_at_panel_id: id(2), suggested_name: '外傷', suggested_description: '右腕の傷', source_scene_id: null, source_field: 'story_full_draft', source_quote: '右腕に傷を負う', reason: 'missing_reference' };
let job: { id: string; status: string; job_type: string; params: { episode_id: string }; result: Record<string, unknown> };
const openCandidate = vi.fn();
const api = { getJob: vi.fn(), generateEntityStateReference: vi.fn(), autofillEpisodePagesFromStory: vi.fn() };
let root: ReactTestRenderer | undefined;
vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: job }) }));
vi.mock('react-native', () => ({ Text: 'text', View: 'view', StyleSheet: { create: <T,>(styles: T): T => styles } }));
vi.mock('@/components/EntityStatePicker', () => ({ EntityStatePicker: (props: Record<string, unknown>) => React.createElement('state-picker', props) }));
vi.mock('@/components/Notice', () => ({ Notice: (props: Record<string, unknown>) => React.createElement('notice', props) }));
vi.mock('@/components/PrimaryButton', () => ({ PrimaryButton: (props: Record<string, unknown>) => React.createElement('button', props) }));
vi.mock('@/state/mangaWorkflow', () => ({ useMangaWorkflow: () => ({ requestStateCandidate: openCandidate }) }));
vi.mock('@/state/appState', () => ({ useAppState: () => ({ api, language: 'ja', selection: { organizationId: 'org' }, sessionKey: 'session' }) }));
async function render(canEdit = true): Promise<void> { await act(async () => { root = create(<EpisodeStateAutofillResult jobId="job" episodeId="episode" entities={[]} canEdit={canEdit} />); }); }
beforeEach(() => { job = { id: 'job', status: 'failed', job_type: 'episode_story_autofill', params: { episode_id: 'episode' }, result: { state_blocker: { code: 'STATE_REFERENCE_REQUIRED', candidates: [candidate] } } }; openCandidate.mockReset().mockResolvedValue(true); });
afterEach(async () => { await act(async () => root?.unmount()); });
describe('状態不足結果からの明示回復', () => {
  it('表示だけで課金操作を行わず明示操作で候補と既存state IDを渡す', async () => {
    await render();
    expect(openCandidate).not.toHaveBeenCalled();
    await act(async () => root?.root.findByType('button').props.onPress());
    expect(openCandidate).toHaveBeenCalledWith({ entityId: id(1), name: '外傷', description: '右腕の傷', stateId: id(3) });
    expect(api.generateEntityStateReference).not.toHaveBeenCalled();
    expect(api.autofillEpisodePagesFromStory).not.toHaveBeenCalled();
  });
  it('別話・進行中・旧結果では過去の候補を表示しない', async () => {
    job.params.episode_id = 'different'; await render(); expect(root?.toJSON()).toBeNull();
    await act(async () => root?.unmount());
    job.params.episode_id = 'episode'; job.status = 'processing'; await render(); expect(root?.toJSON()).toBeNull();
  });
  it('候補の権限検証失敗は安全な案内となりviewerには操作を許可しない', async () => {
    openCandidate.mockRejectedValue(new Error('private provider detail'));
    await render();
    await act(async () => root?.root.findByType('button').props.onPress());
    expect(root?.root.findByType('notice').props.message).not.toContain('private');
    await act(async () => root?.unmount());
    await render(false);
    expect(root?.root.findByType('button').props.disabled).toBe(true);
  });
});
