import type { PageRecord } from '@/domain/types';

// A new UI never calls the legacy reopen endpoint as a viewing side effect.
// Only an advertised server transaction may admit a confirmed-page mutation.
export function canEditPageStatus(status: PageRecord['status'], automaticReopen: boolean | undefined): boolean {
  return status === 'designing' || status === 'editing' || (status === 'confirmed' && automaticReopen === true);
}
