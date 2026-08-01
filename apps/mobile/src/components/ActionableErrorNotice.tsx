import { Notice } from '@/components/Notice';
import type { UiLanguage } from '@/domain/types';
import {
  errorRecoveryActionLabel,
  errorRecoveryTarget,
  type ErrorRecoveryTarget
} from '@/lib/errorRecovery';
import { userErrorMessage } from '@/lib/userMessages';

export type ErrorRecoveryActions = Partial<
  Record<ErrorRecoveryTarget, () => void>
>;

interface ActionableErrorNoticeProps {
  actions: ErrorRecoveryActions;
  error: unknown;
  language: UiLanguage;
  target?: ErrorRecoveryTarget;
  tone?: 'warning' | 'danger';
}

export function ActionableErrorNotice({
  actions,
  error,
  language,
  target,
  tone = 'warning'
}: ActionableErrorNoticeProps): React.JSX.Element {
  const resolvedTarget = target ?? errorRecoveryTarget(error);
  const onAction =
    resolvedTarget === null || resolvedTarget === undefined
      ? undefined
      : actions[resolvedTarget];

  return (
    <Notice
      actionLabel={
        resolvedTarget !== null &&
        resolvedTarget !== undefined &&
        onAction !== undefined
          ? errorRecoveryActionLabel(resolvedTarget, language)
          : undefined
      }
      actionTestID={
        resolvedTarget !== null &&
        resolvedTarget !== undefined &&
        onAction !== undefined
          ? `error-recovery-${resolvedTarget}`
          : undefined
      }
      message={userErrorMessage(error, language)}
      onAction={onAction}
      tone={tone}
    />
  );
}
