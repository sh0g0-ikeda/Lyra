import { sanitizeExternalErrorMessage } from '../../lib/errorSanitizer.js';

export function toSanitizedAwsErrorMessage(error: unknown, fallbackMessage: string): string {
  const message = error instanceof Error ? error.message : fallbackMessage;
  return sanitizeExternalErrorMessage(message);
}
