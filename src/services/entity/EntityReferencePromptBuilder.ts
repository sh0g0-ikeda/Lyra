import type { EntityReferenceContext } from '../../domain/types/entityReference.js';
import {
  buildRenderingStyleAnchorLines,
  buildStyleAnchorLines,
  readStyleReferenceMetadata,
} from '../../domain/types/styleReference.js';

export interface EntityReferencePromptBuilderPort {
  buildGenerationPrompt(context: EntityReferenceContext): string;
  buildCompilerBrief(context: EntityReferenceContext): string;
}

interface CharacterPromptDetails {
  genderExpression: string | null;
  ageRange: string | null;
  skinTone: string | null;
  firstImpression: string | null;
  standingStyle: string | null;
  defaultExpression: string | null;
  visualAnchor: string | null;
  signatureFeature: string | null;
  silhouetteKeywords: string[];
  headToBodyRatio: string | null;
  shoulderWidth: string | null;
  legLength: string | null;
  postureAxis: string | null;
  faceShape: string | null;
  eyebrowShape: string | null;
  noseShape: string | null;
  mouthShape: string | null;
  eyeSize: string | null;
  eyeAngle: string | null;
  pupilStyle: string | null;
  underEyeDetail: string | null;
  mouthDefault: string | null;
  height: string | null;
  build: string | null;
  hairColor: string | null;
  hairLength: string | null;
  hairStyle: string | null;
  hairArrangement: string | null;
  hairBangs: string | null;
  hairFrontShape: string | null;
  hairSideHair: string | null;
  hairBackShape: string | null;
  eyeColor: string | null;
  eyeShape: string | null;
  eyeEyelidType: string | null;
  clothingCategory: string | null;
  clothingMainColor: string | null;
  outfitImpression: string | null;
  clothingDescription: string | null;
  collarShape: string | null;
  sleeveLength: string | null;
  skirtOrPantsShape: string | null;
  shoes: string | null;
  socksOrLegwear: string | null;
  distinguishingFeatures: string | null;
  artStyle: string | null;
}

/**
 * Builds both the fallback prompt and the compiler brief from normalized entity data.
 * The prompt is optimized for reproducible manga character references rather than one-off beauty shots.
 */
export class EntityReferencePromptBuilder implements EntityReferencePromptBuilderPort {
  public buildGenerationPrompt(context: EntityReferenceContext): string {
    if (context.entityType !== 'character') {
      return buildNonCharacterPrompt(context);
    }

    const details = parseCharacterDetails(context.structuredFields);
    const styleReference = readStyleReferenceMetadata(context.structuredFields.style_reference);
    const promptParts = [
      buildStyleReferenceConstraint(styleReference),
      buildCharacterOpening(context, details),
      buildCharacterPoseSentence(details),
      buildSilhouetteSentence(details),
      buildFaceSentence(details),
      buildHairSentence(details),
      buildOutfitSentence(details),
      buildAnchorSentence(details),
      buildPersonalityCueSentence(context, details),
      buildSupplementSentence(context.promptSupplement),
      CHARACTER_HARD_CONSTRAINTS_SENTENCE,
    ].filter(isNonEmpty);

    return promptParts.join(' ');
  }

