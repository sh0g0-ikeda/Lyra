import { ActionableErrorNotice } from '@/components/ActionableErrorNotice';
import type { UiLanguage } from '@/domain/types';
import { commonGuidanceMessages } from '@/lib/commonGuidanceMessages';
import { confirmStaleDraftReload } from '@/lib/confirmStaleDraftReload';
import { ApiError } from '@/lib/api';

interface PageErrorRecoveryNoticeProps {
  error: unknown;
  language: UiLanguage;
  onAccount: () => void;
  onCharacters: () => void;
  onLayout?: (() => void) | undefined;
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
  const stale = error instanceof ApiError && error.code === 'PAGE_STALE';
  const copy = commonGuidanceMessages(language);
  const retry =
    stale
      ? () => confirmStaleDraftReload({ language, scope: 'page', onConfirm: onReloadStale })
      : onRetry;

  return (
    <ActionableErrorNotice
      actions={{
        characters: onCharacters,
        credits: onAccount,
        jobs: onAccount,
        ...(onLayout === undefined ? {} : { layout: onLayout }),
        login: onLogin,
        retry,
        workspace: onAccount
      }}
      error={error}
      language={language}
      recoveryActionLabel={stale ? copy.reloadPageAction : undefined}
      recoveryMessage={stale ? `${copy.reloadWarning}\n${copy.reloadFields.page}` : undefined}
    />
  );
}
