import { describe, expect, it } from 'vitest';

import { pageDesignNextAction, type PageDesignIntent } from '../../../apps/web/src/lib/pageDesignWorkflow.js';

// Unified Spec §6 and the mobile page-design workflow require a single user
// intent to wait for skeleton completion before it can enqueue story autofill.
// This classifier has no side effects; App owns the intent claim and singleflight.
describe('page design workflow transition', () => {
  const intent: PageDesignIntent = {
    scope: 'org:episode-1',
    episodeId: 'episode-1',
    skeletonJobId: 'skeleton-job',
  };

  it('skeleton job の状態とscopeから次の安全な操作だけを判定する', () => {
    expect(pageDesignNextAction(intent, 'org:episode-1', undefined, false)).toBe('wait');
    expect(pageDesignNextAction(intent, 'org:episode-1', { id: 'other-job', status: 'completed' }, false)).toBe('wait');
    expect(pageDesignNextAction(intent, 'org:episode-1', { id: 'skeleton-job', status: 'queued' }, false)).toBe('wait');
    expect(pageDesignNextAction(intent, 'org:episode-1', { id: 'skeleton-job', status: 'processing' }, false)).toBe('wait');
    expect(pageDesignNextAction(intent, 'org:episode-1', { id: 'skeleton-job', status: 'completed' }, false)).toBe('autofill');
    expect(pageDesignNextAction(intent, 'org:episode-1', { id: 'skeleton-job', status: 'failed' }, false)).toBe('stop');
    expect(pageDesignNextAction(intent, 'org:episode-1', { id: 'skeleton-job', status: 'cancelled' }, false)).toBe('stop');
    expect(pageDesignNextAction(intent, 'org:episode-1', { id: 'skeleton-job', status: 'completed' }, true)).toBe('stop');
    expect(pageDesignNextAction(intent, 'different:episode', { id: 'skeleton-job', status: 'completed' }, false)).toBe('stop');
  });
});
