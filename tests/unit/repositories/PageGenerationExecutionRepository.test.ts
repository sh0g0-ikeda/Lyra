import type { QueryResult, QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';
import type { DatabaseClient } from '../../../src/lib/db.js';
import { PostgresPageGenerationExecutionRepository } from '../../../src/repositories/PageGenerationExecutionRepository.js';

class QueryCapturingClient implements DatabaseClient {
  public queries: string[] = [];
  public values: Array<readonly unknown[] | undefined> = [];
  public rowCounts: number[] = [];

  public async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<T>> {
    this.queries.push(text);
    this.values.push(values);
    const rowCount = this.rowCounts.shift() ?? 1;

    return {
      command: 'SELECT',
      rowCount,
      oid: 0,
      fields: [],
      rows: rowCount > 0 ? [jobRow()] as unknown as T[] : [],
    };
  }

  public async transaction<T>(work: (client: DatabaseClient) => Promise<T>): Promise<T> {
    return work(this);
  }
}

describe('PostgresPageGenerationExecutionRepository', () => {
  it('queued jobをprocessingでclaimする', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresPageGenerationExecutionRepository(client);

    const job = await repository.claimQueuedPageGenerationJob('job-1');

    expect(client.queries[0]).toContain("SET status = 'processing'");
    expect(client.queries[0]).toContain("status = 'queued'");
    expect(client.values[0]).toEqual(['job-1']);
    expect(job?.status).toBe('processing');
  });

  it('completed 更新でpages.generated_imageとjob.resultを保存する', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresPageGenerationExecutionRepository(client);

    const completed = await repository.completePageGeneration({
      jobId: 'job-1',
      userId: 'user-1',
      pageId: 'page-1',
      generationMode: 'thinking',
      requestKind: 'regenerate',
      s3Key: 'session/user-1/pages/page-1/result.png',
      cdnUrl: 'https://cdn.lyra.test/page-1.png',
      generatedAt: '2026-04-24T00:00:00.000Z',
      costUsd: 0.08,
      openaiRequestId: 'openai-1',
      promptMetadata: {
        draftPrompt: 'draft prompt',
        compilerBrief: '[TASK]\nbrief',
        compiledPrompt: 'compiled prompt',
        compiledPromptUsed: true,
        promptCompilerProvider: 'openai',
        compilerModel: 'gpt-5.4-mini',
        compilerPromptVersion: 'page_prompt_v2',
        compilerError: null,
      },
    });

    expect(completed).toBe(true);
    expect(client.queries[0]).toContain('UPDATE pages');
    expect(client.queries[1]).toContain("SET status = 'completed'");
    expect(client.values[0]).toEqual([
      'page-1',
      'user-1',
      'session/user-1/pages/page-1/result.png',
      'https://cdn.lyra.test/page-1.png',
      'thinking',
      '2026-04-24T00:00:00.000Z',
    ]);
    expect(client.values[1]).toEqual([
      'job-1',
      'user-1',
      JSON.stringify({
        s3_key: 'session/user-1/pages/page-1/result.png',
        cdn_url: 'https://cdn.lyra.test/page-1.png',
        generation_mode: 'thinking',
        request_kind: 'regenerate',
        cost_usd: 0.08,
        draft_prompt_sha256: '8f458698fd5f818ff1e01da76a3ac97549adee06a29cf84d41ac3cbde283c26d',
        draft_prompt_bytes: 12,
        compiled_brief_sha256: 'd376876e55ec00bc214966cb93341e2b0e004577fd00dd2537cace8dc2c328df',
        compiled_brief_bytes: 12,
        compiled_prompt_sha256: '3933ca9c4b8ba6126fbbfff84d1bdac485836784b4ef147550e757cf8895451a',
        compiled_prompt_bytes: 15,
        compiled_prompt_used: true,
        prompt_compiler_provider: 'openai',
        compiler_model: 'gpt-5.4-mini',
        compiler_prompt_version: 'page_prompt_v2',
        compiler_error: null,
      }),
      'openai-1',
    ]);
  });

  it('failed 更新でjobとpage stateを元に戻す', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresPageGenerationExecutionRepository(client);
    const fakeApiKey = ['sk', 'testsecret123'].join('-');

    const failed = await repository.failPageGeneration({
      jobId: 'job-1',
      userId: 'user-1',
      errorMessage: `renderer unavailable Authorization: Bearer ${fakeApiKey} ${'x'.repeat(500)}`,
      pageId: 'page-1',
      previousStatus: 'editing',
      previousGenerationMode: 'standard',
    });

    expect(failed).toBe(true);
    expect(client.queries[0]).toContain("SET status = 'failed'");
    expect(client.queries[0]).toContain("status IN ('queued', 'processing')");
    expect(client.queries[1]).toContain('UPDATE pages');
    const persistedMessage = String(client.values[0]?.[2]);
    expect(persistedMessage).toContain('Bearer [redacted]');
    expect(persistedMessage).not.toContain(fakeApiKey);
    expect(persistedMessage.length).toBeLessThanOrEqual(300);
    expect(client.values[1]).toEqual(['page-1', 'user-1', 'editing', 'standard']);
  });
  it('job completion更新に失敗した場合はtransactionを失敗させる', async () => {
    const client = new QueryCapturingClient();
    client.rowCounts = [1, 0];
    const repository = new PostgresPageGenerationExecutionRepository(client);

    await expect(
      repository.completePageGeneration({
        jobId: 'job-1',
        userId: 'user-1',
        pageId: 'page-1',
        generationMode: 'standard',
        requestKind: 'initial',
        s3Key: 'session/user-1/pages/page-1/result.png',
        cdnUrl: 'https://cdn.lyra.test/page-1.png',
        generatedAt: '2026-04-24T00:00:00.000Z',
        costUsd: 0.05,
        openaiRequestId: 'openai-1',
        promptMetadata: {
          draftPrompt: 'draft prompt',
          compilerBrief: '[TASK]\nbrief',
          compiledPrompt: 'compiled prompt',
          compiledPromptUsed: true,
          promptCompilerProvider: 'openai',
          compilerModel: 'gpt-5.4-mini',
          compilerPromptVersion: 'page_prompt_v2',
          compilerError: null,
        },
      }),
    ).rejects.toThrow('Failed to update generation job completion state');
  });

  it('page restoreできなくてもjob failedは成立させる', async () => {
    const client = new QueryCapturingClient();
    client.rowCounts = [1, 0];
    const repository = new PostgresPageGenerationExecutionRepository(client);

    const failed = await repository.failPageGeneration({
      jobId: 'job-1',
      userId: 'user-1',
      errorMessage: 'renderer unavailable',
      pageId: 'page-1',
      previousStatus: 'designing',
      previousGenerationMode: null,
    });

    expect(failed).toBe(true);
  });
});

function jobRow(): Record<string, unknown> {
  return {
    id: 'job-1',
    user_id: 'user-1',
    job_type: 'page_generate',
    status: 'processing',
    generation_mode: 'standard',
    credit_cost: 10,
    params: {
      page_id: 'page-1',
      request_kind: 'initial',
      generation_mode: 'standard',
      quality: 'medium',
      requires_planner: false,
      previous_page_status: 'designing',
      previous_generation_mode: null,
    },
    result: null,
    sqs_message_id: null,
    openai_request_id: null,
    error_message: null,
    retry_count: 0,
    created_at: new Date('2026-04-24T00:00:00.000Z'),
    started_at: null,
    completed_at: null,
    expires_at: new Date('2026-05-01T00:00:00.000Z'),
  };
}
