import { describe, expect, it } from 'vitest';
import { buildWebDeployEnv } from '../../../scripts/buildWebForDeploy.js';

describe('buildWebDeployEnv', () => {
  it('deployment build では strict flag を有効化し local Supabase env を既定で空にする', () => {
    const env = buildWebDeployEnv({
      VITE_COGNITO_CLIENT_ID: 'client-1',
    });

    expect(env.LYRA_STRICT_WEB_PRODUCTION_CONFIG).toBe('true');
    expect(env.VITE_SUPABASE_URL).toBe('');
    expect(env.VITE_SUPABASE_ANON_KEY).toBe('');
    expect(env.VITE_COGNITO_CLIENT_ID).toBe('client-1');
  });

  it('CI が Supabase env を明示した場合は上書きせず production guard に検出させる', () => {
    const env = buildWebDeployEnv({
      VITE_SUPABASE_URL: 'https://example.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'anon-key',
    });

    expect(env.VITE_SUPABASE_URL).toBe('https://example.supabase.co');
    expect(env.VITE_SUPABASE_ANON_KEY).toBe('anon-key');
  });

  it('法人機能フラグが未設定の場合は本番用に有効化する', () => {
    const env = buildWebDeployEnv({});

    expect(env.VITE_ORGANIZATION_FEATURES_ENABLED).toBe('true');
  });

  it('法人機能フラグが false の場合は本番ビルドを拒否する', () => {
    expect(() => buildWebDeployEnv({ VITE_ORGANIZATION_FEATURES_ENABLED: 'false' })).toThrow(
      'VITE_ORGANIZATION_FEATURES_ENABLED must be true for deployment builds',
    );
  });

  it('法人機能フラグが true の場合は維持する', () => {
    const env = buildWebDeployEnv({ VITE_ORGANIZATION_FEATURES_ENABLED: 'true' });

    expect(env.VITE_ORGANIZATION_FEATURES_ENABLED).toBe('true');
  });
});
