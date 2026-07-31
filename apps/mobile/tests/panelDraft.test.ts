import { describe, expect, it } from 'vitest';
import {
  buildPanelUpdate,
  createPanelDraft,
  isPanelDraftDirty,
  type PanelDraft,
} from '../src/domain/panelDraft';
import type { PanelRecord } from '../src/lib/api';

const entityId = '33333333-3333-4333-8333-333333333333';
const anotherEntityId = '44444444-4444-4444-8444-444444444444';

describe('panel draft', () => {
  it('変更したfieldだけをtrim・nullable化して既存wire形式へ変換する', () => {
    const saved = createPanelDraft(buildPanel());
    const current: PanelDraft = {
      ...saved,
      panelRole: 'reaction',
      situationText: '  ワトスが驚いて振り返る  ',
      composition: {
        ...saved.composition,
        compositionPrompt: '  ワトスの表情へ寄る  ',
      },
      dialogue: saved.dialogue.map((line) => ({
        ...line,
        text: '  これは一体？  ',
      })),
      panelNotes: '   ',
    };

    expect(buildPanelUpdate(saved, current, [entityId])).toEqual({
      ok: true,
      payload: {
        panel_role: 'reaction',
        situation_text: 'ワトスが驚いて振り返る',
        composition: {
          source: 'custom',
          gallery_item_id: null,
          composition_prompt: 'ワトスの表情へ寄る',
          shot_type: 'close_up',
          angle: 'front',
          custom_note: null,
        },
        dialogue: [
          {
            entity_id: entityId,
            text: 'これは一体？',
            type: 'speech',
            position: 'top',
          },
        ],
        panel_notes: null,
      },
    });
  });

  it('空白だけの差分はdirtyや保存payloadへ含めない', () => {
    const saved = createPanelDraft(buildPanel());
    const current = {
      ...saved,
      situationText: `  ${saved.situationText}  `,
      dialogue: saved.dialogue.map((line) => ({ ...line, text: ` ${line.text} ` })),
    };

    expect(isPanelDraftDirty(saved, current)).toBe(false);
    expect(buildPanelUpdate(saved, current, [entityId])).toEqual({
      ok: true,
      payload: {},
    });
  });

  it('narrationとsfxはspeakerをnullへ正規化する', () => {
    const saved = createPanelDraft(buildPanel());
    const current = {
      ...saved,
      dialogue: [
        { entityId, text: 'その時、扉が開いた。', type: 'narration' as const, position: 'top' as const },
        { entityId, text: 'バン', type: 'sfx' as const, position: 'center' as const },
      ],
    };

    expect(buildPanelUpdate(saved, current, [entityId])).toMatchObject({
      ok: true,
      payload: {
        dialogue: [
          { entity_id: null, type: 'narration' },
          { entity_id: null, type: 'sfx' },
        ],
      },
    });
  });

  it('speaker必須の会話は現在のPanel assignment外のEntityを保存しない', () => {
    const saved = createPanelDraft(buildPanel());
    const missingSpeaker = {
      ...saved,
      dialogue: [{ ...saved.dialogue[0]!, entityId: null, text: '変更' }],
    };
    const unassignedSpeaker = {
      ...saved,
      dialogue: [{ ...saved.dialogue[0]!, entityId: anotherEntityId, text: '変更' }],
    };

    expect(buildPanelUpdate(saved, missingSpeaker, [entityId])).toEqual({
      ok: false,
      reason: 'dialogue_speaker_required',
    });
    expect(buildPanelUpdate(saved, unassignedSpeaker, [entityId])).toEqual({
      ok: false,
      reason: 'dialogue_speaker_not_assigned',
    });
  });

  it.each([
    ['situationText', 'x'.repeat(2_001), 'situation_too_long'],
    ['sfxText', 'x'.repeat(201), 'sfx_too_long'],
    ['backgroundNote', 'x'.repeat(2_001), 'background_too_long'],
    ['panelNotes', 'x'.repeat(2_001), 'notes_too_long'],
  ] as const)('%sの上限超過を送信前に拒否する', (field, value, reason) => {
    const saved = createPanelDraft(buildPanel());
    const current = { ...saved, [field]: value };

    expect(buildPanelUpdate(saved, current, [entityId])).toEqual({ ok: false, reason });
  });

  it('composition・dialogueの件数と文字数上限を送信前に拒否する', () => {
    const saved = createPanelDraft(buildPanel());
    const compositionTooLong = {
      ...saved,
      composition: { ...saved.composition, compositionPrompt: 'x'.repeat(1_001) },
    };
    const tooManyLines = {
      ...saved,
      dialogue: Array.from({ length: 21 }, (_, index) => ({
        entityId: null,
        position: 'center' as const,
        text: `効果音${index}`,
        type: 'sfx' as const,
      })),
    };
    const dialogueTooLong = {
      ...saved,
      dialogue: [{ ...saved.dialogue[0]!, text: 'x'.repeat(501) }],
    };

    expect(buildPanelUpdate(saved, compositionTooLong, [entityId])).toEqual({
      ok: false,
      reason: 'composition_prompt_too_long',
    });
    expect(buildPanelUpdate(saved, tooManyLines, [entityId])).toEqual({
      ok: false,
      reason: 'too_many_dialogue_lines',
    });
    expect(buildPanelUpdate(saved, dialogueTooLong, [entityId])).toEqual({
      ok: false,
      reason: 'dialogue_text_too_long',
    });
  });

  it('request enum外の既存shotは暗黙変換せず選び直した場合だけcompositionを保存する', () => {
    const legacyPanel = buildPanel();
    legacyPanel.composition.shot_type = 'legacy_medium_shot';
    const saved = createPanelDraft(legacyPanel);
    const promptOnly = {
      ...saved,
      composition: { ...saved.composition, compositionPrompt: '変更した構図' },
    };

    expect(buildPanelUpdate(saved, promptOnly, [entityId])).toEqual({
      ok: false,
      reason: 'composition_shot_type_unsupported',
    });
    expect(buildPanelUpdate(saved, {
      ...promptOnly,
      composition: { ...promptOnly.composition, shotType: 'wide' },
    }, [entityId])).toMatchObject({
      ok: true,
      payload: {
        composition: {
          composition_prompt: '変更した構図',
          shot_type: 'wide',
        },
      },
    });
  });
});

function buildPanel(): PanelRecord {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    page_id: '22222222-2222-4222-8222-222222222222',
    order: 1,
    panel_role: 'action',
    panel_size: 'standard',
    situation_text: 'ホームズが扉を指す',
    entities: [
      {
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
      },
    ],
    composition: {
      source: 'custom',
      gallery_item_id: null,
      composition_prompt: 'ホームズの上半身',
      shot_type: 'close_up',
      angle: 'front',
      custom_note: null,
    },
    dialogue_in_panel: true,
    dialogue: [
      {
        entity_id: entityId,
        text: 'ここを見てください。',
        type: 'speech',
        position: 'top',
      },
    ],
    sfx_text: null,
    background_note: 'ベーカー街の居間',
    panel_notes: '証拠を強調',
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
  };
}