  public buildCompilerBrief(context: EntityReferenceContext): string {
    if (context.entityType !== 'character') {
      return [
        `Target image: ${context.entityType === 'object' ? 'manga object reference' : 'manga creature reference'}`,
        `Subject name: ${context.name}`,
        context.freeDescription === null ? null : `Core concept: ${normalizeImagePromptSentence(context.freeDescription)}`,
        summarizeLooseStructuredFieldsLine(context.structuredFields),
        context.promptSupplement === null ? null : `Must keep: ${normalizeImagePromptSentence(context.promptSupplement)}`,
        buildImageSafetyInterpretationLine(context),
        `Hard constraints: ${hardConstraintsTextForEntityType(context.entityType)}`,
      ]
        .filter(isNonEmpty)
        .join('\n');
    }

    const details = parseCharacterDetails(context.structuredFields);
    const styleReference = readStyleReferenceMetadata(context.structuredFields.style_reference);
    const lines = [
      'Target image: manga full-body character reference',
      `Subject name: ${context.name}`,
      context.freeDescription === null ? null : `Core concept: ${normalizeImagePromptSentence(context.freeDescription)}`,
      labeledLine('First-glance impression', [details.firstImpression]),
      labeledLine('Character visual anchor', [details.visualAnchor]),
      labeledLine('Signature feature', [details.signatureFeature, details.distinguishingFeatures]),
      labeledLine('Stable silhouette', buildSilhouetteValues(details)),
      labeledLine('Visual identity', [
        details.genderExpression,
        details.ageRange,
        details.skinTone,
        details.height,
        details.build,
      ]),
      labeledLine('Body proportion read', [
        details.headToBodyRatio,
        details.shoulderWidth,
        details.legLength,
        details.postureAxis,
        details.standingStyle,
      ]),
      labeledLine('Face detail read', buildFaceValues(details)),
      labeledLine('Hair construction', buildHairValues(details)),
      labeledLine('Outfit construction', buildOutfitValues(details)),
      styleReference === null ? null : `Style reference title: ${styleReference.title}`,
      styleReference === null ? null : `Style reference interpretation: ${styleReference.compiledBrief}`,
      styleReference === null
        ? null
        : labeledLine('Style anchors', buildStyleAnchorLines(styleReference.anchors)),
      labeledLine('Render style', [details.artStyle]),
      labeledLine('Personality-to-visual cue', [buildPersonalityCue(details, context.freeDescription)]),
      context.promptSupplement === null ? null : `Must keep: ${normalizeImagePromptSentence(context.promptSupplement)}`,
      buildImageSafetyInterpretationLine(context),
      `Hard constraints: ${CHARACTER_HARD_CONSTRAINTS_TEXT}`,
    ].filter(isNonEmpty);

    return lines.join('\n');
  }
}

const CHARACTER_HARD_CONSTRAINTS_TEXT =
  'exactly one subject, centered, full figure visible from head to toe, both hands visible, both feet visible, plain neutral background, no text, no watermark, no extra props unless explicitly requested, no extra characters.';
const CHARACTER_HARD_CONSTRAINTS_SENTENCE =
  'Keep exactly one centered subject, show the full figure from head to toe with both hands and both feet visible, use a plain neutral background, and include no text, watermark, extra props, or extra characters.';
const NONHUMAN_HARD_CONSTRAINTS_TEXT =
  'exactly one subject, centered, full form visible, plain neutral background, no text, no watermark, no extra props unless explicitly requested, no extra characters.';
const OBJECT_HARD_CONSTRAINTS_TEXT =
  'exactly one object, centered, full object visible, plain neutral background, no text, no watermark, no extra props unless explicitly requested.';

function hardConstraintsTextForEntityType(entityType: EntityReferenceContext['entityType']): string {
  if (entityType === 'object') {
    return OBJECT_HARD_CONSTRAINTS_TEXT;
  }

  if (entityType === 'nonhuman') {
    return NONHUMAN_HARD_CONSTRAINTS_TEXT;
  }

  return CHARACTER_HARD_CONSTRAINTS_TEXT;
}

function buildCharacterOpening(
  context: EntityReferenceContext,
  details: CharacterPromptDetails,
): string {
  const identity = [
    details.height,
    details.build,
    details.ageRange,
    details.skinTone,
    details.genderExpression,
  ].filter(isNonEmpty).join(', ');
  const impression = details.firstImpression;

  const descriptors = [identity, impression].filter(isNonEmpty).join(' with ');
  if (descriptors.length === 0) {
    return `Create a clean full-body manga character reference of ${context.name}.`;
  }

  return `Create a clean full-body manga character reference of ${context.name}, ${articlelessPhrase(descriptors)}.`;
}

function buildCharacterPoseSentence(details: CharacterPromptDetails): string | null {
  const poseParts = [
    details.standingStyle,
    details.postureAxis,
    details.defaultExpression === null ? null : `with ${details.defaultExpression}`,
  ].filter(isNonEmpty);

  if (poseParts.length === 0) {
    return 'Show the character in a neutral standing pose.';
  }

  return `Show the character in a neutral standing pose, ${poseParts.join(', ')}.`;
}

function buildSilhouetteSentence(details: CharacterPromptDetails): string | null {
  const values = buildSilhouetteValues(details);
  if (values.length === 0) {
    return null;
  }

  return `The silhouette should stay stable and easy to recognize: ${joinPhrases(values)}.`;
}

function buildFaceSentence(details: CharacterPromptDetails): string | null {
  const values = buildFaceValues(details);
  if (values.length === 0) {
    return null;
  }

  return `The face should read clearly with ${joinPhrases(values)}.`;
}

