import type { EntityReferenceContext } from '../../domain/types/entityReference.js';

export interface EntityReferencePromptBuilderPort {
  buildGenerationPrompt(context: EntityReferenceContext): string;
}

/**
 * Converts the normalized entity definition into a stable image prompt so the
 * worker can generate reference candidates without re-encoding DB concerns.
 */
export class EntityReferencePromptBuilder implements EntityReferencePromptBuilderPort {
  public buildGenerationPrompt(context: EntityReferenceContext): string {
    const lines = [
      `Create a clean full-body reference image for a ${context.entityType}.`,
      `Name: ${context.name}.`,
    ];

    if (context.freeDescription !== null && context.freeDescription.length > 0) {
      lines.push(`Free description: ${context.freeDescription}.`);
    }

    const fieldSummary = summarizeStructuredFields(context.structuredFields);
    if (fieldSummary.length > 0) {
      lines.push(`Structured design constraints: ${fieldSummary}.`);
    }

    if (context.promptSupplement !== null && context.promptSupplement.length > 0) {
      lines.push(`Prompt supplement: ${context.promptSupplement}.`);
    }

    lines.push('Single subject, centered, full figure visible, neutral background, no text, no watermark.');

    return lines.join(' ');
  }
}

function summarizeStructuredFields(value: Record<string, unknown>): string {
  const fragments: string[] = [];

  for (const [key, entry] of Object.entries(value)) {
    if (entry === null || entry === undefined) {
      continue;
    }

    if (typeof entry === 'string' || typeof entry === 'number' || typeof entry === 'boolean') {
      fragments.push(`${key}: ${String(entry)}`);
      continue;
    }

    if (typeof entry === 'object' && !Array.isArray(entry)) {
      const nested = summarizeStructuredFields(entry as Record<string, unknown>);
      if (nested.length > 0) {
        fragments.push(`${key}: { ${nested} }`);
      }
    }
  }

  return fragments.join(', ');
}
