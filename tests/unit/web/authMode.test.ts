import { describe, expect, it } from 'vitest';
import { shouldAllowManualTokenAuth } from '../../../apps/web/src/lib/authMode.js';

describe('shouldAllowManualTokenAuth', () => {
  it('development では手動 bearer token 認証を許可する', () => {
    expect(
      shouldAllowManualTokenAuth({
        MODE: 'development',
      }),
    ).toBe(true);
  });

  it('production では手動 bearer token 認証を無効にする', () => {
    expect(
      shouldAllowManualTokenAuth({
        MODE: 'production',
      }),
    ).toBe(false);
  });

  it('Vite の PROD flag でも production として扱う', () => {
    expect(
      shouldAllowManualTokenAuth({
        PROD: true,
      }),
    ).toBe(false);
  });
});
