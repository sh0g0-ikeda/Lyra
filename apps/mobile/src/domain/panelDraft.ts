import type { PanelRecord, UpdatePanelInput } from '../lib/api';

const MAX_SITUATION_LENGTH = 2_000;
const MAX_COMPOSITION_TEXT_LENGTH = 1_000;
const MAX_SFX_LENGTH = 200;
const MAX_BACKGROUND_LENGTH = 2_000;
const MAX_NOTES_LENGTH = 2_000;
const MAX_DIALOGUE_LINES = 20;
const MAX_DIALOGUE_TEXT_LENGTH = 500;
const MAX_GALLERY_ITEM_ID_LENGTH = 100;

const requestShotTypes = [
  'full_body',
  'half_body',
  'close_up',
  'wide',
  'extreme_close_up',
] as const;
const requestAngles = [
  'front',
  'side',
  'three_quarter',
  'bird_eye',
  'worm_eye',
  'dutch_angle',
] as const;

export interface PanelDialogueDraft {
  entityId: string | null;
  position: PanelRecord['dialogue'][number]['position'];
  text: string;
  type: PanelRecord['dialogue'][number]['type'];
}

export interface PanelCompositionDraft {
  angle: string | null;
  compositionPrompt: string;
  customNote: string;
  galleryItemId: string | null;
  shotType: string | null;
  source: PanelRecord['composition']['source'];
}

export interface PanelDraft {
  backgroundNote: string;
  composition: PanelCompositionDraft;
  dialogue: PanelDialogueDraft[];
  dialogueInPanel: boolean;
  panelNotes: string;
  panelRole: PanelRecord['panel_role'];
  panelSize: PanelRecord['panel_size'];
  sfxText: string;
  situationText: string;
}

export type PanelDraftValidationReason =
  | 'situation_too_long'
  | 'composition_prompt_too_long'
  | 'composition_note_too_long'
  | 'composition_gallery_item_required'
  | 'composition_gallery_item_too_long'
  | 'composition_shot_type_unsupported'
  | 'composition_angle_unsupported'
  | 'sfx_too_long'
  | 'background_too_long'
  | 'notes_too_long'
  | 'too_many_dialogue_lines'
  | 'dialogue_text_required'
  | 'dialogue_text_too_long'
  | 'dialogue_speaker_required'
  | 'dialogue_speaker_not_assigned';

export type PanelUpdateResult =
  | { ok: true; payload: UpdatePanelInput }
  | { ok: false; reason: PanelDraftValidationReason };

interface NormalizedPanelDraft {
  backgroundNote: string | null;
  composition: {
    angle: string | null;
    compositionPrompt: string | null;
    customNote: string | null;
    galleryItemId: string | null;
    shotType: string | null;
    source: PanelRecord['composition']['source'];
  };
  dialogue: {
    entityId: string | null;
    position: PanelDialogueDraft['position'];
    text: string;
    type: PanelDialogueDraft['type'];
  }[];
  dialogueInPanel: boolean;
  panelNotes: string | null;
  panelRole: PanelDraft['panelRole'];
  panelSize: PanelDraft['panelSize'];
  sfxText: string | null;
  situationText: string | null;
}

export function createPanelDraft(panel: PanelRecord): PanelDraft {
  return {
    backgroundNote: panel.background_note ?? '',
    composition: {
      angle: panel.composition.angle,
      compositionPrompt: panel.composition.composition_prompt ?? '',
      customNote: panel.composition.custom_note ?? '',
      galleryItemId: panel.composition.gallery_item_id,
      shotType: panel.composition.shot_type,
      source: panel.composition.source,
    },
    dialogue: panel.dialogue.map((line) => ({
      entityId: line.entity_id,
      position: line.position,
      text: line.text,
      type: line.type,
    })),
    dialogueInPanel: panel.dialogue_in_panel,
    panelNotes: panel.panel_notes ?? '',
    panelRole: panel.panel_role,
    panelSize: panel.panel_size,
    sfxText: panel.sfx_text ?? '',
    situationText: panel.situation_text ?? '',
  };
}

