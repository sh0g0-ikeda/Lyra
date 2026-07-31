import type { SceneRecord, UpdateSceneInput } from '../lib/api';

const MAX_SCENE_TEXT_LENGTH = 200;

export interface SceneDraft {
  atmosphere: string;
  location: string;
  time: string;
}

export type SceneDraftValidationReason =
  | 'location_too_long'
  | 'time_too_long'
  | 'atmosphere_too_long';

export type SceneUpdateResult =
  | { ok: true; payload: UpdateSceneInput }
  | { ok: false; reason: SceneDraftValidationReason };

export function createSceneDraft(scene: SceneRecord): SceneDraft {
  return {
    atmosphere: scene.atmosphere ?? '',
    location: scene.location ?? '',
    time: scene.time ?? '',
  };
}

export function isSceneDraftDirty(saved: SceneDraft, current: SceneDraft): boolean {
  const savedNormalized = normalizeDraft(saved);
  const currentNormalized = normalizeDraft(current);
  return savedNormalized.atmosphere !== currentNormalized.atmosphere
    || savedNormalized.location !== currentNormalized.location
    || savedNormalized.time !== currentNormalized.time;
}

export function buildSceneUpdate(saved: SceneDraft, current: SceneDraft): SceneUpdateResult {
  const savedNormalized = normalizeDraft(saved);
  const currentNormalized = normalizeDraft(current);
  if (currentNormalized.location !== null && currentNormalized.location.length > MAX_SCENE_TEXT_LENGTH) {
    return { ok: false, reason: 'location_too_long' };
  }
  if (currentNormalized.time !== null && currentNormalized.time.length > MAX_SCENE_TEXT_LENGTH) {
    return { ok: false, reason: 'time_too_long' };
  }
  if (currentNormalized.atmosphere !== null && currentNormalized.atmosphere.length > MAX_SCENE_TEXT_LENGTH) {
    return { ok: false, reason: 'atmosphere_too_long' };
  }

  const payload: UpdateSceneInput = {};
  if (currentNormalized.location !== savedNormalized.location) {
    payload.location = currentNormalized.location;
  }
  if (currentNormalized.time !== savedNormalized.time) {
    payload.time = currentNormalized.time;
  }
  if (currentNormalized.atmosphere !== savedNormalized.atmosphere) {
    payload.atmosphere = currentNormalized.atmosphere;
  }
  return { ok: true, payload };
}

function normalizeDraft(draft: SceneDraft): {
  atmosphere: string | null;
  location: string | null;
  time: string | null;
} {
  return {
    atmosphere: normalizeNullableText(draft.atmosphere),
    location: normalizeNullableText(draft.location),
    time: normalizeNullableText(draft.time),
  };
}

function normalizeNullableText(value: string): string | null {
  const normalized = value.trim();
  return normalized.length === 0 ? null : normalized;
}
