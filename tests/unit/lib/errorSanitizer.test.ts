import { describe, expect, it } from 'vitest';
import {
  sanitizeExternalErrorMessage,
  sanitizePersistedErrorMessage,
} from '../../../src/lib/errorSanitizer.js';

describe('errorSanitizer', () => {
  it('保存用エラー文からAPIキーと署名値を伏せる', () => {
    const fakeApiKey = ['sk', 'test-secret'].join('-');
    const result = sanitizePersistedErrorMessage(
      new Error(`OpenAI failed Authorization: Bearer ${fakeApiKey} X-Amz-Signature=abc123`),
      'fallback',
    );

    expect(result).toContain('Bearer [redacted]');
    expect(result).toContain('X-Amz-Signature=[redacted]');
    expect(result).not.toContain(fakeApiKey);
    expect(result).not.toContain('abc123');
  });

  it('外部APIエラー文を短く丸める', () => {
    const result = sanitizeExternalErrorMessage(`provider error ${'x'.repeat(500)}`);

    expect(result.length).toBeLessThanOrEqual(300);
    expect(result.endsWith('...')).toBe(true);
  });
});
