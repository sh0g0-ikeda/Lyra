import { afterEach, describe, expect, it, vi } from 'vitest';
import { LyraMobileApiClient } from '@/lib/api';
const receipt = { deletion_id: '11111111-1111-4111-8111-111111111111', work_id: '22222222-2222-4222-8222-222222222222', status: 'pending', blocker_code: null } as const;
describe('作品の永久削除API', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('削除受付の場合に組織scopeを指定してpending receiptを受け取る', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(receipt), { status: 202 }));
    vi.stubGlobal('fetch', fetch);
    const api = new LyraMobileApiClient(() => 'token');
    await expect(api.deleteWork(receipt.work_id, '33333333-3333-4333-8333-333333333333')).resolves.toEqual(receipt);
    expect(fetch.mock.calls[0]?.[0]).toContain('/api/works/' + receipt.work_id + '?organization_id=33333333-3333-4333-8333-333333333333');
    expect(fetch.mock.calls[0]?.[1]?.method).toBe('DELETE');
  });
  it('通信結果が不明の場合にDELETEを自動再試行しない', async () => {
    const fetch = vi.fn().mockRejectedValue(new TypeError('network'));
    vi.stubGlobal('fetch', fetch);
    const api = new LyraMobileApiClient(() => 'token');
    await expect(api.deleteWork(receipt.work_id)).rejects.toBeDefined();
    expect(fetch).toHaveBeenCalledOnce();
  });
  it('削除一覧と状態を読む場合にGETだけを実行する', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ deletions: [receipt] }))).mockResolvedValueOnce(new Response(JSON.stringify({ ...receipt, status: 'completed' })));
    vi.stubGlobal('fetch', fetch);
    const api = new LyraMobileApiClient(() => 'token');
    await expect(api.getWorkDeletions(null)).resolves.toEqual({ deletions: [receipt] });
    await expect(api.getWorkDeletion(receipt.deletion_id, null)).resolves.toMatchObject({ status: 'completed' });
    expect(fetch.mock.calls.every(call => !call[1]?.method || call[1].method === 'GET')).toBe(true);
  });
  it('削除結果に未知の状態がある場合に完了と見なさず拒否する', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...receipt, status: 'gone' }))));
    const api = new LyraMobileApiClient(() => 'token');
    await expect(api.getWorkDeletion(receipt.deletion_id)).rejects.toMatchObject({ code: 'INVALID_API_RESPONSE' });
  });
});
