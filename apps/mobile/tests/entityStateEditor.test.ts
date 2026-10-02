import { describe, expect, it } from 'vitest';
import { buildNamedStatePayload, readStatePreviewCapability, stateOptionSelectable, stateReferenceCandidates, buildStateImageSources, stateLabel } from '@/domain/entityStateEditor';

const legacy = { id: 'legacy', entity_id: 'entity', scene_id: 'scene', costume_note: '既存衣装', costume_ref_id: 'old-ref', condition_note: null, hair_note: null, expression_default: 'calm', extra_note: null, created_at: '2026-01-01T00:00:00Z' };
const named = { ...legacy, id: 'state', name: '外傷', description: '左頬に傷', updated_at: '2026-01-02T00:00:00Z', reference_status: 'confirmed' as const, reference_image: { ref_id: 'state-ref', image_model: 'gpt-image-2', base_ref_id: 'base', created_at: '2026-01-02T00:00:00Z', input_fingerprint: 'a'.repeat(64) } };

describe('state editor contracts', () => {
  it('状態名・自由入力だけを変更しlegacyノートやbaseを送らない', () => {
    expect(buildNamedStatePayload(' 外傷 ', ' 左頬に傷 ')).toEqual({ name: '外傷', description: '左頬に傷' });
    expect(buildNamedStatePayload('', '説明')).toBeNull();
    expect(buildNamedStatePayload('a'.repeat(101), '説明')).toBeNull();
    expect(buildNamedStatePayload('外傷', 'a'.repeat(2001))).toBeNull();
  });
  it('capabilityや料金がない旧APIでは有料previewを閉じる', () => {
    expect(readStatePreviewCapability({})).toEqual({ enabled: false, cost: null });
    expect(readStatePreviewCapability({ capabilities: { entity_state_reference_generation: true } }).enabled).toBe(false);
    expect(readStatePreviewCapability({ capabilities: { entity_state_reference_generation: true, entity_state_preview_credit_cost: 1 } })).toEqual({ enabled: true, cost: 1 });
    expect(readStatePreviewCapability({ capabilities: { entity_state_reference_generation: false, entity_state_preview_credit_cost: 1 } }).enabled).toBe(false);
  });
  it('コマでは確定済み状態と互換legacyだけを選択できる', () => {
    expect(stateOptionSelectable(legacy)).toBe(true);
    expect(stateOptionSelectable(named)).toBe(true);
    expect(stateOptionSelectable({ ...named, reference_status: 'stale' })).toBe(false);
    expect(stateOptionSelectable({ ...named, reference_status: undefined, reference_image: undefined })).toBe(false);
    expect(stateLabel(named, 'アキラ', 'ja')).toBe('アキラ・外傷');
  });
  it('候補は同じentity/state/revisionの実provider完了jobだけを利用する', () => {
    const job = { id: 'job', job_type: 'entity_generate', status: 'completed', params: { target: 'entity_state', entity_id: 'entity', entity_state_id: 'state', state_revision: named.updated_at }, result: { provider_result: true, candidates: [{ candidate_token: 'opaque', cdn_url: 'https://cdn.example/image' }] } };
    expect(stateReferenceCandidates(job, named)).toHaveLength(1);
    expect(stateReferenceCandidates({ ...job, params: { ...job.params, entity_state_id: 'other' } }, named)).toEqual([]);
    expect(stateReferenceCandidates({ ...job, params: { ...job.params, state_revision: 'older' } }, named)).toEqual([]);
    expect(stateReferenceCandidates({ ...job, result: { ...job.result, provider_result: false } }, named)).toEqual([]);
    expect(stateReferenceCandidates({ ...job, params: { entity_id: 'entity' } }, named)).toEqual([]);
  });
  it('認証画像URLはentity/state/token/revisionとscopeから作り、CDNに認証headerを送らない', () => {
    const input = { apiBaseUrl: 'https://api.example', sessionKey: 'session', organizationId: 'org', authorizationHeader: 'Bearer token', entityId: 'entity', stateId: 'state', revision: named.updated_at, referenceId: 'ref' };
    const sources = buildStateImageSources({ ...input, candidate: { candidate_token: 'signed token', cdn_url: 'https://cdn.example/image' } });
    expect(sources[0]).toEqual({ uri: 'https://cdn.example/image' });
    expect(sources[1]?.uri).toContain('/entities/entity/states/state/reference-candidate-image?');
    expect(sources[1]?.uri).toContain('expected_state_revision=');
    expect(sources[1]?.uri).toContain('candidate_token=signed+token');
    expect(sources[1]?.headers).toEqual({ Authorization: 'Bearer token' });
    expect(buildStateImageSources(input)[0]?.uri).toContain('/entities/entity/states/state/reference-image?');
  });
});
