import { afterEach, describe, expect, it, vi } from 'vitest';
import { LyraMobileApiClient } from '@/lib/api';

const response = { panel_ids: ['a', 'c', 'b'], created_panel_id: 'c', layout_template_id: 'top_wide_3', frames: [], balloon_reference_updated_count: 1, balloon_reference_cleared_count: 0 };
const payload = { expected_panel_ids: ['a', 'b'], operation: { type: 'insert_after' as const, panel_id: 'a' } };
describe('panel insertion API', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('空コマの挿入を法人scope付きの原子的なPUT一回で実行する', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(response), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new LyraMobileApiClient(() => 'token');
    await expect(client.insertPanelAfter('page-1', payload, 'org-1')).resolves.toEqual(response);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain('/api/pages/page-1/panel-structure?organization_id=org-1');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body)).toEqual(payload);
  });
  it('不正応答を受け取った場合に成功扱いせず旧appendへfallbackしない', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...response, panel_ids: null }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new LyraMobileApiClient(() => 'token');
    await expect(client.insertPanelAfter('page-1', payload)).rejects.toMatchObject({ code: 'INVALID_API_RESPONSE' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
