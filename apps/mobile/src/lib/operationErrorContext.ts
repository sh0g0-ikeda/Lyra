import type { UiLanguage } from '@/domain/types';
import { ApiError } from '@/lib/api';
import { errorRecoveryTarget, type ErrorRecoveryTarget } from '@/lib/errorRecovery';
import { userErrorMessage } from '@/lib/userMessages';
import { operationDefinitions as operations, operationDraftFields as draftFields, operationErrorMessages } from '@/lib/operationErrorMessages';

export type ErrorOperation = keyof typeof operations;
export type ErrorDraftScope = keyof typeof draftFields;

export interface OperationErrorContext {
  operation: ErrorOperation;
  retainedDraft?: ErrorDraftScope | undefined;
  targetLabel?: string | undefined;
  confirmed?: boolean;
  /** A failed read may interrupt the screen only when no usable initial data exists. */
  essential?: boolean;
}

export interface OperationFailure {
  context: OperationErrorContext;
  error: unknown;
}

export const operationFailure = (
  operation: ErrorOperation,
  error: unknown,
  retainedDraft?: ErrorDraftScope
): OperationFailure => ({ context: { operation, retainedDraft }, error });

export const collectOperationFailures = <T extends { error: unknown; context?: OperationErrorContext }>(failures: readonly T[]): (T & { error: Error })[] => {
  const seen = new Set<Error>();
  const identities = new Set<string>();
  const deduplicated = failures.filter((failure): failure is T & { error: Error } => {
    if (!(failure.error instanceof Error) || seen.has(failure.error)) return false;
    const context = failure.context;
    const code = failure.error instanceof ApiError ? failure.error.code ?? '' : '';
    const identity = context === undefined ? undefined : `${context.operation}\u0000${context.targetLabel ?? ''}\u0000${code}`;
    if (identity !== undefined && identities.has(identity)) return false;
    seen.add(failure.error);
    if (identity !== undefined) identities.add(identity);
    return true;
  });

  const priority = (failure: T & { error: Error }): number => {
    const context = failure.context;
    if (context === undefined) return 0;
    const kind = operations[context.operation][2];
    return kind === 'read' ? (context.essential === true ? 1 : 0) : 2;
  };
  const highest = deduplicated.reduce<(T & { error: Error }) | undefined>((selected, failure) =>
    selected === undefined || priority(failure) > priority(selected) ? failure : selected, undefined);
  return highest === undefined ? [] : [highest];
};

export const errorRefreshLabel = (language: UiLanguage): string =>
  operationErrorMessages[language].refresh;

export const isReadOperation = (context: OperationErrorContext): boolean =>
  operations[context.operation][2] === 'read';

const isUnconfirmedTransport = (error: unknown): boolean =>
  (error instanceof ApiError && (error.code === 'REQUEST_TIMEOUT' || error.status === 0)) ||
  (error instanceof Error && error.name === 'AbortError');

export const operationRecoveryTarget = (error: unknown, context: OperationErrorContext): ErrorRecoveryTarget | null => {
  const kind = operations[context.operation][2];
  const target = errorRecoveryTarget(error);
  const jobOperation = kind === 'paidJob' || kind === 'textJob' || kind === 'cancel';
  if (jobOperation && (target === 'retry' || isUnconfirmedTransport(error))) return 'jobs';
  if (!jobOperation && isUnconfirmedTransport(error)) return 'retry';
  return target;
};

const operationErrorReason = (error: unknown, language: UiLanguage): string => {
  const copy = operationErrorMessages[language];
  // A timeout does not identify a job or prove whether the server accepted a write.
  if (isUnconfirmedTransport(error)) {
    return copy.transport;
  }
  if (error instanceof ApiError && error.status >= 500) {
    return copy.server;
  }
  if (error instanceof ApiError && ['PAGE_STALE', 'RESOURCE_STALE'].includes(error.code ?? '')) {
    return copy.stale;
  }
  return userErrorMessage(error, language);
};

export const operationErrorMessage = (
  error: unknown,
  context: OperationErrorContext,
  language: UiLanguage,
  recoveryMessage?: string
): string => {
  const [ja, en, kind] = operations[context.operation];
  const japanese = language === 'ja';
  const copy = operationErrorMessages[language];
  const operationLabel = `${japanese ? ja : en}${context.targetLabel === undefined ? '' : ` (${context.targetLabel})`}`;
  if (context.confirmed === true) {
    return `${operationLabel}: ${copy.confirmed}`;
  }
  const lines = [`${operationLabel}: ${operationErrorReason(error, language)}`];
  if (kind === 'paidJob' || kind === 'textJob' || kind === 'cancel') {
    lines.push(copy.jobsNext);
  } else if (kind === 'read') {
    lines.push(copy.refreshNext);
  } else if (kind !== 'local') {
    lines.push(copy.mutationNext);
  }
  if (recoveryMessage !== undefined && lines.length < 2) lines.push(recoveryMessage);
  return lines.join('\n');
};
