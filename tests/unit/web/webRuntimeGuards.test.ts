import { describe, expect, it } from 'vitest';
import {
  assertSafeWebRuntimeConfig,
  shouldRequireStrictWebProductionConfig,
} from '../../../apps/web/src/lib/webRuntimeGuards.js';

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
        VITE_COGNITO_SCOPES: 'openid email profile lyra/api',
      });
    }).toThrow(/VITE_DEV_AUTH_BYPASS must be disabled/);
  });

  it('production では Cognito Hosted UI 設定を常に要求する', () => {
    expect(() => {
      assertSafeWebRuntimeConfig({
        MODE: 'production',
        VITE_DEV_AUTH_BYPASS: 'false',
      });
    }).toThrow(/production web auth requires Cognito Hosted UI/);
  });

  it('production の Cognito 設定では scopes を要求する', () => {
    expect(() => {
      assertSafeWebRuntimeConfig({
        MODE: 'production',
        VITE_COGNITO_DOMAIN: 'https://example.auth.ap-northeast-1.amazoncognito.com',
        VITE_COGNITO_CLIENT_ID: 'client-1',
      });
    }).toThrow(/VITE_COGNITO_SCOPES is required/);
  });

  it('production では Supabase hosted auth 設定を拒否する', () => {
    expect(() => {
      assertSafeWebRuntimeConfig({
        MODE: 'production',
        VITE_COGNITO_DOMAIN: 'https://example.auth.ap-northeast-1.amazoncognito.com',
        VITE_COGNITO_CLIENT_ID: 'client-1',
        VITE_COGNITO_SCOPES: 'openid email profile lyra/api',
        VITE_SUPABASE_URL: 'https://example.supabase.co',
        VITE_SUPABASE_ANON_KEY: 'anon-key',
      });
    }).toThrow(/production web auth must not configure Supabase/);
  });

  it('production では Supabase-only hosted auth 設定を拒否する', () => {
    expect(() => {
      assertSafeWebRuntimeConfig({
        MODE: 'production',
        VITE_SUPABASE_URL: 'https://example.supabase.co',
        VITE_SUPABASE_ANON_KEY: 'anon-key',
      });
    }).toThrow(/production web auth requires Cognito Hosted UI/);
  });

  it('production の Cognito 設定を許可する', () => {
    expect(() => {
      assertSafeWebRuntimeConfig({
        MODE: 'production',
        VITE_COGNITO_DOMAIN: 'https://example.auth.ap-northeast-1.amazoncognito.com',
        VITE_COGNITO_CLIENT_ID: 'client-1',
        VITE_COGNITO_SCOPES: 'openid email profile lyra/api',
        VITE_COGNITO_API_TOKEN_USE: 'id',
      });
    }).not.toThrow();
  });

  it('production の Cognito API token 種別が不正なら拒否する', () => {
    expect(() => {
      assertSafeWebRuntimeConfig({
        MODE: 'production',
        VITE_COGNITO_DOMAIN: 'https://example.auth.ap-northeast-1.amazoncognito.com',
        VITE_COGNITO_CLIENT_ID: 'client-1',
        VITE_COGNITO_SCOPES: 'openid email profile',
        VITE_COGNITO_API_TOKEN_USE: 'refresh',
      });
    }).toThrow(/VITE_COGNITO_API_TOKEN_USE must be access or id/);
  });

  it('production では Cognito と API の公開 URL に HTTPS の非 local host を要求する', () => {
    expect(() => {
      assertSafeWebRuntimeConfig({
        MODE: 'production',
        VITE_COGNITO_DOMAIN: 'http://localhost:9229',
        VITE_COGNITO_CLIENT_ID: 'client-1',
        VITE_COGNITO_SCOPES: 'openid email profile',
        VITE_COGNITO_REDIRECT_URI: 'http://localhost:5173/callback',
        VITE_COGNITO_LOGOUT_URI: 'http://127.0.0.1:5173/logout',
        VITE_API_BASE_URL: 'http://localhost:3000',
      });
    }).toThrow(
      /VITE_COGNITO_DOMAIN must use https.*VITE_COGNITO_REDIRECT_URI must use https.*VITE_COGNITO_LOGOUT_URI must use https.*VITE_API_BASE_URL must use https/,
    );
  });

  it('production では Cognito と API の private/internal host を拒否する', () => {
    expect(() => {
      assertSafeWebRuntimeConfig({
        MODE: 'production',
        VITE_COGNITO_DOMAIN: 'https://auth.internal',
        VITE_COGNITO_CLIENT_ID: 'client-1',
        VITE_COGNITO_SCOPES: 'openid email profile',
        VITE_COGNITO_REDIRECT_URI: 'https://192.168.0.10/callback',
        VITE_COGNITO_LOGOUT_URI: 'https://[fd00::1]/logout',
        VITE_API_BASE_URL: 'https://10.0.0.5',
      });
    }).toThrow(
      /VITE_COGNITO_DOMAIN must use https.*VITE_COGNITO_REDIRECT_URI must use https.*VITE_COGNITO_LOGOUT_URI must use https.*VITE_API_BASE_URL must use https/,
    );
  });

  it('production では Cognito と API の documentation/multicast IP host を拒否する', () => {
    expect(() => {
      assertSafeWebRuntimeConfig({
        MODE: 'production',
        VITE_COGNITO_DOMAIN: 'https://example.auth.ap-northeast-1.amazoncognito.com',
        VITE_COGNITO_CLIENT_ID: 'client-1',
        VITE_COGNITO_SCOPES: 'openid email profile',
        VITE_COGNITO_REDIRECT_URI: 'https://192.0.2.10/callback',
        VITE_COGNITO_LOGOUT_URI: 'https://[2001:db8::1]/logout',
        VITE_API_BASE_URL: 'https://203.0.113.10',
      });
    }).toThrow(
      /VITE_COGNITO_REDIRECT_URI must use https.*VITE_COGNITO_LOGOUT_URI must use https.*VITE_API_BASE_URL must use https/,
    );
  });

  it('production build check では Hosted UI 設定の必須化だけを外せる', () => {
    expect(() => {
      assertSafeWebRuntimeConfig(
        {
          MODE: 'production',
          VITE_SUPABASE_URL: 'https://example.supabase.co',
          VITE_SUPABASE_ANON_KEY: 'anon-key',
        },
        { requireProductionHostedAuth: false },
      );
    }).not.toThrow();
  });

  it('production build check でも dev auth bypass は拒否する', () => {
    expect(() => {
      assertSafeWebRuntimeConfig(
        {
          MODE: 'production',
          VITE_DEV_AUTH_BYPASS: 'true',
        },
        { requireProductionHostedAuth: false },
      );
    }).toThrow(/VITE_DEV_AUTH_BYPASS must be disabled/);
  });

  it('strict production config は explicit flag があるときだけ強制する', () => {
    expect(shouldRequireStrictWebProductionConfig({ LYRA_STRICT_WEB_PRODUCTION_CONFIG: 'true' })).toBe(true);
    expect(shouldRequireStrictWebProductionConfig({ LYRA_STRICT_WEB_PRODUCTION_CONFIG: 'false' })).toBe(false);
    expect(shouldRequireStrictWebProductionConfig({})).toBe(false);
  });
});
