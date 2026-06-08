import { describe, expect, it } from 'vitest';
import { assertSafeWebRuntimeConfig } from '../../../apps/web/src/lib/webRuntimeGuards.js';

describe('assertSafeWebRuntimeConfig', () => {
  it('development では dev auth bypass を許可する', () => {
    expect(() => {
      assertSafeWebRuntimeConfig({
        MODE: 'development',
        VITE_DEV_AUTH_BYPASS: 'true',
      });
    }).not.toThrow();
  });

  it('production では dev auth bypass を拒否する', () => {
    expect(() => {
      assertSafeWebRuntimeConfig({
        MODE: 'production',
        VITE_DEV_AUTH_BYPASS: 'true',
        VITE_COGNITO_DOMAIN: 'https://example.auth.ap-northeast-1.amazoncognito.com',
        VITE_COGNITO_CLIENT_ID: 'client-1',
      });
    }).toThrow(/VITE_DEV_AUTH_BYPASS must be disabled/);
  });

  it('production では要求された場合に hosted auth 設定を要求する', () => {
    expect(() => {
      assertSafeWebRuntimeConfig({
        MODE: 'production',
        VITE_DEV_AUTH_BYPASS: 'false',
        VITE_REQUIRE_HOSTED_AUTH: 'true',
      });
    }).toThrow(/production web auth requires/);
  });

  it('production の Cognito 設定を許可する', () => {
    expect(() => {
      assertSafeWebRuntimeConfig({
        MODE: 'production',
        VITE_COGNITO_DOMAIN: 'https://example.auth.ap-northeast-1.amazoncognito.com',
        VITE_COGNITO_CLIENT_ID: 'client-1',
      });
    }).not.toThrow();
  });
});
