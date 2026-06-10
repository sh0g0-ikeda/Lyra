import type { ZodError, ZodIssue } from 'zod';
import { sanitizeExternalErrorMessage } from './errorSanitizer.js';

const MAX_PUBLIC_VALIDATION_ISSUES = 3;
const MAX_PUBLIC_VALIDATION_MESSAGE_LENGTH = 500;

export function formatZodValidationError(error: ZodError): string {
  const issues = error.issues.slice(0, MAX_PUBLIC_VALIDATION_ISSUES).map(formatIssue);
  const suffix =
    error.issues.length > MAX_PUBLIC_VALIDATION_ISSUES
      ? `; plus ${error.issues.length - MAX_PUBLIC_VALIDATION_ISSUES} more issue(s)`
      : '';
  const message = `Validation failed: ${issues.join('; ')}${suffix}`;

  return trimToLimit(message, MAX_PUBLIC_VALIDATION_MESSAGE_LENGTH);
}

function formatIssue(issue: ZodIssue): string {
  const path = formatPath(issue.path);
  const message = sanitizeExternalErrorMessage(issue.message);
  return path.length === 0 ? message : `${path}: ${message}`;
}

function formatPath(path: ZodIssue['path']): string {
  return path.reduce<string>((current, part) => {
    if (typeof part === 'number') {
      return `${current}[${part}]`;
    }

    const text = String(part);
    return current.length === 0 ? text : `${current}.${text}`;
  }, '');
}

function trimToLimit(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 3)}...`;
}
