import { ApiError } from './api';
import { AuthError } from './auth';

export function userErrorMessage(error: unknown): string {
  if (error instanceof AuthError) {
    if (error.code === 'AUTHORIZATION_CANCELLED') {
      return 'ログインがキャンセルされました。もう一度お試しください。';
    }
    return 'ログイン処理を完了できませんでした。通信環境を確認してください。';
  }
  if (error instanceof ApiError && error.status === 401) {
    return 'ログインの有効期限が切れました。もう一度ログインしてください。';
  }
  if (error instanceof ApiError && error.status === 0) {
    return 'サーバーに接続できません。通信環境を確認してください。';
  }
  return '一時的に処理できませんでした。少し待って再試行してください。';
}
