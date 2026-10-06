import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { canPresentPageCompletion, type CompletedPageResult, type PageCompletionContext } from '@/domain/pageCompletionPolicy';

// Completion is event-driven, never a side effect of rendering an image or
// changing a step. Dirty/dialog interruptions become a manual result notice.
export function usePageCompletion(context: Omit<PageCompletionContext, 'foreground'>): {
  result: CompletedPageResult | null;
  visible: boolean;
  complete: (result: CompletedPageResult) => void;
  open: (result: CompletedPageResult) => void;
  close: () => void;
} {
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const [result, setResult] = useState<CompletedPageResult | null>(null);
  const [opened, setOpened] = useState(false);
  if (opened && (!context.focused || context.dirty || context.presentationBusy || result?.targetKey !== context.targetKey)) setOpened(false);
  const latestContext = useRef<PageCompletionContext>({ ...context, foreground });
  const seen = useRef(new Set<string>());
  const deferred = useRef<CompletedPageResult | null>(null);
  useLayoutEffect(() => { latestContext.current = { ...context, foreground }; }, [context, foreground]);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      const active = state === 'active';
      setForeground(active);
      const pending = deferred.current;
      if (active && pending !== null) {
        deferred.current = null;
        if (canPresentPageCompletion(pending, { ...latestContext.current, foreground: true })) { setResult(pending); setOpened(true); }
      }
    });
    return () => subscription.remove();
  }, []);
  const complete = useCallback((next: CompletedPageResult): void => {
    const key = `${next.targetKey}:${next.jobId}`;
    if (seen.current.has(key)) return;
    seen.current.add(key);
    if (next.targetKey !== latestContext.current.targetKey) return;
    setResult(next);
    if (canPresentPageCompletion(next, latestContext.current)) setOpened(true);
    else if (!latestContext.current.foreground && !latestContext.current.dirty && !latestContext.current.presentationBusy && latestContext.current.focused) deferred.current = next;
  }, []);
  const open = useCallback((next: CompletedPageResult): void => {
    if (!canPresentPageCompletion(next, latestContext.current)) return;
    deferred.current = null;
    seen.current.add(`${next.targetKey}:${next.jobId}`);
    setResult(next); setOpened(true);
  }, []);
  const close = useCallback((): void => { deferred.current = null; setOpened(false); }, []);
  return { result: result?.targetKey === context.targetKey ? result : null, visible: opened && result !== null && canPresentPageCompletion(result, { ...context, foreground }), complete, open, close };
}
