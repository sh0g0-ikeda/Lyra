import { describe, expect, it } from 'vitest';
import {
  formatUserFacingError,
  formatUserFacingErrorMessage,
} from '../../../apps/web/src/lib/userFacingErrors.js';

describe('userFacingErrors', () => {
  it('通信失敗は再読み込みを促すメッセージになる', () => {
    expect(formatUserFacingError(new TypeError('Failed to fetch'), 'ja')).toContain('ページを再読み込み');
  });

  it('Cognito未確認ユーザーはメール確認を促すメッセージになる', () => {
    expect(formatUserFacingErrorMessage({ message: 'Invalid input: User is not confirmed.' }, 'ja')).toContain(
      '確認メール',
    );
  });

  it('クレジット不足は購入を促すメッセージになる', () => {
    expect(formatUserFacingError(apiError('Credit balance is insufficient', 402, 'INSUFFICIENT_CREDITS'), 'ja')).toBe(
      'クレジットが不足しています。クレジットを購入してからもう一度お試しください。',
    );
  });

  it('セリフ話者不足は話者またはナレーション選択を促す', () => {
    expect(
      formatUserFacingErrorMessage(
        { message: 'entity_id is required for speaker dialogue types', code: 'VALIDATION_ERROR', status: 422 },
        'ja',
      ),
    ).toContain('ナレーション');
  });

  it('コマ数とコマ枠数の不一致はテンプレート適用を促す', () => {
    expect(
      formatUserFacingErrorMessage(
        { message: 'Page frame count must match panel count before generation', status: 422 },
        'ja',
      ),
    ).toContain('コマ割りテンプレート');
  });

  it('開発者向けの500系メッセージはそのまま表示しない', () => {
    expect(formatUserFacingError(apiError('OpenAI page compiler returned invalid JSON', 500, null), 'ja')).toBe(
      'ストーリーからページ骨格を作成できませんでした。話を短くするか分けてから、もう一度お試しください。',
    );
  });

  it('決済URLエラーは課金パネルからの再試行を促す', () => {
    expect(formatUserFacingErrorMessage({ message: 'Stripe Checkout session URL is not available' }, 'ja')).toContain(
      '課金パネル',
    );
  });

  it('既存ページありの骨格生成エラーは上書き再生成を促す', () => {
    expect(formatUserFacingErrorMessage({ message: 'Episode already has pages', status: 409 }, 'ja')).toContain(
      '上書き再生成',
    );
  });

  it('400系はBad Requestを出さず入力確認を促す', () => {
    expect(formatUserFacingError(apiError('400 Bad Request', 400, null), 'ja')).toContain('入力内容');
  });

  it('再試行上限は新しい生成開始を促す', () => {
    expect(formatUserFacingErrorMessage({ message: 'Generation job exceeded retry limit', status: 409 }, 'ja')).toContain(
      '新しく生成',
    );
  });
});

function apiError(message: string, status: number, code: string | null): Error & { status: number; code: string | null } {
  const error = new Error(message) as Error & { status: number; code: string | null };
  error.status = status;
  error.code = code;
  return error;
}
