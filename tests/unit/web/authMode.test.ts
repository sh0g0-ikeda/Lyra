import { describe, expect, it } from 'vitest';
import { shouldAllowManualTokenAuth } from '../../../apps/web/src/lib/authMode.js';

describe('shouldAllowManualTokenAuth', () => {
  it('development では手動 bearer token 認証を許可する', () => {
    expect(
      shouldAllowManualTokenAuth({
        MODE: 'development',
        VITE_REQUIRE_HOSTED_AUTH: 'true',
      }),
    ).toBe(true);
  });

  it('production では hosted auth 必須フラグがなくても手動 bearer token 認証を無効にする', () => {
    expect(
      shouldAllowManualTokenAuth({
        MODE: 'production',
        VITE_REQUIRE_HOSTED_AUTH: 'false',
      }),
    ).toBe(false);
  });

  it('production で hosted auth 必須なら手動 bearer token 認証を無効にする', () => {
    expect(
      shouldAllowManualTokenAuth({
        MODE: 'production',
        VITE_REQUIRE_HOSTED_AUTH: 'true',
      }),
    ).toBe(false);
  });

  it('Vite の PROD flag でも production として扱う', () => {
    expect(
      shouldAllowManualTokenAuth({
        PROD: true,
        VITE_REQUIRE_HOSTED_AUTH: 'true',
      }),
    ).toBe(false);
  });
});
