import { describe, expect, it } from 'vitest';
import {
  formatGenerationJobFailureMessage,
  formatUserFacingError,
  formatUserFacingErrorMessage,
} from '../../../apps/web/src/lib/userFacingErrors.js';

describe('userFacingErrors', () => {
  it('自由生成参照による拒否では通常プレビューの再確定を案内する', () => {
    const failure = { code: 'PAGE_REFERENCE_MODEL_INCOMPATIBLE', status: 409, message: 'provider details hidden' };
    expect(formatUserFacingErrorMessage(failure, 'ja')).toContain('通常生成したプレビューを確定');
    expect(formatUserFacingErrorMessage(failure, 'en')).toContain('confirm a standard preview');
  });

  it('通信失敗では再読み込みを促す', () => {
    expect(formatUserFacingError(new TypeError('Failed to fetch'), 'ja')).toContain('ページを再読み込み');
  });

  it('Cognito未確認ユーザーではメール確認を促す', () => {
    expect(formatUserFacingErrorMessage({ message: 'Invalid input: User is not confirmed.' }, 'ja')).toContain(
      '確認メール',
    );
  });

  it('Cognito email_verified false ではメール確認を促す', () => {
    expect(formatUserFacingErrorMessage({ message: 'Cognito email is not verified' }, 'ja')).toContain('メール確認');
  });

  it('招待メール不一致では招待されたメールでのログインを促す', () => {
    expect(
      formatUserFacingErrorMessage(
        { message: 'Invitation email does not match the signed-in account', status: 403 },
        'ja',
      ),
    ).toContain('招待されたメールアドレス');
  });

  it('期限切れ招待では再送依頼を促す', () => {
    expect(formatUserFacingErrorMessage({ message: 'Invitation has expired', status: 409 }, 'ja')).toContain('再送');
  });

  it('無効な招待では新しい招待リンクを促す', () => {
    expect(formatUserFacingErrorMessage({ message: 'Invitation not found', status: 404 }, 'ja')).toContain(
      '新しい招待リンク',
    );
  });

  it('クレジット不足では購入を促す', () => {
    expect(formatUserFacingError(apiError('Credit balance is insufficient', 402, 'INSUFFICIENT_CREDITS'), 'ja')).toBe(
      'クレジットが不足しています。クレジットを購入してからもう一度お試しください。',
    );
  });

  it('セリフ話者不足では話者またはナレーション選択を促す', () => {
    expect(
      formatUserFacingErrorMessage(
        { message: 'entity_id is required for speaker dialogue types', code: 'VALIDATION_ERROR', status: 422 },
        'ja',
      ),
    ).toContain('ナレーション');
  });

  it('コマ数とコマ枠数の不一致ではテンプレート適用を促す', () => {
    expect(
      formatUserFacingErrorMessage(
        { message: 'Page frame count must match panel count before generation', status: 422 },
        'ja',
      ),
    ).toContain('コマ割りテンプレート');
  });

  it('開発者向け500系メッセージはそのまま表示しない', () => {
    expect(formatUserFacingError(apiError('OpenAI page compiler returned invalid JSON', 500, null), 'ja')).toBe(
      'ストーリーからページ骨格を作成できませんでした。文章を短くするか話を分けてから、もう一度お試しください。',
    );
  });

  it('決済URLエラーでは課金パネルからの再試行を促す', () => {
    expect(formatUserFacingErrorMessage({ message: 'Stripe Checkout session URL is not available' }, 'ja')).toContain(
      '課金パネル',
    );
  });

  it('未設定の法人プランでは購入不可を伝える', () => {
    expect(
      formatUserFacingErrorMessage(
        { message: 'Subscription plan is not available for checkout yet: enterprise_a', status: 500 },
        'ja',
      ),
    ).toContain('まだ購入できません');
  });

  it('既存ページありの骨格生成エラーでは上書き再生成を促す', () => {
    expect(formatUserFacingErrorMessage({ message: 'Episode already has pages', status: 409 }, 'ja')).toContain(
      '上書き再生成',
    );
  });

  it('400系ではBad Requestを出さず入力確認を促す', () => {
    expect(formatUserFacingError(apiError('400 Bad Request', 400, null), 'ja')).toContain('入力内容');
  });

  it('再試行上限では新しい生成開始を促す', () => {
    expect(formatUserFacingErrorMessage({ message: 'Generation job exceeded retry limit', status: 409 }, 'ja')).toContain(
      '新しく生成',
    );
  });

  it('413では入力を短くする案内になる', () => {
    expect(formatUserFacingError(apiError('Payload too large', 413, 'PAYLOAD_TOO_LARGE'), 'ja')).toContain(
      '文章を短く',
    );
  });

  it('401では再ログインを促す', () => {
    expect(formatUserFacingError(apiError('Unauthorized', 401, null), 'ja')).toContain('もう一度ログイン');
  });

  it('Cognito session のアプリ不一致では再ログインを促す', () => {
    expect(
      formatUserFacingErrorMessage({ message: 'Cognito session no longer matches this app. Please sign in again.' }, 'ja'),
    ).toContain('もう一度ログイン');
  });

  it('pending招待の重複は生成ジョブではなく招待の案内にする', () => {
    const message = formatUserFacingErrorMessage(
      { message: 'An active invitation already exists for this email', status: 409, code: 'CONFLICT' },
      'ja',
    );

    expect(message).toContain('招待');
    expect(message).not.toContain('生成処理');
  });

  it('未知の409は生成ジョブ待機とは表示しない', () => {
    const message = formatUserFacingErrorMessage({ message: 'Only pending invitations can be resent', status: 409 }, 'ja');

    expect(message).not.toContain('生成処理');
  });

  it('ACCOUNT_LINK_REQUIREDだけを既存ログインと明示連携の案内へ変換する', () => {
    expect(formatUserFacingErrorMessage({ code: 'ACCOUNT_LINK_REQUIRED', status: 409 }, 'ja')).toBe(
      'このメールアドレスは登録済みです。これまでの方法でログインしてください。Googleログインを使うには、アカウント画面から連携する必要があります。',
    );
    expect(
      formatUserFacingErrorMessage(
        {
          message:
            'PreSignUp failed with error Use the existing sign-in method and link this provider from your account. (Service: AWSCognitoIdentityProvider)',
        },
        'en',
      ),
    ).toBe(
      'This email address is already registered. Sign in with your existing method. To use Google sign-in, link Google from your account.',
    );
  });

  it('未知のprovider文やメールアドレスを連携案内として表示しない', () => {
    const raw = 'Provider said user@example.test should link an account with internal_key=secret';
    const message = formatUserFacingErrorMessage({ message: raw }, 'en');
    expect(message).toBe('The operation failed. Save your changes, wait a moment, then try again.');
    expect(message).not.toContain('user@example.test');
    expect(message).not.toContain('secret');
  });
});

