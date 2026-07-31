import type { PageRecord, UpdatePageSettingsInput } from '../lib/api';

export interface PageSettingsDraft {
  dialogue_mode: PageRecord['dialogue_mode'];
  page_dialogue_toggle: boolean;
}

export function createPageSettingsDraft(page: PageRecord): PageSettingsDraft {
  return {
    dialogue_mode: page.dialogue_mode,
    page_dialogue_toggle: page.page_dialogue_toggle,
  };
}

export function isPageSettingsDraftDirty(
  saved: PageSettingsDraft,
  draft: PageSettingsDraft,
): boolean {
  return saved.dialogue_mode !== draft.dialogue_mode
    || saved.page_dialogue_toggle !== draft.page_dialogue_toggle;
}

export function buildPageSettingsUpdate(
  saved: PageSettingsDraft,
  draft: PageSettingsDraft,
): UpdatePageSettingsInput {
  const payload: UpdatePageSettingsInput = {};
  if (saved.dialogue_mode !== draft.dialogue_mode) {
    payload.dialogue_mode = draft.dialogue_mode;
  }
  if (saved.page_dialogue_toggle !== draft.page_dialogue_toggle) {
    payload.page_dialogue_toggle = draft.page_dialogue_toggle;
  }
  return payload;
}

export function hasRemotePageSettingsChanged(
  saved: PageRecord,
  remote: PageRecord,
): boolean {
  return saved.id !== remote.id
    || saved.episode_id !== remote.episode_id
    || saved.dialogue_mode !== remote.dialogue_mode
    || saved.page_dialogue_toggle !== remote.page_dialogue_toggle;
}
