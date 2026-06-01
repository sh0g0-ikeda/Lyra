import { STYLE_REFERENCE_COMPILER_VERSION } from '../../domain/constants/generation.js';
import { ConfigurationError, ValidationError } from '../../domain/errors/index.js';
import {
  readStyleReferenceMetadata,
  toStoredStyleReferenceRecord,
  type StyleReferenceTarget,
} from '../../domain/types/styleReference.js';
import { env } from '../../lib/env.js';
import type { StyleReferenceCompilerPort } from './StyleReferenceCompiler.js';

export async function resolveStyleReferenceForPersistence(params: {
  nextStyleReference: Record<string, unknown> | null;
  currentStyleReference: unknown;
  target: StyleReferenceTarget;
  compiler?: StyleReferenceCompilerPort;
}): Promise<Record<string, unknown> | null> {
  const parsedInput = parseIncomingStyleReference(params.nextStyleReference);
  if (parsedInput === null) {
    return null;
  }

  if (!env.ENTERPRISE_STYLE_REFERENCES_ENABLED) {
    throw new ValidationError('Named style references are disabled in this environment');
  }

  const current = readStyleReferenceMetadata(params.currentStyleReference);
  if (
    current !== null &&
    current.title === parsedInput.title &&
    (current.notes ?? null) === parsedInput.notes &&
    current.compilerPromptVersion === STYLE_REFERENCE_COMPILER_VERSION
  ) {
    return toStoredStyleReferenceRecord(current);
  }

  if (params.compiler === undefined) {
    throw new ConfigurationError('Style reference compiler is not configured');
  }

  const compiled = await params.compiler.compileStyleReference({
    title: parsedInput.title,
    notes: parsedInput.notes,
    target: params.target,
  });

  return toStoredStyleReferenceRecord(compiled);
}

function parseIncomingStyleReference(
  value: Record<string, unknown> | null,
): { title: string; notes: string | null } | null {
  if (value === null) {
    return null;
  }

  const title = readNonEmptyString(value.title);
  if (title === null) {
    return null;
  }

  return {
    title,
    notes: readNullableString(value.notes),
  };
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readNullableString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}
