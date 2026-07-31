import type { EntityRecord } from '../lib/api';

export type EntityType = 'character' | 'nonhuman' | 'object';

export interface EntityDraft {
  entityType: EntityType;
  name: string;
  freeDescription: string;
}

export interface CreateEntityInput {
  entity_type: EntityType;
  name: string;
  free_description: string | null;
}

export type UpdateEntityInput =
  | { name: string; free_description?: string | null }
  | { name?: never; free_description: string | null };

export type EntityDraftValidationReason =
  | 'name_required'
  | 'name_too_long'
  | 'description_too_long';

type CreateEntityInputResult =
  | { ok: true; input: CreateEntityInput }
  | { ok: false; reason: EntityDraftValidationReason };

type UpdateEntityInputResult =
  | { ok: true; input: UpdateEntityInput }
  | { ok: false; reason: EntityDraftValidationReason | 'no_changes' };

const MAX_ENTITY_NAME_LENGTH = 100;
const MAX_ENTITY_DESCRIPTION_LENGTH = 2_000;

export function emptyEntityDraft(): EntityDraft {
  return {
    entityType: 'character',
    name: '',
    freeDescription: '',
  };
}

export function createEntityDraft(entity: EntityRecord): EntityDraft {
  return {
    entityType: entity.entity_type,
    name: entity.name,
    freeDescription: entity.free_description ?? '',
  };
}

export function isEntityDraftDirty(
  savedEntity: EntityRecord | null,
  draft: EntityDraft,
): boolean {
  const savedDraft = savedEntity === null
    ? emptyEntityDraft()
    : createEntityDraft(savedEntity);
  return savedDraft.entityType !== draft.entityType
    || savedDraft.name !== normalizeName(draft.name)
    || normalizeDescription(savedDraft.freeDescription)
      !== normalizeDescription(draft.freeDescription);
}

export function buildCreateEntityInput(
  draft: EntityDraft,
): CreateEntityInputResult {
  const validation = validateEntityDraft(draft);
  if (validation !== null) {
    return { ok: false, reason: validation };
  }
  return {
    ok: true,
    input: {
      entity_type: draft.entityType,
      name: normalizeName(draft.name),
      free_description: normalizeDescription(draft.freeDescription),
    },
  };
}

export function buildUpdateEntityInput(
  savedEntity: EntityRecord,
  draft: EntityDraft,
): UpdateEntityInputResult {
  const validation = validateEntityDraft(draft);
  if (validation !== null) {
    return { ok: false, reason: validation };
  }

  const input: { name?: string; free_description?: string | null } = {};
  const normalizedName = normalizeName(draft.name);
  const normalizedDescription = normalizeDescription(draft.freeDescription);
  if (savedEntity.name !== normalizedName) {
    input.name = normalizedName;
  }
  if (savedEntity.free_description !== normalizedDescription) {
    input.free_description = normalizedDescription;
  }
  if (Object.keys(input).length === 0) {
    return { ok: false, reason: 'no_changes' };
  }
  return { ok: true, input: input as UpdateEntityInput };
}

function validateEntityDraft(
  draft: EntityDraft,
): EntityDraftValidationReason | null {
  const name = normalizeName(draft.name);
  if (name.length === 0) {
    return 'name_required';
  }
  if (name.length > MAX_ENTITY_NAME_LENGTH) {
    return 'name_too_long';
  }
  if (draft.freeDescription.length > MAX_ENTITY_DESCRIPTION_LENGTH) {
    return 'description_too_long';
  }
  return null;
}

function normalizeName(value: string): string {
  return value.trim();
}

function normalizeDescription(value: string): string | null {
  return value.length === 0 ? null : value;
}
