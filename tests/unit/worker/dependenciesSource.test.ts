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

  it('runs production runtime guard before worker polling starts', () => {
    const source = readFileSync(join(process.cwd(), 'scripts', 'runGenerationWorker.ts'), 'utf8');

    expect(source).toContain("import { assertProductionRuntimeConfig, assertAttestedRuntimeCapabilities } from '../src/lib/runtimeGuards.js';");
    expect(source).toContain('assertProductionRuntimeConfig(env);');
    expect(source.indexOf('assertProductionRuntimeConfig(env);')).toBeLessThan(
      source.indexOf("if (env.SQS_QUEUE_URL_GENERATION === undefined)"),
    );
  });

  it('場面監査をplanner flagから独立して接続し明示OFFとローカルだけ無効にする', () => {
    const source = readFileSync(join(process.cwd(), 'worker/dependencies.ts'), 'utf8');
    const auditFactory = source.slice(source.indexOf('function resolvePagePreRenderSceneAuditor()'),
      source.indexOf('function resolvePageImageRenderer()'));
    expect(source).toContain('overrides.pagePreRenderSceneAuditor ?? resolvePagePreRenderSceneAuditor()');
    expect(auditFactory).toContain('!env.LLM_PAGE_SCENE_AUDIT_ENABLED || env.LOCAL_IMAGE_FALLBACK_ENABLED');
    expect(auditFactory).toContain('new OpenAIPagePreRenderSceneAuditor(client)');
    expect(auditFactory).toContain('timeoutMs: Math.min(env.OPENAI_TIMEOUT_MS, PAGE_SCENE_AUDIT_TIMEOUT_MS)');
    expect(auditFactory).not.toContain('LLM_PAGE_PLANNER_ENABLED');
    expect(auditFactory).not.toContain('LLM_PAGE_PROMPT_COMPILER_ENABLED');
  });

  it('production worker起動前にtask protection opt-in設定を検証する', () => {
    const source = readFileSync(join(process.cwd(), 'scripts', 'startProductionWorker.ts'), 'utf8');

    expect(source).toContain('assertTaskScaleInProtectionEnvironment(process.env);');
    expect(source.indexOf('await loadRuntimeSecretEnv();')).toBeLessThan(
      source.indexOf('assertTaskScaleInProtectionEnvironment(process.env);'),
    );
    expect(source.indexOf('assertTaskScaleInProtectionEnvironment(process.env);')).toBeLessThan(
      source.indexOf("await import('./runGenerationWorker.js');"),
    );
  });
});

function countOccurrences(source: string, pattern: string): number {
  return source.split(pattern).length - 1;
}
