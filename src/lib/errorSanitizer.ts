const MAX_PERSISTED_ERROR_MESSAGE_LENGTH = 300;

const SENSITIVE_PATTERNS: Array<[RegExp, string]> = [
  [/\b(Authorization)\s*[:=]\s*Bearer\s+[A-Za-z0-9._~+/=-]+/giu, '$1: Bearer [redacted]'],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]+/giu, 'Bearer [redacted]'],
  [/\bsk-[A-Za-z0-9_-]{8,}\b/gu, '[redacted-api-key]'],
  [/\bsk_(live|test)_[A-Za-z0-9_-]{8,}\b/gu, '[redacted-stripe-secret-key]'],
  [/\bwhsec_[A-Za-z0-9_-]{8,}\b/gu, '[redacted-stripe-webhook-secret]'],
  [/\bAKIA[0-9A-Z]{16}\b/gu, '[redacted-aws-access-key]'],
  [
    /(api[_-]?key|x-api-key|client_secret|webhook_secret|stripe_secret_key|stripe_webhook_secret)\s*[:=]\s*["']?[^"',\s}]+/giu,
    '$1=[redacted]',
  ],
  [/(X-Amz-Signature|Signature|sig)=([^&\s]+)/giu, '$1=[redacted]'],
  [/data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/giu, 'data:image/[redacted]'],
];

/**
 * Job failure reasons are visible in operational logs and user support flows.
 * Keep them useful for triage, but never persist provider payloads, signed URL
 * material, authorization headers, or very long strings verbatim.
 */
export function sanitizePersistedErrorMessage(value: unknown, fallback: string): string {
  const rawMessage =
    value instanceof Error
      ? value.message
      : typeof value === 'string'
        ? value
        : fallback;

  return trimToLimit(redactSensitiveText(normalizeWhitespace(rawMessage)), MAX_PERSISTED_ERROR_MESSAGE_LENGTH);
}

export function sanitizeExternalErrorMessage(message: string): string {
  return trimToLimit(redactSensitiveText(normalizeWhitespace(message)), MAX_PERSISTED_ERROR_MESSAGE_LENGTH);
}

function normalizeWhitespace(value: string): string {
  const normalized = value.replace(/\s+/gu, ' ').trim();
  return normalized.length === 0 ? 'Unexpected error' : normalized;
}

function redactSensitiveText(value: string): string {
  return SENSITIVE_PATTERNS.reduce((current, [pattern, replacement]) => current.replace(pattern, replacement), value);
}

function trimToLimit(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 3)}...`;
}
