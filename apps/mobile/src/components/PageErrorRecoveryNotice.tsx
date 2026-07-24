import { ActionableErrorNotice } from '@/components/ActionableErrorNotice';
import type { UiLanguage } from '@/domain/types';
import { ApiError } from '@/lib/api';

interface PageErrorRecoveryNoticeProps {
  error: unknown;
  language: UiLanguage;
  onAccount: () => void;
  onCharacters: () => void;
  onLayout: () => void;
  onLogin: () => void;
  onReloadStale: () => void;
  onRetry: () => void;
}

export function PageErrorRecoveryNotice({
  error,
  language,
  onAccount,
  onCharacters,
  onLayout,
  onLogin,
  onReloadStale,
  onRetry
}: PageErrorRecoveryNoticeProps): React.JSX.Element {
  const retry =
    error instanceof ApiError && error.code === 'PAGE_STALE'
      ? onReloadStale
      : onRetry;

  return (
    <ActionableErrorNotice
      actions={{
        characters: onCharacters,
        credits: onAccount,
        jobs: onAccount,
        layout: onLayout,
        login: onLogin,
        retry,
        workspace: onAccount
      }}
      error={error}
      language={language}
    />
  );
}
