import type {
  CreateEntityPayload,
  UpdateEntityPayload,
} from '@/domain/payloads';
import type { EntityRecord, EntityType } from '@/domain/types';

export interface EntityVisibleDraft {
  entityType: EntityType;
  freeDescription: string | null;
  name: string;
  promptSupplement: string | null;
  structuredFields: Record<string, unknown>;
}

export interface EntityUpdateChangeSet {
  structuredFieldsChanged: boolean;
}

type EntityMutationSource = Pick<
  EntityRecord,
  | 'entity_type'
  | 'free_description'
  | 'name'
  | 'prompt_supplement'
  | 'structured_fields'
  | 'updated_at'
>;

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, canonicalize(record[key])]),
    );
  }
  return value;
};

const recordsEqual = (
  left: Record<string, unknown>,
  right: Record<string, unknown>,
): boolean => JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));

export const buildCreateEntityPayload = (
  draft: EntityVisibleDraft,
): CreateEntityPayload => ({
  entity_type: draft.entityType,
  name: draft.name.trim(),
  free_description: draft.freeDescription,
  prompt_supplement: draft.promptSupplement,
  speech_profile: {},
  structured_fields: draft.structuredFields,
});

export const buildUpdateEntityPayload = (
  current: EntityMutationSource,
  draft: EntityVisibleDraft,
  changes?: EntityUpdateChangeSet,
): UpdateEntityPayload => {
  const payload: UpdateEntityPayload = {
    expected_updated_at: current.updated_at,
  };
  const normalizedName = draft.name.trim();

  if (draft.entityType !== current.entity_type) {
    payload.entity_type = draft.entityType;
  }
  if (normalizedName !== current.name) {
    payload.name = normalizedName;
  }
  if (draft.freeDescription !== current.free_description) {
    payload.free_description = draft.freeDescription;
  }
  if (draft.promptSupplement !== current.prompt_supplement) {
    payload.prompt_supplement = draft.promptSupplement;
  }
  const structuredFieldsChanged =
    changes?.structuredFieldsChanged ??
    !recordsEqual(draft.structuredFields, current.structured_fields);
  if (structuredFieldsChanged) {
    payload.structured_fields = draft.structuredFields;
  }

  return payload;
};

export const hasEntityUpdateChanges = (
  payload: UpdateEntityPayload,
): boolean => Object.keys(payload).some((key) => key !== 'expected_updated_at');
