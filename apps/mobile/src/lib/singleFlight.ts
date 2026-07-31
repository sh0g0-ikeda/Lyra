export function createSingleFlight<T>(
  task: () => Promise<T>,
): () => Promise<T> {
  let current: Promise<T> | null = null;

  return (): Promise<T> => {
    if (current !== null) {
      return current;
    }

    let started: Promise<T>;
    try {
      started = task();
    } catch (error: unknown) {
      started = Promise.reject(error);
    }
    const tracked = started.finally(() => {
      if (current === tracked) {
        current = null;
      }
    });
    current = tracked;
    return tracked;
  };
}
