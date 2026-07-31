import type { PageRecord, UpdatePageSettingsInput } from '../lib/api';

const MAX_STYLE_REFERENCE_TITLE_LENGTH = 200;
const MAX_STYLE_REFERENCE_NOTES_LENGTH = 2_000;
const MAX_PAGE_PURPOSE_LENGTH = 500;
const MAX_CONTINUITY_NOTE_LENGTH = 1_000;

export interface PageSettingsDraft {
  dialogue_mode: PageRecord['dialogue_mode'];
  page_dialogue_toggle: boolean;
  story_continuity_note: string;
  story_page_purpose: string;
  style_reference_notes: string;
  style_reference_title: string;
}

export type PageSettingsDraftValidationReason =
  | 'style_title_required'
  | 'style_title_too_long'
  | 'style_notes_too_long'
  | 'page_purpose_too_long'
  | 'continuity_note_too_long';

export type PageSettingsUpdateResult =
  | { ok: true; payload: UpdatePageSettingsInput }
  | { ok: false; reason: PageSettingsDraftValidationReason };

interface NormalizedPageSettingsDraft {
  storyContinuityNote: string | null;
  storyPagePurpose: string | null;
  styleReferenceNotes: string | null;
  styleReferenceTitle: string;
}

export function createPageSettingsDraft(page: PageRecord): PageSettingsDraft {
  const styleReference = readStyleReference(page.layout_config);
  return {
    dialogue_mode: page.dialogue_mode,
    page_dialogue_toggle: page.page_dialogue_toggle,
    story_continuity_note: page.story_continuity_note ?? '',
    story_page_purpose: page.story_page_purpose ?? '',
    style_reference_notes: styleReference.notes,
    style_reference_title: styleReference.title,
  };
}

export function isPageSettingsDraftDirty(
  saved: PageSettingsDraft,
  draft: PageSettingsDraft,
): boolean {
  const savedNormalized = normalizePageSettingsDraft(saved);
  const draftNormalized = normalizePageSettingsDraft(draft);
  return saved.dialogue_mode !== draft.dialogue_mode
    || saved.page_dialogue_toggle !== draft.page_dialogue_toggle
    || savedNormalized.styleReferenceTitle !== draftNormalized.styleReferenceTitle
    || savedNormalized.styleReferenceNotes !== draftNormalized.styleReferenceNotes
    || savedNormalized.storyPagePurpose !== draftNormalized.storyPagePurpose
    || savedNormalized.storyContinuityNote !== draftNormalized.storyContinuityNote;
}

export function buildPageSettingsUpdate(
  saved: PageSettingsDraft,
  draft: PageSettingsDraft,
): PageSettingsUpdateResult {
  const savedNormalized = normalizePageSettingsDraft(saved);
  const draftNormalized = normalizePageSettingsDraft(draft);
  const validationError = validatePageSettingsDraft(draftNormalized);
  if (validationError !== null) {
    return { ok: false, reason: validationError };
  }

  const payload: UpdatePageSettingsInput = {};
  if (saved.dialogue_mode !== draft.dialogue_mode) {
    payload.dialogue_mode = draft.dialogue_mode;
  }
  if (saved.page_dialogue_toggle !== draft.page_dialogue_toggle) {
    payload.page_dialogue_toggle = draft.page_dialogue_toggle;
  }
  if (
    savedNormalized.styleReferenceTitle !== draftNormalized.styleReferenceTitle
    || savedNormalized.styleReferenceNotes !== draftNormalized.styleReferenceNotes
  ) {
    payload.style_reference = draftNormalized.styleReferenceTitle.length === 0
      ? null
      : {
          title: draftNormalized.styleReferenceTitle,
          notes: draftNormalized.styleReferenceNotes,
        };
  }
  if (savedNormalized.storyPagePurpose !== draftNormalized.storyPagePurpose) {
    payload.story_page_purpose = draftNormalized.storyPagePurpose;
  }
  if (savedNormalized.storyContinuityNote !== draftNormalized.storyContinuityNote) {
    payload.story_continuity_note = draftNormalized.storyContinuityNote;
  }
  return { ok: true, payload };
}

export function hasRemotePageSettingsChanged(
  saved: PageRecord,
  remote: PageRecord,
): boolean {
  return saved.id !== remote.id
    || saved.episode_id !== remote.episode_id
    || !sameStringArray(saved.story_source_scene_ids, remote.story_source_scene_ids)
    || isPageSettingsDraftDirty(
      createPageSettingsDraft(saved),
      createPageSettingsDraft(remote),
    );
}

function normalizePageSettingsDraft(draft: PageSettingsDraft): NormalizedPageSettingsDraft {
  return {
    storyContinuityNote: normalizeNullableText(draft.story_continuity_note),
    storyPagePurpose: normalizeNullableText(draft.story_page_purpose),
    styleReferenceNotes: normalizeNullableText(draft.style_reference_notes),
    styleReferenceTitle: draft.style_reference_title.trim(),
  };
}

function validatePageSettingsDraft(
  draft: NormalizedPageSettingsDraft,
): PageSettingsDraftValidationReason | null {
  if (draft.styleReferenceTitle.length > MAX_STYLE_REFERENCE_TITLE_LENGTH) {
    return 'style_title_too_long';
  }
  if (
    draft.styleReferenceNotes !== null
    && draft.styleReferenceNotes.length > MAX_STYLE_REFERENCE_NOTES_LENGTH
  ) {
    return 'style_notes_too_long';
  }
  if (draft.styleReferenceTitle.length === 0 && draft.styleReferenceNotes !== null) {
    return 'style_title_required';
  }
  if (
    draft.storyPagePurpose !== null
    && draft.storyPagePurpose.length > MAX_PAGE_PURPOSE_LENGTH
  ) {
    return 'page_purpose_too_long';
  }
  if (
    draft.storyContinuityNote !== null
    && draft.storyContinuityNote.length > MAX_CONTINUITY_NOTE_LENGTH
  ) {
    return 'continuity_note_too_long';
  }
  return null;
}

function readStyleReference(layoutConfig: Record<string, unknown>): {
  notes: string;
  title: string;
} {
  const rawStyleReference = layoutConfig.style_reference;
  if (!isRecord(rawStyleReference)) {
    return { notes: '', title: '' };
  }
  return {
    notes: typeof rawStyleReference.notes === 'string'
      ? rawStyleReference.notes.trim()
      : '',
    title: typeof rawStyleReference.title === 'string'
      ? rawStyleReference.title.trim()
      : '',
  };
}

function normalizeNullableText(value: string): string | null {
  const normalized = value.trim();
  return normalized.length === 0 ? null : normalized;
}

function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