function buildHairSentence(details: CharacterPromptDetails): string | null {
  const values = buildHairValues(details);
  if (values.length === 0) {
    return null;
  }

  return `The hair design should stay consistent, with ${joinPhrases(values)}.`;
}

function buildOutfitSentence(details: CharacterPromptDetails): string | null {
  const values = buildOutfitValues(details);
  if (values.length === 0) {
    return null;
  }

  return `The outfit should be easy to read at a glance, with ${joinPhrases(values)}.`;
}

function buildAnchorSentence(details: CharacterPromptDetails): string | null {
  const anchorParts = [
    details.visualAnchor === null ? null : `keep ${details.visualAnchor} as a stable visual anchor`,
    details.signatureFeature === null ? null : `make ${details.signatureFeature} the first memorable feature`,
  ].filter(isNonEmpty);

  if (anchorParts.length === 0) {
    return null;
  }

  return `${capitalize(anchorParts.join(', and '))}.`;
}

function buildStyleReferenceConstraint(
  styleReference: ReturnType<typeof readStyleReferenceMetadata>,
): string | null {
  if (styleReference === null) {
    return null;
  }

  const anchorLines = buildRenderingStyleAnchorLines(styleReference.anchors);
  const anchors =
    anchorLines.length === 0
      ? null
      : `Apply these rendering-style anchors through line treatment, shading, finish, and atmosphere only: ${anchorLines.join('; ')}.`;
  const notes =
    styleReference.notes === null ? null : `User notes: ${normalizeSentence(styleReference.notes)}.`;
  return [
    `Use the named style reference "${styleReference.title}" as a hard rendering constraint.`,
    `Style interpretation: ${styleReference.compiledBrief}`,
    'Do not let the style reference change the character identity defined by the authored face shape, eye shape, hair silhouette, body proportions, or outfit silhouette.',
    anchors,
    notes,
  ]
    .filter(isNonEmpty)
    .join(' ');
}

function buildPersonalityCueSentence(
  context: EntityReferenceContext,
  details: CharacterPromptDetails,
): string | null {
  const cue = buildPersonalityCue(details, context.freeDescription);
  if (cue === null) {
    return null;
  }

  return `${cue} Keep the cue subtle within a calm neutral reference, without turning it into scene acting or dramatic staging.`;
}

function buildSupplementSentence(promptSupplement: string | null): string | null {
  if (promptSupplement === null || promptSupplement.trim().length === 0) {
    return null;
  }

  return `Additional direction: ${normalizeImagePromptSentence(promptSupplement)}.`;
}

function buildNonCharacterPrompt(context: EntityReferenceContext): string {
  const summary = summarizeLooseStructuredFields(context.structuredFields);
  const parts = [
    context.entityType === 'object'
      ? `Create a clean manga object reference of ${context.name}.`
      : `Create a clean manga creature reference of ${context.name}.`,
    context.freeDescription === null ? null : `Core concept: ${normalizeImagePromptSentence(context.freeDescription)}.`,
    summary.length === 0 ? null : `Design details: ${summary}.`,
    buildSupplementSentence(context.promptSupplement),
    buildImageSafetyInterpretationLine(context),
    context.entityType === 'object'
      ? 'Keep one centered subject on a plain neutral background with no text or watermark.'
      : 'Keep one centered subject fully visible on a plain neutral background with no text or watermark.',
  ];

  return parts.filter(isNonEmpty).join(' ');
}

function buildSilhouetteValues(details: CharacterPromptDetails): string[] {
  return [
    details.visualAnchor,
    ...details.silhouetteKeywords,
    details.shoulderWidth,
    details.legLength,
    details.headToBodyRatio,
    details.clothingDescription === null ? null : summarizeClothingSilhouette(details.clothingDescription),
  ].filter(isNonEmpty);
}

function buildFaceValues(details: CharacterPromptDetails): string[] {
  return [
    details.faceShape === null ? null : `${details.faceShape} face`,
    details.eyebrowShape === null ? null : `${details.eyebrowShape} eyebrows`,
    details.noseShape === null ? null : `${details.noseShape} nose`,
    details.mouthShape === null ? null : `${details.mouthShape} mouth shape`,
    details.eyeColor === null ? null : `${details.eyeColor} eyes`,
    details.eyeShape,
    details.eyeEyelidType,
    details.eyeSize,
    details.eyeAngle,
    details.pupilStyle,
    details.underEyeDetail,
    details.mouthDefault,
  ].filter(isNonEmpty);
}

