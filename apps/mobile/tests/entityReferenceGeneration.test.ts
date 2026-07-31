import { describe, expect, it } from 'vitest';
import type { GenerationJobRecord } from '../src/lib/api';
import {
  findActiveEntityGenerationJob,
  readCompletedEntityGenerationCandidates,
  recoverEntityGenerationJob,
} from '../src/domain/entityReferenceGeneration';

const timestamp = '2026-08-01T00:00:00.000Z';

function entityJob(input: {
  id?: string;
  entityId?: string;
  status?: GenerationJobRecord['status'];
  createdAt?: string;
  candidates?: string[];
} = {}): GenerationJobRecord {
  return {
    id: input.id ?? 'job-1',
    job_type: 'entity_generate',
    status: input.status ?? 'queued',
    generation_mode: null,
    credit_cost: 1,
    params: {
      entity_id: input.entityId ?? 'entity-1',
      entity_type: 'character',
    },
    result: input.status === 'completed'
      ? {
          provider_result: true,
          candidates: (input.candidates ?? ['candidate-1']).map((candidate_token) => ({
            candidate_token,
          })),
        }
      : null,
    error_message: null,
    retry_count: 0,
    created_at: input.createdAt ?? timestamp,
    started_at: null,
    completed_at: input.status === 'completed' ? timestamp : null,
    expires_at: null,
    cancel_requested_at: null,
    cancelled_at: null,
    commit_started_at: null,
  };
}

function pageJob(): GenerationJobRecord {
  return {
    id: 'page-job',
    job_type: 'page_generate',
    status: 'queued',
    generation_mode: 'standard',
    credit_cost: 1,
    params: { page_id: 'page-1' },
    result: null,
    error_message: null,
    retry_count: 0,
    created_at: timestamp,
    started_at: null,
    completed_at: null,
    expires_at: null,
    cancel_requested_at: null,
    cancelled_at: null,
    commit_started_at: null,
  };
}

describe('entityReferenceGeneration', () => {
  it('同じEntityのactive entity_generateだけを復元する', () => {
    const matching = entityJob({ id: 'matching' });

    expect(findActiveEntityGenerationJob([
      pageJob(),
      entityJob({ id: 'other-entity', entityId: 'entity-2' }),
      entityJob({ id: 'completed', status: 'completed' }),
      matching,
    ], 'entity-1')).toEqual(matching);
  });

  it('POST応答消失時は開始後の一意なjobだけを復元する', () => {
    const recovered = entityJob({
      id: 'new-job',
      status: 'completed',
      createdAt: '2026-08-01T00:00:05.000Z',
    });

    expect(recoverEntityGenerationJob({
      jobs: [
        entityJob({
          id: 'old-job',
          status: 'completed',
          createdAt: '2026-07-31T23:59:00.000Z',
        }),
        recovered,
      ],
      entityId: 'entity-1',
      startedAt: new Date('2026-08-01T00:00:00.000Z'),
    })).toEqual({ status: 'recovered', job: recovered });
  });

  it('POST応答消失後に複数の新規jobがあれば曖昧として採用しない', () => {
    expect(recoverEntityGenerationJob({
      jobs: [
        entityJob({ id: 'new-job-1', createdAt: '2026-08-01T00:00:01.000Z' }),
        entityJob({ id: 'new-job-2', createdAt: '2026-08-01T00:00:02.000Z' }),
      ],
      entityId: 'entity-1',
      startedAt: new Date('2026-08-01T00:00:00.000Z'),
    })).toEqual({ status: 'ambiguous' });
  });

  it('completed候補は1〜3個かつtoken重複なしの場合だけ採用する', () => {
    expect(readCompletedEntityGenerationCandidates(entityJob({
      status: 'completed',
      candidates: ['candidate-1', 'candidate-2', 'candidate-3'],
    }), 'entity-1')).toEqual([
      { index: 0, token: 'candidate-1' },
      { index: 1, token: 'candidate-2' },
      { index: 2, token: 'candidate-3' },
    ]);

    expect(readCompletedEntityGenerationCandidates(entityJob({
      status: 'completed',
      candidates: [],
    }), 'entity-1')).toBeNull();
    expect(readCompletedEntityGenerationCandidates(entityJob({
      status: 'completed',
      candidates: ['candidate-1', 'candidate-1'],
    }), 'entity-1')).toBeNull();
    expect(readCompletedEntityGenerationCandidates(entityJob({
      status: 'completed',
      candidates: ['1', '2', '3', '4'],
    }), 'entity-1')).toBeNull();
    expect(readCompletedEntityGenerationCandidates(entityJob({
      status: 'completed',
    }), 'entity-2')).toBeNull();
  });
});
