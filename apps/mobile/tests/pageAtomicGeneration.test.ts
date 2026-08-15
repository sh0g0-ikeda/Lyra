import { describe, expect, it } from 'vitest';

import {
  AtomicPagePayloadError,
  buildAtomicSaveAndGeneratePayload
} from '@/domain/pageAtomicGeneration';
import type {
  PageRecord,
  PanelEntityAssignmentRecord,
  PanelFrameRecord,
  PanelRecord
} from '@/domain/types';

const pageId = '11111111-1111-4111-8111-111111111111';
const firstPanelId = '22222222-2222-4222-8222-222222222222';
const secondPanelId = '33333333-3333-4333-8333-333333333333';

const assignment: PanelEntityAssignmentRecord = {
  entity_id: '44444444-4444-4444-8444-444444444444',
  role: 'primary',
  expression: 'calm',
  custom_expression: null,
  action: 'standing_firm',
  custom_action: null,
  position: 'center',
  facing_direction: 'front',
  effect_note: null,
  state_id: null
};

const makePanel = (id: string, order: number, situation: string): PanelRecord => ({
  id,
  page_id: pageId,
  order,
  panel_role: 'action',
  panel_size: 'standard',
  situation_text: situation,
  entities: [assignment],
  composition: {
    source: 'ai_auto',
    gallery_item_id: null,
    composition_prompt: null,
    shot_type: null,
    angle: null,
    custom_note: null
  },
  dialogue_in_panel: true,
  dialogue: [],
  sfx_text: null,
  background_note: null,
  panel_notes: null,
  created_at: '2026-07-24T00:00:00.000Z',
  updated_at: '2026-07-24T00:00:00.000Z'
});

const page: PageRecord = {
  id: pageId,
  episode_id: '55555555-5555-4555-8555-555555555555',
  page_number: 1,
  layout_config: {},
  story_source_scene_ids: ['66666666-6666-4666-8666-666666666666'],
  story_page_purpose: '主人公が決断する',
  story_continuity_note: '雨が降り続いている',
  dialogue_mode: 'image_baked',
  page_dialogue_toggle: true,
  generation_mode: null,
  generated_image: null,
  status: 'designing',
  panel_count: 2,
  frame_count: 2,
  balloon_count: 0,
  created_at: '2026-07-24T00:00:00.000Z',
  updated_at: '2026-07-24T01:02:03.000Z'
};

const makeFrame = (panelId: string, readingOrder: number): PanelFrameRecord => ({
  id: `77777777-7777-4777-8777-77777777777${readingOrder}`,
  page_id: pageId,
  panel_id: panelId,
  vertices: [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 }
  ],
  border_style: 'solid',
  border_width: 3,
  border_color: '#000000',
  z_index: readingOrder,
  reading_order: readingOrder
});

