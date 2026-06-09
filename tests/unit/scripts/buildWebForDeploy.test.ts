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
});