function buildHairValues(details: CharacterPromptDetails): string[] {
  return [
    details.hairColor === null ? null : `${details.hairColor} hair`,
    details.hairLength,
    details.hairStyle,
    details.hairArrangement,
    details.hairBangs,
    details.hairFrontShape,
    details.hairSideHair,
    details.hairBackShape,
  ].filter(isNonEmpty);
}

function buildOutfitValues(details: CharacterPromptDetails): string[] {
  return [
    details.clothingCategory,
    details.clothingMainColor,
    details.outfitImpression,
    details.clothingDescription,
    details.collarShape,
    details.sleeveLength,
    details.skirtOrPantsShape,
    details.shoes,
    details.socksOrLegwear,
  ].filter(isNonEmpty);
}

function parseCharacterDetails(value: Record<string, unknown>): CharacterPromptDetails {
  const hair = asRecord(value.hair);
  const eyes = asRecord(value.eyes);
  const clothing = asRecord(value.clothing);
  const characterIdentity = asRecord(value.character_identity);
  const proportions = asRecord(value.proportions);
  const faceDetail = asRecord(value.face_detail);
  const hairDetail = asRecord(value.hair_detail);
  const outfitDetail = asRecord(value.outfit_detail);

  return {
    genderExpression: mapSimpleValue(value.gender_expression),
    ageRange: mapCharacterPhrase(value.age_range, AGE_RANGE_PHRASES),
    skinTone: mapCharacterPhrase(value.skin_tone, SKIN_TONE_PHRASES),
    firstImpression: mapCharacterPhrase(value.first_impression, FIRST_IMPRESSION_PHRASES),
    standingStyle: mapCharacterPhrase(value.standing_style, STANDING_STYLE_PHRASES),
    defaultExpression: mapCharacterPhrase(value.default_expression, DEFAULT_EXPRESSION_PHRASES),
    visualAnchor: mapFreeText(characterIdentity?.visual_anchor),
    signatureFeature: mapFreeText(characterIdentity?.signature_feature),
    silhouetteKeywords: mapStringArray(characterIdentity?.silhouette_keywords),
    headToBodyRatio: mapCharacterPhrase(proportions?.head_to_body_ratio, HEAD_TO_BODY_RATIO_PHRASES),
    shoulderWidth: mapCharacterPhrase(proportions?.shoulder_width, SHOULDER_WIDTH_PHRASES),
    legLength: mapCharacterPhrase(proportions?.leg_length, LEG_LENGTH_PHRASES),
    postureAxis: mapFreeText(proportions?.posture_axis),
    faceShape: mapSimpleValue(value.face_shape),
    eyebrowShape: mapSimpleValue(value.eyebrow_shape),
    noseShape: mapSimpleValue(value.nose_shape),
    mouthShape: mapSimpleValue(value.mouth_shape),
    eyeSize: mapCharacterPhrase(faceDetail?.eye_size, EYE_SIZE_PHRASES),
    eyeAngle: mapCharacterPhrase(faceDetail?.eye_angle, EYE_ANGLE_PHRASES),
    pupilStyle: mapCharacterPhrase(faceDetail?.pupil_style, PUPIL_STYLE_PHRASES),
    underEyeDetail: mapCharacterPhrase(faceDetail?.under_eye_detail, UNDER_EYE_DETAIL_PHRASES),
    mouthDefault: mapCharacterPhrase(faceDetail?.mouth_default, MOUTH_DEFAULT_PHRASES),
    height: mapCharacterPhrase(value.height, HEIGHT_PHRASES),
    build: mapCharacterPhrase(value.build, BUILD_PHRASES),
    hairColor: mapSimpleValue(hair?.color),
    hairLength: mapCharacterPhrase(hair?.length, HAIR_LENGTH_PHRASES),
    hairStyle: mapCharacterPhrase(hair?.style, HAIR_STYLE_PHRASES),
    hairArrangement: mapCharacterPhrase(hair?.arrangement, HAIR_ARRANGEMENT_PHRASES),
    hairBangs: mapCharacterPhrase(hair?.bangs, HAIR_BANGS_PHRASES),
    hairFrontShape: mapCharacterPhrase(hairDetail?.front_shape, HAIR_FRONT_SHAPE_PHRASES),
    hairSideHair: mapCharacterPhrase(hairDetail?.side_hair, HAIR_SIDE_PHRASES),
    hairBackShape: mapCharacterPhrase(hairDetail?.back_shape, HAIR_BACK_SHAPE_PHRASES),
    eyeColor: mapSimpleValue(eyes?.color),
    eyeShape: mapCharacterPhrase(eyes?.shape, EYE_SHAPE_PHRASES),
    eyeEyelidType: mapCharacterPhrase(eyes?.eyelid_type, EYE_EYELID_PHRASES),
    clothingCategory: mapCharacterPhrase(clothing?.category, CLOTHING_CATEGORY_PHRASES),
    clothingMainColor: mapSimpleValue(clothing?.main_color),
    outfitImpression: mapCharacterPhrase(clothing?.impression, OUTFIT_IMPRESSION_PHRASES),
    clothingDescription: mapFreeText(clothing?.description),
    collarShape: mapCharacterPhrase(outfitDetail?.collar_shape, COLLAR_SHAPE_PHRASES),
    sleeveLength: mapCharacterPhrase(outfitDetail?.sleeve_length, SLEEVE_LENGTH_PHRASES),
    skirtOrPantsShape: mapCharacterPhrase(outfitDetail?.skirt_or_pants_shape, BOTTOM_SHAPE_PHRASES),
    shoes: mapFreeText(outfitDetail?.shoes),
    socksOrLegwear: mapFreeText(outfitDetail?.socks_or_legwear),
    distinguishingFeatures: mapFreeText(value.distinguishing_features),
    artStyle: mapCharacterPhrase(value.art_style, ART_STYLE_PHRASES),
  };
}

