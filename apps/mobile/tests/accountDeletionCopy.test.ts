import { describe, expect, it } from 'vitest';

import {
  deletionResultMessage,
  subscriptionDeletionAcknowledgement
} from '@/domain/accountDeletionCopy';

const completedResult = {
  blockers: [],
  request_id: '11111111-1111-4111-8111-111111111111',
  status: 'completed' as const
};

describe('account deletion completion copy', () => {
  it('完了時は実際の自動ログアウト動作を日本語で案内する', () => {
    expect(deletionResultMessage(completedResult, 'ja')).toBe(
      '削除手続きが完了しました。安全のためログアウトします。'
    );
  });

  it('完了時は実際の自動ログアウト動作を英語で案内する', () => {
    expect(deletionResultMessage(completedResult, 'en')).toBe(
      'Deletion has completed. You will be logged out for security.'
    );
  });

  it('モバイルストア契約はアカウント削除で自動解約されないと日本語で明示する', () => {
    expect(
      subscriptionDeletionAcknowledgement({
        activeMobileStoreSubscriptionCount: 1,
        activeStripeSubscriptionCount: 0,
        language: 'ja'
      })
    ).toContain(
      'App Store / Google Play の契約 1 件は自動解約されません'
    );
  });

  it('Web契約とモバイルストア契約の扱いを英語で区別する', () => {
    const message = subscriptionDeletionAcknowledgement({
      activeMobileStoreSubscriptionCount: 2,
      activeStripeSubscriptionCount: 1,
      language: 'en'
    });

    expect(message).toContain('1 web subscription');
    expect(message).toContain('2 App Store / Google Play subscriptions');
    expect(message).toContain('will not be cancelled automatically');
  });
});
