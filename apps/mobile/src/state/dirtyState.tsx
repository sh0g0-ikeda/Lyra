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
  type DirtyEditorRegistration,
  type DirtyStateChoice
} from '@/domain/dirtyStatePolicy';
import type { UiLanguage } from '@/domain/types';
import { UnsavedChangesResolutionDialog } from '@/components/UnsavedChangesResolutionDialog';

interface DirtyStateContextValue {
  clearResolvedRevision: (id: string) => void;
  hasDirtyEditors: boolean;
  register: (registration: DirtyEditorRegistration) => () => void;
  resolveDirtyEditors: (language: UiLanguage) => Promise<boolean>;
  saveDirtyEditors: () => Promise<boolean>;
}

const DirtyStateContext = createContext<DirtyStateContextValue | null>(null);

interface PendingDirtyResolution {
  language: UiLanguage;
  registrations: readonly DirtyEditorRegistration[];
  resolve: (allowed: boolean) => void;
}

export function DirtyStateProvider({ children }: PropsWithChildren): React.JSX.Element {
  const registrationsRef = useRef(new Map<string, DirtyEditorRegistration>());
  const resolvedRevisionsRef = useRef(new Map<string, string>());
  const resolutionRef = useRef<Promise<boolean> | null>(null);
  const backgroundSaveRef = useRef<Promise<boolean> | null>(null);
  const pendingResolutionRef = useRef<PendingDirtyResolution | null>(null);
  const [registrationCount, setRegistrationCount] = useState(0);
  const [pendingResolution, setPendingResolution] =
    useState<PendingDirtyResolution | null>(null);

  const register = useCallback((registration: DirtyEditorRegistration): (() => void) => {
    if (
      registration.revision !== undefined &&
      resolvedRevisionsRef.current.get(registration.id) === registration.revision
    ) {
      return () => undefined;
    }
    resolvedRevisionsRef.current.delete(registration.id);
    registrationsRef.current.set(registration.id, registration);
    setRegistrationCount(registrationsRef.current.size);
    return () => {
      const current = registrationsRef.current.get(registration.id);
      if (current === registration) {
        registrationsRef.current.delete(registration.id);
        setRegistrationCount(registrationsRef.current.size);
      }
    };
  }, []);

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
        setRegistrationCount(registrationsRef.current.size);
      }
    },
    []
  );

  const settlePendingResolution = useCallback((choice: DirtyStateChoice): void => {
    const pending = pendingResolutionRef.current;
    if (pending === null) {
      return;
    }
    pendingResolutionRef.current = null;
    setPendingResolution(null);
    void applyDirtyStateChoice(pending.registrations, choice).then((allowed) => {
      if (allowed) {
        removeResolvedRegistrations(pending.registrations);
      }
      pending.resolve(allowed);
    });
  }, [removeResolvedRegistrations]);

  const resolveDirtyEditors = useCallback((language: UiLanguage): Promise<boolean> => {
    if (registrationsRef.current.size === 0) {
      return Promise.resolve(true);
    }
    if (resolutionRef.current !== null) {
      return resolutionRef.current;
    }
    const registrations = [...registrationsRef.current.values()];
    const resolution = new Promise<boolean>((resolve) => {
      const pending = { language, registrations, resolve };
      pendingResolutionRef.current = pending;
      setPendingResolution(pending);
    });
    resolutionRef.current = resolution;
    void resolution.finally(() => {
      if (resolutionRef.current === resolution) {
        resolutionRef.current = null;
      }
    });
    return resolution;
  }, []);

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

  useEffect(
    () => () => {
      const pending = pendingResolutionRef.current;
      pendingResolutionRef.current = null;
      resolutionRef.current = null;
      pending?.resolve(false);
    },
    []
  );

  const value = useMemo<DirtyStateContextValue>(
    () => ({
      clearResolvedRevision,
      hasDirtyEditors: registrationCount > 0,
      register,
      resolveDirtyEditors,
      saveDirtyEditors
    }),
    [
      clearResolvedRevision,
      register,
      registrationCount,
      resolveDirtyEditors,
      saveDirtyEditors
    ]
  );

  return (
    <DirtyStateContext.Provider value={value}>
      {children}
      <UnsavedChangesResolutionDialog
        language={pendingResolution?.language ?? 'ja'}
        onSelect={settlePendingResolution}
        visible={pendingResolution !== null}
      />
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
      discard: input.discard,
      save: input.save
    });
  }, [
    clearResolvedRevision,
    input.dirty,
    input.discard,
    input.id,
    input.revision,
    input.save,
    register
  ]);
}
