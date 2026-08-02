import type { PersistedWorkspaceSelection } from '@/domain/types';

export type DirtyStateChoice = 'save' | 'discard' | 'cancel';

export interface DirtyEditorRegistration {
  id: string;
  revision?: string;
  blocksNavigation?: boolean;
  discard: () => void;
  save: () => Promise<void>;
}

export function navigationBlockingRegistrations(
  registrations: readonly DirtyEditorRegistration[]
): DirtyEditorRegistration[] {
  return registrations.filter((registration) => registration.blocksNavigation !== false);
}

export async function applyDirtyStateChoice(
  registrations: readonly DirtyEditorRegistration[],
  choice: DirtyStateChoice
): Promise<boolean> {
  if (choice === 'cancel') {
    return false;
  }
  if (choice === 'discard') {
    registrations.forEach((registration) => registration.discard());
    return true;
  }
  try {
    for (const registration of registrations) {
      await registration.save();
    }
    return true;
  } catch {
    return false;
  }
}

export function hasSelectionChange(
  current: PersistedWorkspaceSelection,
  next: Partial<PersistedWorkspaceSelection>
): boolean {
  return (Object.keys(next) as (keyof PersistedWorkspaceSelection)[]).some(
    (key) => next[key] !== undefined && current[key] !== next[key]
  );
}
