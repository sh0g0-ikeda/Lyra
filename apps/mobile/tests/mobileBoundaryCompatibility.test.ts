import { afterEach, describe, expect, it, vi } from 'vitest';
import { LyraMobileApiClient } from '@/lib/api';
const timestamp = '2026-10-01T00:00:00Z';
const id = '11111111-1111-4111-8111-111111111111';
afterEach(() => vi.unstubAllGlobals());
describe('Mobile account, push and job boundaries', () => {
  it('uses the production push-token routes with the exact existing installation payload', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ status: 'registered', installation_id: id, platform: 'android' }))).mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetch); const api = new LyraMobileApiClient(() => 'test-native-session');
    const body = { installation_id: id, platform: 'android' as const, device_token: 'fake-native-token-for-contract-test', locale: 'ja' as const };
    await api.registerPushToken(body); await api.removePushToken(id);
    expect(fetch.mock.calls[0][0]).toContain('/api/push-tokens'); expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual(body);
    expect(fetch.mock.calls[1][0]).toContain(`/api/push-tokens/${id}`); expect(fetch.mock.calls[1][1].method).toBe('DELETE');
  });
  it('preserves pending refunds, safe errors, progress and disabled actions in filtered job lists', async () => {
    const job = { id, job_type: 'entity_import_analysis', status: 'canceled', generation_mode: null, credit_cost: 4,
      credit_settlement: { charged_credits: 4, refunded_credits: 0, net_credits: 4, status: 'refund_pending' },
      params: { entity_id: id, entity_type: 'character' }, result: null, error_message: 'Cancellation requested.', error_code: 'JOB_CANCELLED', message_key: 'job.error.cancelled', retryable: false, support_id: 'J-123',
      progress_stage: 'canceled', progress_percent: null, progress_updated_at: timestamp, updated_at: timestamp,
      actions: { cancel: { available: false, reason_key: null }, hide: { available: false, reason_key: null } },
      retry_count: 0, created_at: timestamp, started_at: timestamp, completed_at: timestamp, expires_at: null };
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ jobs: [job], next_cursor: 'opaque-production-cursor' })));
    vi.stubGlobal('fetch', fetch); const api = new LyraMobileApiClient(() => 'test-native-session');
    await expect(api.listJobs({ statuses: ['canceled'], jobTypes: ['entity_import_analysis'], cursor: 'opaque-production-cursor', limit: 25 })).resolves.toMatchObject({ jobs: [job], next_cursor: 'opaque-production-cursor' });
    fetch.mockResolvedValueOnce(new Response(JSON.stringify({ jobs: [{ ...job, credit_settlement: undefined }], next_cursor: null })));
    await expect(api.listJobs()).resolves.toMatchObject({ jobs: [{ credit_settlement: null, status: 'canceled' }] });
    const url = new URL(fetch.mock.calls[0][0], 'https://api.example.test'); expect(url.searchParams.get('status')).toBe('canceled'); expect(url.searchParams.get('type')).toBe('entity_import_analysis'); expect(url.searchParams.get('cursor')).toBe('opaque-production-cursor');
  });
  it('does not collapse three current deletion acknowledgements into the production alias', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: 'blocked', blockers: [{ code: 'ACTIVE_PERSONAL_JOB', job_count: 1 }] }), { status: 409 }));
    vi.stubGlobal('fetch', fetch); const api = new LyraMobileApiClient(() => 'test-native-session');
    const body = { confirmation: 'DELETE' as const, acknowledge_personal_subscriptions: true, acknowledge_store_billing: false, acknowledge_personal_assets: true };
    await expect(api.requestAccountDeletion(body)).resolves.toMatchObject({ status: 'blocked' });
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual(body);
    expect(fetch.mock.calls[0][0]).not.toContain('organization_id');
  });
});
