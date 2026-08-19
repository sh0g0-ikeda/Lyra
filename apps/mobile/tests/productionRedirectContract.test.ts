import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

import productionRedirectContract from '../productionRedirectContract.json';

const require = createRequire(import.meta.url);
const { productionPublicEnvironment } = require('../productionPublicConfigContract.js') as {
  productionPublicEnvironment: Record<string, string>;
};

describe('production redirect contract', () => {
  it('native custom schemeとHTTPS universal linkのnamespaceを分離する', () => {
    expect(productionRedirectContract).toEqual({
      native: {
        callbackUri: 'lyra-mobile://auth/callback',
        logoutUri: 'lyra-mobile://auth/logout',
      },
      universalLink: {
        origin: 'https://app.lyra-editor.com',
        callbackPath: '/auth/mobile/callback',
        logoutPath: '/auth/mobile/logout',
      },
      productionPublic: {
        buildEnvironment: 'production',
        cognitoDomain: 'https://ap-northeast-1wizlzlgmm.auth.ap-northeast-1.amazoncognito.com',
        cognitoClientId: '6b2h941o888u2l7ejhv5jog94',
        cognitoScopes: ['openid', 'email'],
        organizationFeaturesEnabled: true,
      },
    });
  });

  it('production EAS profileとenv exampleがnative callback contractに一致する', async () => {
    const eas = JSON.parse(await readFile('eas.json', 'utf8')) as {
      build: { production: { env: Record<string, string> } };
    };
    const envExample = await readFile('.env.example', 'utf8');

    expect(eas.build.production.env).toMatchObject(productionPublicEnvironment);
    expect(envExample).toContain(
      `EXPO_PUBLIC_COGNITO_REDIRECT_URI=${productionRedirectContract.native.callbackUri}`,
    );
    expect(envExample).toContain(
      `EXPO_PUBLIC_COGNITO_LOGOUT_REDIRECT_URI=${productionRedirectContract.native.logoutUri}`,
    );
  });

  it('production preflightはpinしたEAS CLIで実際のproduction環境を読む', async () => {
    const packageJson = JSON.parse(await readFile('package.json', 'utf8')) as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts['preflight:production-config:eas']).toBe(
      'npx --yes --package eas-cli@16.32.0 eas env:exec production "npm run preflight:production-config" --non-interactive',
    );
  });
});
