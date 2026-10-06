import { beforeEach, describe, expect, it, vi } from 'vitest';
import { confirmStaleDraftReload, type StaleDraftScope } from '@/lib/confirmStaleDraftReload';

const confirm = vi.hoisted(() => vi.fn());
vi.mock('@/lib/confirm', () => ({ confirmAction: confirm }));

beforeEach(() => confirm.mockClear());
describe('confirmStaleDraftReload', () => {
  it.each([
    ['en', 'story', 'Episode title', 'starting character states'],
    ['ja', 'story', '話のタイトル', '開始状態'],
    ['en', 'character', 'structured settings', 'import result/candidate'],
    ['ja', 'character', '構造化設定', '取り込み結果'],
    ['en', 'page', 'dialogue', 'page frame edits'],
    ['ja', 'page', 'セリフ', 'コマ枠']
  ] as const)('%sの%s再読込で置き換える項目を明記して確認前には実行しない', (language, scope: StaleDraftScope, first, second) => {
    const onConfirm = vi.fn();
    confirmStaleDraftReload({ language, scope, onConfirm });
    expect(onConfirm).not.toHaveBeenCalled();
    const request = confirm.mock.calls[0]?.[0];
    expect(request.destructive).toBe(true);
    expect(request.message).toContain(first);
    expect(request.message).toContain(second);
    request.onConfirm();
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});
