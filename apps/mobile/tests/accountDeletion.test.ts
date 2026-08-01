import { afterEach, describe, expect, it, vi } from 'vitest';

import { LyraMobileApiClient } from '@/lib/api';

describe('account deletion API contract', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('個人アカウント削除のプレビューを組織 ID なしで取得する', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          personal_data: {
            account: 'anonymized',
            personal_works: 'deleted',
            organization_memberships: 'removed',
            billing_records: 'retained_for_legal_and_security'
          },
          unique_owner_organizations: [{ id: 'organization-1', name: 'Lyra Studio' }],
          active_personal_stripe_subscription_count: 1,
          active_store_subscriptions: [{
            store: 'apple',
            expires_at: null,
            auto_renew_enabled: true,
            manage_url: 'https://apps.apple.com/account/subscriptions'
          }],
          personal_asset_count: 2,
          active_personal_job_count: 0
        }),
        { headers: { 'Content-Type': 'application/json' }, status: 200 }
      )
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new LyraMobileApiClient(() => 'token');

    await expect(client.getAccountDeletionPreview()).resolves.toMatchObject({
      unique_owner_organizations: [{ name: 'Lyra Studio' }],
      active_personal_stripe_subscription_count: 1,
      active_store_subscriptions: [{ store: 'apple' }],
      personal_asset_count: 2,
      active_personal_job_count: 0
    });

    expect(fetchMock.mock.calls[0]?.[0]).toMatch(/\/api\/account\/deletion$/);
    expect(fetchMock.mock.calls[0]?.[0]).not.toContain('organization_id');
  });

  it('削除が blocked の場合も安全な業務結果として返し、組織 ID を送らない', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: 'blocked',
          blockers: [
            {
              code: 'UNIQUE_ORGANIZATION_OWNER',
              organizations: [{ id: 'organization-1', name: 'Lyra Studio' }]
            }
          ]
        }),
        { headers: { 'Content-Type': 'application/json' }, status: 409 }
      )
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new LyraMobileApiClient(() => 'token');

    await expect(
      client.requestAccountDeletion({
        confirmation: 'DELETE',
        acknowledge_personal_subscriptions: false,
        acknowledge_store_billing: false,
        acknowledge_personal_assets: false
      })
    ).resolves.toMatchObject({
      status: 'blocked',
      blockers: [{ code: 'UNIQUE_ORGANIZATION_OWNER' }]
    });

    expect(fetchMock.mock.calls[0]?.[0]).toMatch(/\/api\/account\/deletion$/);
    expect(fetchMock.mock.calls[0]?.[0]).not.toContain('organization_id');
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify({
        confirmation: 'DELETE',
        acknowledge_personal_subscriptions: false,
        acknowledge_store_billing: false,
        acknowledge_personal_assets: false
      })
    });
  });

  it('削除プレビューの契約が壊れている場合は画面へ渡さない', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ unique_owner_organizations: [] }), {
          headers: { 'Content-Type': 'application/json' },
          status: 200
        })
      )
    );
    const client = new LyraMobileApiClient(() => 'token');

    await expect(client.getAccountDeletionPreview()).rejects.toMatchObject({
      code: 'INVALID_API_RESPONSE',
      status: 502
    });
  });

  it.each([
    [{ status: 'in_progress', blockers: [] }],
    [{ status: 'pending_external_action', blockers: [], next_action: 'delete_identity' }],
    [{ status: 'completed', blockers: [] }]
  ])('削除処理の %o 状態を画面で扱える契約として返す', async (responseBody) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(responseBody), {
          headers: { 'Content-Type': 'application/json' },
          status: responseBody.status === 'completed' ? 200 : 202
        })
      )
    );
    const client = new LyraMobileApiClient(() => 'token');

    await expect(
      client.requestAccountDeletion({
        confirmation: 'DELETE',
        acknowledge_personal_subscriptions: false,
        acknowledge_store_billing: false,
        acknowledge_personal_assets: false
      })
    ).resolves.toMatchObject(responseBody);
  });
});
