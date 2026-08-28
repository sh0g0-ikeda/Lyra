import { ConfigurationError } from '../../domain/errors/index.js';
import {
  STYLE_REFERENCE_COMPILER_MAX_TOKENS,
  STYLE_REFERENCE_COMPILER_OPENAI_MODEL,
  STYLE_REFERENCE_COMPILER_VERSION,
} from '../../domain/constants/generation.js';
import type { StyleReferenceAnchors } from '../../domain/types/styleReference.js';
import type {
  CompileStyleReferenceInput,
  CompiledStyleReference,
  StyleReferenceCompilerPort,
} from '../../services/style/StyleReferenceCompiler.js';
import { OpenAIClient } from './OpenAIClient.js';
import { OPENAI_STYLE_REFERENCE_PERSON_GUIDANCE } from './OpenAIImagePromptGuidance.js';

interface OpenAICompilerResponse {
  output_text?: unknown;
  output?: unknown;
}

export class OpenAIStyleReferenceCompiler implements StyleReferenceCompilerPort {
  public constructor(
    private readonly client: OpenAIClient,
    private readonly model = STYLE_REFERENCE_COMPILER_OPENAI_MODEL,
  ) {}

  public async compileStyleReference(
    input: CompileStyleReferenceInput,
  ): Promise<CompiledStyleReference> {
    const response = await this.client.postJson<OpenAICompilerResponse>('/responses', {
      model: this.model,
      max_output_tokens: STYLE_REFERENCE_COMPILER_MAX_TOKENS,
      input: [
        {
          role: 'system',
          content: [
            {
              type: 'input_text',
              text: buildSystemPrompt(),
            },
          ],
        },
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: buildUserPrompt(input),
            },
          ],
        },
      ],
    });

    const outputText = extractOutputText(response.body);
    if (outputText === null) {
      throw new ConfigurationError('OpenAI style reference compiler returned no text output');
    }
    const parsed = parseCompilerOutput(outputText, input);

    return {
      title: input.title.trim(),
      notes: normalizeOptionalText(input.notes),
      compiledBrief: normalizeCompiledPrompt(parsed.compiled_brief),
      anchors: parsed.anchors,
      compilerProvider: 'openai',
      compilerModel: this.model,
      compilerPromptVersion: STYLE_REFERENCE_COMPILER_VERSION,
      compiledAt: new Date().toISOString(),
    };
  }
}

function buildSystemPrompt(): string {
  return [
    'Rewrite the provided named style reference into a structured GPT Image 2 style profile.',
    'Return only valid JSON with the exact schema requested by the user prompt.',
    'Keep the named title itself explicit in the compiled_brief because it is a hard style constraint.',
    'Translate the title into reusable rendering traits with stable anchors for line quality, shape language, face rendering treatment, eye rendering treatment, hair rendering treatment, clothing rendering treatment, background rendering, shading, texture and finish, motion treatment, dialogue and balloon treatment, and atmosphere.',
    'Treat face_rendering, eye_rendering, hair_rendering, and clothing_rendering as rendering treatment only, not as identity redesign. Do not change face shape, eye shape, hair silhouette, body proportions, or outfit silhouette.',
    ...OPENAI_STYLE_REFERENCE_PERSON_GUIDANCE,
    'Keep the response entirely within reusable visual art direction, with no meta-commentary about the source.',
    'Do not name or reproduce characters or scenes from the referenced work. Focus on reusable visual traits only.',
    'For character_reference targets, optimize for full-body character consistency and silhouette readability.',
    'For manga_page targets, optimize for panel readability, page-wide consistency, environment treatment, action clarity, and dialogue legibility.',
    'Use precise, concrete art-direction language and avoid vague quality words like masterpiece, cinematic, beautiful, cool, or stunning.',
    'Keep the compiled_brief compact and dense, usually between 110 and 190 words.',
  ].join(' ');
}

function buildUserPrompt(input: CompileStyleReferenceInput): string {
  return [
    `Target: ${input.target}`,
    `Named style reference title: ${input.title.trim()}`,
    input.notes === null || input.notes.trim().length === 0
      ? null
      : `Additional user notes: ${input.notes.trim()}`,
    '',
    'Return JSON only with this exact shape:',
    '{',
    '  "compiled_brief": "string",',
    '  "anchors": {',
    '    "line_quality": "string or null",',
    '    "shape_language": "string or null",',
    '    "face_rendering": "string or null",',
    '    "eye_rendering": "string or null",',
    '    "hair_rendering": "string or null",',
    '    "clothing_rendering": "string or null",',
    '    "background_rendering": "string or null",',
    '    "shading_rendering": "string or null",',
    '    "texture_finish": "string or null",',
    '    "motion_treatment": "string or null",',
    '    "dialogue_balloon_treatment": "string or null",',
    '    "atmosphere": "string or null"',
    '  }',
    '}',
    '',
    'Make compiled_brief read like a strong reusable style directive for GPT Image 2. Keep the title explicit in the brief, then immediately translate it into concrete rendering constraints. Keep character identity stable; style should primarily affect line work, shading, finish, atmosphere, background treatment, and motion accents.',
  ]
    .filter((line): line is string => line !== null)
    .join('\n');
}

