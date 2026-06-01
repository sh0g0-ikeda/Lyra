import type { QueryResult, QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';
import type { DatabaseClient } from '../../../src/lib/db.js';
import { PostgresEntityGenerationExecutionRepository } from '../../../src/repositories/EntityGenerationExecutionRepository.js';

class QueryCapturingClient implements DatabaseClient {
  public queries: string[] = [];
  public values: readonly unknown[] | undefined;

  public async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<T>> {
    this.queries.push(text);
    this.values = values;

    return {
      command: 'SELECT',
      rowCount: 1,
      oid: 0,
      fields: [],
      rows: [jobRow()] as unknown as T[],
    };
  }
}

describe('PostgresEntityGenerationExecutionRepository', () => {
  it('claimQueuedEntityGenerationJob は entity_generate queued を processing にする', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresEntityGenerationExecutionRepository(client);

    const job = await repository.claimQueuedEntityGenerationJob('job-1');

    expect(client.queries[0]).toContain("job_type = 'entity_generate'");
    expect(client.queries[0]).toContain("status = 'queued'");
    expect(client.values).toEqual(['job-1']);
    expect(job?.status).toBe('processing');
  });

  it('completeEntityGeneration は candidates を result に保存する', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresEntityGenerationExecutionRepository(client);

    const completed = await repository.completeEntityGeneration({
      jobId: 'job-1',
      userId: 'user-1',
      structuredFields: {
        first_impression: 'quiet_neat',
      },
      candidates: [
        {
          refId: 'ref-1',
          s3Key: 'session/user-1/entities/entity-1/job-1-1.png',
          cdnUrl: 'https://cdn.lyra.test/session/user-1/entities/entity-1/job-1-1.png',
        },
      ],
      compiledBrief: 'Character visual anchor: compact bob',
      compiledPrompt: 'A clean full-body manga character reference with a compact bob.',
      openaiRequestId: 'req-1',
      costUsd: null,
      compiledPromptUsed: true,
      promptCompilerProvider: 'openai',
      compilerModel: 'gpt-5.4-mini',
      compilerPromptVersion: 'entity_ref_v2',
      compilerError: null,
      imageModel: 'gpt-image-2',
      imageParams: {
        quality: 'medium',
        size: '1024x1536',
      },
      createdAt: '2026-05-26T00:00:00.000Z',
    });

    expect(completed).toBe(true);
    expect(client.queries[0]).toContain("status = 'completed'");
    expect(client.values?.[2]).toBe(
      JSON.stringify({
        structured_fields: {
          first_impression: 'quiet_neat',
        },
        candidates: [
          {
            ref_id: 'ref-1',
            s3_key: 'session/user-1/entities/entity-1/job-1-1.png',
            cdn_url: 'https://cdn.lyra.test/session/user-1/entities/entity-1/job-1-1.png',
          },
        ],
        compiled_brief: 'Character visual anchor: compact bob',
        compiled_prompt: 'A clean full-body manga character reference with a compact bob.',
        cost_usd: null,
        compiled_prompt_used: true,
        prompt_compiler_provider: 'openai',
        compiler_model: 'gpt-5.4-mini',
        compiler_prompt_version: 'entity_ref_v2',
        compiler_error: null,
        image_model: 'gpt-image-2',
        image_params: {
          quality: 'medium',
          size: '1024x1536',
        },
        created_at: '2026-05-26T00:00:00.000Z',
      }),
    );
  });
});

function jobRow(): Record<string, unknown> {
  return {
    id: 'job-1',
    user_id: 'user-1',
    job_type: 'entity_generate',
    status: 'processing',
    generation_mode: null,
    credit_cost: 8,
    params: {
      entity_id: 'entity-1',
      entity_type: 'character',
      previous_entity_status: 'draft',
    },
    result: null,
    sqs_message_id: null,
    openai_request_id: null,
    error_message: null,
    retry_count: 0,
    created_at: new Date('2026-04-25T00:00:00.000Z'),
    started_at: new Date('2026-04-25T00:00:01.000Z'),
    completed_at: null,
    expires_at: null,
  };
}
