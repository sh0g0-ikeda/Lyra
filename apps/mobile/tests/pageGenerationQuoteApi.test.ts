import { afterEach, describe, expect, it, vi } from 'vitest';
import { LyraMobileApiClient } from '@/lib/api';
const id = (index: number): string => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
const quote = { quote_id: id(1), quote_token: 'opaque', operation: 'page_generate', target_id: id(2), billing_scope: { kind: 'organization', organization_id: id(3) }, image_model: 'gpt-image-2', quality: 'medium', render_style: 'monochrome', reference_count: 2, amount_credits: 7, pricing_version: 'v1', input_revision: 'a'.repeat(64), expires_at: '2099-01-01T00:00:00Z', blockers: [] };
const receipt = { quote_id: id(1), job_id: id(4), status: 'queued', amount_credits: 7, charged_credits: 7, refunded_credits: 0, accepted_at: '2026-10-01T00:00:00Z', expires_at: quote.expires_at };
describe('ページ生成見積API', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('2.5対応サーバーの場合だけ新しいモデルを見積もりで明示する', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ image_model: 'gpt-image-2.5-sunburst' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...quote, image_model: 'gpt-image-2.5-sunburst' })));
    vi.stubGlobal('fetch', fetch);
    const api = new LyraMobileApiClient(() => 'token');
    await expect(api.createPreferredGenerationQuote({ operation: 'page_generate', target_id: id(2) }, id(3)))
      .resolves.toMatchObject({ image_model: 'gpt-image-2.5-sunburst' });
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toMatchObject({ image_model: 'gpt-image-2.5-sunburst' });
  });
  it('機能問い合わせが未実装の場合に旧見積もりを利用する', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(quote)));
    vi.stubGlobal('fetch', fetch);
    const api = new LyraMobileApiClient(() => 'token');
    await expect(api.createPreferredGenerationQuote({ operation: 'page_generate', target_id: id(2) })).resolves.toEqual(quote);
    expect(JSON.parse(fetch.mock.calls[1][1].body)).not.toHaveProperty('image_model');
  });
  it('保存済み入力の見積・明示受付・照合を同じ法人scopeで行う', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(quote))).mockResolvedValueOnce(new Response(JSON.stringify(receipt))).mockResolvedValueOnce(new Response(JSON.stringify(receipt)));
    vi.stubGlobal('fetch', fetch); const api = new LyraMobileApiClient(() => 'token');
    await expect(api.createPageGenerationQuote({ operation: 'page_generate', target_id: id(2), render_style: 'monochrome' }, id(3))).resolves.toEqual(quote);
    await api.acceptGenerationQuote(id(1), { quote_token: 'opaque', request_key: id(5) }, id(3));
    await api.getGenerationQuote(id(1), id(3));
    expect(fetch.mock.calls[0][0]).toContain(`/generation-quotes?organization_id=${id(3)}`);
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ operation: 'page_generate', target_id: id(2), render_style: 'monochrome' });
    expect(fetch.mock.calls[1][0]).toContain(`/generation-quotes/${id(1)}/accept?organization_id=${id(3)}`);
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ quote_token: 'opaque', request_key: id(5) });
    expect(fetch.mock.calls[2][0]).toContain(`/generation-quotes/${id(1)}?organization_id=${id(3)}`);
  });
  it('asset candidate tokens and import uploads use the generic quote route, preserving legacy methods only for compatibility', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ ...quote, operation: 'entity_preview' }))).mockResolvedValueOnce(new Response(JSON.stringify({ ...quote, operation: 'entity_import_analysis', image_model: null, quality: null, render_style: null })));
    vi.stubGlobal('fetch', fetch); const api = new LyraMobileApiClient(() => 'token');
    await api.createGenerationQuote({ operation: 'entity_preview', target_id: id(2), source_candidate_token: 'owned-candidate' }, id(3));
    await api.createGenerationQuote({ operation: 'entity_import_analysis', upload_token: 'uploaded', entity_type: 'character', entity_id: id(2) }, id(3));
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({ source_candidate_token: 'owned-candidate' });
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toMatchObject({ upload_token: 'uploaded' });
    expect(fetch.mock.calls.every(([url]) => String(url).includes('/generation-quotes'))).toBe(true);
  });
  it('不正な見積応答を拒否し旧有料APIへfallbackしない', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...quote, amount_credits: -1 })));
    vi.stubGlobal('fetch', fetch); const api = new LyraMobileApiClient(() => 'token');
    await expect(api.createPageGenerationQuote({ operation: 'page_generate', target_id: id(2), render_style: 'color' })).rejects.toMatchObject({ code: 'INVALID_API_RESPONSE' });
    expect(fetch).toHaveBeenCalledOnce();
  });
});
