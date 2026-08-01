import { useEffect, useRef } from 'react';

export function useResetOnScopeChange(
  scope: string,
  resetters: readonly (() => void)[]
): void {
  const previousScopeRef = useRef(scope);
  const resettersRef = useRef(resetters);

  useEffect(() => {
    resettersRef.current = resetters;
  }, [resetters]);

  useEffect(() => {
    if (previousScopeRef.current === scope) {
      return;
    }
    previousScopeRef.current = scope;
    resettersRef.current.forEach((reset) => reset());
  }, [scope]);
}
