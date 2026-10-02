import type { MangaCreationStep } from '@/domain/mangaWorkflow';

let requestId = 0;

// Repeated entry into the same step is a new user request, even in the same ms.
export function creationRouteParams(step: MangaCreationStep): { step: MangaCreationStep; requestId: number } {
  return { step, requestId: ++requestId };
}
