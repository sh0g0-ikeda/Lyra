import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('environment examples', () => {
  it('Cognito examples use the recommended id token flow by default', () => {
    const rootEnvExample = readText('.env.example');
    const webEnvExample = readText('apps/web/.env.example');

    expect(rootEnvExample).toContain('COGNITO_TOKEN_USE=id');
    expect(rootEnvExample).not.toMatch(/^COGNITO_REQUIRED_SCOPES=/mu);
    expect(webEnvExample).toContain('VITE_COGNITO_API_TOKEN_USE=id');
    expect(rootEnvExample).toContain('COGNITO_ALLOWED_CLIENT_IDS');
    expect(webEnvExample).toContain('VITE_COGNITO_SCOPES=openid email');
    expect(webEnvExample).not.toMatch(/^VITE_COGNITO_SCOPES=.*lyra\/api/mu);
  });

  it('root env example does not advertise Anthropic keys for runtime LLM paths', () => {
    const rootEnvExample = readText('.env.example');

    expect(rootEnvExample).not.toMatch(/^ANTHROPIC_/mu);
  });

  it('root env example declares the application environment explicitly', () => {
    const rootEnvExample = readText('.env.example');

    expect(rootEnvExample).toMatch(/^APP_ENV=development$/mu);
  });

  it('root env example keeps generation disabled until provider settings are real', () => {
    const rootEnvExample = readText('.env.example');

    expect(rootEnvExample).toMatch(/^GENERATION_ENABLED=false$/mu);
  });

  it('root env example keeps episode export disabled and uses a dedicated queue', () => {
    const rootEnvExample = readText('.env.example');

    expect(rootEnvExample).toMatch(/^EPISODE_EXPORT_ENABLED=false$/mu);
    expect(rootEnvExample).toMatch(/^SQS_QUEUE_URL_EXPORT=/mu);
    expect(rootEnvExample).toMatch(/^SQS_EXPORT_VISIBILITY_TIMEOUT_SECONDS=1800$/mu);
  });

  it('root env example keeps mobile store billing disabled and documents both providers', () => {
    const rootEnvExample = readText('.env.example');

    expect(rootEnvExample).toMatch(/^MOBILE_STORE_BILLING_ENABLED=false$/mu);
    expect(rootEnvExample).toMatch(/^ACCOUNT_DELETION_ENABLED=false$/mu);
    expect(rootEnvExample).toMatch(
      /^ACCOUNT_DELETION_IDENTITY_HASH_SECRET=$/mu,
    );
    expect(rootEnvExample).toMatch(/^APPLE_STORE_BUNDLE_ID=/mu);
    expect(rootEnvExample).toMatch(/^GOOGLE_PLAY_PACKAGE_NAME=/mu);
    expect(rootEnvExample).toMatch(/^GOOGLE_PLAY_PUBSUB_AUDIENCE=/mu);
  });

  it('root env example uses the repository standard migration command', () => {
    const rootEnvExample = readText('.env.example');

    expect(rootEnvExample).toContain('bun run migrate');
    expect(rootEnvExample).not.toContain('npm run migrate');
  });

  it('web README points production deploys at the strict deploy build gate', () => {
    const webReadme = readText('apps/web/README.md');

    expect(webReadme).toContain('bun run web:build:deploy');
    expect(webReadme).toContain('LYRA_STRICT_WEB_PRODUCTION_CONFIG=true');
    expect(webReadme).not.toContain('VITE_REQUIRE_HOSTED_AUTH');
  });
});

function readText(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf8');
}
