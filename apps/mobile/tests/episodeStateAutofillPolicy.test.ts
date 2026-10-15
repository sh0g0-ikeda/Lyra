import { describe, expect, it } from 'vitest';
import { automaticStateAutofillRequestOptions, stateAutofillRequestOptions, readEpisodeStateResult } from '@/domain/episodeStateAutofillPolicy';

const id = (index: number): string => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
const candidate = { entity_id: id(1), candidate_state_id: null, starts_at_panel_id: id(2), suggested_name: '外傷', suggested_description: '右腕の傷', source_scene_id: null, source_field: 'story_full_draft', source_quote: '右腕に傷を負う', reason: 'missing_reference' };
describe('状態自動入力の明示オプションと公開結果', () => {
  it('新しい標準操作は対応サーバーへ状態反映ONだけを送る', () => {
    expect(automaticStateAutofillRequestOptions(true)).toEqual({ state_autofill_enabled: true });
    expect(automaticStateAutofillRequestOptions(false)).toBeUndefined();
  });
  it('能力OFFでは旧API bodyを維持し、利用可能なら状態反映ONを明示する', () => {
    expect(stateAutofillRequestOptions(false, { enabled: true, overwrite: true })).toBeUndefined();
    expect(stateAutofillRequestOptions(true, { enabled: false, overwrite: true })).toEqual({ state_autofill_enabled: false });
    expect(stateAutofillRequestOptions(true, { enabled: true, overwrite: false })).toEqual({ state_autofill_enabled: true });
  });
  it('新機能選択時は既存指定を既定で保護し明示上書きのみoverwriteを送る', () => {
    expect(stateAutofillRequestOptions(true, { enabled: true, overwrite: true })).toEqual({ state_autofill_version: 'v1', state_assignment_policy: 'overwrite_existing' });
  });
  it('公開契約の単数state_blockerだけを候補として扱う', () => {
    expect(readEpisodeStateResult({ state_blocker: { code: 'STATE_REFERENCE_REQUIRED', candidates: [candidate] } }).blocker?.candidates[0]).toEqual(candidate);
    expect(readEpisodeStateResult({ state_blockers: [candidate] }).blocker).toBeNull();
    expect(readEpisodeStateResult(null)).toEqual({ blocker: null, transitions: [] });
  });
  it('不明IDや過大候補を拒否し有料previewへ連鎖させない', () => {
    expect(readEpisodeStateResult({ state_blocker: { code: 'STATE_REFERENCE_REQUIRED', candidates: [{ ...candidate, entity_id: 'unknown' }] } }).blocker).toBeNull();
    expect(readEpisodeStateResult({ state_blocker: { code: 'STATE_REFERENCE_REQUIRED', candidates: Array.from({ length: 21 }, () => candidate) } }).blocker).toBeNull();
  });
  it('defaultへの復帰をnullのまま表示用結果に保持する', () => {
    const transition = { entity_id: id(1), state_id: null, starts_at_panel_id: id(2), source_scene_id: null, source_field: 'story_full_draft', source_quote: '傷が治る' };
    expect(readEpisodeStateResult({ state_transitions: [transition] }).transitions).toEqual([transition]);
  });
  it('canonical契約の互換IDが許されても回復導線の全IDはUUIDで検証する', () => {
    for (const field of ['entity_id', 'candidate_state_id', 'starts_at_panel_id', 'source_scene_id']) {
      expect(readEpisodeStateResult({ state_blocker: { code: 'STATE_REFERENCE_REQUIRED', candidates: [{ ...candidate, [field]: 'opaque-legacy-id' }] } }).blocker).toBeNull();
    }
    const transition = { entity_id: id(1), state_id: null, starts_at_panel_id: id(2), source_scene_id: null, source_field: 'story_full_draft', source_quote: '傷が治る' };
    for (const field of ['entity_id', 'state_id', 'starts_at_panel_id', 'source_scene_id']) {
      expect(readEpisodeStateResult({ state_transitions: [{ ...transition, [field]: 'opaque-legacy-id' }] }).transitions).toEqual([]);
    }
  });

});
