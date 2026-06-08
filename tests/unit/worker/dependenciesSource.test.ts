import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('worker dependency policy', () => {
  it('does not route runtime LLM prompt compilation to Anthropic', () => {
    const source = readFileSync(join(process.cwd(), 'worker/dependencies.ts'), 'utf8');

    expect(source).not.toContain("infrastructure/anthropic");
    expect(source).not.toContain('AnthropicEntityReferencePromptCompiler');
  });
});
