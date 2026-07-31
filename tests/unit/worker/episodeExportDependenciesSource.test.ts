import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('episode export worker source boundary', () => {
  it('専用workerがgeneration queue handlerやcreditへ依存しない', () => {
    const dependencySource = readText('worker/episodeExportDependencies.ts');
    const handlerSource = readText('worker/episodeExport.ts');
    const runnerSource = readText('scripts/runEpisodeExportWorker.ts');

    for (const source of [dependencySource, handlerSource, runnerSource]) {
      expect(source).not.toContain('handleGenerationQueue');
      expect(source).not.toContain('GenerationQueuePoller');
      expect(source).not.toContain('CreditService');
      expect(source).not.toContain('GenerationJobRepository');
      expect(source).not.toContain('SQS_QUEUE_URL_GENERATION');
    }
    expect(runnerSource).toContain('SQS_QUEUE_URL_EXPORT');
    expect(runnerSource).toContain('EpisodeExportQueuePoller');
  });
});

function readText(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf8');
}
