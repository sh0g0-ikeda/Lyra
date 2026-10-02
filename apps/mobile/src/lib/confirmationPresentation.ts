import { useSyncExternalStore } from 'react';
const active = new Set<symbol>();
const listeners = new Set<() => void>();
const emit = (): void => listeners.forEach((listener) => listener());
export function beginConfirmationPresentation(): () => void {
  const token = Symbol('confirmation'); active.add(token); emit();
  return () => { if (active.delete(token)) emit(); };
}
const subscribe = (listener: () => void): (() => void) => { listeners.add(listener); return () => listeners.delete(listener); };
const getSnapshot = (): boolean => active.size > 0;
export function useConfirmationPresentation(): boolean { return useSyncExternalStore(subscribe, getSnapshot, getSnapshot); }
