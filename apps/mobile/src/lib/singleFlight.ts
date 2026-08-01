export function createSingleFlight<Args extends unknown[], Result>(
  task: (...args: Args) => Promise<Result>
): (...args: Args) => Promise<Result> {
  let inFlight: Promise<Result> | null = null;

  return (...args: Args): Promise<Result> => {
    if (inFlight !== null) {
      return inFlight;
    }

    const current = task(...args);
    inFlight = current;
    const clear = (): void => {
      if (inFlight === current) {
        inFlight = null;
      }
    };
    void current.then(clear, clear);
    return current;
  };
}
