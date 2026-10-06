export type StyleReferenceTarget = 'character_reference' | 'manga_page';

export interface StyleReferenceAnchors {
  lineQuality: string | null;
  shapeLanguage: string | null;
  faceRendering: string | null;
  eyeRendering: string | null;
  hairRendering: string | null;
  clothingRendering: string | null;
  backgroundRendering: string | null;
  shadingRendering: string | null;
  textureFinish: string | null;
  motionTreatment: string | null;
  dialogueBalloonTreatment: string | null;
  atmosphere: string | null;
}

export interface StyleReferenceMetadata {
  title: string;
  notes: string | null;
  compiledBrief: string;
  anchors: StyleReferenceAnchors;
  compilerProvider: 'openai';
  compilerModel: string;
  compilerPromptVersion: string;
  compiledAt: string;
}

export function readStyleReferenceMetadata(value: unknown): StyleReferenceMetadata | null {
  if (!isRecord(value)) {
    return null;
  }

  const title = readNonEmptyString(value.title);
  const compiledBrief = readNonEmptyString(value.compiled_brief);
  const anchors = readStyleReferenceAnchors(value.anchors);
  const compilerProvider = value.compiler_provider;
  const compilerModel = readNonEmptyString(value.compiler_model);
  const compilerPromptVersion = readNonEmptyString(value.compiler_prompt_version);
  const compiledAt = readNonEmptyString(value.compiled_at);
  const notes = readNullableString(value.notes);

  if (
    title === null ||
    compiledBrief === null ||
    anchors === null ||
    compilerProvider !== 'openai' ||
    compilerModel === null ||
    compilerPromptVersion === null ||
    compiledAt === null
  ) {
    return null;
  }

  return {
    title,
    notes,
    compiledBrief,
    anchors,
    compilerProvider,
    compilerModel,
    compilerPromptVersion,
    compiledAt,
  };
}

export function toStoredStyleReferenceRecord(
  value: StyleReferenceMetadata,
): Record<string, unknown> {
  return {
    title: value.title,
    notes: value.notes,
    compiled_brief: value.compiledBrief,
    anchors: toStoredStyleReferenceAnchorsRecord(value.anchors),
    compiler_provider: value.compilerProvider,
    compiler_model: value.compilerModel,
    compiler_prompt_version: value.compilerPromptVersion,
    compiled_at: value.compiledAt,
  };
}

export function buildStyleAnchorLines(anchors: StyleReferenceAnchors): string[] {
  const lines = [
    labeledAnchor('line quality', anchors.lineQuality),
    labeledAnchor('shape language', anchors.shapeLanguage),
    labeledAnchor('face rendering', anchors.faceRendering),
    labeledAnchor('eye rendering', anchors.eyeRendering),
    labeledAnchor('hair rendering', anchors.hairRendering),
    labeledAnchor('clothing rendering', anchors.clothingRendering),
    labeledAnchor('background rendering', anchors.backgroundRendering),
    labeledAnchor('shading', anchors.shadingRendering),
    labeledAnchor('texture and finish', anchors.textureFinish),
    labeledAnchor('motion treatment', anchors.motionTreatment),
    labeledAnchor('dialogue and balloon treatment', anchors.dialogueBalloonTreatment),
    labeledAnchor('atmosphere', anchors.atmosphere),
  ];

  return lines.filter((value): value is string => value !== null);
}

export function buildRenderingStyleAnchorLines(anchors: StyleReferenceAnchors): string[] {
  const lines = [
    labeledAnchor('line quality', anchors.lineQuality),
    labeledAnchor('shading', anchors.shadingRendering),
    labeledAnchor('texture and finish', anchors.textureFinish),
    labeledAnchor('background rendering', anchors.backgroundRendering),
    labeledAnchor('motion treatment', anchors.motionTreatment),
    labeledAnchor('dialogue and balloon treatment', anchors.dialogueBalloonTreatment),
    labeledAnchor('atmosphere', anchors.atmosphere),
  ];

  return lines.filter((value): value is string => value !== null);
}

function labeledAnchor(label: string, value: string | null): string | null {
  return value === null ? null : `${label}: ${value}`;
}

function readStyleReferenceAnchors(value: unknown): StyleReferenceAnchors | null {
  if (!isRecord(value)) {
    return {
      lineQuality: null,
      shapeLanguage: null,
      faceRendering: null,
      eyeRendering: null,
      hairRendering: null,
      clothingRendering: null,
      backgroundRendering: null,
      shadingRendering: null,
      textureFinish: null,
      motionTreatment: null,
      dialogueBalloonTreatment: null,
      atmosphere: null,
    };
  }

  return {
    lineQuality: readNullableString(value.line_quality),
    shapeLanguage: readNullableString(value.shape_language),
    faceRendering: readNullableString(value.face_rendering),
    eyeRendering: readNullableString(value.eye_rendering),
    hairRendering: readNullableString(value.hair_rendering),
    clothingRendering: readNullableString(value.clothing_rendering),
    backgroundRendering: readNullableString(value.background_rendering),
    shadingRendering: readNullableString(value.shading_rendering),
    textureFinish: readNullableString(value.texture_finish),
    motionTreatment: readNullableString(value.motion_treatment),
    dialogueBalloonTreatment: readNullableString(value.dialogue_balloon_treatment),
    atmosphere: readNullableString(value.atmosphere),
  };
}

function toStoredStyleReferenceAnchorsRecord(
  value: StyleReferenceAnchors,
): Record<string, unknown> {
  return {
    line_quality: value.lineQuality,
    shape_language: value.shapeLanguage,
    face_rendering: value.faceRendering,
    eye_rendering: value.eyeRendering,
    hair_rendering: value.hairRendering,
    clothing_rendering: value.clothingRendering,
    background_rendering: value.backgroundRendering,
    shading_rendering: value.shadingRendering,
    texture_finish: value.textureFinish,
    motion_treatment: value.motionTreatment,
    dialogue_balloon_treatment: value.dialogueBalloonTreatment,
    atmosphere: value.atmosphere,
  };
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readNullableString(value: unknown): string | null {
  return typeof value === 'string' ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