describe('pageAtomicGeneration', () => {
  it('状態UIを隠しても保存済みstate_idを生成payloadに残す', () => {
    const stateId = '88888888-8888-4888-8888-888888888888';
    const firstPanel = {
      ...makePanel(firstPanelId, 1, '既存の状態を維持するコマ'),
      entities: [
        {
          ...assignment,
          state_id: stateId
        }
      ]
    };

    const payload = buildAtomicSaveAndGeneratePayload({
      page: {
        ...page,
        panel_count: 1,
        frame_count: 1
      },
      pagePatch: {},
      panels: [firstPanel],
      selectedPanelOverride: null,
      frames: [makeFrame(firstPanelId, 1)],
      language: 'ja'
    });

    expect(payload.panels[0]?.entities[0]?.state_id).toBe(stateId);
  });

  it('構図ソースUIを隠しても保存済みgallery構図を生成payloadに残す', () => {
    const galleryItemId = '99999999-9999-4999-8999-999999999999';
    const firstPanel = {
      ...makePanel(firstPanelId, 1, 'ギャラリー構図を維持するコマ'),
      composition: {
        source: 'gallery' as const,
        gallery_item_id: galleryItemId,
        composition_prompt: '既存の構図指示',
        shot_type: 'full_shot' as const,
        angle: 'eye_level' as const,
        custom_note: '保存済みの補足'
      }
    };

    const payload = buildAtomicSaveAndGeneratePayload({
      page: {
        ...page,
        panel_count: 1,
        frame_count: 1
      },
      pagePatch: {},
      panels: [firstPanel],
      selectedPanelOverride: {
        panelId: firstPanelId,
        fields: {
          ...firstPanel,
          situation_text: '画面で編集した本文'
        }
      },
      frames: [makeFrame(firstPanelId, 1)],
      language: 'ja'
    });

    expect(payload.panels[0]?.composition).toEqual(firstPanel.composition);
  });

  it('選択中コマの下書きだけを統合し全コマと全枠を保持する', () => {
    const firstPanel = makePanel(firstPanelId, 1, '保存済みの1コマ目');
    const secondPanel = makePanel(secondPanelId, 2, '保存済みの2コマ目');

    const payload = buildAtomicSaveAndGeneratePayload({
      page,
      pagePatch: {
        style_reference: { title: '鉛筆画', notes: '淡いトーン' },
        story_source_scene_ids: page.story_source_scene_ids,
        story_page_purpose: page.story_page_purpose,
        story_continuity_note: page.story_continuity_note
      },
      panels: [secondPanel, firstPanel],
      selectedPanelOverride: {
        panelId: secondPanelId,
        fields: {
          ...secondPanel,
          situation_text: '未保存の2コマ目',
          entities: []
        }
      },
      frames: [makeFrame(secondPanelId, 2), makeFrame(firstPanelId, 1)],
      language: 'ja'
    });

    expect(payload.expected_updated_at).toBe(page.updated_at);
    expect(payload.generation).toEqual({ language: 'ja' });
    expect(payload.page).toEqual({
      dialogue_mode: 'image_baked',
      page_dialogue_toggle: true,
      style_reference: { title: '鉛筆画', notes: '淡いトーン' },
      story_source_scene_ids: page.story_source_scene_ids,
      story_page_purpose: '主人公が決断する',
      story_continuity_note: '雨が降り続いている'
    });
    expect(payload.panels.map((panel) => panel.id)).toEqual([firstPanelId, secondPanelId]);
    expect(payload.panels[0]?.situation_text).toBe('保存済みの1コマ目');
    expect(payload.panels[1]?.situation_text).toBe('未保存の2コマ目');
    expect(payload.panels[1]?.entities).toEqual([]);
    expect(payload.frames.map((frame) => frame.panel_id)).toEqual([firstPanelId, secondPanelId]);
  });

  it('枠とコマの対応が欠ける場合は暗黙に切り詰めない', () => {
    expect(() =>
      buildAtomicSaveAndGeneratePayload({
        page,
        pagePatch: {},
        panels: [makePanel(firstPanelId, 1, '1コマ目'), makePanel(secondPanelId, 2, '2コマ目')],
        selectedPanelOverride: null,
        frames: [makeFrame(firstPanelId, 1)],
        language: 'en'
      })
    ).toThrowError(
      expect.objectContaining<Partial<AtomicPagePayloadError>>({
        code: 'PANEL_FRAME_MISMATCH'
      })
    );
  });

  it('選択中コマ以外への上書きを拒否する', () => {
    expect(() =>
      buildAtomicSaveAndGeneratePayload({
        page,
        pagePatch: {},
        panels: [makePanel(firstPanelId, 1, '1コマ目')],
        selectedPanelOverride: {
          panelId: secondPanelId,
          fields: makePanel(secondPanelId, 2, '存在しないコマ')
        },
        frames: [makeFrame(firstPanelId, 1)],
        language: 'ja'
      })
    ).toThrowError(
      expect.objectContaining<Partial<AtomicPagePayloadError>>({
        code: 'PANEL_OVERRIDE_NOT_FOUND'
      })
    );
  });
});