export function isPanelDraftDirty(saved: PanelDraft, current: PanelDraft): boolean {
  return !sameValue(normalizePanelDraft(saved), normalizePanelDraft(current));
}

export function buildPanelUpdate(
  saved: PanelDraft,
  current: PanelDraft,
  assignedEntityIds: readonly string[],
): PanelUpdateResult {
  const savedNormalized = normalizePanelDraft(saved);
  const currentNormalized = normalizePanelDraft(current);
  const payload: UpdatePanelInput = {};

  if (currentNormalized.panelRole !== savedNormalized.panelRole) {
    payload.panel_role = currentNormalized.panelRole;
  }
  if (currentNormalized.panelSize !== savedNormalized.panelSize) {
    payload.panel_size = currentNormalized.panelSize;
  }
  if (currentNormalized.situationText !== savedNormalized.situationText) {
    if (exceeds(currentNormalized.situationText, MAX_SITUATION_LENGTH)) {
      return { ok: false, reason: 'situation_too_long' };
    }
    payload.situation_text = currentNormalized.situationText;
  }

  if (!sameValue(currentNormalized.composition, savedNormalized.composition)) {
    const compositionValidation = validateComposition(currentNormalized.composition);
    if (compositionValidation !== null) {
      return { ok: false, reason: compositionValidation };
    }
    const shotType = currentNormalized.composition.shotType;
    const angle = currentNormalized.composition.angle;
    if (shotType !== null && !isRequestShotType(shotType)) {
      return { ok: false, reason: 'composition_shot_type_unsupported' };
    }
    if (angle !== null && !isRequestAngle(angle)) {
      return { ok: false, reason: 'composition_angle_unsupported' };
    }
    payload.composition = {
      source: currentNormalized.composition.source,
      gallery_item_id: currentNormalized.composition.galleryItemId,
      composition_prompt: currentNormalized.composition.compositionPrompt,
      shot_type: shotType,
      angle,
      custom_note: currentNormalized.composition.customNote,
    };
  }

  if (currentNormalized.dialogueInPanel !== savedNormalized.dialogueInPanel) {
    payload.dialogue_in_panel = currentNormalized.dialogueInPanel;
  }
  if (!sameValue(currentNormalized.dialogue, savedNormalized.dialogue)) {
    const dialogueValidation = validateDialogue(currentNormalized.dialogue, assignedEntityIds);
    if (!dialogueValidation.ok) {
      return dialogueValidation;
    }
    payload.dialogue = dialogueValidation.dialogue;
  }
  if (currentNormalized.sfxText !== savedNormalized.sfxText) {
    if (exceeds(currentNormalized.sfxText, MAX_SFX_LENGTH)) {
      return { ok: false, reason: 'sfx_too_long' };
    }
    payload.sfx_text = currentNormalized.sfxText;
  }
  if (currentNormalized.backgroundNote !== savedNormalized.backgroundNote) {
    if (exceeds(currentNormalized.backgroundNote, MAX_BACKGROUND_LENGTH)) {
      return { ok: false, reason: 'background_too_long' };
    }
    payload.background_note = currentNormalized.backgroundNote;
  }
  if (currentNormalized.panelNotes !== savedNormalized.panelNotes) {
    if (exceeds(currentNormalized.panelNotes, MAX_NOTES_LENGTH)) {
      return { ok: false, reason: 'notes_too_long' };
    }
    payload.panel_notes = currentNormalized.panelNotes;
  }

  return { ok: true, payload };
}

