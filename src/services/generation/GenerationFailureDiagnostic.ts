import { ConfigurationError, ValidationError } from '../../domain/errors/index.js';
import { StructuredOpenAIResponseError } from '../../infrastructure/openai/StructuredOpenAIResponse.js';

const knownFailures = new Map<string, string>([
  ['Page pre-render scene audit verdict is invalid', 'scene_audit_invalid_verdict'],
  ['Page pre-render scene audit directives are invalid', 'scene_audit_invalid_directives'],
  ['Page pre-render scene audit verdict does not match directives', 'scene_audit_verdict_mismatch'],
  ['Page pre-render scene audit panel is invalid', 'scene_audit_invalid_panel'],
  ['Page pre-render scene audit targets an unknown panel', 'scene_audit_unknown_panel'],
  ['Page pre-render scene audit directive is invalid', 'scene_audit_invalid_directive'],
  ['Page pre-render scene audit directive entity count is invalid', 'scene_audit_invalid_entity_count'],
  ['Page pre-render scene audit targets an unassigned entity', 'scene_audit_unassigned_entity'],
  ['Page pre-render scene audit contains duplicate directives', 'scene_audit_duplicate_directives'],
  ['Page pre-render scene audit entity is invalid', 'scene_audit_invalid_entity'],
  ['Page generation input snapshot could not be persisted', 'input_snapshot_persistence_failed'],
  ['Failed to persist generated page image', 'page_result_persistence_failed'],
  ['Stored image bytes do not match a supported raster image format', 'invalid_image_bytes'],
]);

/** Log only application-owned classifications. Exception messages may contain
 * authored text, signed image URLs or provider credentials, even after wrapping. */
export function generationFailureDiagnostic(error: unknown): { reason: string; errorType: string } {
  if (error instanceof StructuredOpenAIResponseError) {
    return { reason: `structured_${error.reason}`, errorType: 'structured_response' };
  }
  const known = error instanceof Error ? knownFailures.get(error.message) : undefined;
  const errorType = error instanceof ValidationError ? 'validation'
    : error instanceof ConfigurationError ? 'configuration' : 'unexpected';
  return { reason: known ?? `${errorType}_failure`, errorType };
}