function buildPersonalityCue(
  details: CharacterPromptDetails,
  freeDescription: string | null,
): string | null {
  const source = freeDescription === null ? '' : freeDescription.toLowerCase();
  const cues: string[] = [];

  if (source.includes('hidden violent streak')) {
    cues.push(
      'Her calm expression should carry a faint unsettling tension, as if she is carefully suppressing something dangerous.',
    );
  }

  if (source.includes('secretly arrogant')) {
    cues.push(
      'Even in a neutral pose, the gaze and posture should suggest restrained superiority rather than warmth.',
    );
  }

  if (source.includes('emotionally detached')) {
    cues.push(
      'At a glance she can look kind, but the eyes should feel emotionally distant and difficult to fully read.',
    );
  }

  if (source.includes('looks kind but emotionally detached')) {
    cues.push(
      'She should read as kind at first glance, yet the expression and eyes should remain subtly detached.',
    );
  }

  if (cues.length > 0) {
    return cues.join(' ');
  }

  if (details.firstImpression !== null && details.defaultExpression !== null) {
    return `Translate the personality into subtle visual cues through ${details.defaultExpression}, the gaze, and the posture while keeping the pose neutral.`;
  }

  return freeDescription === null || freeDescription.trim().length === 0
    ? null
    : 'Translate the personality into subtle cues in the expression, gaze, and posture while keeping the reference neutral.';
}

function summarizeLooseStructuredFieldsLine(value: Record<string, unknown>): string | null {
  const summary = summarizeLooseStructuredFields(value);
  return summary.length === 0 ? null : `Design details: ${summary}`;
}

function summarizeLooseStructuredFields(value: Record<string, unknown>): string {
  const fragments: string[] = [];

  for (const [key, entry] of Object.entries(value)) {
    if (entry === null || entry === undefined) {
      continue;
    }

    if (typeof entry === 'string' || typeof entry === 'number' || typeof entry === 'boolean') {
      fragments.push(`${humanizeKey(key)} ${normalizeScalar(entry)}`);
      continue;
    }

    if (Array.isArray(entry)) {
      const items = entry.map((item) => normalizeScalar(item)).filter(isNonEmpty);
      if (items.length > 0) {
        fragments.push(`${humanizeKey(key)} ${items.join(', ')}`);
      }
      continue;
    }

    if (typeof entry === 'object') {
      const nested = summarizeLooseStructuredFields(entry as Record<string, unknown>);
      if (nested.length > 0) {
        fragments.push(`${humanizeKey(key)} ${nested}`);
      }
    }
  }

  return fragments.join('; ');
}

function labeledLine(label: string, values: Array<string | null>): string | null {
  const normalized = values.filter(isNonEmpty);
  if (normalized.length === 0) {
    return null;
  }

  return `${label}: ${normalized.join(', ')}`;
}

