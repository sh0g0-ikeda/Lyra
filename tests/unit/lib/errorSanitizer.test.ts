import { describe, expect, it } from 'vitest';
import {
  sanitizeExternalErrorMessage,
  sanitizePersistedErrorMessage,
} from '../../../src/lib/errorSanitizer.js';

describe('errorSanitizer', () => {
  it('保存用エラーメッセージから API key と署名値を伏せる', () => {
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

  it('外部APIエラーメッセージを短く丸める', () => {
    const result = sanitizeExternalErrorMessage(`provider error ${'x'.repeat(500)}`);

    expect(result.length).toBeLessThanOrEqual(300);
    expect(result.endsWith('...')).toBe(true);
  });

  it('Stripe secret と webhook token を伏せる', () => {
    const stripeSecret = 'sk_live_testsecret1234567890';
    const webhookSecret = 'whsec_testsecret1234567890';
    const result = sanitizePersistedErrorMessage(
      `Stripe failed with STRIPE_SECRET_KEY=${stripeSecret} webhook ${webhookSecret}`,
      'fallback',
    );

    expect(result).toContain('STRIPE_SECRET_KEY=[redacted]');
    expect(result).toContain('[redacted-stripe-webhook-secret]');
    expect(result).not.toContain(stripeSecret);
    expect(result).not.toContain(webhookSecret);
  });
});
