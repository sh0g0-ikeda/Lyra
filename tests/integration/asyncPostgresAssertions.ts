export async function rejectionOf(operation: PromiseLike<unknown>): Promise<unknown> {
  try {
    await operation;
  } catch (reason: unknown) {
    return reason;
  }
  throw new Error('Expected operation to reject');
}

export async function throwingRejectionOf(
  operation: PromiseLike<unknown>,
): Promise<() => never> {
  const reason = await rejectionOf(operation);
  return (): never => {
    throw reason;
  };
}
