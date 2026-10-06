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

export const collectOperationFailures = <T extends { error: unknown }>(failures: readonly T[]): (T & { error: Error })[] => {
  const seen = new Set<Error>();
  return failures.filter((failure): failure is T & { error: Error } => {
    if (!(failure.error instanceof Error) || seen.has(failure.error)) return false;
    seen.add(failure.error);
    return true;
  });
};

export const errorRefreshLabel = (language: UiLanguage): string =>
  operationErrorMessages[language].refresh;

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
  const lines = [`${operationLabel}: ${operationErrorReason(error, language)}`];
  if (kind === 'read') {
    lines.push(copy.read);
  } else if (context.confirmed === true) {
    lines.push(copy.confirmed);
  } else if (kind === 'cancel') {
    lines.push(copy.cancel);
  } else if (kind !== 'local') {
    lines.push(copy.write);
  }
  if (context.retainedDraft !== undefined) {
    const fields = draftFields[context.retainedDraft][japanese ? 0 : 1];
    lines.push(copy.retained.replace('{fields}', fields));
  }
  if (kind === 'paidJob' || kind === 'cancel') {
    lines.push(copy.settlement);
  } else if (kind === 'textAi' || kind === 'textJob') {
    lines.push(copy.freeAi);
  } else if (kind === 'history') {
    lines.push(copy.history);
  }
  lines.push(context.confirmed === true ? copy.confirmedNext : kind === 'read' ? copy.refreshNext : copy.mutationNext);
  if (recoveryMessage !== undefined) lines.push(recoveryMessage);
  return lines.join('\n');
};
