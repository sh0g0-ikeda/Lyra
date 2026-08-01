import { describe, expect, it, vi } from 'vitest';
import type { AuthTokens } from '../src/domain/auth';
import {
  ApiError,
  LyraMobileApiClient,
  type MobileAuthSessionPort,
} from '../src/lib/api';

const tokens: AuthTokens = {
  accessToken: null,
  expiresAt: Date.now() + 60_000,
  idToken: 'id-token',
  refreshToken: null,
  tokenType: 'Bearer',
};

const auth: MobileAuthSessionPort = {
  getTokens: async () => tokens,
  refreshTokens: async () => tokens,
};

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    status,
  });

const preview = {
  active_personal_job_count: 0,
  active_personal_stripe_subscription_count: 0,
  active_store_subscriptions: [],
  personal_asset_count: 2,
  personal_data: {
    account: 'anonymized' as const,
    billing_records: 'retained_for_legal_and_security' as const,
    organization_memberships: 'removed' as const,
    personal_works: 'deleted' as const,
  },
  unique_owner_organizations: [],
};

describe('Account deletion API', () => {
  it('previewを個人scopeで取得し識別子をqueryへ送らない', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(preview));
    const api = new LyraMobileApiClient({
      apiBaseUrl: 'https://api.example.com',
      auth,
      fetcher,
    });

    await expect(api.getAccountDeletionPreview()).resolves.toEqual(preview);
    expect(fetcher).toHaveBeenCalledWith(
      'https://api.example.com/api/account/deletion',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(String(fetcher.mock.calls[0]?.[0])).not.toContain('?');
  });

  it('確認とacknowledgementだけを送り409 blockerを通常結果として検証する', async () => {
    const blocked = {
      blockers: [{ code: 'PERSONAL_ASSETS', asset_count: 2 }],
      status: 'blocked',
    };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(blocked, 409));
    const api = new LyraMobileApiClient({
      apiBaseUrl: 'https://api.example.com',
      auth,
      fetcher,
    });

    await expect(api.requestAccountDeletion({
      acknowledge_personal_assets: false,
      acknowledge_personal_subscriptions: false,
      acknowledge_store_billing: false,
      confirmation: 'DELETE',
    })).resolves.toEqual(blocked);
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ method: 'POST' });
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({
      acknowledge_personal_assets: false,
      acknowledge_personal_subscriptions: false,
      acknowledge_store_billing: false,
      confirmation: 'DELETE',
    });
  });

  it('HTTP statusと削除statusが矛盾する応答を拒否する', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      blockers: [],
      status: 'completed',
    }, 202));
    const api = new LyraMobileApiClient({
      apiBaseUrl: 'https://api.example.com',
      auth,
      fetcher,
    });

    await expect(api.requestAccountDeletion({
      acknowledge_personal_assets: true,
      acknowledge_personal_subscriptions: true,
      acknowledge_store_billing: true,
      confirmation: 'DELETE',
    })).rejects.toMatchObject({
      code: 'INVALID_API_RESPONSE',
      status: 502,
    } satisfies Partial<ApiError>);
  });

  it('DELETE以外の確認値はnetwork送信前に拒否する', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const api = new LyraMobileApiClient({
      apiBaseUrl: 'https://api.example.com',
      auth,
      fetcher,
    });

    await expect(api.requestAccountDeletion({
      acknowledge_personal_assets: true,
      acknowledge_personal_subscriptions: true,
      acknowledge_store_billing: true,
      confirmation: 'delete',
    } as unknown as Parameters<typeof api.requestAccountDeletion>[0])).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
      status: 422,
    } satisfies Partial<ApiError>);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
