import type { PanelRecord } from '../lib/api';

const MAX_ASSIGNMENTS = 8;
const MAX_BACKEND_ASSIGNMENTS = 20;
const MAX_CUSTOM_TEXT_LENGTH = 100;
const MAX_EFFECT_NOTE_LENGTH = 200;

export type PanelEntityAssignmentDraft = PanelRecord['entities'][number];

export interface PanelEntityAssignmentReplacementBody {
  entities: PanelEntityAssignmentDraft[];
  expected_entities: PanelEntityAssignmentDraft[];
}

export type PanelEntityAssignmentValidationReason =
  | 'saved_snapshot_invalid'
  | 'too_many_assignments'
  | 'duplicate_entity'
  | 'custom_expression_required'
  | 'custom_expression_too_long'
  | 'custom_action_required'
  | 'custom_action_too_long'
  | 'effect_note_too_long'
  | 'dialogue_speaker_not_assigned';

export type PanelEntityAssignmentReplacementResult =
  | { ok: true; body: PanelEntityAssignmentReplacementBody }
  | { ok: false; reason: PanelEntityAssignmentValidationReason };

export function createPanelEntityAssignmentDraft(
  assignments: readonly PanelEntityAssignmentDraft[],
): PanelEntityAssignmentDraft[] {
  return assignments.map((assignment) => ({ ...assignment }));
}

export function createDefaultPanelEntityAssignment(
  entityId: string,
): PanelEntityAssignmentDraft {
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
  };
}

export function isPanelEntityAssignmentDraftDirty(
  saved: readonly PanelEntityAssignmentDraft[],
  draft: readonly PanelEntityAssignmentDraft[],
): boolean {
  return !samePanelEntityAssignments(saved, draft);
}

export function samePanelEntityAssignments(
  left: readonly PanelEntityAssignmentDraft[],
  right: readonly PanelEntityAssignmentDraft[],
): boolean {
  return JSON.stringify(left.map(normalizeAssignment))
    === JSON.stringify(right.map(normalizeAssignment));
}

export function buildPanelEntityAssignmentReplacement(
  saved: readonly PanelEntityAssignmentDraft[],
  draft: readonly PanelEntityAssignmentDraft[],
  requiredSpeakerEntityIds: readonly string[],
): PanelEntityAssignmentReplacementResult {
  if (!isValidSavedSnapshot(saved)) {
    return { ok: false, reason: 'saved_snapshot_invalid' };
  }
  if (draft.length > MAX_ASSIGNMENTS) {
    return { ok: false, reason: 'too_many_assignments' };
  }
  if (hasDuplicateEntityIds(draft)) {
    return { ok: false, reason: 'duplicate_entity' };
  }

  for (const assignment of draft) {
    const validationReason = validateAssignment(assignment);
    if (validationReason !== null) {
      return { ok: false, reason: validationReason };
    }
  }

  const assignedEntityIds = new Set(draft.map((assignment) => assignment.entity_id));
  if (requiredSpeakerEntityIds.some((entityId) => !assignedEntityIds.has(entityId))) {
    return { ok: false, reason: 'dialogue_speaker_not_assigned' };
  }

  return {
    ok: true,
    body: {
      entities: draft.map(normalizeAssignment),
      expected_entities: saved.map(normalizeAssignment),
    },
  };
}

function isValidSavedSnapshot(assignments: readonly PanelEntityAssignmentDraft[]): boolean {
  return assignments.length <= MAX_BACKEND_ASSIGNMENTS
    && !hasDuplicateEntityIds(assignments)
    && assignments.every((assignment) => validateAssignment(assignment) === null);
}

function hasDuplicateEntityIds(
  assignments: readonly PanelEntityAssignmentDraft[],
): boolean {
  const entityIds = new Set<string>();
  for (const assignment of assignments) {
    if (entityIds.has(assignment.entity_id)) {
      return true;
    }
    entityIds.add(assignment.entity_id);
  }
  return false;
}

function validateAssignment(
  assignment: PanelEntityAssignmentDraft,
): PanelEntityAssignmentValidationReason | null {
  if (assignment.expression === 'custom') {
    const customExpression = assignment.custom_expression?.trim() ?? '';
    if (customExpression.length === 0) {
      return 'custom_expression_required';
    }
    if (customExpression.length > MAX_CUSTOM_TEXT_LENGTH) {
      return 'custom_expression_too_long';
    }
  }
  if (assignment.action === 'custom') {
    const customAction = assignment.custom_action?.trim() ?? '';
    if (customAction.length === 0) {
      return 'custom_action_required';
    }
    if (customAction.length > MAX_CUSTOM_TEXT_LENGTH) {
      return 'custom_action_too_long';
    }
  }
  if ((assignment.effect_note?.trim().length ?? 0) > MAX_EFFECT_NOTE_LENGTH) {
    return 'effect_note_too_long';
  }
  return null;
}

function normalizeAssignment(
  assignment: PanelEntityAssignmentDraft,
): PanelEntityAssignmentDraft {
  return {
    entity_id: assignment.entity_id,
    role: assignment.role,
    expression: assignment.expression,
    custom_expression: assignment.expression === 'custom'
      ? nullableText(assignment.custom_expression)
      : null,
    action: assignment.action,
    custom_action: assignment.action === 'custom'
      ? nullableText(assignment.custom_action)
      : null,
    position: assignment.position,
    facing_direction: assignment.facing_direction,
    effect_note: nullableText(assignment.effect_note),
    state_id: assignment.state_id,
  };
}

function nullableText(value: string | null): string | null {
  const normalized = value?.trim() ?? '';
  return normalized.length === 0 ? null : normalized;
}
