import { describe, expect, it } from 'vitest';
import {
  buildPageSettingsUpdate,
  createPageSettingsDraft,
  hasRemotePageSettingsChanged,
  isPageSettingsDraftDirty,
} from '../src/domain/pageSettingsDraft';
import type { PageRecord } from '../src/lib/api';

describe('pageSettingsDraft', () => {
  it('既存Pageから台詞設定だけのdraftを作る', () => {
    expect(createPageSettingsDraft(buildPage())).toEqual({
      dialogue_mode: 'image_baked',
      page_dialogue_toggle: true,
    });
  });

  it('変更されたfieldだけを更新payloadへ含める', () => {
    const saved = createPageSettingsDraft(buildPage());

    expect(buildPageSettingsUpdate(saved, {
      ...saved,
      dialogue_mode: 'balloon_only',
    })).toEqual({ dialogue_mode: 'balloon_only' });
    expect(buildPageSettingsUpdate(saved, {
      ...saved,
      page_dialogue_toggle: false,
    })).toEqual({ page_dialogue_toggle: false });
    expect(buildPageSettingsUpdate(saved, saved)).toEqual({});
    expect(isPageSettingsDraftDirty(saved, saved)).toBe(false);
  });

  it('対象設定のremote変更だけを競合として扱う', () => {
    const saved = buildPage();

    expect(hasRemotePageSettingsChanged(saved, {
      ...saved,
      updated_at: '2026-08-01T00:00:01.000Z',
      panel_count: saved.panel_count + 1,
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
  });
});

function buildPage(): PageRecord {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    episode_id: '22222222-2222-4222-8222-222222222222',
    page_number: 1,
    layout_config: {},
    story_source_scene_ids: [],
    story_page_purpose: null,
    story_continuity_note: null,
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
