import { describe, expect, it } from 'vitest';
import { resolveFoundationRoute } from '../src/navigation/foundationRoute';

describe('resolveFoundationRoute', () => {
  it('設定不備と起動中と未認証を安全な画面へ振り分ける', () => {
    expect(
      resolveFoundationRoute({
        configValid: false,
        hydrated: false,
        authenticated: false,
        sessionReady: false,
        sessionFailed: false,
      }),
    ).toBe('configuration-error');
    expect(
      resolveFoundationRoute({
        configValid: true,
        hydrated: false,
        authenticated: false,
        sessionReady: false,
        sessionFailed: false,
      }),
    ).toBe('booting');
    expect(
      resolveFoundationRoute({
        configValid: true,
        hydrated: true,
        authenticated: false,
        sessionReady: false,
        sessionFailed: false,
      }),
    ).toBe('sign-in');
  });

  it('認証後はsession取得結果に応じて待機・再試行・ホームへ振り分ける', () => {
    const base = {
      configValid: true,
      hydrated: true,
      authenticated: true,
      sessionReady: false,
      sessionFailed: false,
    };

    expect(resolveFoundationRoute(base)).toBe('loading-session');
    expect(resolveFoundationRoute({ ...base, sessionFailed: true })).toBe(
      'session-error',
    );
    expect(resolveFoundationRoute({ ...base, sessionReady: true })).toBe(
      'home',
    );
  });
});
