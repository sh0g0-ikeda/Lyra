import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren
} from 'react';

import {
  applyDirtyStateChoice,
  navigationBlockingRegistrations,
  type DirtyEditorRegistration
} from '@/domain/dirtyStatePolicy';
import type { UiLanguage } from '@/domain/types';

interface DirtyStateContextValue {
  clearResolvedRevision: (id: string) => void;
  hasDirtyEditors: boolean;
  hasNavigationBlockingEditors: boolean;
  register: (registration: DirtyEditorRegistration) => () => void;
  resolveDirtyEditors: (language: UiLanguage, options?: { includeNonBlocking?: boolean }) => Promise<boolean>;
  saveDirtyEditors: () => Promise<boolean>;
}

const DirtyStateContext = createContext<DirtyStateContextValue | null>(null);

export function DirtyStateProvider({ children }: PropsWithChildren): React.JSX.Element {
  const registrationsRef = useRef(new Map<string, DirtyEditorRegistration>());
  const resolvedRevisionsRef = useRef(new Map<string, string>());
  const resolutionRef = useRef<Promise<boolean> | null>(null);
  const backgroundSaveRef = useRef<Promise<boolean> | null>(null);
  const [registrationCount, setRegistrationCount] = useState(0);
  const [navigationBlockingCount, setNavigationBlockingCount] = useState(0);

  const updateRegistrationCounts = useCallback((): void => {
    setRegistrationCount(registrationsRef.current.size);
    setNavigationBlockingCount(
      navigationBlockingRegistrations([...registrationsRef.current.values()]).length
    );
  }, []);

  const register = useCallback((registration: DirtyEditorRegistration): (() => void) => {
    if (
      registration.revision !== undefined &&
      resolvedRevisionsRef.current.get(registration.id) === registration.revision
    ) {
      return () => undefined;
    }
    resolvedRevisionsRef.current.delete(registration.id);
    registrationsRef.current.set(registration.id, registration);
    updateRegistrationCounts();
    return () => {
      const current = registrationsRef.current.get(registration.id);
      if (current === registration) {
        registrationsRef.current.delete(registration.id);
        updateRegistrationCounts();
      }
    };
  }, [updateRegistrationCounts]);

  const clearResolvedRevision = useCallback((id: string): void => {
    resolvedRevisionsRef.current.delete(id);
  }, []);

  const removeResolvedRegistrations = useCallback(
    (registrations: readonly DirtyEditorRegistration[]): void => {
      let removed = false;
      registrations.forEach((registration) => {
        const current = registrationsRef.current.get(registration.id);
        if (registration.revision !== undefined) {
          if (
            current === undefined ||
            current.revision !== registration.revision
          ) {
            return;
          }
          registrationsRef.current.delete(registration.id);
          removed = true;
          resolvedRevisionsRef.current.set(registration.id, registration.revision);
          return;
        }
        if (current === registration) {
          registrationsRef.current.delete(registration.id);
          removed = true;
        }
      });
      if (removed) {
        updateRegistrationCounts();
      }
    },
    [updateRegistrationCounts]
  );

  const resolveDirtyEditors = useCallback(function resolve(_language: UiLanguage, _options?: { includeNonBlocking?: boolean }): Promise<boolean> {
    if (registrationsRef.current.size === 0) {
      return Promise.resolve(true);
    }
    if (resolutionRef.current !== null) {
      if (_options?.includeNonBlocking) return resolutionRef.current.then((allowed) => allowed ? resolve(_language, _options) : false);
      return resolutionRef.current;
    }
    const registrations = [...registrationsRef.current.values()];
    if (registrations.length === 0) {
      return Promise.resolve(true);
    }
    const resolution = applyDirtyStateChoice(registrations, 'discard').then((allowed) => {
      if (allowed) {
        removeResolvedRegistrations(registrations);
      }
      return allowed;
    });
    resolutionRef.current = resolution;
    void resolution.finally(() => {
      if (resolutionRef.current === resolution) {
        resolutionRef.current = null;
      }
    });
    return resolution;
  }, [removeResolvedRegistrations]);

  const saveDirtyEditors = useCallback((): Promise<boolean> => {
    if (registrationsRef.current.size === 0) {
      return Promise.resolve(true);
    }
    if (backgroundSaveRef.current !== null) {
      return backgroundSaveRef.current;
    }
    const registrations = [...registrationsRef.current.values()];
    const save = applyDirtyStateChoice(registrations, 'save').then((allowed) => {
      if (allowed) {
        removeResolvedRegistrations(registrations);
      }
      return allowed;
    });
    backgroundSaveRef.current = save;
    void save.finally(() => {
      if (backgroundSaveRef.current === save) {
        backgroundSaveRef.current = null;
      }
    });
    return save;
  }, [removeResolvedRegistrations]);

  const value = useMemo<DirtyStateContextValue>(
    () => ({
      clearResolvedRevision,
      hasDirtyEditors: registrationCount > 0,
      hasNavigationBlockingEditors: navigationBlockingCount > 0,
      register,
      resolveDirtyEditors,
      saveDirtyEditors
    }),
    [
      clearResolvedRevision,
      register,
      navigationBlockingCount,
      registrationCount,
      resolveDirtyEditors,
      saveDirtyEditors
    ]
  );

  return (
    <DirtyStateContext.Provider value={value}>
      {children}
    </DirtyStateContext.Provider>
  );
}

export function useDirtyState(): DirtyStateContextValue {
  const value = useContext(DirtyStateContext);
  if (value === null) {
    throw new Error('useDirtyState must be used within DirtyStateProvider');
  }
  return value;
}

export function useDirtyEditorRegistration(input: {
  id: string;
  revision?: string;
  blocksNavigation?: boolean;
  dirty: boolean;
  discard: () => void;
  save: () => Promise<void>;
}): void {
  const { clearResolvedRevision, register } = useDirtyState();
  useEffect(() => {
    if (!input.dirty) {
      clearResolvedRevision(input.id);
      return;
    }
    return register({
      id: input.id,
      revision: input.revision,
      blocksNavigation: input.blocksNavigation,
      discard: input.discard,
      save: input.save
    });
  }, [
    clearResolvedRevision,
    input.dirty,
    input.blocksNavigation,
    input.discard,
    input.id,
    input.revision,
    input.save,
    register
  ]);
}
