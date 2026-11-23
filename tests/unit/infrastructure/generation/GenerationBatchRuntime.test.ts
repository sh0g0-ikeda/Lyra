import { describe, expect, it, vi } from 'vitest';
import { createGenerationBatchRuntime } from '../../../../src/infrastructure/generation/GenerationBatchRuntime.js';
import { parseEnv } from '../../../../src/lib/env.js';
import type { DatabaseClient, TransactionRunner } from '../../../../src/lib/db.js';

// Rollout must be able to boot against pre-055 databases with this feature off.
// Invalid enabled configurations fail before database or provider access.
describe('GenerationBatchRuntime', () => {
  const query = vi.fn();
  const transaction = vi.fn();
  const database: DatabaseClient & TransactionRunner = { query, transaction };

  it('無効な場合に新テーブルや外部サービスへ接続せず既存runtimeを維持する', () => {
    const environment = parseEnv({ APP_ENV: 'test', GENERATION_BATCHES_ENABLED: 'false' });
    expect(createGenerationBatchRuntime(environment, database, 'canonical')).toBeUndefined();
    expect(query).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });

  it.each([
    { GENERATION_QUOTES_ENABLED: 'false' },
    { OPENAI_IMAGE_SUNBURST_ENABLED: 'false' },
    { S3_BUCKET_IMAGES: undefined },
    { SQS_QUEUE_URL_GENERATION: undefined },
    { LOCAL_IMAGE_FALLBACK_ENABLED: 'true' },
  ])('有効化の必要条件が欠ける場合に起動時点で拒否する: %j', (override) => {
    const environment = parseEnv({
      APP_ENV: 'test', GENERATION_BATCHES_ENABLED: 'true', GENERATION_QUOTES_ENABLED: 'true',
      OPENAI_IMAGE_SUNBURST_ENABLED: 'true', S3_BUCKET_IMAGES: 'batch-runtime-test',
      SQS_QUEUE_URL_GENERATION: 'https://sqs.ap-northeast-1.amazonaws.com/123/test',
      LOCAL_IMAGE_FALLBACK_ENABLED: 'false', ...override,
    });
    expect(() => createGenerationBatchRuntime(environment, database, 'canonical'))
      .toThrow('Generation batches require GPT Image 2.5 quotes, durable queue and image storage');
    expect(query).not.toHaveBeenCalled();
  });
});