function normalizePanelDraft(draft: PanelDraft): NormalizedPanelDraft {
  return {
    backgroundNote: nullableText(draft.backgroundNote),
    composition: {
      angle: nullableText(draft.composition.angle),
      compositionPrompt: nullableText(draft.composition.compositionPrompt),
      customNote: nullableText(draft.composition.customNote),
      galleryItemId: nullableText(draft.composition.galleryItemId),
      shotType: nullableText(draft.composition.shotType),
      source: draft.composition.source,
    },
    dialogue: draft.dialogue.map((line) => ({
      entityId: requiresSpeaker(line.type) ? nullableText(line.entityId) : null,
      position: line.position,
      text: line.text.trim(),
      type: line.type,
    })),
    dialogueInPanel: draft.dialogueInPanel,
    panelNotes: nullableText(draft.panelNotes),
    panelRole: draft.panelRole,
    panelSize: draft.panelSize,
    sfxText: nullableText(draft.sfxText),
    situationText: nullableText(draft.situationText),
  };
}

function validateComposition(
  composition: NormalizedPanelDraft['composition'],
): PanelDraftValidationReason | null {
  if (exceeds(composition.compositionPrompt, MAX_COMPOSITION_TEXT_LENGTH)) {
    return 'composition_prompt_too_long';
  }
  if (exceeds(composition.customNote, MAX_COMPOSITION_TEXT_LENGTH)) {
    return 'composition_note_too_long';
  }
  if (composition.source === 'gallery' && composition.galleryItemId === null) {
    return 'composition_gallery_item_required';
  }
  if (exceeds(composition.galleryItemId, MAX_GALLERY_ITEM_ID_LENGTH)) {
    return 'composition_gallery_item_too_long';
  }
  if (composition.shotType !== null && !isRequestShotType(composition.shotType)) {
    return 'composition_shot_type_unsupported';
  }
  if (composition.angle !== null && !isRequestAngle(composition.angle)) {
    return 'composition_angle_unsupported';
  }
  return null;
}

function validateDialogue(
  dialogue: NormalizedPanelDraft['dialogue'],
  assignedEntityIds: readonly string[],
):
  | { ok: true; dialogue: NonNullable<UpdatePanelInput['dialogue']> }
  | { ok: false; reason: PanelDraftValidationReason } {
  if (dialogue.length > MAX_DIALOGUE_LINES) {
    return { ok: false, reason: 'too_many_dialogue_lines' };
  }
  const assigned = new Set(assignedEntityIds);
  const normalized: NonNullable<UpdatePanelInput['dialogue']> = [];
  for (const line of dialogue) {
    if (line.text.length === 0) {
      return { ok: false, reason: 'dialogue_text_required' };
    }
    if (line.text.length > MAX_DIALOGUE_TEXT_LENGTH) {
      return { ok: false, reason: 'dialogue_text_too_long' };
    }
    if (requiresSpeaker(line.type) && line.entityId === null) {
      return { ok: false, reason: 'dialogue_speaker_required' };
    }
    if (line.entityId !== null && !assigned.has(line.entityId)) {
      return { ok: false, reason: 'dialogue_speaker_not_assigned' };
    }
    normalized.push({
      entity_id: line.entityId,
      text: line.text,
      type: line.type,
      position: line.position,
    });
  }
  return { ok: true, dialogue: normalized };
}

function requiresSpeaker(type: PanelDialogueDraft['type']): boolean {
  return type === 'speech' || type === 'thought' || type === 'shout' || type === 'whisper';
}

function isRequestShotType(value: string): value is NonNullable<
  NonNullable<UpdatePanelInput['composition']>['shot_type']
> {
  return (requestShotTypes as readonly string[]).includes(value);
}

function isRequestAngle(value: string): value is NonNullable<
  NonNullable<UpdatePanelInput['composition']>['angle']
> {
  return (requestAngles as readonly string[]).includes(value);
}

function nullableText(value: string | null): string | null {
  const normalized = value?.trim() ?? '';
  return normalized.length === 0 ? null : normalized;
}

function exceeds(value: string | null, maximum: number): boolean {
  return value !== null && value.length > maximum;
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
