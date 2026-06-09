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
});

function readText(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf8');
}