function mapSimpleValue(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null;
  }

  return value.trim().replaceAll('_', ' ').replace(/\s+/gu, ' ');
}

function mapCharacterPhrase(value: unknown, dictionary: Record<string, string>): string | null {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null;
  }

  return dictionary[value] ?? mapSimpleValue(value);
}

function mapFreeText(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null;
  }

  return normalizeImagePromptSentence(value);
}

function mapStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => mapFreeText(entry))
    .filter((entry): entry is string => entry !== null);
}

function normalizeSentence(value: string): string {
  return value.trim().replace(/\s+/gu, ' ').replace(/[.。]+$/u, '');
}

function normalizeImagePromptSentence(value: string): string {
  return replaceUnsafeSafetyMetaTerms(replaceUnsafeNudityTerms(normalizeSentence(value)));
}

function buildImageSafetyInterpretationLine(context: EntityReferenceContext): string | null {
  const sourceText = [
    context.freeDescription,
    context.promptSupplement,
    summarizeLooseStructuredFields(context.structuredFields),
  ]
    .filter((value): value is string => typeof value === 'string')
    .join(' ');

  if (!containsUnsafeNudityTerms(sourceText)) {
    return null;
  }

  if (context.entityType === 'nonhuman') {
    return 'Safety interpretation: render the subject as a fully opaque non-human silhouette surface, like shadow material, and keep it as a neutral design reference.';
  }

  return 'Safety interpretation: render the subject with opaque coverage or costume-like surface treatment, and keep it as a neutral design reference.';
}

function replaceUnsafeNudityTerms(value: string): string {
  return UNSAFE_NUDITY_PATTERNS.reduce(
    (current, pattern) =>
      current.replace(pattern, 'a continuous opaque non-human silhouette surface without anatomical detailing'),
    value,
  );
}

function containsUnsafeNudityTerms(value: string): boolean {
  return UNSAFE_NUDITY_PATTERNS.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(value);
  });
}

function replaceUnsafeSafetyMetaTerms(value: string): string {
  return UNSAFE_SAFETY_META_PATTERNS.reduce(
    (current, pattern) => current.replace(pattern, 'neutral design reference'),
    value,
  );
}

