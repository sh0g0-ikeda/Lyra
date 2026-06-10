import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('worker dependency policy', () => {
  it('does not route runtime LLM prompt compilation to Anthropic', () => {
    const source = readFileSync(join(process.cwd(), 'worker/dependencies.ts'), 'utf8');
    const entityReferenceConstants = readFileSync(
      join(process.cwd(), 'src', 'domain', 'constants', 'entityReference.ts'),
      'utf8',
    );

    expect(source).not.toContain("infrastructure/anthropic");
    expect(source).not.toContain('AnthropicEntityReferencePromptCompiler');
    expect(entityReferenceConstants).not.toContain('claude');
    expect(existsSync(join(process.cwd(), 'src', 'infrastructure', 'anthropic'))).toBe(false);
  });

  it('uses the low-retry OpenAI client for long-running image generation calls', () => {
    const source = readFileSync(join(process.cwd(), 'worker/dependencies.ts'), 'utf8');

    expect(source).toContain(
      'const client = buildOpenAIClient({ maxRetries: IMAGE_GENERATION_OPENAI_MAX_RETRIES });',
    );
    expect(countOccurrences(source, 'maxRetries: IMAGE_GENERATION_OPENAI_MAX_RETRIES')).toBe(2);
  });
});

function countOccurrences(source: string, pattern: string): number {
  return source.split(pattern).length - 1;
}
