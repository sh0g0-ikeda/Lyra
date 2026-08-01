import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { BillingHandoffNotice } from '@/components/BillingHandoffNotice';

vi.mock('react-native', () => ({
  ActivityIndicator: 'activity-indicator',
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'text',
  View: 'view'
}));

vi.mock('@/components/Notice', () => ({
  Notice: ({ message, tone }: { message: string; tone: string }) =>
    React.createElement('notice', { tone }, message)
}));

describe('BillingHandoffNotice', () => {
  it('ブラウザから戻るまでは完了とせず復帰待ちを表示する', () => {
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        <BillingHandoffNotice intent={{ kind: 'credits' }} language="ja" phase="waiting_for_return" />
      );
    });
    const rendered = JSON.stringify(renderer!.toJSON());
    expect(rendered).toContain('請求画面から戻ると決済情報を確認します');
    expect(rendered).not.toContain('購入完了');
  });

  it('確認中・authoritative完了・未確認を明確に区別する', () => {
    const render = (
      phase: 'confirming' | 'confirmed' | 'unconfirmed'
    ): string => {
      let renderer: ReturnType<typeof create>;
      act(() => {
        renderer = create(
          <BillingHandoffNotice intent={{ kind: 'credits' }} language="ja" phase={phase} />
        );
      });
      return JSON.stringify(renderer!.toJSON());
    };

    expect(render('confirming')).toContain('決済情報を確認中');
    expect(render('confirmed')).toContain('購入完了');
    expect(render('unconfirmed')).toContain('購入を確認できませんでした');
    expect(render('unconfirmed')).not.toContain('購入完了');
  });
});
