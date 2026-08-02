import React from 'react';
import { act, create } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AiContentReportButton } from '@/components/AiContentReportButton';

const mocks = vi.hoisted(() => ({
  confirmAction: vi.fn(),
  submit: vi.fn().mockResolvedValue({
    report_id: '11111111-1111-4111-8111-111111111111',
    status: 'received'
  }),
}));

vi.mock('@/lib/confirm', () => ({ confirmAction: mocks.confirmAction }));
vi.mock('@/state/appState', () => ({
  useAppState: () => ({ api: { submitAiContentReport: mocks.submit } })
}));
vi.mock('@/components/PrimaryButton', () => ({
  PrimaryButton: ({ label, onPress }: { label: string; onPress: () => void }) =>
    React.createElement('button', { onClick: onPress }, label),
}));
vi.mock('@/components/Notice', () => ({
  Notice: ({ message }: { message: string }) => React.createElement('notice', null, message),
}));

describe('AiContentReportButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.submit.mockResolvedValue({
      report_id: '11111111-1111-4111-8111-111111111111',
      status: 'received'
    });
  });

  it('確認後に認証済みAPIへ固定された通報情報だけを送る', async () => {
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(<AiContentReportButton contentId="page-1" contentKind="generated_image" language="ja" />);
    });
    act(() => renderer!.root.findByType('button').props.onClick());
    const confirmation = mocks.confirmAction.mock.calls[0]?.[0] as { onConfirm: () => void };
    expect(confirmation).toBeDefined();
    await act(async () => {
      confirmation.onConfirm();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mocks.submit).toHaveBeenCalledWith('generated_image', 'page-1');
    expect(JSON.stringify(mocks.submit.mock.calls)).not.toContain('prompt');
    expect(JSON.stringify(mocks.submit.mock.calls)).not.toContain('image_url');
    expect(JSON.stringify(mocks.submit.mock.calls)).not.toContain('email');
    expect(JSON.stringify(renderer!.toJSON())).toContain('通報を送信しました。');
  });

  it('送信できない場合は成功扱いにせず再試行可能な表示にする', async () => {
    mocks.submit.mockRejectedValueOnce(new Error('unavailable'));
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(<AiContentReportButton contentKind="story_proposal" language="ja" />);
    });
    act(() => renderer!.root.findByType('button').props.onClick());
    const confirmation = mocks.confirmAction.mock.calls[0]?.[0] as { onConfirm: () => void };
    await act(async () => {
      confirmation.onConfirm();
      await Promise.resolve();
      await Promise.resolve();
    });
    const rendered = JSON.stringify(renderer!.toJSON());
    expect(rendered).toContain('通報を送信できませんでした。');
    expect(rendered).not.toContain('通報を送信しました。');
  });
});
