import { describe, expect, it } from 'vitest';
import {
  buildPanelEntityAssignmentReplacement,
  createDefaultPanelEntityAssignment,
  createPanelEntityAssignmentDraft,
  isPanelEntityAssignmentDraftDirty,
  samePanelEntityAssignments,
} from '../src/domain/panelEntityAssignmentDraft';
import type { PanelRecord } from '../src/lib/api';

type Assignment = PanelRecord['entities'][number];

const entityId = '11111111-1111-4111-8111-111111111111';
const stateId = '22222222-2222-4222-8222-222222222222';

describe('panelEntityAssignmentDraft', () => {
  it('保存済み配列を複製して既存state IDを保持する', () => {
    const saved = [assignment({ state_id: stateId })];

    const draft = createPanelEntityAssignmentDraft(saved);

    expect(draft).toEqual(saved);
    expect(draft).not.toBe(saved);
    expect(draft[0]).not.toBe(saved[0]);
    expect(draft[0]?.state_id).toBe(stateId);
  });

  it('非customの古い値と前後空白をsemantic同値として扱う', () => {
    const saved = [assignment({
      custom_action: 'legacy action',
      custom_expression: 'legacy expression',
      effect_note: '  rain  ',
    })];
    const draft = [assignment({
      custom_action: null,
      custom_expression: null,
      effect_note: 'rain',
    })];

    expect(samePanelEntityAssignments(saved, draft)).toBe(true);
    expect(isPanelEntityAssignmentDraftDirty(saved, draft)).toBe(false);
  });

  it('変更時はexpected snapshotとdesiredを既存wire shapeで作りstate IDを保持する', () => {
    const saved = [assignment({ state_id: stateId })];
    const draft = [assignment({ role: 'secondary', state_id: stateId })];

    const result = buildPanelEntityAssignmentReplacement(saved, draft, [entityId]);

    expect(result).toEqual({
      ok: true,
      body: {
        entities: [{
          ...assignment({ role: 'secondary', state_id: stateId }),
          custom_expression: null,
          custom_action: null,
        }],
        expected_entities: [{
          ...assignment({ state_id: stateId }),
          custom_expression: null,
          custom_action: null,
        }],
      },
    });
  });

  it('新規assignmentは安全な既定値とstate未指定になる', () => {
    expect(createDefaultPanelEntityAssignment(entityId)).toEqual({
      entity_id: entityId,
      role: 'primary',
      expression: 'calm',
      custom_expression: null,
      action: 'standing_firm',
      custom_action: null,
      position: 'center',
      facing_direction: null,
      effect_note: null,
      state_id: null,
    });
  });

  it('8件は受理し9件は拒否する', () => {
    const eight = Array.from({ length: 8 }, (_, index) => assignment({
      entity_id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    }));
    const nine = [...eight, assignment({
      entity_id: '00000000-0000-4000-8000-000000000008',
    })];

    expect(buildPanelEntityAssignmentReplacement([], eight, [])).toMatchObject({ ok: true });
    expect(buildPanelEntityAssignmentReplacement([], nine, [])).toEqual({
      ok: false,
      reason: 'too_many_assignments',
    });
  });

  it('同じEntityの重複を拒否する', () => {
    expect(buildPanelEntityAssignmentReplacement(
      [],
      [assignment(), assignment({ role: 'secondary' })],
      [],
    )).toEqual({ ok: false, reason: 'duplicate_entity' });
  });

  it.each([
    ['custom_expression_required', assignment({ expression: 'custom', custom_expression: '   ' })],
    ['custom_expression_too_long', assignment({ expression: 'custom', custom_expression: 'x'.repeat(101) })],
    ['custom_action_required', assignment({ action: 'custom', custom_action: '   ' })],
    ['custom_action_too_long', assignment({ action: 'custom', custom_action: 'x'.repeat(101) })],
    ['effect_note_too_long', assignment({ effect_note: 'x'.repeat(201) })],
  ] as const)('%sの場合は送信しない', (reason, invalidAssignment) => {
    expect(buildPanelEntityAssignmentReplacement([], [invalidAssignment], [])).toEqual({
      ok: false,
      reason,
    });
  });

  it('保存済み会話の話者を外すassignmentは拒否する', () => {
    expect(buildPanelEntityAssignmentReplacement([assignment()], [], [entityId])).toEqual({
      ok: false,
      reason: 'dialogue_speaker_not_assigned',
    });
  });
});

function assignment(overrides: Partial<Assignment> = {}): Assignment {
  return {
    entity_id: entityId,
    role: 'primary',
    expression: 'calm',
    custom_expression: null,
    action: 'standing_firm',
    custom_action: null,
    position: 'center',
    facing_direction: null,
    effect_note: null,
    state_id: null,
    ...overrides,
  };
}
