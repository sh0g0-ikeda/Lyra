import { describe, expect, it } from 'vitest';
import {
  buildPageSettingsUpdate,
  createPageSettingsDraft,
  hasRemotePageSettingsChanged,
  isPageSettingsDraftDirty,
} from '../src/domain/pageSettingsDraft';
import type { PageRecord } from '../src/lib/api';

describe('pageSettingsDraft', () => {
  it('既存Pageから台詞・style・provenance設定のdraftを作る', () => {
    expect(createPageSettingsDraft(buildPage())).toEqual({
      dialogue_mode: 'image_baked',
      page_dialogue_toggle: true,
      story_continuity_note: '雨は次のページまで続く',
      story_page_purpose: '屋上の危機を示す',
      style_reference_notes: '硬質な都市背景',
      style_reference_title: '劇画調',
    });
  });

  it('不正なstyle metadataはdraftへ取り込まない', () => {
    expect(createPageSettingsDraft({
      ...buildPage(),
      layout_config: { style_reference: ['invalid'] },
    })).toMatchObject({
      style_reference_notes: '',
      style_reference_title: '',
    });
  });

  it('変更されたfieldだけを正規化して更新payloadへ含める', () => {
    const saved = createPageSettingsDraft(buildPage());

    expect(buildPageSettingsUpdate(saved, {
      ...saved,
      dialogue_mode: 'balloon_only',
    })).toEqual({ ok: true, payload: { dialogue_mode: 'balloon_only' } });
    expect(buildPageSettingsUpdate(saved, {
      ...saved,
      page_dialogue_toggle: false,
    })).toEqual({ ok: true, payload: { page_dialogue_toggle: false } });
    expect(buildPageSettingsUpdate(saved, {
      ...saved,
      style_reference_notes: '  影を強くする  ',
    })).toEqual({
      ok: true,
      payload: {
        style_reference: {
          notes: '影を強くする',
          title: '劇画調',
        },
      },
    });
    expect(buildPageSettingsUpdate(saved, {
      ...saved,
      story_page_purpose: '   ',
    })).toEqual({ ok: true, payload: { story_page_purpose: null } });
    expect(buildPageSettingsUpdate(saved, {
      ...saved,
      story_continuity_note: '  傘を持たせる  ',
    })).toEqual({
      ok: true,
      payload: { story_continuity_note: '傘を持たせる' },
    });
    expect(buildPageSettingsUpdate(saved, saved)).toEqual({ ok: true, payload: {} });
    expect(isPageSettingsDraftDirty(saved, saved)).toBe(false);
    expect(isPageSettingsDraftDirty(saved, {
      ...saved,
      story_page_purpose: `  ${saved.story_page_purpose}  `,
    })).toBe(false);
  });

  it('style titleとnotesを両方空にすると明示的な削除payloadになる', () => {
    const saved = createPageSettingsDraft(buildPage());

    expect(buildPageSettingsUpdate(saved, {
      ...saved,
      style_reference_notes: '   ',
      style_reference_title: '   ',
    })).toEqual({ ok: true, payload: { style_reference: null } });
  });

  it.each([
    ['style_title_too_long', { style_reference_title: 'a'.repeat(201) }],
    ['style_notes_too_long', { style_reference_notes: 'a'.repeat(2_001) }],
    ['page_purpose_too_long', { story_page_purpose: 'a'.repeat(501) }],
    ['continuity_note_too_long', { story_continuity_note: 'a'.repeat(1_001) }],
  ] as const)('%sの場合はnetwork送信前に拒否する', (reason, update) => {
    const saved = createPageSettingsDraft(buildPage());

    expect(buildPageSettingsUpdate(saved, { ...saved, ...update })).toEqual({
      ok: false,
      reason,
    });
  });

  it('style titleが空でnotesだけある場合はnetwork送信前に拒否する', () => {
    const saved = createPageSettingsDraft({
      ...buildPage(),
      layout_config: {},
    });

    expect(buildPageSettingsUpdate(saved, {
      ...saved,
      style_reference_notes: 'notes only',
    })).toEqual({ ok: false, reason: 'style_title_required' });
  });

  it('表示または編集するsemantic設定のremote変更だけを競合として扱う', () => {
    const saved = buildPage();

    expect(hasRemotePageSettingsChanged(saved, {
      ...saved,
      updated_at: '2026-08-01T00:00:01.000Z',
      panel_count: saved.panel_count + 1,
      layout_config: {
        ...saved.layout_config,
        style_reference: {
          ...(saved.layout_config.style_reference as Record<string, unknown>),
          compiled_brief: 'server-recompiled-with-the-same-user-input',
        },
        unrelated: true,
      },
    })).toBe(false);
    expect(hasRemotePageSettingsChanged(saved, {
      ...saved,
      updated_at: '2026-08-01T00:00:02.000Z',
      dialogue_mode: 'mixed',
    })).toBe(true);
    expect(hasRemotePageSettingsChanged(saved, {
      ...saved,
      updated_at: '2026-08-01T00:00:03.000Z',
      page_dialogue_toggle: false,
    })).toBe(true);
    expect(hasRemotePageSettingsChanged(saved, {
      ...saved,
      layout_config: {
        style_reference: {
          title: '水彩調',
          notes: '淡い背景',
        },
      },
    })).toBe(true);
    expect(hasRemotePageSettingsChanged(saved, {
      ...saved,
      story_source_scene_ids: ['33333333-3333-4333-8333-333333333333'],
    })).toBe(true);
    expect(hasRemotePageSettingsChanged(saved, {
      ...saved,
      story_page_purpose: '別の目的',
    })).toBe(true);
    expect(hasRemotePageSettingsChanged(saved, {
      ...saved,
      story_continuity_note: '別の継続条件',
    })).toBe(true);
  });
});

function buildPage(): PageRecord {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    episode_id: '22222222-2222-4222-8222-222222222222',
    page_number: 1,
    layout_config: {
      style_reference: {
        title: '劇画調',
        notes: '硬質な都市背景',
        compiled_brief: 'server-owned',
      },
    },
    story_source_scene_ids: [],
    story_page_purpose: '屋上の危機を示す',
    story_continuity_note: '雨は次のページまで続く',
    dialogue_mode: 'image_baked',
    page_dialogue_toggle: true,
    generation_mode: null,
    generated_image: null,
    status: 'designing',
    panel_count: 2,
    frame_count: 2,
    balloon_count: 0,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
  };
}
