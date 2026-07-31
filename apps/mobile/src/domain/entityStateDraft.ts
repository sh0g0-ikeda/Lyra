import type {
  CreateEntityStateInput,
  EntityStateRecord,
  UpdateEntityStateInput,
} from '../lib/api';

const MAX_NOTE_LENGTH = 2_000;
const MAX_EXPRESSION_LENGTH = 100;

export interface EntityStateDraft {
  scene_id: string | null;
  costume_note: string;
  condition_note: string;
  hair_note: string;
  expression_default: string;
  extra_note: string;
}

export type EntityStateDraftValidationReason =
  | 'costume_note_too_long'
  | 'condition_note_too_long'
  | 'hair_note_too_long'
  | 'expression_required'
  | 'expression_too_long'
  | 'extra_note_too_long';

export type EntityStateCreateResult =
  | { ok: true; payload: CreateEntityStateInput }
  | { ok: false; reason: EntityStateDraftValidationReason };

export type EntityStateUpdateResult =
  | { ok: true; payload: UpdateEntityStateInput }
  | { ok: false; reason: EntityStateDraftValidationReason };

interface NormalizedEntityStateDraft {
  sceneId: string | null;
  costumeNote: string | null;
  conditionNote: string | null;
  hairNote: string | null;
  expressionDefault: string;
  extraNote: string | null;
}

export function emptyEntityStateDraft(): EntityStateDraft {
  return {
    scene_id: null,
    costume_note: '',
    condition_note: '',
    hair_note: '',
    expression_default: 'neutral',
    extra_note: '',
  };
}

export function createEntityStateDraft(state: EntityStateRecord): EntityStateDraft {
  return {
    scene_id: state.scene_id,
    costume_note: state.costume_note ?? '',
    condition_note: state.condition_note ?? '',
    hair_note: state.hair_note ?? '',
    expression_default: state.expression_default,
    extra_note: state.extra_note ?? '',
  };
}

export function isEntityStateDraftDirty(
  saved: EntityStateDraft,
  draft: EntityStateDraft,
): boolean {
  const left = normalizeDraft(saved);
  const right = normalizeDraft(draft);
  return left.sceneId !== right.sceneId
    || left.costumeNote !== right.costumeNote
    || left.conditionNote !== right.conditionNote
    || left.hairNote !== right.hairNote
    || left.expressionDefault !== right.expressionDefault
    || left.extraNote !== right.extraNote;
}

export function buildEntityStateCreate(draft: EntityStateDraft): EntityStateCreateResult {
  const normalized = normalizeDraft(draft);
  const error = validateDraft(normalized);
  if (error !== null) {
    return { ok: false, reason: error };
  }
  return {
    ok: true,
    payload: {
      scene_id: normalized.sceneId,
      costume_note: normalized.costumeNote,
      condition_note: normalized.conditionNote,
      hair_note: normalized.hairNote,
      expression_default: normalized.expressionDefault,
      extra_note: normalized.extraNote,
    },
  };
}

export function buildEntityStateUpdate(
  saved: EntityStateDraft,
  draft: EntityStateDraft,
): EntityStateUpdateResult {
  const left = normalizeDraft(saved);
  const right = normalizeDraft(draft);
  const error = validateDraft(right);
  if (error !== null) {
    return { ok: false, reason: error };
  }
  const payload: UpdateEntityStateInput = {};
  if (left.sceneId !== right.sceneId) payload.scene_id = right.sceneId;
  if (left.costumeNote !== right.costumeNote) payload.costume_note = right.costumeNote;
  if (left.conditionNote !== right.conditionNote) payload.condition_note = right.conditionNote;
  if (left.hairNote !== right.hairNote) payload.hair_note = right.hairNote;
  if (left.expressionDefault !== right.expressionDefault) {
    payload.expression_default = right.expressionDefault;
  }
  if (left.extraNote !== right.extraNote) payload.extra_note = right.extraNote;
  return { ok: true, payload };
}

export function hasRemoteEntityStateChanged(
  saved: EntityStateRecord,
  remote: EntityStateRecord,
): boolean {
  return saved.id !== remote.id
    || saved.entity_id !== remote.entity_id
    || saved.scene_id !== remote.scene_id
    || saved.costume_note !== remote.costume_note
    || saved.costume_ref_id !== remote.costume_ref_id
    || saved.condition_note !== remote.condition_note
    || saved.hair_note !== remote.hair_note
    || saved.expression_default !== remote.expression_default
    || saved.extra_note !== remote.extra_note
    || saved.created_at !== remote.created_at;
}

function normalizeDraft(draft: EntityStateDraft): NormalizedEntityStateDraft {
  return {
    sceneId: draft.scene_id,
    costumeNote: normalizeNullableText(draft.costume_note),
    conditionNote: normalizeNullableText(draft.condition_note),
    hairNote: normalizeNullableText(draft.hair_note),
    expressionDefault: draft.expression_default.trim(),
    extraNote: normalizeNullableText(draft.extra_note),
  };
}

function validateDraft(
  draft: NormalizedEntityStateDraft,
): EntityStateDraftValidationReason | null {
  if ((draft.costumeNote?.length ?? 0) > MAX_NOTE_LENGTH) return 'costume_note_too_long';
  if ((draft.conditionNote?.length ?? 0) > MAX_NOTE_LENGTH) return 'condition_note_too_long';
  if ((draft.hairNote?.length ?? 0) > MAX_NOTE_LENGTH) return 'hair_note_too_long';
  if (draft.expressionDefault.length === 0) return 'expression_required';
  if (draft.expressionDefault.length > MAX_EXPRESSION_LENGTH) return 'expression_too_long';
  if ((draft.extraNote?.length ?? 0) > MAX_NOTE_LENGTH) return 'extra_note_too_long';
  return null;
}

function normalizeNullableText(value: string): string | null {
  const normalized = value.trim();
  return normalized.length === 0 ? null : normalized;
}
