import type { MangaCreationStep } from '@/domain/mangaWorkflow';
import { createContext, useContext } from 'react';

export interface MangaStateCandidate {
  entityId: string;
  name: string;
  description: string;
  stateId?: string | null;
}

export interface MangaWorkflowActions {
  activeStep?: MangaCreationStep | null;
  registerPageBackHandler?: (handler: () => boolean) => () => void;
  requestStateCandidate: (candidate: MangaStateCandidate) => Promise<boolean>;
}

export const MangaWorkflowContext = createContext<MangaWorkflowActions | null>(null);

export function useMangaWorkflow(): MangaWorkflowActions | null {
  return useContext(MangaWorkflowContext);
}
