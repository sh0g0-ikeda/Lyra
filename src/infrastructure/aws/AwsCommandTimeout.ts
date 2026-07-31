import { ConfigurationError } from '../../domain/errors/index.js';

export const ACCOUNT_DELETION_AWS_TIMEOUT_MS = 30_000;

export async function runAwsCommandWithTimeout<T>(
  operationName: string,
  timeoutMs: number,
  operation: (abortSignal: AbortSignal) => Promise<T>,
): Promise<T> {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
    throw new ConfigurationError(
      'Account deletion AWS timeout configuration is invalid',
    );
  }

  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new ConfigurationError(`${operationName} timed out`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([
      operation(controller.signal),
      timeoutPromise,
    ]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}
