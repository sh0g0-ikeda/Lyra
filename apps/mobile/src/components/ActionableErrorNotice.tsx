import { Notice } from '@/components/Notice';
import type { UiLanguage } from '@/domain/types';
import {
  errorRecoveryActionLabel,
  errorRecoveryTarget,
  type ErrorRecoveryTarget
} from '@/lib/errorRecovery';
import { userErrorMessage } from '@/lib/userMessages';
import { errorRefreshLabel, isReadOperation, operationErrorMessage, operationRecoveryTarget, type OperationErrorContext } from '@/lib/operationErrorContext';

export type ErrorRecoveryActions = Partial<
  Record<ErrorRecoveryTarget, () => void>
>;

interface ActionableErrorNoticeProps {
  actions: ErrorRecoveryActions;
  error: unknown;
  language: UiLanguage;
  target?: ErrorRecoveryTarget;
  tone?: 'info' | 'warning' | 'danger';
  recoveryMessage?: string;
  recoveryActionLabel?: string;
  context?: OperationErrorContext | undefined;
  retryMode?: 'action' | 'refresh';
}

export function ActionableErrorNotice({
  actions,
  error,
  language,
  target,
  tone = 'info',
  recoveryMessage,
  recoveryActionLabel,
  context,
  retryMode = 'action'
}: ActionableErrorNoticeProps): React.JSX.Element | null {
  const resolvedTarget = target ?? (context === undefined ? errorRecoveryTarget(error) : operationRecoveryTarget(error, context));
  const onAction =
    resolvedTarget === null || resolvedTarget === undefined
      ? undefined
      : actions[resolvedTarget];
  const isPassiveRead = context !== undefined && context.essential !== true;
  const isRead = context !== undefined && isReadOperation(context);
  const hasAccessRecovery =
    onAction !== undefined && (resolvedTarget === 'login' || resolvedTarget === 'workspace');
  if ((context === undefined && onAction === undefined) || (isRead && isPassiveRead && !hasAccessRecovery)) {
    return null;
  }

  return (
    <Notice
      announce
      actionLabel={
        resolvedTarget !== null &&
        resolvedTarget !== undefined &&
        onAction !== undefined
          ? recoveryActionLabel ?? (resolvedTarget === 'retry' && retryMode === 'refresh'
            ? errorRefreshLabel(language)
            : errorRecoveryActionLabel(resolvedTarget, language))
          : undefined
      }
      actionTestID={
        resolvedTarget !== null &&
        resolvedTarget !== undefined &&
        onAction !== undefined
          ? `error-recovery-${resolvedTarget}${context === undefined ? '' : `-${context.operation}`}`
          : undefined
      }
      message={context === undefined ? recoveryMessage ?? userErrorMessage(error, language) : operationErrorMessage(error, context, language, recoveryMessage)}
      onAction={onAction}
      tone={tone}
    />
  );
}
