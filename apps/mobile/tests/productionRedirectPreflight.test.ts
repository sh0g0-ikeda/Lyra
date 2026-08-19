import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const scriptPath = 'scripts/checkProductionPublicConfig.mjs';
const productionPublicEnvironment = {
  EXPO_PUBLIC_BUILD_ENVIRONMENT: 'production',
  EXPO_PUBLIC_APP_LINK_HOST: 'app.lyra-editor.com',
  EXPO_PUBLIC_API_BASE_URL: 'https://app.lyra-editor.com',
  EXPO_PUBLIC_COGNITO_DOMAIN: 'https://ap-northeast-1wizlzlgmm.auth.ap-northeast-1.amazoncognito.com',
  EXPO_PUBLIC_COGNITO_CLIENT_ID: '6b2h941o888u2l7ejhv5jog94',
  EXPO_PUBLIC_COGNITO_REDIRECT_URI: 'lyra-mobile://auth/callback',
  EXPO_PUBLIC_COGNITO_LOGOUT_REDIRECT_URI: 'lyra-mobile://auth/logout',
  EXPO_PUBLIC_COGNITO_SCOPES: 'openid,email',
  EXPO_PUBLIC_ORGANIZATION_FEATURES_ENABLED: 'true',
};

const runPreflight = (environment: Partial<Record<keyof typeof productionPublicEnvironment, string>>): string => {
  const sanitizedEnvironment = { ...process.env };
  for (const variableName of Object.keys(productionPublicEnvironment)) {
    delete sanitizedEnvironment[variableName];
  }

  try {
    return execFileSync(process.execPath, [scriptPath], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: { ...sanitizedEnvironment, ...environment },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error: unknown) {
    const failure = error as { stderr?: string; stdout?: string };
    return `${failure.stdout ?? ''}${failure.stderr ?? ''}`;
  }
};

describe('production redirect release preflight', () => {
  it('canonical production public environment shapeだけを通す', () => {
    expect(runPreflight(productionPublicEnvironment)).toContain('PASS');

    const output = runPreflight({
      ...productionPublicEnvironment,
      EXPO_PUBLIC_COGNITO_REDIRECT_URI: 'lyra-mobile://auth/mobile/callback',
    });
    expect(output).toContain('EXPO_PUBLIC_COGNITO_REDIRECT_URI');
    expect(output).not.toContain('lyra-mobile://auth/mobile/callback');
  });

  it.each([
    'EXPO_PUBLIC_BUILD_ENVIRONMENT',
    'EXPO_PUBLIC_APP_LINK_HOST',
    'EXPO_PUBLIC_API_BASE_URL',
    'EXPO_PUBLIC_COGNITO_DOMAIN',
    'EXPO_PUBLIC_COGNITO_CLIENT_ID',
    'EXPO_PUBLIC_COGNITO_REDIRECT_URI',
    'EXPO_PUBLIC_COGNITO_LOGOUT_REDIRECT_URI',
    'EXPO_PUBLIC_COGNITO_SCOPES',
    'EXPO_PUBLIC_ORGANIZATION_FEATURES_ENABLED',
  ] as const)('production public variable %sが欠ける場合はPASSしない', (variableName) => {
    const incompleteEnvironment = { ...productionPublicEnvironment };
    delete incompleteEnvironment[variableName];

    const output = runPreflight(incompleteEnvironment);
    expect(output).toContain(`FAIL ${variableName}`);
    expect(output).not.toContain('PASS');
  });
});
