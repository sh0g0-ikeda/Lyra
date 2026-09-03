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

  it('episode story autofill の各 compiler に検証済み profile の対応 stage を配線する', () => {
    const workerSource = readFileSync(join(process.cwd(), 'worker/dependencies.ts'), 'utf8');
    const appSource = readFileSync(join(process.cwd(), 'src', 'app.ts'), 'utf8');

    for (const source of [workerSource, appSource]) {
      expect(source).toMatch(
        /resolveEpisodeOpenAIModelProfile\(\s*env\.OPENAI_EPISODE_TEXT_PROFILE,?\s*\)/u,
      );
      expect(source).toMatch(
        /resolveEpisodePagePlanCompiler\(episodeOpenAIModelProfile\.detail\)/u,
      );
      expect(source).toMatch(
        /resolveEpisodeBeatPlanCompiler\(episodeOpenAIModelProfile\.beat\)/u,
      );
      expect(source).toMatch(
        /resolveEpisodePlanAuditCompiler\(episodeOpenAIModelProfile\.audit\)/u,
      );
    }
  });

  it('runs production runtime guard before worker polling starts', () => {
    const source = readFileSync(join(process.cwd(), 'scripts', 'runGenerationWorker.ts'), 'utf8');

    expect(source).toContain("import { assertProductionRuntimeConfig } from '../src/lib/runtimeGuards.js';");
    expect(source).toContain('assertProductionRuntimeConfig(env);');
    expect(source.indexOf('assertProductionRuntimeConfig(env);')).toBeLessThan(
      source.indexOf("if (env.SQS_QUEUE_URL_GENERATION === undefined)"),
    );
  });
});

function countOccurrences(source: string, pattern: string): number {
  return source.split(pattern).length - 1;
}