function apiError(message: string, status: number, code: string | null): Error & { status: number; code: string | null } {
  const error = new Error(message) as Error & { status: number; code: string | null };
  error.status = status;
  error.code = code;
  return error;
}

describe('生成ジョブの失敗案内', () => {
  it.each(['ja', 'en'] as const)('自動入力の停止では%sでも画像保存失敗と案内しない', (language) => {
    const message = formatGenerationJobFailureMessage({ job_type: 'episode_story_autofill', error_message: 'Long-running story/page planning job stopped before completion; recovered stale queued or processing job' }, language);
    expect(message).toContain(language === 'ja' ? '自動入力' : 'autofill');
    expect(message).not.toContain(language === 'ja' ? '画像' : 'image');
    expect(message).not.toContain('recovered stale');
  });
  it('自動入力の生成失敗をページ骨格の作り直しと案内しない', () => {
    const message = formatGenerationJobFailureMessage({ job_type: 'episode_story_autofill', error_message: 'OpenAI page compiler returned invalid JSON' }, 'ja');
    expect(message).toContain('自動入力');
    expect(message).not.toContain('ページ骨格');
  });
  it('骨格作成の停止では画像保存失敗と案内しない', () => {
    const message = formatGenerationJobFailureMessage({ job_type: 'episode_page_skeleton', error_message: 'Generation failed' }, 'ja');
    expect(message).toContain('ページ骨格');
    expect(message).not.toContain('画像');
  });
  it('画像生成では従来の画像保存失敗案内を維持する', () => {
    expect(formatGenerationJobFailureMessage({ job_type: 'page_generate', error_message: 'Generation failed' }, 'ja')).toContain('画像を保存する前');
  });
  it('自動入力でも入力量上限の具体的な対処案内を維持する', () => {
    expect(formatGenerationJobFailureMessage({ job_type: 'episode_story_autofill', error_message: 'Context is too large' }, 'ja')).toContain('文章を短く');
  });
});
