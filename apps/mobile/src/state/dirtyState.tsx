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
  const resolutionRef = useRef<Promise<boolean> | null>(null);
  const backgroundSaveRef = useRef<Promise<boolean> | null>(null);
  const pendingResolutionRef = useRef<PendingDirtyResolution | null>(null);
  const [registrationCount, setRegistrationCount] = useState(0);
  const [pendingResolution, setPendingResolution] =
    useState<PendingDirtyResolution | null>(null);

  const register = useCallback((registration: DirtyEditorRegistration): (() => void) => {
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

  const settlePendingResolution = useCallback((choice: DirtyStateChoice): void => {
    const pending = pendingResolutionRef.current;
    if (pending === null) {
      return;
    }
    pendingResolutionRef.current = null;
    setPendingResolution(null);
    void applyDirtyStateChoice(pending.registrations, choice).then(pending.resolve);
  }, []);

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
    const save = applyDirtyStateChoice(
      [...registrationsRef.current.values()],
      'save'
    );
    backgroundSaveRef.current = save;
    void save.finally(() => {
      if (backgroundSaveRef.current === save) {
        backgroundSaveRef.current = null;
      }
    });
    return save;
  }, []);

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
      hasDirtyEditors: registrationCount > 0,
      register,
      resolveDirtyEditors,
      saveDirtyEditors
    }),
    [register, registrationCount, resolveDirtyEditors, saveDirtyEditors]
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
  dirty: boolean;
  discard: () => void;
  save: () => Promise<void>;
}): void {
  const { register } = useDirtyState();
  useEffect(() => {
    if (!input.dirty) {
      return;
    }
    return register({
      id: input.id,
      discard: input.discard,
      save: input.save
    });
  }, [input.dirty, input.discard, input.id, input.save, register]);
}
