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

const purchaseResult = {
  credit_package_code: 'credits_200' as const,
  credits_changed: 200,
  is_duplicate: false,
  plan_code: null,
  product_kind: 'credit_pack' as const,
  state: 'active' as const,
  store: 'apple' as const,
};

describe('Mobile store billing API', () => {
  it('catalogとbindingを個人scopeで取得しorganization IDを送らない', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({
        products: [{
          credit_package_code: 'credits_200',
          kind: 'credit_pack',
          plan_code: null,
          product_id: 'lyra.credits.200',
        }],
        store: 'apple',
      }))
      .mockResolvedValueOnce(jsonResponse({
        apple_app_account_token: '3d813cbb-47fb-4d4a-8c9a-00f018076a2a',
        google_obfuscated_account_id: 'a'.repeat(43),
        subscription_purchase_allowed: true,
      }));
    const api = new LyraMobileApiClient({
      apiBaseUrl: 'https://api.example.com',
      auth,
      fetcher,
    });

    await expect(api.getMobileStoreProductCatalog('apple')).resolves.toMatchObject({
      store: 'apple',
    });
    await expect(api.getMobilePurchaseBinding()).resolves.toMatchObject({
      subscription_purchase_allowed: true,
    });

    expect(fetcher.mock.calls[0]?.[0]).toBe(
      'https://api.example.com/api/mobile-purchases/catalog/apple',
    );
    expect(fetcher.mock.calls[1]?.[0]).toBe(
      'https://api.example.com/api/mobile-purchases/binding',
    );
    expect(String(fetcher.mock.calls[0]?.[0])).not.toContain('organization_id');
  });

  it('要求したstoreと異なるcatalog応答を不正responseとして拒否する', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      products: [],
      store: 'google',
    }));
    const api = new LyraMobileApiClient({
      apiBaseUrl: 'https://api.example.com',
      auth,
      fetcher,
    });

    await expect(api.getMobileStoreProductCatalog('apple')).rejects.toMatchObject({
      code: 'INVALID_API_RESPONSE',
      status: 502,
    } satisfies Partial<ApiError>);
  });

  it('AppleとGoogleのproofを対応endpointへだけ送りresponse schemaで検証する', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(purchaseResult))
      .mockResolvedValueOnce(jsonResponse({ ...purchaseResult, store: 'google' }));
    const api = new LyraMobileApiClient({
      apiBaseUrl: 'https://api.example.com',
      auth,
      fetcher,
    });

    await api.verifyAppleMobilePurchase({
      environment: 'sandbox',
      signed_transaction: 'signed-transaction',
    });
    await api.verifyGoogleMobilePurchase({ purchase_token: 'purchase-token' });

    expect(fetcher.mock.calls[0]?.[0]).toBe(
      'https://api.example.com/api/mobile-purchases/apple/verify',
    );
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      body: JSON.stringify({
        environment: 'sandbox',
        signed_transaction: 'signed-transaction',
      }),
      method: 'POST',
    });
    expect(fetcher.mock.calls[1]?.[0]).toBe(
      'https://api.example.com/api/mobile-purchases/google/verify',
    );
    expect(fetcher.mock.calls[1]?.[1]).toMatchObject({
      body: JSON.stringify({ purchase_token: 'purchase-token' }),
      method: 'POST',
    });
  });

  it('restore proofをboundedな配列で送り不正responseを画面へ渡さない', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ purchases: [purchaseResult] }))
      .mockResolvedValueOnce(jsonResponse({ purchases: [{ secret: 'raw-proof' }] }));
    const api = new LyraMobileApiClient({
      apiBaseUrl: 'https://api.example.com',
      auth,
      fetcher,
    });

    await expect(api.restoreMobilePurchases({
      apple_signed_transactions: ['apple-proof'],
      google_purchase_tokens: ['google-proof'],
    })).resolves.toMatchObject({ purchases: [purchaseResult] });
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      'https://api.example.com/api/mobile-purchases/restore',
    );
    await expect(api.restoreMobilePurchases({
      apple_signed_transactions: ['another-proof'],
      google_purchase_tokens: [],
    })).rejects.toMatchObject({
      code: 'INVALID_API_RESPONSE',
      status: 502,
    } satisfies Partial<ApiError>);
  });
});
