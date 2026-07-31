import { ApiError } from './api';
import { AuthError } from './auth';
import { t, type UiLanguage } from './i18n';

export function userErrorMessage(
  error: unknown,
  language: UiLanguage,
): string {
  if (error instanceof AuthError) {
    if (error.code === 'AUTHORIZATION_CANCELLED') {
      return t(language, 'authCancelled');
    }
    return t(language, 'authFailed');
  }
  if (error instanceof ApiError && error.status === 401) {
    return t(language, 'sessionExpired');
  }
  if (error instanceof ApiError && error.status === 0) {
    return t(language, 'networkError');
  }
  return t(language, 'temporaryError');
}