interface ParsedStyleReferencePayload {
  compiled_brief: string;
  anchors: StyleReferenceAnchors;
}

function parseCompilerOutput(
  value: string,
  input: CompileStyleReferenceInput,
): ParsedStyleReferencePayload {
  const normalized = value
    .trim()
    .replace(/^```(?:json)?\s*/u, '')
    .replace(/\s*```$/u, '')
    .trim();

  const parsedUnknown = tryParseStyleJson(normalized);
  if (parsedUnknown === null) {
    return buildDeterministicFallback(normalized, input);
  }

  if (!isRecord(parsedUnknown)) {
    return buildDeterministicFallback(normalized, input);
  }

  const compiledBrief = readCompiledBrief(parsedUnknown);
  const anchors = readAnchorsRecord(parsedUnknown.anchors);
  if (compiledBrief === null) {
    return buildDeterministicFallback(normalized, input);
  }

  return {
    compiled_brief: compiledBrief,
    anchors: toStyleReferenceAnchors(anchors),
  };
}

function tryParseStyleJson(value: string): unknown | null {
  try {
    return JSON.parse(value);
  } catch {
    const objectSlice = extractFirstJsonObject(value);
    if (objectSlice === null) {
      return null;
    }

    try {
      return JSON.parse(objectSlice);
    } catch {
      return null;
    }
  }
}

function extractFirstJsonObject(value: string): string | null {
  const start = value.indexOf('{');
  if (start < 0) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < value.length; index += 1) {
    const char = value[index];
    if (char === undefined) {
      continue;
    }

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }

      if (char === '\\') {
        escaped = true;
        continue;
      }

      if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === '{') {
      depth += 1;
      continue;
    }

    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return value.slice(start, index + 1);
      }
    }
  }

  return null;
}

function readCompiledBrief(value: Record<string, unknown>): string | null {
  const candidates = [
    value.compiled_brief,
    value.compiledBrief,
    value.style_brief,
    value.styleBrief,
    value.brief,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }

  return null;
}

function readAnchorsRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function toStyleReferenceAnchors(anchors: Record<string, unknown>): StyleReferenceAnchors {
  return {
    lineQuality: readNullableAnchor(anchors.line_quality ?? anchors.lineQuality),
    shapeLanguage: readNullableAnchor(anchors.shape_language ?? anchors.shapeLanguage),
    faceRendering: readNullableAnchor(anchors.face_rendering ?? anchors.faceRendering),
    eyeRendering: readNullableAnchor(anchors.eye_rendering ?? anchors.eyeRendering),
    hairRendering: readNullableAnchor(anchors.hair_rendering ?? anchors.hairRendering),
    clothingRendering: readNullableAnchor(
      anchors.clothing_rendering ?? anchors.clothingRendering,
    ),
    backgroundRendering: readNullableAnchor(
      anchors.background_rendering ?? anchors.backgroundRendering,
    ),
    shadingRendering: readNullableAnchor(anchors.shading_rendering ?? anchors.shadingRendering),
    textureFinish: readNullableAnchor(anchors.texture_finish ?? anchors.textureFinish),
    motionTreatment: readNullableAnchor(anchors.motion_treatment ?? anchors.motionTreatment),
    dialogueBalloonTreatment: readNullableAnchor(
      anchors.dialogue_balloon_treatment ?? anchors.dialogueBalloonTreatment,
    ),
    atmosphere: readNullableAnchor(anchors.atmosphere),
  };
}

function buildDeterministicFallback(
  rawOutput: string,
  input: CompileStyleReferenceInput,
): ParsedStyleReferencePayload {
  const notes = normalizeOptionalText(input.notes);
  const normalizedOutput = normalizeCompiledPrompt(rawOutput);
  const compiledBriefSource =
    normalizedOutput.length > 0
      ? normalizedOutput
      : `Keep the title "${input.title.trim()}" explicit as a style constraint and translate it into consistent reusable visual direction.`;

  return {
    compiled_brief: [
      `Keep the title "${input.title.trim()}" explicit as a style constraint.`,
      compiledBriefSource,
      notes === null ? null : `Additional notes: ${notes}.`,
    ]
      .filter((part): part is string => part !== null)
      .join(' '),
    anchors: {
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
    },
  };
}

function extractOutputText(response: OpenAICompilerResponse): string | null {
  if (typeof response.output_text === 'string' && response.output_text.trim().length > 0) {
    return response.output_text.trim();
  }

  if (!Array.isArray(response.output)) {
    return null;
  }

  for (const item of response.output) {
    if (!isRecord(item) || !Array.isArray(item.content)) {
      continue;
    }

    for (const content of item.content) {
      if (!isRecord(content)) {
        continue;
      }

      const text = content.text;
      if (typeof text === 'string' && text.trim().length > 0) {
        return text.trim();
      }
    }
  }

  return null;
}

function normalizeCompiledPrompt(value: string): string {
  return value
    .trim()
    .replace(/\s+/gu, ' ')
    .trim();
}

function readNullableAnchor(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function normalizeOptionalText(value: string | null): string | null {
  if (value === null) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
