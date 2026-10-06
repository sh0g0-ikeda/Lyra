import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { validateBuildEnvironment } from './build.env.guard.mjs';

const valid = {
  ECR_REPOSITORY_URI: '452284481392.dkr.ecr.ap-northeast-1.amazonaws.com/lyra-staging-20261003-api',
  IMAGE_TAG: 'a'.repeat(40),
  STAGING_API_URL: 'https://d2dw83tkmziksr.cloudfront.net',
  STAGING_COGNITO_DOMAIN: 'https://lyra-staging-20261003-auth.auth.ap-northeast-1.amazoncognito.com',
  STAGING_WEB_CLIENT_ID: '7oma7s7gkoo5au4jk4ak9mkihd',
};

test('staging build environmentを受け入れる', () => assert.doesNotThrow(() => validateBuildEnvironment(valid)));
test('production repositoryとendpointを拒否する', () => {
  assert.throws(() => validateBuildEnvironment({ ...valid, ECR_REPOSITORY_URI: 'x/lyra-prod-api' }));
  assert.throws(() => validateBuildEnvironment({ ...valid, STAGING_API_URL: 'https://app.lyra-editor.com' }));
});
test('CLI guardは不正なenvironmentで非ゼロ終了する', () => {
  const result = spawnSync(process.execPath, ['ops/staging/build.env.guard.mjs'], { cwd: process.cwd(), env: { ...process.env, ...valid, STAGING_API_URL: 'https://app.lyra-editor.com' } });
  assert.notEqual(result.status, 0);
});
test('buildspecがarm64 immutable tagと安全なVite引数を渡す', () => {
  const spec = readFileSync(new URL('./buildspec.yml', import.meta.url), 'utf8');
  for (const value of ['set -euo pipefail', 'docker build --platform linux/arm64', 'VITE_API_BASE_URL', 'VITE_COGNITO_DOMAIN', 'VITE_COGNITO_CLIENT_ID', 'VITE_COGNITO_REDIRECT_URI', 'VITE_COGNITO_LOGOUT_URI', "VITE_COGNITO_SCOPES='openid email'", 'VITE_COGNITO_API_TOKEN_USE=id', 'VITE_ORGANIZATION_FEATURES_ENABLED=true', 'aws ecr get-login-password', 'docker login --username AWS --password-stdin', 'IMAGE_TAG']) {
    assert.match(spec, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});
