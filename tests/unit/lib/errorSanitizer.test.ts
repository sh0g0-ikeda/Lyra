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

  it('AWS secret と session token を伏せる', () => {
    const secretAccessKey = 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY';
    const sessionToken = 'IQoJb3JpZ2luX2VjEExampleSessionToken';
    const result = sanitizePersistedErrorMessage(
      `S3 failed AWS_SECRET_ACCESS_KEY=${secretAccessKey} AWS_SESSION_TOKEN=${sessionToken}`,
      'fallback',
    );

    expect(result).toContain('AWS_SECRET_ACCESS_KEY=[redacted]');
    expect(result).toContain('AWS_SESSION_TOKEN=[redacted]');
    expect(result).not.toContain(secretAccessKey);
    expect(result).not.toContain(sessionToken);
  });

  it('署名付きURLのAWS credential queryを伏せる', () => {
    const credential = 'AKIA1234567890ABCDEF/20260609/us-east-1/s3/aws4_request';
    const securityToken = 'IQoJb3JpZ2luX2VjEExampleSecurityToken';
    const result = sanitizePersistedErrorMessage(
      `GET failed https://example.test/a.png?X-Amz-Credential=${credential}&X-Amz-Security-Token=${securityToken}`,
      'fallback',
    );

    expect(result).toContain('X-Amz-Credential=[redacted]');
    expect(result).toContain('X-Amz-Security-Token=[redacted]');
    expect(result).not.toContain(credential);
    expect(result).not.toContain(securityToken);
  });

  it('OAuth token と JWT を伏せる', () => {
    const jwt = [
      'eyJhbGciOiJSUzI1NiIsImtpZCI6ImtleTEyMzQ1Njc4OTA',
      'eyJzdWIiOiJ1c2VyLTEyMyIsImVtYWlsIjoidXNlckBleGFtcGxlLmNvbSJ9',
      'c2lnbmF0dXJlMTIzNDU2Nzg5MA',
    ].join('.');
    const refreshToken = 'refresh-token-secret-value-1234567890';
    const result = sanitizePersistedErrorMessage(
      `Cognito failed access_token=${jwt} refresh_token=${refreshToken} code_verifier=pkce-secret`,
      'fallback',
    );

    expect(result).toContain('access_token=[redacted]');
    expect(result).toContain('refresh_token=[redacted]');
    expect(result).toContain('code_verifier=[redacted]');
    expect(result).not.toContain(jwt);
    expect(result).not.toContain(refreshToken);
    expect(result).not.toContain('pkce-secret');
  });
});
