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
    expect(webEnvExample).toContain('VITE_COGNITO_SCOPES=openid email profile');
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
