import { describe, expect, it } from 'vitest';

import { ApiError } from '@/lib/api';
import { userErrorMessage } from '@/lib/userMessages';

describe('userErrorMessage', () => {
  it('未知のBackendエラー本文を英語UIへ漏らさない', () => {
    const secret = 'provider_key=sk-sensitive internal-host=db.private';
    const message = userErrorMessage(new ApiError(secret, 418, 'UNKNOWN_BACKEND_ERROR'), 'en');

    expect(message).toBe('The action failed. Check your input.');
    expect(message).not.toContain('sk-sensitive');
    expect(message).not.toContain('db.private');
  });

  it('未知の端末例外本文を英語UIへ漏らさない', () => {
    const message = userErrorMessage(new Error('file:///private/path token=secret'), 'en');

    expect(message).toBe('The action failed. Check your connection and input, then try again.');
    expect(message).not.toContain('private/path');
    expect(message).not.toContain('secret');
  });

  it('offlineとtimeoutを仕様の復旧文言へ変換する', () => {
    expect(
      userErrorMessage(new ApiError('raw', 0, 'NETWORK_OFFLINE'), 'ja')
    ).toBe('インターネットに接続できません。接続を確認して再試行してください。');
    expect(
      userErrorMessage(new ApiError('raw', 0, 'REQUEST_TIMEOUT'), 'en')
    ).toBe('The request result could not be confirmed. Review Jobs before trying again.');
  });

  it('既知の認証失効は操作可能な文言を返す', () => {
    expect(userErrorMessage(new ApiError('raw', 401, 'UNAUTHORIZED'), 'ja')).toContain(
      'もう一度ログイン'
    );
  });

  it('退会のrecent-auth要求は再ログイン案内へ変換し、server本文を表示しない', () => {
    const message = userErrorMessage(new ApiError('provider detail must stay private', 401, 'RECENT_AUTH_REQUIRED'), 'en');
    expect(message).toBe('Your sign-in has expired. Sign in again.');
    expect(message).not.toContain('provider detail');
  });

  it('返金確認中の有料生成要求を保留案内へ変換する', () => {
    expect(userErrorMessage(new ApiError('raw', 402, 'CREDIT_RECOVERY_REQUIRED'), 'ja')).toBe(
      '返金確認中のため、有料生成は一時的に利用できません。'
    );
  });

  it('返金または決済確認中の退会拒否を各言語の専用案内へ変換し、server本文を表示しない', () => {
    const serverDetail = 'stripe_customer=customer-private recovery_credits_due=9';
    const japanese = userErrorMessage(
      new ApiError(serverDetail, 409, 'ACCOUNT_CREDIT_RECOVERY_PENDING'),
      'ja'
    );
    const english = userErrorMessage(
      new ApiError(serverDetail, 409, 'ACCOUNT_CREDIT_RECOVERY_PENDING'),
      'en'
    );

    expect(japanese).toContain('返金または決済確認');
    expect(japanese).toContain('退会');
    expect(japanese).toContain('閲覧・編集');
    expect(english).toContain('refund or payment confirmation');
    expect(english).toContain('Account deletion');
    expect(english).toContain('Viewing and editing');
    expect(`${japanese}\n${english}`).not.toContain('customer-private');
    expect(`${japanese}\n${english}`).not.toContain('recovery_credits_due');
  });

  it('退会の再認証アカウント不一致を各言語の再ログイン案内へ変換する', () => {
    expect(userErrorMessage(new Error('REAUTHENTICATED_ACCOUNT_MISMATCH'), 'ja')).toBe(
      '再認証したアカウントが現在のアカウントと一致しません。もう一度ログインしてください。'
    );
    expect(userErrorMessage(new Error('REAUTHENTICATED_ACCOUNT_MISMATCH'), 'en')).toBe(
      'The account used to sign in again does not match the current account. Sign in again.'
    );
  });

  it('revision conflict tells the user that the draft is preserved', () => {
    expect(userErrorMessage(new ApiError('raw', 409, 'RESOURCE_STALE'), 'ja')).toContain('入力内容は保持');
    expect(userErrorMessage(new ApiError('raw', 409, 'RESOURCE_STALE'), 'en')).toContain('draft is preserved');
  });
});