function normalizeScalar(value: unknown): string {
  if (typeof value === 'string') {
    return normalizeImagePromptSentence(value).replaceAll('_', ' ');
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  return '';
}

function humanizeKey(value: string): string {
  return value.replaceAll('_', ' ');
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function summarizeClothingSilhouette(description: string): string {
  return normalizeImagePromptSentence(description);
}

function articlelessPhrase(value: string): string {
  return value.replace(/^(a|an)\s+/iu, '');
}

function joinPhrases(values: string[]): string {
  if (values.length === 1) {
    return values[0];
  }

  if (values.length === 2) {
    return `${values[0]} and ${values[1]}`;
  }

  return `${values.slice(0, -1).join(', ')}, and ${values.at(-1)}`;
}

function capitalize(value: string): string {
  if (value.length === 0) {
    return value;
  }

  return `${value[0].toUpperCase()}${value.slice(1)}`;
}

function isNonEmpty(value: string | null): value is string {
  return value !== null && value.length > 0;
}

const AGE_RANGE_PHRASES: Record<string, string> = {
  child: 'childlike',
  early_teens: 'young teen',
  late_teens: 'late-teen',
  twenties: 'in the twenties',
  thirties: 'in the thirties',
  forties_plus: 'mature adult',
  ageless: 'with an intentionally ambiguous age',
};

const FIRST_IMPRESSION_PHRASES: Record<string, string> = {
  bright_friendly: 'a bright and approachable first impression',
  quiet_neat: 'a quiet, tidy, composed first impression',
  cool_distant: 'a cool, distant first impression',
  gentle_soft: 'a gentle, soft first impression',
  serious_reliable: 'a serious and reliable first impression',
  mysterious_fragile: 'a mysterious, fragile first impression',
  energetic_bold: 'an energetic, bold first impression',
};

const BUILD_PHRASES: Record<string, string> = {
  petite: 'petite',
  slender: 'slender',
  average: 'average build',
  athletic: 'athletic',
  muscular: 'muscular',
  curvy: 'curvy',
};

const HEIGHT_PHRASES: Record<string, string> = {
  short: 'short',
  average: 'average height',
  tall: 'tall',
};

const STANDING_STYLE_PHRASES: Record<string, string> = {
  upright_neat: 'standing upright with neat posture and controlled balance',
  natural_relaxed: 'standing naturally with relaxed shoulders',
  shy_reserved: 'standing in a modest, slightly guarded way',
  confident_open: 'standing openly with calm confidence',
  still_quiet: 'standing very still with restrained quietness',
};

const DEFAULT_EXPRESSION_PHRASES: Record<string, string> = {
  soft_smile: 'a soft gentle smile',
  calm_neutral: 'a calm neutral expression',
  serious_focus: 'a serious focused expression',
  cheerful_smile: 'a bright cheerful smile',
  shy_reserved: 'a shy reserved expression',
  cool_unfazed: 'a cool unreadable expression',
};

const SKIN_TONE_PHRASES: Record<string, string> = {
  fair: 'fair skin',
  light: 'light skin',
  medium: 'medium skin',
  tan: 'tan skin',
  deep: 'deep skin tone',
  custom: 'custom skin tone',
};

const HEAD_TO_BODY_RATIO_PHRASES: Record<string, string> = {
  five_head: 'about five heads tall',
  six_head: 'about six heads tall',
  seven_head: 'about seven heads tall',
  seven_half_head: 'about seven and a half heads tall',
  eight_head: 'about eight heads tall',
};

const SHOULDER_WIDTH_PHRASES: Record<string, string> = {
  narrow: 'narrow shoulders',
  balanced: 'balanced shoulder width',
  broad: 'broad shoulders',
};

const LEG_LENGTH_PHRASES: Record<string, string> = {
  shorter: 'slightly shorter legs',
  balanced: 'balanced leg length',
  long: 'long legs',
};

const EYE_SIZE_PHRASES: Record<string, string> = {
  small: 'small eyes',
  medium: 'medium-sized eyes',
  large: 'large eyes',
};

const EYE_ANGLE_PHRASES: Record<string, string> = {
  level: 'level eye line',
  slightly_upturned: 'slightly upturned eye angle',
  strongly_upturned: 'strongly upturned eye angle',
  slightly_downturned: 'slightly downturned eye angle',
  strongly_downturned: 'strongly downturned eye angle',
};

const PUPIL_STYLE_PHRASES: Record<string, string> = {
  small: 'small pupils',
  round: 'round pupils',
  soft_glossy: 'soft glossy pupils',
  sharp_glossy: 'sharp glossy pupils',
};

const UNDER_EYE_DETAIL_PHRASES: Record<string, string> = {
  clean: 'clean under-eye area',
  soft_shadow: 'soft under-eye shadow',
  tired_shadow: 'subtle tired under-eye shadows',
  defined_lashes: 'defined lashes and eye framing',
};

const MOUTH_DEFAULT_PHRASES: Record<string, string> = {
  closed_neutral: 'a small closed neutral mouth',
  slight_smile: 'a slight controlled smile',
  firm_line: 'a firm straight mouth line',
  soft_parted: 'a softly parted mouth',
};

const HAIR_LENGTH_PHRASES: Record<string, string> = {
  very_short: 'very short length',
  short: 'short length',
  medium: 'medium length',
  long: 'long length',
  very_long: 'very long length',
};

const HAIR_STYLE_PHRASES: Record<string, string> = {
  straight: 'straight texture',
  wavy: 'soft wavy texture',
  curly: 'curly texture',
  wild: 'rough uneven texture',
};

const HAIR_ARRANGEMENT_PHRASES: Record<string, string> = {
  down: 'hair worn down',
  short_cut: 'a short cut silhouette',
  buzz_cut: 'a buzz-cut silhouette',
  crew_cut: 'a neat crew cut',
  undercut: 'an undercut silhouette',
  short_bob: 'a neat short bob',
  center_part: 'a center-part hairstyle',
  side_part: 'a side-part hairstyle',
  slick_back: 'slicked-back hair',
  long_straight: 'long straight hair',
  medium_layered: 'a medium layered cut',
  wolf_cut: 'a wolf-cut silhouette',
  short_perm: 'a short permed silhouette',
  ponytail: 'a ponytail',
  side_ponytail: 'a side ponytail',
  twin_tails: 'twin tails',
  bun: 'a bun hairstyle',
  braid: 'a braid arrangement',
  half_up: 'a half-up arrangement',
  hime_cut: 'a hime-cut silhouette',
};

const HAIR_BANGS_PHRASES: Record<string, string> = {
  none: 'no bangs',
  light: 'light airy bangs',
  standard: 'standard front bangs',
  heavy: 'heavy full bangs',
  side_swept: 'side-swept bangs',
  blunt: 'straight-cut blunt bangs',
};

const HAIR_FRONT_SHAPE_PHRASES: Record<string, string> = {
  rounded: 'a rounded front hair shape',
  split_center: 'front hair split at the center',
  split_side: 'front hair drifting to one side',
  pointed: 'front strands that end in points',
};

const HAIR_SIDE_PHRASES: Record<string, string> = {
  close_to_face: 'side hair that stays close to the face',
  slightly_flared: 'side hair that flares slightly outward',
  long_side_locks: 'long side locks framing the face',
  tucked_back: 'side hair tucked back cleanly',
};

const HAIR_BACK_SHAPE_PHRASES: Record<string, string> = {
  compact_round: 'a compact rounded back shape',
  flat_neat: 'a flat neat back shape',
  layered_flare: 'a layered back shape that flares outward',
  heavy_fall: 'a heavier back shape that falls straight down',
};

const EYE_SHAPE_PHRASES: Record<string, string> = {
  gentle: 'gentle eye shape',
  sharp: 'sharp eye shape',
  round: 'round eye shape',
  narrow: 'narrow eye shape',
};

const EYE_EYELID_PHRASES: Record<string, string> = {
  single: 'single eyelids',
  double: 'double eyelids',
};

const CLOTHING_CATEGORY_PHRASES: Record<string, string> = {
  military: 'military-inspired clothing',
  school: 'school uniform',
  casual: 'casual clothing',
  suit: 'formal suit-like clothing',
  fantasy: 'fantasy outfit',
  japanese: 'Japanese-style outfit',
  streetwear: 'streetwear',
  hoodie: 'hoodie-based outfit',
  sports: 'sportswear',
  winter_coat: 'winter coat outfit',
  workwear: 'workwear',
  armor: 'armor',
  gothic: 'gothic outfit',
  formal_dress: 'formal dresswear',
  idol_stage: 'stage costume',
};

const OUTFIT_IMPRESSION_PHRASES: Record<string, string> = {
  formal: 'a clean proper silhouette',
  practical: 'a practical easy-to-move-in silhouette',
  elegant: 'an elegant refined silhouette',
  rough: 'a rough worn-in silhouette',
  cute: 'a soft cute silhouette',
};

const COLLAR_SHAPE_PHRASES: Record<string, string> = {
  open_round: 'a rounded open collar',
  sharp_folded: 'a sharp folded collar',
  sailor: 'a clear sailor collar',
  stand_collar: 'a stand collar',
};

const SLEEVE_LENGTH_PHRASES: Record<string, string> = {
  sleeveless: 'sleeveless arms',
  short: 'short sleeves',
  three_quarter: 'three-quarter sleeves',
  long: 'long sleeves',
};

const BOTTOM_SHAPE_PHRASES: Record<string, string> = {
  short_skirt: 'a short skirt',
  knee_skirt: 'a knee-length skirt',
  long_skirt: 'a long skirt',
  slim_pants: 'slim pants',
  wide_pants: 'wide pants',
  shorts: 'shorts',
};

const ART_STYLE_PHRASES: Record<string, string> = {
  anime: 'anime',
  semi_realistic: 'semi-realistic',
  manga: 'manga',
  painterly: 'painterly',
};

const UNSAFE_NUDITY_PATTERNS = [
  /衣服[はを]?着ていない/gu,
  /服[はを]?着ていない/gu,
  /服なし/gu,
  /衣服なし/gu,
  /全裸/gu,
  /裸(?:体|身)?/gu,
  /\b(?:nude|naked|unclothed)\b/giu,
  /\b(?:no clothes|without clothes|not wearing clothes)\b/giu,
] as const;

const UNSAFE_SAFETY_META_PATTERNS = [
  /アダルト要素ではない/gu,
  /アダルト要素はない/gu,
  /成人向け(?:ではない|でない|要素ではない|要素はない)?/gu,
  /性的(?:ではない|でない|な要素ではない|な要素はない|表現ではない)?/gu,
  /エロ(?:ではない|くない|要素ではない|要素はない)?/gu,
  /\b(?:sexual|erotic|pornographic|porn)\b/giu,
] as const;
