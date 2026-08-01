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

  it('revision conflict tells the user that the draft is preserved', () => {
    expect(userErrorMessage(new ApiError('raw', 409, 'RESOURCE_STALE'), 'ja')).toContain('入力内容は保持');
    expect(userErrorMessage(new ApiError('raw', 409, 'RESOURCE_STALE'), 'en')).toContain('draft is preserved');
  });
});
