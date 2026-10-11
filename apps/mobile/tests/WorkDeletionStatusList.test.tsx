import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { WorkDeletionStatusList } from '@/components/WorkDeletionStatusList';
import type { WorkDeletionRecord } from '@/domain/workDeletion';
import { ApiError } from '@/lib/api';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-native', () => ({
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'text',
  View: 'view'
}));
vi.mock('@/components/Notice', () => ({ Notice: ({ message, ...props }: { message: string }) => React.createElement('notice', props, message) }));
vi.mock('@/components/PrimaryButton', () => ({ PrimaryButton: (props: Record<string, unknown>) => React.createElement('button', props) }));

const pending: WorkDeletionRecord = {
  deletion_id: '11111111-1111-4111-8111-111111111111',
  work_id: '22222222-2222-4222-8222-222222222222',
  status: 'pending',
  blocker_code: null
};

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
};

describe('WorkDeletionStatusList', () => {
  let renderer: ReactTestRenderer | undefined;
  afterEach(async () => { await act(async () => renderer?.unmount()); renderer = undefined; });

  const renderList = async (api: {
    getWorkDeletions: ReturnType<typeof vi.fn>;
    getWorkDeletion: ReturnType<typeof vi.fn>;
  }): Promise<ReactTestRenderer> => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => {
      renderer = create(
        <QueryClientProvider client={client}>
          <WorkDeletionStatusList api={api as never} language="ja" organizationId={null} sessionKey="session" />
        </QueryClientProvider>
      );
    });
    for (let index = 0; index < 4; index += 1) await act(flush);
    return renderer;
  };

  it('202受付と処理中を完全削除として表示しない', async () => {
    const api = {
      getWorkDeletions: vi.fn().mockResolvedValue({ deletions: [pending] }),
      getWorkDeletion: vi.fn().mockResolvedValue({ ...pending, status: 'processing' })
    };
    const tree = await renderList(api);
    const text = tree.root.findAllByType('text').map((node) => node.props.children).join(' ');

    expect(api.getWorkDeletions).toHaveBeenCalledWith(null);
    expect(api.getWorkDeletion).toHaveBeenCalledWith(pending.deletion_id, null);
    expect(text).toContain('削除処理中');
    expect(text).not.toContain('紐づくデータ・画像を削除しました');
  });

  it('statusがcompletedの場合だけ紐づくデータと画像の削除完了を表示する', async () => {
    const api = {
      getWorkDeletions: vi.fn().mockResolvedValue({ deletions: [{ ...pending, status: 'completed' }] }),
      getWorkDeletion: vi.fn()
    };
    const tree = await renderList(api);
    const text = tree.root.findAllByType('text').map((node) => node.props.children).join(' ');

    expect(text).toContain('作品と紐づくデータ・画像を削除しました');
    expect(api.getWorkDeletion).not.toHaveBeenCalled();
  });

  it('pending_external_actionはblocker理由を表示して個別status確認を続ける', async () => {
    const blocked = { ...pending, status: 'pending_external_action' as const, blocker_code: 'FINAL_REVALIDATION_BLOCKED' };
    const api = {
      getWorkDeletions: vi.fn().mockResolvedValue({ deletions: [blocked] }),
      getWorkDeletion: vi.fn().mockResolvedValue(blocked)
    };
    const tree = await renderList(api);
    const text = tree.root.findAllByType('text').map((node) => node.props.children).join(' ');

    expect(text).toContain('生成・書き出し');
    expect(text).not.toContain('紐づくデータ・画像を削除しました');
    expect(api.getWorkDeletion).toHaveBeenCalledWith(blocked.deletion_id, null);
  });

  it('inventory確認失敗は画像または保存ファイルの安全確認待ちと表示する', async () => {
    const blocked = { ...pending, status: 'pending_external_action' as const, blocker_code: 'ASSET_INVENTORY_FAILED' };
    const api = {
      getWorkDeletions: vi.fn().mockResolvedValue({ deletions: [blocked] }),
      getWorkDeletion: vi.fn().mockResolvedValue(blocked)
    };
    const tree = await renderList(api);
    const text = tree.root.findAllByType('text').map((node) => node.props.children).join(' ');

    expect(text).toContain('画像または保存ファイルを安全に削除できなかった');
    expect(text).not.toContain('紐づくデータ・画像を削除しました');
  });

  it('個別status取得がnot foundでも完了と推測せず未解決のreceiptを残す', async () => {
    const api = {
      getWorkDeletions: vi.fn().mockResolvedValue({ deletions: [pending] }),
      getWorkDeletion: vi.fn().mockRejectedValue(new ApiError('not found', 404, 'NOT_FOUND'))
    };
    const tree = await renderList(api);
    const text = tree.root.findAllByType('text').map((node) => node.props.children).join(' ');
    const notices = tree.root.findAllByType('notice').map((node) => node.props.children).join(' ');

    expect(text).toContain('受付済み');
    expect(notices).toContain('状態を確認できません');
    expect(text).not.toContain('紐づくデータ・画像を削除しました');
  });
});
