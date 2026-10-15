import { describe, expect, it } from 'vitest';
import { fingerprintQuoteInput, GENERATION_QUOTE_PRICING_VERSION } from '../../../../src/domain/generation/GenerationQuotePolicy.js';
import type { GenerationQuote } from '../../../../src/domain/types/generationQuote.js';
import type { GenerationJob } from '../../../../src/domain/types/job.js';
import { assertQuotedImportJobMatches } from '../../../../src/services/generation/QuotedImportWorkerService.js';

function quoteFor(model: string): GenerationQuote {
  const snapshot = {
    kind: 'import' as const,
    entityType: 'object' as const,
    source: {
      uploadId: 'upload-1', tokenHash: 'token-hash', s3Key: 'tmp/user-1/entities/imports/upload-1.png',
      mimeType: 'image/png' as const, sizeBytes: 8, eTag: 'etag', sha256: 'digest', entityId: null,
    },
  };
  return {
    id: 'quote-1', userId: 'user-1', organizationId: null, request: { operation: 'entity_import_analysis' },
    plan: {
      operation: 'entity_import_analysis', targetId: 'upload-1', workId: null,
      inputRevision: fingerprintQuoteInput(snapshot), imageModel: null, providerModelId: model,
      quality: null, renderStyle: null, referenceCount: 1, amountCredits: 1,
      pricingVersion: GENERATION_QUOTE_PRICING_VERSION, generationMode: null,
      jobParams: { upload_id: 'upload-1', entity_id: null, entity_type: 'object', source_s3_key: snapshot.source.s3Key }, snapshot,
    },
    expiresAt: new Date('2026-10-15T00:00:00.000Z'), acceptedJobId: 'job-1', requestKey: 'request-1', acceptedAt: new Date('2026-10-15T00:00:00.000Z'),
  };
}

function jobFor(quote: GenerationQuote, providerModelId = quote.plan.providerModelId): GenerationJob {
  return {
    id: 'job-1', userId: 'user-1', organizationId: null, jobType: 'entity_import_analysis', status: 'queued', generationMode: null,
    creditCost: 1, params: { ...quote.plan.jobParams, quote_id: quote.id, image_model: null, provider_model_id: providerModelId,
      quoted_input_revision: quote.plan.inputRevision, pricing_version: quote.plan.pricingVersion }, result: null, sqsMessageId: null,
    openaiRequestId: null, errorMessage: null, retryCount: 0, createdAt: new Date(), startedAt: null, completedAt: null,
    expiresAt: null, cancelRequestedAt: null, cancelRequestedBy: null, cancelledAt: null, commitStartedAt: null,
  };
}

describe('QuotedImportWorkerService quote model policy', () => {
  it.each(['gpt-4o', 'gpt-5.4-mini'] as const)('受諾済み%s quoteは同一モデルで実行を許可する', (model) => {
    const quote = quoteFor(model);
    expect(assertQuotedImportJobMatches(jobFor(quote), quote)).toBe(model);
  });

  it('許可外モデルはprovider呼出し前に拒否する', () => {
    const quote = quoteFor('gpt-5.4');
    expect(() => assertQuotedImportJobMatches(jobFor(quote), quote)).toThrow('unsupported');
  });

  it('quoteとjobのprovider modelが異なる場合は許可済みモデルにも実行しない', () => {
    const quote = quoteFor('gpt-4o');
    expect(() => assertQuotedImportJobMatches(jobFor(quote, 'gpt-5.4-mini'), quote)).toThrow('stale');
  });
});
