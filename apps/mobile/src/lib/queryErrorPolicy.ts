import { ApiError } from '@/lib/api';

interface QueryErrorState<T> {
  data: T | undefined;
  enabled: boolean;
  error: unknown;
}

export function currentQueryError<T>(
  state: QueryErrorState<T>
): Error | null {
  if (!state.enabled || state.data !== undefined) {
    return null;
  }
  return state.error instanceof Error ? state.error : null;
}

export function supportingQueryError<T>(
  state: QueryErrorState<T>
): Error | null {
  const error = currentQueryError(state);
  return isApiNotFoundError(error) ? null : error;
}

export function isApiNotFoundError(error: unknown): error is ApiError {
  return error instanceof ApiError && error.status === 404;
}
