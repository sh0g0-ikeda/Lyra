import { afterEach, describe, expect, it, vi } from 'vitest';

import { LyraMobileApiClient } from '@/lib/api';

const purchaseResponse = {
  store: 'google',
  state: 'active',
  product_kind: 'credit_pack',
  plan_code: null,
  credit_package_code: 'credits_200',
  credits_changed: 200,
  is_duplicate: false
} as const;

describe('mobile store billing API contract', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('購入用アカウントbindingをruntime検証する', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        apple_app_account_token: '11111111-1111-4111-8111-111111111111',
        google_obfuscated_account_id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        subscription_purchase_allowed: true
      }), { status: 200 })
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new LyraMobileApiClient(() => 'token');

    await expect(client.getMobilePurchaseBinding()).resolves.toMatchObject({
      subscription_purchase_allowed: true
    });
    expect(fetchMock.mock.calls[0]?.[0]).toContain('/api/mobile-purchases/binding');
  });

  it('現在platformの商品カタログをruntime検証する', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        store: 'apple',
        products: [
          {
            product_id: 'jp.lyra.standard.monthly',
            kind: 'subscription',
            plan_code: 'standard',
            credit_package_code: null
          }
        ]
      }), { status: 200 })
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new LyraMobileApiClient(() => 'token');

    await expect(client.getMobileStoreProductCatalog('apple')).resolves.toMatchObject({
      store: 'apple',
      products: [{ product_id: 'jp.lyra.standard.monthly' }]
    });
    expect(fetchMock.mock.calls[0]?.[0]).toContain('/api/mobile-purchases/catalog/apple');
  });

  it('要求したplatformと異なるstoreの商品カタログは拒否する', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({
          store: 'google',
          products: []
        }), { status: 200 })
      )
    );
    const client = new LyraMobileApiClient(() => 'token');

    await expect(client.getMobileStoreProductCatalog('apple')).rejects.toMatchObject({
      code: 'INVALID_API_RESPONSE',
      status: 502
    });
  });

  it('Apple購入証跡だけを検証APIへ送る', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ...purchaseResponse, store: 'apple' }), { status: 200 })
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new LyraMobileApiClient(() => 'token');

    await expect(client.verifyAppleMobilePurchase({
      environment: 'sandbox',
      signed_transaction: 'signed-transaction'
    })).resolves.toMatchObject({ store: 'apple', state: 'active' });
    expect(fetchMock.mock.calls[0]?.[0]).toContain('/api/mobile-purchases/apple/verify');
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      environment: 'sandbox',
      signed_transaction: 'signed-transaction'
    });
  });

  it('Google購入証跡だけを検証APIへ送る', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(purchaseResponse), { status: 200 })
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new LyraMobileApiClient(() => 'token');

    await client.verifyGoogleMobilePurchase({ purchase_token: 'google-purchase-token' });

    expect(fetchMock.mock.calls[0]?.[0]).toContain('/api/mobile-purchases/google/verify');
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      purchase_token: 'google-purchase-token'
    });
  });

  it('復元証跡をbounded配列契約で送り応答をruntime検証する', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ purchases: [purchaseResponse] }), { status: 200 })
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new LyraMobileApiClient(() => 'token');

    await expect(client.restoreMobilePurchases({
      apple_signed_transactions: [],
      google_purchase_tokens: ['google-purchase-token']
    })).resolves.toEqual({ purchases: [purchaseResponse] });
    expect(fetchMock.mock.calls[0]?.[0]).toContain('/api/mobile-purchases/restore');
  });

  it('壊れた購入応答は安全な契約エラーとして拒否する', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ...purchaseResponse, credits_changed: '200' }), { status: 200 })
      )
    );
    const client = new LyraMobileApiClient(() => 'token');

    await expect(
      client.verifyGoogleMobilePurchase({ purchase_token: 'google-purchase-token' })
    ).rejects.toMatchObject({
      code: 'INVALID_API_RESPONSE',
      status: 502
    });
  });
});
